const ruleAcceptance = require('./ruleAcceptance');
const streamerspagination = require('./streamers-pagination');
const streamersrefresh = require('./streamers-refresh');

class ButtonManager {
    constructor(client) {
        this.client = client;
        this.handlers = new Map();
       
        // Enregistrer les gestionnaires
        this.registerHandler('accept_rules_', ruleAcceptance);
        //this.registerHandler(['refresh_dashboard', 'bot_settings', 'view_streamers'], serverDashboardHandlers);
        this.registerHandler('streamers_page', streamerspagination);
        this.registerHandler('streamers_refresh', streamersrefresh);
    }
    
    registerHandler(prefix, handler) {
        if (Array.isArray(prefix)) {
            prefix.forEach(p => this.handlers.set(p, handler));
        } else {
            this.handlers.set(prefix, handler);
        }
    }
    
    async handleInteraction(interaction) {
        if (!interaction.isButton()) return false;
        
        // Trouver le bon gestionnaire
        for (const [prefix, handler] of this.handlers) {
            if (interaction.customId === prefix || interaction.customId.startsWith(prefix)) {
                try {
                    return await handler.execute(interaction, this.client);
                } catch (error) {
                    console.error(`Erreur dans le gestionnaire de bouton ${prefix}:`, error);
                   
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '❌ Une erreur s\'est produite.',
                            ephemeral: true
                        });
                    }
                    return true;
                }
            }
        }
        return false; // Aucun gestionnaire trouvé
    }
}

module.exports = ButtonManager;