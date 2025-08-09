const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ajouter-streamer')
    .setDescription('Ajouter un nouveau streamer')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('url')
        .setDescription('URL Twitch du streamer')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Statut du streamer (affilie/non_affilie)')
        .setRequired(true)
        .addChoices(
          { name: 'Affilié', value: 'affilie' },
          { name: 'Non Affilié', value: 'non_affilie' }
        ))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Description du streamer')
        .setRequired(false)),
  
  async execute(interaction, client) {
    // Vérifier permissions (exemple ici : modérateur = gestionnaire de rôles)
    if (!interaction.member.permissions.has('ManageGuild')) { // adapter selon ta logique
      return interaction.reply({ content: '❌ Permissions insuffisantes!', ephemeral: true });
    }

    const nom = interaction.options.getString('nom');
    const url = interaction.options.getString('url');
    const status = interaction.options.getString('status').toLowerCase();
    const description = interaction.options.getString('description') || 'Nouveau streamer';

    // Validation URL Twitch (simple regex)
    const twitchRegex = /^https?:\/\/(www\.)?twitch\.tv\/[a-zA-Z0-9_]+$/;
    if (!twitchRegex.test(url)) {
      return interaction.reply({ content: '❌ URL Twitch invalide!', ephemeral: true });
    }

    if (!['affilie', 'non_affilie'].includes(status)) {
      return interaction.reply({ content: "❌ Statut invalide ! Utilisez 'affilie' ou 'non_affilie'", ephemeral: true });
    }

    // Ajouter en DB - ici tu dois appeler ta méthode d'ajout à ta DB
    const success = await client.db?.addStreamer?.(nom, url, status, description) || false;

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Streamer Ajouté')
        .setDescription(`**${nom}** a été ajouté avec succès !`)
        .setColor('Green')
        .addFields(
          { name: 'URL', value: url, inline: false },
          { name: 'Statut', value: status, inline: true },
          { name: 'Description', value: description, inline: true },
        );

      await interaction.reply({ embeds: [embed] });

      // Enregistrer métrique, logger etc
      client.metrics?.recordCommand?.('ajouter-streamer', interaction.user.id);
      console.log(`Streamer ${nom} ajouté par ${interaction.user.tag}`);

    } else {
      await interaction.reply({ content: '❌ Erreur lors de l\'ajout !', ephemeral: true });
    }
  }
};
