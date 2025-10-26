const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start-notifications')
    .setDescription('Démarrer le système de notifications Twitch pour tous les serveurs'),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Vérifier si les notifications sont déjà actives
      if (bot.checkInterval) {
        const stats = await bot.db.getStats();
        const allActiveStreams = await bot.db.getActiveStreams();

        const embed = new EmbedBuilder()
          .setTitle('ℹ️ Notifications déjà actives')
          .setDescription('Le système de notifications est déjà en cours d\'exécution.')
          .setColor(Colors.Blue)
          .addFields(
            { 
              name: '⏱️ Intervalle', 
              value: `${bot.config.notificationIntervalMinutes || 5} minutes`, 
              inline: true 
            },
            { 
              name: '🎮 Streamers surveillés', 
              value: `${stats.streamers} unique(s)`, 
              inline: true 
            },
            { 
              name: '🔴 Actuellement live', 
              value: `${allActiveStreams.length}`, 
              inline: true 
            },
            {
              name: '📊 Statistiques globales',
              value: `• Serveurs: ${stats.guilds}\n• Total follows: ${stats.totalFollows}\n• Streams en mémoire: ${bot.liveStreamers.size}`,
              inline: false
            }
          )
          .setFooter({ text: 'Les notifications fonctionnent normalement' })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Démarrer les notifications
      if (typeof bot.startNotifications === 'function') {
        const success = await bot.startNotifications();
        
        if (success) {
          // Récupérer les statistiques après démarrage
          const stats = await bot.db.getStats();
          const allActiveStreams = await bot.db.getActiveStreams();

          const embed = new EmbedBuilder()
            .setTitle('✅ Notifications activées avec succès !')
            .setDescription('Le système de notifications multi-serveurs a été démarré.')
            .setColor(Colors.Green)
            .addFields(
              { 
                name: '⏱️ Intervalle de vérification', 
                value: `${bot.config.notificationIntervalMinutes || 5} minutes`, 
                inline: true 
              },
              { 
                name: '🎮 Streamers surveillés', 
                value: `${stats.streamers} unique(s)`, 
                inline: true 
              },
              { 
                name: '🔴 Streams actifs', 
                value: `${allActiveStreams.length}`, 
                inline: true 
              },
              {
                name: '📊 Configuration',
                value: `• Serveurs Discord: ${stats.guilds}\n• Total de follows: ${stats.totalFollows}\n• Twitch API: ${bot.twitch?.accessToken ? '✅ Connecté' : '❌ Déconnecté'}`,
                inline: false
              },
              {
                name: '📅 Prochaine vérification',
                value: `Dans ${bot.config.notificationIntervalMinutes || 5} minute(s)`,
                inline: false
              }
            )
            .setFooter({ 
              text: `Démarré par ${interaction.user.displayName}`,
              iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

          // Ajouter la liste des streams actifs si présents
          if (allActiveStreams.length > 0) {
            const liveList = allActiveStreams
              .slice(0, 5)
              .map(s => `🔴 **${s.display_name || s.twitch_username}** - ${s.viewer_count || 0} viewers`)
              .join('\n');
            
            embed.addFields({
              name: '🎬 Actuellement en live',
              value: liveList + (allActiveStreams.length > 5 ? `\n... et ${allActiveStreams.length - 5} autre(s)` : ''),
              inline: false
            });
          }

          await interaction.editReply({ embeds: [embed] });

          // Log pour traçabilité
          console.log(`✅ Notifications démarrées manuellement par ${interaction.user.tag} sur ${interaction.guild.name}`);

        } else {
          // Échec du démarrage
          const embed = new EmbedBuilder()
            .setTitle('❌ Échec de l\'activation')
            .setDescription('Impossible de démarrer les notifications. Vérifiez la configuration.')
            .setColor(Colors.Red)
            .addFields(
              {
                name: '🔍 Vérifications',
                value: '• Configuration Twitch complète ?\n• TwitchManager initialisé ?\n• Credentials valides ?',
                inline: false
              },
              {
                name: '📋 Commandes utiles',
                value: '• `/debug-notifications` - Diagnostic complet\n• Vérifiez les logs du bot',
                inline: false
              }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        }

      } else {
        // Fallback: méthode directe
        console.log('⚠️ Méthode startNotifications() non trouvée, utilisation du fallback');
        
        bot.startStreamChecking();
        
        const embed = new EmbedBuilder()
          .setTitle('🔄 Démarrage en cours')
          .setDescription('Tentative de démarrage des notifications via méthode alternative.')
          .setColor(Colors.Orange)
          .addFields(
            {
              name: '⚠️ Avertissement',
              value: 'La méthode standard n\'est pas disponible. Les notifications ont été démarrées via fallback.',
              inline: false
            },
            {
              name: '📋 Action recommandée',
              value: 'Vérifiez que le bot est correctement initialisé.',
              inline: false
            }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('❌ Erreur dans start-notifications:', error);

      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur de démarrage')
        .setDescription('Une erreur est survenue lors du démarrage des notifications.')
        .setColor(Colors.Red)
        .addFields(
          {
            name: '🐛 Erreur',
            value: `\`\`\`${error.message}\`\`\``,
            inline: false
          },
          {
            name: '📋 Actions recommandées',
            value: '1. Vérifiez la configuration Twitch dans `.env`\n2. Utilisez `/debug-notifications` pour diagnostiquer\n3. Consultez les logs du bot',
            inline: false
          }
        )
        .setFooter({ text: 'Contactez un administrateur si le problème persiste' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Enregistrer l'erreur
      if (bot.metrics?.recordError) {
        bot.metrics.recordError();
      }
    }
  }
};