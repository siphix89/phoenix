// ===== bot.js =====
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Colors, ActivityType, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const fs = require('fs');

// Imports des modules personnalisés
const DatabaseManager = require('./database/databasemanager.js');
const TwitchManager = require('./twitch/TwitchManager');
const { BotConfig, logger, StreamerStatus } = require('./config');
const { BotMetrics, RuleAcceptanceViewHandler } = require('./models');
const { sendLiveNotification, removeLiveNotification, updateLiveNotification } = require('./notifications');

// Import du dashboard externe
const dashboardServer = require('./dashboard-server.js');

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
    this.twitch = new TwitchManager(config, logger);
    this.liveStreamers = new Map();
    this.liveMessages = new Map();
    this.metrics = new BotMetrics();
    this.ruleHandler = null;
    this.checkInterval = null;
    this.commands = new Collection();

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

      // Initialiser Twitch
      if (this.config.twitchClientId && this.config.twitchClientSecret) {
        try {
          await this.twitch.initClient();
        } catch (error) {
          logger.error('❌ Impossible d\'initialiser Twitch, notifications désactivées');
        }
      } else {
        logger.warn('⚠️ Credentials Twitch manquants, notifications désactivées');
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

      // Démarrer la vérification périodique des streams
      if (this.config.autoNotifications && this.config.twitchClientId && this.config.twitchClientSecret) {
        this.startStreamChecking();
      }

      // Mettre à jour le statut du bot
      await this.user.setPresence({
        activities: [{ 
          name: `${streamersCount} streamers`, 
          type: ActivityType.Watching 
        }],
        status: 'online',
      });

      logger.info('✅ Bot entièrement initialisé!');
    } catch (error) {
      logger.error(`❌ Erreur lors de l'initialisation: ${error.message}`);
      this.metrics.recordError();
    }
  }

  async onGuildMemberAdd(member) {
    try {
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

      const embed = new EmbedBuilder()
        .setTitle('🎉 Bienvenue sur le serveur !')
        .setDescription(`Salut ${member.toString()} ! Nous sommes ravis de t'accueillir parmi nous ! 🚀`)
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
      // Gérer les boutons de règlement (système existant)
      if (this.ruleHandler && interaction.isButton()) {
        await this.ruleHandler.handleInteraction(interaction);
        return;
      }

      // Gérer les boutons du règlement-dashboard
      if (interaction.isButton() && interaction.customId.startsWith('accept_rules_')) {
        const reglementCommand = this.commands.get('reglement-dashboard');
        if (reglementCommand && reglementCommand.handleButtonInteraction) {
          const handled = await reglementCommand.handleButtonInteraction(interaction, this);
          if (handled) return;
        }
      }

      // Gérer les boutons du dashboard Phoenix
      if (interaction.isButton() && ['refresh_dashboard', 'bot_settings', 'view_streamers'].includes(interaction.customId)) {
        if (!interaction.member.permissions.has('Administrator')) {
          return interaction.reply({
            content: '❌ Permissions insuffisantes',
            flags: 64
          });
        }

        // Bouton Actualiser
        if (interaction.customId === 'refresh_dashboard') {
          const guild = interaction.guild;
          const streamersCount = this.liveStreamers?.size || 0;
          const totalStreamers = (await this.db.getAllStreamers()).length;
          
          const botStats = {
            servers: this.guilds.cache.size,
            users: this.users.cache.size,
            uptime: Math.floor(this.uptime / 1000),
            streamers: totalStreamers,
            liveStreamers: streamersCount,
            ping: this.ws.ping
          };

          const embed = new EmbedBuilder()
            .setTitle('🔥 Phoenix Bot Dashboard (Actualisé)')
            .setDescription(`Tableau de bord de **${this.user.username}**`)
            .addFields(
              { name: '🖥️ Serveurs', value: `${botStats.servers}`, inline: true },
              { name: '👥 Utilisateurs', value: `${botStats.users.toLocaleString()}`, inline: true },
              { name: '🎮 Streamers totaux', value: `${botStats.streamers}`, inline: true },
              { name: '🔴 En live', value: `${botStats.liveStreamers}`, inline: true },
              { name: '⏱️ Uptime', value: `${Math.floor(botStats.uptime / 3600)}h ${Math.floor((botStats.uptime % 3600) / 60)}m`, inline: true },
              { name: '📡 Ping', value: `${botStats.ping}ms`, inline: true }
            )
            .setColor('#00FF00')
            .setThumbnail(this.user.displayAvatarURL())
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

          await interaction.update({ 
            embeds: [embed], 
            components: [buttons]
          });
          return;
        }

        // Bouton Informations système
        if (interaction.customId === 'bot_settings') {
          const settingsEmbed = new EmbedBuilder()
            .setTitle('⚙️ Informations Système - Phoenix Bot')
            .setDescription('Configuration et état actuel du système')
            .addFields(
              { name: '🔧 Version', value: 'Phoenix Bot v2.0.0', inline: true },
              { name: '📅 Démarré', value: `<t:${Math.floor((Date.now() - this.uptime) / 1000)}:R>`, inline: true },
              { name: '💾 Mémoire utilisée', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true },
              { name: '🐧 Plateforme', value: process.platform, inline: true },
              { name: '📡 Latence WebSocket', value: `${this.ws.ping}ms`, inline: true },
              { name: '🔗 Node.js', value: process.version, inline: true }
            )
            .setColor('#FFD700')
            .setTimestamp();

          await interaction.reply({ 
            embeds: [settingsEmbed], 
            flags: 64
          });
          return;
        }

        // Bouton Voir streamers
        if (interaction.customId === 'view_streamers') {
          const streamers = await this.db.getAllStreamers();
          
          if (streamers.length === 0) {
            const noStreamersEmbed = new EmbedBuilder()
              .setTitle('📊 Liste des Streamers')
              .setDescription('Aucun streamer enregistré pour le moment.')
              .setColor('#ff6b6b');
              
            await interaction.reply({ 
              embeds: [noStreamersEmbed], 
              flags: 64
            });
            return;
          }

          const liveStreamers = Array.from(this.liveStreamers.keys());
          const streamersText = streamers.slice(0, 10).map(streamer => {
            const isLive = liveStreamers.includes(streamer.name);
            const status = isLive ? '🔴 **LIVE**' : '⚫ Hors ligne';
            return `• **${streamer.name}** - ${status}`;
          }).join('\n');

          const streamersEmbed = new EmbedBuilder()
            .setTitle('📊 Liste des Streamers')
            .setDescription(streamersText)
            .addFields(
              { name: '📈 Statistiques', value: `**${streamers.length}** streamers • **${liveStreamers.length}** en live`, inline: false }
            )
            .setColor('#4ecdc4')
            .setTimestamp();

          await interaction.reply({ 
            embeds: [streamersEmbed], 
            flags: 64
          });
          return;
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
            flags: 64
          };

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
          } else {
            await interaction.reply(errorMessage);
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

    // Démarrer la vérification périodique
    const intervalMs = this.config.notificationIntervalMinutes * 60 * 1000;
    this.checkInterval = setInterval(() => {
      this.checkStreamersLive().catch(error => {
        logger.error(`❌ Erreur lors de la vérification des streams: ${error.message}`);
        this.metrics.recordError();
      });
    }, intervalMs);

    logger.info(`🔔 Système de notifications live démarré (${this.config.notificationIntervalMinutes} min)`);
  }

  async checkStreamersLive() {
    if (!this.isReady()) {
      logger.warn('⚠️ Bot non prêt, vérification ignorée');
      return;
    }

    logger.info('🔍 Vérification des streamers en live...');

    try {
      const streamers = await this.db.getAllStreamers();

      if (streamers.length === 0) {
        logger.info('📭 Aucun streamer à vérifier');
        return;
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
            await sendLiveNotification(this, streamer, streamInfo);
            this.liveStreamers.set(streamer.name, true);
            logger.info(`🔴 ${streamer.name} détecté en live`);
          } else if (!isLive && this.liveStreamers.has(streamer.name)) {
            await removeLiveNotification(this, streamer.name);
            this.liveStreamers.delete(streamer.name);
            logger.info(`⚫ ${streamer.name} n'est plus en live`);
          }

          // Petit délai entre les requêtes pour éviter le rate limit
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`❌ Erreur vérification ${streamer.name}: ${error.message}`);
          this.metrics.recordError();
        }
      }

      logger.info(`✅ Vérification terminée - ${this.liveStreamers.size} streamers en live`);
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
        dashboardServer.startDashboard(bot);
        logger.info('🌐 Dashboard externe démarré sur http://localhost:3000');
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


