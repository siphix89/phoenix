// ===== CORRECTIONS POUR LA MISE À JOUR DES NOTIFICATIONS =====

// 1️⃣ FIX: Améliorer la détection des streams à mettre à jour
async checkStreamerBatch(streamers) {
  try {
    const usernames = streamers.map(s => s.twitch_username).join('&user_login=');
    
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${usernames}`, {
      headers: {
        'Client-ID': this.config.twitchClientId,
        'Authorization': `Bearer ${this.twitch.accessToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('TOKEN_EXPIRED');
      }
      throw new Error(`API Twitch error: ${response.status}`);
    }

    const data = await response.json();
    const liveStreams = data.data || [];
    
    const currentlyLive = liveStreams.map(stream => stream.user_login.toLowerCase());
    
    // Détecter les NOUVEAUX streams
    const newStreams = liveStreams.filter(stream => {
      const username = stream.user_login.toLowerCase();
      return !this.isStreamAlreadyActive(username);
    });

    // ✅ FIX: Détecter les streams à METTRE À JOUR (présents dans liveStreamers OU notificationManager)
    const updatedStreams = liveStreams.filter(stream => {
      const username = stream.user_login.toLowerCase();
      
      // Vérifier les deux sources
      const inLiveStreamers = this.liveStreamers.has(username);
      const inNotifManager = this.notificationManager && 
                             this.notificationManager.isStreamActive(username);
      
      // C'est un stream à mettre à jour s'il existe quelque part
      return inLiveStreamers || inNotifManager;
    });

    const activeStreams = await this.db.getActiveStreams();
    const previouslyLive = activeStreams.map(s => s.twitch_username.toLowerCase());
    
    const endedStreams = previouslyLive.filter(username => 
      !currentlyLive.includes(username) &&
      streamers.some(s => s.twitch_username === username)
    );

    // Traiter les nouveaux streams
    if (newStreams.length > 0) {
      logger.info(`🆕 ${newStreams.length} NOUVEAU(X) stream(s) détecté(s)`);
      for (const stream of newStreams) {
        logger.info(`   → ${stream.user_name} (${stream.game_name})`);
      }
      
      await Promise.allSettled(
        newStreams.map(stream => this.handleStreamStarted(stream))
      );
    }

    // ✅ FIX: Mettre à jour TOUS les streams existants avec logging détaillé
    if (updatedStreams.length > 0) {
      logger.info(`🔄 ${updatedStreams.length} stream(s) à mettre à jour`);
      
      for (const stream of updatedStreams) {
        logger.info(`   🔄 Mise à jour de ${stream.user_name}:`);
        logger.info(`      - Jeu: ${stream.game_name || 'N/A'}`);
        logger.info(`      - Titre: ${stream.title?.substring(0, 50) || 'N/A'}...`);
        logger.info(`      - Viewers: ${stream.viewer_count || 0}`);
        
        try {
          await this.handleStreamUpdated(stream, false); // ✅ silent = false pour forcer la mise à jour
          logger.info(`   ✅ ${stream.user_name} mis à jour avec succès`);
        } catch (error) {
          logger.error(`   ❌ Erreur mise à jour ${stream.user_name}: ${error.message}`);
        }
      }
    } else {
      logger.info(`ℹ️ Aucun stream actif à mettre à jour`);
    }

    // Traiter les streams terminés
    if (endedStreams.length > 0) {
      logger.info(`⚫ ${endedStreams.length} stream(s) terminé(s)`);
      await Promise.allSettled(
        endedStreams.map(username => this.handleStreamEnded(username))
      );
    }

  } catch (error) {
    logger.error(`❌ Erreur vérification batch: ${error.message}`);
    
    if (error.message === 'TOKEN_EXPIRED' && this.twitch) {
      logger.warn('🔑 Token Twitch expiré, tentative de renouvellement...');
      try {
        await this.twitch.initClient();
        logger.info('✅ Token Twitch renouvelé, retry...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.checkStreamerBatch(streamers);
      } catch (tokenError) {
        logger.error(`❌ Impossible de renouveler le token: ${tokenError.message}`);
        this.twitchFailures++;
      }
    } else {
      this.twitchFailures++;
    }
  }
}

// 2️⃣ FIX: Améliorer handleStreamUpdated avec détection de changements
async handleStreamUpdated(streamData, silent = false) {
  const username = streamData.user_login.toLowerCase();
  
  try {
    // ✅ Récupérer les infos précédentes AVANT la mise à jour
    const liveData = this.liveStreamers.get(username);
    const previousInfo = liveData?.streamInfo;

    // Logger les infos actuelles vs nouvelles
    if (!silent && previousInfo) {
      logger.info(`🔍 Comparaison pour ${username}:`);
      logger.info(`   Ancien: ${previousInfo.game_name} | ${previousInfo.title?.substring(0, 30)}`);
      logger.info(`   Nouveau: ${streamData.game_name} | ${streamData.title?.substring(0, 30)}`);
    }

    // ✅ Mettre à jour dans la DB pour TOUS les serveurs
    const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
    
    await Promise.allSettled(
      allGuilds.map(async ({ guild_id }) => {
        try {
          const streamer = await this.db.getStreamer(guild_id, username);
          if (streamer) {
            await this.db.setStreamActive(guild_id, username, {
              id: streamData.id,
              title: streamData.title || 'Pas de titre',
              game_name: streamData.game_name || 'Pas de catégorie',
              viewer_count: streamData.viewer_count || 0,
              started_at: streamData.started_at
            });
          }
        } catch (error) {
          logger.warn(`⚠️ Erreur mise à jour DB ${username} sur ${guild_id}: ${error.message}`);
        }
      })
    );

    // ✅ Mettre à jour liveStreamers
    if (liveData) {
      liveData.lastUpdate = Date.now();
      liveData.streamInfo = { ...streamData };
      logger.info(`✅ liveStreamers mis à jour pour ${username}`);
    } else {
      logger.warn(`⚠️ ${username} n'est pas dans liveStreamers`);
    }

    // ✅ FIX: Détection améliorée des changements significatifs
    const hasSignificantChange = !previousInfo || 
      previousInfo.game_name !== streamData.game_name ||
      previousInfo.title !== streamData.title ||
      Math.abs((previousInfo.viewer_count || 0) - (streamData.viewer_count || 0)) > 100;

    if (!silent && hasSignificantChange) {
      logger.info(`🔔 Changement significatif détecté pour ${username}, mise à jour des notifications`);
      
      // ✅ Vérifier si le stream est suivi par des serveurs
      const guildsFollowing = await this.db.masterDb.all(
        'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
      );
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const { guild_id } of guildsFollowing) {
        try {
          const streamer = await this.db.getStreamer(guild_id, username);
          
          if (streamer && streamer.notification_enabled) {
            logger.info(`   📤 Mise à jour notification pour ${username} sur ${guild_id}`);
            
            const streamerForNotif = {
              name: streamData.user_name,
              url: `https://twitch.tv/${streamData.user_login}`,
              status: streamer.status === 'affilie' ? 'affilie' : 'non_affilie',
              description: streamer.custom_message || `Streamer ${streamData.user_name}`
            };

            const streamInfoForNotif = {
              title: streamData.title || 'Pas de titre',
              game: streamData.game_name || 'Pas de catégorie',
              viewerCount: streamData.viewer_count || 0,
              thumbnailUrl: streamData.thumbnail_url
                ? streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
                : null
            };

            if (this.notificationManager) {
              try {
                await this.notificationManager.updateLiveNotification(
                  streamerForNotif, 
                  streamInfoForNotif
                );
                updatedCount++;
                logger.info(`   ✅ Notification mise à jour pour ${guild_id}`);
              } catch (notifError) {
                errorCount++;
                logger.error(`   ❌ Erreur mise à jour notification sur ${guild_id}: ${notifError.message}`);
              }
            } else {
              logger.warn(`   ⚠️ NotificationManager non disponible`);
            }
          }
        } catch (error) {
          errorCount++;
          logger.error(`   ❌ Erreur pour ${username} sur ${guild_id}: ${error.message}`);
        }
      }
      
      logger.info(`📊 Mise à jour terminée: ${updatedCount} succès, ${errorCount} erreurs`);
    } else if (!silent) {
      logger.info(`ℹ️ Pas de changement significatif pour ${username}, mise à jour ignorée`);
    }

    const duration = liveData ? Math.floor((Date.now() - liveData.startTime) / 60000) : 'N/A';
    if (!silent) {
      logger.info(`✅ Stream mis à jour: ${streamData.user_name} (${duration}min, ${streamData.viewer_count} viewers)`);
    }

  } catch (error) {
    logger.error(`❌ Erreur mise à jour stream ${username}: ${error.message}`);
    logger.error(error.stack);
  }
}

// 3️⃣ BONUS: Ajouter une commande debug pour vérifier l'état
async debugStreamStatus(username) {
  logger.info(`🔍 DEBUG: État du stream ${username}`);
  
  // Vérifier liveStreamers
  const inLiveStreamers = this.liveStreamers.has(username);
  logger.info(`   - Dans liveStreamers: ${inLiveStreamers}`);
  
  if (inLiveStreamers) {
    const data = this.liveStreamers.get(username);
    logger.info(`   - Infos liveStreamers:`);
    logger.info(`     * Jeu: ${data.streamInfo?.game_name}`);
    logger.info(`     * Titre: ${data.streamInfo?.title}`);
    logger.info(`     * Viewers: ${data.streamInfo?.viewer_count}`);
    logger.info(`     * Dernière màj: ${new Date(data.lastUpdate).toLocaleString()}`);
  }
  
  // Vérifier notificationManager
  if (this.notificationManager) {
    const inNotifManager = this.notificationManager.isStreamActive(username);
    logger.info(`   - Dans NotificationManager: ${inNotifManager}`);
  } else {
    logger.info(`   - NotificationManager: non disponible`);
  }
  
  // Vérifier la DB
  try {
    const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
    let foundInDB = 0;
    
    for (const { guild_id } of allGuilds) {
      const streamer = await this.db.getStreamer(guild_id, username);
      if (streamer && streamer.is_live) {
        foundInDB++;
        logger.info(`   - Trouvé dans DB sur ${guild_id}:`);
        logger.info(`     * Jeu: ${streamer.current_game}`);
        logger.info(`     * Titre: ${streamer.stream_title}`);
      }
    }
    
    logger.info(`   - Dans DB: ${foundInDB} serveur(s)`);
  } catch (error) {
    logger.error(`   - Erreur vérification DB: ${error.message}`);
  }
  
  // Vérifier l'API Twitch en temps réel
  try {
    const response = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${username}`,
      {
        headers: {
          'Client-ID': this.config.twitchClientId,
          'Authorization': `Bearer ${this.twitch.accessToken}`
        }
      }
    );
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      logger.info(`   - État Twitch API: EN LIVE`);
      logger.info(`     * Jeu: ${stream.game_name}`);
      logger.info(`     * Titre: ${stream.title}`);
      logger.info(`     * Viewers: ${stream.viewer_count}`);
    } else {
      logger.info(`   - État Twitch API: HORS LIGNE`);
    }
  } catch (error) {
    logger.error(`   - Erreur vérification Twitch: ${error.message}`);
  }
}

// 4️⃣ BONUS: Forcer la mise à jour manuelle d'un stream
async forceUpdateStream(username) {
  logger.info(`🔄 FORCE: Mise à jour manuelle de ${username}`);
  
  try {
    const response = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${username}`,
      {
        headers: {
          'Client-ID': this.config.twitchClientId,
          'Authorization': `Bearer ${this.twitch.accessToken}`
        }
      }
    );
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      logger.info(`✅ Stream trouvé, mise à jour forcée`);
      
      await this.handleStreamUpdated(stream, false);
      return true;
    } else {
      logger.warn(`⚠️ ${username} n'est pas en live sur Twitch`);
      return false;
    }
  } catch (error) {
    logger.error(`❌ Erreur force update: ${error.message}`);
    return false;
  }
}
