const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('liste-non-affiliates')
        .setDescription('Affiche la liste des streamers non-affiliés sur ce serveur')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action à effectuer')
                .setRequired(false)
                .addChoices(
                    { name: 'Voir la liste', value: 'list' },
                    { name: 'Affilier un streamer', value: 'affiliate' }
                )
        )
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Nom d\'utilisateur Twitch du streamer à affilier')
                .setRequired(false)
        ),
    
    async execute(interaction, client) {
        try {
            // Vérifier les permissions pour l'action d'affiliation
            const action = interaction.options.getString('action') || 'list';
            const username = interaction.options.getString('username');

            if (action === 'affiliate' && !interaction.member.permissions.has('ManageGuild')) {
                return await interaction.reply({
                    content: '❌ Vous devez avoir la permission "Gérer le serveur" pour affilier un streamer.',
                    flags: 64 // ephemeral: true
                });
            }

            await interaction.deferReply();
            
            // ✅ CORRECTION: Récupérer les streamers de CE SERVEUR seulement
            const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
            const nonAffiliatedStreamers = guildStreamers.filter(s => s.status === 'non_affilie');
            
            // Gestion de l'action d'affiliation
            if (action === 'affiliate' && username) {
                const cleanUsername = username.toLowerCase().trim();
                const streamer = nonAffiliatedStreamers.find(s => 
                    s.twitch_username.toLowerCase() === cleanUsername || 
                    s.name.toLowerCase() === cleanUsername
                );
                
                if (!streamer) {
                    return await interaction.editReply({
                        content: `❌ "${username}" n'est pas dans la liste des non-affiliés de ce serveur ou n'existe pas.\nUtilisez \`/streamers\` pour voir tous les streamers suivis.`
                    });
                }
                
                // ✅ CORRECTION: Mise à jour directe en base
                try {
                    await client.db.db.run(`
                        UPDATE streamers 
                        SET status = 'affilie', updated_at = datetime('now') 
                        WHERE id = ?
                    `, [streamer.id]);

                    const embed = new EmbedBuilder()
                        .setTitle('✅ Streamer affilié avec succès !')
                        .setDescription(`**${streamer.display_name || streamer.name}** (@${streamer.twitch_username}) a été passé en affilié !`)
                        .setColor(Colors.Green)
                        .addFields(
                            {
                                name: '👤 Streamer',
                                value: `**${streamer.display_name || streamer.name}**\n@${streamer.twitch_username}`,
                                inline: true
                            },
                            {
                                name: '🔗 Lien Twitch',
                                value: `[Voir le profil](https://twitch.tv/${streamer.twitch_username})`,
                                inline: true
                            }
                        )
                        .setFooter({ 
                            text: `Affilié par ${interaction.user.displayName}`,
                            iconURL: interaction.user.displayAvatarURL()
                        })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    
                    console.log(`✅ ${streamer.twitch_username} passé en affilié par ${interaction.user.tag} sur ${interaction.guild.name}`);
                    
                    if (client.metrics?.recordCommand) {
                        client.metrics.recordCommand('liste-non-affiliates-affiliate', interaction.user.id);
                    }
                    return;
                    
                } catch (dbError) {
                    console.error('Erreur mise à jour statut:', dbError);
                    return await interaction.editReply({
                        content: `❌ Erreur lors de la mise à jour: ${dbError.message}`
                    });
                }
            }
            
            // ✅ Afficher la liste des non-affiliés de ce serveur
            const embed = new EmbedBuilder()
                .setTitle('💫 Streamers Non-Affiliés')
                .setColor(Colors.Orange)
                .setTimestamp();
            
            if (nonAffiliatedStreamers.length === 0) {
                // Vérifier s'il y a des streamers du tout
                const totalGuildStreamers = guildStreamers.length;
                const affiliatedCount = guildStreamers.filter(s => s.status === 'affilie').length;
                
                embed.setDescription(
                    totalGuildStreamers === 0 
                        ? '📭 Aucun streamer suivi sur ce serveur.\nUtilisez `/ajouter-streamer` pour en ajouter !'
                        : `🎉 Tous les streamers sont affiliés ! (${affiliatedCount}/${totalGuildStreamers})`
                )
                .setColor(Colors.Green);
                
                if (totalGuildStreamers > 0) {
                    embed.addFields({
                        name: '✅ Streamers affiliés',
                        value: `${affiliatedCount} streamer(s) affilié(s) sur ce serveur`,
                        inline: false
                    });
                }
                
                return await interaction.editReply({ embeds: [embed] });
            }
            
            // Statistiques du serveur
            const totalStreamers = guildStreamers.length;
            const affiliatedCount = guildStreamers.filter(s => s.status === 'affilie').length;
            
            embed.setDescription(
                `**${nonAffiliatedStreamers.length} streamer(s)** en attente d'affiliation sur ce serveur\n` +
                `📊 **${affiliatedCount}** affilié(s) • **${nonAffiliatedStreamers.length}** non-affilié(s) • **${totalStreamers}** total`
            );
            
            // ✅ Construire la liste avec les nouvelles données
            if (nonAffiliatedStreamers.length <= 10) {
                // Liste simple pour 10 streamers ou moins
                const streamersList = nonAffiliatedStreamers
                    .map((s, index) => {
                        const displayName = s.display_name || s.name;
                        const description = s.description && s.description !== 'Nouveau streamer' && s.description !== 'Streamer ajouté via bot' 
                            ? (s.description.length > 100 ? s.description.substring(0, 100) + '...' : s.description)
                            : 'Aucune description';
                        
                        return `**${index + 1}.** **${displayName}** (@${s.twitch_username})\n🔗 [Profil Twitch](https://twitch.tv/${s.twitch_username})\n💬 ${description}`;
                    })
                    .join('\n\n');
                
                embed.addFields({
                    name: '📋 Liste des streamers non-affiliés',
                    value: streamersList,
                    inline: false
                });
                
            } else {
                // Liste compacte pour plus de 10 streamers
                const streamersList = nonAffiliatedStreamers
                    .map((s, index) => `**${index + 1}.** ${s.display_name || s.name} (@${s.twitch_username})`)
                    .join('\n');
                
                // Diviser en colonnes si trop long
                if (streamersList.length <= 1024) {
                    embed.addFields({
                        name: '📋 Liste des streamers non-affiliés',
                        value: streamersList,
                        inline: false
                    });
                } else {
                    const halfLength = Math.ceil(nonAffiliatedStreamers.length / 2);
                    const firstHalf = nonAffiliatedStreamers.slice(0, halfLength)
                        .map((s, index) => `**${index + 1}.** ${s.display_name || s.name} (@${s.twitch_username})`)
                        .join('\n');
                    
                    const secondHalf = nonAffiliatedStreamers.slice(halfLength)
                        .map((s, index) => `**${halfLength + index + 1}.** ${s.display_name || s.name} (@${s.twitch_username})`)
                        .join('\n');
                    
                    embed.addFields(
                        {
                            name: '📋 Partie 1',
                            value: firstHalf.length > 1024 ? firstHalf.substring(0, 1021) + '...' : firstHalf,
                            inline: true
                        },
                        {
                            name: '📋 Partie 2',
                            value: secondHalf.length > 1024 ? secondHalf.substring(0, 1021) + '...' : secondHalf,
                            inline: true
                        }
                    );
                }
            }
            
            // Instructions d'utilisation
            embed.addFields({
                name: '💡 Comment affilier un streamer',
                value: 
                    '**Option 1:** `/liste-non-affiliates action:Affilier username:nom_utilisateur`\n' +
                    '**Option 2:** `/affiliate username:nom_utilisateur`\n' +
                    '**Conseil:** Utilisez l\'autocomplétion avec `/affiliate` pour plus de facilité !',
                inline: false
            });
            
            await interaction.editReply({ embeds: [embed] });
            
            // Log de l'utilisation
            console.log(`📋 Liste des non-affiliés consultée par ${interaction.user.tag} sur ${interaction.guild.name} (${nonAffiliatedStreamers.length} streamers)`);
            
            if (client.metrics?.recordCommand) {
                client.metrics.recordCommand('liste-non-affiliates', interaction.user.id);
            }
            
        } catch (error) {
            console.error('❌ Erreur dans liste-non-affiliates:', error);
            
            const errorMessage = {
                content: '❌ Une erreur est survenue lors de la récupération de la liste.',
                flags: 64 // ephemeral: true
            };

            try {
                if (interaction.deferred) {
                    await interaction.editReply(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            } catch (replyError) {
                console.error('❌ Impossible de répondre à l\'interaction:', replyError);
            }

            if (client.metrics?.recordError) {
                client.metrics.recordError();
            }
        }
    }
};