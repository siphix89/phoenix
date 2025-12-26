// ===== NotificationManager.js - VERSION OPTIMISÉE (Meilleur des 2 versions) =====
const { EmbedBuilder, Colors } = require('discord.js');
const { logger, StreamerStatus } = require('../config');

class NotificationManager {
  constructor(bot) {
    this.bot = bot;
    
    // ✅ Structure unifiée (inspirée V2) avec métadonnées enrichies (inspirée V1)
    // Format: Map<streamerUsername, {
    //   streamStartedAt: timestamp,
    //   lastUpdate: timestamp,
    //   globalStreamInfo: {...},
    //   guilds: Map<guildId, { messageId, channelId, timestamp }>
    // }>
    this.activeStreams = new Map();
    
    // ✅ Protection anti-doublons (V2)
    this.processingStreams = new Set();
    
    this.logger = logger || console;
  }

  /**
   * ✅ OPTIMISÉ: Vérification robuste de l'état du stream
   */
  isStreamActive(streamerUsername) {
    const username = streamerUsername.toLowerCase();
    const streamData = this.activeStreams.get(username);
    
    if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
      return false;
    }
    
    return true;
  }

  /**
   * ✅ NOUVEAU: Récupère toutes les infos d'un stream actif
   */
  getStreamState(streamerUsername) {
    const username = streamerUsername.toLowerCase();
    return this.activeStreams.get(username) || null;
  }

  /**
   * ✅ NOUVEAU: Récupère les infos pour une guild spécifique
   */
  getStreamData(streamerUsername, guildId) {
    const username = streamerUsername.toLowerCase();
    const streamData = this.activeStreams.get(username);
    
    if (!streamData || !streamData.guilds) return null;
    return streamData.guilds.get(guildId) || null;
  }

  /**
   * ✅ OPTIMISÉ: Récupération config guild depuis DB
   */
  async getGuildChannels(guildId) {
    try {
      const guildConfig = await this.bot.db.getGuildConfig(guildId);
      
      if (!guildConfig) {
        this.logger.warn(`⚠️ Configuration non trouvée pour guild ${guildId}`);
        return null;
      }

      return {
        liveAffilieChannel: guildConfig.live_affilie_channel_id || guildConfig.notification_channel_id,
        liveNonAffilieChannel: guildConfig.live_non_affilie_channel_id || guildConfig.notification_channel_id
      };
    } catch (error) {
      this.logger.error(`❌ Erreur récupération config ${guildId}:`, error.message);
      return null;
    }
  }

  /**
   * ✅ OPTIMISÉ: Envoi notification à UNE guild (avec protection anti-doublons V2 + vérifications V1)
   */
  async sendLiveNotificationToGuild(guildId, streamer, streamInfo) {
    const username = streamer.name.toLowerCase();
    
    try {
      // 🔒 Protection anti-doublons (V2)
      const processingKey = `${username}-${guildId}`;
      if (this.processingStreams.has(processingKey)) {
        this.logger.info(`⏭️ Notification déjà en cours pour ${username} sur ${guildId}`);
        return false;
      }
      
      this.processingStreams.add(processingKey);

      // ✅ Vérifier si notification déjà active pour cette guild
      const existingNotif = this.getStreamData(username, guildId);
      if (existingNotif) {
        this.logger.info(`⏭️ Notification déjà active pour ${username} sur ${guildId}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      // ✅ Récupérer la guild Discord
      const guild = this.bot.guilds.cache.get(guildId);
      if (!guild) {
        this.logger.warn(`⚠️ Guild ${guildId} non trouvée`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      // ✅ Vérifier si le streamer est suivi (V1)
      const guildStreamers = await this.bot.db.getGuildStreamers(guildId);
      const streamerData = guildStreamers?.find(s => 
        s.twitch_username.toLowerCase() === username
      );
      
      if (!streamerData || !streamerData.notification_enabled) {
        this.logger.info(`⏭️ ${username} non suivi ou notifications désactivées sur ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      // ✅ Récupérer les channels configurés
      const guildChannels = await this.getGuildChannels(guildId);
      
      if (!guildChannels) {
        this.logger.warn(`⚠️ Pas de configuration pour ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      // ✅ Déterminer le bon channel selon statut
      const isAffilie = streamerData.status === 'affilie' || streamer.status === StreamerStatus.AFFILIE;
      const targetChannelId = isAffilie 
        ? guildChannels.liveAffilieChannel 
        : guildChannels.liveNonAffilieChannel;

      const channelIdStr = String(targetChannelId);
      if (!targetChannelId || channelIdStr === '0' || channelIdStr === '') {
        this.logger.warn(`⚠️ Pas de channel configuré pour ${guild.name} (${isAffilie ? 'affilié' : 'non-affilié'})`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      // ✅ Récupérer le channel Discord
      const channel = guild.channels.cache.get(channelIdStr);
      
      if (!channel) {
        this.logger.error(`❌ Channel ${channelIdStr} non trouvé dans ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      // ✅ Vérifier les permissions
      const permissions = channel.permissionsFor(this.bot.user);
      if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
        this.logger.error(`❌ Permissions insuffisantes dans ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      this.logger.info(`📤 Envoi notification pour ${streamer.name} dans ${guild.name} (${channel.name})`);

      // ✅ Créer l'embed
      const embed = this.createLiveEmbed(streamer, streamInfo, false);
      
      // ✅ Message personnalisé (V2) avec fallback (V1)
      let content = streamerData.custom_message || `🚨 **${streamer.name}** vient de commencer un stream ! 🎉`;
      content = content
        .replace('{streamer}', streamer.name)
        .replace('{game}', streamInfo.game || 'Pas de catégorie')
        .replace('{title}', streamInfo.title || 'Pas de titre');

      // 📤 ENVOI DU MESSAGE
      const message = await channel.send({ content, embeds: [embed] });

      this.logger.info(`✅ Notification envoyée dans ${guild.name} (msg: ${message.id})`);

      // ✅ ENREGISTREMENT dans activeStreams (structure unifiée optimisée)
      if (!this.activeStreams.has(username)) {
        this.activeStreams.set(username, {
          streamStartedAt: Date.now(),
          lastUpdate: Date.now(),
          globalStreamInfo: { ...streamInfo },
          guilds: new Map()
        });
        this.logger.info(`✅ ${streamer.name} marqué comme actif`);
      }
      
      const streamData = this.activeStreams.get(username);
      streamData.guilds.set(guildId, {
        messageId: message.id,
        channelId: channel.id,
        timestamp: Date.now()
      });

      // ✅ Compatibilité avec l'ancien système (V1)
      if (!this.bot.liveMessages.has(username)) {
        this.bot.liveMessages.set(username, message.id);
      }

      this.processingStreams.delete(processingKey);
      this.bot.metrics?.recordNotification();
      
      return true;

    } catch (error) {
      this.logger.error(`❌ Erreur envoi notification ${username} sur ${guildId}:`, error.message);
      this.processingStreams.delete(`${username}-${guildId}`);
      
      // ✅ Nettoyage si aucune guild n'a de notification
      const streamData = this.activeStreams.get(username);
      if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
        this.activeStreams.delete(username);
        this.bot.liveMessages.delete(username);
      }
      
      return false;
    }
  }

  /**
   * ✅ OPTIMISÉ: Envoi notifications à TOUTES les guilds configurées
   */
  async sendLiveNotification(streamer, streamInfo) {
    try {
      const username = streamer.name.toLowerCase();
      
      this.logger.info(`🔍 Début sendLiveNotification pour: ${streamer.name}`);
      
      // ✅ Vérifier si déjà actif
      if (this.isStreamActive(username)) {
        this.logger.warn(`⚠️ Stream déjà actif pour ${username}, notification ignorée`);
        return true;
      }

      let successCount = 0;

      // ✅ Envoyer à toutes les guilds où le bot est présent
      for (const [guildId, guild] of this.bot.guilds.cache) {
        const sent = await this.sendLiveNotificationToGuild(guildId, streamer, streamInfo);
        if (sent) successCount++;
      }

      if (successCount === 0) {
        this.logger.error(`❌ Aucune notification envoyée pour ${username}`);
        return false;
      }

      this.logger.info(`✅ Notifications envoyées pour ${streamer.name} dans ${successCount} serveur(s)`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Erreur sendLiveNotification pour ${streamer.name}:`, error.message);
      this.bot.metrics?.recordError();
      return false;
    }
  }

  /**
   * ✅ OPTIMISÉ: Mise à jour notifications (avec détection changements V1 + Promise.allSettled V2)
   */
  async updateLiveNotification(streamer, streamInfo) {
    const username = streamer.name.toLowerCase();
    
    try {
      const streamData = this.activeStreams.get(username);
      
      if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
        this.logger.warn(`⚠️ Aucune notification active à mettre à jour pour ${username}`);
        return false;
      }

      // ✅ Vérifier si changements significatifs (V1)
      const hasSignificantChanges = this.hasSignificantChanges(
        streamData.globalStreamInfo, 
        streamInfo
      );

      const timeSinceUpdate = Date.now() - streamData.lastUpdate;
      
      if (!hasSignificantChanges && timeSinceUpdate < 5 * 60 * 1000) {
        this.logger.info(`⏭️ Pas de changements significatifs pour ${username}`);
        streamData.lastUpdate = Date.now();
        return true;
      }

      this.logger.info(`🔄 Mise à jour de ${streamData.guilds.size} notification(s) pour ${username}`);

      const embed = this.createLiveEmbed(streamer, streamInfo, true);
      const content = `🔴 **${streamer.name}** est toujours en live !`;

      // ✅ Mise à jour avec Promise.allSettled (V2)
      const updatePromises = Array.from(streamData.guilds.entries()).map(
        async ([guildId, notifData]) => {
          try {
            const channel = await this.bot.channels.fetch(notifData.channelId).catch(() => null);
            if (!channel) {
              this.logger.warn(`⚠️ Channel ${notifData.channelId} non trouvé`);
              streamData.guilds.delete(guildId);
              return false;
            }

            const message = await channel.messages.fetch(notifData.messageId).catch(() => null);
            if (!message) {
              this.logger.warn(`⚠️ Message ${notifData.messageId} non trouvé`);
              streamData.guilds.delete(guildId);
              return false;
            }

            await message.edit({ content, embeds: [embed] });
            
            notifData.timestamp = Date.now();
            this.logger.info(`✅ Notification mise à jour pour ${username} sur ${guildId}`);
            
            return true;

          } catch (error) {
            this.logger.error(`❌ Erreur mise à jour ${username} sur ${guildId}:`, error.message);
            return false;
          }
        }
      );

      const results = await Promise.allSettled(updatePromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;

      // ✅ Mettre à jour les métadonnées globales
      if (successCount > 0) {
        streamData.globalStreamInfo = { ...streamInfo };
        streamData.lastUpdate = Date.now();
      }

      // ✅ Nettoyer si toutes les mises à jour ont échoué
      if (successCount === 0 && streamData.guilds.size === 0) {
        this.logger.warn(`⚠️ Toutes les mises à jour ont échoué, nettoyage de ${username}`);
        this.activeStreams.delete(username);
        this.bot.liveMessages.delete(username);
        return false;
      }

      this.logger.info(`📊 ${successCount}/${streamData.guilds.size} notifications mises à jour pour ${username}`);
      return successCount > 0;

    } catch (error) {
      this.logger.error(`❌ Erreur mise à jour notifications ${username}:`, error.message);
      return false;
    }
  }

  /**
   * ✅ OPTIMISÉ: Suppression notifications avec fallback DB
   * Récupère les notifications depuis la DB si la RAM est vide
   */
  async removeLiveNotification(streamerUsername, keepAsEnded = false) {
    const username = streamerUsername.toLowerCase();
    
    try {
      this.logger.info(`🗑️ Suppression notifications pour ${username} (keepAsEnded: ${keepAsEnded})`);
      
      let streamData = this.activeStreams.get(username);
      
      // ✅ NOUVEAU: Si pas en RAM, récupérer depuis la DB
      if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
        this.logger.warn(`⚠️ Notifications non trouvées en RAM pour ${username}, recherche en DB...`);
        
        try {
          // Récupérer toutes les guilds actives
          const allGuilds = await this.bot.db.masterDb.all(
            'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
          );
          
          // Reconstruire streamData à partir des infos DB
          streamData = {
            guilds: new Map(),
            globalStreamInfo: {}
          };
          
          // Pour chaque guild, vérifier si elle a une notification active pour ce streamer
          for (const { guild_id } of allGuilds) {
            try {
              const guildDb = this.bot.db.guildDatabases.get(guild_id);
              if (!guildDb) continue;
              
              const notifications = await guildDb.all(
                `SELECT * FROM notifications 
                 WHERE twitch_username = ? AND deleted_at IS NULL`,
                [username]
              );
              
              // Si on trouve des notifications actives, les ajouter
              for (const notif of notifications) {
                streamData.guilds.set(guild_id, {
                  messageId: notif.message_id,
                  channelId: notif.channel_id,
                  timestamp: new Date(notif.sent_at).getTime()
                });
              }
            } catch (guildError) {
              this.logger.error(`❌ Erreur récupération notifs guild ${guild_id}: ${guildError.message}`);
            }
          }
          
          // Si toujours aucune notification trouvée
          if (streamData.guilds.size === 0) {
            this.logger.info(`ℹ️ Aucune notification trouvée pour ${username} (ni RAM ni DB)`);
            this.activeStreams.delete(username);
            this.bot.liveMessages.delete(username);
            return true;
          }
          
          this.logger.info(`✅ ${streamData.guilds.size} notification(s) récupérée(s) depuis la DB`);
          
        } catch (dbError) {
          this.logger.error(`❌ Erreur récupération DB: ${dbError.message}`);
          // Nettoyage quand même
          this.activeStreams.delete(username);
          this.bot.liveMessages.delete(username);
          return false;
        }
      }

      let deletedCount = 0;
      let errorCount = 0;

      // ✅ Supprimer ou éditer selon l'option
      for (const [guildId, notifData] of streamData.guilds) {
        try {
          const channel = await this.bot.channels.fetch(notifData.channelId).catch(() => null);
          if (!channel) {
            this.logger.warn(`⚠️ Channel ${notifData.channelId} non trouvé pour guild ${guildId}`);
            
            // Marquer comme supprimé en DB même si channel introuvable
            try {
              const guildDb = this.bot.db.guildDatabases.get(guildId);
              if (guildDb) {
                await guildDb.run(
                  `UPDATE notifications 
                   SET deleted_at = datetime('now') 
                   WHERE twitch_username = ? AND message_id = ?`,
                  [username, notifData.messageId]
                );
              }
            } catch (e) {}
            
            continue;
          }

          const message = await channel.messages.fetch(notifData.messageId).catch(() => null);
          if (!message) {
            this.logger.warn(`⚠️ Message ${notifData.messageId} non trouvé dans ${channel.name}`);
            
            // Marquer comme supprimé en DB
            try {
              const guildDb = this.bot.db.guildDatabases.get(guildId);
              if (guildDb) {
                await guildDb.run(
                  `UPDATE notifications 
                   SET deleted_at = datetime('now') 
                   WHERE twitch_username = ? AND message_id = ?`,
                  [username, notifData.messageId]
                );
              }
            } catch (e) {}
            
            continue;
          }

          if (keepAsEnded) {
            // ✅ OPTION: Éditer pour marquer "terminé"
            const endEmbed = this.createStreamEndedEmbed(username, streamData.globalStreamInfo);
            await message.edit({ 
              content: '⚫ Stream terminé', 
              embeds: [endEmbed] 
            });
            this.logger.info(`✅ Message édité (terminé) pour ${username} dans ${channel.name}`);
          } else {
            // ✅ OPTION: Supprimer complètement
            await message.delete();
            this.logger.info(`✅ Message supprimé pour ${username} dans ${channel.name}`);
          }

          // ✅ Marquer comme supprimé en DB
          try {
            const guildDb = this.bot.db.guildDatabases.get(guildId);
            if (guildDb) {
              await guildDb.run(
                `UPDATE notifications 
                 SET deleted_at = datetime('now') 
                 WHERE twitch_username = ? AND message_id = ?`,
                [username, notifData.messageId]
              );
            }
          } catch (e) {}

          deletedCount++;

        } catch (error) {
          errorCount++;
          this.logger.error(`❌ Erreur suppression ${username} sur guild ${guildId}: ${error.message}`);
        }
      }

      // ✅ NETTOYER tous les caches
      this.activeStreams.delete(username);
      this.bot.liveMessages.delete(username);

      this.logger.info(`🔴 Stream terminé pour ${username}: ${deletedCount} supprimés, ${errorCount} échecs`);
      return deletedCount > 0;

    } catch (error) {
      this.logger.error(`❌ Erreur suppression notifications ${username}:`, error.message);
      
      // ✅ Forcer nettoyage même en cas d'erreur
      this.activeStreams.delete(username);
      this.bot.liveMessages.delete(username);
      
      return false;
    }
  }

  /**
   * ✅ NOUVEAU: Gestion intelligente notifications (envoi OU mise à jour)
   */
  async handleStreamNotification(streamer, streamInfo) {
    try {
      const username = streamer.name.toLowerCase();
      
      if (this.isStreamActive(username)) {
        this.logger.info(`⏩ Stream déjà actif pour ${username}, mise à jour...`);
        return await this.updateLiveNotification(streamer, streamInfo);
      } else {
        this.logger.info(`🆕 Nouveau stream détecté pour ${username}, création notification...`);
        return await this.sendLiveNotification(streamer, streamInfo);
      }
    } catch (error) {
      this.logger.error(`❌ Erreur gestion notification pour ${streamer.name}:`, error.message);
      return false;
    }
  }

  /**
   * ✅ OPTIMISÉ: Création embed live
   */
  createLiveEmbed(streamer, streamInfo, isUpdate = false) {
    const embed = new EmbedBuilder()
      .setTitle(`🔴 ${streamer.name} est en live !`)
      .setDescription(streamInfo.title || 'Pas de titre')
      .setColor(Colors.Red)
      .setURL(streamer.url)
      .addFields(
        {
          name: '🎮 Jeu',
          value: streamInfo.game || 'Pas de catégorie',
          inline: true,
        },
        {
          name: '👥 Spectateurs',
          value: streamInfo.viewerCount?.toString() || '0',
          inline: true,
        },
        {
          name: '📊 Statut',
          value: streamer.status === StreamerStatus.AFFILIE ? '⭐ Affilié' : '🌟 Non-affilié',
          inline: true,
        }
      )
      .setFooter({
        text: isUpdate 
          ? `📺 ${streamer.description || 'Stream'} • Mis à jour`
          : `📺 ${streamer.description || 'Stream'}`,
      })
      .setTimestamp();

    if (streamInfo.thumbnailUrl) {
      embed.setImage(streamInfo.thumbnailUrl);
    }

    return embed;
  }

  /**
   * ✅ NOUVEAU: Embed de fin de stream (V2)
   */
  createStreamEndedEmbed(streamerName, streamInfo) {
    const embed = new EmbedBuilder()
      .setTitle(`⚫ ${streamerName} n'est plus en live`)
      .setDescription('Le stream est terminé, merci d\'avoir regardé !')
      .setColor(Colors.Grey)
      .addFields(
        { 
          name: '📊 Dernier jeu', 
          value: streamInfo?.game || 'Inconnu', 
          inline: true 
        }
      )
      .setTimestamp();

    return embed;
  }

  /**
   * ✅ OPTIMISÉ: Détection changements significatifs (V1)
   */
  hasSignificantChanges(oldInfo, newInfo) {
    if (!oldInfo || !newInfo) return true;
    
    const titleChanged = (oldInfo.title || '') !== (newInfo.title || '');
    const gameChanged = (oldInfo.game || '') !== (newInfo.game || '');
    const viewerDiff = Math.abs((oldInfo.viewerCount || 0) - (newInfo.viewerCount || 0));
    const significantViewerChange = viewerDiff > 10;
    
    return titleChanged || gameChanged || significantViewerChange;
  }

  /**
   * ✅ OPTIMISÉ: Nettoyage streams inactifs (V1 + V2)
   */
  cleanupInactiveStreams() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    let cleanedStreamers = 0;
    let cleanedNotifications = 0;
    
    for (const [username, streamData] of this.activeStreams.entries()) {
      // Nettoyer les guilds inactives individuellement
      for (const [guildId, notifData] of streamData.guilds.entries()) {
        if (now - notifData.timestamp > maxAge) {
          this.logger.info(`🧹 Nettoyage notification obsolète: ${username} sur ${guildId}`);
          streamData.guilds.delete(guildId);
          cleanedNotifications++;
        }
      }

      // Si plus aucune guild, supprimer le streamer complètement
      if (streamData.guilds.size === 0) {
        const age = Math.floor((now - streamData.lastUpdate) / 60000);
        this.logger.info(`🧹 Nettoyage streamer inactif: ${username} (${age}min)`);
        
        this.activeStreams.delete(username);
        this.bot.liveMessages.delete(username);
        cleanedStreamers++;
      }
    }
    
    if (cleanedStreamers > 0 || cleanedNotifications > 0) {
      this.logger.info(`🧹 Nettoyage: ${cleanedStreamers} streamer(s), ${cleanedNotifications} notification(s)`);
    }
  }

  /**
   * ✅ NOUVEAU: Force nettoyage d'un streamer spécifique (V1)
   */
  forceCleanup(streamerUsername) {
    const username = streamerUsername.toLowerCase();
    this.activeStreams.delete(username);
    this.bot.liveMessages.delete(username);
    this.logger.info(`🔧 Nettoyage forcé pour ${username}`);
  }

  /**
   * ✅ OPTIMISÉ: Statistiques complètes (V1 + V2)
   */
  getStats() {
    const stats = {
      activeStreamers: this.activeStreams.size,
      totalNotifications: 0,
      notificationsByStreamer: {},
      streamDetails: []
    };

    for (const [username, streamData] of this.activeStreams.entries()) {
      const notifCount = streamData.guilds.size;
      stats.totalNotifications += notifCount;
      stats.notificationsByStreamer[username] = notifCount;

      const age = Math.floor((Date.now() - streamData.streamStartedAt) / 1000 / 60);
      const lastUpdateAge = Math.floor((Date.now() - streamData.lastUpdate) / 1000);
      
      stats.streamDetails.push({
        name: username,
        ageMinutes: age,
        lastUpdateSeconds: lastUpdateAge,
        viewers: streamData.globalStreamInfo?.viewerCount || 0,
        game: streamData.globalStreamInfo?.game || 'N/A',
        guilds: notifCount
      });
    }

    return stats;
  }

  /**
   * ✅ OPTIMISÉ: Debug stats détaillées (V1)
   */
  getDebugStats() {
    return this.getStats();
  }

  /**
   * ✅ NOUVEAU: Affichage console des notifications actives (V2)
   */
  logActiveNotifications() {
    if (this.activeStreams.size === 0) {
      this.logger.info('📭 Aucune notification active');
      return;
    }

    this.logger.info(`📊 Notifications actives (${this.activeStreams.size} streamers):`);
    
    for (const [username, streamData] of this.activeStreams.entries()) {
      const age = Math.floor((Date.now() - streamData.streamStartedAt) / 60000);
      this.logger.info(`   🔴 ${username}: ${streamData.guilds.size} guild(s) - ${age}min`);
      
      for (const [guildId, notifData] of streamData.guilds.entries()) {
        const notifAge = Math.floor((Date.now() - notifData.timestamp) / 60000);
        this.logger.info(`      └─ Guild ${guildId}: msg ${notifData.messageId} (${notifAge}min)`);
      }
    }
  }

  /**
   * ✅ NOUVEAU: Récupère tous les streams actifs (V1)
   */
  getAllActiveStreams() {
    return Array.from(this.activeStreams.entries()).map(([username, data]) => ({
      username,
      streamStartedAt: data.streamStartedAt,
      lastUpdate: data.lastUpdate,
      streamInfo: data.globalStreamInfo,
      guildCount: data.guilds.size
    }));
  }
}

module.exports = NotificationManager;
