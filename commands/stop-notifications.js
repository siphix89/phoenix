// ===== commands/stop-notifications.js =====
const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop-notifications')
    .setDescription('Arrête le système de notifications Twitch'),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      if (bot.checkInterval) {
        clearInterval(bot.checkInterval);
        bot.checkInterval = null;
        
        const embed = new EmbedBuilder()
          .setTitle('⏹️ Notifications arrêtées')
          .setDescription('Le système de notifications a été arrêté avec succès.')
          .addFields(
            { name: '📊 Streamers surveillés', value: `${(await bot.db.getAllStreamers()).length}`, inline: true },
            { name: '🔴 Streamers live actuels', value: `${bot.liveStreamers.size}`, inline: true }
          )
          .setColor(Colors.Orange)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('ℹ️ Déjà arrêté')
          .setDescription('Le système de notifications n\'était pas actif.')
          .setColor(Colors.Blue)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription(`Erreur lors de l'arrêt: ${error.message}`)
        .setColor(Colors.Red)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
