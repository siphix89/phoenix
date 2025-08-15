const { EmbedBuilder, Colors } = require('discord.js');
const { logger, StreamerStatus } = require('../config');

class NotificationManager {
  constructor(bot) {
    this.bot = bot;
    this.activeStreams = new Map(); // Stocker l'état des streams actifs
  }

  async sendLiveNotification(streamer, streamInfo) {
    try {
      console.log('🔍 Début sendLiveNotification pour:', streamer.name);
      
      // Déterminer le channel approprié
      const channelId = streamer.status === StreamerStatus.AFFILIE 
        ? this.bot.config.liveAffilieChannel 
        : this.bot.config.liveNonAffilieChannel;

      console.log('📺 Channel ID sélectionné:', channelId);

      if (!channelId || channelId === 0) {
        console.error(`❌ Channel pour ${streamer.status} non configuré`);
        logger.warn(`⚠️ Channel pour ${streamer.status} non configuré`);
        return false;
      }

      const channel = this.bot.channels.cache.get(channelId.toString());
      
      if (!channel) {
        console.error(`❌ Channel ${channelId} non trouvé dans le cache`);
        logger.error(`❌ Channel ${channelId} non trouvé`);
        return false;
      }

      // Vérifier les permissions
      const permissions = channel.permissionsFor(this.bot.user);
      if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
        console.error('❌ Permissions insuffisantes');
        return false;
      }

      // Créer l'embed de notification
      const embed = this.createStreamEmbed(streamer, streamInfo, false);

      console.log('📤 Tentative d\'envoi du message...');

      // Envoyer la notification
      const message = await channel.send({
        content: `🚨 **${streamer.name}** vient de commencer un stream ! 🎉`,
        embeds: [embed],
      });

      console.log('✅ Message envoyé avec succès, ID:', message.id);

      // Stocker les informations du stream actif
      this.activeStreams.set(streamer.name, {
        messageId: message.id,
        channelId: channelId,
        lastUpdate: Date.now(),
        streamInfo: { ...streamInfo }
      });

      // Aussi stocker dans l'ancien format pour compatibilité
      this.bot.liveMessages.set(streamer.name, message.id);
      this.bot.metrics?.recordNotification();

      logger.info(`✅ Notification live envoyée pour ${streamer.name}`);
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
      const activeStream = this.activeStreams.get(streamerName);
      const messageId = activeStream?.messageId || this.bot.liveMessages.get(streamerName);
      
      if (!messageId) {
        console.log(`⚠️ Aucun message à supprimer pour ${streamerName}`);
        return;
      }

      // Liste des channels à vérifier
      const channels = [
        this.bot.config.liveAffilieChannel,
        this.bot.config.liveNonAffilieChannel,
      ].filter(id => id && id !== 0);

      let messageDeleted = false;

      for (const channelId of channels) {
        try {
          const channel = this.bot.channels.cache.get(channelId.toString());
          if (!channel) continue;

          const message = await channel.messages.fetch(messageId);
          if (message) {
            await message.delete();
            logger.info(`✅ Message live supprimé pour ${streamerName}`);
            messageDeleted = true;
            break;
          }
        } catch (error) {
          // Message déjà supprimé ou non trouvé, continuer
          continue;
        }
      }

      // Nettoyer les caches
      this.activeStreams.delete(streamerName);
      this.bot.liveMessages.delete(streamerName);

      if (!messageDeleted) {
        console.log(`⚠️ Message non trouvé pour suppression: ${streamerName}`);
      }
    } catch (error) {
      logger.error(`❌ Erreur suppression notification pour ${streamerName}: ${error.message}`);
    }
  }

  async updateLiveNotification(streamer, streamInfo) {
    try {
      const activeStream = this.activeStreams.get(streamer.name);
      const messageId = activeStream?.messageId || this.bot.liveMessages.get(streamer.name);
      
      if (!messageId) {
        console.log(`📝 Aucun message existant pour ${streamer.name}, création d'une nouvelle notification`);
        return await this.sendLiveNotification(streamer, streamInfo);
      }

      // Déterminer le channel approprié
      const channelId = streamer.status === StreamerStatus.AFFILIE 
        ? this.bot.config.liveAffilieChannel 
        : this.bot.config.liveNonAffilieChannel;

      if (!channelId || channelId === 0) {
        console.log(`❌ Channel non configuré pour ${streamer.status}`);
        return false;
      }

      const channel = this.bot.channels.cache.get(channelId.toString());
      if (!channel) {
        console.log(`❌ Channel ${channelId} non trouvé`);
        return false;
      }

      try {
        const message = await channel.messages.fetch(messageId);
        
        // Toujours créer l'embed avec les nouvelles données
        const embed = this.createStreamEmbed(streamer, streamInfo, true);

        // Vérifier s'il faut vraiment mettre à jour Discord ou juste les données internes
        const hasSignificantChanges = this.hasSignificantChanges(
          activeStream?.streamInfo, 
          streamInfo
        );

        if (hasSignificantChanges || !activeStream) {
          // Mise à jour complète de Discord
          await message.edit({
            content: `🚨 **${streamer.name}** est toujours en live ! 🎉`,
            embeds: [embed],
          });
          console.log(`✅ Notification mise à jour pour ${streamer.name}`);
          logger.info(`✅ Notification live mise à jour pour ${streamer.name}`);
        } else {
          // Pas de changements significatifs, mais vérifier si mise à jour forcée nécessaire
          const timeSinceUpdate = Date.now() - (activeStream?.lastUpdate || 0);
          if (timeSinceUpdate >= 5 * 60 * 1000) { // 5 minutes
            // Mise à jour forcée après 5 minutes
            await message.edit({
              content: `🚨 **${streamer.name}** est toujours en live ! 🎉`,
              embeds: [embed],
            });
            console.log(`🔄 Mise à jour forcée après 5min pour ${streamer.name}`);
            logger.info(`✅ Notification live mise à jour (forcée) pour ${streamer.name}`);
          } else {
            console.log(`⏭️ Pas de changements significatifs pour ${streamer.name}`);
          }
        }

        // TOUJOURS mettre à jour les informations stockées avec les nouvelles données
        if (activeStream) {
          activeStream.streamInfo = { ...streamInfo };
          activeStream.lastUpdate = Date.now();
        } else {
          this.activeStreams.set(streamer.name, {
            messageId: messageId,
            channelId: channelId,
            lastUpdate: Date.now(),
            streamInfo: { ...streamInfo }
          });
        }

        return true;
      } catch (error) {
        console.log(`⚠️ Message non trouvé pour ${streamer.name}, création d'une nouvelle notification`);
        return await this.sendLiveNotification(streamer, streamInfo);
      }
    } catch (error) {
      logger.error(`❌ Erreur mise à jour notification pour ${streamer.name}: ${error.message}`);
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

    // Ajouter la miniature si disponible
    if (streamInfo.thumbnailUrl) {
      embed.setImage(streamInfo.thumbnailUrl);
    }

    return embed;
  }

  hasSignificantChanges(oldInfo, newInfo) {
    if (!oldInfo || !newInfo) return true;
    
    // Vérifier les changements significatifs
    const titleChanged = (oldInfo.title || '') !== (newInfo.title || '');
    const gameChanged = (oldInfo.game || '') !== (newInfo.game || '');
    const viewerDiff = Math.abs((oldInfo.viewerCount || 0) - (newInfo.viewerCount || 0));
    const significantViewerChange = viewerDiff > 0;
    
    console.log(`📊 Analyse changements ${oldInfo.title || 'stream'}:
      - Titre: "${oldInfo.title}" → "${newInfo.title}" (changé: ${titleChanged})
      - Jeu: "${oldInfo.game}" → "${newInfo.game}" (changé: ${gameChanged})  
      - Viewers: ${oldInfo.viewerCount} → ${newInfo.viewerCount} (diff: ${viewerDiff}, significatif: ${significantViewerChange})`);
    
    return titleChanged || gameChanged || significantViewerChange;
  }

  // Méthode pour nettoyer les streams inactifs (à appeler périodiquement)
  cleanupInactiveStreams() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    for (const [streamerName, streamData] of this.activeStreams.entries()) {
      if (now - streamData.lastUpdate > maxAge) {
        console.log(`🧹 Nettoyage du stream inactif: ${streamerName}`);
        this.activeStreams.delete(streamerName);
      }
    }
  }

  // Méthode pour obtenir l'état d'un stream
  getStreamState(streamerName) {
    return this.activeStreams.get(streamerName);
  }

  // Méthode pour obtenir tous les streams actifs
  getAllActiveStreams() {
    return Array.from(this.activeStreams.entries());
  }
}

module.exports = NotificationManager;
