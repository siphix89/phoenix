// ===== CORRECTION COMPLÈTE - Partie à remplacer dans bot.js =====

// 1️⃣ AMÉLIORER checkStreamerBatch (lignes ~630-730)
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
      throw new Error(`API Twitch error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const liveStreams = data.data || [];
    
    const currentlyLive = liveStreams.map(stream => stream.user_login.toLowerCase());
    
    const activeStreams = await this.db.getActiveStreams();
    const previouslyLive = activeStreams.map(s => s.twitch_username.toLowerCase());

    // ✅ LOGIQUE CORRIGÉE : Un stream est nouveau UNIQUEMENT s'il n'est nulle part
    const newStreams = [];
    const updatedStreams = [];
    
    for (const stream of liveStreams) {
      const username = stream.user_login.toLowerCase();
      const streamId = `${username}_${stream.id}`;
      
      // Vérifier tous les états possibles
      const inDB = previouslyLive.includes(username);
      const inNotifManager = this.notificationManager?.isStreamActive(username) || false;
      const inMemory = this.liveStreamers.has(username);
      const alreadyProcessed = this.processedStreams.has(streamId);
      
      // ✅ RÈGLE STRICTE : Nouveau stream = AUCUNE trace nulle part
      const isTrulyNew = !inDB && !inNotifManager && !inMemory && !alreadyProcessed;
      
      if (isTrulyNew) {
        newStreams.push(stream);
        logger.info(`🆕 NOUVEAU stream détecté: ${username} (inDB:false, inNotif:false, inMem:false, processed:false)`);
      } else if (inDB || inNotifManager || inMemory) {
        // C'est une mise à jour (stream déjà connu)
        updatedStreams.push(stream);
        
        // Log de debug seulement si incohérence
        if (inDB !== inNotifManager || inDB !== inMemory) {
          logger.warn(`⚠️ Incohérence ${username}: DB=${inDB}, Notif=${inNotifManager}, Mem=${inMemory} → MAJ forcée`);
        }
      }
    }

    const endedStreams = previouslyLive.filter(username => 
      !currentlyLive.includes(username) &&
      streamers.some(s => s.twitch_username === username)
    );

    // Traiter les nouveaux streams
    if (newStreams.length > 0) {
      logger.info(`🔥 ${newStreams.length} nouveau(x) stream(s) à traiter`);
      for (const stream of newStreams) {
        await this.handleStreamStarted(stream);
      }
    }

    // Mettre à jour les streams existants (silencieusement)
    for (const stream of updatedStreams) {
      await this.handleStreamUpdated(stream, true);
    }

    // Terminer les streams
    if (endedStreams.length > 0) {
      logger.info(`⚫ ${endedStreams.length} stream(s) terminé(s)`);
      for (const username of endedStreams) {
        await this.handleStreamEnded(username);
      }
    }

  } catch (error) {
    logger.error(`❌ Erreur vérification batch: ${error.message}`);
    if (error.message.includes('401') && this.twitch) {
      logger.warn('🔑 Token Twitch expiré, tentative de renouvellement...');
      try {
        await this.twitch.initClient();
        logger.info('✅ Token Twitch renouvelé');
      } catch (tokenError) {
        logger.error(`❌ Impossible de renouveler le token: ${tokenError.message}`);
      }
    }
  }
}

// 2️⃣ AMÉLIORER handleStreamStarted (lignes ~730-900)
async handleStreamStarted(streamData) {
  const username = streamData.user_login.toLowerCase();
  const streamId = `${username}_${streamData.id}`;
  
  try {
    // ✅ TRIPLE VÉRIFICATION AVANT TRAITEMENT
    
    // Check 1: Déjà traité récemment ?
    if (this.processedStreams.has(streamId)) {
      logger.info(`⏩ Stream ${username} déjà traité (ID: ${streamId}), IGNORÉ`);
      return;
    }
    
    // Check 2: Actif dans NotificationManager ?
    if (this.notificationManager?.isStreamActive(username)) {
      logger.info(`⏩ Stream ${username} déjà actif dans NotificationManager, IGNORÉ`);
      this.processedStreams.add(streamId); // Marquer pour éviter re-vérification
      return;
    }
    
    // Check 3: Déjà en mémoire ?
    if (this.liveStreamers.has(username)) {
      const existingData = this.liveStreamers.get(username);
      const timeSinceStart = Date.now() - existingData.startTime;
      
      // Si stream démarré il y a moins de 5 minutes, c'est le même
      if (timeSinceStart < 300000) { // 5 min
        logger.info(`⏩ Stream ${username} déjà en mémoire depuis ${Math.floor(timeSinceStart/1000)}s, IGNORÉ`);
        this.processedStreams.add(streamId);
        return;
      } else {
        logger.warn(`⚠️ Stream ${username} en mémoire depuis ${Math.floor(timeSinceStart/60000)}min, considéré comme nouveau`);
      }
    }
    
    logger.info(`🔴 ========== NOUVEAU STREAM CONFIRMÉ: ${streamData.user_name} ==========`);
    
    // ✅ MARQUER COMME TRAITÉ IMMÉDIATEMENT (avant toute action)
    this.processedStreams.add(streamId);
    
    // Nettoyer les anciens IDs traités (garder max 1000)
    if (this.processedStreams.size > 1000) {
      const streamIds = Array.from(this.processedStreams);
      const toRemove = streamIds.slice(0, 500);
      toRemove.forEach(id => this.processedStreams.delete(id));
    }
    
    // ✅ METTRE À JOUR LE TRACKING GLOBAL AVANT NOTIFICATIONS
    this.liveStreamers.set(username, { 
      startTime: Date.now(), 
      lastUpdate: Date.now(),
      streamInfo: { ...streamData },
      streamId: streamData.id
    });
    
    // Récupérer les guilds qui suivent ce streamer
    const guildsFollowing = [];
    const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
    
    for (const { guild_id } of allGuilds) {
      try {
        const streamer = await this.db.getStreamer(guild_id, username);
        if (streamer && streamer.notification_enabled) {
          const config = await this.db.getGuildConfig(guild_id);
          guildsFollowing.push({
            id: guild_id,
            notification_channel_id: config?.notification_channel_id,
            custom_message: streamer.custom_message,
            streamer_data: streamer
          });
          
          // Marquer comme actif dans la DB
          await this.db.setStreamActive(guild_id, username, {
            id: streamData.id,
            title: streamData.title || 'Pas de titre',
            game_name: streamData.game_name || 'Pas de catégorie',
            viewer_count: streamData.viewer_count || 0,
            started_at: streamData.started_at
          });
        }
      } catch (error) {
        logger.warn(`⚠️ Erreur vérification ${username} sur guild ${guild_id}: ${error.message}`);
        continue;
      }
    }

    if (guildsFollowing.length === 0) {
      logger.warn(`⚠️ Aucun serveur ne suit ${username}, nettoyage...`);
      this.processedStreams.delete(streamId);
      this.liveStreamers.delete(username);
      return;
    }

    logger.info(`📢 Préparation notification pour ${guildsFollowing.length} serveur(s)`);

    // ✅ ENVOI DES NOTIFICATIONS via NotificationManager
    const notifiedGuilds = [];
    
    if (this.notificationManager) {
      for (const guildData of guildsFollowing) {
        if (!guildData.notification_channel_id) {
          logger.info(`⏭️ Pas de channel configuré pour ${username} sur ${guildData.id}`);
          continue;
        }
        
        try {
          const streamerForNotif = {
            name: streamData.user_name,
            url: `https://twitch.tv/${streamData.user_login}`,
            status: guildData.streamer_data?.status === 'affilie' ? StreamerStatus.AFFILIE : StreamerStatus.NON_AFFILIE,
            description: guildData.custom_message || `Streamer ${streamData.user_name}`
          };

          const streamInfoForNotif = {
            title: streamData.title || 'Pas de titre',
            game: streamData.game_name || 'Pas de catégorie',
            viewerCount: streamData.viewer_count || 0,
            thumbnailUrl: streamData.thumbnail_url
              ? streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
              : null
          };

          // ✅ Envoyer la notification par serveur
          const success = await this.notificationManager.sendLiveNotificationToGuild(
            guildData.id,
            streamerForNotif, 
            streamInfoForNotif
          );
          
          if (success) {
            notifiedGuilds.push(guildData.id);
            await this.db.markNotificationSent(guildData.id, username);
            logger.info(`✅ Notification envoyée: ${streamData.user_name} → serveur ${guildData.id}`);
          } else {
            logger.warn(`⚠️ Échec notification: ${streamData.user_name} → serveur ${guildData.id}`);
          }
          
          // Délai entre envois pour éviter rate limit
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          logger.error(`❌ Erreur notification ${streamData.user_name} sur ${guildData.id}: ${error.message}`);
        }
      }
    } else {
      logger.error(`❌ NotificationManager non disponible!`);
    }

    logger.info(`📊 Résultat: ${notifiedGuilds.length}/${guildsFollowing.length} serveurs notifiés pour ${streamData.user_name}`);
    
    if (notifiedGuilds.length === 0) {
      logger.warn(`⚠️ Aucune notification envoyée pour ${streamData.user_name}, nettoyage...`);
      this.processedStreams.delete(streamId);
      this.liveStreamers.delete(username);
    }

  } catch (error) {
    logger.error(`❌ ERREUR CRITIQUE handleStreamStarted ${username}: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    // En cas d'erreur, nettoyer pour permettre un retry ultérieur
    this.processedStreams.delete(streamId);
    this.liveStreamers.delete(username);
  }
}

// 3️⃣ AMÉLIORER handleStreamEnded (lignes ~1050-1100)
async handleStreamEnded(username) {
  try {
    logger.info(`⚫ ========== STREAM TERMINÉ: ${username} ==========`);
    
    // ✅ 1. Nettoyer processedStreams (TOUS les IDs liés à ce username)
    let cleanedIds = 0;
    for (const streamId of this.processedStreams) {
      if (streamId.startsWith(`${username}_`)) {
        this.processedStreams.delete(streamId);
        cleanedIds++;
      }
    }
    if (cleanedIds > 0) {
      logger.info(`🧹 ${cleanedIds} ID(s) nettoyé(s) de processedStreams pour ${username}`);
    }
    
    // ✅ 2. Retirer du NotificationManager
    if (this.notificationManager) {
      try {
        await this.notificationManager.removeLiveNotification(username);
        logger.info(`✅ ${username} retiré du NotificationManager`);
      } catch (error) {
        logger.warn(`⚠️ Erreur retrait NotificationManager: ${error.message}`);
      }
    }
    
    // ✅ 3. Marquer inactif dans TOUTES les DB des guilds
    const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
    let updatedGuilds = 0;
    
    for (const { guild_id } of allGuilds) {
      try {
        const streamer = await this.db.getStreamer(guild_id, username);
        if (streamer) {
          await this.db.setStreamInactive(guild_id, username);
          updatedGuilds++;
        }
      } catch (error) {
        continue;
      }
    }
    
    logger.info(`💾 ${updatedGuilds} base(s) de données mise(s) à jour pour ${username}`);
    
    // ✅ 4. Retirer de la mémoire
    this.liveStreamers.delete(username);
    logger.info(`🧠 ${username} retiré de la mémoire`);

  } catch (error) {
    logger.error(`❌ Erreur gestion fin stream ${username}: ${error.message}`);
  }
}

// 4️⃣ AJOUTER COMMANDE DE DEBUG (optionnel mais recommandé)
// À placer dans commands/debug-notifications.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug-notifications')
    .setDescription('[ADMIN] Affiche l\'état du système de notifications'),
  
  async execute(interaction, bot) {
    if (!bot.isAdmin(interaction.member)) {
      return interaction.reply({ 
        content: '❌ Commande réservée aux administrateurs', 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const activeStreams = await bot.db.getActiveStreams();
      const notifManagerStatus = bot.notificationManager ? 
        Array.from(bot.notificationManager.activeStreams?.keys() || []) : 
        [];
      const memoryStreams = Array.from(bot.liveStreamers.keys());
      const processedCount = bot.processedStreams.size;

      let report = '**📊 État du système de notifications**\n\n';
      
      report += `**Base de données:**\n`;
      report += `• Streams actifs: ${activeStreams.length}\n`;
      if (activeStreams.length > 0) {
        report += activeStreams.map(s => `  - ${s.twitch_username}`).join('\n') + '\n';
      }
      report += '\n';
      
      report += `**NotificationManager:**\n`;
      report += `• Streams trackés: ${notifManagerStatus.length}\n`;
      if (notifManagerStatus.length > 0) {
        report += notifManagerStatus.map(s => `  - ${s}`).join('\n') + '\n';
      }
      report += '\n';
      
      report += `**Mémoire (liveStreamers):**\n`;
      report += `• Streams en mémoire: ${memoryStreams.length}\n`;
      if (memoryStreams.length > 0) {
        report += memoryStreams.map(s => `  - ${s}`).join('\n') + '\n';
      }
      report += '\n';
      
      report += `**Processed Streams:**\n`;
      report += `• IDs traités: ${processedCount}\n\n`;
      
      // Détection d'incohérences
      report += `**🔍 Analyse:**\n`;
      const inconsistencies = [];
      
      // Vérifier chaque source
      for (const stream of activeStreams) {
        const inNotif = notifManagerStatus.includes(stream.twitch_username);
        const inMem = memoryStreams.includes(stream.twitch_username);
        
        if (!inNotif || !inMem) {
          inconsistencies.push(`⚠️ ${stream.twitch_username}: DB=✅ Notif=${inNotif?'✅':'❌'} Mem=${inMem?'✅':'❌'}`);
        }
      }
      
      if (inconsistencies.length > 0) {
        report += inconsistencies.join('\n');
      } else {
        report += '✅ Aucune incohérence détectée';
      }

      await interaction.editReply(report);

    } catch (error) {
      await interaction.editReply(`❌ Erreur: ${error.message}`);
    }
  }
};
