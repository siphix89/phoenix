const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop-notifications')
    .setDescription('Arrêter le système de notifications Twitch pour tous les serveurs'),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Vérifier si les notifications sont actives
      if (!bot.checkInterval) {
        const embed = new EmbedBuilder()
          .setTitle('ℹ️ Notifications déjà arrêtées')
          .setDescription('Le système de notifications n\'est pas actuellement actif.')
          .setColor(Colors.Blue)
          .addFields(
            {
              name: '💡 Pour redémarrer',
              value: 'Utilisez la commande `/start-notifications`',
              inline: false
            }
          )
          .setFooter({ text: 'Aucune action nécessaire' })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Capturer les statistiques avant l'arrêt
      const stats = await bot.db.getStats();
      const allActiveStreams = await bot.db.getActiveStreams();
      const liveStreamsCount = bot.liveStreamers.size;

      // Arrêter le système
      clearInterval(bot.checkInterval);
      bot.checkInterval = null;
      
      console.log(`⏹️ Notifications arrêtées par ${interaction.user.tag} sur ${interaction.guild.name}`);

      // Créer l'embed de confirmation
      const embed = new EmbedBuilder()
        .setTitle('⏹️ Notifications arrêtées')
        .setDescription('Le système de notifications multi-serveurs a été arrêté avec succès.')
        .setColor(Colors.Orange)
        .addFields(
          { 
            name: '📊 Statistiques au moment de l\'arrêt', 
            value: `• Serveurs: ${stats.guilds}\n• Streamers surveillés: ${stats.streamers}\n• Total follows: ${stats.totalFollows}`, 
            inline: false 
          },
          { 
            name: '🔴 État des streams', 
            value: `• Streams actifs (DB): ${allActiveStreams.length}\n• Streams en mémoire: ${liveStreamsCount}`, 
            inline: false 
          }
        )
        .setFooter({ 
          text: `Arrêté par ${interaction.user.displayName}`,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTimestamp();

      // Lister les streams actifs si présents
      if (allActiveStreams.length > 0) {
        const liveList = allActiveStreams
          .slice(0, 5)
          .map(s => `🔴 **${s.display_name || s.twitch_username}** - ${s.viewer_count || 0} viewers`)
          .join('\n');
        
        embed.addFields({
          name: '🎬 Streams qui étaient surveillés',
          value: liveList + (allActiveStreams.length > 5 ? `\n... et ${allActiveStreams.length - 5} autre(s)` : ''),
          inline: false
        });
      }

      // Ajouter les instructions de redémarrage
      embed.addFields({
        name: '💡 Pour redémarrer',
        value: 'Utilisez `/start-notifications` pour réactiver le système de notifications.',
        inline: false
      });

      // Avertissement si des streams sont actifs
      if (allActiveStreams.length > 0) {
        embed.addFields({
          name: '⚠️ Important',
          value: `${allActiveStreams.length} streamer(s) actuellement en live ne seront plus surveillés.\nLes notifications reprendront après redémarrage.`,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

      // Enregistrer dans les métriques
      if (bot.metrics?.recordCommand) {
        bot.metrics.recordCommand('stop-notifications', interaction.user.id);
      }

    } catch (error) {
      console.error('❌ Erreur dans stop-notifications:', error);

      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur lors de l\'arrêt')
        .setDescription('Une erreur est survenue lors de l\'arrêt des notifications.')
        .setColor(Colors.Red)
        .addFields(
          {
            name: '🐛 Détails de l\'erreur',
            value: `\`\`\`${error.message}\`\`\``,
            inline: false
          },
          {
            name: '📋 Actions recommandées',
            value: '• Vérifiez les logs du bot\n• Tentez de redémarrer le bot si nécessaire\n• Contactez un développeur si le problème persiste',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Enregistrer l'erreur
      if (bot.metrics?.recordError) {
        bot.metrics.recordError();
      }
    }
  }
};