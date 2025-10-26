// ===================================
// API SERVER POUR DASHBOARD PHOENIX BOT
// Version Multi-Serveurs - Chaque dashboard lié à UN serveur
// Fichier: dashboard/DashboardAPI.js
// ===================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class DashboardAPI {
  constructor(bot) {
    this.bot = bot;
    this.app = express();
    this.server = null;
    this.tokens = new Map(); // Stockage temporaire des tokens
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // CORS
    this.app.use(cors({
      origin: ['http://localhost:3001', 'http://127.0.0.1:3001'],
      credentials: true
    }));

    // Parse JSON
    this.app.use(express.json());

    // Servir fichiers statiques AVANT l'authentification
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Authentification UNIQUEMENT pour /api
    this.app.use('/api', this.authMiddleware.bind(this));
  }

  // Middleware d'authentification
  authMiddleware(req, res, next) {
    // Exemption pour la génération de token
    if (req.path === '/auth/generate-token') {
      return next();
    }

    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.query.token || 
                  req.body.token;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Token d\'authentification requis' 
      });
    }

    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return res.status(401).json({ 
        success: false, 
        error: 'Token invalide ou expiré' 
      });
    }

    // Vérifier l'expiration (24h)
    if (Date.now() > tokenData.expires) {
      this.tokens.delete(token);
      return res.status(401).json({ 
        success: false, 
        error: 'Token expiré' 
      });
    }

    // Ajouter les infos utilisateur ET serveur à la requête
    req.user = tokenData.user;
    req.guild = tokenData.guild;
    next();
  }

  setupRoutes() {
    // ==========================================
    // AUTHENTIFICATION
    // ==========================================

    // Générer un token d'accès (appelé depuis Discord)
    this.app.post('/api/auth/generate-token', (req, res) => {
      const { userId, guildId, userTag } = req.body;

      if (!userId || !guildId) {
        return res.status(400).json({ 
          success: false, 
          error: 'userId et guildId requis' 
        });
      }

      // Vérifier que l'utilisateur est admin du serveur
      const guild = this.bot.guilds.cache.get(guildId);
      if (!guild) {
        return res.status(404).json({ 
          success: false, 
          error: 'Serveur non trouvé' 
        });
      }

      const member = guild.members.cache.get(userId);
      if (!member || !this.bot.isAdmin(member)) {
        return res.status(403).json({ 
          success: false, 
          error: 'Permissions insuffisantes' 
        });
      }

      // Générer le token
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + (24 * 60 * 60 * 1000); // 24h

      this.tokens.set(token, {
        user: { id: userId, tag: userTag },
        guild: { 
          id: guildId, 
          name: guild.name,
          memberCount: guild.memberCount,
          icon: guild.iconURL()
        },
        expires,
        createdAt: Date.now()
      });

      console.log(`🔑 Token généré pour ${userTag} sur ${guild.name}`);

      res.json({
        success: true,
        token,
        expires,
        dashboardUrl: `http://localhost:3001/dashboard.html?token=${token}`,
        guild: {
          id: guildId,
          name: guild.name
        }
      });
    });

    // ==========================================
    // STATISTIQUES (Par serveur)
    // ==========================================

    this.app.get('/api/stats', async (req, res) => {
      try {
        const guildId = req.guild.id;
        
        // Récupérer les streamers de CE serveur uniquement
        const guildStreamers = await this.bot.db.getGuildStreamers(guildId);
        
        // Compter combien sont live
        const liveStreamers = guildStreamers.filter(s => 
          this.bot.liveStreamers.has(s.twitch_username)
        );

        const stats = {
          success: true,
          // Stats du serveur spécifique
          servers: 1, // Ce dashboard ne voit qu'un serveur
          users: req.guild.memberCount || 0,
          streamers: guildStreamers.length,
          liveStreamers: liveStreamers.length,
          // Stats système
          uptime: Date.now() - this.bot.readyTimestamp,
          ping: this.bot.ws.ping,
          memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          lastUpdate: new Date().toISOString(),
          // Infos du serveur
          guildId: guildId,
          guildName: req.guild.name
        };

        res.json(stats);
      } catch (error) {
        console.error('Erreur stats:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur lors de la récupération des statistiques' 
        });
      }
    });

    // ==========================================
    // GESTION DES STREAMERS (Par serveur)
    // ==========================================

    // Récupérer tous les streamers DU SERVEUR
    this.app.get('/api/streamers', async (req, res) => {
      try {
        const guildId = req.guild.id;
        
        // Récupérer uniquement les streamers de CE serveur
        const streamers = await this.bot.db.getGuildStreamers(guildId);
        
        const enrichedStreamers = streamers.map(streamer => {
          const isLive = this.bot.liveStreamers.has(streamer.twitch_username);
          const liveData = this.bot.liveStreamers.get(streamer.twitch_username);

          // DEBUG
          if (isLive && liveData) {
            console.log(`\n[DEBUG] ${streamer.twitch_username}:`);
            console.log('liveData:', liveData);
          }

          return {
            ...streamer,
            isLive,
            // Utiliser les bons noms de propriétés (snake_case)
            viewerCount: liveData?.streamInfo?.viewer_count || 0,
            game: liveData?.streamInfo?.game_name || null,
            title: liveData?.streamInfo?.title || null,
            startedAt: liveData?.startTime || null
          };
        });

        res.json({
          success: true,
          streamers: enrichedStreamers,
          guildId: guildId,
          guildName: req.guild.name
        });
      } catch (error) {
        console.error('Erreur streamers:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur lors de la récupération des streamers' 
        });
      }
    });

    // Ajouter un streamer AU SERVEUR
    this.app.post('/api/streamers/add', async (req, res) => {
      try {
        const { name, url } = req.body;
        const guildId = req.guild.id;

        if (!name || !url) {
          return res.status(400).json({ 
            success: false, 
            error: 'Nom et URL requis' 
          });
        }

        // Valider l'URL Twitch
        if (!this.bot.validateTwitchUrl(url)) {
          return res.status(400).json({ 
            success: false, 
            error: 'URL Twitch invalide' 
          });
        }

        // Vérifier si le streamer existe déjà DANS CE SERVEUR
        const existingStreamers = await this.bot.db.getGuildStreamers(guildId);
        if (existingStreamers.find(s => s.twitch_username.toLowerCase() === name.toLowerCase())) {
          return res.status(409).json({ 
            success: false, 
            error: 'Ce streamer est déjà suivi sur ce serveur' 
          });
        }

        // Ajouter à la base de données DU SERVEUR
        await this.bot.db.addStreamer(guildId, name, name, req.user.tag);

        console.log(`➕ Streamer ajouté via dashboard: ${name} par ${req.user.tag} sur ${req.guild.name}`);

        res.json({
          success: true,
          message: `Streamer "${name}" ajouté avec succès sur ${req.guild.name}`,
          streamer: { 
            name, 
            url, 
            addedBy: req.user.tag,
            guildId: guildId 
          }
        });

      } catch (error) {
        console.error('Erreur ajout streamer:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur lors de l\'ajout du streamer' 
        });
      }
    });

    // Supprimer un streamer DU SERVEUR
    this.app.delete('/api/streamers/:name', async (req, res) => {
      try {
        const { name } = req.params;
        const guildId = req.guild.id;

        // Vérifier si le streamer existe DANS CE SERVEUR
        const streamer = await this.bot.db.getStreamer(guildId, name);
        
        if (!streamer) {
          return res.status(404).json({ 
            success: false, 
            error: 'Streamer non trouvé sur ce serveur' 
          });
        }

        // Supprimer de la base de données DU SERVEUR
        await this.bot.db.removeStreamer(guildId, name);

        console.log(`🗑️ Streamer supprimé via dashboard: ${name} par ${req.user.tag} sur ${req.guild.name}`);

        res.json({
          success: true,
          message: `Streamer "${name}" supprimé avec succès de ${req.guild.name}`
        });

      } catch (error) {
        console.error('Erreur suppression streamer:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur lors de la suppression du streamer' 
        });
      }
    });

    // ==========================================
    // COMMANDES ET ACTIONS
    // ==========================================

    // Vérifier les streams (Pour ce serveur uniquement)
    this.app.post('/api/check-streams', async (req, res) => {
      try {
        const guildId = req.guild.id;
        
        console.log(`🔍 Vérification des streams demandée par ${req.user.tag} sur ${req.guild.name}`);
        
        // Lancer la vérification globale (tous les streamers)
        await this.bot.checkStreamersLive();
        
        // Compter les lives pour CE serveur
        const guildStreamers = await this.bot.db.getGuildStreamers(guildId);
        const liveCount = guildStreamers.filter(s => 
          this.bot.liveStreamers.has(s.twitch_username)
        ).length;
        
        res.json({
          success: true,
          message: `Vérification terminée: ${liveCount} streamers en direct sur ${req.guild.name}`,
          liveStreamers: guildStreamers
            .filter(s => this.bot.liveStreamers.has(s.twitch_username))
            .map(s => s.twitch_username)
        });

      } catch (error) {
        console.error('Erreur vérification streams:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur lors de la vérification des streams' 
        });
      }
    });

    // Test ping
    this.app.get('/api/ping', (req, res) => {
      const start = Date.now();
      
      res.json({
        success: true,
        ping: this.bot.ws.ping,
        responseTime: Date.now() - start,
        message: 'Pong! Bot Discord connecté',
        guild: {
          id: req.guild.id,
          name: req.guild.name
        }
      });
    });

    // Test API Twitch
    this.app.post('/api/test-twitch', async (req, res) => {
      try {
        if (!this.bot.twitch) {
          return res.status(503).json({ 
            success: false, 
            error: 'API Twitch non configurée' 
          });
        }

        // Test simple avec un streamer connu
        const testResult = await this.bot.twitch.checkStreamStatus('ninja');
        
        res.json({
          success: true,
          message: 'API Twitch opérationnelle',
          data: {
            connected: true,
            hasToken: !!this.bot.twitch.accessToken,
            testStreamer: 'ninja',
            testResult: testResult.isLive ? 'En ligne' : 'Hors ligne'
          }
        });

      } catch (error) {
        console.error('Erreur test Twitch:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur lors du test API Twitch: ' + error.message 
        });
      }
    });

    // ==========================================
    // INFORMATIONS DU SERVEUR
    // ==========================================

    // Récupérer les infos du serveur connecté
    this.app.get('/api/guild-info', async (req, res) => {
      try {
        const guild = this.bot.guilds.cache.get(req.guild.id);
        
        if (!guild) {
          return res.status(404).json({ 
            success: false, 
            error: 'Serveur non trouvé' 
          });
        }

        const stats = await this.bot.db.getGuildStats(req.guild.id);

        res.json({
          success: true,
          guild: {
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL({ size: 128 }),
            memberCount: guild.memberCount,
            createdAt: guild.createdAt,
            ownerId: guild.ownerId
          },
          stats: stats
        });

      } catch (error) {
        console.error('Erreur guild-info:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Erreur récupération infos serveur' 
        });
      }
    });

    // ==========================================
    // PAGE DASHBOARD
    // ==========================================

    this.app.get('/dashboard.html', (req, res) => {
      const token = req.query.token;
      
      if (!token || !this.tokens.has(token)) {
        return res.status(401).send(`
          <html>
            <head><title>Accès refusé - Phoenix Bot</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #0f0f23; color: white;">
              <h1>🔒 Accès refusé</h1>
              <p>Token d'authentification invalide ou expiré.</p>
              <p>Utilisez la commande <code>/dash type:web</code> sur Discord pour générer un nouveau lien.</p>
            </body>
          </html>
        `);
      }

      // Servir le fichier dashboard HTML
      const dashboardPath = path.join(__dirname, 'public', 'index.html');
      if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
      } else {
        res.status(404).send('Dashboard non trouvé - Placez votre fichier HTML dans dashboard/public/index.html');
      }
    });

    // Route par défaut
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'Phoenix Bot API - Dashboard Multi-Serveurs',
        version: '3.0.0',
        features: [
          'Dashboard isolé par serveur Discord',
          'Gestion des streamers par serveur',
          'Statistiques en temps réel',
          'Notifications automatiques'
        ],
        endpoints: [
          'GET /api/stats - Statistiques du serveur',
          'GET /api/streamers - Liste des streamers du serveur',
          'POST /api/streamers/add - Ajouter un streamer',
          'DELETE /api/streamers/:name - Supprimer un streamer',
          'POST /api/check-streams - Vérifier les streams',
          'GET /api/guild-info - Infos du serveur',
          'GET /api/ping - Test connexion',
          'POST /api/test-twitch - Test API Twitch'
        ]
      });
    });
  }

  start(port = 3001) {
    this.server = this.app.listen(port, () => {
      console.log(`🌐 Dashboard API démarrée sur le port ${port}`);
      console.log(`📊 Dashboard multi-serveurs accessible via: http://localhost:${port}/dashboard.html?token=TOKEN`);
      console.log(`🔐 Chaque token est lié à un serveur Discord spécifique`);
    });
  }

  // Méthode pour nettoyer les tokens expirés
  cleanupExpiredTokens() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [token, data] of this.tokens.entries()) {
      if (now > data.expires) {
        this.tokens.delete(token);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🗑️ ${cleaned} token(s) expiré(s) supprimé(s)`);
    }
  }
}

module.exports = DashboardAPI;