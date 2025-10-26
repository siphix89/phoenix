const { SlashCommandBuilder, EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unaffiliate')
        .setDescription('Retirer le statut affilié d\'un streamer')
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
            
            if (currentStatus === 'non_affilie') {
                const embed = new EmbedBuilder()
                    .setTitle('ℹ️ Déjà non-affilié')
                    .setDescription(`**${streamer.display_name || streamer.twitch_username}** (@${streamer.twitch_username}) est déjà non-affilié !`)
                    .setColor(Colors.Blue)
                    .setThumbnail(`https://logo.clearbit.com/twitch.tv`)
                    .addFields({
                        name: '📊 Statut actuel',
                        value: '⚪ Non-affilié',
                        inline: true
                    })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }
            
            // Mettre à jour le statut via DatabaseManager
            const result = await client.db.updateStreamerStatus(
                interaction.guildId, 
                username, 
                'non_affilie'
            );
            
            if (!result.success) {
                throw new Error(result.error || 'Échec de la mise à jour');
            }
            
            console.log(`✅ Statut mis à jour pour ${streamer.twitch_username} (ID: ${streamer.id})`);
            
            // Créer l'embed de confirmation
            const embed = new EmbedBuilder()
                .setTitle('✅ Statut affilié retiré !')
                .setDescription(`**${streamer.display_name || streamer.twitch_username}** (@${streamer.twitch_username}) n'est plus affilié.`)
                .setColor(Colors.Orange)
                .setThumbnail(`https://logo.clearbit.com/twitch.tv`)
                .addFields(
                    {
                        name: '👤 Streamer',
                        value: `**${streamer.display_name || streamer.twitch_username}**\n@${streamer.twitch_username}`,
                        inline: true
                    },
                    {
                        name: '📊 Statut',
                        value: `~~Affilié~~ → **⚪ Non-affilié**`,
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

            await interaction.editReply({ embeds: [embed] });
            
            console.log(`✅ ${streamer.twitch_username} retiré des affiliés par ${interaction.user.tag} sur ${interaction.guild.name}`);
            
            if (client.metrics?.recordCommand) {
                client.metrics.recordCommand('unaffiliate', interaction.user.id);
            }
            
        } catch (error) {
            console.error('❌ Erreur dans unaffiliate:', error);
            
            const errorMessage = {
                content: `❌ Une erreur est survenue: ${error.message}`
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
            
            // Filtrer les streamers affiliés qui correspondent à la saisie
            const affiliatedStreamers = guildStreamers
                .filter(s => (s.status || 'non_affilie') === 'affilie')
                .filter(s => 
                    s.twitch_username.toLowerCase().includes(focusedValue) ||
                    (s.display_name && s.display_name.toLowerCase().includes(focusedValue))
                )
                .slice(0, 25);

            const choices = affiliatedStreamers.map(s => ({
                name: `${s.display_name || s.twitch_username} (@${s.twitch_username}) - Affilié`,
                value: s.twitch_username
            }));

            await interaction.respond(choices);
        } catch (error) {
            console.error('❌ Erreur autocomplétion unaffiliate:', error);
            await interaction.respond([]);
        }
    }
};