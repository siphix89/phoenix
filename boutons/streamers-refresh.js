const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  async execute(interaction, client) {
    // ✅ CORRECTION: customId format = streamers_refresh_{guildId}_{filter}
    // Index:                         0          1         2        3
    const parts = interaction.customId.split('_');
    
    // parts[0] = 'streamers'
    // parts[1] = 'refresh'
    // parts[2] = guildId
    // parts[3] = filter (peut être undefined si pas de filtre)
    
    const statusFilter = parts[3] === 'all' || !parts[3] ? null : parts[3];

    await interaction.deferUpdate();

    try {
      console.log(`🔄 Actualisation liste streamers pour ${interaction.user.tag} (filtre: ${statusFilter || 'aucun'})`);
      
      const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);

      if (!guildStreamers || guildStreamers.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('📭 Aucun streamer suivi')
          .setDescription('Aucun streamer n\'est suivi sur ce serveur.')
          .setColor(Colors.Orange)
          .setTimestamp();

        const refreshButton = new ButtonBuilder()
          .setCustomId(`streamers_refresh_${interaction.guildId}_${statusFilter || 'all'}`)
          .setLabel('Actualiser')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄');

        return await interaction.editReply({ 
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(refreshButton)]
        });
      }

      // Récupérer les streams actifs
      let liveStreamers = [];
      try {
        const allActiveStreams = await client.db.getActiveStreams();
        liveStreamers = allActiveStreams
          .filter(stream => guildStreamers.some(gs => gs.twitch_username === stream.twitch_username))
          .map(s => s.twitch_username);
      } catch (error) {
        console.warn('⚠️ Erreur récupération streams actifs:', error.message);
      }

      // Enrichir avec les données Twitch
      let streamersWithInfo = [...guildStreamers];
      
      try {
        if (client.twitch?.accessToken && guildStreamers.length > 0) {
          const usernames = guildStreamers.map(s => s.twitch_username).slice(0, 100);
          
          const userResponse = await fetch(
            `https://api.twitch.tv/helix/users?${usernames.map(u => `login=${u}`).join('&')}`,
            {
              headers: {
                'Client-ID': client.config.twitchClientId,
                'Authorization': `Bearer ${client.twitch.accessToken}`
              }
            }
          );

          if (userResponse.ok) {
            const userData = await userResponse.json();
            streamersWithInfo.forEach(streamer => {
              const userInfo = userData.data.find(
                u => u.login.toLowerCase() === streamer.twitch_username.toLowerCase()
              );
              if (userInfo) {
                streamer.display_name = userInfo.display_name;
                streamer.profile_image = userInfo.profile_image_url;
                streamer.description = userInfo.description;
              }
              streamer.is_live = liveStreamers.includes(streamer.twitch_username);
            });
          }
        } else {
          streamersWithInfo.forEach(streamer => {
            streamer.is_live = liveStreamers.includes(streamer.twitch_username);
          });
        }
      } catch (twitchError) {
        console.warn('⚠️ Erreur API Twitch:', twitchError.message);
        streamersWithInfo.forEach(streamer => {
          streamer.is_live = liveStreamers.includes(streamer.twitch_username);
        });
      }

      // Filtrer selon le statut
      let filteredStreamers;
      if (statusFilter === 'live') {
        filteredStreamers = streamersWithInfo.filter(s => s.is_live === true);
      } else if (statusFilter === 'offline') {
        filteredStreamers = streamersWithInfo.filter(s => s.is_live !== true);
      } else if (statusFilter === 'affiliated') {
        filteredStreamers = streamersWithInfo.filter(s => (s.status || 'non_affilie') === 'affilie');
      } else if (statusFilter === 'non-affiliated') {
        filteredStreamers = streamersWithInfo.filter(s => (s.status || 'non_affilie') === 'non_affilie');
      } else {
        filteredStreamers = streamersWithInfo;
      }

      const liveList = filteredStreamers.filter(s => s.is_live === true);
      const offlineList = filteredStreamers.filter(s => s.is_live !== true);

      // Créer l'embed principal
      const mainEmbed = new EmbedBuilder()
        .setTitle('🎮 Liste des streamers')
        .setColor(Colors.Purple)
        .setFooter({ 
          text: `Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} • Aujourd'hui à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        })
        .setTimestamp();

      if (!statusFilter) {
        mainEmbed
          .setDescription(`**Total: ${guildStreamers.length} streamer(s)**\n\n**Liste envoyée en plusieurs messages...**`)
          .addFields(
            { name: '🔴 En Live', value: liveList.length.toString(), inline: true },
            { name: '⚫ Hors Ligne', value: offlineList.length.toString(), inline: true }
          );
      } else {
        let statusText = '';
        let statusEmoji = '';
        switch(statusFilter) {
          case 'live': statusText = 'en live'; statusEmoji = '🔴'; break;
          case 'offline': statusText = 'hors ligne'; statusEmoji = '⚫'; break;
          case 'affiliated': statusText = 'affiliés'; statusEmoji = '⭐'; break;
          case 'non-affiliated': statusText = 'non-affiliés'; statusEmoji = '⚪'; break;
        }
        mainEmbed.setDescription(
          `${statusEmoji} **Streamers ${statusText}: ${filteredStreamers.length}/${guildStreamers.length}**`
        );
      }

      // Recréer le bouton avec le même format
      const refreshButton = new ButtonBuilder()
        .setCustomId(`streamers_refresh_${interaction.guildId}_${statusFilter || 'all'}`)
        .setLabel('Actualiser')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔄');

      const row = new ActionRowBuilder().addComponents(refreshButton);

      // Mettre à jour le message principal
      await interaction.editReply({ 
        embeds: [mainEmbed],
        components: [row]
      });

      // Supprimer les anciens messages de liste (si possible)
      try {
        const messages = await interaction.channel.messages.fetch({ 
          after: interaction.message.id, 
          limit: 10 
        });
        const botMessages = messages.filter(
          msg => msg.author.id === client.user.id && 
          msg.createdTimestamp > interaction.message.createdTimestamp
        );
        
        if (botMessages.size > 0) {
          await interaction.channel.bulkDelete(botMessages).catch(() => {});
        }
      } catch (error) {
        // Ignorer les erreurs de suppression
      }

      // Envoyer les nouvelles listes
      if (liveList.length > 0 && (!statusFilter || statusFilter === 'live')) {
        await sendStreamerList(interaction, liveList, '🔴 Streamers En Live', Colors.Red, true);
      }

      if (offlineList.length > 0 && (!statusFilter || statusFilter === 'offline')) {
        await sendStreamerList(interaction, offlineList, '⚫ Streamers Hors Ligne', Colors.Grey, false);
      }

      console.log(`✅ Liste actualisée avec succès`);
      return true;

    } catch (error) {
      console.error('❌ Erreur actualisation streamers:', error);
      
      try {
        await interaction.followUp({ 
          content: '❌ Erreur lors de l\'actualisation.', 
          ephemeral: true 
        });
      } catch (followUpError) {
        console.error('❌ Impossible d\'envoyer le message d\'erreur');
      }
      
      return true;
    }
  }
};

async function sendStreamerList(interaction, streamers, title, color, isLive) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color);

  let streamersList = '';
  
  for (const streamer of streamers) {
    const displayName = streamer.display_name || streamer.twitch_username;
    const statusIcon = (streamer.status === 'affilie') ? ' ⭐' : '';
    const liveIndicator = isLive ? ' 🔴' : '';
    streamersList += `• [${displayName}](https://twitch.tv/${streamer.twitch_username})${statusIcon}${liveIndicator}\n`;
    
    if (streamer.custom_message) {
      streamersList += `  ↳ *${streamer.custom_message.substring(0, 50)}${streamer.custom_message.length > 50 ? '...' : ''}*\n`;
    }
  }

  if (streamersList.length > 1024) {
    const chunks = [];
    let currentChunk = '';
    const lines = streamersList.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > 1024) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkEmbed = new EmbedBuilder()
        .setTitle(i === 0 ? title : `${title} (suite ${i + 1})`)
        .setColor(color)
        .addFields({
          name: `Liste (partie ${i + 1}/${chunks.length})`,
          value: chunks[i] || 'Aucun streamer',
          inline: false
        });
      
      await interaction.followUp({ embeds: [chunkEmbed] });
    }
  } else {
    embed.addFields({
      name: `Liste (${streamers.length} streamer${streamers.length > 1 ? 's' : ''})`,
      value: streamersList || 'Aucun streamer',
      inline: false
    });

    embed.setDescription(`**${streamers.length} streamer(s)**`);
    await interaction.followUp({ embeds: [embed] });
  }
}