const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('live-status')
    .setDescription("Voir qui est en live"),

  async execute(interaction, client) {
    if (Object.keys(client.liveStreamers).length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('⚫ Aucun Stream')
        .setDescription("Personne n'est en live actuellement.")
        .setColor('Orange');

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🔴 Streamers Live')
      .setDescription(`${Object.keys(client.liveStreamers).length} streamer(s) en direct`)
      .setColor('Red');

    const allStreamers = await client.db.getAllStreamers();
    const streamerMap = new Map(allStreamers.map(s => [s.name, s]));

    for (const streamerName of Object.keys(client.liveStreamers)) {
      const streamer = streamerMap.get(streamerName);
      if (streamer) {
        const statusEmoji = streamer.status === 'affilie' ? '⭐' : '💫';
        embed.addFields({
          name: `${statusEmoji} ${streamer.name}`,
          value: `🔗 ${streamer.url}\n💬 ${streamer.description}`,
          inline: true
        });
      }
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
    client.metrics.recordCommand('live-status', interaction.user.id);
  }
};