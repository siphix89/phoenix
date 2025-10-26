const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-streamer')
    .setDescription('Supprimer un streamer suivi sur ce serveur')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer à supprimer')
        .setRequired(true)
        .setAutocomplete(true)),
  
  async execute(interaction, client) {
    try {
      if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ 
          content: '❌ Vous devez avoir la permission "Gérer le serveur" pour utiliser cette commande!', 
          flags: 64
        });
      }

      await interaction.deferReply();

      const inputName = interaction.options.getString('nom').trim();

      let twitchUsername;
      if (inputName.includes('twitch.tv/')) {
        twitchUsername = inputName.split('/').pop().toLowerCase();
      } else {
        twitchUsername = inputName.toLowerCase();
      }

      console.log(`🔍 Recherche du streamer "${twitchUsername}" sur le serveur ${interaction.guild.name}`);

      const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
      
      if (!guildStreamers || guildStreamers.length === 0) {
        return await interaction.editReply({
          content: '❌ Aucun streamer n\'est suivi sur ce serveur ! Utilisez `/ajouter-streamer` pour en ajouter.'
        });
      }

      const streamerToRemove = guildStreamers.find(s => 
        s.twitch_username === twitchUsername || 
        s.name?.toLowerCase() === twitchUsername ||
        s.display_name?.toLowerCase() === twitchUsername
      );

      if (!streamerToRemove) {
        const similarStreamers = guildStreamers
          .filter(s => {
            const streamerName = (s.twitch_username || s.name || '').toLowerCase();
            const displayName = (s.display_name || '').toLowerCase();
            const search = twitchUsername.toLowerCase();
            
            return streamerName.includes(search) || 
                   displayName.includes(search) ||
                   search.includes(streamerName) ||
                   search.includes(displayName);
          })
          .slice(0, 5);

        let errorMessage = `❌ Le streamer **${inputName}** n'est pas suivi sur ce serveur !`;
        
        if (similarStreamers.length > 0) {
          errorMessage += `\n\n**Streamers similaires sur ce serveur :**\n${similarStreamers.map(s => 
            `• **${s.display_name || s.name}** (@${s.twitch_username})`
          ).join('\n')}`;
        }
        
        errorMessage += `\n\n💡 Utilisez l'autocomplétion ou \`/streamers\` pour voir tous les streamers suivis.`;
        
        return await interaction.editReply({ content: errorMessage });
      }

      console.log(`✅ Streamer trouvé:`, streamerToRemove);

      const result = await client.db.removeStreamerFromGuild(
        interaction.guildId, 
        streamerToRemove.twitch_username
      );

      if (result.success) {
        let twitchUserData = null;
        try {
          if (client.twitch && client.twitch.accessToken) {
            const response = await fetch(`https://api.twitch.tv/helix/users?login=${streamerToRemove.twitch_username}`, {
              headers: {
                'Client-ID': client.config.twitchClientId,
                'Authorization': `Bearer ${client.twitch.accessToken}`
              }
            });

            if (response.ok) {
              const data = await response.json();
              if (data.data && data.data.length > 0) {
                twitchUserData = data.data[0];
              }
            }
          }
        } catch (apiError) {
          console.log('⚠️ Impossible de récupérer les données Twitch:', apiError.message);
        }

        const embed = new EmbedBuilder()
          .setTitle('✅ Streamer supprimé avec succès !')
          .setColor(Colors.Red)
          .addFields(
            { 
              name: '👤 Streamer supprimé', 
              value: twitchUserData 
                ? `**${twitchUserData.display_name}** (@${streamerToRemove.twitch_username})`
                : `**${streamerToRemove.display_name || streamerToRemove.name || streamerToRemove.twitch_username}** (@${streamerToRemove.twitch_username})`,
              inline: false 
            },
            { 
              name: '🔗 Lien Twitch', 
              value: `https://twitch.tv/${streamerToRemove.twitch_username}`, 
              inline: false 
            }
          )
          .setFooter({ 
            text: `Supprimé par ${interaction.user.displayName}`,
            iconURL: interaction.user.displayAvatarURL()
          })
          .setTimestamp();

        if (streamerToRemove.custom_message) {
          embed.addFields({
            name: '📋 Message personnalisé',
            value: streamerToRemove.custom_message,
            inline: false
          });
        }

        if (twitchUserData?.profile_image_url) {
          embed.setThumbnail(twitchUserData.profile_image_url);
        }

        // Utiliser le compteur déjà récupéré - 1 pour le streamer supprimé
        const remainingCount = guildStreamers.length - 1;
        embed.addFields({
          name: '📊 Serveur',
          value: `${remainingCount} streamer(s) suivi(s) restant(s) sur ce serveur`,
          inline: true
        });

        await interaction.editReply({ embeds: [embed] });

        if (client.metrics?.recordCommand) {
          client.metrics.recordCommand('supprimer-streamer', interaction.user.id);
        }
        
        console.log(`✅ Streamer ${streamerToRemove.twitch_username} supprimé par ${interaction.user.tag} sur ${interaction.guild.name}`);

      } else {
        let errorMessage = '❌ Erreur lors de la suppression du streamer.';
        
        if (result.error) {
          if (result.error.includes('pas trouvé') || result.error.includes('non trouvé')) {
            errorMessage = `❌ Ce streamer n'est plus suivi sur ce serveur !`;
          } else {
            errorMessage = `❌ ${result.error}`;
          }
        }

        await interaction.editReply({ content: errorMessage });
      }

    } catch (error) {
      console.error('❌ Erreur dans supprimer-streamer:', error);
      
      const errorMessage = {
        content: '❌ Une erreur est survenue lors de la suppression du streamer. Veuillez réessayer.',
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

  async autocomplete(interaction, client) {
    try {
      const focusedValue = interaction.options.getFocused().toLowerCase().trim();
      
      console.log(`🔍 Autocomplétion suppression - Serveur: ${interaction.guild.name}, Recherche: "${focusedValue}"`);

      const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
      
      console.log(`📊 Streamers sur ce serveur: ${guildStreamers?.length || 0}`);
      
      if (!Array.isArray(guildStreamers) || guildStreamers.length === 0) {
        console.log('⚠️ Aucun streamer sur ce serveur');
        return interaction.respond([]);
      }

      let filteredStreamers = guildStreamers;

      if (focusedValue) {
        filteredStreamers = guildStreamers.filter(streamer => {
          if (!streamer) return false;
          
          const twitchUsername = (streamer.twitch_username || '').toLowerCase();
          const displayName = (streamer.display_name || '').toLowerCase();
          const name = (streamer.name || '').toLowerCase();
          
          return twitchUsername.includes(focusedValue) || 
                 displayName.includes(focusedValue) ||
                 name.includes(focusedValue);
        });
      }

      const choices = filteredStreamers
        .slice(0, 25)
        .map(streamer => {
          const displayText = streamer.display_name || streamer.name || streamer.twitch_username;
          const valueText = streamer.twitch_username;
          
          return {
            name: `${displayText} (@${valueText})`,
            value: valueText
          };
        });

      console.log(`✅ Autocomplétion: ${choices.length} choix retournés`);
      
      await interaction.respond(choices);

    } catch (error) {
      console.error('❌ Erreur dans l\'autocomplétion supprimer-streamer:', error);
      
      try {
        await interaction.respond([]);
      } catch (respondError) {
        console.error('❌ Erreur lors de la réponse d\'autocomplétion:', respondError);
      }
    }
  }
};