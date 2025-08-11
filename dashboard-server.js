// dashboard-server.js - Serveur Express pour Phoenix Bot
const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

// Variables pour les stats
let activityLogs = [];
let systemLogs = [];
let authTokens = new Map();
let botInstance = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fonction utilitaire pour ajouter des logs
function addLog(level, message) {
    const logEntry = {
        timestamp: new Date(),
        level,
        message
    };
    
    systemLogs.push(logEntry);
    
    // Garder seulement les 100 derniers logs
    if (systemLogs.length > 100) {
        systemLogs = systemLogs.slice(-100);
    }
    
    console.log(`[DASHBOARD-${level.toUpperCase()}] ${message}`);
}

// Fonction pour ajouter une activité
function addActivity(action) {
    const activity = {
        time: new Date(),
        action
    };
    
    activityLogs.unshift(activity);
    
    // Garder seulement les 50 dernières activités
    if (activityLogs.length > 50) {
        activityLogs = activityLogs.slice(0, 50);
    }
}

// Fonction pour générer un token d'auth
function generateAuthToken(userId, guildId) {
    const token = crypto.randomBytes(32).toString('hex');
    authTokens.set(token, {
        userId,
        guildId,
        expires: Date.now() + (10 * 60 * 1000) // 10 minutes
    });

    // Nettoyage automatique
    setTimeout(() => {
        authTokens.delete(token);
    }, 10 * 60 * 1000);

    return token;
}

// ==========================================
// ROUTES PUBLIQUES (sans authentification)
// ==========================================

// Route de santé pour le monitoring (NOUVELLE ROUTE AJOUTÉE)
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        bot: botInstance?.user?.tag || 'Unknown',
        uptime: botInstance?.uptime || 0,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        ping: botInstance?.ws?.ping || 0
    });
});

// Route dashboard principale avec authentification
app.get('/dashboard', (req, res) => {
    const token = req.query.token;
    
    if (!token) {
        return res.status(401).send(`
            <h1>🔒 Accès refusé</h1>
            <p>Utilisez la commande <code>/dash type:web</code> sur Discord pour obtenir un lien d'accès.</p>
        `);
    }

    const authData = authTokens.get(token);
    
    if (!authData || Date.now() > authData.expires) {
        authTokens.delete(token);
        return res.status(401).send(`
            <h1>⏰ Lien expiré</h1>
            <p>Utilisez la commande <code>/dash type:web</code> sur Discord pour générer un nouveau lien.</p>
        `);
    }

    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ==========================================
// MIDDLEWARE D'AUTHENTIFICATION POUR /api
// ==========================================

// Middleware d'authentification pour les API
app.use('/api', (req, res, next) => {
    const token = req.query.token || req.body.token;
    if (!token) {
        return res.status(401).json({ error: 'Token manquant' });
    }

    const authData = authTokens.get(token);
    if (!authData || Date.now() > authData.expires) {
        authTokens.delete(token);
        return res.status(401).json({ error: 'Token expiré' });
    }

    req.authData = authData;
    next();
});

// ==========================================
// API ROUTES (avec authentification)
// ==========================================

// API Statistiques du bot - ADAPTÉE À VOTRE DB
app.get('/api/stats', async (req, res) => {
    try {
        let stats = {
            servers: 0,
            users: 0,
            streamers: 0,
            liveStreamers: 0,
            uptime: 0,
            ping: 0,
            memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
            status: 'offline'
        };

        // Si le bot est connecté
        if (botInstance && botInstance.isReady()) {
            stats.servers = botInstance.guilds.cache.size;
            stats.users = botInstance.users.cache.size;
            stats.ping = botInstance.ws.ping || 0;
            stats.uptime = botInstance.uptime;
            stats.status = 'online';
            
            // Récupérer les streamers depuis VOTRE base de données
            try {
                const streamers = await botInstance.db.getAllStreamers();
                stats.streamers = streamers.length;
                stats.liveStreamers = botInstance.liveStreamers ? botInstance.liveStreamers.size : 0;
            } catch (dbError) {
                console.error('Erreur DB dans stats:', dbError);
            }
        }

        res.json(stats);
    } catch (error) {
        console.error('Erreur API stats:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// API Liste des streamers - ADAPTÉE À VOTRE STRUCTURE
app.get('/api/streamers', async (req, res) => {
    try {
        if (!botInstance || !botInstance.db) {
            return res.status(500).json({ success: false, error: 'Bot non disponible' });
        }

        const dbStreamers = await botInstance.db.getAllStreamers();
        
        const streamersData = dbStreamers.map(streamer => ({
            name: streamer.name,
            url: streamer.url,
            isLive: botInstance.liveStreamers ? botInstance.liveStreamers.has(streamer.name) : false,
            isAffiliate: streamer.status === 'affilie',
            description: streamer.description,
            followers: streamer.followers || 0,
            totalStreams: streamer.total_streams || 0,
            totalHours: streamer.total_hours || 0,
            createdAt: streamer.created_at,
            updatedAt: streamer.updated_at
        }));

        addActivity(`Liste streamers consultée (${streamersData.length} streamers)`);
        res.json({ success: true, streamers: streamersData });
    } catch (error) {
        console.error('Erreur API streamers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Ajouter un streamer - ADAPTÉE À VOTRE TABLE
app.post('/api/streamers/add', async (req, res) => {
    try {
        const { name, url } = req.body;
        
        if (!name || !url) {
            return res.status(400).json({ success: false, error: 'Nom et URL requis' });
        }

        // Validation URL Twitch
        const twitchPattern = /^https:\/\/(www\.)?twitch\.tv\/[a-zA-Z0-9_]{4,25}$/;
        if (!twitchPattern.test(url.trim())) {
            return res.status(400).json({ 
                success: false, 
                error: 'URL Twitch invalide. Format: https://www.twitch.tv/username' 
            });
        }

        if (!botInstance || !botInstance.db) {
            return res.status(500).json({ success: false, error: 'Bot non disponible' });
        }

        // Vérifier si le streamer existe déjà
        const allStreamers = await botInstance.db.getAllStreamers();
        const existing = allStreamers.find(s => s.name.toLowerCase() === name.toLowerCase());
        
        if (existing) {
            return res.status(400).json({ 
                success: false, 
                error: `Le streamer "${name}" existe déjà` 
            });
        }

        // Insérer selon VOTRE structure de table
        const query = `
            INSERT INTO streamers 
            (name, url, status, description, followers, total_streams, total_hours, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `;
        
        const params = [
            name,
            url,
            'non_affilie', // Status par défaut
            `Streamer ajouté via dashboard le ${new Date().toLocaleDateString()}`,
            0, // followers
            0, // total_streams
            0.0 // total_hours
        ];
        
        await botInstance.db.run(query, params);
        
        addLog('success', `Streamer ${name} ajouté via dashboard`);
        addActivity(`Nouveau streamer ajouté: ${name}`);
        
        res.json({ 
            success: true, 
            message: `Streamer "${name}" ajouté avec succès` 
        });
        
    } catch (error) {
        console.error('Erreur ajout streamer:', error);
        addLog('error', `Erreur ajout streamer: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            error: `Erreur lors de l'ajout: ${error.message}` 
        });
    }
});

// API Supprimer un streamer
app.delete('/api/streamers/:name', async (req, res) => {
    try {
        const { name } = req.params;
        
        if (!botInstance || !botInstance.db) {
            return res.status(500).json({ success: false, error: 'Bot non disponible' });
        }
        
        const allStreamers = await botInstance.db.getAllStreamers();
        const existing = allStreamers.find(s => s.name === name);
        
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Streamer non trouvé' });
        }

        const query = `DELETE FROM streamers WHERE id = ?`;
        await botInstance.db.run(query, [existing.id]);
        
        // Retirer des live si nécessaire
        if (botInstance.liveStreamers && botInstance.liveStreamers.has(name)) {
            botInstance.liveStreamers.delete(name);
        }

        addLog('info', `Streamer ${name} supprimé via dashboard`);
        addActivity(`Streamer supprimé: ${name}`);
        res.json({ success: true, message: `Streamer "${name}" supprimé` });
        
    } catch (error) {
        console.error('Erreur suppression streamer:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Marquer comme affilié
app.post('/api/streamers/:name/affiliate', async (req, res) => {
    try {
        const { name } = req.params;
        
        if (!botInstance || !botInstance.db) {
            return res.status(500).json({ success: false, error: 'Bot non disponible' });
        }
        
        const allStreamers = await botInstance.db.getAllStreamers();
        const existing = allStreamers.find(s => s.name === name);
        
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Streamer non trouvé' });
        }

        const query = `UPDATE streamers SET status = ?, updated_at = datetime('now') WHERE id = ?`;
        await botInstance.db.run(query, ['affilie', existing.id]);
        
        addLog('info', `Streamer ${name} marqué comme affilié`);
        addActivity(`Streamer ${name} marqué comme affilié`);
        res.json({ success: true, message: `${name} marqué comme affilié` });
        
    } catch (error) {
        console.error('Erreur affiliation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Vérification des streams
app.post('/api/check-streams', async (req, res) => {
    try {
        if (botInstance && typeof botInstance.checkStreamersLive === 'function') {
            await botInstance.checkStreamersLive();
            const liveCount = botInstance.liveStreamers ? botInstance.liveStreamers.size : 0;
            
            addActivity(`Vérification manuelle des streams: ${liveCount} en live`);
            res.json({ 
                success: true, 
                message: `Vérification terminée - ${liveCount} streamers en live`,
                liveStreamers: botInstance.liveStreamers ? Array.from(botInstance.liveStreamers.keys()) : []
            });
        } else {
            res.json({ success: false, message: 'Fonction de vérification non disponible' });
        }
    } catch (error) {
        console.error('Erreur vérification streams:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Ping
app.get('/api/ping', (req, res) => {
    const ping = botInstance ? botInstance.ws.ping : 0;
    res.json({
        success: true,
        ping: ping,
        uptime: botInstance ? botInstance.uptime : 0,
        timestamp: Date.now()
    });
});

// API Informations serveur
app.get('/api/server-info', (req, res) => {
    if (!botInstance) {
        return res.status(500).json({ success: false, error: 'Bot non disponible' });
    }

    const guild = botInstance.guilds.cache.get(req.authData.guildId);
    
    res.json({
        success: true,
        server: {
            name: guild?.name || 'Serveur inconnu',
            memberCount: guild?.memberCount || 0,
            channels: guild?.channels.cache.size || 0,
            roles: guild?.roles.cache.size || 0,
            boostLevel: guild?.premiumTier || 0,
            boostCount: guild?.premiumSubscriptionCount || 0
        },
        bot: {
            username: botInstance.user.username,
            discriminator: botInstance.user.discriminator,
            id: botInstance.user.id,
            avatar: botInstance.user.displayAvatarURL(),
            guilds: botInstance.guilds.cache.size,
            users: botInstance.users.cache.size
        }
    });
});

// API Statistiques détaillées
app.get('/api/detailed-stats', async (req, res) => {
    try {
        if (!botInstance || !botInstance.db) {
            return res.status(500).json({ success: false, error: 'Bot non disponible' });
        }

        const streamers = await botInstance.db.getAllStreamers();
        const liveStreamers = botInstance.liveStreamers ? Array.from(botInstance.liveStreamers.keys()) : [];
        const affiliateStreamers = streamers.filter(s => s.status === 'affilie').length;

        res.json({
            success: true,
            stats: {
                bot: {
                    uptime: botInstance.uptime,
                    ping: botInstance.ws.ping,
                    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    guilds: botInstance.guilds.cache.size,
                    users: botInstance.users.cache.size
                },
                streamers: {
                    total: streamers.length,
                    live: liveStreamers.length,
                    affiliates: affiliateStreamers,
                    nonAffiliates: streamers.length - affiliateStreamers,
                    totalHours: streamers.reduce((sum, s) => sum + (s.total_hours || 0), 0),
                    totalFollowers: streamers.reduce((sum, s) => sum + (s.followers || 0), 0)
                },
                system: {
                    platform: process.platform,
                    nodeVersion: process.version,
                    uptime: Math.floor(process.uptime())
                }
            }
        });
    } catch (error) {
        console.error('Erreur stats détaillées:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Test Twitch
app.post('/api/test-twitch', async (req, res) => {
    try {
        if (botInstance && botInstance.twitch && typeof botInstance.twitch.checkStreamStatus === 'function') {
            const testResult = await botInstance.twitch.checkStreamStatus('ninja');
            addActivity('Test API Twitch effectué');
            res.json({ 
                success: true, 
                message: 'API Twitch opérationnelle',
                testResult 
            });
        } else {
            res.json({ 
                success: false, 
                message: 'API Twitch non configurée ou non disponible' 
            });
        }
    } catch (error) {
        addLog('error', `Erreur test Twitch: ${error.message}`);
        res.json({ 
            success: false, 
            message: 'Erreur API Twitch: ' + error.message 
        });
    }
});

// API Logs
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs: systemLogs.slice(-50) });
});

// Route pour activité
app.get('/api/activity', (req, res) => {
    res.json(activityLogs.slice(0, 10));
});

// Gestion d'erreur
app.use((err, req, res, next) => {
    console.error('Erreur dashboard:', err);
    addLog('error', `Erreur dashboard: ${err.message}`);
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Route 404
app.use((req, res) => {
    res.status(404).json({ error: 'Route non trouvée' });
});

// Fonction pour démarrer le dashboard
function startDashboard(bot) {
    botInstance = bot;
    
    app.listen(PORT, () => {
        // Déterminer l'URL publique
        const baseUrl = process.env.RENDER_EXTERNAL_URL || 
                       process.env.PUBLIC_URL || 
                       `https://${process.env.RENDER_SERVICE_NAME || 'localhost'}.onrender.com` ||
                       `http://localhost:${PORT}`;
        
        console.log(`🔥 Dashboard Phoenix disponible sur: ${baseUrl}/dashboard`);
        addLog('success', `Dashboard serveur démarré sur le port ${PORT}`);
        addLog('info', `URL publique: ${baseUrl}/dashboard`);
        addActivity('Dashboard Phoenix démarré');
    });
    
    // Écouter les événements du bot
    if (bot) {
        bot.on('guildMemberAdd', (member) => {
            addActivity(`Nouveau membre: ${member.user.tag} sur ${member.guild.name}`);
        });
    }
}

// Fonction pour obtenir l'URL de base
function getBaseUrl() {
    return process.env.RENDER_EXTERNAL_URL || 
           process.env.PUBLIC_URL || 
           `https://phoenix-1-iy68.onrender.com` ||
           `http://localhost:${PORT}`;
}

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du dashboard...');
    addLog('warning', 'Dashboard arrêté');
    process.exit(0);
});

// Exporter les fonctions
module.exports = {
    startDashboard,
    generateAuthToken,
    addActivity,
    addLog,
    getBaseUrl,
    app
};

// Démarrer si exécuté directement
if (require.main === module) {
    console.log('⚠️ Démarrez le dashboard via votre bot principal');
}
