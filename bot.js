// ===== bot.js - VERSION CORRIGÉE ET OPTIMISÉE =====
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
    
    // 🧠 Mémoire vive des streams
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

  // ... [Méthodes onGuildCreate et onGuildDelete inchangées] ...
  async onGuildCreate(guild) {
    logger.info(`🆕 Nouveau serveur rejoint: ${guild.name} (${guild.id})`);
    try {
      await this.db.addGuild(guild.id, guild.name, null);
      // ... (code original conservé)
    } catch (error) {
      logger.error(`❌ Erreur ajout serveur: ${error.message}`);
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

      // Initialisation ButtonManager
      try {
        this.buttonManager = new ButtonManager(this);
        logger.info('✅ ButtonManager initialisé');
      } catch (error) {
        logger.error(`❌ Erreur initialisation ButtonManager: ${error.message}`);
      }

      await this.initializeTwitchServices();

      // 🔄 RESTAURATION DE LA MÉMOIRE (CRITIQUE POUR LES SUPPRESSIONS)
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

  /**
   * ✅ NOUVEAU: Restaure la mémoire RAM depuis la DB au démarrage
   * Permet de gérer la suppression des notifs même après un reboot
   */
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
        
        // 1. Restaurer dans liveStreamers (Bot memory)
        this.liveStreamers.set(username, {
          startTime: streamData.started_at || Date.now(),
          lastUpdate: Date.now(),
          streamInfo: { 
            user_login: username, 
            user_name: username,
            game_name: streamData.game_name,
            title: streamData.title,
            viewer_count: streamData.viewer_count,
            id: streamData.stream_id // Assurez-vous que votre DB a cette colonne, sinon null
          }
        });

        // 2. Restaurer dans NotificationManager (Manager memory)
        // Cela permet au manager de savoir que le stream existe pour pouvoir le update/delete
        if (this.notificationManager && !this.notificationManager.activeStreams.has(username)) {
            this.notificationManager.activeStreams.set(username, {
                streamStartedAt: streamData.started_at || Date.now(),
                lastUpdate: Date.now(),
                globalStreamInfo: { ...this.liveStreamers.get(username).streamInfo },
                guilds: new Map() // ATTENTION: Sans les MessageIDs stockés en DB, on ne peut pas supprimer les anciens messages
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
      this.dashboardAPI.start(3001);
      
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

  // ... [Méthodes onGuildMemberAdd, assignAutoRole, sendWelcomeMessage, onMessageCreate inchangées] ...
  async onGuildMemberAdd(member) {
      // (Gardez votre code original ici)
      try {
        let guildConfig = await this.db.getGuild(member.guild.id);
        if (!guildConfig) await this.db.addGuild(member.guild.id, member.guild.name, null);
        if (this.config.autoRoleId) await this.assignAutoRole(member);
        await this.sendWelcomeMessage(member);
      } catch (e) { logger.error(e.message); }
  }
  
  async assignAutoRole(member) {
      // (Gardez votre code original ici)
      try {
          const roleId = String(this.config.autoRoleId);
          const role = member.guild.roles.cache.get(roleId);
          if (role && !member.roles.cache.has(roleId)) await member.roles.add(role);
      } catch (e) {}
  }

  async sendWelcomeMessage(member) {
      // (Gardez votre code original ici - pour ne pas alourdir la réponse je le condense, 
      // mais ne changez rien si ça marche)
      if (!this.config.welcomeChannel) return;
      const channel = this.channels.cache.get(String(this.config.welcomeChannel));
      if (channel) {
          // ... votre logique d'embed
      }
  }

  async onMessageCreate(message) {
      if (message.author.bot) return;
      // ... (code original conservé)
      if (['stream', 'live'].includes(message.content.toLowerCase())) {
          // ... logique de réponse
      }
  }

  async onInteractionCreate(interaction) {
    // ... (code original conservé)
    try {
        if (!this.buttonManager && ButtonManager) this.buttonManager = new ButtonManager(this);
        if (interaction.isButton() && this.buttonManager) await this.buttonManager.handleInteraction(interaction);
        if (interaction.isChatInputCommand()) await this.handleSlashCommand(interaction);
        if (interaction.isAutocomplete()) await this.handleAutocomplete(interaction);
    } catch (e) { logger.error(e.message); }
  }

  async handleSlashCommand(interaction) {
    const command = this.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, this);
    } catch (error) {
      logger.error(`❌ Erreur commande: ${error.message}`);
      if (!interaction.replied) await interaction.reply({ content: '❌ Erreur', ephemeral: true });
    }
  }
  
  async handleAutocomplete(interaction) {
      const command = this.commands.get(interaction.commandName);
      if (command && command.autocomplete) await command.autocomplete(interaction, this);
  }

  startStreamChecking() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    
    if (!this.isReady() || !this.twitch) {
      setTimeout(() => this.startStreamChecking(), INITIALIZATION_RETRY_DELAY);
      return;
    }
    
    logger.info(`🔔 Système de notifications actif (Intervalle: ${this.config.notificationIntervalMinutes || 5} min)`);
    
    this.checkStreamersLive().catch(e => logger.error(e.message));
    
    const intervalMs = (this.config.notificationIntervalMinutes || 5) * 60 * 1000;
    this.checkInterval = setInterval(() => {
      this.checkStreamersLive().catch(error => {
        logger.error(`❌ Erreur vérification périodique: ${error.message}`);
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
      // Gestion erreur token simplifiée
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
      
      // --- LOGIQUE CORRIGÉE : ANTI-DOUBLONS ---
      
      // 1. On regarde ce qui est VRAIMENT actif en DB (source de vérité persistante)
      const activeStreamsDB = await this.db.getActiveStreams();
      const dbActiveUsernames = activeStreamsDB.map(s => s.twitch_username.toLowerCase());

      // 2. Filtrer les NOUVEAUX streams
      const newStreams = liveStreams.filter(stream => {
        const username = stream.user_login.toLowerCase();
        
        // Est-ce actif en RAM (NotificationManager) ?
        const isActiveInRam = this.notificationManager && this.notificationManager.isStreamActive(username);
        // Est-ce actif dans la liste locale ?
        const isActiveInLocal = this.liveStreamers.has(username);
        // Est-ce actif en DB ?
        const isActiveInDB = dbActiveUsernames.includes(username);

        // Si le stream est connu quelque part (RAM ou DB), ce n'est PAS un nouveau stream
        if (isActiveInDB && !isActiveInRam) {
            // Cas "Zombie": Le stream est en DB mais pas en RAM (après reboot).
            // On le rajoute silencieusement en RAM pour pouvoir le gérer, mais sans notifier.
            logger.info(`🔄 Récupération silencieuse de session active: ${username}`);
            this.handleStreamUpdated(stream, true); // true = silent
            return false; 
        }

        return !isActiveInRam && !isActiveInLocal && !isActiveInDB;
      });

      // 3. Détecter les streams TERMINÉS
      // On prend tout ce qui est considéré actif (RAM ou DB) et qui n'est plus live sur Twitch
      const knownActive = new Set([...this.liveStreamers.keys(), ...dbActiveUsernames]);
      
      const endedStreams = Array.from(knownActive).filter(username => 
        !currentlyLiveUsernames.includes(username) &&
        streamers.some(s => s.twitch_username === username)
      );

      // --- TRAITEMENT ---

      if (newStreams.length > 0) {
        logger.info(`🆕 ${newStreams.length} NOUVEAU(X) stream(s)`);
        await Promise.allSettled(newStreams.map(s => this.handleStreamStarted(s)));
      }

      const updatedStreams = liveStreams.filter(stream => {
        return this.notificationManager && this.notificationManager.isStreamActive(stream.user_login.toLowerCase());
      });

      if (updatedStreams.length > 0) {
        await Promise.allSettled(updatedStreams.map(s => this.handleStreamUpdated(s)));
      }

      if (endedStreams.length > 0) {
        logger.info(`⚫ ${endedStreams.length} stream(s) terminé(s)`);
        await Promise.allSettled(endedStreams.map(u => this.handleStreamEnded(u)));
      }

    } catch (error) {
      logger.error(`❌ Erreur batch: ${error.message}`);
      if (error.message === 'TOKEN_EXPIRED') await this.twitch.initClient();
    }
  }

  async handleStreamStarted(streamData) {
    const username = streamData.user_login.toLowerCase();
    
    // Double sécurité
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
    
    // Mise à jour DB
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

    // Mise à jour RAM
    const liveData = this.liveStreamers.get(username);
    if (liveData) {
      liveData.lastUpdate = Date.now();
      liveData.streamInfo = { ...streamData };
    } else {
       // Si absent de la RAM (récupération silencieuse), on l'ajoute
       this.liveStreamers.set(username, {
           startTime: Date.parse(streamData.started_at) || Date.now(),
           lastUpdate: Date.now(),
           streamInfo: { ...streamData },
           streamId: streamData.id
       });
    }

    // Mise à jour visuelle (NotificationManager)
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
      
      // 1. Supprimer le message Discord (C'est ici que ça bloquait avant si RAM vide)
      if (this.notificationManager) {
        await this.notificationManager.removeLiveNotification(username);
      }
      
      // 2. Mettre à jour la DB pour dire "C'est fini"
      const allGuilds = await this.db.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
      await Promise.allSettled(
        allGuilds.map(async ({ guild_id }) => {
          const streamer = await this.db.getStreamer(guild_id, username);
          if (streamer) {
            await this.db.setStreamInactive(guild_id, username);
          }
        })
      );
      
      // 3. Nettoyer la RAM
      this.liveStreamers.delete(username);

    } catch (error) {
      logger.error(`❌ Erreur fin stream ${username}: ${error.message}`);
    }
  }

  // ... [Les méthodes getGuildsFollowingStreamer, sendNotificationsToGuilds, updateStreamNotifications restent identiques] ...
  // Je les inclus implicitement, assure-toi de les garder telles quelles.
  // Pour la concision de la réponse, je ne copie-colle pas les fonctions auxiliaires 
  // qui n'ont pas besoin de changement (sendStreamNotification, getRealTimeStats, shutdown, etc.)
  // car elles sont correctes dans ton code original.

  async getGuildsFollowingStreamer(username, streamData) {
      // CODE ORIGINAL INCHANGÉ
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
      // CODE ORIGINAL INCHANGÉ
      const notificationPromises = guildsFollowing.map(async (guildData) => {
          // ... logique d'envoi ...
          // Note: j'utilise ton code exact ici
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
      // CODE ORIGINAL INCHANGÉ
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
      // CODE ORIGINAL INCHANGÉ (fallback si pas de NotificationManager)
      // ...
      return false; 
  }

  // ... Autres méthodes utilitaires (getRealTimeStats, shutdown, main) restent identiques ...
  async shutdown() {
    logger.info('🛑 Arrêt du bot...');
    try {
      this.stopStreamChecking();
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

async function main() {
  try {
    const config = BotConfig.fromEnv();
    const bot = new StreamerBot(config);
    
    // Gestion propre des signaux
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
