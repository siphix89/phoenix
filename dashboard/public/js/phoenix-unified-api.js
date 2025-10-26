// ===============================================
// PHOENIX BOT - CLIENT API UNIFIÉ
// Version 3.0 - Système consolidé et optimisé
// ===============================================

class PhoenixUnifiedAPI {
    constructor() {
        this.baseURL = '';
        this.token = '';
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.autoRefreshInterval = null;
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 secondes
        
        // État des données
        this.state = {
            stats: null,
            streamers: [],
            lastUpdate: null
        };
        
        // Callbacks pour les mises à jour
        this.updateCallbacks = [];
    }

    // ==========================================
    // INITIALISATION ET CONNEXION
    // ==========================================

    async init() {
        this.log('Initialisation Phoenix Bot API Client', 'info');
        
        // Récupérer le token depuis l'URL
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        
        if (urlToken) {
            this.baseURL = window.location.origin;
            this.token = urlToken;
            this.saveConfig();
            await this.connect();
        } else {
            // Charger config sauvegardée
            const saved = this.loadConfig();
            if (saved.url && saved.token) {
                this.baseURL = saved.url;
                this.token = saved.token;
                await this.connect();
            } else {
                this.showConfigRequired();
            }
        }
    }

    async connect() {
        if (!this.baseURL || !this.token) {
            this.log('Configuration incomplète', 'warning');
            return false;
        }

        this.log('Connexion à l\'API...', 'info');
        this.updateConnectionUI('connecting');

        try {
            const response = await this.request('/api/ping');
            
            if (response.success) {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.log(`Connexion réussie! Ping: ${response.ping}ms`, 'success');
                this.updateConnectionUI('connected');
                
                // Charger les données initiales
                await this.loadAllData();
                
                // Démarrer l'auto-refresh
                this.startAutoRefresh();
                
                return true;
            }
        } catch (error) {
            this.handleConnectionError(error);
            return false;
        }
    }

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.log('Nombre maximum de tentatives de reconnexion atteint', 'error');
            this.updateConnectionUI('error', 'Reconnexion impossible');
            return false;
        }

        this.reconnectAttempts++;
        this.log(`Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'info');
        
        await new Promise(resolve => setTimeout(resolve, 2000 * this.reconnectAttempts));
        return await this.connect();
    }

    // ==========================================
    // REQUÊTES HTTP
    // ==========================================

    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
        
        const config = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/json'
            },
            ...options
        };

        // Timeout de 10 secondes
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                ...config,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 401) {
                    this.handleTokenExpired();
                    throw new Error('Token expiré');
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data;
            
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Timeout - Serveur non accessible');
            }
            throw error;
        }
    }

    // ==========================================
    // CHARGEMENT DES DONNÉES
    // ==========================================

    async loadAllData() {
        this.log('Chargement des données...', 'info');
        
        try {
            // Charger en parallèle
            const [stats, streamers] = await Promise.all([
                this.loadStats(),
                this.loadStreamers()
            ]);

            this.state.stats = stats;
            this.state.streamers = streamers;
            this.state.lastUpdate = new Date();

            // Notifier les callbacks
            this.notifyUpdate();

            this.log('Données chargées avec succès', 'success');
            return { stats, streamers };
            
        } catch (error) {
            this.log(`Erreur chargement: ${error.message}`, 'error');
            throw error;
        }
    }

    async loadStats() {
        const cached = this.getCache('stats');
        if (cached) return cached;

        const data = await this.request('/api/stats');
        if (data.success) {
            this.setCache('stats', data);
            this.updateStatsUI(data);
            return data;
        }
        throw new Error('Erreur chargement stats');
    }

    async loadStreamers() {
        const cached = this.getCache('streamers');
        if (cached) return cached;

        const data = await this.request('/api/streamers');
        if (data.success) {
            this.setCache('streamers', data.streamers);
            return data.streamers;
        }
        throw new Error('Erreur chargement streamers');
    }

    // ==========================================
    // ACTIONS STREAMERS
    // ==========================================

    async addStreamer(name, url) {
        if (!name || !url) {
            throw new Error('Nom et URL requis');
        }

        const data = await this.request('/api/streamers/add', {
            method: 'POST',
            body: JSON.stringify({ name, url })
        });

        if (data.success) {
            this.log(`Streamer "${name}" ajouté`, 'success');
            this.clearCache('streamers');
            await this.loadStreamers();
            return data;
        }
        
        throw new Error(data.error || 'Erreur ajout streamer');
    }

    async removeStreamer(name) {
        const data = await this.request(`/api/streamers/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });

        if (data.success) {
            this.log(`Streamer "${name}" supprimé`, 'success');
            this.clearCache('streamers');
            await this.loadStreamers();
            return data;
        }
        
        throw new Error(data.error || 'Erreur suppression streamer');
    }

    async checkStreams() {
        this.log('Vérification des streams...', 'info');
        
        const data = await this.request('/api/check-streams', {
            method: 'POST'
        });

        if (data.success) {
            this.log(data.message, 'success');
            this.clearCache(['stats', 'streamers']);
            
            // Recharger après 2 secondes
            setTimeout(() => this.loadAllData(), 2000);
            
            return data;
        }
        
        throw new Error('Erreur vérification streams');
    }

    async testTwitchAPI() {
        this.log('Test API Twitch...', 'info');
        
        const data = await this.request('/api/test-twitch', {
            method: 'POST'
        });

        if (data.success) {
            this.log(data.message, 'success');
            return data;
        }
        
        throw new Error(data.error || 'Erreur test Twitch');
    }

    // ==========================================
    // GESTION DU CACHE
    // ==========================================

    getCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > this.cacheTimeout) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    clearCache(keys) {
        if (Array.isArray(keys)) {
            keys.forEach(key => this.cache.delete(key));
        } else if (keys) {
            this.cache.delete(keys);
        } else {
            this.cache.clear();
        }
    }

    // ==========================================
    // CONFIGURATION
    // ==========================================

    loadConfig() {
        try {
            return {
                url: localStorage.getItem('phoenix_api_url') || '',
                token: localStorage.getItem('phoenix_api_token') || ''
            };
        } catch (error) {
            return { url: '', token: '' };
        }
    }

    saveConfig() {
        try {
            localStorage.setItem('phoenix_api_url', this.baseURL);
            localStorage.setItem('phoenix_api_token', this.token);
        } catch (error) {
            this.log('Erreur sauvegarde config', 'warning');
        }
    }

    updateConfig(url, token) {
        this.baseURL = url.replace(/\/$/, '');
        this.token = token;
        this.saveConfig();
        return this.connect();
    }

    // ==========================================
    // AUTO-REFRESH
    // ==========================================

    startAutoRefresh(interval = 30000) {
        this.stopAutoRefresh();
        
        this.autoRefreshInterval = setInterval(async () => {
            if (this.isConnected && !document.hidden) {
                try {
                    await this.loadAllData();
                } catch (error) {
                    this.log('Erreur auto-refresh', 'warning');
                }
            }
        }, interval);
        
        // Refresh quand la page redevient visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isConnected) {
                this.loadAllData();
            }
        });
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    // ==========================================
    // CALLBACKS ET ÉVÉNEMENTS
    // ==========================================

    onUpdate(callback) {
        this.updateCallbacks.push(callback);
    }

    notifyUpdate() {
        this.updateCallbacks.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
                console.error('Erreur callback:', error);
            }
        });
    }

    // ==========================================
    // INTERFACE UTILISATEUR
    // ==========================================

    updateConnectionUI(status, message = '') {
        const statusMap = {
            'connecting': { icon: '🔄', text: 'Connexion...', color: '#ffaa00' },
            'connected': { icon: '✅', text: 'Connecté', color: '#00ff00' },
            'error': { icon: '❌', text: message || 'Erreur', color: '#ff0000' },
            'disconnected': { icon: '⚠️', text: 'Déconnecté', color: '#ff0000' }
        };

        const config = statusMap[status] || statusMap.disconnected;

        // Mettre à jour les indicateurs de statut
        document.querySelectorAll('.status-indicator').forEach(el => {
            if (el.id === 'api-status') {
                el.className = `status-indicator ${status === 'connected' ? 'online' : ''}`;
                el.innerHTML = `<span>${config.icon}</span><span>${config.text}</span>`;
            }
        });
    }

    updateStatsUI(data) {
        const updates = {
            'servers': data.servers,
            'users': this.formatNumber(data.users),
            'streamers': `${data.liveStreamers}/${data.streamers}`,
            'uptime': this.formatUptime(data.uptime)
        };

        Object.entries(updates).forEach(([key, value]) => {
            document.querySelectorAll(`[data-stat="${key}"]`).forEach(el => {
                el.textContent = value;
                el.classList.add('updated');
                setTimeout(() => el.classList.remove('updated'), 500);
            });
        });

        // Mettre à jour l'heure
        const lastUpdate = document.getElementById('last-update');
        if (lastUpdate) {
            lastUpdate.textContent = new Date().toLocaleTimeString();
        }
    }

    // ==========================================
    // GESTION DES ERREURS
    // ==========================================

    handleConnectionError(error) {
        this.isConnected = false;
        this.log(`Erreur connexion: ${error.message}`, 'error');
        
        if (error.message.includes('Token')) {
            this.updateConnectionUI('error', 'Token invalide');
            this.showTokenError();
        } else {
            this.updateConnectionUI('error', 'Connexion échouée');
            this.reconnect();
        }
    }

    handleTokenExpired() {
        this.isConnected = false;
        this.log('Token expiré', 'error');
        this.showTokenError();
    }

    showTokenError() {
        this.showNotification(
            'Token expiré ou invalide. Utilisez /dash type:web sur Discord pour générer un nouveau lien.',
            'error',
            0
        );
    }

    showConfigRequired() {
        this.log('Configuration requise', 'warning');
        this.showNotification(
            'Utilisez /dash type:web sur Discord pour obtenir un lien d\'accès',
            'warning',
            0
        );
    }

    // ==========================================
    // UTILITAIRES
    // ==========================================

    formatNumber(num) {
        if (typeof num !== 'number') return num;
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    formatUptime(ms) {
        if (typeof ms !== 'number') return 'N/A';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}j ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[${timestamp}] [Phoenix API]`;
        
        const colors = {
            'info': '#00ffff',
            'success': '#00ff00',
            'warning': '#ffaa00',
            'error': '#ff0000'
        };

        console.log(`${prefix} ${message}`);

        // Log dans l'interface si disponible
        const output = document.getElementById('connection-output');
        if (output) {
            output.textContent += `${prefix} ${message}\n`;
            output.style.color = colors[type] || colors.info;
            output.scrollTop = output.scrollHeight;
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        const icons = {
            'info': 'ℹ️',
            'success': '✅',
            'warning': '⚠️',
            'error': '❌'
        };

        const colors = {
            'info': '#00ffff',
            'success': '#00ff00',
            'warning': '#ffaa00',
            'error': '#ff0000'
        };

        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid ${colors[type]};
            border-radius: 10px;
            padding: 15px 20px;
            color: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            animation: slideIn 0.3s ease-out;
            max-width: 400px;
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">${icons[type]}</span>
                <span style="flex: 1;">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="
                    background: none;
                    border: none;
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 0 5px;
                ">×</button>
            </div>
        `;

        document.body.appendChild(notification);

        if (duration > 0) {
            setTimeout(() => notification.remove(), duration);
        }

        return notification;
    }

    // ==========================================
    // NETTOYAGE
    // ==========================================

    destroy() {
        this.stopAutoRefresh();
        this.cache.clear();
        this.updateCallbacks = [];
        this.isConnected = false;
    }
}

// ==========================================
// EXPORT ET INITIALISATION GLOBALE
// ==========================================

// Rendre disponible globalement
window.PhoenixAPI = PhoenixUnifiedAPI;

// Auto-initialisation
let phoenixAPI = null;

document.addEventListener('DOMContentLoaded', async () => {
    phoenixAPI = new PhoenixUnifiedAPI();
    await phoenixAPI.init();
    
    // Export global
    window.phoenixAPI = phoenixAPI;
    
    console.log('Phoenix API Client initialisé');
});

// Style pour les animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    .updated {
        animation: highlight 0.5s ease-in-out;
    }
    
    @keyframes highlight {
        0% { background-color: rgba(0, 255, 255, 0.3); }
        100% { background-color: transparent; }
    }
`;
document.head.appendChild(style);