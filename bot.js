async checkStreamersLive() {
  if (!this.isReady()) {
    logger.warn('⚠️ Bot non prêt, vérification ignorée');
    return;
  }

  // Vérifier que le NotificationManager est initialisé
  if (!this.notificationManager) {
    logger.error('❌ NotificationManager non initialisé');
    return;
  }

  logger.info('🔍 Vérification des streamers en live...');

  try {
    const streamers = await this.db.getAllStreamers();

    if (streamers.length === 0) {
      logger.info('📭 Aucun streamer à vérifier');
      return;
    }

    for (const streamer of streamers) {
      try {
        const twitchName = streamer.url.split('/').pop();
        if (!twitchName) {
          logger.warn(`⚠️ URL invalide pour ${streamer.name}: ${streamer.url}`);
          continue;
        }

        const { isLive, streamInfo } = await this.twitch.checkStreamStatus(twitchName);
        const wasLive = this.liveStreamers.has(streamer.name);

        if (isLive && !wasLive) {
          // Streamer vient de passer en live - NOUVELLE notification
          logger.info(`🔴 ${streamer.name} détecté en live`);
          const success = await this.notificationManager.sendLiveNotification(streamer, streamInfo);
          
          if (success) {
            this.liveStreamers.set(streamer.name, true);
          }
          
        } else if (isLive && wasLive) {
          // Streamer toujours en live - METTRE À JOUR la notification existante
          console.log(`🔄 Mise à jour notification pour ${streamer.name}`);
          await this.notificationManager.updateLiveNotification(streamer, streamInfo);
          
        } else if (!isLive && wasLive) {
          // Streamer n'est plus en live - SUPPRIMER la notification
          logger.info(`⚫ ${streamer.name} n'est plus en live`);
          await this.notificationManager.removeLiveNotification(streamer.name);
          this.liveStreamers.delete(streamer.name);
        }
        // Si (!isLive && !wasLive) = rien à faire

        // Petit délai entre les requêtes pour éviter le rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`❌ Erreur vérification ${streamer.name}: ${error.message}`);
        this.metrics.recordError();
      }
    }

    logger.info(`✅ Vérification terminée - ${this.liveStreamers.size} streamers en live`);
  } catch (error) {
    logger.error(`❌ Erreur lors de la vérification globale: ${error.message}`);
    this.metrics.recordError();
  }
}
