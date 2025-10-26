const { SlashCommandBuilder, EmbedBuilder, Colors, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Configurer le channel pour les notifications de streams')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel où envoyer les notifications (par défaut: channel actuel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)),

    async execute(interaction, client) {
        try {
            if (!interaction.member.permissions.has('ManageChannels')) {
                return await interaction.reply({
                    content: '❌ Vous devez avoir la permission "Gérer les channels" pour utiliser cette commande.',
                    flags: 64
                });
            }

            await interaction.deferReply();

            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

            if (targetChannel.type !== ChannelType.GuildText) {
                return await interaction.editReply({
                    content: '❌ Les notifications ne peuvent être configurées que dans un channel texte.'
                });
            }

            const botPermissions = targetChannel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions.has(['SendMessages', 'EmbedLinks', 'ViewChannel'])) {
                return await interaction.editReply({
                    content: `❌ Je n'ai pas les permissions nécessaires dans ${targetChannel.toString()}.\n` +
                           'Permissions requises: Voir le channel, Envoyer des messages, Intégrer des liens.'
                });
            }

            // Récupérer l'ancien channel configuré (s'il existe)
            const guildConfig = await client.db.getGuild(interaction.guildId);
            const oldChannelId = guildConfig?.notification_channel_id;

            // Configurer le nouveau channel
            await client.db.setNotificationChannel(interaction.guildId, targetChannel.id);

            // Récupérer les statistiques
            const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
            const allActiveStreams = await client.db.getActiveStreams();
            const guildActiveStreams = allActiveStreams.filter(stream => 
                guildStreamers.some(gs => gs.twitch_username === stream.twitch_username)
            );

            // Créer l'embed de confirmation
            const embed = new EmbedBuilder()
                .setTitle('✅ Channel de notifications configuré !')
                .setDescription(`Les notifications de streams seront envoyées dans ${targetChannel.toString()}`)
                .setColor(Colors.Green)
                .addFields(
                    {
                        name: '📺 Channel configuré',
                        value: `${targetChannel.toString()} (#${targetChannel.name})`,
                        inline: false
                    },
                    {
                        name: '📊 Sur ce serveur',
                        value: `🎮 **${guildStreamers.length}** streamer(s) suivi(s)\n🔴 **${guildActiveStreams.length}** actuellement en live`,
                        inline: true
                    }
                )
                .setFooter({ 
                    text: `Configuré par ${interaction.user.displayName}`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            // Afficher l'ancien channel si changement
            if (oldChannelId && oldChannelId !== targetChannel.id) {
                try {
                    const oldChannel = await interaction.guild.channels.fetch(oldChannelId);
                    embed.addFields({
                        name: '🔄 Changement',
                        value: `Ancien channel: ${oldChannel.toString()} → Nouveau: ${targetChannel.toString()}`,
                        inline: false
                    });
                } catch (error) {
                    // L'ancien channel n'existe peut-être plus
                    embed.addFields({
                        name: '🔄 Changement',
                        value: `Ancien channel (supprimé) → Nouveau: ${targetChannel.toString()}`,
                        inline: false
                    });
                }
            }

            // Streamers actifs
            if (guildActiveStreams.length > 0) {
                const liveStreamersText = guildActiveStreams
                    .slice(0, 3)
                    .map(stream => `🔴 **${stream.display_name || stream.twitch_username}** - ${stream.viewer_count || 0} viewers`)
                    .join('\n');
                
                embed.addFields({
                    name: '🔴 Actuellement en live',
                    value: liveStreamersText + (guildActiveStreams.length > 3 ? `\n... et ${guildActiveStreams.length - 3} autre(s)` : ''),
                    inline: false
                });
            }

            // Instructions
            if (guildStreamers.length === 0) {
                embed.addFields({
                    name: '💡 Première configuration',
                    value: '🎯 Utilisez `/ajouter-streamer` pour ajouter vos premiers streamers à suivre !\n' +
                           '📋 Les notifications apparaîtront automatiquement ici quand ils passent en live.',
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '💡 Commandes utiles',
                    value: '• `/ajouter-streamer` - Ajouter des streamers\n' +
                           '• `/streamers` - Voir la liste complète\n' +
                           '• `/modifier-description` - Personnaliser les messages',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

            // Message de test dans le nouveau channel (si différent)
            if (targetChannel.id !== interaction.channelId) {
                try {
                    const testEmbed = new EmbedBuilder()
                        .setTitle('🔔 Notifications configurées !')
                        .setDescription('Ce channel recevra désormais les notifications quand vos streamers passent en live.')
                        .setColor(Colors.Blue)
                        .addFields({
                            name: '⚙️ Configuré depuis',
                            value: `${interaction.channel.toString()} par ${interaction.user.toString()}`,
                            inline: false
                        });

                    if (guildStreamers.length > 0) {
                        testEmbed.addFields({
                            name: '📊 Streamers suivis',
                            value: `Vous suivez actuellement **${guildStreamers.length}** streamer(s) sur ce serveur.`,
                            inline: false
                        });
                    }

                    testEmbed.setTimestamp();

                    await targetChannel.send({ embeds: [testEmbed] });
                } catch (error) {
                    console.error('⚠️ Erreur envoi message test:', error);
                }
            }

            console.log(`✅ Channel notifications configuré: ${targetChannel.name} (${targetChannel.id}) sur ${interaction.guild.name} par ${interaction.user.tag}`);
            
            if (client.metrics?.recordCommand) {
                client.metrics.recordCommand('setchannel', interaction.user.id);
            }

        } catch (error) {
            console.error('❌ Erreur dans setchannel:', error);
            
            const errorMessage = {
                content: '❌ Une erreur est survenue lors de la configuration du channel. Veuillez réessayer.',
                flags: 64
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