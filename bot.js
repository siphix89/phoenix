// ===== bot.js - Phoenix Bot Rewrite =====
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  Colors, 
  ActivityType, 
  Collection,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const path = require('path');
const fs = require('fs');

// Imports des modules avec gestion d'erreurs améliorée
const DatabaseManager = require('./database/databasemanager.js');
const { BotConfig, logger } = require('./config');

// Imports conditionnels
let TwitchManager = null;
let NotificationManager = null;

try {
  TwitchManager = require('./twitch/twitchManager');
  logger.info('✅ TwitchManager chargé');
} catch (error) {
  logger.warn('⚠️ TwitchManager non disponible - fonctionnalités Twitch désactivées');
}

try {
  NotificationManager = require('./notifications');
  logger.info('✅ NotificationManager chargé');
} catch (error) {
  logger.warn('⚠️ NotificationManager non disponible - notifications désactivées');
}

class PhoenixBot extends Client {
  constructor(config) {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [
        Partials.Message, 
        Partials.Channel, 
        Partials.Reaction
      ],
    });

    // Configuration
    this.config = config;
    this.botReady = false;
    
    // Gestionnaires
    this.database = new DatabaseManager('streamers.db', logger);
    this.twitch = null;
    this.notifications = null;
    
    // Collections
    this.commands = new Collection();
    this.liveStreamers = new Map();
    this.liveMessages = new Map();
    
    // Intervalles
    this.streamCheckInterval = null;
    
    // Métriques
    this.metrics = {
      commandsExecuted: 0,
      errorsCount: 0,
      startTime: Date.now()
    };

    this.setupEventHandlers();
  }

  // ===============================
  // SETUP ET INITIALISATION
  // ===============================

  setupEventHandlers() {
    // Événements principaux
    this.once('ready', this.handleReady.bind(this));
    this.on('guildMemberAdd', this.handleMemberJoin.bind(this));
    this.on('messageCreate', this.handleMessage.bind(this));
    this.on('interactionCreate', this.handleInteraction.bind(this));
    
    // Gestion des erreurs
    this.on('error', this.handleError.bind(this));
    this.on('warn', this.handleWarning.bind(this));
    
    // Gestion de la déconnexion
    this.on('disconnect', () => {
      logger.warn('⚠️ Bot déconnecté');
      this.botReady = false;
    });

    this.on('reconnecting', () => {
      logger.info('🔄 Reconnexion en cours...');
    });
  }

  async handleReady() {
    logger.info(`🤖 ${this.user.tag} est maintenant en ligne!`);
    
    try {
      // 1. Initialiser la base de données
      await this.initializeDatabase();
      
      // 2. Charger les commandes
      await this.loadCommands();
      
      // 3. Initialiser Twitch si disponible
      await this.initializeTwitch();
      
      // 4. Initialiser les notifications si disponible
      await this.initializeNotifications();
      
      // 5. Enregistrer les commandes slash
      await this.registerSlashCommands();
      
      // 6. Configurer le statut
      await this.updateBotStatus();
      
      // 7. Démarrer la surveillance des streams si configuré
      if (this.config.autoNotifications) {
        await this.startStreamMonitoring();
      }
      
      this.botReady = true;
      logger.info('✅ Bot entièrement initialisé et prêt!');
      
    } catch (error) {
      logger.error(`❌ Erreur lors de l'initialisation: ${error.message}`);
      this.metrics.errorsCount++;
    }
  }

  async initializeDatabase() {
    try {
      await this.database.connect();
      await this.database.initDatabase();
      logger.info('✅ Base de données initialisée');
    } catch (error) {
      logger.error(`❌ Erreur base de données: ${error.message}`);
      throw error;
    }
  }

  async loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    
    if (!fs.existsSync(commandsPath)) {
      logger.warn('📁 Dossier commands non trouvé');
      return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    let loadedCount = 0;

    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        
        if (command.data && command.execute) {
          this.commands.set(command.data.name, command);
          loadedCount++;
          logger.info(`✅ Commande "${command.data.name}" chargée`);
        } else {
          logger.warn(`⚠️ Commande "${file}" incomplète (manque data ou execute)`);
        }
      } catch (error) {
        logger.error(`❌ Erreur chargement commande "${file}": ${error.message}`);
      }
    }

    logger.info(`📦 ${loadedCount} commandes chargées`);
  }

  async initializeTwitch() {
    if (!TwitchManager) {
      logger.info('ℹ️ TwitchManager non disponible');
      return;
    }

    if (!this.config.twitchClientId || !this.config.twitchClientSecret) {
      logger.warn('⚠️ Credentials Twitch manquants');
      return;
    }

    try {
      this.twitch = new TwitchManager(this.config, logger);
      await this.twitch.initClient();
      logger.info('✅ Client Twitch initialisé');
    } catch (error) {
      logger.error(`❌ Erreur initialisation Twitch: ${error.message}`);
      this.twitch = null;
    }
  }

  async initializeNotifications() {
    if (!NotificationManager || !this.twitch) {
      logger.info('ℹ️ NotificationManager ou Twitch non disponible');
      return;
    }

    try {
      this.notifications = new NotificationManager(this);
      logger.info('✅ NotificationManager initialisé');
    } catch (error) {
      logger.error(`❌ Erreur initialisation notifications: ${error.message}`);
      this.notifications = null;
    }
  }

  async registerSlashCommands() {
    try {
      const commandsData = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());
      await this.application.commands.set(commandsData);
      logger.info(`⚡ ${commandsData.length} commandes slash synchronisées`);
    } catch (error) {
      logger.error(`❌ Erreur synchronisation commandes: ${error.message}`);
    }
  }

  async updateBotStatus() {
    try {
      const streamersCount = (await this.database.getAllStreamers()).length;
      const liveCount = this.liveStreamers.size;
      
      await this.user.setPresence({
        activities: [{ 
          name: `${streamersCount} streamers | ${liveCount} live`, 
          type: ActivityType.Watching 
        }],
        status: 'online',
      });
      
      logger.info(`📊 Statut mis à jour: ${streamersCount} streamers, ${liveCount} live`);
    } catch (error) {
      logger.error(`❌ Erreur mise à jour statut: ${error.message}`);
    }
  }

  // ===============================
  // GESTION DES ÉVÉNEMENTS
  // ===============================

  async handleMemberJoin(member) {
    logger.info(`👋 Nouveau membre: ${member.user.tag} (${member.id})`);
    
    try {
      // Attribution automatique du rôle
      await this.assignAutoRole(member);
      
      // Message de bienvenue
      await this.sendWelcomeMessage(member);
      
    } catch (error) {
      logger.error(`❌ Erreur gestion nouveau membre ${member.user.tag}: ${error.message}`);
      this.metrics.errorsCount++;
    }
  }

  async assignAutoRole(member) {
    // Vérifier la configuration
    if (!this.config.autoRoleId || this.config.autoRoleId === '0') {
      logger.info('ℹ️ Auto-rôle non configuré');
      return;
    }

    try {
      const roleId = this.config.autoRoleId.toString();
      logger.info(`🔍 Recherche du rôle ID: ${roleId}`);
      
      // Trouver le rôle
      const role = member.guild.roles.cache.get(roleId);
      if (!role) {
        logger.error(`❌ Rôle ${roleId} non trouvé dans le serveur`);
        this.logAvailableRoles(member.guild);
        return;
      }

      // Vérifier les permissions du bot
      const botMember = member.guild.members.cache.get(this.user.id);
      if (!botMember) {
        logger.error(`❌ Impossible de trouver le bot dans le serveur`);
        return;
      }

      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        logger.error(`❌ Le bot n'a pas la permission "Gérer les rôles"`);
        return;
      }

      // Vérifier la hiérarchie des rôles
      if (role.position >= botMember.roles.highest.position) {
        logger.error(`❌ Le rôle "${role.name}" (pos: ${role.position}) est trop haut`);
        logger.error(`   Le bot est à la position: ${botMember.roles.highest.position}`);
        return;
      }

      // Attribuer le rôle
      logger.info(`🎭 Attribution du rôle "${role.name}" à ${member.user.tag}...`);
      await member.roles.add(role, 'Attribution automatique à l\'arrivée');
      
      logger.info(`✅ Rôle "${role.name}" attribué avec succès à ${member.user.tag}`);

    } catch (error) {
      logger.error(`❌ Erreur attribution auto-rôle: ${error.message}`);
      if (error.code) {
        logger.error(`   Code d'erreur Discord: ${error.code}`);
      }
      this.metrics.errorsCount++;
    }
  }

  logAvailableRoles(guild) {
    logger.info(`📋 Rôles disponibles dans "${guild.name}":`);
    guild.roles.cache
      .sort((a, b) => b.position - a.position)
      .forEach(role => {
        if (role.name !== '@everyone') {
          logger.info(`   - ${role.name} (ID: ${role.id}, Position: ${role.position})`);
        }
      });
  }

  async sendWelcomeMessage(member) {
    if (!this.config.welcomeChannel) {
      logger.info('ℹ️ Canal de bienvenue non configuré');
      return;
    }

    try {
      const welcomeChannel = this.channels.cache.get(this.config.welcomeChannel.toString());
      if (!welcomeChannel) {
        logger.error(`❌ Canal de bienvenue ${this.config.welcomeChannel} non trouvé`);
        return;
      }

      const streamersCount = (await this.database.getAllStreamers()).length;
      const roleText = this.getAutoRoleText(member.guild);

      const embed = new EmbedBuilder()
        .setTitle('🎉 Bienvenue sur le serveur !')
        .setDescription(`Salut ${member.toString()} ! Nous sommes ravis de t'accueillir parmi nous ! 🚀${roleText}`)
        .setColor(Colors.Green)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          {
            name: '📋 Prochaines étapes',
            value: '• Lis le règlement\n• Présente-toi si tu le souhaites\n• Explore les différents canaux',
            inline: false,
          },
          {
            name: '📊 Statistiques du serveur',
            value: `👥 **${member.guild.memberCount}** membres\n🎮 **${streamersCount}** streamers`,
            inline: true,
          }
        )
        .setFooter({
          text: `Membre #${member.guild.memberCount}`,
          iconURL: member.guild.iconURL({ dynamic: true }) || undefined,
        })
        .setTimestamp();

      await welcomeChannel.send({ 
        content: `🎊 Tout le monde, accueillons ${member.toString()} !`, 
        embeds: [embed] 
      });

      logger.info(`✅ Message de bienvenue envoyé pour ${member.user.tag}`);

    } catch (error) {
      logger.error(`❌ Erreur envoi message de bienvenue: ${error.message}`);
      this.metrics.errorsCount++;
    }
  }

  getAutoRoleText(guild) {
    if (!this.config.autoRoleId || this.config.autoRoleId === '0') {
      return '';
    }

    const role = guild.roles.cache.get(this.config.autoRoleId.toString());
    return role ? `\n🎭 Rôle **${role.name}** attribué automatiquement` : '';
  }

  async handleMessage(message) {
    if (message.author.bot) return;

    try {
      const content = message.content.toLowerCase().trim();
      
      // Réponses automatiques simples
      const responses = {
        'stream': '🎮 Découvre nos streamers avec `/streamers list` !',
        'live': '🔴 Vois qui est en live avec `/live` !',
        'help': '❓ Utilise `/help` pour voir toutes les commandes !',
        'ping': '🏓 Pong!'
      };

      if (responses[content]) {
        const embed = new EmbedBuilder()
          .setDescription(`👋 Salut ${message.author.toString()} ! ${responses[content]}`)
          .setColor(Colors.Blue);
          
        await message.reply({ 
          embeds: [embed], 
          allowedMentions: { repliedUser: false } 
        });
      }

    } catch (error) {
      logger.error(`❌ Erreur traitement message: ${error.message}`);
      this.metrics.errorsCount++;
    }
  }

  async handleInteraction(interaction) {
    try {
      // Vérifier si l'interaction est encore valide
      if (interaction.replied || interaction.deferred) {
        logger.warn('⚠️ Interaction déjà traitée');
        return;
      }

      // Gérer les commandes slash
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      }
      
      // Gérer l'autocomplétion
      else if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      }
      
      // Gérer les boutons
      else if (interaction.isButton()) {
        await this.handleButton(interaction);
      }

    } catch (error) {
      logger.error(`❌ Erreur traitement interaction: ${error.message}`);
      this.metrics.errorsCount++;
      
      // Tenter de répondre avec un message d'erreur
      try {
        const errorEmbed = new EmbedBuilder()
          .setDescription('❌ Une erreur est survenue lors du traitement de votre demande.')
          .setColor(Colors.Red);

        if (interaction.deferred) {
          await interaction.editReply({ embeds: [errorEmbed] });
        } else if (!interaction.replied) {
          await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
      } catch (replyError) {
        logger.error(`❌ Impossible de répondre à l'interaction: ${replyError.message}`);
      }
    }
  }

  async handleSlashCommand(interaction) {
    const command = this.commands.get(interaction.commandName);
    
    if (!command) {
      logger.error(`❌ Commande inconnue: ${interaction.commandName}`);
      return;
    }

    this.metrics.commandsExecuted++;
    
    try {
      await command.execute(interaction, this);
      logger.info(`✅ Commande "${interaction.commandName}" exécutée par ${interaction.user.tag}`);
    } catch (error) {
      logger.error(`❌ Erreur exécution commande "${interaction.commandName}": ${error.message}`);
      throw error;
    }
  }

  async handleAutocomplete(interaction) {
    const command = this.commands.get(interaction.commandName);
    
    if (command && command.autocomplete) {
      try {
        await command.autocomplete(interaction, this);
      } catch (error) {
        logger.error(`❌ Erreur autocomplétion "${interaction.commandName}": ${error.message}`);
      }
    }
  }

  async handleButton(interaction) {
    // Gérer les boutons du dashboard
    if (['refresh_dashboard', 'bot_settings', 'view_streamers'].includes(interaction.customId)) {
      await this.handleDashboardButton(interaction);
    }
    
    // Gérer les boutons de règlement
    else if (interaction.customId.startsWith('accept_rules_')) {
      const reglementCommand = this.commands.get('reglement-dashboard');
      if (reglementCommand && reglementCommand.handleButtonInteraction) {
        await reglementCommand.handleButtonInteraction(interaction, this);
      }
    }
  }

  async handleDashboardButton(interaction) {
    // Vérifier les permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      const embed = new EmbedBuilder()
        .setDescription('❌ Vous devez être administrateur pour utiliser cette fonctionnalité.')
        .setColor(Colors.Red);
        
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    switch (interaction.customId) {
      case 'refresh_dashboard':
        await this.refreshDashboard(interaction);
        break;
      case 'bot_settings':
        await this.showBotSettings(interaction);
        break;
      case 'view_streamers':
        await this.showStreamers(interaction);
        break;
    }
  }

  async refreshDashboard(interaction) {
    const streamersCount = (await this.database.getAllStreamers()).length;
    const uptime = Math.floor(this.uptime / 1000);

    const embed = new EmbedBuilder()
      .setTitle('🔥 Phoenix Bot Dashboard (Actualisé)')
      .setDescription(`Tableau de bord de **${this.user.username}**`)
      .addFields(
        { name: '🖥️ Serveurs', value: `${this.guilds.cache.size}`, inline: true },
        { name: '👥 Utilisateurs', value: `${this.users.cache.size.toLocaleString()}`, inline: true },
        { name: '🎮 Streamers totaux', value: `${streamersCount}`, inline: true },
        { name: '🔴 En live', value: `${this.liveStreamers.size}`, inline: true },
        { name: '⏱️ Uptime', value: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`, inline: true },
        { name: '📡 Ping', value: `${this.ws.ping}ms`, inline: true }
      )
      .setColor(Colors.Green)
      .setThumbnail(this.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('🔄 Actualiser')
          .setStyle(ButtonStyle.Primary)
          .setCustomId('refresh_dashboard'),
        new ButtonBuilder()
          .setLabel('⚙️ Informations système')
          .setStyle(ButtonStyle.Secondary)
          .setCustomId('bot_settings'),
        new ButtonBuilder()
          .setLabel('📊 Voir streamers')
          .setStyle(ButtonStyle.Success)
          .setCustomId('view_streamers')
      );

    await interaction.update({ embeds: [embed], components: [buttons] });
  }

  async showBotSettings(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Informations Système - Phoenix Bot')
      .setDescription('Configuration et état actuel du système')
      .addFields(
        { name: '🔧 Version', value: 'Phoenix Bot v2.1.0', inline: true },
        { name: '📅 Démarré', value: `<t:${Math.floor(this.metrics.startTime / 1000)}:R>`, inline: true },
        { name: '💾 Mémoire', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true },
        { name: '🐧 Plateforme', value: process.platform, inline: true },
        { name: '📡 Latence WS', value: `${this.ws.ping}ms`, inline: true },
        { name: '🔗 Node.js', value: process.version, inline: true },
        { name: '📊 Commandes exécutées', value: `${this.metrics.commandsExecuted}`, inline: true },
        { name: '❌ Erreurs', value: `${this.metrics.errorsCount}`, inline: true },
        { name: '🔔 Notifications', value: this.notifications ? '✅ Actives' : '❌ Inactives', inline: true }
      )
      .setColor(Colors.Gold)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async showStreamers(interaction) {
    const streamers = await this.database.getAllStreamers();
    
    if (streamers.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📊 Liste des Streamers')
        .setDescription('Aucun streamer enregistré pour le moment.')
        .setColor(Colors.Orange);
        
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const liveStreamers = Array.from(this.liveStreamers.keys());
    const streamersText = streamers.slice(0, 15).map(streamer => {
      const isLive = liveStreamers.includes(streamer.name);
      const status = isLive ? '🔴 **LIVE**' : '⚫ Hors ligne';
      return `• **${streamer.name}** - ${status}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('📊 Liste des Streamers')
      .setDescription(streamersText)
      .addFields(
        { 
          name: '📈 Statistiques', 
          value: `**${streamers.length}** streamers • **${liveStreamers.length}** en live`, 
          inline: false 
        }
      )
      .setColor(Colors.Aqua)
      .setTimestamp();

    if (streamers.length > 15) {
      embed.setFooter({ text: `Et ${streamers.length - 15} autres streamers...` });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ===============================
  // SURVEILLANCE DES STREAMS
  // ===============================

  async startStreamMonitoring() {
    if (!this.twitch || !this.notifications) {
      logger.warn('⚠️ Surveillance impossible - Twitch ou notifications indisponibles');
      return;
    }

    if (this.streamCheckInterval) {
      clearInterval(this.streamCheckInterval);
    }

    const intervalMs = (this.config.notificationIntervalMinutes || 5) * 60 * 1000;
    
    logger.info(`🔔 Démarrage surveillance streams (intervalle: ${this.config.notificationIntervalMinutes || 5} min)`);
    
    // Première vérification immédiate
    await this.checkStreams();
    
    // Puis vérifications périodiques
    this.streamCheckInterval = setInterval(async () => {
      try {
        await this.checkStreams();
      } catch (error) {
        logger.error(`❌ Erreur vérification périodique: ${error.message}`);
        this.metrics.errorsCount++;
      }
    }, intervalMs);

    logger.info('✅ Surveillance des streams activée');
  }

  async checkStreams() {
    if (!this.botReady || !this.twitch) {
      return;
    }

    logger.info('🔍 Vérification des streamers...');

    try {
      const streamers = await this.database.getAllStreamers();

      if (streamers.length === 0) {
        logger.info('📭 Aucun streamer à vérifier');
        return;
      }

      let checkedCount = 0;
      let newLiveCount = 0;
      let stoppedLiveCount = 0;

      for (const streamer of streamers) {
        try {
          const twitchName = streamer.url.split('/').pop();
          if (!twitchName) {
            logger.warn(`⚠️ URL invalide pour ${streamer.name}: ${streamer.url}`);
            continue;
          }

          const { isLive, streamInfo } = await this.twitch.checkStreamStatus(twitchName);
          checkedCount++;

          // Nouveau live détecté
          if (isLive && !this.liveStreamers.has(streamer.name)) {
            this.liveStreamers.set(streamer.name, true);
            newLiveCount++;
            
            if (this.notifications) {
              try {
                await this.notifications.sendLiveNotification(streamer, streamInfo);
                logger.info(`🔴 ${streamer.name} en live - notification envoyée`);
              } catch (notifError) {
                logger.warn(`⚠️ Notification échouée pour ${streamer.name}: ${notifError.message}`);
              }
            }
          }
          
          // Stream terminé
          else if (!isLive && this.liveStreamers.has(streamer.name)) {
            this.liveStreamers.delete(streamer.name);
            stoppedLiveCount++;
            
            if (this.notifications) {
              try {
                await this.notifications.removeLiveNotification(streamer.name);
                logger.info(`⚫ ${streamer.name} plus en live - notification supprimée`);
              } catch (notifError) {
                logger.warn(`⚠️ Suppression notification échouée pour ${streamer.name}: ${notifError.message}`);
              }
            }
          }

          // Délai entre les requêtes pour éviter le rate limit
          await new Promise(resolve => setTimeout(resolve, 150));

        } catch (error) {
          logger.error(`❌ Erreur vérification ${streamer.name}: ${error.message}`);
          this.metrics.errorsCount++;
        }
      }

      // Mettre à jour le statut du bot
      await this.updateBotStatus();

      logger.info(`✅ Vérification terminée: ${checkedCount} vérifiés, ${newLiveCount} nouveaux lives, ${stoppedLiveCount} arrêtés`);

    } catch (error) {
      logger.error(`❌ Erreur vérification globale: ${error.message}`);
      this.metrics.errorsCount++;
    }
  }

  // ===============================
  // GESTION DES ERREURS
  // ===============================

  handleError(error) {
    logger.error(`❌ Erreur client Discord: ${error.message}`);
    this.metrics.errorsCount++;
  }

  handleWarning(warning) {
    logger.warn(`⚠️ Avertissement Discord: ${warning}`);
  }

  // ===============================
  // UTILITAIRES
  // ===============================

  validateTwitchUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const pattern = /^https:\/\/www\.twitch\.tv\/[a-zA-Z0-9_]{4,25}$/;
    return pattern.test(url.trim());
  }

  isAdmin(member) {
    return member?.permissions?.has(PermissionFlagsBits.Administrator) || false;
  }

  isModerator(member) {
    return member?.permissions?.has(PermissionFlagsBits.ManageMessages) || this.isAdmin(member);
  }

  // ===============================
  // ARRÊT DU BOT
  // ===============================

  async shutdown() {
    logger.info('🛑 Arrêt du bot en cours...');
    
    try {
      this.botReady = false;
      
      // Arrêter la surveillance des streams
      if (this.streamCheckInterval) {
        clearInterval(this.streamCheckInterval);
        this.streamCheckInterval = null;
        logger.info('⏹️ Surveillance des streams arrêtée');
      }

      // Fermer la base de données
      if (this.database) {
        await this.database.close();
        logger.info('🗄️ Base de données fermée');
      }

      // Déconnecter le bot
      await this.destroy();
      
      logger.info('✅ Bot arrêté proprement');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'arrêt: ${error.message}`);
    }
  }

  // ===============================
  // MÉTHODES PUBLIQUES
  // ===============================

  async startNotifications() {
    try {
      logger.info('🔧 Démarrage manuel des notifications...');
      
      if (!this.twitch) {
        if (!TwitchManager) {
          throw new Error('TwitchManager non disponible');
        }
        
        if (!this.config.twitchClientId || !this.config.twitchClientSecret) {
          throw new Error('Credentials Twitch manquants');
        }
        
        // Initialiser Twitch
        await this.initializeTwitch();
      }
      
      if (!this.notifications) {
        if (!NotificationManager) {
          throw new Error('NotificationManager non disponible');
        }
        
        // Initialiser les notifications
        await this.initializeNotifications();
      }
      
      // Démarrer la surveillance
      await this.startStreamMonitoring();
      
      logger.info('✅ Notifications démarrées manuellement');
      return true;
    } catch (error) {
      logger.error(`❌ Impossible de démarrer les notifications: ${error.message}`);
      return false;
    }
  }

  async stopNotifications() {
    try {
      if (this.streamCheckInterval) {
        clearInterval(this.streamCheckInterval);
        this.streamCheckInterval = null;
        logger.info('⏹️ Notifications arrêtées');
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`❌ Erreur arrêt notifications: ${error.message}`);
      return false;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      uptime: this.uptime,
      guilds: this.guilds.cache.size,
      users: this.users.cache.size,
      streamers: this.liveStreamers.size,
      ping: this.ws.ping,
      ready: this.botReady
    };
  }
}

// ===============================
// FONCTION PRINCIPALE
// ===============================

async function main() {
  try {
    logger.info('🚀 Démarrage de Phoenix Bot...');
    
    // Charger et valider la configuration
    const config = BotConfig.fromEnv();
    
    const configErrors = config.validate();
    if (Object.keys(configErrors).length > 0) {
      logger.error('❌ Erreurs de configuration:');
      Object.entries(configErrors).forEach(([field, error]) => {
        logger.error(`  • ${field}: ${error}`);
      });
      process.exit(1);
    }

    logger.info('✅ Configuration validée');

    // Créer et démarrer le bot
    const bot = new PhoenixBot(config);

    // Gérer l'arrêt propre
    const gracefulShutdown = async (signal) => {
      logger.info(`🛑 Signal ${signal} reçu`);
      await bot.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Gérer les erreurs non capturées
    process.on('unhandledRejection', (error) => {
      logger.error(`❌ Rejection non gérée: ${error.message}`);
      logger.error(error.stack);
    });

    process.on('uncaughtException', (error) => {
      logger.error(`❌ Exception non capturée: ${error.message}`);
      logger.error(error.stack);
      process.exit(1);
    });

    // Démarrer le dashboard externe si disponible
    bot.on('ready', () => {
      setTimeout(() => {
        try {
          const dashboardServer = require('./dashboard-server.js');
          dashboardServer.startDashboard(bot);
          logger.info('🌐 Dashboard externe démarré sur http://localhost:3000');
        } catch (error) {
          logger.warn('⚠️ Dashboard externe non disponible:', error.message);
        }
      }, 3000);
    });

    // Se connecter à Discord
    await bot.login(config.discordToken);
    
  } catch (error) {
    logger.error(`❌ Erreur fatale: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

// ===============================
// EXPORTATION ET DÉMARRAGE
// ===============================

// Exporter la classe pour les tests et l'utilisation externe
module.exports = PhoenixBot;

// Démarrer l'application si ce fichier est exécuté directement
if (require.main === module) {
  main().catch(error => {
    logger.error(`❌ Erreur lors du démarrage: ${error.message}`);
    process.exit(1);
  });
}
