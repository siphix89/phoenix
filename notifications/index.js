const { EmbedBuilder, Colors } = require('discord.js');
const { logger, StreamerStatus } = require('../config');

async function sendLiveNotification(bot, streamer, streamInfo) {
  try {
    console.log('🔍 Début sendLiveNotification pour:', streamer.name);
    console.log('📊 Statut streamer:', streamer.status);
    
    // Déterminer le channel approprié
    const channelId = streamer.status === StreamerStatus.AFFILIE 
      ? bot.config.liveAffilieChannel 
      : bot.config.liveNonAffilieChannel;

    console.log('📺 Channel ID sélectionné:', channelId);

    if (!channelId || channelId === 0) {
      console.error(`❌ Channel pour ${streamer.status} non configuré`);
      logger.warn(`⚠️ Channel pour ${streamer.status} non configuré`);
      return;
    }

    const channel = bot.channels.cache.get(channelId.toString());
    console.log('🎯 Channel trouvé:', channel ? 'OUI' : 'NON');
    
    if (!channel) {
      console.error(`❌ Channel ${channelId} non trouvé dans le cache`);
      console.log('📋 Channels disponibles:', bot.channels.cache.map(c => `${c.id} (${c.name})`));
      logger.error(`❌ Channel ${channelId} non trouvé`);
      return;
    }

    // Vérifier les permissions
    const permissions = channel.permissionsFor(bot.user);
    console.log('🔐 Permissions du bot:', {
      sendMessages: permissions?.has('SendMessages'),
      embedLinks: permissions?.has('EmbedLinks'),
      viewChannel: permissions?.has('ViewChannel')
    });

    // Créer l'embed de notification
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
        text: `📺 ${streamer.description}`,
      })
      .setTimestamp();

    // Ajouter la miniature si disponible
    if (streamInfo.thumbnailUrl) {
      console.log('🖼️ Ajout de la miniature:', streamInfo.thumbnailUrl);
      embed.setImage(streamInfo.thumbnailUrl);
    }

    console.log('📤 Tentative d\'envoi du message...');

    // Envoyer la notification
    const message = await channel.send({
      content: `🚨 **${streamer.name}** vient de commencer un stream ! 🎉`,
      embeds: [embed],
    });

    console.log('✅ Message envoyé avec succès, ID:', message.id);

    // Stocker le message pour pouvoir le supprimer plus tard
    bot.liveMessages.set(streamer.name, message.id);
    bot.metrics?.recordNotification();

    logger.info(`✅ Notification live envoyée pour ${streamer.name}`);
  } catch (error) {
    console.error('❌ ERREUR COMPLÈTE:', error);
    console.error('📍 Stack trace:', error.stack);
    logger.error(`❌ Erreur envoi notification pour ${streamer.name}: ${error.message}`);
    bot.metrics?.recordError();
  }
}

async function removeLiveNotification(bot, streamerName) {
  try {
    const messageId = bot.liveMessages.get(streamerName);
    if (!messageId) return;

    // Trouver le message dans les channels appropriés
    const channels = [
      bot.config.liveAffilieChannel,
      bot.config.liveNonAffilieChannel,
    ].filter(id => id && id !== 0);

    for (const channelId of channels) {
      try {
        const channel = bot.channels.cache.get(channelId.toString());
        if (!channel) continue;

        const message = await channel.messages.fetch(messageId);
        if (message) {
          await message.delete();
          logger.info(`✅ Message live supprimé pour ${streamerName}`);
          break;
        }
      } catch (error) {
        // Message déjà supprimé ou non trouvé, continuer
        continue;
      }
    }

    bot.liveMessages.delete(streamerName);
  } catch (error) {
    logger.error(`❌ Erreur suppression notification pour ${streamerName}: ${error.message}`);
  }
}

async function updateLiveNotification(bot, streamer, streamInfo) {
  try {
    const messageId = bot.liveMessages.get(streamer.name);
    if (!messageId) {
      // Si pas de message existant, créer une nouvelle notification
      await sendLiveNotification(bot, streamer, streamInfo);
      return;
    }

    // Déterminer le channel approprié
    const channelId = streamer.status === StreamerStatus.AFFILIE 
      ? bot.config.liveAffilieChannel 
      : bot.config.liveNonAffilieChannel;

    if (!channelId || channelId === 0) return;

    const channel = bot.channels.cache.get(channelId.toString());
    if (!channel) return;

    try {
      const message = await channel.messages.fetch(messageId);
      
      // Mettre à jour l'embed
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
          text: `📺 ${streamer.description} • Mis à jour`,
        })
        .setTimestamp();

      if (streamInfo.thumbnailUrl) {
        embed.setImage(streamInfo.thumbnailUrl);
      }

      await message.edit({
        content: `🚨 **${streamer.name}** est toujours en live ! 🎉`,
        embeds: [embed],
      });

      logger.info(`✅ Notification live mise à jour pour ${streamer.name}`);
    } catch (error) {
      // Message non trouvé, créer une nouvelle notification
      await sendLiveNotification(bot, streamer, streamInfo);
    }
  } catch (error) {
    logger.error(`❌ Erreur mise à jour notification pour ${streamer.name}: ${error.message}`);
  }
}

module.exports = {
  sendLiveNotification,
  removeLiveNotification,
  updateLiveNotification,
};