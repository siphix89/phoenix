const { SlashCommandBuilder, EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('affiliate')
        .setDescription('Passer un streamer en affilié sur ce serveur')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Nom d\'utilisateur Twitch du streamer')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    
    async execute(interaction, client) {
        try {
            await interaction.deferReply();

            const username = interaction.options.getString('username').toLowerCase().trim();
            
            // Vérifier que le streamer existe sur ce serveur
            const streamer = await client.db.getStreamer(interaction.guildId, username);
            
            if (!streamer) {
                return await interaction.editReply({
                    content: `❌ Streamer "${username}" non trouvé sur ce serveur.\nUtilisez \`/streamers\` pour voir la liste des streamers suivis.`
                });
            }
            
            // Vérifier le statut actuel
            const currentStatus = streamer.status || 'non_affilie';
            
            if (currentStatus === 'affilie') {
                const embed = new EmbedBuilder()
                    .setTitle('ℹ️ Déjà affilié')
                    .setDescription(`**${streamer.display_name || streamer.twitch_username}** (@${streamer.twitch_username}) est déjà affilié !`)
                    .setColor(Colors.Blue)
                    .setThumbnail(`https://logo.clearbit.com/twitch.tv`)
                    .addFields({
                        name: '📊 Statut actuel',
                        value: '✅ Affilié',
                        inline: true
                    })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }
            
            // Mettre à jour le statut via DatabaseManager
            const result = await client.db.updateStreamerStatus(
                interaction.guildId, 
                username, 
                'affilie'
            );
            
            if (!result.success) {
                throw new Error(result.error || 'Échec de la mise à jour');
            }
            
            console.log(`✅ Statut mis à jour pour ${streamer.twitch_username} (ID: ${streamer.id})`);
            
            // Créer l'embed de confirmation
            const embed = new EmbedBuilder()
                .setTitle('✅ Streamer passé en affilié !')
                .setDescription(`**${streamer.display_name || streamer.twitch_username}** (@${streamer.twitch_username}) a été passé en affilié avec succès !`)
                .setColor(Colors.Green)
                .setThumbnail(`https://logo.clearbit.com/twitch.tv`)
                .addFields(
                    {
                        name: '👤 Streamer',
                        value: `**${streamer.display_name || streamer.twitch_username}**\n@${streamer.twitch_username}`,
                        inline: true
                    },
                    {
                        name: '📊 Statut',
                        value: `~~Non affilié~~ → **✅ Affilié**`,
                        inline: true
                    },
                    {
                        name: '🔗 Lien Twitch',
                        value: `[Voir le profil](https://twitch.tv/${streamer.twitch_username})`,
                        inline: true
                    }
                )
                .setFooter({ 
                    text: `Modifié par ${interaction.user.displayName}`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            // Ajouter le message personnalisé si disponible
            if (streamer.custom_message && streamer.custom_message !== 'Streamer ajouté via bot') {
                embed.addFields({
                    name: '📝 Message personnalisé',
                    value: streamer.custom_message.length > 200 
                        ? streamer.custom_message.substring(0, 200) + '...' 
                        : streamer.custom_message,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });
            
            console.log(`✅ ${streamer.twitch_username} passé en affilié par ${interaction.user.tag} sur ${interaction.guild.name}`);
            
            if (client.metrics?.recordCommand) {
                client.metrics.recordCommand('affiliate', interaction.user.id);
            }
            
        } catch (error) {
            console.error('❌ Erreur dans affiliate:', error);
            
            const errorMessage = {
                content: `❌ Une erreur est survenue lors de l'affiliation: ${error.message}`
            };

            try {
                if (interaction.deferred) {
                    await interaction.editReply(errorMessage);
                } else {
                    await interaction.reply({ ...errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                console.error('❌ Impossible de répondre à l\'interaction:', replyError);
            }

            if (client.metrics?.recordError) {
                client.metrics.recordError();
            }
        }
    },

    async autocomplete(interaction, client) {
        try {
            const focusedValue = interaction.options.getFocused().toLowerCase();
            const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
            
            // Filtrer les streamers non-affiliés qui correspondent à la saisie
            const nonAffiliatedStreamers = guildStreamers
                .filter(s => (s.status || 'non_affilie') === 'non_affilie')
                .filter(s => 
                    s.twitch_username.toLowerCase().includes(focusedValue) ||
                    (s.display_name && s.display_name.toLowerCase().includes(focusedValue))
                )
                .slice(0, 25);

            const choices = nonAffiliatedStreamers.map(s => ({
                name: `${s.display_name || s.twitch_username} (@${s.twitch_username}) - Non affilié`,
                value: s.twitch_username
            }));

            await interaction.respond(choices);
        } catch (error) {
            console.error('❌ Erreur autocomplétion affiliate:', error);
            await interaction.respond([]);
        }
    }
};