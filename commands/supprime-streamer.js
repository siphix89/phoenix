const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-streamer')
    .setDescription('Supprimer un streamer existant')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer à supprimer')
        .setRequired(true)),
  
  async execute(interaction, client) {
    // Vérifier permissions (exemple ici : modérateur = gestionnaire de rôles)
    if (!interaction.member.permissions.has('ManageGuild')) { // adapter selon ta logique
      return interaction.reply({ content: '❌ Permissions insuffisantes!', ephemeral: true });
    }

    const nom = interaction.options.getString('nom');

    // Vérifier si le streamer existe avant de le supprimer
    const streamerExists = await client.db?.getStreamer?.(nom) || false;
    
    if (!streamerExists) {
      return interaction.reply({ content: `❌ Le streamer **${nom}** n'existe pas !`, ephemeral: true });
    }

    // Supprimer de la DB - ici tu dois appeler ta méthode de suppression de ta DB
    const success = await client.db?.removeStreamer?.(nom) || false;

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Streamer Supprimé')
        .setDescription(`**${nom}** a été supprimé avec succès !`)
        .setColor('Red')
        .addFields(
          { name: 'Action', value: 'Suppression', inline: true },
          { name: 'Streamer', value: nom, inline: true },
        );

      await interaction.reply({ embeds: [embed] });

      // Enregistrer métrique, logger etc
      client.metrics?.recordCommand?.('supprimer-streamer', interaction.user.id);
      console.log(`Streamer ${nom} supprimé par ${interaction.user.tag}`);

    } else {
      await interaction.reply({ content: '❌ Erreur lors de la suppression !', ephemeral: true });
    }
  }
};