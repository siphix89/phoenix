const axios = require('axios');

class TwitchManager {
  constructor(config, logger) {
    this.clientId = config.twitchClientId;
    this.clientSecret = config.twitchClientSecret;
    this.logger = logger;
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.maxRetries = 3; // Nombre maximum de tentatives
  }

  async initClient() {
    try {
      if (!this.clientId || !this.clientSecret) {
        throw new Error('Client ID ou Client Secret Twitch manquant');
      }
      
      await this.getAccessToken();
      this.logger.info('✅ Client Twitch initialisé');
    } catch (error) {
      this.logger.error(`❌ Erreur initialisation Twitch: ${error.message}`);
      throw error;
    }
  }

  async getAccessToken() {
    try {
      const response = await axios.post('https://id.twitch.tv/oauth2/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials'
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);
      
      this.logger.info('🔑 Token Twitch obtenu');
      return this.accessToken;
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      this.logger.error(`❌ Erreur obtention token Twitch: ${errorMsg}`);
      throw new Error(`Impossible d'obtenir le token Twitch: ${errorMsg}`);
    }
  }

  async ensureValidToken() {
    if (!this.accessToken || Date.now() >= (this.tokenExpiresAt - 60000)) {
      await this.getAccessToken();
    }
  }

  async checkStreamStatus(username, retryCount = 0) {
    try {
      if (!username || username.trim() === '') {
        this.logger.warn('⚠️ Nom d\'utilisateur vide fourni');
        return { isLive: false, streamInfo: null };
      }

      await this.ensureValidToken();

      // Récupérer les informations utilisateur
      const userResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 10000
      });

      if (!userResponse.data.data || userResponse.data.data.length === 0) {
        this.logger.warn(`⚠️ Utilisateur Twitch '${username}' non trouvé`);
        return { isLive: false, streamInfo: null };
      }

      const userId = userResponse.data.data[0].id;

      // Vérifier si l'utilisateur est en live
      const streamResponse = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${userId}`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 10000
      });

      const isLive = streamResponse.data.data && streamResponse.data.data.length > 0;
      let streamInfo = null;

      if (isLive) {
        const stream = streamResponse.data.data[0];
        streamInfo = {
          title: stream.title || 'Titre non spécifié',
          game: stream.game_name || 'Jeu non spécifié',
          viewerCount: stream.viewer_count || 0,
          startedAt: new Date(stream.started_at),
          thumbnailUrl: stream.thumbnail_url 
            ? stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080')
            : null
        };
      }

      return { isLive, streamInfo };
    } catch (error) {
      // Gestion spécifique des erreurs d'API avec retry
      if (error.response?.status === 401 && retryCount < this.maxRetries) {
        this.logger.warn(`🔑 Token Twitch expiré, tentative ${retryCount + 1}/${this.maxRetries}`);
        this.accessToken = null; // Forcer le renouvellement
        await this.ensureValidToken();
        return this.checkStreamStatus(username, retryCount + 1);
      } else if (error.response?.status === 429) {
        this.logger.warn('⏳ Rate limit Twitch atteint');
        // Attendre avant de retourner
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { isLive: false, streamInfo: null };
      } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        if (retryCount < this.maxRetries) {
          this.logger.warn(`🔄 Erreur réseau, retry ${retryCount + 1}/${this.maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return this.checkStreamStatus(username, retryCount + 1);
        }
      }

      this.logger.error(`❌ Erreur vérification stream ${username} (tentative ${retryCount + 1}): ${error.message}`);
      return { isLive: false, streamInfo: null };
    }
  }

  async getUserInfo(username) {
    try {
      await this.ensureValidToken();

      const response = await axios.get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 10000
      });

      if (!response.data.data || response.data.data.length === 0) {
        return null;
      }

      const user = response.data.data[0];
      return {
        id: user.id,
        login: user.login,
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url,
        description: user.description,
        followerCount: user.view_count || 0,
        createdAt: new Date(user.created_at)
      };
    } catch (error) {
      this.logger.error(`❌ Erreur récupération info utilisateur ${username}: ${error.message}`);
      return null;
    }
  }
}

module.exports = TwitchManager;