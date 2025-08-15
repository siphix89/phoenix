// ===== bot.js =====
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Colors, ActivityType, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const fs = require('fs');

// Imports des modules personnalisés avec gestion d'erreurs
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
  console.log('✅ NotificationManager chargé avec succès');
} catch (error) {
  console.log('⚠️ Module notifications non trouvé, notifications désactivées');
}

// Import du dashboard externe
const dashboardServer = require('./dashboard-server.js');

// Import des boutons
const ButtonManager = require('./boutons/gestion.js');
console.log('🔍 DEBUG: ButtonManager importé:', typeof ButtonManager);

// Keep-alive désactivé temporairement
// const { keepAlive } = require('./keepalive.js');

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
    this.db = new DatabaseManager('streamers.db', logger);
    this.twitch = TwitchManager ? new TwitchManager(config, logger) : null;
    this.liveStreamers = new Map(); // Stocke les streamers actuellement en live
    this.liveMessages = new Map(); // Compatibilité ancienne version
    this.metrics = new BotMetrics();
    this.ruleHandler = null;
    this.checkInterval = null;
    this.commands = new Collection();
    this.keepAliveServer = null; // Désactivé temporairement
    this.notificationManager = null; // Référence directe
    this.buttonManager = null; // Corrigé: ajout de la propriété manquante
    
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
        // Supprimer du cache pour permettre le rechargement
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
    this.on('guildMemberAdd', this.onGuildMemberAdd.bind(this));
    this.on('messageCreate', this.onMessageCreate.bind(this));
    this.on('interactionCreate', this.onInteractionCreate.bind(this));
    
    // Gestion des erreurs
    this.on('error', (error) => {
      logger.error(`❌ Erreur client Discord: ${error.message}`);
      this.metrics.recordError();
    });

    this.on('warn', (warning) => {
      logger.warn(`⚠️ Avertissement Discord: ${warning}`);
    });
  }

  async onReady() {
    logger.info('🤖 Bot en ligne!');
    logger.info(`🆔 ${this.user.tag} connecté`);

    try {
      // Initialiser la base de données
      await this.db.connect();
      await this.db.initDatabase();

      // Initialiser le ButtonManager
      try {
        this.buttonManager = new ButtonManager(this);
        logger.info('✅ ButtonManager initialisé');
      } catch (error) {
        logger.error(`❌ Erreur initialisation ButtonManager: ${error.message}`);
      }

      // Initialiser Twitch et les notifications
      if (this.twitch && this.config.twitchClientId && this.config.twitchClientSecret) {
        try {
          logger.info('🔧 Initialisation de Twitch...');
          await this.twitch.initClient();
          logger.info('✅ Client Twitch initialisé');
          
          // Initialiser le gestionnaire de notifications
          if (NotificationManager) {
            this.notificationManager = new NotificationManager(this);
            notificationManager = this.notificationManager; // Compatibilité
            logger.info('✅ NotificationManager initialisé');
            
            // Démarrer les notifications automatiquement si configuré
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
          // Ne pas bloquer complètement, on réessaiera plus tard
        }
      } else {
        logger.warn('⚠️ Configuration Twitch incomplète:');
        logger.warn(`   - TwitchManager: ${this.twitch ? 'Disponible' : 'Manquant'}`);
        logger.warn(`   - Client ID: ${this.config.twitchClientId ? 'Configuré' : 'Manquant'}`);
        logger.warn(`   - Client Secret: ${this.config.twitchClientSecret ? 'Configuré' : 'Manquant'}`);
      }

      // Enregistrer les commandes slash
      try {
        const commandsData = Array.from(this.commands.values()).map(command => command.data.toJSON());
        await this.application.commands.set(commandsData);
        logger.info(`⚡ ${commandsData.length} commandes slash synchronisées`);
      } catch (error) {
        logger.error(`❌ Erreur synchronisation commandes: ${error.message}`);
      }

      // Configurer le gestionnaire de rôles
      if (this.config.rulesRoleId && this.config.rulesRoleId !== 0) {
        this.ruleHandler = new RuleAcceptanceViewHandler(
          this.config.rulesRoleId,
          this.config.rulesRoleName,
          logger
        );
      }

      const streamersCount = (await this.db.getAllStreamers()).length;
      logger.info(`📊 ${streamersCount} streamers chargés`);

      // Mettre à jour le statut du bot
      await this.user.setPresence({
        activities: [{ 
          name: `${streamersCount} streamers`, 
          type: ActivityType.Watching 
        }],
        status: 'online',
      });

      // Afficher l'état des notifications
      logger.info('📋 État des notifications:');
      logger.info(`   - Auto notifications: ${this.config.autoNotifications ? 'Activées' : 'Désactivées'}`);
      logger.info(`   - Interval: ${this.config.notificationIntervalMinutes || 5} minutes`);
      logger.info(`   - Check interval actif: ${this.checkInterval ? 'Oui' : 'Non'}`);
      logger.info(`   - NotificationManager: ${this.notificationManager ? 'Initialisé' : 'Non disponible'}`);

      logger.info('✅ Bot entièrement initialisé!');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'initialisation: ${error.message}`);
      this.metrics.recordError();
    }
  }

  // Méthode pour démarrer manuellement les notifications
  async startNotifications() {
    try {
      logger.info('🔧 Tentative de démarrage manuel des notifications...');
      
      if (!this.twitch) {
        throw new Error('TwitchManager non disponible');
      }
      
      if (!this.config.twitchClientId || !this.config.twitchClientSecret) {
        throw new Error('Credentials Twitch manquants');
      }
      
      // Initialiser Twitch si pas déjà fait
      if (!this.twitch.accessToken) {
        logger.info('🔑 Initialisation du client Twitch...');
        await this.twitch.initClient();
      }
      
      // Initialiser NotificationManager si pas déjà fait
      if (!this.notificationManager && NotificationManager) {
        this.notificationManager = new NotificationManager(this);
        notificationManager = this.notificationManager;
        logger.info('✅ NotificationManager initialisé manuellement');
      }
      
      // Démarrer la vérification
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
          logger.error(`Stack trace: ${roleError.stack}`);
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

      const streamersCount = (await this.db.getAllStreamers()).length;

      // Récupérer le nom du rôle attribué pour l'afficher dans l'embed
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
            value: `👥 **${member.guild.memberCount}** membres\n🎮 **${streamersCount}** streamers`,
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

      // Réponses automatiques
      if (['stream', 'live'].includes(contentLower)) {
        const embed = new EmbedBuilder()
          .setDescription(`👋 Salut ${message.author.toString()} ! Découvre nos streamers !`)
          .setColor(Colors.Blue);
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      }
    } catch (error) {
      logger.error(`❌ Erreur traitement message: ${error.message}`);
      this.metrics.recordError();
    }
  }
  
  async onInteractionCreate(interaction) {
    try {
      // Gérer les boutons avec le nouveau système
      // Initialiser buttonManager si pas encore fait
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

      // Gérer les commandes slash
      if (interaction.isChatInputCommand()) {
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

      // Gérer l'autocomplétion
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
    
    // Vérifications préalables
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

    // Démarrer la vérification périodique
    const intervalMs = (this.config.notificationIntervalMinutes || 5) * 60 * 1000;
    
    logger.info(`🔔 Démarrage du système de notifications (intervalle: ${this.config.notificationIntervalMinutes || 5} min)`);
    
    // Première vérification immédiate
    this.checkStreamersLive().catch(error => {
      logger.error(`❌ Erreur première vérification: ${error.message}`);
    });
    
    // Puis vérifications périodiques
    this.checkInterval = setInterval(() => {
      this.checkStreamersLive().catch(error => {
        logger.error(`❌ Erreur vérification périodique: ${error.message}`);
        this.metrics.recordError();
      });
    }, intervalMs);

    logger.info(`🔔 Système de notifications démarré avec succès`);
  }

  async checkStreamersLive() {
    if (!this.isReady() || !this.twitch) {
      logger.warn('⚠️ Bot non prêt ou Twitch indisponible, vérification ignorée');
      return;
    }

    logger.info('🔍 Vérification des streamers en live...');

    try {
      const streamers = await this.db.getAllStreamers();

      if (streamers.length === 0) {
        logger.info('📭 Aucun streamer à vérifier');
        return;
      }

      // Nettoyage périodique des streams inactifs
      if (this.notificationManager) {
        this.notificationManager.cleanupInactiveStreams();
      }

      for (const streamer of streamers) {
        try {
          const twitchName = streamer.url.split('/').pop();
          if (!twitchName) {
            logger.warn(`⚠️ URL invalide pour ${streamer.name}: ${streamer.url}`);
            continue;
          }

          const { isLive, streamInfo } = await this.twitch.checkStreamStatus(twitchName);

          if (isLive && !this.liveStreamers.has(streamer.name)) {
            // ✅ NOUVEAU STREAM DÉTECTÉ
            if (this.notificationManager) {
              try {
                const success = await this.notificationManager.sendLiveNotification(streamer, streamInfo);
                if (success) {
                  logger.info(`🔴 ${streamer.name} détecté en live - notification envoyée`);
                  this.liveStreamers.set(streamer.name, { 
                    startTime: Date.now(), 
                    lastUpdate: Date.now(),
                    streamInfo: { ...streamInfo }
                  });
                } else {
                  logger.warn(`⚠️ Notification live échouée pour ${streamer.name}`);
                }
              } catch (notifError) {
                logger.warn(`⚠️ Notification live échouée pour ${streamer.name}: ${notifError.message}`);
              }
            } else {
              logger.info(`🔴 ${streamer.name} est en live (notifications désactivées)`);
              this.liveStreamers.set(streamer.name, { 
                startTime: Date.now(), 
                lastUpdate: Date.now(),
                streamInfo: { ...streamInfo }
              });
            }
            
          } else if (isLive && this.liveStreamers.has(streamer.name)) {
            // ✅ STREAM TOUJOURS EN COURS - MISE À JOUR
            if (this.notificationManager) {
              try {
                const success = await this.notificationManager.updateLiveNotification(streamer, streamInfo);
                if (success) {
                  logger.info(`🔄 ${streamer.name} toujours en live - notification mise à jour`);
                  // Mettre à jour les informations locales
                  const liveData = this.liveStreamers.get(streamer.name);
                  if (liveData) {
                    liveData.lastUpdate = Date.now();
                    liveData.streamInfo = { ...streamInfo };
                  }
                } else {
                  logger.warn(`⚠️ Mise à jour notification échouée pour ${streamer.name}`);
                }
              } catch (notifError) {
                logger.warn(`⚠️ Mise à jour notification échouée pour ${streamer.name}: ${notifError.message}`);
              }
            } else {
              logger.info(`🔄 ${streamer.name} toujours en live (notifications désactivées)`);
              // Mettre à jour même sans notifications
              const liveData = this.liveStreamers.get(streamer.name);
              if (liveData) {
                liveData.lastUpdate = Date.now();
                liveData.streamInfo = { ...streamInfo };
              }
            }
            
          } else if (!isLive && this.liveStreamers.has(streamer.name)) {
            // ✅ STREAM TERMINÉ
            if (this.notificationManager) {
              try {
                await this.notificationManager.removeLiveNotification(streamer.name);
                logger.info(`⚫ ${streamer.name} n'est plus en live - notification supprimée`);
              } catch (notifError) {
                logger.warn(`⚠️ Suppression notification échouée pour ${streamer.name}: ${notifError.message}`);
              }
            } else {
              logger.info(`⚫ ${streamer.name} n'est plus en live (notifications désactivées)`);
            }
            this.liveStreamers.delete(streamer.name);
          }

          // Petit délai entre les requêtes pour éviter le rate limit
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`❌ Erreur vérification ${streamer.name}: ${error.message}`);
          this.metrics.recordError();
        }
      }

      logger.info(`✅ Vérification terminée - ${this.liveStreamers.size} streamers en live`);
      
      // Log détaillé des streams actifs pour debug
      if (this.liveStreamers.size > 0) {
        logger.info('📊 Streams actifs:');
        for (const [name, data] of this.liveStreamers.entries()) {
          const duration = Math.floor((Date.now() - data.startTime) / 60000);
          logger.info(`   - ${name}: ${duration}min (viewers: ${data.streamInfo?.viewerCount || 'N/A'})`);
        }
      }
    } catch (error) {
      logger.error(`❌ Erreur lors de la vérification globale: ${error.message}`);
      this.metrics.recordError();
    }
  }

  async shutdown() {
    logger.info('🛑 Arrêt du bot...');
    
    try {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        logger.info('⏹️ Arrêt de la vérification des streams');
      }

      await this.db.close();
      await this.destroy();
      
      logger.info('✅ Bot arrêté proprement');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'arrêt: ${error.message}`);
    }
  }
}

// Initialisation et démarrage du bot
async function main() {
  try {
    // Charger la configuration
    const config = BotConfig.fromEnv();
    
    // Valider la configuration
    const configErrors = config.validate();
    if (Object.keys(configErrors).length > 0) {
      logger.error('❌ Erreurs de configuration:');
      Object.entries(configErrors).forEach(([field, error]) => {
        logger.error(`  • ${field}: ${error}`);
      });
      process.exit(1);
    }

    // Créer le bot
    const bot = new StreamerBot(config);

    // Démarrer le dashboard externe après que le bot soit prêt
    bot.on('ready', () => {
      setTimeout(() => {
        try {
          dashboardServer.startDashboard(bot);
          logger.info('🌐 Dashboard externe démarré sur http://localhost:3000');
        } catch (error) {
          logger.warn('⚠️ Impossible de démarrer le dashboard externe:', error.message);
        }
      }, 2000);
    });

    // Gérer l'arrêt propre
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

    // Connecter le bot
    await bot.login(config.discordToken);
    
  } catch (error) {
    logger.error(`❌ Erreur fatale: ${error.message}`);
    process.exit(1);
  }
}

// Lancer l'application
if (require.main === module) {
  main();
}

module.exports = StreamerBot;



