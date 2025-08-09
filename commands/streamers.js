const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { StreamerStatus } = require('../config');

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
      const allStreamers = await bot.db.getAllStreamers();

      let streamers = allStreamers;
      if (statusFilter) {
        streamers = allStreamers.filter(s => s.status === statusFilter);
      }

      if (streamers.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('📭 Aucun streamer trouvé')
          .setDescription(statusFilter 
            ? `Aucun streamer ${statusFilter === 'affilie' ? 'affilié' : 'non-affilié'} enregistré.`
            : 'Aucun streamer enregistré.')
          .setColor(Colors.Orange);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Séparer par statut
      const affilies = streamers.filter(s => s.status === StreamerStatus.AFFILIE);
      const nonAffilies = streamers.filter(s => s.status === StreamerStatus.NON_AFFILIE);

      const embed = new EmbedBuilder()
        .setTitle('🎮 Liste des streamers')
        .setColor(Colors.Purple)
        .setFooter({ 
          text: `Total: ${streamers.length} streamer(s)` 
        })
        .setTimestamp();

      // Ajouter les affiliés
      if (affilies.length > 0 && (!statusFilter || statusFilter === 'affilie')) {
        const affiliesList = affilies
          .slice(0, 10) // Limiter à 10 pour éviter la limite des embeds
          .map(s => `• [${s.name}](${s.url}) - ${s.description}`)
          .join('\n');

        embed.addFields({
          name: `⭐ Streamers Affiliés (${affilies.length})`,
          value: affiliesList + (affilies.length > 10 ? '\n*... et plus*' : ''),
          inline: false,
        });
      }

      // Ajouter les non-affiliés
      if (nonAffilies.length > 0 && (!statusFilter || statusFilter === 'non_affilie')) {
        const nonAffiliesList = nonAffilies
          .slice(0, 10)
          .map(s => `• [${s.name}](${s.url}) - ${s.description}`)
          .join('\n');

        embed.addFields({
          name: `🌟 Streamers Non-Affiliés (${nonAffilies.length})`,
          value: nonAffiliesList + (nonAffilies.length > 10 ? '\n*... et plus*' : ''),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      bot.logger.error(`❌ Erreur commande streamers: ${error.message}`);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription('Impossible de récupérer la liste des streamers.')
        .setColor(Colors.Red);

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};