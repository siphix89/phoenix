// ===================================
// PHOENIX BOT - NAVIGATION SIMPLIFIÉE
// Version 3.0 - Système optimisé
// ===================================

// Fonction de navigation globale
function navigateTo(page) {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    let url = page;
    if (token) {
        const separator = page.includes('?') ? '&' : '?';
        url = `${page}${separator}token=${token}`;
    }
    
    window.location.href = url;
}

// Gestionnaire de navigation
class NavigationManager {
    constructor() {
        this.currentPage = this.getCurrentPage();
        this.init();
    }

    getCurrentPage() {
        const path = window.location.pathname;
        const page = path.split('/').pop() || 'index.html';
        return page.replace('.html', '');
    }

    init() {
        this.setActiveSidebarItem();
        this.setupKeyboardShortcuts();
        this.setupAnimations();
    }

    setActiveSidebarItem() {
        const sidebarItems = document.querySelectorAll('.sidebar-nav-item');
        
        sidebarItems.forEach(item => {
            item.classList.remove('active');
            
            const onclick = item.getAttribute('onclick');
            if (onclick) {
                const match = onclick.match(/navigateTo\('([^']+)'\)/);
                if (match) {
                    const targetPage = match[1].replace('.html', '');
                    if (targetPage === this.currentPage || 
                        (this.currentPage === 'index' && targetPage === 'index')) {
                        item.classList.add('active');
                    }
                }
            }
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Alt + numéro pour navigation rapide
            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                const shortcuts = {
                    '1': 'index.html',
                    '2': 'streamers.html',
                    '3': 'analytics.html',
                    '4': 'admin.html',
                    '5': 'settings.html'
                };

                if (shortcuts[e.key]) {
                    e.preventDefault();
                    navigateTo(shortcuts[e.key]);
                }
            }

            // Échap pour fermer les modals
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
    }

    setupAnimations() {
        // Animation d'entrée de page
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.3s ease';
        
        requestAnimationFrame(() => {
            document.body.style.opacity = '1';
        });

        // Animation des boutons
        document.addEventListener('click', (e) => {
            const button = e.target.closest('.btn, .nav-tab, .sidebar-nav-item');
            if (button && !button.disabled) {
                button.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    button.style.transform = '';
                }, 100);
            }
        });
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }
}

// Utilitaires de navigation
const NavUtils = {
    getCurrentPageName() {
        const pageMap = {
            'index': 'Dashboard Principal',
            'streamers': 'Gestion des Streamers',
            'analytics': 'Analyses et Statistiques',
            'admin': 'Administration',
            'settings': 'Paramètres'
        };
        
        const page = window.location.pathname.split('/').pop().replace('.html', '');
        return pageMap[page] || 'Phoenix Bot Dashboard';
    },

    updatePageTitle(title) {
        document.title = `${title} - Phoenix Bot`;
    },

    showLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(5px);
        `;
        
        overlay.innerHTML = `
            <div style="text-align: center; color: #00ffff;">
                <div style="font-size: 40px; margin-bottom: 20px;">🔥</div>
                <div style="font-size: 18px; font-weight: bold;">Chargement...</div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        setTimeout(() => overlay.remove(), 500);
    },

    hideLoadingOverlay() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.remove();
    }
};

// Export global
window.navigateTo = navigateTo;
window.NavUtils = NavUtils;

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', () => {
    new NavigationManager();
    
    const pageTitle = NavUtils.getCurrentPageName();
    NavUtils.updatePageTitle(pageTitle);
    
    console.log('Navigation Phoenix Bot initialisée');
});

// Sauvegarde de la dernière page visitée
window.addEventListener('beforeunload', () => {
    try {
        localStorage.setItem('phoenix_last_page', window.location.pathname);
    } catch (error) {
        // Ignore les erreurs de stockage
    }
});