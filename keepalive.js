const express = require('express');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const app = express();

// Middleware pour parser JSON
app.use(express.json());

// Route d'accueil
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🤖 Discord Streamer Bot - Keep Alive</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                text-align: center; 
                padding: 50px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                margin: 0;
            }
            .container {
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
                display: inline-block;
            }
            h1 { color: #fff; margin-bottom: 20px; }
            .status { 
                background: #4CAF50; 
                padding: 10px 20px; 
                border-radius: 25px; 
                display: inline-block;
                margin: 10px 0;
            }
            .link {
                color: #fff;
                text-decoration: none;
                background: rgba(255,255,255,0.2);
                padding: 10px 20px;
                border-radius: 5px;
                display: inline-block;
                margin: 10px;
            }
            .link:hover { background: rgba(255,255,255,0.3); }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 Discord Streamer Bot</h1>
            <div class="status">✅ Bot en ligne et fonctionnel!</div>
            <p>Ce serveur maintient le bot Discord actif 24h/24.</p>
            <p>Le bot surveille automatiquement les streams Twitch et envoie des notifications.</p>
            
            <div style="margin-top: 30px;">
                <a href="/health" class="link">🏥 Santé du Bot</a>
                <a href="/stats" class="link">📊 Statistiques</a>
            </div>
            
            <p style="margin-top: 30px; font-size: 0.9em; opacity: 0.8;">
                🌐 Interface Web disponible sur le port principal<br>
                🔄 Actualisation automatique toutes les 5 minutes
            </p>
        </div>
        
        <script>
            // Actualiser la page toutes les 5 minutes pour maintenir l'activité
            setTimeout(() => window.location.reload(), 300000);
        </script>
    </body>
    </html>
    `);
});

// Endpoint de santé
app.get('/health', (req, res) => {
    res.json({
        status: "healthy",
        service: "discord-streamer-bot-keepalive",
        message: "Bot Discord Streamer actif"
    });
});

// Statistiques basiques
app.get('/stats', (req, res) => {
    res.json({
        service: "keep-alive",
        status: "running",
        purpose: "Maintenir le bot Discord actif"
    });
});

// Fonction pour démarrer le serveur
function run() {
    try {
        const server = app.listen(8080, '0.0.0.0', () => {
            console.log('✅ Serveur keep-alive démarré avec succès!');
            console.log('🌐 Accessible sur: http://0.0.0.0:8080');
        });

        // Gestion des erreurs du serveur
        server.on('error', (err) => {
            console.error(`❌ Erreur serveur keep-alive: ${err.message}`);
        });

        return server;
    } catch (error) {
        console.error(`❌ Erreur serveur keep-alive: ${error.message}`);
    }
}

// Fonction pour démarrer le keep-alive
function keepAlive() {
    try {
        console.log('🔄 Démarrage du serveur keep-alive sur le port 8080...');
        
        // Démarrer le serveur
        const server = run();
        
        return server;
        
    } catch (error) {
        console.error(`❌ Erreur lors du démarrage du keep-alive: ${error.message}`);
    }
}

// Export des fonctions
module.exports = {
    keepAlive,
    run,
    app
};

// Si ce fichier est exécuté directement
if (require.main === module) {
    console.log('🧪 Test du serveur keep-alive...');
    keepAlive();
    
    // Gérer la fermeture propre du serveur
    process.on('SIGINT', () => {
        console.log('\n🛑 Arrêt du serveur keep-alive...');
        process.exit(0);
    });
}
