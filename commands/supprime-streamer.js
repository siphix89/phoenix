const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-streamer')
    .setDescription('Supprimer un streamer existant')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer à supprimer')
        .setRequired(true)
        .setAutocomplete(true)),
  
  async execute(interaction, client) {
    try {
      // Vérifier permissions
      if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ content: '❌ Permissions insuffisantes!', ephemeral: true });
      }

      const nom = interaction.options.getString('nom');

      // Validation des paramètres
      if (!nom) {
        return interaction.reply({ content: '❌ Nom du streamer manquant!', ephemeral: true });
      }

      console.log('=== DEBUG SUPPRESSION ===');
      console.log('Nom recherché:', nom);

      // Vérifier si le streamer existe - utiliser 'name' comme dans votre autre commande
      let streamerExiste = null;
      
      // Essayer getStreamerByName d'abord
      if (client.db?.getStreamerByName) {
        console.log('Tentative avec getStreamerByName...');
        streamerExiste = await client.db.getStreamerByName(nom);
        console.log('Résultat getStreamerByName:', streamerExiste);
      }
      
      // Si pas trouvé, chercher manuellement dans la liste
      if (!streamerExiste) {
        console.log('Recherche manuelle dans getAllStreamers...');
        const allStreamers = await client.db?.getAllStreamers?.() || [];
        streamerExiste = allStreamers.find(s => s.name === nom);
        console.log('Résultat recherche manuelle:', streamerExiste);
      }
      
      if (!streamerExiste) {
        console.log('Aucun streamer trouvé !');
        
        // Suggestion de noms similaires en cas d'erreur
        const allStreamers = await client.db?.getAllStreamers?.() || [];
        const similarStreamers = allStreamers
          .filter(s => s.name.toLowerCase().includes(nom.toLowerCase()) || 
                      nom.toLowerCase().includes(s.name.toLowerCase()))
          .slice(0, 3)
          .map(s => s.name);
        
        let errorMessage = `❌ Le streamer **${nom}** n'existe pas !`;
        
        if (similarStreamers.length > 0) {
          errorMessage += `\n\n**Streamers similaires trouvés :**\n${similarStreamers.map(s => `• ${s}`).join('\n')}`;
        }
        
        return interaction.reply({ content: errorMessage, ephemeral: true });
      }

      console.log('Streamer trouvé, tentative de suppression...');
      console.log('Méthodes disponibles dans client.db:', Object.getOwnPropertyNames(client.db.__proto__));
      
      // Supprimer de la DB - essayer différentes méthodes possibles
      let success = false;
      
      if (client.db?.removeStreamer) {
        console.log('Tentative avec removeStreamer...');
        success = await client.db.removeStreamer(nom);
        console.log('Résultat removeStreamer:', success);
      } else if (client.db?.deleteStreamer) {
        console.log('Tentative avec deleteStreamer...');
        success = await client.db.deleteStreamer(nom);
        console.log('Résultat deleteStreamer:', success);
      } else if (client.db?.removeStreamerByName) {
        console.log('Tentative avec removeStreamerByName...');
        success = await client.db.removeStreamerByName(nom);
        console.log('Résultat removeStreamerByName:', success);
      } else {
        console.log('Aucune méthode de suppression trouvée !');
        console.log('Méthodes DB disponibles:', Object.keys(client.db));
        
        // Dernière tentative - suppression directe en SQL si possible
        if (client.db?.run) {
          console.log('Tentative de suppression directe SQL...');
          try {
            const result = await client.db.run(
              'DELETE FROM streamers WHERE name = ?',
              [nom]
            );
            success = result.changes > 0;
            console.log('Résultat suppression SQL:', success, result);
          } catch (sqlError) {
            console.error('Erreur SQL:', sqlError);
          }
        }
      }

      if (success) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Streamer Supprimé')
          .setDescription(`**${nom}** a été supprimé avec succès !`)
          .setColor('Red')
          .addFields(
            { name: 'Action', value: 'Suppression', inline: true },
            { name: 'Streamer', value: nom, inline: true },
            { name: 'URL', value: streamerExiste.url || 'N/A', inline: true },
            { name: 'Statut', value: streamerExiste.status || 'N/A', inline: true },
            { name: 'Description', value: streamerExiste.description || 'Aucune', inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Logging
        client.metrics?.recordCommand?.('supprimer-streamer', interaction.user.id);
        console.log(`Streamer ${nom} supprimé par ${interaction.user.tag}`);

      } else {
        await interaction.reply({ content: '❌ Erreur lors de la suppression !', ephemeral: true });
      }
    } catch (error) {
      console.error('Erreur dans supprimer-streamer:', error);
      
      if (!interaction.replied) {
        await interaction.reply({ 
          content: '❌ Une erreur est survenue lors de la suppression !', 
          ephemeral: true 
        });
      }
    }
  },

  // Autocomplétion identique à votre commande modifier-description
  async autocomplete(interaction, client) {
    try {
      const focusedValue = interaction.options.getFocused();
      
      console.log('Autocomplétion - Valeur tapée:', focusedValue);

      // Récupérer la liste des streamers depuis la DB
      const streamers = await client.db?.getAllStreamers?.() || [];
      
      console.log('Autocomplétion - Streamers trouvés:', streamers.length);
      
      // Vérifier si streamers est un tableau valide
      if (!Array.isArray(streamers)) {
        console.warn('getAllStreamers n\'a pas retourné un tableau valide');
        return interaction.respond([]);
      }

      // Si aucune valeur tapée, retourner tous les streamers
      if (!focusedValue || focusedValue.trim() === '') {
        const allChoices = streamers.slice(0, 25).map(streamer => ({ 
          name: streamer.name,
          value: streamer.name 
        }));
        console.log('Autocomplétion - Tous les choix:', allChoices.length);
        return interaction.respond(allChoices);
      }

      // Filtrer les streamers selon ce que l'utilisateur tape
      const searchValue = focusedValue.toString().toLowerCase().trim();
      console.log('Valeur de recherche transformée:', `"${searchValue}"`);
      
      const filtered = streamers.filter(streamer => {
        if (!streamer || typeof streamer.name !== 'string') {
          console.log('Streamer invalide:', streamer);
          return false;
        }
        
        const streamerName = streamer.name.toLowerCase().trim();
        const match = streamerName.includes(searchValue);
        
        console.log(`Comparaison: "${streamerName}" contient "${searchValue}" ? ${match}`);
        
        return match;
      }).slice(0, 25);

      console.log('Autocomplétion - Résultats filtrés:', filtered.length);

      // Construire la réponse
      const choices = filtered.map(streamer => ({ 
        name: streamer.name,
        value: streamer.name 
      }));

      await interaction.respond(choices);

    } catch (error) {
      console.error('Erreur dans l\'autocomplétion supprimer-streamer:', error);
      
      // En cas d'erreur, retourner une liste vide pour éviter que Discord plante
      try {
        await interaction.respond([]);
      } catch (respondError) {
        console.error('Erreur lors de la réponse d\'autocomplétion:', respondError);
      }
    }
  }
};
