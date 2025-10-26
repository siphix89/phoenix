const { SlashCommandBuilder, EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streamers')
    .setDescription('Afficher la liste des streamers suivis sur ce serveur')
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Filtrer par statut')
        .setRequired(false)
        .addChoices(
          { name: '⭐ Affiliés', value: 'affiliated' },
          { name: '⚪ Non-Affiliés', value: 'non-affiliated' },
          { name: '🔴 En Live', value: 'live' },
          { name: '⚫ Hors Ligne', value: 'offline' }
        )),

  async execute(interaction, client) {
    await interaction.deferReply();

    try {
      const statusFilter = interaction.options.getString('status');
      
      const data = await fetchStreamersData(interaction, client, statusFilter);
      
      if (data.empty) {
        return await interaction.editReply({ embeds: [data.embed] });
      }

      // Créer le bouton permanent (géré par ButtonManager dans boutons/streamers-refresh.js)
      const customId = `streamers_refresh_${interaction.guildId}_${statusFilter || 'all'}`;
      const refreshButton = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel('Actualiser')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔄');

      const row = new ActionRowBuilder().addComponents(refreshButton);

      // Envoyer le message principal avec le bouton PERMANENT (pas de collecteur!)
      await interaction.editReply({ 
        embeds: [data.mainEmbed],
        components: [row]
      });

      // Envoyer les listes détaillées
      if (data.liveList.length > 0 && (!statusFilter || statusFilter === 'live')) {
        await sendStreamerList(interaction, data.liveList, '🔴 Streamers En Live', Colors.Red, true);
      }

      if (data.offlineList.length > 0 && (!statusFilter || statusFilter === 'offline')) {
        await sendStreamerList(interaction, data.offlineList, '⚫ Streamers Hors Ligne', Colors.Grey, false);
      }

      if (client.metrics?.recordCommand) {
        client.metrics.recordCommand('streamers', interaction.user.id);
      }

    } catch (error) {
      console.error('❌ Erreur commande streamers:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription('Une erreur s\'est produite lors de l\'affichage des streamers.')
        .setColor(Colors.Red)
        .setFooter({ text: `Serveur: ${interaction.guild.name}` });

      try {
        await interaction.editReply({ embeds: [errorEmbed] });
      } catch (replyError) {
        console.error('❌ Erreur réponse:', replyError);
      }

      if (client.metrics?.recordError) {
        client.metrics.recordError();
      }
    }
  }
};

// Fonction pour récupérer et formater les données
async function fetchStreamersData(interaction, client, statusFilter) {
  console.log(`🔍 Recherche streamers pour le serveur ${interaction.guild.name} (${interaction.guildId})`);
  
  const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
  
  console.log(`📊 ${guildStreamers?.length || 0} streamers trouvés`);

  // 🔍 DEBUG - Afficher les données de chaque streamer
  if (guildStreamers && guildStreamers.length > 0) {
    console.log('🔍 DEBUG - Détails des streamers:');
    guildStreamers.forEach(s => {
      console.log(`  - ${s.twitch_username}: status="${s.status}"`);
    });
  }

  if (!guildStreamers || guildStreamers.length === 0) {
    return { 
      empty: true, 
      embed: new EmbedBuilder()
        .setTitle('📭 Aucun streamer suivi')
        .setDescription('Aucun streamer n\'est suivi sur ce serveur.\n\n💡 Utilisez `/ajouter-streamer` pour commencer à suivre des streamers !')
        .setColor(Colors.Orange)
        .setFooter({ text: `Serveur: ${interaction.guild.name}` })
        .setTimestamp()
    };
  }

  let liveStreamers = [];
  try {
    const allActiveStreams = await client.db.getActiveStreams();
    liveStreamers = allActiveStreams
      .filter(stream => guildStreamers.some(gs => gs.twitch_username === stream.twitch_username))
      .map(s => s.twitch_username);
  } catch (error) {
    console.warn('⚠️ Erreur récupération streams actifs:', error.message);
  }

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

  // ✅ CORRECTION : Utiliser 'status' au lieu de 'is_affiliated'
  let filteredStreamers;
  if (statusFilter === 'live') {
    filteredStreamers = streamersWithInfo.filter(s => s.is_live === true);
  } else if (statusFilter === 'offline') {
    filteredStreamers = streamersWithInfo.filter(s => s.is_live !== true);
  } else if (statusFilter === 'affiliated') {
    // ✅ Utiliser status = 'affilie'
    filteredStreamers = streamersWithInfo.filter(s => (s.status || 'non_affilie') === 'affilie');
    console.log(`🔍 Streamers affiliés filtrés: ${filteredStreamers.length}`);
  } else if (statusFilter === 'non-affiliated') {
    // ✅ Utiliser status = 'non_affilie'
    filteredStreamers = streamersWithInfo.filter(s => (s.status || 'non_affilie') === 'non_affilie');
    console.log(`🔍 Streamers non-affiliés filtrés: ${filteredStreamers.length}`);
  } else {
    filteredStreamers = streamersWithInfo;
  }

  if (filteredStreamers.length === 0 && statusFilter) {
    let statusText = '';
    switch(statusFilter) {
      case 'live': statusText = 'en live'; break;
      case 'offline': statusText = 'hors ligne'; break;
      case 'affiliated': statusText = 'affilié'; break;
      case 'non-affiliated': statusText = 'non-affilié'; break;
    }
    
    return { 
      empty: true,
      embed: new EmbedBuilder()
        .setTitle('📭 Aucun streamer trouvé')
        .setDescription(`Aucun streamer ${statusText} trouvé.\n\n💡 ${guildStreamers.length} streamer(s) suivi(s) au total sur ce serveur.`)
        .setColor(Colors.Orange)
        .setFooter({ text: `Serveur: ${interaction.guild.name}` })
        .setTimestamp()
    };
  }

  const liveList = filteredStreamers.filter(s => s.is_live === true);
  const offlineList = filteredStreamers.filter(s => s.is_live !== true);

  // ✅ Compter les affiliés et non-affiliés pour l'affichage
  const affiliatedCount = guildStreamers.filter(s => (s.status || 'non_affilie') === 'affilie').length;
  const nonAffiliatedCount = guildStreamers.length - affiliatedCount;

  const mainEmbed = new EmbedBuilder()
    .setTitle('🎮 Liste des streamers')
    .setColor(Colors.Purple)
    .setFooter({ 
      text: `Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` 
    })
    .setTimestamp();

  if (!statusFilter) {
    mainEmbed
      .setDescription(`⭐ **Streamers affiliés: ${affiliatedCount}/${guildStreamers.length}**\n\n**Liste envoyée en plusieurs messages...**`)
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

  return {
    empty: false,
    mainEmbed,
    liveList,
    offlineList,
    guildStreamers
  };
}

async function sendStreamerList(interaction, streamers, title, color, isLive) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color);

  let streamersList = '';
  
  for (const streamer of streamers) {
    const displayName = streamer.display_name || streamer.twitch_username;
    // ✅ Utiliser status = 'affilie' au lieu de is_affiliated
    const statusIcon = ((streamer.status || 'non_affilie') === 'affilie') ? ' ⭐' : '';
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