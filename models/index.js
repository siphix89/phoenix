const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

// Modèles de données
class StreamerData {
  constructor({
    name,
    url,
    status,
    description,
    createdAt = new Date(),
    updatedAt = new Date(),
    followers = 0,
    totalStreams = 0,
    totalHours = 0.0,
  }) {
    this.name = name;
    this.url = url;
    this.status = status;
    this.description = description;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.followers = followers;
    this.totalStreams = totalStreams;
    this.totalHours = totalHours;
  }

  toDict() {
    return {
      name: this.name,
      url: this.url,
      status: this.status,
      description: this.description,
      created_at: this.createdAt.toISOString(),
      updated_at: this.updatedAt.toISOString(),
      followers: this.followers,
      total_streams: this.totalStreams,
      total_hours: this.totalHours,
    };
  }
}

class StreamInfo {
  constructor({ title, game, viewerCount, startedAt, thumbnailUrl = "" }) {
    this.title = title;
    this.game = game;
    this.viewerCount = viewerCount;
    this.startedAt = startedAt;
    this.thumbnailUrl = thumbnailUrl;
  }
}

class BotMetrics {
  constructor() {
    this.startTime = new Date();
    this.commandsExecuted = 0;
    this.notificationsSent = 0;
    this.errorsEncountered = 0;
    this.uniqueUsersServed = new Set();
    this.mostUsedCommands = {};
  }

  recordCommand(commandName, userId) {
    this.commandsExecuted++;
    this.uniqueUsersServed.add(userId);
    if (!this.mostUsedCommands[commandName]) {
      this.mostUsedCommands[commandName] = 0;
    }
    this.mostUsedCommands[commandName]++;
  }

  recordError() {
    this.errorsEncountered++;
  }

  recordNotification() {
    this.notificationsSent++;
  }
}

// Gestionnaire pour les boutons de règlement
class RuleAcceptanceViewHandler {
  constructor(roleId, roleName, logger) {
    this.roleId = roleId;
    this.roleName = roleName;
    this.logger = logger;

    this.button = new ButtonBuilder()
      .setCustomId('accept_rules_button')
      .setLabel("✅ J'accepte le règlement")
      .setStyle(ButtonStyle.Success)
      .setEmoji('📋');

    this.actionRow = new ActionRowBuilder().addComponents(this.button);
  }

  getComponents() {
    return [this.actionRow];
  }

  async handleInteraction(interaction) {
    if (interaction.customId !== 'accept_rules_button') return;

    try {
      const guild = interaction.guild;
      if (!guild) return;

      const role = guild.roles.cache.get(this.roleId);
      if (!role) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Le rôle configuré est introuvable. Contactez un administrateur.')
          .setColor('Red');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      const member = interaction.member;
      if (!member) return;

      if (member.roles.cache.has(role.id)) {
        const embed = new EmbedBuilder()
          .setTitle('ℹ️ Déjà possédé')
          .setDescription(`Vous avez déjà le rôle **${role.name}** !`)
          .setColor('Blue');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      await member.roles.add(role, 'Acceptation du règlement');

      const embed = new EmbedBuilder()
        .setTitle('✅ Règlement accepté')
        .setDescription(`Félicitations ! Vous avez reçu le rôle **${role.name}** 🎉\n\nMerci d'avoir lu et accepté notre règlement !`)
        .setColor('Green')
        .addFields({
          name: '🎯 Que faire maintenant ?',
          value: '• Explorez les différents channels\n• Présentez-vous si vous le souhaitez\n• Rejoignez notre communauté !',
          inline: false,
        });

      await interaction.reply({ embeds: [embed], ephemeral: true });

      this.logger.info(`✅ Rôle '${role.name}' accordé à ${interaction.user.tag} (${interaction.user.id}) via bouton de règlement`);
    } catch (error) {
      if (error.code === 50013) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Permissions insuffisantes')
          .setDescription('Le bot n\'a pas les permissions pour accorder ce rôle. Contactez un administrateur.')
          .setColor('Red');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        this.logger.error(`❌ Permissions insuffisantes pour accorder le rôle ${this.roleName} à ${interaction.user.tag}`);
      } else {
        const embed = new EmbedBuilder()
          .setTitle('❌ Erreur inattendue')
          .setDescription('Une erreur s\'est produite. Contactez un administrateur.')
          .setColor('Red');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        this.logger.error(`❌ Erreur lors de l'attribution du rôle: ${error}`);
      }
    }
  }
}

module.exports = {
  StreamerData,
  StreamInfo,
  BotMetrics,
  RuleAcceptanceViewHandler,
};