const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;

class DatabaseManager {
    constructor(dbDirectory = './database/guilds') {
        this.dbDirectory = dbDirectory;
        this.connections = new Map();
        this.masterDbPath = './database/master.db';
        this.masterDb = null;
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js
    async addGuild(guildId, guildName, channelId) {
        const db = await this.getGuildDatabase(guildId, guildName);
        
        if (channelId) {
            await this.setNotificationChannel(guildId, channelId);
        }
        
        return { success: true };
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js
    async getGuild(guildId) {
        try {
            const db = await this.getGuildDatabase(guildId);
            const config = await db.get('SELECT * FROM guild_config WHERE id = 1');
            
            return {
                id: guildId,
                notification_channel_id: config?.notification_channel_id || null,
                prefix: config?.prefix || '!',
                ...config
            };
        } catch (error) {
            return null;
        }
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js
    async addStreamerToGuild(guildId, twitchUsername, addedBy, customMessage = null) {
        return await this.addStreamer(guildId, twitchUsername, twitchUsername, addedBy, customMessage);
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js
    async removeStreamerFromGuild(guildId, twitchUsername) {
        return await this.removeStreamer(guildId, twitchUsername);
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js (avec cache)
    async getAllStreamers() {
        const allGuilds = await this.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
        const streamersMap = new Map();
        
        for (const { guild_id } of allGuilds) {
            try {
                const guildStreamers = await this.getGuildStreamers(guild_id);
                for (const streamer of guildStreamers) {
                    if (!streamersMap.has(streamer.twitch_username)) {
                        streamersMap.set(streamer.twitch_username, {
                            id: streamer.id,
                            twitch_username: streamer.twitch_username,
                            display_name: streamer.display_name,
                            status: streamer.status,
                            is_active: true
                        });
                    }
                }
            } catch (error) {
                continue;
            }
        }
        
        return Array.from(streamersMap.values());
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js
    async getActiveStreams(guildId = null) {
        // Si guildId spécifié, retourner seulement pour ce serveur
        if (guildId) {
            try {
                const db = await this.getGuildDatabase(guildId);
                return await db.all(`
                    SELECT s.twitch_username, s.display_name, s.status, ast.*
                    FROM active_streams ast
                    JOIN streamers s ON ast.streamer_id = s.id
                `);
            } catch (error) {
                console.error(`Erreur getActiveStreams pour guild ${guildId}:`, error);
                return [];
            }
        }

        // Sinon, tous les serveurs
        const allGuilds = await this.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
        const activeStreamsMap = new Map();
        
        for (const { guild_id } of allGuilds) {
            try {
                const db = await this.getGuildDatabase(guild_id);
                const streams = await db.all(`
                    SELECT s.twitch_username, s.display_name, s.status, ast.*
                    FROM active_streams ast
                    JOIN streamers s ON ast.streamer_id = s.id
                `);
                
                for (const stream of streams) {
                    if (!activeStreamsMap.has(stream.twitch_username)) {
                        activeStreamsMap.set(stream.twitch_username, stream);
                    }
                }
            } catch (error) {
                continue;
            }
        }
        
        return Array.from(activeStreamsMap.values());
    }

    // ✅ MÉTHODE DE COMPATIBILITÉ POUR bot.js
    async updateNotifiedGuilds(twitchUsername, guildIds) {
        return { success: true };
    }

    // ✅ MÉTHODE POUR OBTENIR LES STATS GLOBALES
    async getStats() {
        const allGuilds = await this.masterDb.all('SELECT COUNT(*) as count FROM registered_guilds WHERE is_active = 1');
        const allStreamers = await this.getAllStreamers();
        const activeStreams = await this.getActiveStreams();
        
        let totalFollows = 0;
        let affiliatedCount = 0;
        const guilds = await this.masterDb.all('SELECT guild_id FROM registered_guilds WHERE is_active = 1');
        
        for (const { guild_id } of guilds) {
            try {
                const db = await this.getGuildDatabase(guild_id);
                const count = await db.get('SELECT COUNT(*) as count FROM streamers');
                const affiliated = await db.get('SELECT COUNT(*) as count FROM streamers WHERE status = "affilie"');
                totalFollows += count.count || 0;
                affiliatedCount += affiliated.count || 0;
            } catch (error) {
                continue;
            }
        }
        
        return {
            guilds: allGuilds[0].count,
            streamers: allStreamers.length,
            activeStreams: activeStreams.length,
            totalFollows,
            affiliatedStreamers: affiliatedCount
        };
    }

    async init() {
        await fs.mkdir(this.dbDirectory, { recursive: true });
        await this.initMasterDatabase();
    }

    async getGuildDatabaseConnection(guildId, guildName = null) {
        return await this.getGuildDatabase(guildId, guildName);
    }

    async initMasterDatabase() {
        this.masterDb = await open({
            filename: this.masterDbPath,
            driver: sqlite3.Database
        });

        await this.masterDb.exec(`
            CREATE TABLE IF NOT EXISTS registered_guilds (
                guild_id TEXT PRIMARY KEY,
                guild_name TEXT,
                db_path TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        `);
    }

    async getGuildDatabase(guildId, guildName = null) {
        if (this.connections.has(guildId)) {
            return this.connections.get(guildId);
        }

        const dbPath = path.join(this.dbDirectory, `guild_${guildId}.db`);
        
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        await this.createGuildTables(db);
        await this.registerGuild(guildId, guildName, dbPath);
        this.connections.set(guildId, db);

        return db;
    }

    async createGuildTables(db) {
        // Configuration du serveur
        await db.exec(`
            CREATE TABLE IF NOT EXISTS guild_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                notification_channel_id TEXT,
                live_affilie_channel_id TEXT,
                live_non_affilie_channel_id TEXT,
                prefix TEXT DEFAULT '!',
                language TEXT DEFAULT 'fr',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.run(`
            INSERT OR IGNORE INTO guild_config (id) VALUES (1)
        `);

        // Migration: Ajouter les nouvelles colonnes si elles n'existent pas
        try {
            const columns = await db.all("PRAGMA table_info(guild_config)");
            
            if (!columns.some(col => col.name === 'live_affilie_channel_id')) {
                console.log('Migration: Ajout de live_affilie_channel_id...');
                await db.exec(`ALTER TABLE guild_config ADD COLUMN live_affilie_channel_id TEXT`);
            }
            
            if (!columns.some(col => col.name === 'live_non_affilie_channel_id')) {
                console.log('Migration: Ajout de live_non_affilie_channel_id...');
                await db.exec(`ALTER TABLE guild_config ADD COLUMN live_non_affilie_channel_id TEXT`);
            }
        } catch (error) {
            console.warn('Migration channels:', error.message);
        }

        // Table streamers avec colonne status
        await db.exec(`
            CREATE TABLE IF NOT EXISTS streamers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                twitch_username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                custom_message TEXT,
                notification_enabled BOOLEAN DEFAULT 1,
                status TEXT DEFAULT 'non_affilie' CHECK(status IN ('affilie', 'non_affilie')),
                added_by TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Vérifier si la colonne status existe déjà, sinon l'ajouter (migration)
        try {
            const columns = await db.all("PRAGMA table_info(streamers)");
            const hasStatus = columns.some(col => col.name === 'status');
            
            if (!hasStatus) {
                console.log('Migration: Ajout de la colonne status...');
                await db.exec(`
                    ALTER TABLE streamers 
                    ADD COLUMN status TEXT DEFAULT 'non_affilie' CHECK(status IN ('affilie', 'non_affilie'))
                `);
            }
        } catch (error) {
            console.warn('Migration status:', error.message);
        }

        // Historique des streams
        await db.exec(`
            CREATE TABLE IF NOT EXISTS stream_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                streamer_id INTEGER,
                stream_id TEXT,
                title TEXT,
                game_name TEXT,
                viewer_count INTEGER,
                started_at DATETIME,
                ended_at DATETIME,
                duration_minutes INTEGER,
                FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE
            )
        `);

        // Streams actifs
        await db.exec(`
            CREATE TABLE IF NOT EXISTS active_streams (
                streamer_id INTEGER PRIMARY KEY,
                stream_id TEXT,
                title TEXT,
                game_name TEXT,
                viewer_count INTEGER,
                started_at DATETIME,
                notification_sent BOOLEAN DEFAULT 0,
                FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_streamers_username ON streamers(twitch_username);
            CREATE INDEX IF NOT EXISTS idx_streamers_status ON streamers(status);
            CREATE INDEX IF NOT EXISTS idx_stream_history_streamer ON stream_history(streamer_id);
        `);
    }

    async registerGuild(guildId, guildName, dbPath) {
        await this.masterDb.run(`
            INSERT OR REPLACE INTO registered_guilds (guild_id, guild_name, db_path, last_accessed)
            VALUES (?, ?, ?, datetime('now'))
        `, [guildId, guildName, dbPath]);
    }

    // === MÉTHODES POUR GÉRER LES STREAMERS ===
    async addStreamer(guildId, twitchUsername, displayName, addedBy, customMessage = null, status = 'non_affilie') {
        const db = await this.getGuildDatabase(guildId);
        
        try {
            const result = await db.run(`
                INSERT INTO streamers (twitch_username, display_name, custom_message, added_by, status)
                VALUES (?, ?, ?, ?, ?)
            `, [twitchUsername.toLowerCase(), displayName, customMessage, addedBy, status]);
            
            return { success: true, streamerId: result.lastID };
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Ce streamer est déjà suivi' };
            }
            throw error;
        }
    }

    async removeStreamer(guildId, twitchUsername) {
        const db = await this.getGuildDatabase(guildId);
        
        const result = await db.run(`
            DELETE FROM streamers WHERE twitch_username = ?
        `, [twitchUsername.toLowerCase()]);

        return { success: result.changes > 0 };
    }

    async getGuildStreamers(guildId) {
        const db = await this.getGuildDatabase(guildId);
        
        return await db.all(`
            SELECT * FROM streamers 
            WHERE notification_enabled = 1
            ORDER BY status DESC, twitch_username
        `);
    }

    async getStreamer(guildId, twitchUsername) {
        const db = await this.getGuildDatabase(guildId);
        
        return await db.get(`
            SELECT * FROM streamers WHERE twitch_username = ?
        `, [twitchUsername.toLowerCase()]);
    }

    // 🆕 NOUVELLE MÉTHODE: Changer le statut d'un streamer
    async updateStreamerStatus(guildId, twitchUsername, status) {
        if (!['affilie', 'non_affilie'].includes(status)) {
            return { success: false, error: 'Statut invalide. Utilisez "affilie" ou "non_affilie"' };
        }

        const db = await this.getGuildDatabase(guildId);
        
        const result = await db.run(`
            UPDATE streamers 
            SET status = ?
            WHERE twitch_username = ?
        `, [status, twitchUsername.toLowerCase()]);

        return { 
            success: result.changes > 0,
            error: result.changes === 0 ? 'Streamer non trouvé' : null
        };
    }

    // 🆕 NOUVELLE MÉTHODE: Obtenir les streamers par statut
    async getStreamersByStatus(guildId, status) {
        const db = await this.getGuildDatabase(guildId);
        
        return await db.all(`
            SELECT * FROM streamers 
            WHERE status = ? AND notification_enabled = 1
            ORDER BY twitch_username
        `, [status]);
    }

    // === GESTION DES STREAMS ACTIFS ===
    async setStreamActive(guildId, twitchUsername, streamData) {
        const db = await this.getGuildDatabase(guildId);
        const streamer = await this.getStreamer(guildId, twitchUsername);
        
        if (!streamer) return { success: false, error: 'Streamer non trouvé' };

        await db.run(`
            INSERT OR REPLACE INTO active_streams 
            (streamer_id, stream_id, title, game_name, viewer_count, started_at, notification_sent)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [
            streamer.id,
            streamData.id,
            streamData.title,
            streamData.game_name,
            streamData.viewer_count,
            streamData.started_at
        ]);

        return { success: true };
    }

    async setStreamInactive(guildId, twitchUsername) {
        const db = await this.getGuildDatabase(guildId);
        const streamer = await this.getStreamer(guildId, twitchUsername);
        
        if (!streamer) return { success: false };

        const activeStream = await db.get(`
            SELECT * FROM active_streams WHERE streamer_id = ?
        `, [streamer.id]);

        if (activeStream) {
            const duration = Math.floor(
                (new Date() - new Date(activeStream.started_at)) / 60000
            );

            await db.run(`
                INSERT INTO stream_history 
                (streamer_id, stream_id, title, game_name, viewer_count, started_at, ended_at, duration_minutes)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
            `, [
                streamer.id,
                activeStream.stream_id,
                activeStream.title,
                activeStream.game_name,
                activeStream.viewer_count,
                activeStream.started_at,
                duration
            ]);
        }

        await db.run(`
            DELETE FROM active_streams WHERE streamer_id = ?
        `, [streamer.id]);

        return { success: true };
    }

    async markNotificationSent(guildId, twitchUsername) {
        const db = await this.getGuildDatabase(guildId);
        const streamer = await this.getStreamer(guildId, twitchUsername);
        
        if (!streamer) return { success: false };

        await db.run(`
            UPDATE active_streams 
            SET notification_sent = 1
            WHERE streamer_id = ?
        `, [streamer.id]);

        return { success: true };
    }

    // === CONFIGURATION DU SERVEUR ===
    async setNotificationChannel(guildId, channelId) {
        const db = await this.getGuildDatabase(guildId);
        
        await db.run(`
            UPDATE guild_config SET notification_channel_id = ?, updated_at = datetime('now')
            WHERE id = 1
        `, [channelId]);

        return { success: true };
    }

    async getGuildConfig(guildId) {
        const db = await this.getGuildDatabase(guildId);
        
        return await db.get(`SELECT * FROM guild_config WHERE id = 1`);
    }

    // 🆕 NOUVELLE MÉTHODE: Configurer les channels séparés
    async setLiveChannels(guildId, affilieChannelId, nonAffilieChannelId) {
        const db = await this.getGuildDatabase(guildId);
        
        await db.run(`
            UPDATE guild_config 
            SET live_affilie_channel_id = ?, 
                live_non_affilie_channel_id = ?,
                updated_at = datetime('now')
            WHERE id = 1
        `, [affilieChannelId, nonAffilieChannelId]);

        return { success: true };
    }

    // 🆕 NOUVELLE MÉTHODE: Configurer un seul type de channel
    async setLiveChannel(guildId, channelType, channelId) {
        const db = await this.getGuildDatabase(guildId);
        
        const column = channelType === 'affilie' 
            ? 'live_affilie_channel_id' 
            : 'live_non_affilie_channel_id';
        
        await db.run(`
            UPDATE guild_config 
            SET ${column} = ?,
                updated_at = datetime('now')
            WHERE id = 1
        `, [channelId]);

        return { success: true };
    }

    // === STATISTIQUES ===
    async getGuildStats(guildId) {
        const db = await this.getGuildDatabase(guildId);
        
        const streamersCount = await db.get('SELECT COUNT(*) as count FROM streamers');
        const activeStreamsCount = await db.get('SELECT COUNT(*) as count FROM active_streams');
        const totalStreams = await db.get('SELECT COUNT(*) as count FROM stream_history');
        const affiliatedCount = await db.get('SELECT COUNT(*) as count FROM streamers WHERE status = "affilie"');

        return {
            streamers: streamersCount.count,
            activeStreams: activeStreamsCount.count,
            totalStreams: totalStreams.count,
            affiliatedStreamers: affiliatedCount.count
        };
    }

    async getGlobalStats() {
        const guilds = await this.masterDb.all(`
            SELECT COUNT(*) as total, 
                   SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
            FROM registered_guilds
        `);

        return {
            totalGuilds: guilds[0].total,
            activeGuilds: guilds[0].active,
            cachedConnections: this.connections.size
        };
    }

    // === MAINTENANCE ===
    async closeGuildConnection(guildId) {
        if (this.connections.has(guildId)) {
            const db = this.connections.get(guildId);
            await db.close();
            this.connections.delete(guildId);
        }
    }

    async closeAll() {
        for (const [guildId, db] of this.connections) {
            await db.close();
        }
        this.connections.clear();

        if (this.masterDb) {
            await this.masterDb.close();
        }
    }

    async cleanupInactiveConnections(maxIdleMinutes = 30) {
        console.log('Cleanup: implement idle connection tracking if needed');
    }
}

module.exports = DatabaseManager;