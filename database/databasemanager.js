const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseManager {
  constructor(dbPath = 'streamers.db', logger = console) {
    this.dbPath = path.resolve(dbPath);
    this.logger = logger;
    this.db = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          this.logger.error(`❌ Échec d'ouverture de la base de données: ${err.message}`);
          reject(err);
        } else {
          this.logger.info('✅ Base de données ouverte');
          resolve();
        }
      });
    });
  }

  async initDatabase() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        url TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('affilie', 'non_affilie')),
        description TEXT NOT NULL,
        followers INTEGER DEFAULT 0,
        total_streams INTEGER DEFAULT 0,
        total_hours REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS stream_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_name TEXT NOT NULL,
        started_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP,
        max_viewers INTEGER DEFAULT 0,
        game TEXT,
        title TEXT,
        FOREIGN KEY (streamer_name) REFERENCES streamers(name)
      )`,
      `CREATE TABLE IF NOT EXISTS rules_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_key TEXT UNIQUE NOT NULL,
        section_title TEXT NOT NULL,
        section_content TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )`
    ];

    try {
      for (const query of queries) {
        await this.run(query);
      }
      this.logger.info('✅ Base de données initialisée avec succès');
    } catch (e) {
      this.logger.error(`❌ Échec de l'initialisation de la base de données: ${e.message}`);
      throw e;
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async addStreamer(name, url, status, description) {
    try {
      await this.run(
        `INSERT INTO streamers (name, url, status, description) VALUES (?, ?, ?, ?)`,
        [name, url, status.toLowerCase(), description]
      );
      this.logger.info(`✅ Streamer ${name} ajouté`);
      return true;
    } catch (e) {
      if (e.message.includes('UNIQUE constraint failed')) {
        this.logger.warn(`⚠️ Le streamer ${name} existe déjà`);
        return false;
      }
      this.logger.error(`❌ Erreur lors de l'ajout du streamer ${name}: ${e.message}`);
      return false;
    }
  }

  async getAllStreamers() {
    try {
      const rows = await this.all(`SELECT * FROM streamers ORDER BY name`);
      return rows.map(row => ({
        name: row.name,
        url: row.url,
        status: row.status,
        description: row.description,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        followers: row.followers,
        total_streams: row.total_streams,
        total_hours: row.total_hours
      }));
    } catch (e) {
      this.logger.error(`❌ Erreur lors de la récupération des streamers: ${e.message}`);
      return [];
    }
  }

  async removeStreamer(name) {
    try {
      const result = await this.run(`DELETE FROM streamers WHERE name = ?`, [name]);
      if (result.changes > 0) {
        this.logger.info(`✅ Streamer ${name} supprimé`);
        return true;
      }
      return false;
    } catch (e) {
      this.logger.error(`❌ Erreur lors de la suppression du streamer ${name}: ${e.message}`);
      return false;
    }
  }

  async getStats() {
    try {
      const totalRow = await this.get(`SELECT COUNT(*) AS total FROM streamers`);
      const affiliesRow = await this.get(`SELECT COUNT(*) AS count FROM streamers WHERE status = 'affilie'`);
      const nonAffiliesRow = await this.get(`SELECT COUNT(*) AS count FROM streamers WHERE status = 'non_affilie'`);

      const total = totalRow?.total ?? 0;
      const affilies = affiliesRow?.count ?? 0;
      const nonAffilies = nonAffiliesRow?.count ?? 0;

      return {
        total_streamers: total,
        affilies,
        non_affilies: nonAffilies,
        affiliation_rate: total > 0 ? Math.round((affilies / total) * 1000) / 10 : 0
      };
    } catch (e) {
      this.logger.error(`❌ Erreur lors de la récupération des stats: ${e.message}`);
      return {
        total_streamers: 0,
        affilies: 0,
        non_affilies: 0,
        affiliation_rate: 0
      };
    }
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            this.logger.error(`❌ Erreur lors de la fermeture de la base de données: ${err.message}`);
          } else {
            this.logger.info('✅ Base de données fermée');
          }
          resolve();
        });
      });
    }
  }
}

module.exports = DatabaseManager;