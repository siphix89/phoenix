const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modifier-description')
    .setDescription('Modifier la description d\'un streamer')
    .addStringOption(option => 
      option.setName('nom')
        .setDescription('Nom du streamer à modifier')
        .setRequired(true)
        .setAutocomplete(true)) // Pour l'autocomplétion des streamers existants
    .addStringOption(option =>
      option.setName('nouvelle-description')
        .setDescription('Nouvelle description du streamer')
        .setRequired(true)),
  
  async execute(interaction, client) {
    try {
      // Vérifier permissions
      if (!interaction.member.permissions.has('ManageGuild')) {
        return interaction.reply({ content: '❌ Permissions insuffisantes!', ephemeral: true });
      }

      const nom = interaction.options.getString('nom');
      const nouvelleDescription = interaction.options.getString('nouvelle-description');

      // Validation des paramètres
      if (!nom || !nouvelleDescription) {
        return interaction.reply({ content: '❌ Paramètres manquants!', ephemeral: true });
      }

      console.log('=== DEBUG MODIFICATION ===');
      console.log('Nom recherché:', nom);
      console.log('Nouvelle description:', nouvelleDescription);

      // Vérifier si le streamer existe - CORRIGÉ: chercher par 'name'
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
        return interaction.reply({ content: `❌ Aucun streamer trouvé avec le nom "${nom}"!`, ephemeral: true });
      }

      console.log('Streamer trouvé, tentative de modification...');
      console.log('Méthodes disponibles dans client.db:', Object.getOwnPropertyNames(client.db.__proto__));
      
      // Modifier la description en DB
      let success = false;
      
      // Essayer différentes méthodes possibles
      if (client.db?.updateStreamerDescription) {
        console.log('Tentative avec updateStreamerDescription...');
        success = await client.db.updateStreamerDescription(nom, nouvelleDescription);
        console.log('Résultat updateStreamerDescription:', success);
      } else if (client.db?.updateStreamer) {
        console.log('Tentative avec updateStreamer...');
        success = await client.db.updateStreamer(nom, { description: nouvelleDescription });
        console.log('Résultat updateStreamer:', success);
      } else if (client.db?.modifyStreamer) {
        console.log('Tentative avec modifyStreamer...');
        success = await client.db.modifyStreamer(nom, { description: nouvelleDescription });
        console.log('Résultat modifyStreamer:', success);
      } else if (client.db?.editStreamer) {
        console.log('Tentative avec editStreamer...');
        success = await client.db.editStreamer(nom, { description: nouvelleDescription });
        console.log('Résultat editStreamer:', success);
      } else {
        console.log('Aucune méthode de modification trouvée !');
        console.log('Méthodes DB disponibles:', Object.keys(client.db));
        
        // Dernière tentative - modification directe en SQL si possible
        if (client.db?.run) {
          console.log('Tentative de modification directe SQL...');
          try {
            const result = await client.db.run(
              'UPDATE streamers SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?',
              [nouvelleDescription, nom]
            );
            success = result.changes > 0;
            console.log('Résultat modification SQL:', success, result);
          } catch (sqlError) {
            console.error('Erreur SQL:', sqlError);
          }
        }
      }

      if (success) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Description Modifiée')
          .setDescription(`La description de **${nom}** a été mise à jour !`)
          .setColor('Blue')
          .addFields(
            { name: 'Streamer', value: nom, inline: true },
            { name: 'Ancienne description', value: streamerExiste.description || 'Aucune', inline: false },
            { name: 'Nouvelle description', value: nouvelleDescription, inline: false },
            { name: 'URL', value: streamerExiste.url, inline: true },
            { name: 'Statut', value: streamerExiste.status, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Enregistrer métrique et logger
        client.metrics?.recordCommand?.('modifier-description', interaction.user.id);
        console.log(`Description du streamer ${nom} modifiée par ${interaction.user.tag}`);

      } else {
        await interaction.reply({ content: '❌ Erreur lors de la modification !', ephemeral: true });
      }
    } catch (error) {
      console.error('Erreur dans modifier-description:', error);
      
      if (!interaction.replied) {
        await interaction.reply({ 
          content: '❌ Une erreur est survenue lors de la modification !', 
          ephemeral: true 
        });
      }
    }
  },

  // Autocomplétion corrigée - utiliser 'name' au lieu de 'nom'
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
          name: streamer.name, // CORRIGÉ: utiliser 'name' au lieu de 'nom'
          value: streamer.name 
        }));
        console.log('Autocomplétion - Tous les choix:', allChoices.length);
        return interaction.respond(allChoices);
      }

      // Filtrer les streamers selon ce que l'utilisateur tape
      const searchValue = focusedValue.toString().toLowerCase().trim();
      console.log('Valeur de recherche transformée:', `"${searchValue}"`);
      
      const filtered = streamers.filter(streamer => {
        // CORRIGÉ: utiliser 'name' au lieu de 'nom'
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
        name: streamer.name, // CORRIGÉ: utiliser 'name' au lieu de 'nom'
        value: streamer.name 
      }));

      await interaction.respond(choices);

    } catch (error) {
      console.error('Erreur dans l\'autocomplétion modifier-description:', error);
      
      // En cas d'erreur, retourner une liste vide pour éviter que Discord plante
      try {
        await interaction.respond([]);
      } catch (respondError) {
        console.error('Erreur lors de la réponse d\'autocomplétion:', respondError);
      }
    }
  }
};