// boutons/streamers-pagniation.js

const { EmbedBuilder, Colors } = require('discord.js');
const { StreamerStatus } = require('../config');

const STREAMERS_PER_PAGE = 5;

module.exports = {
  customId: 'streamers_page',
  
  async execute(interaction, bot) {
    await interaction.deferUpdate();

    try {
      // Extraire les informations du customId (format: streamers_page_NUMBER_STATUS)
      const customIdParts = interaction.customId.split('_');
      const pageNumber = parseInt(customIdParts[2]);
      const statusFilter = customIdParts[3] === 'all' ? null : customIdParts[3];

      // Récupérer les streamers
      let allStreamers;
      try {
        allStreamers = await bot.db.getAllStreamers();
      } catch (dbError) {
        bot.logger.error(`❌ Erreur base de données: ${dbError.message}`);
        throw new Error('Erreur de connexion à la base de données');
      }

      // Filtrage des streamers
      let streamers = statusFilter 
        ? allStreamers.filter(s => s.status === statusFilter)
        : allStreamers;

      // Validation de la page demandée
      const totalPages = Math.max(1, Math.ceil(streamers.length / STREAMERS_PER_PAGE));
      const currentPage = Math.min(pageNumber, totalPages);

      // Pagination
      const startIndex = (currentPage - 1) * STREAMERS_PER_PAGE;
      const endIndex = startIndex + STREAMERS_PER_PAGE;
      const paginatedStreamers = streamers.slice(startIndex, endIndex);

      // Reconstruire l'embed
      const embed = this.buildStreamersEmbed(
        paginatedStreamers,
        streamers.length,
        currentPage,
        totalPages,
        statusFilter
      );

      // Recréer les boutons
      const components = totalPages > 1 
        ? [this.createNavigationButtons(currentPage, totalPages, statusFilter)]
        : [];

      await interaction.editReply({
        embeds: [embed],
        components
      });

    } catch (error) {
      bot.logger.error(`❌ Erreur navigation streamers: ${error.message}`, error.stack);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription('Une erreur s\'est produite lors de la navigation.')
        .setColor(Colors.Red);

      await interaction.editReply({ 
        embeds: [errorEmbed],
        components: []
      });
    }
  },

  /**
   * Construit l'embed principal avec la liste des streamers
   */
  buildStreamersEmbed(streamers, totalCount, currentPage, totalPages, statusFilter) {
    const embed = new EmbedBuilder()
      .setTitle('🎮 Liste des streamers')
      .setColor(Colors.Purple)
      .setTimestamp();

    // Séparation par statut
    const affilies = streamers.filter(s => s.status === StreamerStatus.AFFILIE);
    const nonAffilies = streamers.filter(s => s.status === StreamerStatus.NON_AFFILIE);

    // Ajout des sections
    if (affilies.length > 0 && (!statusFilter || statusFilter === 'affilie')) {
      this.addStreamersField(embed, '⭐ Streamers Affiliés', affilies);
    }

    if (nonAffilies.length > 0 && (!statusFilter || statusFilter === 'non_affilie')) {
      this.addStreamersField(embed, '🌟 Streamers Non-Affiliés', nonAffilies);
    }

    // Footer avec informations de pagination
    const footerText = totalPages > 1 
      ? `Page ${currentPage}/${totalPages} • Total: ${totalCount} streamer(s)`
      : `Total: ${totalCount} streamer(s)`;
    
    embed.setFooter({ text: footerText });

    return embed;
  },

  /**
   * Ajoute un field avec une liste de streamers à l'embed
   */
  addStreamersField(embed, title, streamers) {
    const MAX_EMBED_FIELD_LENGTH = 1000;
    const MAX_DESCRIPTION_LENGTH = 200;
    
    let streamersList = '';
    const processedStreamers = [];

    for (const streamer of streamers) {
      // Tronquer la description si elle est trop longue
      let description = streamer.description || '';
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        description = description.substring(0, MAX_DESCRIPTION_LENGTH) + '...';
      }

      const streamerLine = `• [${streamer.name}](${streamer.url})${description ? ` - ${description}` : ''}\n`;
      
      // Vérifier si on dépasse la limite des embeds Discord
      if (streamersList.length + streamerLine.length > MAX_EMBED_FIELD_LENGTH) {
        break;
      }
      
      streamersList += streamerLine;
      processedStreamers.push(streamer);
    }

    // Ajouter une note si tous les streamers n'ont pas pu être affichés
    if (processedStreamers.length < streamers.length) {
      const remaining = streamers.length - processedStreamers.length;
      streamersList += `\n*... et ${remaining} autre(s) streamer(s)*`;
    }

    embed.addFields({
      name: `${title} (${streamers.length})`,
      value: streamersList || 'Aucun streamer dans cette catégorie.',
      inline: false,
    });
  },

  /**
   * Crée les boutons de navigation pour la pagination
   */
  createNavigationButtons(currentPage, totalPages, statusFilter) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder();

    // Bouton première page
    if (currentPage > 2) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streamers_page_1_${statusFilter || 'all'}`)
          .setLabel('⏮️')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // Bouton page précédente
    if (currentPage > 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streamers_page_${currentPage - 1}_${statusFilter || 'all'}`)
          .setLabel('⬅️')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // Indicateur de page
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('streamers_page_indicator')
        .setLabel(`${currentPage} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    // Bouton page suivante
    if (currentPage < totalPages) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streamers_page_${currentPage + 1}_${statusFilter || 'all'}`)
          .setLabel('➡️')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    // Bouton dernière page
    if (currentPage < totalPages - 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streamers_page_${totalPages}_${statusFilter || 'all'}`)
          .setLabel('⏭️')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    return row;
  }
};