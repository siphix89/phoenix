const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('🧹 Supprimer des messages dans le channel')
    .addSubcommand(subcommand =>
      subcommand
        .setName('messages')
        .setDescription('Supprimer un nombre spécifique de messages')
        .addIntegerOption(option =>
          option
            .setName('nombre')
            .setDescription('Nombre de messages à supprimer (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addUserOption(option =>
          option
            .setName('utilisateur')
            .setDescription('Supprimer uniquement les messages de cet utilisateur')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('bots')
            .setDescription('Supprimer uniquement les messages des bots')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('all')
        .setDescription('⚠️ SUPPRIMER TOUS LES MESSAGES DU CHANNEL')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, bot) {
    const subcommand = interaction.options.getSubcommand();

    // === CLEAR ALL ===
    if (subcommand === 'all') {
      // Boutons de confirmation
      const confirmRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('clear_all_confirm')
            .setLabel('⚠️ OUI, TOUT SUPPRIMER')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('clear_all_cancel')
            .setLabel('❌ Annuler')
            .setStyle(ButtonStyle.Secondary)
        );

      const warningEmbed = new EmbedBuilder()
        .setTitle('⚠️ ATTENTION - Suppression totale')
        .setDescription(
          `Tu es sur le point de supprimer **TOUS les messages** du channel ${interaction.channel}\n\n` +
          '🚨 **Cette action est IRRÉVERSIBLE !**\n' +
          '📝 Note : Seuls les messages de moins de 14 jours peuvent être supprimés.\n\n' +
          '⏱️ Cette opération peut prendre plusieurs minutes selon le nombre de messages.'
        )
        .setColor(Colors.Red)
        .setFooter({ text: 'Tu as 30 secondes pour confirmer' })
        .setTimestamp();

      const reply = await interaction.reply({
        embeds: [warningEmbed],
        components: [confirmRow],
        ephemeral: true,
        fetchReply: true
      });

      // Attendre la réponse
      const collector = reply.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 30000
      });

      collector.on('collect', async (i) => {
        if (i.customId === 'clear_all_cancel') {
          await i.update({
            content: '✅ Suppression annulée.',
            embeds: [],
            components: []
          });
          collector.stop();
          return;
        }

        if (i.customId === 'clear_all_confirm') {
          await i.update({
            content: '🧹 Suppression en cours... Cela peut prendre du temps.',
            embeds: [],
            components: []
          });

          try {
            let totalDeleted = 0;
            let lastMessageId = null;
            let hasMore = true;

            while (hasMore) {
              // Récupérer les messages par batch de 100
              const fetchOptions = { limit: 100 };
              if (lastMessageId) {
                fetchOptions.before = lastMessageId;
              }

              const messages = await interaction.channel.messages.fetch(fetchOptions);

              if (messages.size === 0) {
                hasMore = false;
                break;
              }

              // Filtrer les messages de moins de 14 jours
              const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
              const recentMessages = messages.filter(msg => msg.createdTimestamp > twoWeeksAgo);

              if (recentMessages.size === 0) {
                hasMore = false;
                break;
              }

              // Supprimer en masse (max 100 à la fois)
              const deleted = await interaction.channel.bulkDelete(recentMessages, true);
              totalDeleted += deleted.size;

              // Si on a supprimé moins que demandé, on a atteint la fin
              if (deleted.size < recentMessages.size) {
                hasMore = false;
              }

              // Mettre à jour le lastMessageId pour la prochaine itération
              const lastMessage = messages.last();
              lastMessageId = lastMessage?.id;

              // Petite pause pour éviter le rate limit
              await new Promise(resolve => setTimeout(resolve, 1000));

              // Mise à jour du statut
              if (totalDeleted % 100 === 0) {
                await i.editReply({
                  content: `🧹 Suppression en cours... ${totalDeleted} messages supprimés.`
                });
              }
            }

            const finalEmbed = new EmbedBuilder()
              .setTitle('✅ Nettoyage terminé')
              .setDescription(
                `**${totalDeleted}** message(s) supprimé(s) dans ${interaction.channel}\n\n` +
                '📝 Les messages de plus de 14 jours n\'ont pas pu être supprimés (limitation Discord).'
              )
              .setColor(Colors.Green)
              .setFooter({ text: `Par ${interaction.user.tag}` })
              .setTimestamp();

            await i.editReply({
              content: null,
              embeds: [finalEmbed]
            });

            // Message dans le channel
            const publicMessage = await interaction.channel.send({
              content: `🧹 ${totalDeleted} message(s) supprimé(s) par ${interaction.user}`,
            });

            setTimeout(() => {
              publicMessage.delete().catch(() => {});
            }, 5000);

            console.log(`🧹 ${interaction.user.tag} a supprimé ${totalDeleted} messages (CLEAR ALL) dans #${interaction.channel.name}`);

          } catch (error) {
            console.error('Erreur clear all:', error);
            await i.editReply({
              content: `❌ Erreur lors de la suppression : ${error.message}`,
              embeds: []
            });
          }

          collector.stop();
        }
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          await interaction.editReply({
            content: '⏱️ Temps écoulé - Suppression annulée.',
            embeds: [],
            components: []
          });
        }
      });

      return;
    }

    // === CLEAR MESSAGES (nombre spécifique) ===
    if (subcommand === 'messages') {
      const amount = interaction.options.getInteger('nombre');
      const targetUser = interaction.options.getUser('utilisateur');
      const botsOnly = interaction.options.getBoolean('bots');

      await interaction.deferReply({ ephemeral: true });

      try {
        // Vérifier les permissions du bot
        if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
          return interaction.editReply({
            content: '❌ Je n\'ai pas la permission de gérer les messages dans ce channel.'
          });
        }

        // Récupérer les messages
        const messages = await interaction.channel.messages.fetch({ 
          limit: Math.min(amount + 10, 100) // +10 pour filtrer après
        });

        // Filtrer les messages selon les critères
        let messagesToDelete = messages.filter(msg => {
          // Discord ne permet pas de supprimer les messages de plus de 14 jours
          const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
          if (msg.createdTimestamp < twoWeeksAgo) return false;

          // Filtrer par utilisateur si spécifié
          if (targetUser && msg.author.id !== targetUser.id) return false;

          // Filtrer pour ne garder que les bots si spécifié
          if (botsOnly && !msg.author.bot) return false;

          return true;
        });

        // Limiter au nombre demandé
        messagesToDelete = messagesToDelete.first(amount);

        if (messagesToDelete.size === 0) {
          return interaction.editReply({
            content: '❌ Aucun message à supprimer (les messages de plus de 14 jours ne peuvent pas être supprimés en masse).'
          });
        }

        // Supprimer les messages
        const deleted = await interaction.channel.bulkDelete(messagesToDelete, true);

        // Message de confirmation
        let confirmMessage = `✅ **${deleted.size}** message(s) supprimé(s)`;
        
        if (targetUser) {
          confirmMessage += ` de ${targetUser.tag}`;
        } else if (botsOnly) {
          confirmMessage += ' (bots uniquement)';
        }

        const embed = new EmbedBuilder()
          .setTitle('🧹 Nettoyage effectué')
          .setDescription(confirmMessage)
          .addFields(
            { name: '📊 Statistiques', value: `Channel: ${interaction.channel}\nDemandé: ${amount}\nSupprimé: ${deleted.size}`, inline: false }
          )
          .setColor(Colors.Green)
          .setFooter({ text: `Par ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Message auto-destructible dans le channel
        const publicMessage = await interaction.channel.send({
          content: `🧹 ${deleted.size} message(s) supprimé(s) par ${interaction.user}`,
        });

        setTimeout(() => {
          publicMessage.delete().catch(() => {});
        }, 5000);

        console.log(`🧹 ${interaction.user.tag} a supprimé ${deleted.size} messages dans #${interaction.channel.name}`);

      } catch (error) {
        console.error('Erreur clear:', error);
        
        let errorMessage = '❌ Erreur lors de la suppression des messages.';
        
        if (error.code === 50034) {
          errorMessage = '❌ Impossible de supprimer des messages de plus de 14 jours.';
        } else if (error.code === 50013) {
          errorMessage = '❌ Je n\'ai pas les permissions nécessaires.';
        }

        await interaction.editReply({ content: errorMessage });
      }
    }
  },
};