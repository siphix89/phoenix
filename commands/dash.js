// ===========================================
// COMMANDE /dash - VERSION STABLE POUR RAILWAY
// ===========================================

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
                    .setDescription('Le dashboard n\'est pas actuellement disponible. Le bot est peut-être en cours de démarrage.')
                    .setColor(Colors.Red)
                    .setFooter({ text: 'Réessayez dans quelques instants' });

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Générer le token directement
            const tokenResponse = await generateToken(user, guild, bot);

            if (!tokenResponse.success) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Erreur de génération')
                    .setDescription('Impossible de générer le token d\'accès.')
                    .setColor(Colors.Red)
                    .addFields({
                        name: '🔧 Détails',
                        value: tokenResponse.error || 'Erreur inconnue',
                        inline: false
                    });

                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Créer l'embed selon le type
            let embed;
            switch (type) {
                case 'web':
                    embed = createWebEmbed(tokenResponse, user, guild);
                    break;
                case 'mobile':
                    embed = createMobileEmbed(tokenResponse, user, guild);
                    break;
                case 'refresh':
                    embed = createRefreshEmbed(tokenResponse, user, guild);
                    break;
                default:
                    embed = createWebEmbed(tokenResponse, user, guild);
            }

            await interaction.editReply({ embeds: [embed] });
            console.log(`🔑 Token généré: ${user.tag} sur ${guild.name}`);

        } catch (error) {
            console.error('❌ Erreur commande /dash:', error);
            
            try {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Erreur système')
                    .setDescription('Une erreur s\'est produite.')
                    .setColor(Colors.Red)
                    .setFooter({ text: 'Réessayez dans quelques instants' });

                await interaction.editReply({ embeds: [errorEmbed] });
            } catch (e) {
                console.error('❌ Impossible de répondre:', e);
            }
        }
    }
};

async function generateToken(user, guild, bot) {
    try {
        const crypto = require('crypto');
        
        if (!bot.dashboardAPI || !bot.dashboardAPI.tokens) {
            return { success: false, error: 'API Dashboard non disponible' };
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + (24 * 60 * 60 * 1000);

        // Supprimer anciens tokens
        for (const [key, data] of bot.dashboardAPI.tokens.entries()) {
            if (data.user.id === user.id && data.guild.id === guild.id) {
                bot.dashboardAPI.tokens.delete(key);
            }
        }

        // Stocker nouveau token
        bot.dashboardAPI.tokens.set(token, {
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

        const baseUrl = process.env.DASHBOARD_URL || 'https://phoenix-production-a5cf.up.railway.app';
        
        return {
            success: true,
            token,
            expires,
            dashboardUrl: `${baseUrl}/dashboard.html?token=${token}`
        };

    } catch (error) {
        console.error('❌ Erreur génération:', error);
        return { success: false, error: error.message };
    }
}

function createWebEmbed(tokenResponse, user, guild) {
    const expiresAt = new Date(tokenResponse.expires);
    
    return new EmbedBuilder()
        .setTitle('🌐 Dashboard Web - Accès Généré')
        .setDescription('Votre lien d\'accès sécurisé a été généré !')
        .setColor(Colors.Green)
        .addFields(
            {
                name: '🔗 Lien d\'accès',
                value: `[**🚀 Ouvrir le Dashboard**](${tokenResponse.dashboardUrl})`,
                inline: false
            },
            {
                name: '⏰ Validité',
                value: `Expire le ${expiresAt.toLocaleDateString('fr-FR')} à ${expiresAt.toLocaleTimeString('fr-FR')}`,
                inline: true
            },
            {
                name: '🎯 Serveur',
                value: guild.name,
                inline: true
            },
            {
                name: '📋 Fonctionnalités',
                value: '🎮 Gestion streamers\n📊 Statistiques\n⚙️ Configuration',
                inline: false
            }
        )
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ text: '⚠️ Ne partagez jamais ce lien' })
        .setTimestamp();
}

function createMobileEmbed(tokenResponse, user, guild) {
    const expiresAt = new Date(tokenResponse.expires);
    
    return new EmbedBuilder()
        .setTitle('📱 Dashboard Mobile')
        .setDescription('Version mobile optimisée')
        .setColor(Colors.Blue)
        .addFields(
            {
                name: '📱 Lien',
                value: `[**📲 Ouvrir**](${tokenResponse.dashboardUrl})`,
                inline: false
            },
            {
                name: '⏰ Validité',
                value: `24h - ${expiresAt.toLocaleString('fr-FR')}`,
                inline: false
            }
        )
        .setFooter({ text: 'Ajoutez à l\'écran d\'accueil' })
        .setTimestamp();
}

function createRefreshEmbed(tokenResponse, user, guild) {
    return new EmbedBuilder()
        .setTitle('🔑 Token Rafraîchi')
        .setDescription('Nouveau token généré')
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
