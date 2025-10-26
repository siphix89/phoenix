const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const dotenv = require('dotenv');

// Chargement des variables d'environnement
dotenv.config();

// Détection de l'environnement de production
function isProductionEnvironment() {
  return Boolean(
    process.env.RENDER ||
    process.env.HEROKU ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.VERCEL ||
    process.env.NODE_ENV === 'production' ||
    process.env.ENVIRONMENT === 'production'
  );
}

const IS_PRODUCTION = isProductionEnvironment();

// Configuration du logger
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} - ${level.toUpperCase()} - ${message}`;
});

const logger = createLogger({
  level: 'info',
  format: combine(timestamp(), logFormat),
  transports: [
    new transports.Console(),
    new transports.File({ 
      filename: 'bot.log', 
      maxsize: 10 * 1024 * 1024, 
      maxFiles: 5 
    }),
    new transports.File({ 
      filename: 'bot_errors.log', 
      level: 'error', 
      maxsize: 5 * 1024 * 1024, 
      maxFiles: 3 
    }),
  ],
});

// Enums
const StreamerStatus = Object.freeze({
  AFFILIE: 'affilie',
  NON_AFFILIE: 'non_affilie',
});

const ErrorType = Object.freeze({
  API_ERROR: "api_error",
  DATABASE_ERROR: "database_error",
  PERMISSION_ERROR: "permission_error",
  VALIDATION_ERROR: "validation_error",
  RATE_LIMIT_ERROR: "rate_limit_error",
});

const HealthStatus = Object.freeze({
  HEALTHY: "healthy",
  WARNING: "warning",
  UNHEALTHY: "unhealthy",
  ERROR: "error",
});

// Configuration du bot
class BotConfig {
  constructor({
    discordToken,
    commandPrefix = "!",
    liveAffilieChannel = 0,
    liveNonAffilieChannel = 0,
    welcomeChannel = 0,
    logsChannel = 0,
    twitchClientId = "",
    twitchClientSecret = "",
    rulesRoleId = 0,
    rulesRoleName = "Membre Vérifié",
    autoNotifications = true,
    notificationIntervalMinutes = 2,
    autoRoleId = 0,
  }) {
    this.discordToken = discordToken;
    this.commandPrefix = commandPrefix;
    this.liveAffilieChannel = liveAffilieChannel;
    this.liveNonAffilieChannel = liveNonAffilieChannel;
    this.welcomeChannel = welcomeChannel;
    this.logsChannel = logsChannel;
    this.twitchClientId = twitchClientId;
    this.twitchClientSecret = twitchClientSecret;
    this.rulesRoleId = rulesRoleId;
    this.rulesRoleName = rulesRoleName;
    this.autoRoleId = autoRoleId;
    this.autoNotifications = autoNotifications;
    this.notificationIntervalMinutes = notificationIntervalMinutes;
  }

  static fromEnv() {
    return new BotConfig({
      discordToken: process.env.DISCORD_TOKEN || "",
      commandPrefix: process.env.COMMAND_PREFIX || "!",
      liveAffilieChannel: process.env.CHANNEL_LIVE_AFFILIE || "0",
      liveNonAffilieChannel: process.env.CHANNEL_LIVE_NON_AFFILIE || "0",
      welcomeChannel: process.env.CHANNEL_WELCOME || "0",
      logsChannel: process.env.CHANNEL_LOGS || "0",
      twitchClientId: process.env.TWITCH_CLIENT_ID || "",
      twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
      rulesRoleId: process.env.RULES_ROLE_ID || "0",
      rulesRoleName: process.env.RULES_ROLE_NAME || "Membre Vérifié",
      autoRoleId: process.env.AUTO_ROLE_ID || "0",
      autoNotifications: (process.env.AUTO_NOTIFICATIONS || "true").toLowerCase() === "true",
      notificationIntervalMinutes: parseInt(process.env.NOTIFICATION_INTERVAL) || 2,
    });
  }

  validate() {
    const errors = {};

    if (!this.discordToken) {
      errors.discordToken = "Token Discord requis";
    }
    if (this.liveAffilieChannel === 0) {
      errors.liveAffilieChannel = "ID du channel live affilié requis";
    }
    if (this.liveNonAffilieChannel === 0) {
      errors.liveNonAffilieChannel = "ID du channel live non-affilié requis";
    }

    return errors;
  }
}

module.exports = {
  IS_PRODUCTION,
  logger,
  StreamerStatus,
  ErrorType,
  HealthStatus,
  BotConfig
};