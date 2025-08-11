// ===== commands/start-notifications.js =====
const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start-notifications')
    .setDescription('Force le démarrage du système de notifications Twitch'),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Utiliser la nouvelle méthode startNotifications
      if (typeof bot.startNotifications === 'function') {
        const success = await bot.startNotifications();
        
        const embed = new EmbedBuilder()
          .setTitle(success ? '✅ Notifications activées' : '❌ Échec activation')
          .setDescription(
            success 
              ? `Le système de notifications a été démarré avec succès!\n\n**Détails:**\n• Intervalle: ${bot.config.notificationIntervalMinutes || 5} minutes\n• Streamers surveillés: ${(await bot.db.getAllStreamers()).length}\n• État: ${bot.checkInterval ? 'Actif' : 'Inactif'}`
              : 'Impossible de démarrer les notifications. Utilisez `/debug-notifications` pour diagnostiquer le problème.'
          )
          .setColor(success ? Colors.Green : Colors.Red)
          .setTimestamp();

        if (success) {
          embed.addFields(
            { name: '📊 Prochaine vérification', value: `Dans ${bot.config.notificationIntervalMinutes || 5} minutes`, inline: true },
            { name: '🎯 Streamers live actuels', value: `${bot.liveStreamers.size}`, inline: true }
          );
        }

        await interaction.editReply({ embeds: [embed] });
      } else {
        // Fallback: démarrer manuellement
        bot.startStreamChecking();
        
        const embed = new EmbedBuilder()
          .setTitle('🔄 Tentative de démarrage')
          .setDescription('Démarrage des notifications tenté via fallback.\nVérifiez les logs pour plus de détails.')
          .setColor(Colors.Orange)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur de démarrage')
        .setDescription(`**Erreur rencontrée:**\n\`\`\`${error.message}\`\`\`\n\nUtilisez \`/debug-notifications\` pour plus de détails.`)
        .setColor(Colors.Red)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
