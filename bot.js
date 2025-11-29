// ===== CORRECTIF MINIMAL - À appliquer ligne par ligne =====
// Ne remplacez QUE les parties indiquées !

// ====================================================================
// 1️⃣ DANS handleStreamUpdated (ligne ~1050)
// REMPLACEZ la partie détection de changement par :
// ====================================================================

async handleStreamUpdated(streamData, silent = false) {
  const username = streamData.user_login.toLowerCase();
  
  try {
    // Récupérer les infos précédentes
    const liveData = this.liveStreamers.get(username);
    const previousInfo = liveData?.streamInfo;

    // Mettre à jour dans la DB pour TOUS les serveurs
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
          // Ignorer erreurs individuelles
        }
      })
    );

    // Mettre à jour liveStreamers
    if (liveData) {
      liveData.lastUpdate = Date.now();
      liveData.streamInfo = { ...streamData };
    }

    // ✅ NOUVELLE PARTIE : Détection de changements et mise à jour
    if (!silent) {
      const hasChanged = !previousInfo || 
        previousInfo.game_name !== streamData.game_name ||
        previousInfo.title !== streamData.title;

      if (hasChanged) {
        logger.info(`🔄 Changement détecté pour ${username}, mise à jour des notifications`);
        await this.updateStreamNotifications(username, streamData);
      }
    }

    if (!silent) {
      const duration = liveData ? Math.floor((Date.now() - liveData.startTime) / 60000) : 'N/A';
      logger.info(`🔄 Stream mis à jour: ${streamData.user_name} (${duration}min, ${streamData.viewer_count} viewers)`);
    }

  } catch (error) {
    logger.error(`❌ Erreur mise à jour stream ${username}: ${error.message}`);
  }
}

// ====================================================================
// 2️⃣ DANS updateStreamNotifications (ligne ~1090)
// REMPLACEZ toute la fonction par :
// ====================================================================

async updateStreamNotifications(username, streamData) {
  try {
    const guildsFollowing = await this.db.masterDb.all(
      'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
    );
    
    let updatedCount = 0;
    
    for (const { guild_id } of guildsFollowing) {
      try {
        const streamer = await this.db.getStreamer(guild_id, username);
        
        if (streamer && streamer.notification_enabled) {
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
            await this.notificationManager.updateLiveNotification(
              streamerForNotif, 
              streamInfoForNotif
            );
            updatedCount++;
          }
        }
      } catch (error) {
        logger.warn(`⚠️ Erreur mise à jour notif ${username} sur ${guild_id}: ${error.message}`);
      }
    }
    
    if (updatedCount > 0) {
      logger.info(`✅ ${updatedCount} notification(s) mise(s) à jour pour ${username}`);
    }
  } catch (error) {
    logger.error(`❌ Erreur updateStreamNotifications: ${error.message}`);
  }
}

// ====================================================================
// 3️⃣ DANS checkStreamerBatch (ligne ~920)
// REMPLACEZ la partie "updatedStreams" par :
// ====================================================================

// Trouver cette section dans checkStreamerBatch :
/*
const updatedStreams = liveStreams.filter(stream => {
  const username = stream.user_login.toLowerCase();
  return this.notificationManager && 
         this.notificationManager.isStreamActive(username);
});
*/

// REMPLACEZ par :
const updatedStreams = liveStreams.filter(stream => {
  const username = stream.user_login.toLowerCase();
  
  // Vérifier si le stream existe quelque part
  const inLiveStreamers = this.liveStreamers.has(username);
  const inNotifManager = this.notificationManager && 
                         this.notificationManager.isStreamActive(username);
  
  return inLiveStreamers || inNotifManager;
});

// Et plus bas, REMPLACEZ :
/*
if (updatedStreams.length > 0) {
  logger.info(`🔄 ${updatedStreams.length} stream(s) à mettre à jour`);
  await Promise.allSettled(
    updatedStreams.map(stream => this.handleStreamUpdated(stream, true))
  );
}
*/

// PAR :
if (updatedStreams.length > 0) {
  logger.info(`🔄 ${updatedStreams.length} stream(s) à mettre à jour`);
  await Promise.allSettled(
    updatedStreams.map(stream => this.handleStreamUpdated(stream, false)) // ✅ false pour activer les mises à jour
  );
}

// ====================================================================
// 4️⃣ FONCTION DEBUG OPTIONNELLE (à ajouter à la fin de la classe)
// ====================================================================

async forceCheckStream(username) {
  logger.info(`🔍 Vérification manuelle de ${username}...`);
  
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
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      logger.info(`✅ ${username} est en live:`);
      logger.info(`   - Jeu: ${stream.game_name}`);
      logger.info(`   - Titre: ${stream.title}`);
      logger.info(`   - Viewers: ${stream.viewer_count}`);
      
      // Forcer la mise à jour
      await this.handleStreamUpdated(stream, false);
      return true;
    } else {
      logger.info(`ℹ️ ${username} n'est pas en live`);
      return false;
    }
  } catch (error) {
    logger.error(`❌ Erreur vérification: ${error.message}`);
    return false;
  }
}
