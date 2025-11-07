// ===== bot.js - VERSION SIMPLIFIÉE (NOTIFICATIONS FACILITÉES) =====
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

    logger.info(`🔍 CONFIG DEBUG:`);
    logger.info(`   - AUTO_ROLE_ID: "${process.env.AUTO_ROLE_ID}"`);
    logger.info(`   - this.config.autoRoleId: "${this.config.autoRoleId}"`);
    logger.info(`   - Type: ${typeof this.config.autoRoleId}`);

    try {
      logger.info('🔧 Initialisation du système multi-DB...');
      await this.db.init();
      logger.info('✅ DatabaseManager initialisé');

      logger.info('🔄 Enregistrement des serveurs existants...');
      let serversRegistered = 0;
      for (const guild of this.guilds.cache.values()) {
        try {
          await this.db.addGuild(guild.id, guild.name, null);
          serversRegistered++;
          logger.info(`   ✓ ${guild.name} (${guild.id})`);
        } catch (error) {
          logger.warn(`   ⚠️ Erreur pour ${guild.name}: ${error.message}`);
        }
      }
      logger.info(`✅ ${serversRegistered}/${this.guilds.cache.size} serveur(s) enregistré(s)`);

      try {
        this.buttonManager = new ButtonManager(this);
        logger.info('✅ ButtonManager initialisé');
      } catch (error) {
        logger.error(`❌ Erreur initialisation ButtonManager: ${error.message}`);
      }

      if (this.twitch && this.config.twitchClientId && this.config.twitchClientSecret) {
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
        }
      } else {
        logger.warn('⚠️ Configuration Twitch incomplète');
      }

      if (DashboardAPI) {
        try {
          logger.info('🔧 Initialisation du Dashboard API...');
          this.dashboardAPI = new DashboardAPI(this);
          this.dashboardAPI.start(3001);
          
          setInterval(() => {
            if (this.dashboardAPI) {
              this.dashboardAPI.cleanupExpiredTokens();
            }
          }, 3600000);
          
          logger.info('🌐 Dashboard API démarrée sur le port 3001');
          
        } catch (error) {
          logger.error(`❌ Erreur démarrage Dashboard API: ${error.message}`);
        }
      }

      try {
        const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());
        await this.application.commands.set(commandsData);
        logger.info(`⚡ ${commandsData.length} commandes slash synchronisées`);
      } catch (error) {
        logger.error(`❌ Erreur synchronisation commandes: ${error.message}`);
      }

      if (this.config.rulesRoleId && this.config.rulesRoleId !== 0) {
        this.ruleHandler = new RuleAcceptanceViewHandler(
          this.config.rulesRoleId,
          this.config.rulesRoleName,
          logger
        );
      }

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

      logger.info('✅ Bot entièrement initialisé avec système multi-DB!');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'initialisation: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
      this.metrics.recordError();
    }
  }

  async startNotifications() {
    try {
      logger.info('🔧 Tentative de démarrage manuel des notifications...');
      
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

      if (this.config.autoRoleId && this.config.autoRoleId !== '') {
        try {
          logger.info(`🔍 Tentative attribution rôle ID: ${this.config.autoRoleId} pour ${member.user.tag}`);
          
          const role = member.guild.roles.cache.get(this.config.autoRoleId);
          if (!role) {
            logger.error(`❌ Rôle avec l'ID ${this.config.autoRoleId} non trouvé dans le serveur!`);
            return;
          }

          if (member.roles.cache.has(this.config.autoRoleId)) {
            logger.info(`ℹ️ ${member.user.tag} a déjà le rôle "${role.name}"`);
            return;
          }

          await member.roles.add(role);
          logger.info(`✅ Rôle "${role.name}" attribué à ${member.user.tag}`);
        } catch (roleError) {
          logger.error(`❌ Erreur attribution rôle pour ${member.user.tag}: ${roleError.message}`);
        }
      }

      if (!this.config.welcomeChannel) {
        logger.warn(`⚠️ Channel de bienvenue non configuré pour: ${member.user.tag}`);
        return;
      }

      const welcomeChannel = this.channels.cache.get(this.config.welcomeChannel.toString());
      if (!welcomeChannel) {
        logger.error(`❌ Channel de bienvenue ${this.config.welcomeChannel} non trouvé!`);
        return;
      }

      const guildStreamers = await this.db.getGuildStreamers(member.guild.id);

      let roleText = '';
      if (this.config.autoRoleId && this.config.autoRoleId !== 0) {
        const role = member.guild.roles.cache.get(this.config.autoRoleId.toString());
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
    } catch (error) {
      logger.error(`❌ Erreur dans le message de bienvenue pour ${member.user.tag}: ${error.message}`);
      this.metrics.recordError();
    }
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
      if (!this.buttonManager && ButtonManager) {
        console.log('🔍 DEBUG: Initialisation tardive du ButtonManager...');
        try {
          this.buttonManager = new ButtonManager(this);
          logger.info('✅ ButtonManager initialisé tardivement');
        } catch (error) {
          logger.error(`❌ Erreur initialisation tardive ButtonManager: ${error.message}`);
        }
      }

      if (interaction.isButton() && this.buttonManager) {
        console.log('🔍 DEBUG: Bouton détecté, buttonManager:', !!this.buttonManager);
        try {
          const handled = await this.buttonManager.handleInteraction(interaction);
          if (handled) return;
        } catch (error) {
          logger.error(`❌ Erreur gestion bouton: ${error.message}`);
        }
      }

      if (interaction.isChatInputCommand()) {
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

      if (interaction.isAutocomplete()) {
        const command = this.commands.get(interaction.commandName);
        if (command && command.autocomplete) {
          try {
            await command.autocomplete(interaction, this);
          } catch (error) {
            logger.error(`❌ Erreur autocomplétion ${interaction.commandName}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      logger.error(`❌ Erreur lors du traitement de l'interaction: ${error.message}`);
      this.metrics.recordError();
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

  startStreamChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    if (!this.isReady()) {
      logger.warn('⚠️ Bot non prêt, notifications reportées');
      setTimeout(() => this.startStreamChecking(), 5000);
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
    
    this.checkStreamersLive().catch(error => {
      logger.error(`❌ Erreur première vérification: ${error.message}`);
    });
    
    this.checkInterval = setInterval(() => {
      this.checkStreamersLive().catch(error => {
        logger.error(`❌ Erreur vérification périodique: ${error.message}`);
        this.metrics.recordError();
      });
    }, intervalMs);

    logger.info(`🔔 Système de notifications multi-serveurs démarré avec succès`);
  }

  async checkStreamersLive() {
    if (!this.isReady() || !this.twitch) {
      logger.warn('⚠️ Bot non prêt ou Twitch indisponible, vérification ignorée');
      return;
    }

    logger.info('🔍 Vérification des streamers en live (multi-serveurs)...');

    try {
      const allStreamers = await this.db.getAllStreamers();

      if (allStreamers.length === 0) {
        logger.info('📭 Aucun streamer à vérifier');
        return;
      }

      if (this.notificationManager) {
        this.notificationManager.cleanupInactiveStreams();
      }

      const batches = [];
      for (let i = 0; i < allStreamers.length; i += 100) {
        batches.push(allStreamers.slice(i, i + 100));
      }

      for (const batch of batches) {
        await this.checkStreamerBatch(batch);
        if (batches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      logger.info(`✅ Vérification terminée - ${this.liveStreamers.size} streamers en live`);
      
      if (this.liveStreamers.size > 0) {
        logger.info('📊 Streams actifs globaux:');
        for (const [username, data] of this.liveStreamers.entries()) {
          const duration = Math.floor((Date.now() - data.startTime) / 60000);
          logger.info(`   - ${username}: ${duration}min (viewers: ${data.streamInfo?.viewerCount || 'N/A'})`);
        }
      }
    } catch (error) {
      logger.error(`❌ Erreur lors de la vérification globale: ${error.message}`);
      this.metrics.recordError();
    }
  }

  // ✅ MÉTHODE SIMPLIFIÉE
  async checkStreamerBatch(streamers) {
    try {
      const usernames = streamers.map(s => s.twitch_username).join('&user_login=');
      
      const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${usernames}`, {
        headers: {
          'Client-ID': this.config.twitchClientId,
          'Authorization': `Bearer ${this.twitch.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`API Twitch error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const liveStreams = data.data || [];
      
      const currentlyLive = liveStreams.map(stream => stream.user_login.toLowerCase());
      
      // ✅ SIMPLIFIÉ: Juste vérifier dans NotificationManager
      const newStreams = liveStreams.filter(stream => {
        const username = stream.user_login.toLowerCase();
        const isAlreadyNotified = this.notificationManager && 
                                  this.notificationManager.isStreamActive(username);
        
        return !isAlreadyNotified; // Nouveau si pas dans NotificationManager
      });

      // Streams terminés
      const activeStreams = await this.db.getActiveStreams();
      const previouslyLive = activeStreams.map(s => s.twitch_username.toLowerCase());
      
      const endedStreams = previouslyLive.filter(username => 
        !currentlyLive.includes(username) &&
        streamers.some(s => s.twitch_username === username)
      );

      // Traiter les nouveaux streams
      for (const stream of newStreams) {
        logger.info(`🔥 NOUVEAU stream: ${stream.user_name}`);
        await this.handleStreamStarted(stream);
      }

      // Mettre à jour les streams existants (silencieusement)
      const updatedStreams = liveStreams.filter(stream => {
        const username = stream.user_login.toLowerCase();
        return this.notificationManager && 
               this.notificationManager.isStreamActive(username);
      });

      for (const stream of updatedStreams) {
        await this.handleStreamUpdated(stream, true);
      }

      // Terminer les streams
      for (const username of endedStreams) {
        await this.handleStreamEnded(username);
      }

    } catch (error) {
      logger.error(`❌ Erreur vérification batch: ${error.message}`);
      if (error.message.includes('401') && this.twitch) {
        logger.warn('🔑 Token Twitch expiré, tentative de renouvellement...');
        try {
          await this.twitch.initClient();
          logger.info('✅ Token Twitch renouvelé');
        } catch (tokenError) {
          logger.error(`❌ Impossible de renouveler le token: ${tokenError.message}`);
        }
      }
    }
  }

  // ✅ MÉTHODE SIMPLIFIÉE avec moins de protections
  async handleStreamStarted(streamData) {
    const username = streamData.user_login.toLowerCase();
    
    try {
      // ✅ UNE SEULE PROTECTION: Vérifier le NotificationManager
      if (this.notificationManager && this.notificationManager.isStreamActive(username)) {
        logger.info(`⏩ ${username} déjà actif, ignoré`);
        return;
      }
      
      logger.info(`🔴 NOUVEAU STREAM: ${streamData.user_name} a commencé à streamer`);
      
      // Mettre à jour le tracking global
      this.liveStreamers.set(username, { 
        startTime: Date.now(), 
        lastUpdate: Date.now(),
        streamInfo: { ...streamData },
        streamId: streamData.id
      });
      
      // Récupérer les guilds qui suivent ce streamer
      const guildsFollowing = [];
      const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      
      for (const { guild_id } of allGuilds) {
        try {
          const streamer = await this.db.getStreamer(guild_id, username);
          if (streamer && streamer.notification_enabled) {
            const config = await this.db.getGuildConfig(guild_id);
            guildsFollowing.push({
              id: guild_id,
              notification_channel_id: config?.notification_channel_id,
              custom_message: streamer.custom_message,
              streamer_data: streamer
            });
            
            await this.db.setStreamActive(guild_id, username, {
              id: streamData.id,
              title: streamData.title || 'Pas de titre',
              game_name: streamData.game_name || 'Pas de catégorie',
              viewer_count: streamData.viewer_count || 0,
              started_at: streamData.started_at
            });
          }
        } catch (error) {
          logger.warn(`⚠️ Erreur vérification ${username} sur guild ${guild_id}: ${error.message}`);
          continue;
        }
      }

      if (guildsFollowing.length === 0) {
        logger.warn(`⚠️ Aucun serveur ne suit ${username}`);
        this.liveStreamers.delete(username);
        return;
      }

      logger.info(`📢 Notification à envoyer sur ${guildsFollowing.length} serveur(s) pour ${streamData.user_name}`);

      // ✅ ENVOI DES NOTIFICATIONS
      const notifiedGuilds = [];
      
      if (this.notificationManager) {
        for (const guildData of guildsFollowing) {
          if (!guildData.notification_channel_id) {
            logger.info(`⏭️ Pas de channel configuré pour ${username} sur ${guildData.id}`);
            continue;
          }
          
          try {
            const streamerForNotif = {
              name: streamData.user_name,
              url: `https://twitch.tv/${streamData.user_login}`,
              status: guildData.streamer_data?.status === 'affilie' ? StreamerStatus.AFFILIE : StreamerStatus.NON_AFFILIE,
              description: guildData.custom_message || `Streamer ${streamData.user_name}`
            };

            const streamInfoForNotif = {
              title: streamData.title || 'Pas de titre',
              game: streamData.game_name || 'Pas de catégorie',
              viewerCount: streamData.viewer_count || 0,
              thumbnailUrl: streamData.thumbnail_url
                ? streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
                : null
            };

            const success = await this.notificationManager.sendLiveNotificationToGuild(
              guildData.id,
              streamerForNotif, 
              streamInfoForNotif
            );
            
            if (success) {
              notifiedGuilds.push(guildData.id);
              await this.db.markNotificationSent(guildData.id, username);
              logger.info(`✅ Notification envoyée pour ${streamData.user_name} sur ${guildData.id}`);
            }
          } catch (error) {
            logger.error(`❌ Notification échouée pour ${streamData.user_name} sur ${guildData.id}: ${error.message}`);
          }
        }
      } else {
        // Fallback sans NotificationManager
        logger.warn(`⚠️ NotificationManager non disponible`);
        for (const guildData of guildsFollowing) {
          if (guildData.notification_channel_id) {
            try {
              const success = await this.sendStreamNotification(guildData, streamData);
              if (success) {
                notifiedGuilds.push(guildData.id);
                await this.db.markNotificationSent(guildData.id, username);
              }
            } catch (error) {
              logger.error(`❌ Erreur fallback pour ${guildData.id}: ${error.message}`);
            }
          }
        }
      }

      logger.info(`📊 ${notifiedGuilds.length}/${guildsFollowing.length} serveurs notifiés pour ${streamData.user_name}`);

    } catch (error) {
      logger.error(`❌ Erreur gestion nouveau stream ${username}: ${error.message}`);
      this.liveStreamers.delete(username);
    }
  }

  async handleStreamUpdated(streamData, silent = false) {
    const username = streamData.user_login.toLowerCase();
    
    try {
      const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      
      for (const { guild_id } of allGuilds) {
        try {
          const streamer = await this.db.getStreamer(guild_id, username);
          if (streamer) {
            await this.db.setStreamActive(guild_id, username, {
              id: streamData.id,
              title: streamData.title || 'Pas de titre',
              game_name: streamData.game_name || 'Pas de catégorie',
              viewer_count: streamData.viewer_count || 0,
              started_at: streamData.started_at
            });
          }
        } catch (error) {
          continue;
        }
      }

      const liveData = this.liveStreamers.get(username);
      if (liveData) {
        liveData.lastUpdate = Date.now();
        liveData.streamInfo = { ...streamData };
      }

      if (!silent && this.notificationManager && this.notificationManager.isStreamActive(username)) {
        const previousInfo = liveData?.streamInfo;
        
        const needsUpdate = !previousInfo || 
          previousInfo.game_name !== streamData.game_name ||
          previousInfo.title !== streamData.title;
        
        if (needsUpdate) {
          logger.info(`🔄 Mise à jour significative détectée pour ${username}`);
          
          const guildsFollowing = await this.db.masterDb.all(
            'SELECT guild_id FROM registered_guilds WHERE is_active = 1'
          );
          
          for (const { guild_id } of guildsFollowing) {
            try {
              const streamer = await this.db.getStreamer(guild_id, username);
              if (streamer && streamer.notification_enabled) {
                const streamerForNotif = {
                  name: streamData.user_name,
                  url: `https://twitch.tv/${streamData.user_login}`,
                  status: streamer.status === 'affilie' ? StreamerStatus.AFFILIE : StreamerStatus.NON_AFFILIE,
                  description: streamer.custom_message || `Streamer ${streamData.user_name}`
                };

                const streamInfoForNotif = {
                  title: streamData.title || 'Pas de titre',
                  game: streamData.game_name || 'Pas de catégorie',
                  viewerCount: streamData.viewer_count || 0,
                  thumbnailUrl: streamData.thumbnail_url
                    ? streamData.thumbnail_url.replace('{width}', '320').replace('{height}', '180')
                    : null
                };

                await this.notificationManager.updateLiveNotification(
                  streamerForNotif, 
                  streamInfoForNotif
                );
              }
            } catch (error) {
              continue;
            }
          }
        }
      }

      if (!silent) {
        const duration = liveData ? Math.floor((Date.now() - liveData.startTime) / 60000) : 'N/A';
        logger.info(`🔄 Stream mis à jour: ${streamData.user_name} (${duration}min, ${streamData.viewer_count} viewers)`);
      }

    } catch (error) {
      logger.error(`❌ Erreur mise à jour stream ${username}: ${error.message}`);
    }
  }

  async handleStreamEnded(username) {
    try {
      logger.info(`⚫ STREAM TERMINÉ: ${username} n'est plus en live`);
      
      if (this.notificationManager) {
        await this.notificationManager.removeLiveNotification(username);
      }
      
      const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      
      for (const { guild_id } of allGuilds) {
        try {
          const streamer = await this.db.getStreamer(guild_id, username);
          if (streamer) {
            await this.db.setStreamInactive(guild_id, username);
          }
        } catch (error) {
          continue;
        }
      }
      
      this.liveStreamers.delete(username);

    } catch (error) {
      logger.error(`❌ Erreur gestion fin stream ${username}: ${error.message}`);
    }
  }

  async sendStreamNotification(guildData, streamData) {
    try {
      const channel = await this.channels.fetch(guildData.notification_channel_id);
      if (!channel) {
        logger.warn(`⚠️ Channel ${guildData.notification_channel_id} non trouvé pour ${guildData.id}`);
        return false;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔴 ${streamData.user_name} est en live !`)
        .setDescription(streamData.title || 'Pas de titre')
        .setURL(`https://twitch.tv/${streamData.user_login}`)
        .setColor('#9146ff')
        .addFields(
          { 
            name: '🎮 Catégorie', 
            value: streamData.game_name || 'Pas de catégorie', 
            inline: true 
          },
          { 
            name: '👥 Spectateurs', 
            value: streamData.viewer_count?.toString() || '0', 
            inline: true 
          }
        )
        .setTimestamp(new Date(streamData.started_at));

      if (streamData.thumbnail_url) {
        const thumbnailUrl = streamData.thumbnail_url
          .replace('{width}', '320')
          .replace('{height}', '180');
        embed.setImage(thumbnailUrl);
      }

      let content = guildData.custom_message || `**${streamData.user_name}** est maintenant en live ! 🔴`;
      
      content = content
        .replace('{streamer}', streamData.user_name)
        .replace('{game}', streamData.game_name || 'Pas de catégorie')
        .replace('{title}', streamData.title || 'Pas de titre');

      await channel.send({ content, embeds: [embed] });
      return true;

    } catch (error) {
      logger.error(`❌ Erreur envoi notification: ${error.message}`);
      return false;
    }
  }

  async getRealTimeStats() {
    const dbStats = await this.db.getStats();
    const activeStreams = await this.db.getActiveStreams();
    
    return {
      guilds: this.guilds.cache.size,
      dbGuilds: dbStats.guilds,
      streamers: dbStats.streamers,
      totalFollows: dbStats.totalFollows,
      activeStreams: activeStreams.length,
      liveStreamers: this.liveStreamers.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  async getAllStreamers() {
    return await this.db.getAllStreamers();
  }

  async addStreamer(guildId, twitchUsername, addedBy) {
    return await this.db.addStreamerToGuild(guildId, twitchUsername, addedBy);
  }

  async removeStreamer(guildId, twitchUsername) {
    return await this.db.removeStreamerFromGuild(guildId, twitchUsername);
  }

  async getGuildStreamers(guildId) {
    return await this.db.getGuildStreamers(guildId);
  }

  async shutdown() {
    logger.info('🛑 Arrêt du bot...');
    
    try {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        logger.info('⏹️ Arrêt de la vérification des streams');
      }

      if (this.dashboardAPI && this.dashboardAPI.server) {
        this.dashboardAPI.server.close(() => {
          logger.info('🌐 Dashboard API arrêtée');
        });
      }

      await this.db.close();
      logger.info('💾 Base de données fermée');

      await this.destroy();
      
      logger.info('✅ Bot arrêté proprement');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'arrêt: ${error.message}`);
    }
  }
}

async function main() {
  try {
    const config = BotConfig.fromEnv();
    
    const configErrors = config.validate();
    if (Object.keys(configErrors).length > 0) {
      logger.error('❌ Erreurs de configuration:');
      Object.entries(configErrors).forEach(([field, error]) => {
        logger.error(`  • ${field}: ${error}`);
      });
      process.exit(1);
    }

    const bot = new StreamerBot(config);

    process.on('SIGINT', async () => {
      logger.info('🛑 Signal SIGINT reçu');
      await bot.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('🛑 Signal SIGTERM reçu');
      await bot.shutdown();
      process.exit(0);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('❌ Erreur non gérée:', reason);
      bot.metrics.recordError();
    });

    process.on('uncaughtException', (error) => {
      logger.error('❌ Exception non capturée:', error);
      bot.metrics.recordError();
    });

    logger.info('🚀 Démarrage du bot multi-serveurs...');
    await bot.login(config.discordToken);
    
  } catch (error) {
    logger.error(`❌ Erreur fatale: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = StreamerBot;
