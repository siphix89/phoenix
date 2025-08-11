const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dash')
        .setDescription('Accès au dashboard Phoenix Bot')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type de dashboard à afficher')
                .setRequired(false)
                .addChoices(
                    { name: '📊 Dashboard Discord (ici)', value: 'discord' },
                    { name: '🌐 Dashboard Web (navigateur)', value: 'web' }
                )),
    
    async execute(interaction, bot) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({
                content: '❌ Accès refusé : Permissions administrateur requises',
                flags: 64
            });
        }

        const dashboardType = interaction.options.getString('type') || 'discord';

        // Fonction pour obtenir l'URL de base
        function getBaseUrl() {
            return process.env.RENDER_EXTERNAL_URL || 
                   process.env.PUBLIC_URL || 
                   'https://phoenix-1-iy68.onrender.com' ||
                   'http://localhost:3000';
        }

        // Dashboard Web
        if (dashboardType === 'web') {
            try {
                // Générer un token d'authentification sécurisé
                const dashboardServer = require('../dashboard-server.js');
                const token = dashboardServer.generateAuthToken(interaction.user.id, interaction.guild.id);
                
                if (!token) {
                    return interaction.reply({
                        content: '❌ Dashboard web non disponible. Le serveur dashboard n\'est pas démarré.',
                        flags: 64
                    });
                }

                const baseUrl = getBaseUrl();
                const dashboardUrl = `${baseUrl}/dashboard?token=${token}`;
                
                const webEmbed = new EmbedBuilder()
                    .setTitle('🌐 Dashboard Web Phoenix Bot')
                    .setDescription('**Accès sécurisé au dashboard web généré !**')
                    .addFields(
                        { name: '🔗 Lien d\'accès', value: `[**Ouvrir le Dashboard**](${dashboardUrl})`, inline: false },
                        { name: '⏰ Validité', value: '10 minutes', inline: true },
                        { name: '🔒 Sécurité', value: 'Token unique et temporaire', inline: true },
                        { name: '💡 Conseil', value: 'Copiez le lien et ouvrez-le dans votre navigateur', inline: false }
                    )
                    .setColor('#00ff88')
                    .setFooter({ 
                        text: 'Dashboard Web • Phoenix Bot v2.0 • Aujourd\'hui à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                        iconURL: interaction.client.user.displayAvatarURL() 
                    })
                    .setTimestamp();

                return interaction.reply({ 
                    embeds: [webEmbed], 
                    flags: 64 // Ephémère pour la sécurité
                });

            } catch (error) {
                console.error('Erreur génération token dashboard:', error);
                return interaction.reply({
                    content: '❌ Erreur lors de la génération du lien dashboard.',
                    flags: 64
                });
            }
        }

        // Dashboard Discord (version originale)
        const guild = interaction.guild;
        const streamersCount = bot.liveStreamers?.size || 0;
        const totalStreamers = (await bot.db.getAllStreamers()).length;
        
        const botStats = {
            servers: interaction.client.guilds.cache.size,
            users: interaction.client.users.cache.size,
            uptime: Math.floor(interaction.client.uptime / 1000),
            streamers: totalStreamers,
            liveStreamers: streamersCount,
            ping: interaction.client.ws.ping
        };

        const embed = new EmbedBuilder()
            .setTitle('🔥 Phoenix Bot Dashboard')
            .setDescription(`Tableau de bord de **${interaction.client.user.username}**`)
            .addFields(
                { name: '🖥️ Serveurs', value: `${botStats.servers}`, inline: true },
                { name: '👥 Utilisateurs', value: `${botStats.users.toLocaleString()}`, inline: true },
                { name: '🎮 Streamers totaux', value: `${botStats.streamers}`, inline: true },
                { name: '🔴 En live actuellement', value: `${botStats.liveStreamers}`, inline: true },
                { name: '⏱️ Uptime', value: `${Math.floor(botStats.uptime / 3600)}h ${Math.floor((botStats.uptime % 3600) / 60)}m`, inline: true },
                { name: '📡 Ping', value: `${botStats.ping}ms`, inline: true },
                { name: '📊 Ce serveur', value: `${guild.memberCount} membres`, inline: true },
                { name: '🟢 Statut', value: 'En ligne', inline: true }
            )
            .setColor('#667eea')
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setFooter({ 
                text: `Database: ${totalStreamers} streamers • Live: ${streamersCount} • Phoenix Bot v2.0`,
                iconURL: guild.iconURL() 
            })
            .setTimestamp();

        const baseUrl = getBaseUrl();
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
                    .setCustomId('view_streamers'),
                new ButtonBuilder()
                    .setLabel('🌐 Dashboard Web')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${baseUrl}/dashboard`)
            );

        await interaction.reply({ 
            embeds: [embed], 
            components: [buttons],
            flags: 64
        });
    }
};
