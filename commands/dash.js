// ===========================================
// COMMANDE /dash CORRIGÉE POUR API EXISTANTE
// ===========================================
// Fichier: commands/dash.js

const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

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
                    .addFields(
                        {
                            name: '🔑 Permissions requises',
                            value: '• Administrateur du serveur\n• Rôle Modérateur\n• Permission "Gérer les messages"',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Phoenix Bot Dashboard' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Générer le token via l'API Dashboard existante
            const tokenResponse = await generateDashboardTokenViaAPI(user, guild, bot);

            if (!tokenResponse.success) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Erreur de génération')
                    .setDescription('Impossible de générer le token d\'accès.')
                    .setColor(Colors.Red)
                    .addFields(
                        {
                            name: '🔧 Détails de l\'erreur',
                            value: tokenResponse.error || 'Erreur inconnue',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Contactez un développeur si le problème persiste' });

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Créer l'embed de succès selon le type
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

            // Log de sécurité
            console.log(`🔑 Token dashboard généré: ${user.tag} (${user.id}) sur ${guild.name}`);

        } catch (error) {
            console.error('❌ Erreur commande /dash:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Erreur système')
                .setDescription('Une erreur interne s\'est produite.')
                .setColor(Colors.Red)
                .setFooter({ text: 'Veuillez réessayer dans quelques instants' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};

// ===========================================
// GÉNÉRATION TOKEN VIA API DASHBOARD
// ===========================================

async function generateDashboardTokenViaAPI(user, guild, bot) {
    try {
        // Option 1: Accès direct à l'instance DashboardAPI du bot
        if (bot.dashboardAPI && bot.dashboardAPI.tokens) {
            return generateTokenDirectly(user, guild, bot.dashboardAPI);
        }

        // Option 2: Appel HTTP à l'API (si l'API est sur un autre processus)
        try {
            const response = await fetch('http://localhost:3001/api/auth/generate-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: user.id,
                    guildId: guild.id,
                    userTag: user.tag
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Erreur API:', response.status, errorText);
                return {
                    success: false,
                    error: `Erreur API (${response.status}): ${errorText}`
                };
            }

            const data = await response.json();
            return data;

        } catch (fetchError) {
            console.error('❌ Erreur fetch:', fetchError);
            // Si fetch échoue, essayer la génération directe
            return generateTokenDirectly(user, guild, bot.dashboardAPI);
        }

    } catch (error) {
        console.error('❌ Erreur génération token:', error);
        return {
            success: false,
            error: 'Erreur de communication avec l\'API Dashboard'
        };
    }
}

// ===========================================
// GÉNÉRATION DIRECTE (FALLBACK)
// ===========================================

function generateTokenDirectly(user, guild, dashboardAPI) {
    try {
        const crypto = require('crypto');
        
        // Générer le token
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + (24 * 60 * 60 * 1000); // 24h

        // Stocker dans l'API Dashboard existante
        if (dashboardAPI && dashboardAPI.tokens) {
            // Invalider les anciens tokens de cet utilisateur
            for (const [existingToken, data] of dashboardAPI.tokens.entries()) {
                if (data.user.id === user.id && data.guild.id === guild.id) {
                    dashboardAPI.tokens.delete(existingToken);
                    console.log(`🗑️ Ancien token supprimé pour ${user.tag}`);
                }
            }

            // Stocker le nouveau token
            dashboardAPI.tokens.set(token, {
                user: { id: user.id, tag: user.tag },
                guild: { id: guild.id, name: guild.name },
                expires,
                createdAt: Date.now()
            });

            console.log(`🔑 Token généré directement: ${user.tag} sur ${guild.name}`);

            return {
                success: true,
                token,
                expires,
                dashboardUrl: `http://localhost:3001/dashboard.html?token=${token}`
            };
        }

        return {
            success: false,
            error: 'API Dashboard non disponible'
        };

    } catch (error) {
        console.error('❌ Erreur génération directe:', error);
        return {
            success: false,
            error: 'Erreur de génération du token'
        };
    }
}

// ===========================================
// FONCTIONS DE GÉNÉRATION D'EMBEDS
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
                name: '🔒 Sécurité',
                value: '• Token unique et temporaire\n• Accès limité à 24h\n• Permissions vérifiées',
                inline: false
            },
            {
                name: '📋 Fonctionnalités disponibles',
                value: '🎮 Gestion des streamers\n📊 Statistiques en temps réel\n⚙️ Administration du bot\n📋 Logs système\n🔧 Paramètres avancés',
                inline: false
            }
        )
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ 
            text: '⚠️ Ne partagez jamais ce lien - Accès administrateur', 
            iconURL: guild.iconURL() 
        })
        .setTimestamp();
}

function createMobileDashboardEmbed(tokenResponse, user, guild) {
    const expiresAt = new Date(tokenResponse.expires);
    
    return new EmbedBuilder()
        .setTitle('📱 Dashboard Mobile - Accès Généré')
        .setDescription('Version mobile optimisée du dashboard Phoenix Bot !')
        .setColor(Colors.Blue)
        .addFields(
            {
                name: '📱 Lien mobile',
                value: `[**📲 Ouvrir sur Mobile**](${tokenResponse.dashboardUrl}&mobile=true)`,
                inline: false
            },
            {
                name: '⏰ Validité',
                value: `Expire dans **24 heures**\n${expiresAt.toLocaleString('fr-FR')}`,
                inline: true
            },
            {
                name: '📱 Optimisé pour',
                value: '• Interface tactile\n• Navigation simplifiée\n• Chargement rapide',
                inline: true
            },
            {
                name: '🎯 Fonctionnalités mobiles',
                value: '📊 Stats essentielles\n🎮 Gestion streamers\n🔔 Notifications push\n📡 Statut en temps réel',
                inline: false
            }
        )
        .setThumbnail('https://cdn.discordapp.com/emojis/📱.png')
        .setFooter({ text: '💡 Ajoutez à votre écran d\'accueil pour un accès rapide' })
        .setTimestamp();
}

function createRefreshTokenEmbed(tokenResponse, user, guild) {
    return new EmbedBuilder()
        .setTitle('🔑 Token Rafraîchi')
        .setDescription('Votre ancien token a été invalidé. Nouveau token généré !')
        .setColor(Colors.Yellow)
        .addFields(
            {
                name: '🆕 Nouveau lien',
                value: `[**🔄 Accéder au Dashboard**](${tokenResponse.dashboardUrl})`,
                inline: false
            },
            {
                name: '🛡️ Sécurité renforcée',
                value: '• Ancien token révoqué immédiatement\n• Nouveau token sécurisé\n• Sessions précédentes fermées',
                inline: false
            },
            {
                name: '⚠️ Important',
                value: 'Si vous avez des onglets ouverts du dashboard, ils vont être déconnectés automatiquement.',
                inline: false
            }
        )
        .setColor(Colors.Orange)
        .setFooter({ text: 'Sécurité - Phoenix Bot Dashboard' })
        .setTimestamp();
}
