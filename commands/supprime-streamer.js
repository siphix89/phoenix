const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-streamer')
    .setDescription('Supprimer un streamer existant')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer à supprimer')
        .setRequired(true)
        .setAutocomplete(true)), // Ajout de l'autocomplétion
  
  async autocomplete(interaction, client) {
    // Récupérer la liste des streamers pour l'autocomplétion
    const focusedValue = interaction.options.getFocused();
    const streamers = await client.db?.getAllStreamers?.() || [];
    
    const filtered = streamers
      .filter(streamer => streamer.nom.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25) // Discord limite à 25 suggestions
      .map(streamer => ({ name: streamer.nom, value: streamer.nom }));
    
    await interaction.respond(filtered);
  },

  async execute(interaction, client) {
    // Vérifier permissions
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: '❌ Permissions insuffisantes!', ephemeral: true });
    }

    const nom = interaction.options.getString('nom');

    // Vérifier si le streamer existe avant de le supprimer
    const streamer = await client.db?.getStreamer?.(nom);
    
    if (!streamer) {
      // Suggestion de noms similaires en cas d'erreur
      const allStreamers = await client.db?.getAllStreamers?.() || [];
      const similarStreamers = allStreamers
        .filter(s => s.nom.toLowerCase().includes(nom.toLowerCase()) || 
                    nom.toLowerCase().includes(s.nom.toLowerCase()))
        .slice(0, 3)
        .map(s => s.nom);
      
      let errorMessage = `❌ Le streamer **${nom}** n'existe pas !`;
      
      if (similarStreamers.length > 0) {
        errorMessage += `\n\n**Streamers similaires trouvés :**\n${similarStreamers.map(s => `• ${s}`).join('\n')}`;
      }
      
      return interaction.reply({ content: errorMessage, ephemeral: true });
    }

    // Supprimer de la DB
    const success = await client.db?.removeStreamer?.(nom) || false;

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Streamer Supprimé')
        .setDescription(`**${nom}** a été supprimé avec succès !`)
        .setColor('Red')
        .addFields(
          { name: 'Action', value: 'Suppression', inline: true },
          { name: 'Streamer', value: nom, inline: true },
          { name: 'URL', value: streamer.url || 'N/A', inline: true },
        );

      await interaction.reply({ embeds: [embed] });

      // Logging
      client.metrics?.recordCommand?.('supprimer-streamer', interaction.user.id);
      console.log(`Streamer ${nom} supprimé par ${interaction.user.tag}`);

    } else {
      await interaction.reply({ content: '❌ Erreur lors de la suppression !', ephemeral: true });
    }
  }
};
