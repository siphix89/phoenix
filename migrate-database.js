const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;

/**
 * Script de migration pour synchroniser is_affiliated et status
 * Ce script va :
 * 1. Vérifier si la colonne is_affiliated existe
 * 2. Créer la colonne status si elle n'existe pas
 * 3. Synchroniser les deux colonnes
 */

async function migrateDatabase() {
    console.log('🔧 Début de la migration des bases de données...\n');
    
    const dbDirectory = './database/guilds';
    const masterDbPath = './database/master.db';
    
    try {
        // Ouvrir la base de données master
        const masterDb = await open({
            filename: masterDbPath,
            driver: sqlite3.Database
        });
        
        // Récupérer tous les serveurs
        const guilds = await masterDb.all('SELECT guild_id, guild_name FROM registered_guilds WHERE is_active = 1');
        console.log(`📊 ${guilds.length} serveur(s) à migrer\n`);
        
        for (const guild of guilds) {
            console.log(`\n🔄 Migration pour: ${guild.guild_name} (${guild.guild_id})`);
            
            const dbPath = path.join(dbDirectory, `guild_${guild.guild_id}.db`);
            const db = await open({
                filename: dbPath,
                driver: sqlite3.Database
            });
            
            // 1. Vérifier la structure actuelle
            const columns = await db.all("PRAGMA table_info(streamers)");
            const columnNames = columns.map(col => col.name);
            
            console.log(`   📋 Colonnes actuelles: ${columnNames.join(', ')}`);
            
            const hasIsAffiliated = columnNames.includes('is_affiliated');
            const hasStatus = columnNames.includes('status');
            
            // 2. Ajouter status si elle n'existe pas
            if (!hasStatus) {
                console.log('   ➕ Ajout de la colonne status...');
                await db.exec(`
                    ALTER TABLE streamers 
                    ADD COLUMN status TEXT DEFAULT 'non_affilie' CHECK(status IN ('affilie', 'non_affilie'))
                `);
            }
            
            // 3. Si is_affiliated existe, synchroniser vers status
            if (hasIsAffiliated) {
                console.log('   🔄 Synchronisation is_affiliated → status...');
                
                // Mettre à jour status basé sur is_affiliated
                await db.run(`
                    UPDATE streamers 
                    SET status = CASE 
                        WHEN is_affiliated = 1 THEN 'affilie'
                        ELSE 'non_affilie'
                    END
                `);
                
                const result = await db.get('SELECT COUNT(*) as count FROM streamers WHERE status = "affilie"');
                console.log(`   ✅ ${result.count} streamer(s) affilié(s) synchronisé(s)`);
            } else {
                console.log('   ℹ️  Pas de colonne is_affiliated, status déjà utilisée');
            }
            
            // 4. Vérifier le résultat
            const stats = await db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'affilie' THEN 1 ELSE 0 END) as affiliated,
                    SUM(CASE WHEN status = 'non_affilie' THEN 1 ELSE 0 END) as non_affiliated
                FROM streamers
            `);
            
            console.log(`   📊 Résultat final:`);
            console.log(`      - Total: ${stats.total}`);
            console.log(`      - Affiliés: ${stats.affiliated}`);
            console.log(`      - Non-affiliés: ${stats.non_affiliated}`);
            
            await db.close();
        }
        
        await masterDb.close();
        
        console.log('\n✅ Migration terminée avec succès!');
        console.log('\n💡 Redémarrez maintenant votre bot avec: npm start');
        
    } catch (error) {
        console.error('❌ Erreur durant la migration:', error);
        process.exit(1);
    }
}

// Exécuter la migration
migrateDatabase();