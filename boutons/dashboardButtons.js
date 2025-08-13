// ========================================
//          Boutons dashboard
// ========================================
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    async handle(interaction, client) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({
                content: '❌ Permissions insuffisantes',
                ephemeral: true
            });
        }

        switch (interaction.customId) {
            case 'refresh_dashboard':
                return await this.handleRefresh(interaction, client);
            case 'bot_settings':
                return await this.handleSettings(interaction, client);
            case 'view_streamers':
                return await this.handleStreamers(interaction, client);
            default:
                return false;
        }
    },

    async handleRefresh(interaction, client) {
        const streamersCount = client.liveStreamers?.size || 0;
        const totalStreamers = (await client.db.getAllStreamers()).length;
        
        const botStats = {
            servers: client.guilds.cache.size,
            users: client.users.cache.size,
            uptime: Math.floor(client.uptime / 1000),
            streamers: totalStreamers,
            liveStreamers: streamersCount,
            ping: client.ws.ping
        };

        const embed = new EmbedBuilder()
            .setTitle('🔥 Phoenix Bot Dashboard (Actualisé)')
            .setDescription(`Tableau de bord de **${client.user.username}**`)
            .addFields(
                { name: '🖥️ Serveurs', value: `${botStats.servers}`, inline: true },
                { name: '👥 Utilisateurs', value: `${botStats.users.toLocaleString()}`, inline: true },
                { name: '🎮 Streamers totaux', value: `${botStats.streamers}`, inline: true },
                { name: '🔴 En live', value: `${botStats.liveStreamers}`, inline: true },
                { name: '⏱️ Uptime', value: `${Math.floor(botStats.uptime / 3600)}h ${Math.floor((botStats.uptime % 3600) / 60)}m`, inline: true },
                { name: '📡 Ping', value: `${botStats.ping}ms`, inline: true }
            )
            .setColor('#00FF00')
            .setThumbnail(client.user.displayAvatarURL())
            .setTimestamp();

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🔄 Actualiser')
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId('refresh_dashboard'),
                new ButtonBuilder()
                    .setLabel('⚙️ Informations système')
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId('bot_settings'),
                new ButtonBuilder()
                    .setLabel('📊 Voir streamers')
                    .setStyle(ButtonStyle.Success)
                    .setCustomId('view_streamers')
            );

        await interaction.update({ 
            embeds: [embed], 
            components: [buttons]
        });
        return true;
    },

    async handleSettings(interaction, client) {
        const settingsEmbed = new EmbedBuilder()
            .setTitle('⚙️ Informations Système - Phoenix Bot')
            .setDescription('Configuration et état actuel du système')
            .addFields(
                { name: '🔧 Version', value: 'Phoenix Bot v2.0.0', inline: true },
                { name: '📅 Démarré', value: `<t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>`, inline: true },
                { name: '💾 Mémoire utilisée', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true },
                { name: '🐧 Plateforme', value: process.platform, inline: true },
                { name: '📡 Latence WebSocket', value: `${client.ws.ping}ms`, inline: true },
                { name: '🔗 Node.js', value: process.version, inline: true }
            )
            .setColor('#FFD700')
            .setTimestamp();

        await interaction.reply({ 
            embeds: [settingsEmbed], 
            ephemeral: true
        });
        return true;
    },

    async handleStreamers(interaction, client) {
        const streamers = await client.db.getAllStreamers();
        
        if (streamers.length === 0) {
            const noStreamersEmbed = new EmbedBuilder()
                .setTitle('📊 Liste des Streamers')
                .setDescription('Aucun streamer enregistré pour le moment.')
                .setColor('#ff6b6b');
                
            await interaction.reply({ 
                embeds: [noStreamersEmbed], 
                ephemeral: true
            });
            return true;
        }

        const liveStreamers = Array.from(client.liveStreamers.keys());
        const streamersText = streamers.slice(0, 10).map(streamer => {
            const isLive = liveStreamers.includes(streamer.name);
            const status = isLive ? '🔴 **LIVE**' : '⚫ Hors ligne';
            return `• **${streamer.name}** - ${status}`;
        }).join('\n');

        const streamersEmbed = new EmbedBuilder()
            .setTitle('📊 Liste des Streamers')
            .setDescription(streamersText)
            .addFields(
                { name: '📈 Statistiques', value: `**${streamers.length}** streamers • **${liveStreamers.length}** en live`, inline: false }
            )
            .setColor('#4ecdc4')
            .setTimestamp();

        await interaction.reply({ 
            embeds: [streamersEmbed], 
            ephemeral: true
        });
        return true;
    }
};