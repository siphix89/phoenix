const { SlashCommandBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { StreamerStatus } = require('../config');

const STREAMERS_PER_PAGE = 10;
const MAX_EMBED_FIELD_LENGTH = 1024;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('streamers')
    .setDescription('Afficher la liste des streamers')
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Filtrer par statut')
        .setRequired(false)
        .addChoices(
          { name: 'Affiliés', value: 'affilie' },
          { name: 'Non-affiliés', value: 'non_affilie' }
        ))
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Numéro de page (par défaut: 1)')
        .setRequired(false)
        .setMinValue(1)),

  async execute(interaction, bot) {
    await interaction.deferReply();

    try {
      const statusFilter = interaction.options.getString('status');
      const requestedPage = interaction.options.getInteger('page') ?? 1;
      
      // Récupération des streamers avec gestion d'erreur spécifique
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
      const currentPage = Math.min(requestedPage, totalPages);

      // Cas aucun streamer trouvé
      if (streamers.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('📭 Aucun streamer trouvé')
          .setDescription(this.getNoStreamersMessage(statusFilter))
          .setColor(Colors.Orange);
        
        return await interaction.editReply({ embeds: [embed] });
      }

      // Pagination
      const startIndex = (currentPage - 1) * STREAMERS_PER_PAGE;
      const endIndex = startIndex + STREAMERS_PER_PAGE;
      const paginatedStreamers = streamers.slice(startIndex, endIndex);

      // Construction de l'embed
      const embed = this.buildStreamersEmbed(
        paginatedStreamers, 
        streamers.length, 
        currentPage, 
        totalPages, 
        statusFilter
      );

      // Boutons de navigation si nécessaire
      const components = totalPages > 1 
        ? [this.createNavigationButtons(currentPage, totalPages, statusFilter)]
        : [];

      await interaction.editReply({ 
        embeds: [embed], 
        components 
      });

    } catch (error) {
      bot.logger.error(`❌ Erreur commande streamers: ${error.message}`, error.stack);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription(error.message === 'Erreur de connexion à la base de données' 
          ? 'Impossible de se connecter à la base de données. Veuillez réessayer plus tard.'
          : 'Une erreur inattendue s\'est produite. Veuillez réessayer.')
        .setColor(Colors.Red);

      await interaction.editReply({ embeds: [errorEmbed] });
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
    let streamersList = '';
    let count = 0;

    for (const streamer of streamers) {
      const streamerLine = `• [${streamer.name}](${streamer.url})${streamer.description ? ` - ${streamer.description}` : ''}\n`;
      
      // Vérifier si on dépasse la limite des embeds Discord
      if (streamersList.length + streamerLine.length > MAX_EMBED_FIELD_LENGTH) {
        streamersList += '*... (liste tronquée)*';
        break;
      }
      
      streamersList += streamerLine;
      count++;
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
    const row = new ActionRowBuilder();

    // Bouton page précédente
    if (currentPage > 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streamers_prev_${currentPage - 1}_${statusFilter || 'all'}`)
          .setLabel('⬅️ Précédent')
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
          .setCustomId(`streamers_next_${currentPage + 1}_${statusFilter || 'all'}`)
          .setLabel('Suivant ➡️')
          .setStyle(ButtonStyle.Secondary)
      );
    }

    return row;
  },

  /**
   * Génère le message approprié quand aucun streamer n'est trouvé
   */
  getNoStreamersMessage(statusFilter) {
    if (!statusFilter) {
      return 'Aucun streamer enregistré dans la base de données.';
    }
    
    return statusFilter === 'affilie' 
      ? 'Aucun streamer affilié trouvé.'
      : 'Aucun streamer non-affilié trouvé.';
  }
};
