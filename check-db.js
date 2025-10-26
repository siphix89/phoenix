// Créez ce fichier : check-db.js
// Pour vérifier votre base de données

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkDatabase() {
    const dbPath = path.join(__dirname, 'streamers.db');
    console.log('📂 Vérification de la base de données:', dbPath);
    
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Erreur ouverture DB:', err.message);
                reject(err);
                return;
            }
            console.log('✅ Base de données ouverte avec succès');
        });

        // Vérifier la structure de la table
        db.all("SELECT name FROM sqlite_master WHERE type='table';", (err, tables) => {
            if (err) {
                console.error('❌ Erreur lecture tables:', err);
                db.close();
                reject(err);
                return;
            }
            
            console.log('📋 Tables disponibles:', tables.map(t => t.name));
            
            // Vérifier la structure de la table streamers
            db.all("PRAGMA table_info(streamers);", (err, columns) => {
                if (err) {
                    console.error('❌ Erreur lecture colonnes:', err);
                    db.close();
                    reject(err);
                    return;
                }
                
                console.log('🏗️ Structure table streamers:');
                columns.forEach(col => {
                    console.log(`  - ${col.name}: ${col.type} ${col.pk ? '(PRIMARY KEY)' : ''} ${col.notnull ? '(NOT NULL)' : ''}`);
                });
                
                // Lire quelques exemples
                db.all("SELECT * FROM streamers LIMIT 5;", (err, rows) => {
                    if (err) {
                        console.error('❌ Erreur lecture données:', err);
                    } else {
                        console.log('📊 Exemples de données:');
                        rows.forEach((row, index) => {
                            console.log(`  ${index + 1}.`, row);
                        });
                    }
                    
                    db.close((err) => {
                        if (err) {
                            console.error('❌ Erreur fermeture DB:', err.message);
                        } else {
                            console.log('✅ Base de données fermée');
                        }
                        resolve();
                    });
                });
            });
        });
    });
}

// Fonction pour tester un ajout
async function testAddStreamer() {
    const dbPath = path.join(__dirname, 'streamers.db');
    
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        
        const testName = 'teststreamer_' + Date.now();
        const testUrl = 'https://www.twitch.tv/' + testName;
        const testGuildId = '123456789'; // ID de test
        
        console.log('🧪 Test d\'ajout:', { testName, testUrl });
        
        const query = `INSERT INTO streamers (name, url, guild_id, added_at) VALUES (?, ?, ?, datetime('now'))`;
        
        db.run(query, [testName, testUrl, testGuildId], function(err) {
            if (err) {
                console.error('❌ Erreur ajout test:', err.message);
                reject(err);
            } else {
                console.log('✅ Test ajout réussi, ID:', this.lastID);
                
                // Vérifier que l'ajout a fonctionné
                db.get("SELECT * FROM streamers WHERE name = ?", [testName], (err, row) => {
                    if (err) {
                        console.error('❌ Erreur vérification:', err.message);
                    } else if (row) {
                        console.log('✅ Streamer ajouté trouvé:', row);
                        
                        // Nettoyer le test
                        db.run("DELETE FROM streamers WHERE name = ?", [testName], (err) => {
                            if (err) {
                                console.error('❌ Erreur nettoyage:', err.message);
                            } else {
                                console.log('🧹 Test nettoyé');
                            }
                        });
                    } else {
                        console.log('⚠️ Streamer ajouté mais non trouvé');
                    }
                    
                    db.close();
                    resolve();
                });
            }
        });
    });
}

// Exécuter les vérifications
async function main() {
    try {
        await checkDatabase();
        console.log('\n' + '='.repeat(50) + '\n');
        await testAddStreamer();
    } catch (error) {
        console.error('💥 Erreur générale:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { checkDatabase, testAddStreamer };