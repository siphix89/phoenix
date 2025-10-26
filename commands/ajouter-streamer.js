const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ajouter-streamer')
    .setDescription('Ajouter un nouveau streamer à suivre sur ce serveur')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom d\'utilisateur Twitch (sans https://)')
        .setRequired(true)
        .setMaxLength(25)
        .setMinLength(4))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Description personnalisée du streamer (optionnel)')
        .setRequired(false)
        .setMaxLength(500)),
  
  async execute(interaction, client) {
    try {
      // Vérifier permissions
      if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ 
          content: '❌ Vous devez avoir la permission "Gérer le serveur" pour utiliser cette commande!', 
          flags: 64
        });
      }

      await interaction.deferReply();

      const inputName = interaction.options.getString('nom').trim();
      const customDescription = interaction.options.getString('description');

      // Extraire le nom d'utilisateur depuis une URL ou utiliser directement
      let twitchUsername;
      if (inputName.includes('twitch.tv/')) {
        twitchUsername = inputName.split('/').pop().toLowerCase();
      } else {
        twitchUsername = inputName.toLowerCase();
      }

      // Validation du nom d'utilisateur Twitch
      if (!/^[a-z0-9_]{4,25}$/.test(twitchUsername)) {
        return await interaction.editReply({
          content: '❌ Le nom d\'utilisateur Twitch doit contenir entre 4 et 25 caractères (lettres, chiffres et underscore uniquement).'
        });
      }

      // Vérifier si le streamer existe déjà sur ce serveur
      const guildStreamers = await client.db.getGuildStreamers(interaction.guildId);
      const existingStreamer = guildStreamers.find(s => s.twitch_username === twitchUsername);
      
      if (existingStreamer) {
        return await interaction.editReply({
          content: `❌ **${existingStreamer.display_name || existingStreamer.name}** (@${twitchUsername}) est déjà suivi sur ce serveur !`
        });
      }

      // Vérifier si le streamer existe sur Twitch
      let twitchUserData = null;
      try {
        if (client.twitch && client.twitch.accessToken) {
          const response = await fetch(`https://api.twitch.tv/helix/users?login=${twitchUsername}`, {
            headers: {
              'Client-ID': client.config.twitchClientId,
              'Authorization': `Bearer ${client.twitch.accessToken}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.data && data.data.length > 0) {
              twitchUserData = data.data[0];
            } else {
              return await interaction.editReply({
                content: `⚠️ Le compte Twitch **${twitchUsername}** n'existe pas. Vérifiez l'orthographe !`
              });
            }
          }
        }
      } catch (apiError) {
        console.log('⚠️ Impossible de vérifier sur Twitch:', apiError.message);
      }

      // Ajouter le streamer à la base multi-serveurs
      const result = await client.db.addStreamerToGuild(
        interaction.guildId,
        twitchUsername,
        interaction.user.id,
        customDescription
      );

      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Streamer ajouté avec succès !')
          .setColor(Colors.Green)
          .addFields(
            { 
              name: '👤 Streamer', 
              value: twitchUserData 
                ? `**${twitchUserData.display_name}** (@${twitchUsername})`
                : `**${twitchUsername}** (@${twitchUsername})`,
              inline: false 
            },
            { 
              name: '🔗 Lien Twitch', 
              value: `https://twitch.tv/${twitchUsername}`, 
              inline: false 
            }
          )
          .setFooter({ 
            text: `Ajouté par ${interaction.user.displayName}`,
            iconURL: interaction.user.displayAvatarURL()
          })
          .setTimestamp();

        if (twitchUserData) {
          if (twitchUserData.description) {
            embed.addFields({
              name: '📝 Bio Twitch',
              value: twitchUserData.description.substring(0, 200) + (twitchUserData.description.length > 200 ? '...' : ''),
              inline: false
            });
          }
          
          if (twitchUserData.profile_image_url) {
            embed.setThumbnail(twitchUserData.profile_image_url);
          }
        }

        if (customDescription) {
          embed.addFields({
            name: '📋 Message personnalisé',
            value: customDescription,
            inline: false
          });
        }

        // Utiliser la liste déjà récupérée + 1 pour le nouveau streamer
        embed.addFields({
          name: '📊 Serveur',
          value: `${guildStreamers.length + 1} streamer(s) suivi(s) sur ce serveur`,
          inline: true
        });

        // Message d'aide pour les notifications
        const guildConfig = await client.db.getGuild(interaction.guildId);
        if (!guildConfig?.notification_channel_id) {
          embed.addFields({
            name: '💡 Configuration',
            value: 'Utilisez `/setchannel` dans un channel pour configurer les notifications !',
            inline: false
          });
        }

        await interaction.editReply({ embeds: [embed] });

        if (client.metrics?.recordCommand) {
          client.metrics.recordCommand('ajouter-streamer', interaction.user.id);
        }
        
        console.log(`✅ Streamer ${twitchUsername} ajouté par ${interaction.user.tag} sur ${interaction.guild.name}`);

      } else {
        let errorMessage = '❌ Erreur lors de l\'ajout du streamer.';
        
        if (result.error) {
          if (result.error.includes('déjà suivi')) {
            errorMessage = `❌ Ce streamer est déjà suivi sur ce serveur !`;
          } else {
            errorMessage = `❌ ${result.error}`;
          }
        }

        await interaction.editReply({ content: errorMessage });
      }

    } catch (error) {
      console.error('❌ Erreur dans ajouter-streamer:', error);
      
      const errorMessage = {
        content: '❌ Une erreur est survenue lors de l\'ajout du streamer. Veuillez réessayer.',
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
  }
};