const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const moment = require('moment');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reglement')
    .setDescription('Afficher le règlement du serveur'),

  async execute(interaction, client) {
    const embed = new EmbedBuilder()
      .setTitle('📋 RÈGLEMENT DU SERVEUR')
      .setDescription('Merci de lire et respecter ces règles pour maintenir une bonne ambiance ! 🌟')
      .setColor('Blue');

    const defaultRules = [
      { title: '1. 🤝 Respect mutuel', content: '• Soyez respectueux envers tous les membres\n• Pas d\'insultes, de harcèlement ou de discrimination\n• Traitez les autres comme vous aimeriez être traités' },
      { title: '2. 💬 Communication appropriée', content: '• Utilisez les bons channels pour vos messages\n• Pas de spam ou de flood\n• Évitez les CAPS LOCK excessifs\n• Restez dans le sujet des discussions' },
      { title: '3. 🔞 Contenu approprié', content: '• Aucun contenu NSFW ou inapproprié. Respectez les limites d\'âge de Discord (13+).' },
      { title: '4. 🎮 Streams ', content: '• Respectez les autres streamers\n• Vos streams serront mis automatiquement dans les channels appropriés' },
      { title: '5. 🤝 Le follow**', content: '• Vous n\'êtes forcé de follow personne. Suivez qui vous voulez, librement et sans pression.' }, 
      { title: '6. 🌙 Le lurk', content:  '• Laisser un lurk ne coûte rien : ouvrir la page Twitch en arrière-plan apporte du soutien à tout le monde.' },
      { title: '7. ⚖️anctions', content: '• **1ère fois:** Avertissement \n• **2ème fois:** Mute temporaire (1h-24h)\n• **3ème fois:** Kick temporaire\n• **Récidive:** Ban permanent\n• Les modérateurs ont le dernier mot' }
    ];

    for (const rule of defaultRules) {
      embed.addFields({ name: rule.title, value: rule.content });
    }

    embed.addFields({
      name: 'ℹ️ Informations importantes',
      value: '• En cas de problème, contactez un modérateur\n• Ce règlement peut être modifié à tout moment\n• L\'ignorance du règlement n\'excuse pas son non-respect'
    });

    embed.setFooter({
      text: 'Dernière mise à jour',
      iconURL: interaction.guild.iconURL() || undefined
    });
    embed.setTimestamp();

    // Ajout d'un bouton d'acceptation si configuré
    let components = [];
    if (client.config.rulesRoleId && client.config.rulesRoleId !== '0') {
      const button = new ButtonBuilder()
        .setCustomId('accept_rules')
        .setLabel(`Accepter et obtenir le rôle ${client.config.rulesRoleName || 'Membre Vérifié'}`)
        .setStyle(ButtonStyle.Success);

      components.push(new ActionRowBuilder().addComponents(button));
    }

    await interaction.reply({ embeds: [embed], components, ephemeral: true });

    client.metrics?.recordCommand?.('reglement', interaction.user.id);
  }
};
