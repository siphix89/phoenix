const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Vérifier la latence du bot'),

  async execute(interaction, bot) {
    const sent = await interaction.reply({ 
      content: '🏓 Calcul de la latence...', 
      fetchReply: true 
    });

    const pingTime = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(bot.ws.ping);

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor(apiLatency > 200 ? Colors.Red : apiLatency > 100 ? Colors.Orange : Colors.Green)
      .addFields(
        {
          name: '📡 Latence API',
          value: `${apiLatency}ms`,
          inline: true,
        },
        {
          name: '⚡ Latence Bot',
          value: `${pingTime}ms`,
          inline: true,
        },
        {
          name: '📊 Statut',
          value: apiLatency > 200 ? '🔴 Élevée' : apiLatency > 100 ? '🟠 Moyenne' : '🟢 Bonne',
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.editReply({ 
      content: '', 
      embeds: [embed] 
    });
  },
};