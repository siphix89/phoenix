// ===========================================
// COMMANDE /dash CORRIGÉE POUR RAILWAY
// ===========================================

const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dash')
        .setDescription('Accéder au dashboard Phoenix Bot')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Type de dashboard à générer')
                .setRequired(true)
                .addChoices(
                    { name: '🌐 Dashboard Web', value: 'web' },
                    { name: '📱 Dashboard Mobile', value: 'mobile' },
                    { name: '🔑 Nouveau Token', value: 'refresh' }
                )
        ),

    async execute(interaction, bot) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const type = interaction.options.getString('type');
            const user = interaction.user;
            const guild = interaction.guild;

            // Vérifier les permissions
            if (!bot.isAdmin(interaction.member) && !bot.isModerator(interaction.member)) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Accès refusé')
                    .setDescription('Vous devez être **administrateur** ou **modérateur** pour accéder au dashboard.')
                    .setColor(Colors.Red)
                    .addFields({
                        name: '🔑 Permissions requises',
                        value: '• Administrateur du serveur\n• Rôle Modérateur\n• Permission "Gérer les messages"',
                        inline: false
                    })
                    .setFooter({ text: 'Phoenix Bot Dashboard' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Vérifier que le dashboard est disponible
            if (!bot.dashboardAPI) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Dashboard indisponible')
                    .setDescription('Le dashboard n\'est pas actuellement disponible.')
                    .setColor(Colors.Red)
                    .setFooter({ text: 'Contactez un administrateur' });

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Générer le token directement (pas de fetch)
            const tokenResponse = generateTokenDirectly(user, guild, bot.dashboardAPI);

            if (!tokenResponse.success) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Erreur de génération')
                    .setDescription('Impossible de générer le token d\'accès.')
                    .setColor(Colors.Red)
                    .addFields({
                        name: '🔧 Détails de l\'erreur',
                        value: tokenResponse.error || 'Erreur inconnue',
                        inline: false
                    });

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Créer l'embed selon le type
            let embed;
            switch (type) {
                case 'web':
                    embed = createWebDashboardEmbed(tokenResponse, user, guild);
                    break;
                case 'mobile':
                    embed = createMobileDashboardEmbed(tokenResponse, user, guild);
                    break;
                case 'refresh':
                    embed = createRefreshTokenEmbed(tokenResponse, user, guild);
                    break;
                default:
                    embed = createWebDashboardEmbed(tokenResponse, user, guild);
            }

            await interaction.editReply({ embeds: [embed] });

            console.log(`🔑 Token dashboard généré: ${user.tag} (${user.id}) sur ${guild.name}`);

        } catch (error) {
            console.error('❌ Erreur commande /dash:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Erreur système')
                .setDescription('Une erreur interne s\'est produite.')
                .setColor(Colors.Red)
                .addFields({
                    name: 'Détails',
                    value: error.message || 'Erreur inconnue'
                })
                .setFooter({ text: 'Veuillez réessayer dans quelques instants' });

            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch (replyError) {
                console.error('❌ Impossible de répondre:', replyError);
            }
        }
    }
};

// ===========================================
// GÉNÉRATION DIRECTE DU TOKEN
// ===========================================

function generateTokenDirectly(user, guild, dashboardAPI) {
    try {
        if (!dashboardAPI || !dashboardAPI.tokens) {
            return {
                success: false,
                error: 'API Dashboard non disponible'
            };
        }

        // Générer le token
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + (24 * 60 * 60 * 1000); // 24h

        // Invalider les anciens tokens de cet utilisateur sur ce serveur
        for (const [existingToken, data] of dashboardAPI.tokens.entries()) {
            if (data.user.id === user.id && data.guild.id === guild.id) {
                dashboardAPI.tokens.delete(existingToken);
                console.log(`🗑️ Ancien token supprimé pour ${user.tag}`);
            }
        }

        // Stocker le nouveau token
        dashboardAPI.tokens.set(token, {
            user: { id: user.id, tag: user.tag },
            guild: { 
                id: guild.id, 
                name: guild.name,
                memberCount: guild.memberCount,
                icon: guild.iconURL()
            },
            expires,
            createdAt: Date.now()
        });

        console.log(`🔑 Token généré: ${user.tag} sur ${guild.name}`);

        // URL Railway (modifier avec votre vraie URL)
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://phoenix-production-a5cf.up.railway.app';
        
        return {
            success: true,
            token,
            expires,
            dashboardUrl: `${dashboardUrl}/dashboard.html?token=${token}`
        };

    } catch (error) {
        console.error('❌ Erreur génération token:', error);
        return {
            success: false,
            error: error.message || 'Erreur de génération du token'
        };
    }
}

// ===========================================
// EMBEDS
// ===========================================

function createWebDashboardEmbed(tokenResponse, user, guild) {
    const expiresAt = new Date(tokenResponse.expires);
    
    return new EmbedBuilder()
        .setTitle('🌐 Dashboard Web - Accès Généré')
        .setDescription('Votre lien d\'accès sécurisé au dashboard Phoenix Bot a été généré avec succès !')
        .setColor(Colors.Green)
        .addFields(
            {
                name: '🔗 Lien d\'accès',
                value: `[**🚀 Ouvrir le Dashboard**](${tokenResponse.dashboardUrl})`,
                inline: false
            },
            {
                name: '⏰ Validité',
                value: `Expire le **${expiresAt.toLocaleDateString('fr-FR')}** à **${expiresAt.toLocaleTimeString('fr-FR')}**`,
                inline: true
            },
            {
                name: '🎯 Serveur',
                value: guild.name,
                inline: true
            },
            {
                name: '📋 Fonctionnalités',
                value: '🎮 Gestion streamers\n📊 Statistiques\n⚙️ Configuration\n🔧 Paramètres',
                inline: false
            }
        )
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ 
            text: '⚠️ Ne partagez jamais ce lien', 
            iconURL: guild.iconURL() 
        })
        .setTimestamp();
}

function createMobileDashboardEmbed(tokenResponse, user, guild) {
    const expiresAt = new Date(tokenResponse.expires);
    
    return new EmbedBuilder()
        .setTitle('📱 Dashboard Mobile')
        .setDescription('Version mobile optimisée !')
        .setColor(Colors.Blue)
        .addFields(
            {
                name: '📱 Lien mobile',
                value: `[**📲 Ouvrir**](${tokenResponse.dashboardUrl})`,
                inline: false
            },
            {
                name: '⏰ Validité',
                value: `24 heures\n${expiresAt.toLocaleString('fr-FR')}`,
                inline: false
            }
        )
        .setFooter({ text: '💡 Ajoutez à l\'écran d\'accueil' })
        .setTimestamp();
}

function createRefreshTokenEmbed(tokenResponse, user, guild) {
    return new EmbedBuilder()
        .setTitle('🔑 Token Rafraîchi')
        .setDescription('Nouveau token généré !')
        .setColor(Colors.Yellow)
        .addFields(
            {
                name: '🆕 Nouveau lien',
                value: `[**🔄 Accéder**](${tokenResponse.dashboardUrl})`,
                inline: false
            },
            {
                name: '🛡️ Sécurité',
                value: 'Ancien token révoqué',
                inline: false
            }
        )
        .setTimestamp();
}
```

## Changements importants :

1. **Suppression du `fetch`** - Utilise uniquement l'accès direct à `bot.dashboardAPI`
2. **URL dynamique** - Utilise `process.env.DASHBOARD_URL` ou votre URL Railway
3. **Gestion d'erreurs améliorée** - Plus de détails pour déboguer
4. **Plus rapide** - Pas d'appel HTTP, réponse instantanée

## Ajoutez aussi une variable d'environnement sur Railway :

Dans Railway → Variables :
```
DASHBOARD_URL=https://phoenix-production-a5cf.up.railway.app
