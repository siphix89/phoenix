const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force-restart-stream')
    .setDescription('Force la détection d\'un stream comme nouveau')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Nom d\'utilisateur Twitch')
        .setRequired(true)
    ),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    const username = interaction.options.getString('username').toLowerCase();
    
    await interaction.deferReply({ ephemeral: true });

    try {
      console.log(`🔄 Force restart stream pour: ${username}`);

      // 1. Nettoyer NotificationManager
      if (bot.notificationManager) {
        await bot.notificationManager.removeLiveNotification(username);
        bot.notificationManager.forceCleanup(username);
      }

      // 2. Nettoyer les trackers
      bot.liveStreamers.delete(username);
      bot.liveMessages.delete(username);
      
      // 3. Nettoyer processedStreams
      if (bot.processedStreams) {
        for (const streamId of bot.processedStreams) {
          if (streamId.startsWith(`${username}_`)) {
            bot.processedStreams.delete(streamId);
          }
        }
      }

      // 4. Marquer comme inactif dans TOUTES les DB
      const allGuilds = await bot.db.masterDb.all(
        'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
      );

      let dbCleaned = 0;
      for (const { guild_id } of allGuilds) {
        try {
          const streamer = await bot.db.getStreamer(guild_id, username);
          if (streamer) {
            await bot.db.setStreamInactive(guild_id, username);
            dbCleaned++;
          }
        } catch (error) {
          continue;
        }
      }

      console.log(`✅ ${username} nettoyé sur ${dbCleaned} serveur(s)`);

      // 5. Attendre 2 secondes puis forcer une vérification
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('🔍 Lancement vérification forcée...');
      await bot.checkStreamersLive();

      const embed = new EmbedBuilder()
        .setTitle('✅ Stream redémarré')
        .setDescription(`Le stream de **${username}** a été forcé à redémarrer.`)
        .setColor(Colors.Green)
        .addFields(
          {
            name: '🧹 Nettoyage',
            value: `• NotificationManager vidé\n• Tracking vidé\n• ${dbCleaned} DB nettoyées`,
            inline: false
          },
          {
            name: '🔍 Vérification',
            value: 'Une vérification immédiate a été lancée. Si le streamer est en live, la notification va être envoyée.',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Erreur force-restart-stream:', error);

      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription(`Impossible de redémarrer le stream : \`${error.message}\``)
        .setColor(Colors.Red)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
```
   FORCE_CLEAN_ON_START=true
