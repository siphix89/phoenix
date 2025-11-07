// ✅ VERSION CORRIGÉE de sendLiveNotificationToGuild
// Remplacer dans NotificationManager.js

async sendLiveNotificationToGuild(guildId, streamer, streamInfo) {
  try {
    console.log(`🔍 Envoi notification pour ${streamer.name} sur serveur ${guildId}`);
    
    // ✅ ÉTAPE 1 : MARQUER COMME ACTIF IMMÉDIATEMENT (avant toute vérification)
    // Cela évite les race conditions et les doublons
    if (!this.activeStreams.has(streamer.name)) {
      this.activeStreams.set(streamer.name, {
        lastUpdate: Date.now(),
        streamStartedAt: Date.now(),
        streamInfo: { ...streamInfo }
      });
      console.log(`✅ ${streamer.name} marqué comme actif dans NotificationManager`);
    } else {
      console.log(`⚠️ ${streamer.name} déjà actif dans NotificationManager`);
      // Si déjà actif, vérifier si on doit quand même envoyer pour CE serveur
      const guildMessagesMap = this.guildMessages.get(streamer.name);
      if (guildMessagesMap && guildMessagesMap.has(guildId)) {
        console.log(`⏭️ Message déjà envoyé pour ${streamer.name} sur ${guildId}`);
        return true; // Déjà envoyé sur ce serveur
      }
    }
    
    // ✅ ÉTAPE 2 : Vérifications du serveur
    const guild = this.bot.guilds.cache.get(guildId);
    if (!guild) {
      console.log(`⚠️ Serveur ${guildId} non trouvé`);
      return false;
    }

    // Vérifier si le streamer est suivi dans ce serveur
    const guildStreamers = await this.bot.db.getGuildStreamers(guildId);
    const isFollowed = guildStreamers?.some(s => 
      s.twitch_username.toLowerCase() === streamer.name.toLowerCase()
    );
    
    if (!isFollowed) {
      console.log(`⏭️ ${streamer.name} n'est pas suivi dans ${guild.name}`);
      return false;
    }

    // Récupérer la config du serveur
    const guildChannels = await this.getGuildChannels(guildId);
    
    if (!guildChannels) {
      console.log(`⚠️ Pas de configuration pour ${guild.name}`);
      return false;
    }

    // Déterminer le channel approprié
    const channelId = streamer.status === StreamerStatus.AFFILIE 
      ? guildChannels.liveAffilieChannel 
      : guildChannels.liveNonAffilieChannel;

    if (!channelId || channelId === '0' || channelId === 0) {
      console.log(`⚠️ Pas de channel configuré pour ${guild.name} (${streamer.status})`);
      return false;
    }

    const channel = guild.channels.cache.get(channelId.toString());
    
    if (!channel) {
      console.error(`❌ Channel ${channelId} non trouvé dans ${guild.name}`);
      return false;
    }

    // Vérifier les permissions
    const permissions = channel.permissionsFor(this.bot.user);
    if (!permissions?.has('SendMessages') || !permissions?.has('EmbedLinks')) {
      console.error(`❌ Permissions insuffisantes dans ${guild.name}`);
      return false;
    }

    console.log(`📤 Envoi dans ${guild.name} (channel: ${channel.name})`);

    // ✅ ÉTAPE 3 : Créer et envoyer l'embed
    const embed = this.createStreamEmbed(streamer, streamInfo, false);
    const content = `🚨 **${streamer.name}** vient de commencer un stream ! 🎉`;

    // Envoyer la notification
    const message = await channel.send({
      content,
      embeds: [embed],
    });

    console.log(`✅ Message envoyé dans ${guild.name} (ID: ${message.id})`);

    // ✅ ÉTAPE 4 : Stocker les infos du message POUR CE SERVEUR
    if (!this.guildMessages.has(streamer.name)) {
      this.guildMessages.set(streamer.name, new Map());
    }
    
    this.guildMessages.get(streamer.name).set(guildId, {
      messageId: message.id,
      channelId: channelId
    });

    // Compatibilité avec l'ancien système (premier message)
    if (!this.bot.liveMessages.has(streamer.name)) {
      this.bot.liveMessages.set(streamer.name, message.id);
    }

    this.bot.metrics?.recordNotification();
    return true;
    
  } catch (error) {
    console.error(`❌ Erreur envoi dans ${guildId}:`, error.message);
    console.error(error.stack);
    
    // ✅ IMPORTANT : En cas d'erreur, nettoyer si nécessaire
    // Si c'était le premier serveur et qu'on a échoué, supprimer de activeStreams
    const guildMessagesMap = this.guildMessages.get(streamer.name);
    if (!guildMessagesMap || guildMessagesMap.size === 0) {
      console.log(`🧹 Nettoyage de ${streamer.name} suite à l'échec (aucun serveur notifié)`);
      this.activeStreams.delete(streamer.name);
      this.guildMessages.delete(streamer.name);
    }
    
    return false;
  }
}
