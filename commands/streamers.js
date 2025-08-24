const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { StreamerStatus } = require('../config');

const MAX_FIELD_VALUE_LENGTH = 1000; // Marge de sécurité pour les fields Discord (1024 max)

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
        )),

  async execute(interaction, bot) {
    await interaction.deferReply();

    try {
      const statusFilter = interaction.options.getString('status');
      
      // Récupération des streamers
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

      // Cas aucun streamer trouvé
      if (streamers.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('📭 Aucun streamer trouvé')
          .setDescription(this.getNoStreamersMessage(statusFilter))
          .setColor(Colors.Orange);
        
        return await interaction.editReply({ embeds: [embed] });
      }

      // Envoyer en messages multiples
      await this.sendMultipleMessages(interaction, streamers, statusFilter);

    } catch (error) {
      bot.logger.error(`❌ Erreur commande streamers: ${error.message}`, error.stack);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription('Une erreur s\'est produite lors de l\'affichage des streamers.')
        .setColor(Colors.Red);

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },

  /**
   * Messages multiples
   */
  async sendMultipleMessages(interaction, streamers, statusFilter) {
    const affilies = streamers.filter(s => s.status === StreamerStatus.AFFILIE);
    const nonAffilies = streamers.filter(s => s.status === StreamerStatus.NON_AFFILIE);

    // Message principal
    const mainEmbed = new EmbedBuilder()
      .setTitle('🎮 Liste des streamers')
      .setDescription(`**Total: ${streamers.length} streamer(s)**\n\nListe envoyée en plusieurs messages...`)
      .setColor(Colors.Purple)
      .setTimestamp();

    if (!statusFilter) {
      mainEmbed.addFields(
        { name: '⭐ Affiliés', value: affilies.length.toString(), inline: true },
        { name: '🌟 Non-Affiliés', value: nonAffilies.length.toString(), inline: true }
      );
    }

    await interaction.editReply({ embeds: [mainEmbed] });

    // Envoyer les affiliés
    if (affilies.length > 0 && (!statusFilter || statusFilter === 'affilie')) {
      const affilieEmbeds = this.createEmbedsForStreamers(affilies, '⭐ Streamers Affiliés', Colors.Gold);
      for (const embed of affilieEmbeds) {
        await interaction.followUp({ embeds: [embed] });
      }
    }

    // Envoyer les non-affiliés
    if (nonAffilies.length > 0 && (!statusFilter || statusFilter === 'non_affilie')) {
      const nonAffilieeEmbeds = this.createEmbedsForStreamers(nonAffilies, '🌟 Streamers Non-Affiliés', Colors.Blue);
      for (const embed of nonAffilieeEmbeds) {
        await interaction.followUp({ embeds: [embed] });
      }
    }
  },

  /**
   * Crée plusieurs embeds pour une liste de streamers
   */
  createEmbedsForStreamers(streamers, title, color) {
    const embeds = [];
    let currentEmbed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color);
    
    let embedCount = 1;
    let streamersList = '';
    let processedCount = 0;

    for (const streamer of streamers) {
      const streamerLine = `• [${streamer.name}](${streamer.url})\n`;
      
      // Vérifier si ajouter ce streamer dépasserait la limite du field
      if (streamersList.length + streamerLine.length > MAX_FIELD_VALUE_LENGTH && processedCount > 0) {
        // Ajouter le field avec les streamers actuels
        currentEmbed.addFields({
          name: embedCount === 1 ? `Liste (${processedCount} streamer${processedCount > 1 ? 's' : ''})` : `Suite (${processedCount} streamer${processedCount > 1 ? 's' : ''})`,
          value: streamersList,
          inline: false
        });
        
        currentEmbed.setFooter({ text: `Partie ${embedCount} • ${processedCount} streamer(s)` });
        embeds.push(currentEmbed);

        // Créer un nouvel embed
        embedCount++;
        currentEmbed = new EmbedBuilder()
          .setTitle(`${title} (suite)`)
          .setColor(color);
        streamersList = '';
        processedCount = 0;
      }

      streamersList += streamerLine;
      processedCount++;
    }

    // Ajouter le dernier embed s'il contient des streamers
    if (processedCount > 0) {
      currentEmbed.addFields({
        name: embedCount === 1 ? `Liste (${processedCount} streamer${processedCount > 1 ? 's' : ''})` : `Suite (${processedCount} streamer${processedCount > 1 ? 's' : ''})`,
        value: streamersList,
        inline: false
      });
      
      currentEmbed.setFooter({ 
        text: embeds.length > 0 
          ? `Partie ${embedCount} • ${processedCount} streamer(s)` 
          : `${processedCount} streamer(s)`
      });
      embeds.push(currentEmbed);
    }

    return embeds;
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
