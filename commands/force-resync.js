const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force-resync')
    .setDescription('Force la resynchronisation complète des streams actifs'),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      console.log('🔄 Début de la resynchronisation forcée...');

      // 1. Nettoyer NotificationManager
      if (bot.notificationManager) {
        const activeStreamers = bot.notificationManager.getAllActiveStreams();
        for (const [streamerName] of activeStreamers) {
          await bot.notificationManager.removeLiveNotification(streamerName);
          console.log(`✅ ${streamerName} retiré du NotificationManager`);
        }
      }

      // 2. Nettoyer liveStreamers
      bot.liveStreamers.clear();
      console.log('✅ liveStreamers vidé');

      // 3. Nettoyer liveMessages
      bot.liveMessages.clear();
      console.log('✅ liveMessages vidé');

      // 4. Nettoyer processedStreams
      if (bot.processedStreams) {
        bot.processedStreams.clear();
        console.log('✅ processedStreams vidé');
      }

      // 5. Marquer TOUS les streams comme inactifs dans TOUTES les DB
      const allGuilds = await bot.db.masterDb.all(
        'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
      );

      let dbCleaned = 0;
      for (const { guild_id } of allGuilds) {
        try {
          const guildStreamers = await bot.db.getGuildStreamers(guild_id);
          for (const streamer of guildStreamers) {
            if (streamer.is_active) {
              await bot.db.setStreamInactive(guild_id, streamer.twitch_username);
              dbCleaned++;
              console.log(`✅ ${streamer.twitch_username} marqué inactif sur ${guild_id}`);
            }
          }
        } catch (error) {
          console.error(`❌ Erreur pour ${guild_id}:`, error.message);
        }
      }

      console.log('✅ Resynchronisation complète terminée');

      // 6. Forcer une vérification immédiate
      console.log('🔍 Lancement de la vérification immédiate...');
      await bot.checkStreamersLive();

      const embed = new EmbedBuilder()
        .setTitle('✅ Resynchronisation complète terminée')
        .setDescription('Tous les caches ont été vidés et les streams ont été resynchronisés.')
        .setColor(Colors.Green)
        .addFields(
          {
            name: '🧹 Nettoyage effectué',
            value: `• NotificationManager vidé\n• liveStreamers vidé\n• ${dbCleaned} stream(s) marqué(s) inactifs en DB\n• Vérification immédiate lancée`,
            inline: false
          },
          {
            name: '⏰ Prochaine action',
            value: 'Le bot va maintenant redétecter les streams en live et envoyer les notifications.',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Erreur force-resync:', error);

      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur de resynchronisation')
        .setDescription(`Une erreur est survenue : \`${error.message}\``)
        .setColor(Colors.Red)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
