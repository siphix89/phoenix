// ===== bot.js - VERSION OPTIMISÉE ET CORRIGÉE =====
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Colors, ActivityType, Collection } = require('discord.js');
const path = require('path');
const fs = require('fs');

// ✅ BASE DE DONNÉES MULTI-SERVEURS
const DatabaseManager = require('./database/databasemanager.js');

// Import conditionnel du TwitchManager
let TwitchManager;
try {
  TwitchManager = require('./twitch/twitchManager');
} catch (error) {
  console.log('⚠️ twitchManager non trouvé, fonctionnalités Twitch désactivées');
  TwitchManager = null;
}

const { BotConfig, logger, StreamerStatus } = require('./config');
const { BotMetrics, RuleAcceptanceViewHandler } = require('./models');

// Import conditionnel des notifications
let NotificationManager;
let notificationManager = null;
try {
  NotificationManager = require('./notifications/NotificationManager');
} catch (error) {
  console.log('⚠️ Module notifications non trouvé, notifications désactivées');
}

// Import conditionnel du Dashboard API
let DashboardAPI;
try {
  DashboardAPI = require('./dashboard/DashboardAPI');
  console.log('✅ DashboardAPI importé avec succès');
} catch (error) {
  console.log('⚠️ DashboardAPI non trouvé, dashboard désactivé:', error.message);
  DashboardAPI = null;
}

// Import du dashboard externe (garder pour compatibilité)
let dashboardServer;
try {
  dashboardServer = require('./dashboard-server.js');
} catch (error) {
  console.log('⚠️ dashboard-server.js non trouvé');
  dashboardServer = null;
}

// Import des boutons
const ButtonManager = require('./boutons/gestion.js');
console.log('🔍 DEBUG: ButtonManager importé:', typeof ButtonManager);

// ===== CONSTANTES =====
const MAX_TWITCH_FAILURES = 5;
const MAX_LIVE_STREAMERS = 1000;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;
const TOKEN_CLEANUP_INTERVAL = 3600000; // 1 heure
const INITIALIZATION_RETRY_DELAY = 5000;

class StreamerBot extends Client {
  constructor(config) {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    this.config = config;
    
    // ✅ BASE DE DONNÉES MULTI-SERVEURS
    this.db = new DatabaseManager('./database/guilds');
    
    this.twitch = TwitchManager ? new TwitchManager(config, logger) : null;
    this.liveStreamers = new Map();
    this.liveMessages = new Map();
    this.metrics = new BotMetrics();
    this.ruleHandler = null;
    this.checkInterval = null;
    this.commands = new Collection();
    this.dashboardAPI = null;
    this.keepAliveServer = null;
    this.notificationManager = null;
    this.buttonManager = null;
    
    // ✅ Nouveau: Circuit breaker pour Twitch
    this.twitchFailures = 0;
    this.twitchDisabled = false;
    
    // ✅ Nouveau: Flag de développement
    this.isDevelopment = process.env.NODE_ENV === 'development';
    
    this.setupEventHandlers();
    this.loadCommands();
  }

  async loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) {
      logger.warn('📁 Dossier commands non trouvé');
      return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command);
          logger.info(`✅ Commande ${command.data.name} chargée`);
        } else {
          logger.warn(`⚠️ Commande ${file} incomplète (data/execute manquant)`);
        }
      } catch (error) {
        logger.error(`❌ Erreur chargement commande ${file}: ${error.message}`);
      }
    }
  }

  setupEventHandlers() {
    this.once('ready', this.onReady.bind(this));
    this.on('guildCreate', this.onGuildCreate.bind(this));
    this.on('guildDelete', this.onGuildDelete.bind(this));
    this.on('guildMemberAdd', this.onGuildMemberAdd.bind(this));
    this.on('messageCreate', this.onMessageCreate.bind(this));
    this.on('interactionCreate', this.onInteractionCreate.bind(this));
    
    this.on('error', (error) => {
      logger.error(`❌ Erreur client Discord: ${error.message}`);
      this.metrics.recordError();
    });

    this.on('warn', (warning) => {
      logger.warn(`⚠️ Avertissement Discord: ${warning}`);
    });
  }

  async onGuildCreate(guild) {
    logger.info(`🆕 Nouveau serveur rejoint: ${guild.name} (${guild.id})`);
    
    try {
      await this.db.addGuild(guild.id, guild.name, null);
      logger.info(`✅ Base de données créée pour ${guild.name}`);
      
      // Envoi DM au propriétaire
      try {
        const owner = await guild.fetchOwner();
        const embed = new EmbedBuilder()
          .setTitle('🎉 Merci de m\'avoir ajouté !')
          .setDescription('Je suis maintenant prêt à surveiller vos streamers préférés !')
          .setColor(Colors.Green)
          .addFields(
            { name: '🚀 Commandes principales', value: '`/addstreamer` - Ajouter un streamer\n`/streamers` - Voir la liste\n`/setchannel` - Configurer les notifications', inline: false },
            { name: '⚙️ Configuration', value: 'Utilisez `/setchannel` dans le channel où vous voulez recevoir les notifications !', inline: false }
          )
          .setFooter({ text: `Serveur ID: ${guild.id}` })
          .setTimestamp();

        await owner.send({ embeds: [embed] });
      } catch (dmError) {
        logger.warn(`⚠️ Impossible d'envoyer un DM au propriétaire de ${guild.name}`);
      }

      // Message de bienvenue dans un channel général
      const generalChannel = guild.channels.cache.find(channel => 
        channel.type === 0 &&
        (channel.name.includes('general') || channel.name.includes('accueil') || 
         channel.name.includes('welcome') || channel.name.includes('général')) &&
        channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
      );

      if (generalChannel) {
        const welcomeEmbed = new EmbedBuilder()
          .setTitle('👋 Salut tout le monde !')
          .setDescription('Je suis là pour vous tenir au courant quand vos streamers préférés sont en live !')
          .setColor(Colors.Blue)
          .addFields(
            { name: '🎯 Pour commencer', value: 'Utilisez `/addstreamer <nom_twitch>` pour ajouter vos streamers', inline: false },
            { name: '📺 Notifications', value: 'Configurez avec `/setchannel` le channel pour les notifications', inline: false }
          );

        await generalChannel.send({ embeds: [welcomeEmbed] });
      }

    } catch (error) {
      logger.error(`❌ Erreur lors de l'ajout du serveur ${guild.name}: ${error.message}`);
    }
  }

  async onGuildDelete(guild) {
    logger.info(`👋 Serveur quitté: ${guild.name} (${guild.id})`);
  }

  async onReady() {
    logger.info('🤖 Bot en ligne!');
    logger.info(`🆔 ${this.user.tag} connecté`);

    // Logs debug uniquement en mode dev
    if (this.isDevelopment) {
      logger.info(`🔍 CONFIG DEBUG:`);
      logger.info(`   - AUTO_ROLE_ID: "${process.env.AUTO_ROLE_ID}"`);
      logger.info(`   - this.config.autoRoleId: "${this.config.autoRoleId}"`);
      logger.info(`   - Type: ${typeof this.config.autoRoleId}`);
    }

    try {
      logger.info('🔧 Initialisation du système multi-DB...');
      await this.db.init();
      logger.info('✅ DatabaseManager initialisé');

      logger.info('🔄 Enregistrement des serveurs existants...');
      const serversRegistered = await this.registerExistingGuilds();
      logger.info(`✅ ${serversRegistered}/${this.guilds.cache.size} serveur(s) enregistré(s)`);

      // Initialisation ButtonManager
      try {
        this.buttonManager = new ButtonManager(this);
        logger.info('✅ ButtonManager initialisé');
      } catch (error) {
        logger.error(`❌ Erreur initialisation ButtonManager: ${error.message}`);
      }

      // Initialisation Twitch et Notifications
      await this.initializeTwitchServices();

      // Initialisation Dashboard API
      if (DashboardAPI) {
        await this.initializeDashboardAPI();
      }

      // Synchronisation des commandes slash
      await this.syncSlashCommands();

      // Initialisation du handler de règles
      if (this.config.rulesRoleId && this.config.rulesRoleId !== 0) {
        this.ruleHandler = new RuleAcceptanceViewHandler(
          this.config.rulesRoleId,
          this.config.rulesRoleName,
          logger
        );
      }

      // Affichage des stats et mise à jour de la présence
      await this.displayStatsAndPresence();

      // Nettoyage périodique de la mémoire
      this.startMemoryCleanup();

      logger.info('✅ Bot entièrement initialisé avec système multi-DB!');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'initialisation: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
      this.metrics.recordError();
    }
  }

  // ✅ NOUVELLE MÉTHODE: Enregistrement des guilds existants
  async registerExistingGuilds() {
    let serversRegistered = 0;
    const guilds = Array.from(this.guilds.cache.values());
    
    // Enregistrement en parallèle avec limite
    const promises = guilds.map(guild => 
      this.db.addGuild(guild.id, guild.name, null)
        .then(() => {
          serversRegistered++;
          logger.info(`   ✓ ${guild.name} (${guild.id})`);
        })
        .catch(error => {
          logger.warn(`   ⚠️ Erreur pour ${guild.name}: ${error.message}`);
        })
    );
    
    await Promise.allSettled(promises);
    return serversRegistered;
  }

  // ✅ NOUVELLE MÉTHODE: Initialisation des services Twitch
  async initializeTwitchServices() {
    if (!this.twitch || !this.config.twitchClientId || !this.config.twitchClientSecret) {
      logger.warn('⚠️ Configuration Twitch incomplète');
      return;
    }

    try {
      logger.info('🔧 Initialisation de Twitch...');
      await this.twitch.initClient();
      logger.info('✅ Client Twitch initialisé');
      
      if (NotificationManager) {
        this.notificationManager = new NotificationManager(this);
        notificationManager = this.notificationManager;
        logger.info('✅ NotificationManager initialisé');
        
        if (this.config.autoNotifications) {
          logger.info('🚀 Démarrage automatique des notifications...');
          this.startStreamChecking();
        } else {
          logger.info('ℹ️ Notifications configurées mais auto-démarrage désactivé');
        }
      } else {
        logger.warn('⚠️ NotificationManager non disponible');
      }
    } catch (error) {
      logger.error(`❌ Erreur Twitch: ${error.message}`);
      this.twitchFailures++;
    }
  }

  // ✅ NOUVELLE MÉTHODE: Initialisation Dashboard API
  async initializeDashboardAPI() {
    try {
      logger.info('🔧 Initialisation du Dashboard API...');
      this.dashboardAPI = new DashboardAPI(this);
      this.dashboardAPI.start(3001);
      
      // Nettoyage périodique des tokens
      setInterval(() => {
        if (this.dashboardAPI) {
          this.dashboardAPI.cleanupExpiredTokens();
        }
      }, TOKEN_CLEANUP_INTERVAL);
      
      logger.info('🌐 Dashboard API démarrée sur le port 3001');
    } catch (error) {
      logger.error(`❌ Erreur démarrage Dashboard API: ${error.message}`);
    }
  }

  // ✅ NOUVELLE MÉTHODE: Synchronisation des commandes slash
  async syncSlashCommands() {
    try {
      const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());
      await this.application.commands.set(commandsData);
      logger.info(`⚡ ${commandsData.length} commandes slash synchronisées`);
    } catch (error) {
      logger.error(`❌ Erreur synchronisation commandes: ${error.message}`);
    }
  }

  // ✅ NOUVELLE MÉTHODE: Affichage stats et présence
  async displayStatsAndPresence() {
    const stats = await this.db.getStats();
    logger.info(`📊 Statistiques globales:`);
    logger.info(`   - Serveurs Discord: ${this.guilds.cache.size}`);
    logger.info(`   - Serveurs en DB: ${stats.guilds}`);
    logger.info(`   - Streamers uniques: ${stats.streamers}`);
    logger.info(`   - Total follows: ${stats.totalFollows}`);
    logger.info(`   - Streams actifs: ${stats.activeStreams}`);

    await this.user.setPresence({
      activities: [{ 
        name: `${stats.streamers} streamers | ${stats.guilds} serveurs`, 
        type: ActivityType.Watching 
      }],
      status: 'online',
    });

    logger.info('📋 État des notifications:');
    logger.info(`   - Auto notifications: ${this.config.autoNotifications ? 'Activées' : 'Désactivées'}`);
    logger.info(`   - Interval: ${this.config.notificationIntervalMinutes || 5} minutes`);
    logger.info(`   - Check interval actif: ${this.checkInterval ? 'Oui' : 'Non'}`);
  }

  // ✅ NOUVELLE MÉTHODE: Nettoyage mémoire périodique
  startMemoryCleanup() {
    setInterval(() => {
      // Vérifier si trop de streamers en live
      if (this.liveStreamers.size > MAX_LIVE_STREAMERS) {
        logger.warn(`⚠️ Trop de streams actifs: ${this.liveStreamers.size}, nettoyage...`);
        this.cleanupStaleStreams();
      }

      // Log memory usage en dev
      if (this.isDevelopment) {
        const memUsage = process.memoryUsage();
        logger.info(`💾 Mémoire: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      }
    }, 600000); // 10 minutes
  }

  // ✅ NOUVELLE MÉTHODE: Nettoyage des streams obsolètes
  cleanupStaleStreams() {
    const now = Date.now();
    const staleThreshold = 3600000; // 1 heure
    
    for (const [username, data] of this.liveStreamers.entries()) {
      if (now - data.lastUpdate > staleThreshold) {
        logger.info(`🧹 Nettoyage stream obsolète: ${username}`);
        this.liveStreamers.delete(username);
      }
    }
  }

  async startNotifications() {
    try {
      logger.info('🔧 Tentative de démarrage manuel des notifications...');
      
      if (this.twitchDisabled) {
        throw new Error('Twitch désactivé après trop d\'échecs');
      }
      
      if (!this.twitch) {
        throw new Error('TwitchManager non disponible');
      }
      
      if (!this.config.twitchClientId || !this.config.twitchClientSecret) {
        throw new Error('Credentials Twitch manquants');
      }
      
      if (!this.twitch.accessToken) {
        logger.info('🔑 Initialisation du client Twitch...');
        await this.twitch.initClient();
      }
      
      if (!this.notificationManager && NotificationManager) {
        this.notificationManager = new NotificationManager(this);
        notificationManager = this.notificationManager;
        logger.info('✅ NotificationManager initialisé manuellement');
      }
      
      this.startStreamChecking();
      
      logger.info('✅ Notifications démarrées manuellement avec succès');
      return true;
    } catch (error) {
      logger.error(`❌ Impossible de démarrer les notifications: ${error.message}`);
      return false;
    }
  }

  async onGuildMemberAdd(member) {
    try {
      let guildConfig = await this.db.getGuild(member.guild.id);
      if (!guildConfig) {
        logger.info(`📝 Création de la config pour ${member.guild.name}`);
        await this.db.addGuild(member.guild.id, member.guild.name, null);
        guildConfig = await this.db.getGuild(member.guild.id);
      }

      // Attribution automatique du rôle
      if (this.config.autoRoleId && this.config.autoRoleId !== '') {
        await this.assignAutoRole(member);
      }

      // Message de bienvenue
      await this.sendWelcomeMessage(member);

    } catch (error) {
      logger.error(`❌ Erreur dans le message de bienvenue pour ${member.user.tag}: ${error.message}`);
      this.metrics.recordError();
    }
  }

  // ✅ NOUVELLE MÉTHODE: Attribution automatique du rôle
  async assignAutoRole(member) {
    try {
      const roleId = String(this.config.autoRoleId);
      logger.info(`🔍 Tentative attribution rôle ID: ${roleId} pour ${member.user.tag}`);
      
      const role = member.guild.roles.cache.get(roleId);
      if (!role) {
        logger.error(`❌ Rôle avec l'ID ${roleId} non trouvé dans le serveur!`);
        return;
      }

      if (member.roles.cache.has(roleId)) {
        logger.info(`ℹ️ ${member.user.tag} a déjà le rôle "${role.name}"`);
        return;
      }

      await member.roles.add(role);
      logger.info(`✅ Rôle "${role.name}" attribué à ${member.user.tag}`);
    } catch (roleError) {
      logger.error(`❌ Erreur attribution rôle pour ${member.user.tag}: ${roleError.message}`);
    }
  }

  // ✅ NOUVELLE MÉTHODE: Envoi message de bienvenue
  async sendWelcomeMessage(member) {
    if (!this.config.welcomeChannel) {
      logger.warn(`⚠️ Channel de bienvenue non configuré pour: ${member.user.tag}`);
      return;
    }

    const welcomeChannel = this.channels.cache.get(String(this.config.welcomeChannel));
    if (!welcomeChannel) {
      logger.error(`❌ Channel de bienvenue ${this.config.welcomeChannel} non trouvé!`);
      return;
    }

    const guildStreamers = await this.db.getGuildStreamers(member.guild.id);

    let roleText = '';
    if (this.config.autoRoleId && this.config.autoRoleId !== 0) {
      const role = member.guild.roles.cache.get(String(this.config.autoRoleId));
      if (role) {
        roleText = `\n🎭 Rôle **${role.name}** attribué automatiquement`;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🎉 Bienvenue sur le serveur !')
      .setDescription(`Salut ${member.toString()} ! Nous sommes ravis de t'accueillir parmi nous ! 🚀${roleText}`)
      .setColor(Colors.Green)
      .setThumbnail(member.displayAvatarURL())
      .addFields(
        {
          name: '📋 Première étape',
          value: '• Lis le règlement\n• Présente-toi si tu le souhaites\n• Explore les différents channels',
          inline: false,
        },
        {
          name: '📊 Serveur',
          value: `👥 **${member.guild.memberCount}** membres\n🎮 **${guildStreamers.length}** streamers suivis`,
          inline: true,
        }
      )
      .setFooter({
        text: `Membre #${member.guild.memberCount} • Bienvenue !`,
        iconURL: member.guild.iconURL() || undefined,
      })
      .setTimestamp();

    await welcomeChannel.send({ 
      content: `🎊 Tout le monde, accueillez ${member.toString()} !`, 
      embeds: [embed] 
    });

    logger.info(`✅ Message de bienvenue envoyé pour ${member.user.tag}`);
  }

  async onMessageCreate(message) {
    if (message.author.bot) return;

    try {
      const contentLower = message.content.toLowerCase();

      if (['stream', 'live'].includes(contentLower)) {
        const guildStreamers = await this.db.getGuildStreamers(message.guildId);
        const allActiveStreams = await this.db.getActiveStreams();
        const guildActiveStreams = allActiveStreams.filter(stream => 
          guildStreamers.some(gs => gs.twitch_username === stream.twitch_username)
        );

        const embed = new EmbedBuilder()
          .setDescription(`👋 Salut ${message.author.toString()} ! Découvre nos streamers !`)
          .setColor(Colors.Blue)
          .addFields({
            name: '📊 Sur ce serveur',
            value: `🎮 **${guildStreamers.length}** streamers suivis\n🔴 **${guildActiveStreams.length}** actuellement en live`,
            inline: true
          });

        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      }
    } catch (error) {
      logger.error(`❌ Erreur traitement message: ${error.message}`);
      this.metrics.recordError();
    }
  }
  
  async onInteractionCreate(interaction) {
    try {
      // Initialisation tardive du ButtonManager si nécessaire
      if (!this.buttonManager && ButtonManager) {
        console.log('🔍 DEBUG: Initialisation tardive du ButtonManager...');
        try {
          this.buttonManager = new ButtonManager(this);
          logger.info('✅ ButtonManager initialisé tardivement');
        } catch (error) {
          logger.error(`❌ Erreur initialisation tardive ButtonManager: ${error.message}`);
        }
      }

      // Gestion des boutons
      if (interaction.isButton() && this.buttonManager) {
        console.log('🔍 DEBUG: Bouton détecté, buttonManager:', !!this.buttonManager);
        try {
          const handled = await this.buttonManager.handleInteraction(interaction);
          if (handled) return;
        } catch (error) {
          logger.error(`❌ Erreur gestion bouton: ${error.message}`);
        }
      }

      // Gestion des commandes slash
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      }

      // Gestion de l'autocomplétion
      if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      }
    } catch (error) {
      logger.error(`❌ Erreur lors du traitement de l'interaction: ${error.message}`);
      this.metrics.recordError();
    }
  }

  // ✅ NOUVELLE MÉTHODE: Gestion des commandes slash
  async handleSlashCommand(interaction) {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.error(`❌ Commande inconnue: ${interaction.commandName}`);
      return;
    }

    this.metrics.recordCommand(interaction.commandName, interaction.user.id);

    try {
      await command.execute(interaction, this);
      logger.info(`✅ Commande ${interaction.commandName} exécutée par ${interaction.user.tag} sur ${interaction.guild?.name || 'DM'}`);
    } catch (error) {
      logger.error(`❌ Erreur exécution commande ${interaction.commandName}: ${error.message}`);
      this.metrics.recordError();

      const errorMessage = {
        content: '❌ Une erreur est survenue lors de l\'exécution de la commande.',
        ephemeral: true
      };

      try {
        if (interaction.deferred) {
          await interaction.editReply(errorMessage);
        } else if (!interaction.replied) {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        logger.error(`❌ Impossible de répondre à l'interaction: ${replyError.message}`);
      }
    }
  }

  // ✅ NOUVELLE MÉTHODE: Gestion de l'autocomplétion
  async handleAutocomplete(interaction) {
    const command = this.commands.get(interaction.commandName);
    if (command && command.autocomplete) {
      try {
        await command.autocomplete(interaction, this);
      } catch (error) {
        logger.error(`❌ Erreur autocomplétion ${interaction.commandName}: ${error.message}`);
      }
    }
  }

  validateTwitchUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const pattern = /^https:\/\/www\.twitch\.tv\/[a-zA-Z0-9_]{4,25}$/;
    return pattern.test(url.trim());
  }

  isAdmin(member) {
    if (!member || !member.permissions) return false;
    return member.permissions.has('Administrator');
  }

  isModerator(member) {
    if (!member || !member.permissions) return false;
    return member.permissions.has('ManageMessages') || this.isAdmin(member);
  }

  // ✅ MÉTHODE CORRIGÉE: startStreamChecking (une seule version)
  startStreamChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    if (!this.isReady()) {
      logger.warn('⚠️ Bot non prêt, notifications reportées');
      setTimeout(() => this.startStreamChecking(), INITIALIZATION_RETRY_DELAY);
      return;
    }
    
    if (this.twitchDisabled) {
      logger.error('❌ Twitch désactivé après trop d\'échecs');
      return;
    }
    
    if (!this.twitch || !this.config.twitchClientId || !this.config.twitchClientSecret) {
      logger.error('❌ Configuration Twitch incomplète, notifications désactivées');
      return;
    }
    
    if (!this.notificationManager) {
      logger.error('❌ NotificationManager non initialisé');
      return;
    }

    const intervalMs = (this.config.notificationIntervalMinutes || 5) * 60 * 1000;
    
    logger.info(`🔔 Démarrage du système de notifications multi-serveurs (intervalle: ${this.config.notificationIntervalMinutes || 5} min)`);
    
    // Première vérification immédiate
    this.checkStreamersLive().catch(error => {
      logger.error(`❌ Erreur première vérification: ${error.message}`);
    });
    
    // Vérifications périodiques
    this.checkInterval = setInterval(() => {
      this.checkStreamersLive().catch(error => {
        logger.error(`❌ Erreur vérification périodique: ${error.message}`);
        this.metrics.recordError();
      });
    }, intervalMs);

    logger.info(`🔔 Système de notifications multi-serveurs démarré avec succès`);
  }

  async checkStreamersLive() {
    if (!this.isReady() || !this.twitch || this.twitch
