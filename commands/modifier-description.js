const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modifier-description')
    .setDescription('Modifier le message personnalisé d\'un streamer sur ce serveur')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer à modifier')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Nouveau message personnalisé (affiché lors des notifications)')
        .setRequired(true)
        .setMaxLength(500)),
  
  async execute(interaction, client) {
    try {
      if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ 
          content: '❌ Vous devez avoir la permission "Gérer le serveur" pour utiliser cette commande!', 
          flags: 64 
        });
      }

      await interaction.deferReply();

      const inputName = interaction.options.getString('nom').trim().toLowerCase();
      const nouveauMessage = interaction.options.getString('message').trim();

      console.log(`🔍 Modification pour ${inputName} sur ${interaction.guild.name}`);

      // ✅ Récupérer les streamers de CE serveur uniquement
      const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
      
      if (!guildStreamers || guildStreamers.length === 0) {
        return await interaction.editReply({
          content: '❌ Aucun streamer suivi sur ce serveur ! Utilisez `/ajouter-streamer` pour en ajouter.'
        });
      }

      // Trouver le streamer
      const streamer = guildStreamers.find(s => 
        s.twitch_username.toLowerCase() === inputName ||
        (s.display_name && s.display_name.toLowerCase() === inputName)
      );

      if (!streamer) {
        // Suggestions de noms similaires
        const similarStreamers = guildStreamers
          .filter(s => {
            const username = (s.twitch_username || '').toLowerCase();
            const displayName = (s.display_name || '').toLowerCase();
            return username.includes(inputName) || displayName.includes(inputName);
          })
          .slice(0, 5);

        let errorMessage = `❌ Streamer "${inputName}" non trouvé sur ce serveur !`;
        
        if (similarStreamers.length > 0) {
          errorMessage += `\n\n**Streamers similaires :**\n${similarStreamers.map(s => 
            `• **${s.display_name || s.twitch_username}** (@${s.twitch_username})`
          ).join('\n')}`;
        }
        
        errorMessage += `\n\n💡 Utilisez l'autocomplétion ou \`/streamers\` pour voir la liste.`;
        
        return await interaction.editReply({ content: errorMessage });
      }

      console.log('✅ Streamer trouvé:', streamer);

      // ✅ Modifier le message personnalisé dans la DB du serveur
      try {
        const db = await client.db.getGuildDatabaseConnection(interaction.guildId);
        
        const result = await db.run(`
          UPDATE streamers 
          SET custom_message = ?
          WHERE id = ?
        `, [nouveauMessage, streamer.id]);

        if (result.changes === 0) {
          throw new Error('Aucune ligne modifiée');
        }

        console.log(`✅ Message modifié pour ${streamer.twitch_username} (ID: ${streamer.id})`);

        // Créer l'embed de confirmation
        const embed = new EmbedBuilder()
          .setTitle('✅ Message personnalisé modifié !')
          .setDescription(`Le message de **${streamer.display_name || streamer.twitch_username}** a été mis à jour.`)
          .setColor(Colors.Green)
          .addFields(
            { 
              name: '👤 Streamer', 
              value: `**${streamer.display_name || streamer.twitch_username}**\n@${streamer.twitch_username}`, 
              inline: true 
            },
            { 
              name: '🔗 Lien Twitch', 
              value: `[Profil Twitch](https://twitch.tv/${streamer.twitch_username})`, 
              inline: true 
            }
          )
          .setFooter({ 
            text: `Modifié par ${interaction.user.displayName}`,
            iconURL: interaction.user.displayAvatarURL()
          })
          .setTimestamp();

        // Afficher l'ancien et le nouveau message
        if (streamer.custom_message) {
          embed.addFields({
            name: '📋 Ancien message',
            value: streamer.custom_message.length > 200 
              ? streamer.custom_message.substring(0, 200) + '...' 
              : streamer.custom_message,
            inline: false
          });
        }

        embed.addFields({
          name: '✨ Nouveau message',
          value: nouveauMessage,
          inline: false
        });

        // Info supplémentaire
        embed.addFields({
          name: '💡 Utilisation',
          value: 'Ce message sera affiché lors des notifications de stream.',
          inline: false
        });

        await interaction.editReply({ embeds: [embed] });

        // Métriques et logs
        if (client.metrics?.recordCommand) {
          client.metrics.recordCommand('modifier-description', interaction.user.id);
        }
        
        console.log(`✅ Message modifié pour ${streamer.twitch_username} par ${interaction.user.tag} sur ${interaction.guild.name}`);

      } catch (dbError) {
        console.error('❌ Erreur modification DB:', dbError);
        throw new Error(`Erreur base de données: ${dbError.message}`);
      }

    } catch (error) {
      console.error('❌ Erreur dans modifier-description:', error);
      
      const errorMessage = {
        content: `❌ Une erreur est survenue lors de la modification: ${error.message}`,
        flags: 64
      };

      try {
        if (interaction.deferred) {
          await interaction.editReply(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        console.error('❌ Impossible de répondre à l\'interaction:', replyError);
      }

      if (client.metrics?.recordError) {
        client.metrics.recordError();
      }
    }
  },

  // ✅ Autocomplétion adaptée au multi-serveurs
  async autocomplete(interaction, client) {
    try {
      const focusedValue = interaction.options.getFocused().toLowerCase().trim();
      
      console.log(`🔍 Autocomplétion modifier-description - Serveur: ${interaction.guild.name}, Recherche: "${focusedValue}"`);

      // Récupérer SEULEMENT les streamers de ce serveur
      const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
      
      console.log(`📊 Streamers sur ce serveur: ${guildStreamers?.length || 0}`);
      
      if (!Array.isArray(guildStreamers) || guildStreamers.length === 0) {
        console.log('⚠️ Aucun streamer sur ce serveur');
        return interaction.respond([]);
      }

      let filteredStreamers = guildStreamers;

      // Filtrer selon la recherche
      if (focusedValue) {
        filteredStreamers = guildStreamers.filter(streamer => {
          if (!streamer) return false;
          
          const twitchUsername = (streamer.twitch_username || '').toLowerCase();
          const displayName = (streamer.display_name || '').toLowerCase();
          
          return twitchUsername.includes(focusedValue) || displayName.includes(focusedValue);
        });
      }

      // Limiter à 25 résultats (limite Discord)
      const choices = filteredStreamers
        .slice(0, 25)
        .map(streamer => {
          const displayText = streamer.display_name || streamer.twitch_username;
          const valueText = streamer.twitch_username;
          
          // Afficher un aperçu du message actuel s'il existe
          let preview = '';
          if (streamer.custom_message) {
            const shortMessage = streamer.custom_message.substring(0, 30);
            preview = ` - "${shortMessage}${streamer.custom_message.length > 30 ? '...' : ''}"`;
          }
          
          return {
            name: `${displayText} (@${valueText})${preview}`,
            value: valueText
          };
        });

      console.log(`✅ Autocomplétion: ${choices.length} choix retournés`);
      
      await interaction.respond(choices);

    } catch (error) {
      console.error('❌ Erreur dans l\'autocomplétion modifier-description:', error);
      
      try {
        await interaction.respond([]);
      } catch (respondError) {
        console.error('❌ Erreur lors de la réponse d\'autocomplétion:', respondError);
      }
    }
  }
};