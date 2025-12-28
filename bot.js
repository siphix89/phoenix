// ===== bot.js =====
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



// Import des boutons
const ButtonManager = require('./boutons/gestion.js');
console.log('🔍 DEBUG: ButtonManager importé:', typeof ButtonManager);

// ===== CONSTANTES =====
const MAX_TWITCH_FAILURES = 5;
const MAX_LIVE_STREAMERS = 1000;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;
const TOKEN_CLEANUP_INTERVAL = 3600000;
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
    this.db = new DatabaseManager('./database/guilds');
    this.twitch = TwitchManager ? new TwitchManager(config, logger) : null;
    
    this.liveStreamers = new Map();
    this.liveMessages = new Map();
    
    this.metrics = new BotMetrics();
    this.ruleHandler = null;
    this.checkInterval = null;
    this.commands = new Collection();
    this.dashboardAPI = null;
    this.notificationManager = null;
    this.buttonManager = null;
    this.twitchFailures = 0;
    this.twitchDisabled = false;
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
      
      try {
        const owner = await guild.fetchOwner();
        const embed = new EmbedBuilder()
          .setTitle('🎉 Merci de m\'avoir ajouté !')
          .setDescription('Je suis maintenant prêt à surveiller vos streamers préférés !')
          .setColor(Colors.Green)
          .addFields(
            { name: '🚀 Commandes principales', value: '`/ajouter-streamer` - Ajouter un streamer\n`/streamers` - Voir la liste\n`/setchannel` - Configurer les notifications', inline: false },
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
            { name: '🎯 Pour commencer', value: 'Utilisez `/ajouter-streamer <nom_twitch>` pour ajouter vos streamers', inline: false },
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

    try {
      logger.info('🔧 Initialisation du système multi-DB...');
      await this.db.init();
      logger.info('✅ DatabaseManager initialisé');

      logger.info('🔄 Enregistrement des serveurs existants...');
      const serversRegistered = await this.registerExistingGuilds();
      logger.info(`✅ ${serversRegistered}/${this.guilds.cache.size} serveur(s) enregistré(s)`);

      try {
        this.buttonManager = new ButtonManager(this);
        logger.info('✅ ButtonManager initialisé');
      } catch (error) {
        logger.error(`❌ Erreur initialisation ButtonManager: ${error.message}`);
      }

      await this.initializeTwitchServices();

      if (this.notificationManager) {
        await this.restoreActiveSessions();
      }

      if (DashboardAPI) {
        await this.initializeDashboardAPI();
      }

      await this.syncSlashCommands();

      if (this.config.rulesRoleId && this.config.rulesRoleId !== 0) {
        this.ruleHandler = new RuleAcceptanceViewHandler(
          this.config.rulesRoleId,
          this.config.rulesRoleName,
          logger
        );
      }

      await this.displayStatsAndPresence();
      this.startMemoryCleanup();

      logger.info('✅ Bot entièrement initialisé !');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'initialisation: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
      this.metrics.recordError();
    }
  }

  async restoreActiveSessions() {
    try {
      logger.info('🔄 Restauration des sessions de stream actives depuis la DB...');
      const activeStreamsDB = await this.db.getActiveStreams();
      
      if (activeStreamsDB.length === 0) {
        logger.info('✅ Aucune session active à restaurer.');
        return;
      }

      for (const streamData of activeStreamsDB) {
        const username = streamData.twitch_username.toLowerCase();
        
        this.liveStreamers.set(username, {
          startTime: streamData.started_at || Date.now(),
          lastUpdate: Date.now(),
          streamInfo: { 
            user_login: username, 
            user_name: username,
            game_name: streamData.game_name,
            title: streamData.title,
            viewer_count: streamData.viewer_count,
            id: streamData.id
          },
          streamId: streamData.id
        });

        if (this.notificationManager && !this.notificationManager.activeStreams.has(username)) {
          this.notificationManager.activeStreams.set(username, {
            streamStartedAt: streamData.started_at || Date.now(),
            lastUpdate: Date.now(),
            globalStreamInfo: { ...this.liveStreamers.get(username).streamInfo },
            guilds: new Map()
          });
        }
      }
      
      logger.info(`✅ ${activeStreamsDB.length} sessions restaurées en mémoire.`);
    } catch (error) {
      logger.error(`❌ Erreur restauration sessions: ${error.message}`);
    }
  }

  async registerExistingGuilds() {
    let serversRegistered = 0;
    const guilds = Array.from(this.guilds.cache.values());
    
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
        }
      }
    } catch (error) {
      logger.error(`❌ Erreur Twitch: ${error.message}`);
      this.twitchFailures++;
    }
  }

  
  async initializeDashboardAPI() {
    try {
      logger.info('🔧 Initialisation du Dashboard API...');
      this.dashboardAPI = new DashboardAPI(this);
      
      const port = process.env.PORT || 3001;
      this.dashboardAPI.start(port);
      
      setInterval(() => {
        if (this.dashboardAPI) {
          this.dashboardAPI.cleanupExpiredTokens();
        }
      }, TOKEN_CLEANUP_INTERVAL);
      
      logger.info(`🌐 Dashboard API démarrée sur le port ${port}`);
    } catch (error) {
      logger.error(`❌ Erreur démarrage Dashboard API: ${error.message}`);
    }
  }

  async syncSlashCommands() {
    try {
      const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());
      await this.application.commands.set(commandsData);
      logger.info(`⚡ ${commandsData.length} commandes slash synchronisées`);
    } catch (error) {
      logger.error(`❌ Erreur synchronisation commandes: ${error.message}`);
    }
  }

  async displayStatsAndPresence() {
    const stats = await this.db.getStats();
    await this.user.setPresence({
      activities: [{ 
        name: `${stats.streamers} streamers | ${stats.guilds} serveurs`, 
        type: ActivityType.Watching 
      }],
      status: 'online',
    });
  }

  startMemoryCleanup() {
    setInterval(() => {
      if (this.liveStreamers.size > MAX_LIVE_STREAMERS) {
        this.cleanupStaleStreams();
      }
    }, 600000);
  }

  cleanupStaleStreams() {
    const now = Date.now();
    const staleThreshold = 3600000;
    
    for (const [username, data] of this.liveStreamers.entries()) {
      if (now - data.lastUpdate > staleThreshold) {
        this.liveStreamers.delete(username);
      }
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
        await this.assignAutoRole(member);
      }

      await this.sendWelcomeMessage(member);

    } catch (error) {
      logger.error(`❌ Erreur dans le message de bienvenue pour ${member.user.tag}: ${error.message}`);
      this.metrics.recordError();
    }
  }

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
      if (!this.buttonManager && ButtonManager) {
        try {
          this.buttonManager = new ButtonManager(this);
        } catch (error) {
          logger.error(`❌ Erreur initialisation tardive ButtonManager: ${error.message}`);
        }
      }

      if (interaction.isButton() && this.buttonManager) {
        const handled = await this.buttonManager.handleInteraction(interaction);
        if (handled) return;
      }

      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      }

      if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      }
    } catch (error) {
      logger.error(`❌ Erreur lors du traitement de l'interaction: ${error.message}`);
      this.metrics.recordError();
    }
  }

  async handleSlashCommand(interaction) {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.error(`❌ Commande inconnue: ${interaction.commandName}`);
      return;
    }

    this.metrics.recordCommand(interaction.commandName, interaction.user.id);

    try {
      await command.execute(interaction, this);
      logger.info(`✅ Commande ${interaction.commandName} exécutée par ${interaction.user.tag}`);
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

  startStreamChecking() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    
    if (!this.isReady() || !this.twitch) {
      logger.warn('⚠️ Bot non prêt, notifications reportées');
      setTimeout(() => this.startStreamChecking(), INITIALIZATION_RETRY_DELAY);
      return;
    }
    
    logger.info(`🔔 Système de notifications actif (Intervalle: ${this.config.notificationIntervalMinutes || 5} min)`);
    
    this.checkStreamersLive().catch(e => logger.error(e.message));
    
    const intervalMs = (this.config.notificationIntervalMinutes || 5) * 60 * 1000;
    this.checkInterval = setInterval(() => {
      this.checkStreamersLive().catch(error => {
        logger.error(`❌ Erreur vérification périodique: ${error.message}`);
        this.metrics.recordError();
      });
    }, intervalMs);
  }

  async checkStreamersLive() {
    if (!this.isReady() || !this.twitch || this.twitchDisabled) return;

    try {
      const allStreamers = await this.db.getAllStreamers();
      if (allStreamers.length === 0) return;

      if (this.notificationManager) {
        this.notificationManager.cleanupInactiveStreams();
      }

      const batches = [];
      for (let i = 0; i < allStreamers.length; i += BATCH_SIZE) {
        batches.push(allStreamers.slice(i, i + BATCH_SIZE));
      }

      for (let i = 0; i < batches.length; i++) {
        await this.checkStreamerBatch(batches[i]);
        if (i < batches.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }

    } catch (error) {
      logger.error(`❌ Erreur vérification globale: ${error.message}`);
      this.metrics.recordError();
      if (error.message.includes('401') || error.message === 'TOKEN_EXPIRED') {
        await this.twitch.initClient();
      }
    }
  }

  async checkStreamerBatch(streamers) {
    try {
      const usernames = streamers.map(s => s.twitch_username).join('&user_login=');
      
      const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${usernames}`, {
        headers: {
          'Client-ID': this.config.twitchClientId,
          'Authorization': `Bearer ${this.twitch.accessToken}`
        }
      });

      if (!response.ok) throw new Error(response.status === 401 ? 'TOKEN_EXPIRED' : 'API Error');

      const data = await response.json();
      const liveStreams = data.data || [];
      
      const currentlyLiveUsernames = liveStreams.map(s => s.user_login.toLowerCase());
      const activeStreamsDB = await this.db.getActiveStreams();

      const newStreams = liveStreams.filter(stream => {
        const username = stream.user_login.toLowerCase();
        
        if (this.liveStreamers.has(username)) return false;
        if (this.notificationManager && this.notificationManager.isStreamActive(username)) return false;

        const dbEntry = activeStreamsDB.find(s => s.twitch_username.toLowerCase() === username);
        
        if (dbEntry) {
          if (dbEntry.id && dbEntry.id === stream.id) {
            logger.info(`🔄 Restauration silencieuse (Redémarrage détecté): ${username}`);
            this.handleStreamUpdated(stream, true); 
            return false;
          }
        }

        return true; 
      });

      const knownActiveUsernames = new Set([
        ...this.liveStreamers.keys(),
        ...activeStreamsDB.map(s => s.twitch_username.toLowerCase())
      ]);
      
      const endedStreams = Array.from(knownActiveUsernames).filter(username => 
        !currentlyLiveUsernames.includes(username) &&
        streamers.some(s => s.twitch_username === username)
      );

      if (newStreams.length > 0) {
        logger.info(`🆕 ${newStreams.length} NOUVEAU(X) stream(s) détecté(s)`);
        await Promise.allSettled(newStreams.map(s => this.handleStreamStarted(s)));
      }

      const updatedStreams = liveStreams.filter(stream => {
        return this.liveStreamers.has(stream.user_login.toLowerCase());
      });

      if (updatedStreams.length > 0) {
        await Promise.allSettled(updatedStreams.map(s => this.handleStreamUpdated(s)));
      }

      if (endedStreams.length > 0) {
        await Promise.allSettled(endedStreams.map(u => this.handleStreamEnded(u)));
      }

    } catch (error) {
      logger.error(`❌ Erreur batch: ${error.message}`);
      if (error.message === 'TOKEN_EXPIRED') await this.twitch.initClient();
    }
  }

  async handleStreamStarted(streamData) {
    const username = streamData.user_login.toLowerCase();
    
    if (this.liveStreamers.has(username)) return;

    logger.info(`🔴 NOUVEAU STREAM: ${streamData.user_name}`);
    
    const guildsFollowing = await this.getGuildsFollowingStreamer(username, streamData);
    if (guildsFollowing.length === 0) return;

    const results = await this.sendNotificationsToGuilds(guildsFollowing, streamData);
    const success = results.some(r => r.success);

    if (success) {
      this.liveStreamers.set(username, { 
        startTime: Date.now(), 
        lastUpdate: Date.now(),
        streamInfo: { ...streamData },
        streamId: streamData.id
      });
    }
  }

  async handleStreamUpdated(streamData, silent = false) {
    const username = streamData.user_login.toLowerCase();
    
    try {
      const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      await Promise.allSettled(allGuilds.map(async ({ guild_id }) => {
        const streamer = await this.db.getStreamer(guild_id, username);
        if (streamer) {
          await this.db.setStreamActive(guild_id, username, {
            id: streamData.id,
            title: streamData.title,
            game_name: streamData.game_name,
            viewer_count: streamData.viewer_count,
            started_at: streamData.started_at
          });
        }
      }));
    } catch (e) {}

    const liveData = this.liveStreamers.get(username);
    if (liveData) {
      liveData.lastUpdate = Date.now();
      liveData.streamInfo = { ...streamData };
    } else {
      this.liveStreamers.set(username, {
        startTime: Date.parse(streamData.started_at) || Date.now(),
        lastUpdate: Date.now(),
        streamInfo: { ...streamData },
        streamId: streamData.id
      });
    }

    if (!silent && this.notificationManager && this.notificationManager.isStreamActive(username)) {
      const previousInfo = liveData?.streamInfo;
      const needsUpdate = !previousInfo || 
        previousInfo.game_name !== streamData.game_name ||
        previousInfo.title !== streamData.title;
      
      if (needsUpdate) {
        await this.updateStreamNotifications(username, streamData);
      }
    }
  }

  async handleStreamEnded(username) {
    try {
      logger.info(`⚫ FIN DE STREAM: ${username}`);
      
      if (this.notificationManager) {
        await this.notificationManager.removeLiveNotification(username);
      }
      
      const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      await Promise.allSettled(
        allGuilds.map(async ({ guild_id }) => {
          const streamer = await this.db.getStreamer(guild_id, username);
          if (streamer) {
            await this.db.setStreamInactive(guild_id, username);
          }
        })
      );
      
      this.liveStreamers.delete(username);

    } catch (error) {
      logger.error(`❌ Erreur fin stream ${username}: ${error.message}`);
    }
  }

  async getGuildsFollowingStreamer(username, streamData) {
    const guildsFollowing = [];
    const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
    const promises = allGuilds.map(async ({ guild_id }) => {
      try {
        const streamer = await this.db.getStreamer(guild_id, username);
        if (streamer && streamer.notification_enabled) {
          const config = await this.db.getGuildConfig(guild_id);
          await this.db.setStreamActive(guild_id, username, {
            id: streamData.id,
            title: streamData.title || 'Pas de titre',
            game_name: streamData.game_name || 'Pas de catégorie',
            viewer_count: streamData.viewer_count || 0,
            started_at: streamData.started_at
          });
          return {
            id: guild_id,
            notification_channel_id: config?.notification_channel_id,
            live_affilie_channel_id: config?.live_affilie_channel_id,
            live_non_affilie_channel_id: config?.live_non_affilie_channel_id,
            custom_message: streamer.custom_message,
            streamer_data: streamer
          };
        }
        return null;
      } catch (error) { return null; }
    });
    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) guildsFollowing.push(result.value);
    }
    return guildsFollowing;
  }

  async sendNotificationsToGuilds(guildsFollowing, streamData) {
    const notificationPromises = guildsFollowing.map(async (guildData) => {
      const isAffilie = guildData.streamer_data?.status === 'affilie';
      let targetChannelId = isAffilie ? guildData.live_affilie_channel_id : guildData.live_non_affilie_channel_id;
      if (!targetChannelId) targetChannelId = guildData.notification_channel_id;
      
      if (!targetChannelId) return { guildId: guildData.id, success: false };

      const streamerForNotif = {
        name: streamData.user_name,
        url: `https://twitch.tv/${streamData.user_login}`,
        status: isAffilie ? StreamerStatus.AFFILIE : StreamerStatus.NON_AFFILIE,
        description: guildData.custom_message || `Streamer ${streamData.user_name}`
      };
      const streamInfoForNotif = {
        title: streamData.title,
        game: streamData.game_name,
        viewerCount: streamData.viewer_count,
        thumbnailUrl: streamData.thumbnail_url?.replace('{width}', '320').replace('{height}', '180')
      };

      let success = false;
      if (this.notificationManager) {
        success = await this.notificationManager.sendLiveNotificationToGuild(guildData.id, streamerForNotif, streamInfoForNotif);
      }
      if (success) await this.db.markNotificationSent(guildData.id, streamData.user_login.toLowerCase());
      return { guildId: guildData.id, success };
    });
    return await Promise.allSettled(notificationPromises).then(r => r.map(i => i.status === 'fulfilled' ? i.value : {success:false}));
  }

  async updateStreamNotifications(username, streamData) {
    const guildsFollowing = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
    const updatePromises = guildsFollowing.map(async ({ guild_id }) => {
      try {
        const streamer = await this.db.getStreamer(guild_id, username);
        if (streamer && streamer.notification_enabled) {
          const streamerForNotif = {
            name: streamData.user_name,
            url: `https://twitch.tv/${streamData.user_login}`,
            status: streamer.status === 'affilie' ? StreamerStatus.AFFILIE : StreamerStatus.NON_AFFILIE,
            description: streamer.custom_message
          };
          const streamInfoForNotif = {
            title: streamData.title,
            game: streamData.game_name,
            viewerCount: streamData.viewer_count,
            thumbnailUrl: streamData.thumbnail_url?.replace('{width}', '320').replace('{height}', '180')
          };
          await this.notificationManager.updateLiveNotification(streamerForNotif, streamInfoForNotif);
        }
      } catch (e) {}
    });
    await Promise.allSettled(updatePromises);
  }

  async sendStreamNotification(guildData, streamData) {
    return false; 
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
      memoryUsage: process.memoryUsage(),
      twitchFailures: this.twitchFailures,
      twitchDisabled: this.twitchDisabled
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

  async shutdown() {
    logger.info('🛑 Arrêt du bot...');
    try {
      if (this.checkInterval) clearInterval(this.checkInterval);
      if (this.dashboardAPI && this.dashboardAPI.server) {
        this.dashboardAPI.server.close();
      }
      await this.db.close();
      await this.destroy();
      logger.info('✅ Bot arrêté proprement');
    } catch (error) {
      logger.error(`❌ Erreur arrêt: ${error.message}`);
    }
  }
}

// ===== FONCTION MAIN =====
async function main() {
  try {
    const config = BotConfig.fromEnv();
    
    const configErrors = config.validate();
    if (Object.keys(configErrors).length > 0) {
      logger.error('❌ Erreurs de configuration:', configErrors);
      process.exit(1);
    }

    const bot = new StreamerBot(config);
    
    ['SIGINT', 'SIGTERM'].forEach(signal => {
      process.on(signal, async () => {
        logger.info(`🛑 Signal ${signal} reçu`);
        await bot.shutdown();
        process.exit(0);
      });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('❌ Erreur non gérée:', reason);
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
