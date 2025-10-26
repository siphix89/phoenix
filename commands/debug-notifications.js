const { SlashCommandBuilder, EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug-notifications')
    .setDescription('🔍 Diagnostic avancé du système de notifications')
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Afficher l\'état complet du système')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear-active-streams')
        .setDescription('⚠️ Vider la table active_streams pour réinitialiser')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('test-streamer')
        .setDescription('🧪 Tester la détection d\'un streamer')
        .addStringOption(option =>
          option
            .setName('username')
            .setDescription('Nom du streamer Twitch')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('force-check')
        .setDescription('🔄 Forcer une vérification immédiate des streams')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, bot) {
    const subcommand = interaction.options.getSubcommand();

    // === STATUS ===
    if (subcommand === 'status') {
      await interaction.deferReply({ ephemeral: true });

      try {
        // Collecter les informations
        const debug = {
          twitchManager: !!bot.twitch,
          notificationManager: !!bot.notificationManager,
          autoNotifications: bot.config.autoNotifications,
          twitchClientId: !!bot.config.twitchClientId,
          twitchClientSecret: !!bot.config.twitchClientSecret,
          intervalMinutes: bot.config.notificationIntervalMinutes || 5,
          checkInterval: !!bot.checkInterval,
          liveStreamers: bot.liveStreamers.size,
          accessToken: bot.twitch?.accessToken ? 'Présent' : 'Absent',
          tokenExpiry: bot.twitch?.tokenExpiresAt ? new Date(bot.twitch.tokenExpiresAt).toLocaleString() : 'N/A',
        };

        // Stats DB
        const allStreamers = await bot.db.getAllStreamers();
        const guildStreamers = await bot.db.getGuildStreamers(interaction.guildId);
        const activeStreamsDB = await bot.db.getActiveStreams(interaction.guildId);
        const guildConfig = await bot.db.getGuildConfig(interaction.guildId);

        // Vérifier les channels configurés
        let channelsInfo = '';
        if (guildConfig.notification_channel_id) {
          const generalChannel = bot.channels.cache.get(guildConfig.notification_channel_id);
          channelsInfo += `📢 **Général**: ${generalChannel ? `✅ ${generalChannel.name}` : '❌ Channel supprimé'}\n`;
        }
        if (guildConfig.live_affilie_channel_id) {
          const affilieChannel = bot.channels.cache.get(guildConfig.live_affilie_channel_id);
          channelsInfo += `⭐ **Affiliés**: ${affilieChannel ? `✅ ${affilieChannel.name}` : '❌ Channel supprimé'}\n`;
        }
        if (guildConfig.live_non_affilie_channel_id) {
          const nonAffilieChannel = bot.channels.cache.get(guildConfig.live_non_affilie_channel_id);
          channelsInfo += `🌟 **Non-affiliés**: ${nonAffilieChannel ? `✅ ${nonAffilieChannel.name}` : '❌ Channel supprimé'}\n`;
        }
        if (!channelsInfo) {
          channelsInfo = '❌ Aucun channel configuré';
        }

        // État NotificationManager
        let notifManagerInfo = '❌ Non disponible';
        if (bot.notificationManager) {
          const notifStats = bot.notificationManager.getDebugStats();
          notifManagerInfo = `✅ Actif\n` +
            `  • Streams actifs: ${notifStats.activeStreamsCount}\n` +
            `  • Streamers: ${notifStats.activeStreamers.join(', ') || 'Aucun'}`;
        }

        // Embed principal
        const embed = new EmbedBuilder()
          .setTitle('🔍 Debug Système de Notifications')
          .setDescription(`Diagnostic pour **${interaction.guild.name}**`)
          .addFields(
            { 
              name: '🔧 Managers', 
              value: `TwitchManager: ${debug.twitchManager ? '✅' : '❌'}\nNotificationManager: ${debug.notificationManager ? '✅' : '❌'}`, 
              inline: true 
            },
            { 
              name: '⚙️ Configuration', 
              value: `Auto Notifs: ${debug.autoNotifications ? '✅' : '❌'}\nIntervalle: ${debug.intervalMinutes} min\nCheck actif: ${debug.checkInterval ? '✅' : '❌'}`, 
              inline: true 
            },
            { 
              name: '🔑 Twitch API', 
              value: `Client ID: ${debug.twitchClientId ? '✅' : '❌'}\nClient Secret: ${debug.twitchClientSecret ? '✅' : '❌'}\nAccess Token: ${debug.accessToken}`, 
              inline: true 
            },
            { 
              name: '📺 Channels configurés', 
              value: channelsInfo, 
              inline: false 
            },
            { 
              name: '📊 Statistiques DB', 
              value: 
                `• Streamers totaux (global): ${allStreamers.length}\n` +
                `• Streamers suivis (ce serveur): ${guildStreamers.length}\n` +
                `• Active_streams (DB ce serveur): ${activeStreamsDB.length}\n` +
                `• LiveStreamers (mémoire bot): ${debug.liveStreamers}`,
              inline: true 
            },
            {
              name: '🔔 NotificationManager',
              value: notifManagerInfo,
              inline: true
            }
          )
          .setColor(debug.checkInterval && debug.notificationManager ? Colors.Green : Colors.Orange)
          .setTimestamp();

        // Détails des active_streams en DB
        if (activeStreamsDB.length > 0) {
          const streamsList = activeStreamsDB.map(s => 
            `• **${s.display_name}** (${s.twitch_username}) - ${s.viewer_count || 0} viewers`
          ).join('\n');
          embed.addFields({
            name: '🗄️ Streams actifs en DB',
            value: streamsList.slice(0, 1000), // Limite Discord
            inline: false
          });
        }

        // Détails des streams dans NotificationManager
        if (bot.notificationManager) {
          const notifStats = bot.notificationManager.getDebugStats();
          if (notifStats.streamDetails.length > 0) {
            const detailsList = notifStats.streamDetails.map(s => 
              `• **${s.name}** - Live depuis ${s.age}, ${s.viewers} viewers, ${s.guilds} serveur(s)`
            ).join('\n');
            embed.addFields({
              name: '💾 Streams dans NotificationManager',
              value: detailsList.slice(0, 1000),
              inline: false
            });
          }
        }

        // Recommandations
        let recommendations = [];
        if (!debug.twitchManager) recommendations.push('• Installer/configurer TwitchManager');
        if (!debug.notificationManager) recommendations.push('• NotificationManager non initialisé');
        if (!debug.twitchClientId || !debug.twitchClientSecret) recommendations.push('• Ajouter credentials Twitch dans .env');
        if (!debug.checkInterval) recommendations.push('• Démarrer les notifications avec /start-notifications');
        if (!guildConfig.notification_channel_id && !guildConfig.live_affilie_channel_id) {
          recommendations.push('• Configurer un channel avec /setchannel ou /set-live-channels');
        }
        if (activeStreamsDB.length > 0 && bot.notificationManager?.activeStreams.size === 0) {
          recommendations.push('• ⚠️ Des streams sont en DB mais pas dans NotificationManager (utilise /debug-notifications clear-active-streams)');
        }

        if (recommendations.length > 0) {
          embed.addFields({ 
            name: '💡 Recommandations', 
            value: recommendations.join('\n'), 
            inline: false 
          });
        } else {
          embed.addFields({
            name: '✅ État',
            value: 'Tout semble OK !',
            inline: false
          });
        }

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Erreur debug status:', error);
        await interaction.editReply({ 
          content: `❌ Erreur: ${error.message}`,
          ephemeral: true 
        });
      }
    }

    // === CLEAR ACTIVE STREAMS ===
    else if (subcommand === 'clear-active-streams') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const db = await bot.db.getGuildDatabase(interaction.guildId);
        const result = await db.run('DELETE FROM active_streams');
        
        // Aussi nettoyer le NotificationManager
        if (bot.notificationManager) {
          const activeStreamers = bot.notificationManager.getAllActiveStreams();
          for (const [streamerName] of activeStreamers) {
            bot.notificationManager.forceCleanup(streamerName);
          }
        }

        // Nettoyer liveStreamers
        bot.liveStreamers.clear();

        const embed = new EmbedBuilder()
          .setTitle('✅ Active Streams nettoyés')
          .setDescription(
            `**${result.changes || 0}** entrée(s) supprimée(s) de la DB\n\n` +
            '🔄 Les nouveaux streams seront détectés au prochain check.\n' +
            '💡 Utilise `/debug-notifications force-check` pour vérifier immédiatement.'
          )
          .setColor(Colors.Green)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Erreur clear active_streams:', error);
        await interaction.editReply({ 
          content: `❌ Erreur: ${error.message}` 
        });
      }
    }

    // === TEST STREAMER ===
    else if (subcommand === 'test-streamer') {
      const username = interaction.options.getString('username').toLowerCase();
      await interaction.deferReply({ ephemeral: true });

      try {
        // Vérifier si le streamer est suivi
        const streamer = await bot.db.getStreamer(interaction.guildId, username);
        
        if (!streamer) {
          return interaction.editReply({
            content: `❌ Le streamer **${username}** n'est pas suivi sur ce serveur.\nUtilise \`/ajouter-streamer\` d'abord.`
          });
        }

        // Checker sur Twitch
        if (!bot.twitch || !bot.twitch.accessToken) {
          return interaction.editReply({
            content: '❌ API Twitch non disponible'
          });
        }

        const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
          headers: {
            'Client-ID': bot.config.twitchClientId,
            'Authorization': `Bearer ${bot.twitch.accessToken}`
          }
        });

        if (!response.ok) {
          throw new Error(`API Twitch: ${response.status}`);
        }

        const data = await response.json();
        const isLive = data.data && data.data.length > 0;

        // État en DB
        const activeStreamDB = await bot.db.getActiveStreams(interaction.guildId);
        const inDB = activeStreamDB.some(s => s.twitch_username === username);

        // État dans NotificationManager
        const inNotifManager = bot.notificationManager?.isStreamActive(username) || false;

        // État dans liveStreamers
        const inLiveStreamers = bot.liveStreamers.has(username);

        const embed = new EmbedBuilder()
          .setTitle(`🧪 Test: ${username}`)
          .addFields(
            {
              name: '📡 API Twitch',
              value: isLive ? `✅ **EN LIVE**\n${data.data[0].viewer_count} viewers\n${data.data[0].game_name}` : '⚫ Hors ligne',
              inline: true
            },
            {
              name: '🗄️ Base de données',
              value: `Suivi: ✅\nActive_streams: ${inDB ? '✅' : '❌'}`,
              inline: true
            },
            {
              name: '💾 Mémoire Bot',
              value: `NotificationManager: ${inNotifManager ? '✅' : '❌'}\nliveStreamers: ${inLiveStreamers ? '✅' : '❌'}`,
              inline: true
            }
          )
          .setColor(isLive ? Colors.Red : Colors.Grey)
          .setTimestamp();

        // Diagnostic
        let diagnostic = [];
        if (isLive && !inDB) {
          diagnostic.push('⚠️ Stream live mais pas en DB → sera détecté comme nouveau');
        }
        if (isLive && inDB && !inNotifManager) {
          diagnostic.push('⚠️ Stream en DB mais pas dans NotificationManager → utilise clear-active-streams');
        }
        if (!isLive && (inDB || inNotifManager)) {
          diagnostic.push('⚠️ Marqué comme live mais ne l\'est plus → sera nettoyé au prochain check');
        }
        if (isLive && inDB && inNotifManager) {
          diagnostic.push('✅ Tout est cohérent, les mises à jour fonctionnent');
        }

        if (diagnostic.length > 0) {
          embed.addFields({
            name: '🔍 Diagnostic',
            value: diagnostic.join('\n'),
            inline: false
          });
        }

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Erreur test streamer:', error);
        await interaction.editReply({ 
          content: `❌ Erreur: ${error.message}` 
        });
      }
    }

    // === FORCE CHECK ===
    else if (subcommand === 'force-check') {
      await interaction.deferReply({ ephemeral: true });

      try {
        await interaction.editReply({ content: '🔄 Vérification en cours...' });
        
        await bot.checkStreamersLive();
        
        const activeStreams = await bot.db.getActiveStreams(interaction.guildId);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Vérification terminée')
          .setDescription(
            `**${activeStreams.length}** stream(s) actif(s) détecté(s) pour ce serveur\n\n` +
            (activeStreams.length > 0 
              ? activeStreams.map(s => `• **${s.display_name}** - ${s.viewer_count || 0} viewers`).join('\n')
              : 'Aucun stream actif'
            )
          )
          .setColor(Colors.Blue)
          .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });

      } catch (error) {
        console.error('Erreur force check:', error);
        await interaction.editReply({ 
          content: `❌ Erreur: ${error.message}` 
        });
      }
    }
  }
};