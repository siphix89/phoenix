const { EmbedBuilder, Colors } = require('discord.js');
const { logger, StreamerStatus } = require('../config');

class NotificationManager {
  constructor(bot) {
    this.bot = bot;
    this.activeStreams = new Map();
    // NOUVEAU: Stocker les messages par serveur
    // Format: Map<streamerName, Map<guildId, {messageId, channelId}>>
    this.guildMessages = new Map();
  }

  /**
   * Vérifie si un streamer est déjà considéré comme en live
   */
  isStreamActive(streamerName) {
    return this.activeStreams.has(streamerName);
  }

  /**
   * Récupère les channels configurés pour un serveur depuis la DB
   */
  async getGuildChannels(guildId) {
    try {
      // Utiliser le DatabaseManager pour récupérer la config du serveur
      const guildConfig = await this.bot.db.getGuildConfig(guildId);
      
      if (!guildConfig) {
        console.log(`⚠️ Aucune configuration trouvée pour le serveur ${guildId}`);
        return null;
      }

      // Priorité: channels spécifiques > channel général
      return {
        liveAffilieChannel: guildConfig.live_affilie_channel_id || guildConfig.notification_channel_id,
        liveNonAffilieChannel: guildConfig.live_non_affilie_channel_id || guildConfig.notification_channel_id
      };
    } catch (error) {
      console.error(`❌ Erreur récupération config pour ${guildId}:`, error.message);
      return null;
    }
  }

  /**
   * Envoie une notification à TOUS les serveurs configurés
   */
  async sendLiveNotification(streamer, streamInfo) {
    try {
      console.log('🔍 Début sendLiveNotification pour:', streamer.name);
      
      if (this.isStreamActive(streamer.name)) {
        console.log(`⚠️ Stream déjà actif pour ${streamer.name}, notification ignorée`);
        return true;
      }

      // Créer l'embed une seule fois
      const embed = this.createStreamEmbed(streamer, streamInfo, false);
      const content = `🚨 **${streamer.name}** vient de commencer un stream ! 🎉`;

      let successCount = 0;
      const guildMessagesMap = new Map();

      // NOUVEAU: Envoyer à TOUS les serveurs où le streamer est suivi
      for (const [guildId, guild] of this.bot.guilds.cache) {
        try {
          // Récupérer les streamers suivis par ce serveur
          const guildStreamers = await this.bot.db.getGuildStreamers(guildId);
          const isFollowed = guildStreamers?.some(s => 
            s.twitch_username.toLowerCase() === streamer.name.toLowerCase()
          );
          
          if (!isFollowed) {
            console.log(`⏭️ ${streamer.name} n'est pas suivi dans ${guild.name}`);
            continue;
          }

          // Récupérer la config du serveur depuis la DB
          const guildChannels = await this.getGuildChannels(guildId);
          
          if (!guildChannels) {
            console.log(`⚠️ Pas de configuration pour ${guild.name}`);
            continue;
          }

          // Déterminer le channel approprié pour ce serveur
          const channelId = streamer.status === StreamerStatus.AFFILIE 
            ? guildChannels.liveAffilieChannel 
            : guildChannels.liveNonAffilieChannel;

          if (!channelId || channelId === '0' || channelId === 0) {
            console.log(`⚠️ Pas de channel configuré pour ${guild.name} (${streamer.status})`);
            continue;
          }

          const channel = guild.channels.cache.get(channelId.toString());
          
          if (!channel) {
            console.error(`❌ Channel ${channelId} non trouvé dans ${guild.name}`);
            continue;
          }

          // Vérifier les permissions
          const permissions = channel.permissionsFor(this.bot.user);
          if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
            console.error(`❌ Permissions insuffisantes dans ${guild.name}`);
            continue;
          }

          console.log(`📤 Envoi dans ${guild.name} (channel: ${channel.name})`);

          // Envoyer la notification dans ce serveur
          const message = await channel.send({
            content,
            embeds: [embed],
          });

          console.log(`✅ Message envoyé dans ${guild.name} (ID: ${message.id})`);

          // Stocker les infos du message pour ce serveur
          guildMessagesMap.set(guildId, {
            messageId: message.id,
            channelId: channelId
          });

          successCount++;
        } catch (error) {
          console.error(`❌ Erreur envoi dans ${guild.name}:`, error.message);
        }
      }

      if (successCount === 0) {
        console.error('❌ Aucune notification envoyée dans aucun serveur');
        return false;
      }

      // Stocker les informations du stream actif
      this.activeStreams.set(streamer.name, {
        lastUpdate: Date.now(),
        streamStartedAt: Date.now(),
        streamInfo: { ...streamInfo }
      });

      // Stocker les messages par serveur
      this.guildMessages.set(streamer.name, guildMessagesMap);

      // Compatibilité avec l'ancien système (garder le premier message)
      const firstMessage = guildMessagesMap.values().next().value;
      if (firstMessage) {
        this.bot.liveMessages.set(streamer.name, firstMessage.messageId);
      }

      this.bot.metrics?.recordNotification();
      logger.info(`✅ Notifications live envoyées pour ${streamer.name} dans ${successCount} serveur(s)`);
      return true;
    } catch (error) {
      console.error('❌ ERREUR COMPLÈTE:', error);
      logger.error(`❌ Erreur envoi notification pour ${streamer.name}: ${error.message}`);
      this.bot.metrics?.recordError();
      return false;
    }
  }

  async removeLiveNotification(streamerName) {
    try {
      const guildMessagesMap = this.guildMessages.get(streamerName);
      
      if (!guildMessagesMap || guildMessagesMap.size === 0) {
        console.log(`⚠️ Aucun message à supprimer pour ${streamerName}`);
        this.activeStreams.delete(streamerName);
        this.bot.liveMessages.delete(streamerName);
        return;
      }

      let deletedCount = 0;

      // Supprimer les messages dans TOUS les serveurs
      for (const [guildId, messageData] of guildMessagesMap) {
        try {
          const guild = this.bot.guilds.cache.get(guildId);
          if (!guild) continue;

          const channel = guild.channels.cache.get(messageData.channelId.toString());
          if (!channel) continue;

          const message = await channel.messages.fetch(messageData.messageId);
          if (message) {
            await message.delete();
            deletedCount++;
            console.log(`✅ Message supprimé dans ${guild.name}`);
          }
        } catch (error) {
          console.log(`⚠️ Impossible de supprimer dans le serveur ${guildId}:`, error.message);
        }
      }

      // Nettoyer les caches
      this.activeStreams.delete(streamerName);
      this.guildMessages.delete(streamerName);
      this.bot.liveMessages.delete(streamerName);

      logger.info(`🔴 Stream terminé pour ${streamerName}, ${deletedCount} message(s) supprimé(s)`);
    } catch (error) {
      logger.error(`❌ Erreur suppression notification pour ${streamerName}: ${error.message}`);
    }
  }

  async updateLiveNotification(streamer, streamInfo) {
    try {
      const activeStream = this.activeStreams.get(streamer.name);
      const guildMessagesMap = this.guildMessages.get(streamer.name);
      
      if (!guildMessagesMap || guildMessagesMap.size === 0) {
        console.log(`📝 Aucun message existant pour ${streamer.name}, création d'une nouvelle notification`);
        return await this.sendLiveNotification(streamer, streamInfo);
      }

      // Vérifier s'il y a eu des changements significatifs
      if (activeStream && !this.hasSignificantChanges(activeStream.streamInfo, streamInfo)) {
        const timeSinceUpdate = Date.now() - activeStream.lastUpdate;
        if (timeSinceUpdate < 5 * 60 * 1000) {
          console.log(`⏭️ Pas de changements significatifs pour ${streamer.name}`);
          activeStream.lastUpdate = Date.now();
          return true;
        }
      }

      // Créer l'embed une seule fois
      const embed = this.createStreamEmbed(streamer, streamInfo, true);
      const content = `🚨 **${streamer.name}** est toujours en live ! 🎉`;

      let updateCount = 0;

      // Mettre à jour les messages dans TOUS les serveurs
      for (const [guildId, messageData] of guildMessagesMap) {
        try {
          const guild = this.bot.guilds.cache.get(guildId);
          if (!guild) continue;

          const channel = guild.channels.cache.get(messageData.channelId.toString());
          if (!channel) continue;

          const message = await channel.messages.fetch(messageData.messageId);
          if (message) {
            await message.edit({
              content,
              embeds: [embed],
            });
            updateCount++;
            console.log(`✅ Message mis à jour dans ${guild.name}`);
          }
        } catch (error) {
          console.log(`⚠️ Impossible de mettre à jour dans ${guildId}:`, error.message);
        }
      }

      if (updateCount === 0) {
        console.log(`⚠️ Aucune mise à jour effectuée, recréation des notifications`);
        this.guildMessages.delete(streamer.name);
        this.activeStreams.delete(streamer.name);
        return await this.sendLiveNotification(streamer, streamInfo);
      }

      // Mettre à jour les informations stockées
      if (activeStream) {
        activeStream.streamInfo = { ...streamInfo };
        activeStream.lastUpdate = Date.now();
      }

      logger.info(`✅ Notification mise à jour pour ${streamer.name} dans ${updateCount} serveur(s)`);
      return true;
    } catch (error) {
      logger.error(`❌ Erreur mise à jour notification pour ${streamer.name}: ${error.message}`);
      return false;
    }
  }

  /**
   * Envoie ou met à jour une notification de stream
   */
  async handleStreamNotification(streamer, streamInfo) {
    try {
      if (this.isStreamActive(streamer.name)) {
        console.log(`⏩ Stream déjà actif pour ${streamer.name}, mise à jour...`);
        return await this.updateLiveNotification(streamer, streamInfo);
      } else {
        console.log(`🆕 Nouveau stream détecté pour ${streamer.name}, création notification...`);
        return await this.sendLiveNotification(streamer, streamInfo);
      }
    } catch (error) {
      logger.error(`❌ Erreur gestion notification pour ${streamer.name}: ${error.message}`);
      return false;
    }
  }

  createStreamEmbed(streamer, streamInfo, isUpdate = false) {
    const embed = new EmbedBuilder()
      .setTitle(`🔴 ${streamer.name} est en live !`)
      .setDescription(streamInfo.title || 'Titre non spécifié')
      .setColor(Colors.Red)
      .setURL(streamer.url)
      .addFields(
        {
          name: '🎮 Jeu',
          value: streamInfo.game || 'Jeu non spécifié',
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
          ? `📺 ${streamer.description} • Mis à jour`
          : `📺 ${streamer.description}`,
      })
      .setTimestamp();

    if (streamInfo.thumbnailUrl) {
      embed.setImage(streamInfo.thumbnailUrl);
    }

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
    const maxAge = 30 * 60 * 1000;
    
    let cleaned = 0;
    for (const [streamerName, streamData] of this.activeStreams.entries()) {
      if (now - streamData.lastUpdate > maxAge) {
        console.log(`🧹 Nettoyage du stream inactif: ${streamerName}`);
        this.activeStreams.delete(streamerName);
        this.guildMessages.delete(streamerName);
        this.bot.liveMessages.delete(streamerName);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`🧹 ${cleaned} stream(s) inactif(s) nettoyé(s)`);
    }
  }

  getStreamState(streamerName) {
    return this.activeStreams.get(streamerName);
  }

  getAllActiveStreams() {
    return Array.from(this.activeStreams.entries());
  }

  forceCleanup(streamerName) {
    this.activeStreams.delete(streamerName);
    this.guildMessages.delete(streamerName);
    this.bot.liveMessages.delete(streamerName);
    logger.info(`🔧 Nettoyage forcé pour ${streamerName}`);
  }

  getDebugStats() {
    const stats = {
      activeStreamsCount: this.activeStreams.size,
      activeStreamers: Array.from(this.activeStreams.keys()),
      streamDetails: [],
      guildsPerStream: {}
    };

    for (const [name, data] of this.activeStreams.entries()) {
      const age = Math.floor((Date.now() - data.streamStartedAt) / 1000 / 60);
      const lastUpdateAge = Math.floor((Date.now() - data.lastUpdate) / 1000);
      
      const guildMessagesMap = this.guildMessages.get(name);
      const guildCount = guildMessagesMap ? guildMessagesMap.size : 0;
      
      stats.streamDetails.push({
        name,
        age: `${age}min`,
        lastUpdate: `${lastUpdateAge}s ago`,
        viewers: data.streamInfo?.viewerCount || 0,
        game: data.streamInfo?.game || 'N/A',
        guilds: guildCount
      });

      stats.guildsPerStream[name] = guildCount;
    }

    return stats;
  }
}

module.exports = NotificationManager;
