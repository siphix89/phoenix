// commands/debug-stream.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug-stream')
    .setDescription('Debug des notifications de stream')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Action à effectuer')
        .setRequired(true)
        .addChoices(
          { name: 'status', value: 'status' },
          { name: 'force-update', value: 'force' },
          { name: 'check-now', value: 'check' }
        ))
    .addStringOption(option =>
      option.setName('streamer')
        .setDescription('Nom du streamer (optionnel)')
        .setRequired(false)),

  async execute(interaction, bot) {
    if (!bot.isModerator(interaction.member)) {
      return await interaction.reply({ content: '❌ Permissions insuffisantes', ephemeral: true });
    }

    const action = interaction.options.getString('action');
    const streamer = interaction.options.getString('streamer');

    await interaction.deferReply({ ephemeral: true });

    try {
      switch (action) {
        case 'status':
          let status = `📊 **Debug Notifications**\n\n`;
          status += `🔧 **Configuration:**\n`;
          status += `• NotificationManager: ${bot.notificationManager ? '✅' : '❌'}\n`;
          status += `• TwitchManager: ${bot.twitch ? '✅' : '❌'}\n`;
          status += `• Interval actif: ${bot.checkInterval ? '✅' : '❌'}\n\n`;
          
          status += `📈 **Streams en live (bot.liveStreamers):**\n`;
          if (bot.liveStreamers.size === 0) {
            status += `• Aucun stream détecté\n`;
          } else {
            for (const [name, data] of bot.liveStreamers.entries()) {
              const duration = Math.floor((Date.now() - data.startTime) / 60000);
              status += `• ${name}: ${duration}min (${data.streamInfo?.viewerCount || 'N/A'} viewers)\n`;
            }
          }
          
          status += `\n📢 **NotificationManager streams:**\n`;
          if (bot.notificationManager) {
            const activeStreams = bot.notificationManager.getAllActiveStreams();
            if (activeStreams.length === 0) {
              status += `• Aucun stream dans le gestionnaire\n`;
            } else {
              for (const [name, data] of activeStreams) {
                status += `• ${name}: message ${data.messageId}\n`;
              }
            }
          }
          
          await interaction.editReply(status);
          break;

        case 'force':
          if (streamer) {
            const success = await bot.forceStreamUpdate(streamer);
            await interaction.editReply(`🔄 Mise à jour forcée de ${streamer}: ${success ? '✅' : '❌'}`);
          } else {
            await bot.forceStreamUpdate();
            await interaction.editReply(`🔄 Mise à jour forcée de tous les streams`);
          }
          break;

        case 'check':
          await interaction.editReply(`🔍 Vérification manuelle lancée...`);
          await bot.checkStreamersLive();
          await interaction.followUp(`✅ Vérification terminée`);
          break;
      }
    } catch (error) {
      await interaction.editReply(`❌ Erreur: ${error.message}`);
    }
  }
};
