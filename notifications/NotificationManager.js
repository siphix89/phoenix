// ===== NotificationManager.js =====

const { EmbedBuilder, Colors } = require('discord.js');
const { logger, StreamerStatus } = require('../config');

class NotificationManager {
  constructor(bot) {
    this.bot = bot;
    this.activeStreams = new Map();
    this.processingStreams = new Set();
    this.logger = logger || console;
  }

  isStreamActive(streamerUsername) {
    const username = streamerUsername.toLowerCase();
    const streamData = this.activeStreams.get(username);
    if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
      return false;
    }
    return true;
  }

  getStreamState(streamerUsername) {
    const username = streamerUsername.toLowerCase();
    return this.activeStreams.get(username) || null;
  }

  getStreamData(streamerUsername, guildId) {
    const username = streamerUsername.toLowerCase();
    const streamData = this.activeStreams.get(username);
    if (!streamData || !streamData.guilds) return null;
    return streamData.guilds.get(guildId) || null;
  }

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

  async sendLiveNotificationToGuild(guildId, streamer, streamInfo) {
    const username = streamer.name.toLowerCase();
    try {
      const processingKey = `${username}-${guildId}`;
      if (this.processingStreams.has(processingKey)) {
        this.logger.info(`⏭️ Notification déjà en cours pour ${username} sur ${guildId}`);
        return false;
      }
      this.processingStreams.add(processingKey);

      const existingNotif = this.getStreamData(username, guildId);
      if (existingNotif) {
        this.logger.info(`⏭️ Notification déjà active pour ${username} sur ${guildId}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      const guild = this.bot.guilds.cache.get(guildId);
      if (!guild) {
        this.logger.warn(`⚠️ Guild ${guildId} non trouvée`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      const guildStreamers = await this.bot.db.getGuildStreamers(guildId);
      const streamerData = guildStreamers?.find(s => 
        s.twitch_username.toLowerCase() === username
      );
      
      if (!streamerData || !streamerData.notification_enabled) {
        this.logger.info(`⏭️ ${username} non suivi ou notifications désactivées sur ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      const guildChannels = await this.getGuildChannels(guildId);
      if (!guildChannels) {
        this.logger.warn(`⚠️ Pas de configuration pour ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

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

      const channel = guild.channels.cache.get(channelIdStr);
      if (!channel) {
        this.logger.error(`❌ Channel ${channelIdStr} non trouvé dans ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      const permissions = channel.permissionsFor(this.bot.user);
      if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
        this.logger.error(`❌ Permissions insuffisantes dans ${guild.name}`);
        this.processingStreams.delete(processingKey);
        return false;
      }

      this.logger.info(`📤 Envoi notification pour ${streamer.name} dans ${guild.name} (${channel.name})`);

      const embed = this.createLiveEmbed(streamer, streamInfo, false);
      let content = streamerData.custom_message || `🚨 **${streamer.name}** vient de commencer un stream ! 🎉`;
      content = content
        .replace('{streamer}', streamer.name)
        .replace('{game}', streamInfo.game || 'Pas de catégorie')
        .replace('{title}', streamInfo.title || 'Pas de titre');

      const message = await channel.send({ content, embeds: [embed] });
      this.logger.info(`✅ Notification envoyée dans ${guild.name} (msg: ${message.id})`);

      //  Enregistrer la notification en DB
      try {
        await this.bot.db.recordNotification(
          guildId, 
          username, 
          message.id, 
          channel.id, 
          streamInfo.id || null
        );
        this.logger.info(`✅ Notification enregistrée en DB pour guild ${guildId}`);
      } catch (dbError) {
        this.logger.error(`❌ Erreur enregistrement DB: ${dbError.message}`);
      }

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

      if (!this.bot.liveMessages.has(username)) {
        this.bot.liveMessages.set(username, message.id);
      }

      this.processingStreams.delete(processingKey);
      this.bot.metrics?.recordNotification();
      return true;

    } catch (error) {
      this.logger.error(`❌ Erreur envoi notification ${username} sur ${guildId}:`, error.message);
      this.processingStreams.delete(`${username}-${guildId}`);
      const streamData = this.activeStreams.get(username);
      if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
        this.activeStreams.delete(username);
        this.bot.liveMessages.delete(username);
      }
      return false;
    }
  }

  async sendLiveNotification(streamer, streamInfo) {
    try {
      const username = streamer.name.toLowerCase();
      this.logger.info(`🔍 Début sendLiveNotification pour: ${streamer.name}`);
      
      if (this.isStreamActive(username)) {
        this.logger.warn(`⚠️ Stream déjà actif pour ${username}, notification ignorée`);
        return true;
      }

      let successCount = 0;
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

  async updateLiveNotification(streamer, streamInfo) {
    const username = streamer.name.toLowerCase();
    try {
      const streamData = this.activeStreams.get(username);
      if (!streamData || !streamData.guilds || streamData.guilds.size === 0) {
        this.logger.warn(`⚠️ Aucune notification active à mettre à jour pour ${username}`);
        return false;
      }

      const hasSignificantChanges = this.hasSignificantChanges(streamData.globalStreamInfo, streamInfo);
      const timeSinceUpdate = Date.now() - streamData.lastUpdate;
      
      if (!hasSignificantChanges && timeSinceUpdate < 5 * 60 * 1000) {
        this.logger.info(`⏭️ Pas de changements significatifs pour ${username}`);
        streamData.lastUpdate = Date.now();
        return true;
      }

      this.logger.info(`🔄 Mise à jour de ${streamData.guilds.size} notification(s) pour ${username}`);

      const embed = this.createLiveEmbed(streamer, streamInfo, true);
      const content = `🔴 **${streamer.name}** est toujours en live !`;

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

      if (successCount > 0) {
        streamData.globalStreamInfo = { ...streamInfo };
        streamData.lastUpdate = Date.now();
      }

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

  async removeLiveNotification(streamerUsername, keepAsEnded = false) {
    const username = streamerUsername.toLowerCase();
    try {
      this.logger.info(`🗑️ Suppression notifications pour ${username} (keepAsEnded: ${keepAsEnded})`);
      
      //  Toujours chercher en DB, même si on a des données en RAM
      let streamData = this.activeStreams.get(username);
      let notificationsFromDB = new Map();
      
      try {
        const allGuilds = await this.bot.db.masterDb.all(
          'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
        );
        
        for (const { guild_id } of allGuilds) {
          try {
            const guildDb = this.bot.db.guildDatabases.get(guild_id);
            if (!guildDb) continue;
            
            const notifications = await guildDb.all(
              `SELECT * FROM notifications 
               WHERE twitch_username = ? AND deleted_at IS NULL`,
              [username]
            );
            
            for (const notif of notifications) {
              notificationsFromDB.set(guild_id, {
                messageId: notif.message_id,
                channelId: notif.channel_id,
                timestamp: new Date(notif.sent_at).getTime()
              });
            }
          } catch (guildError) {
            this.logger.error(`❌ Erreur guild ${guild_id}: ${guildError.message}`);
          }
        }
      } catch (dbError) {
        this.logger.error(`❌ Erreur récupération DB: ${dbError.message}`);
      }

      //Fusionner RAM + DB
      const allNotifications = new Map();
      
      // Ajouter les notifications de la RAM
      if (streamData?.guilds) {
        for (const [guildId, notifData] of streamData.guilds) {
          allNotifications.set(guildId, notifData);
        }
      }
      
      // Ajouter les notifications de la DB (qui ne sont pas déjà en RAM)
      for (const [guildId, notifData] of notificationsFromDB) {
        if (!allNotifications.has(guildId)) {
          allNotifications.set(guildId, notifData);
        }
      }

      if (allNotifications.size === 0) {
        this.logger.info(`ℹ️ Aucune notification trouvée pour ${username}`);
        this.activeStreams.delete(username);
        this.bot.liveMessages.delete(username);
        return true;
      }

      this.logger.info(`✅ ${allNotifications.size} notification(s) à supprimer`);
      
      let deletedCount = 0;
      let errorCount = 0;

      // Supprimer toutes les notifications trouvées
      for (const [guildId, notifData] of allNotifications) {
        try {
          const channel = await this.bot.channels.fetch(notifData.channelId).catch(() => null);
          
          if (channel) {
            const message = await channel.messages.fetch(notifData.messageId).catch(() => null);
            
            if (message) {
              if (keepAsEnded) {
                const endEmbed = this.createStreamEndedEmbed(
                  username, 
                  streamData?.globalStreamInfo || {}
                );
                await message.edit({ 
                  content: '⚫ Stream terminé', 
                  embeds: [endEmbed] 
                });
                this.logger.info(`✅ Message édité (terminé) pour ${username} sur guild ${guildId}`);
              } else {
                await message.delete();
                this.logger.info(`✅ Message supprimé pour ${username} sur guild ${guildId}`);
              }
              deletedCount++;
            } else {
              this.logger.warn(`⚠️ Message ${notifData.messageId} introuvable sur guild ${guildId}`);
            }
          } else {
            this.logger.warn(`⚠️ Channel ${notifData.channelId} introuvable sur guild ${guildId}`);
          }
        } catch (error) {
          errorCount++;
          this.logger.error(`❌ Erreur suppression sur guild ${guildId}: ${error.message}`);
        }

        //  Toujours marquer en DB comme supprimée
        try {
          const guildDb = this.bot.db.guildDatabases.get(guildId);
          if (guildDb) {
            await guildDb.run(
              `UPDATE notifications 
               SET deleted_at = datetime('now') 
               WHERE twitch_username = ? AND message_id = ? AND deleted_at IS NULL`,
              [username, notifData.messageId]
            );
            this.logger.info(`✅ Notification marquée supprimée en DB (guild ${guildId})`);
          }
        } catch (dbError) {
          this.logger.error(`❌ Erreur MAJ DB guild ${guildId}: ${dbError.message}`);
        }
      }

      //  Nettoyer la RAM
      this.activeStreams.delete(username);
      this.bot.liveMessages.delete(username);
      
      this.logger.info(
        `🔴 Stream terminé pour ${username}: ${deletedCount} supprimés, ${errorCount} échecs`
      );
      
      return deletedCount > 0 || errorCount === 0;

    } catch (error) {
      this.logger.error(`❌ Erreur suppression notifications ${username}:`, error.message);
      
      // En cas d'erreur, forcer le nettoyage DB
      try {
        await this.forceCleanupNotificationsInDB(username);
      } catch (e) {
        this.logger.error(`❌ Impossible de forcer le nettoyage DB: ${e.message}`);
      }
      
      this.activeStreams.delete(username);
      this.bot.liveMessages.delete(username);
      return false;
    }
  }

  async forceCleanupNotificationsInDB(username) {
    this.logger.info(`🧹 Forçage nettoyage DB pour ${username}...`);
    try {
      const allGuilds = await this.bot.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      let cleanedCount = 0;
      
      for (const { guild_id } of allGuilds) {
        try {
          const guildDb = this.bot.db.guildDatabases.get(guild_id);
          if (!guildDb) continue;
          
          const result = await guildDb.run(
            `UPDATE notifications SET deleted_at = datetime('now') WHERE twitch_username = ? AND deleted_at IS NULL`,
            [username]
          );
          
          if (result.changes > 0) {
            cleanedCount += result.changes;
            this.logger.info(`   ✓ Guild ${guild_id}: ${result.changes} notification(s) nettoyée(s)`);
          }
        } catch (e) {
          this.logger.error(`   ✗ Erreur guild ${guild_id}: ${e.message}`);
        }
      }
      
      this.logger.info(`✅ Nettoyage DB forcé terminé: ${cleanedCount} notification(s) au total`);
      return cleanedCount;
    } catch (error) {
      this.logger.error(`❌ Erreur forçage nettoyage DB: ${error.message}`);
      return 0;
    }
  }

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

  createLiveEmbed(streamer, streamInfo, isUpdate = false) {
    const embed = new EmbedBuilder()
      .setTitle(`🔴 ${streamer.name} est en live !`)
      .setDescription(streamInfo.title || 'Pas de titre')
      .setColor(Colors.Red)
      .setURL(streamer.url)
      .addFields(
        { name: '🎮 Jeu', value: streamInfo.game || 'Pas de catégorie', inline: true },
        { name: '👥 Spectateurs', value: streamInfo.viewerCount?.toString() || '0', inline: true },
        { name: '📊 Statut', value: streamer.status === StreamerStatus.AFFILIE ? '⭐ Affilié' : '🌟 Non-affilié', inline: true }
      )
      .setFooter({
        text: isUpdate ? `📺 ${streamer.description || 'Stream'} • Mis à jour` : `📺 ${streamer.description || 'Stream'}`
      })
      .setTimestamp();

    if (streamInfo.thumbnailUrl) {
      embed.setImage(streamInfo.thumbnailUrl);
    }
    return embed;
  }

  createStreamEndedEmbed(streamerName, streamInfo) {
    const embed = new EmbedBuilder()
      .setTitle(`⚫ ${streamerName} n'est plus en live`)
      .setDescription('Le stream est terminé, merci d\'avoir regardé !')
      .setColor(Colors.Grey)
      .addFields({ name: '📊 Dernier jeu', value: streamInfo?.game || 'Inconnu', inline: true })
      .setTimestamp();
    return embed;
  }

  hasSignificantChanges(oldInfo, newInfo) {
    if (!oldInfo || !newInfo) return true;
    const titleChanged = (oldInfo.title || '') !== (newInfo.title || '');
    const gameChanged = (oldInfo.game || '') !== (newInfo.game || '');
    const viewerDiff = Math.abs((oldInfo.viewerCount || 0) - (newInfo.viewerCount || 0));
    const significantViewerChange = viewerDiff > 10;
    return titleChanged || gameChanged || significantViewerChange;
  }

  cleanupInactiveStreams() {
    const now = Date.now();
    const zombieThreshold = 60 * 60 * 1000;
    let cleanedStreamers = 0;
    
    for (const [username, streamData] of this.activeStreams.entries()) {
      const timeSinceLastUpdate = now - streamData.lastUpdate;
      if (timeSinceLastUpdate > zombieThreshold) {
        this.logger.warn(`🧹 Nettoyage forcé streamer "zombie" (pas de maj depuis 1h): ${username}`);
        this.activeStreams.delete(username);
        this.bot.liveMessages.delete(username);
        cleanedStreamers++;
      }
    }
    
    if (cleanedStreamers > 0) {
      this.logger.info(`🧹 Nettoyage terminé : ${cleanedStreamers} streamers zombies retirés de la RAM.`);
    }
  }

  forceCleanup(streamerUsername) {
    const username = streamerUsername.toLowerCase();
    this.activeStreams.delete(username);
    this.bot.liveMessages.delete(username);
    this.logger.info(`🔧 Nettoyage forcé pour ${username}`);
  }

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

  getDebugStats() {
    return this.getStats();
  }

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
