const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug-notifications')
    .setDescription('Diagnostic complet du système de notifications'),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Collecter les informations de debug
    const debug = {
      // État des managers
      twitchManager: !!bot.twitch,
      notificationManager: !!bot.notificationManager,
      
      // Configuration
      autoNotifications: bot.config.autoNotifications,
      twitchClientId: !!bot.config.twitchClientId,
      twitchClientSecret: !!bot.config.twitchClientSecret,
      intervalMinutes: bot.config.notificationIntervalMinutes || 5,
      
      // État du système
      checkInterval: !!bot.checkInterval,
      liveStreamers: bot.liveStreamers.size,
      accessToken: bot.twitch?.accessToken ? 'Présent' : 'Absent',
      tokenExpiry: bot.twitch?.tokenExpiresAt ? new Date(bot.twitch.tokenExpiresAt).toLocaleString() : 'N/A',
      
      // Channels
      affilieChannel: bot.config.liveAffilieChannel || 'Non configuré',
      nonAffilieChannel: bot.config.liveNonAffilieChannel || 'Non configuré',
      
      // Streamers
      totalStreamers: 0
    };

    // Récupérer le nombre de streamers
    try {
      const streamers = await bot.db.getAllStreamers();
      debug.totalStreamers = streamers.length;
    } catch (error) {
      debug.totalStreamers = 'Erreur DB';
    }

    // Vérifier les channels
    let affilieChannelStatus = '❌';
    let nonAffilieChannelStatus = '❌';
    
    if (bot.config.liveAffilieChannel && bot.config.liveAffilieChannel !== 0) {
      const channel = bot.channels.cache.get(bot.config.liveAffilieChannel.toString());
      affilieChannelStatus = channel ? '✅' : '⚠ (Non trouvé)';
    }
    
    if (bot.config.liveNonAffilieChannel && bot.config.liveNonAffilieChannel !== 0) {
      const channel = bot.channels.cache.get(bot.config.liveNonAffilieChannel.toString());
      nonAffilieChannelStatus = channel ? '✅' : '⚠ (Non trouvé)';
    }

    const embed = new EmbedBuilder()
      .setTitle('🔍 Debug Système de Notifications')
      .setDescription('Diagnostic complet de l\'état des notifications')
      .addFields(
        { 
          name: '🔧 Managers', 
          value: `TwitchManager: ${debug.twitchManager ? '✅' : '❌'}\nNotificationManager: ${debug.notificationManager ? '✅' : '❌'}`, 
          inline: true 
        },
        { 
          name: '⚙️ Configuration', 
          value: `Auto Notifications: ${debug.autoNotifications ? '✅' : '❌'}\nIntervalle: ${debug.intervalMinutes} min`, 
          inline: true 
        },
        { 
          name: '🔑 Credentials', 
          value: `Client ID: ${debug.twitchClientId ? '✅' : '❌'}\nClient Secret: ${debug.twitchClientSecret ? '✅' : '❌'}`, 
          inline: true 
        },
        { 
          name: '🔄 État système', 
          value: `Check Interval: ${debug.checkInterval ? '✅' : '❌'}\nAccess Token: ${debug.accessToken}\nToken expire: ${debug.tokenExpiry}`, 
          inline: false 
        },
        { 
          name: '📺 Channels', 
          value: `Affilié: ${affilieChannelStatus} (${debug.affilieChannel})\nNon-Affilié: ${nonAffilieChannelStatus} (${debug.nonAffilieChannel})`, 
          inline: false 
        },
        { 
          name: '📊 Statistiques', 
          value: `Streamers totaux: ${debug.totalStreamers}\nStreamers live: ${debug.liveStreamers}`, 
          inline: true 
        }
      )
      .setColor(debug.checkInterval ? Colors.Green : Colors.Orange)
      .setTimestamp();

    // Ajouter des recommandations
    let recommendations = [];
    if (!debug.twitchManager) recommendations.push('• TwitchManager manquant');
    if (!debug.twitchClientId || !debug.twitchClientSecret) recommendations.push('• Credentials Twitch manquants');
    if (!debug.autoNotifications) recommendations.push('• Auto-notifications désactivées');
    if (!debug.checkInterval) recommendations.push('• Système de vérification inactif');
    if (debug.affilieChannel === 'Non configuré') recommendations.push('• Channel affilié non configuré');
    if (debug.nonAffilieChannel === 'Non configuré') recommendations.push('• Channel non-affilié non configuré');

    if (recommendations.length > 0) {
      embed.addFields({ 
        name: '💡 Recommandations', 
        value: recommendations.join('\n'), 
        inline: false 
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
