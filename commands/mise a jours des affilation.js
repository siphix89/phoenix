const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Commande principale pour affilier un streamer
const affiliateCommand = {
    data: new SlashCommandBuilder()
        .setName('affiliate')
        .setDescription('Passe un streamer non-affilié en affilié')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Nom d\'utilisateur Twitch du streamer')
                .setRequired(true)
        ),
    
    async execute(interaction, client) {
        const username = interaction.options.getString('username');
        
        try {
            // Récupérer les données du streamer depuis ta base de données
            const allStreamers = await client.db.getAllStreamers();
            const streamer = allStreamers.find(s => s.name.toLowerCase() === username.toLowerCase());
            
            if (!streamer) {
                return interaction.reply({
                    content: `❌ Streamer "${username}" non trouvé dans la base de données.`,
                    flags: [64] // MessageFlags.Ephemeral
                });
            }
            
            if (streamer.status === 'affilie') {
                return interaction.reply({
                    content: `ℹ️ ${username} est déjà affilié !`,
                    flags: [64] // MessageFlags.Ephemeral
                });
            }
            
            // Mettre à jour le statut d'affiliation en utilisant ton DatabaseManager
            try {
                const result = await client.db.run(
                    'UPDATE streamers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(name) = LOWER(?)',
                    ['affilie', username]
                );
                
                if (result.changes > 0) {
                    client.logger?.info(`✅ ${username} passé en affilié`);
                    return interaction.reply({
                        content: `✅ ${username} a été passé en affilié avec succès !`
                    });
                } else {
                    return interaction.reply({
                        content: `❌ Impossible de mettre à jour ${username}.`,
                        flags: [64]
                    });
                }
            } catch (dbError) {
                throw new Error(`Erreur base de données: ${dbError.message}`);
            }
            
        } catch (error) {
            console.error('Erreur lors de l\'affiliation:', error);
            return interaction.reply({
                content: `❌ Une erreur est survenue lors de l'affiliation: ${error.message}`,
                flags: [64] // MessageFlags.Ephemeral
            });
        }
    }
};

// Commande pour lister les non-affiliés
const listNonAffiliatesCommand = {
    data: new SlashCommandBuilder()
        .setName('list-non-affiliates')
        .setDescription('Affiche la liste des streamers non-affiliés')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action à effectuer')
                .setRequired(false)
                .addChoices(
                    { name: 'Voir la liste', value: 'list' },
                    { name: 'Affilier un streamer', value: 'affiliate' }
                )
        )
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Nom du streamer à affilier (si action = affiliate)')
                .setRequired(false)
        ),
    
    async execute(interaction, client) {
        const action = interaction.options.getString('action') || 'list';
        const username = interaction.options.getString('username');
        
        try {
            // Récupérer tous les streamers
            const allStreamers = await client.db.getAllStreamers();
            const nonAffiliatedStreamers = allStreamers.filter(s => s.status === 'non_affilie');
            
            if (action === 'affiliate' && username) {
                // Affilier un streamer spécifique
                const streamer = nonAffiliatedStreamers.find(s => s.name.toLowerCase() === username.toLowerCase());
                
                if (!streamer) {
                    return interaction.reply({
                        content: `❌ "${username}" n'est pas dans la liste des non-affiliés ou n'existe pas.`,
                        flags: [64]
                    });
                }
                
                const result = await client.db.run(
                    'UPDATE streamers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(name) = LOWER(?)',
                    ['affilie', username]
                );
                
                if (result.changes > 0) {
                    client.logger?.info(`✅ ${username} passé en affilié`);
                    return interaction.reply({
                        content: `✅ **${username}** a été passé en affilié avec succès !`
                    });
                }
            }
            
            // Afficher la liste des non-affiliés
            const embed = new EmbedBuilder()
                .setTitle('💫 Streamers Non-Affiliés')
                .setColor('Orange')
                .setTimestamp();
            
            if (nonAffiliatedStreamers.length === 0) {
                embed.setDescription('🎉 Aucun streamer non-affilié ! Tous sont affiliés.');
                return interaction.reply({ embeds: [embed], ephemeral: false });
            }
            
            embed.setDescription(`**${nonAffiliatedStreamers.length} streamer(s)** en attente d'affiliation`);
            
            // Lister les streamers non-affiliés
            const streamersList = nonAffiliatedStreamers
                .map((s, index) => `**${index + 1}.** ${s.name}\n🔗 ${s.url}\n💬 ${s.description}`)
                .join('\n\n');
            
            if (streamersList.length <= 1024) {
                embed.addFields({
                    name: '📋 Liste des streamers',
                    value: streamersList,
                    inline: false
                });
            } else {
                // Si la liste est trop longue, la diviser
                const halfLength = Math.ceil(nonAffiliatedStreamers.length / 2);
                const firstHalf = nonAffiliatedStreamers.slice(0, halfLength)
                    .map((s, index) => `**${index + 1}.** ${s.name}\n🔗 ${s.url}`)
                    .join('\n\n');
                
                const secondHalf = nonAffiliatedStreamers.slice(halfLength)
                    .map((s, index) => `**${halfLength + index + 1}.** ${s.name}\n🔗 ${s.url}`)
                    .join('\n\n');
                
                embed.addFields(
                    {
                        name: '📋 Liste des streamers (1ère partie)',
                        value: firstHalf,
                        inline: true
                    },
                    {
                        name: '📋 Liste des streamers (2ème partie)',
                        value: secondHalf,
                        inline: true
                    }
                );
            }
            
            embed.addFields({
                name: '💡 Comment affilier',
                value: 'Utilisez: `/list-non-affiliates action:Affilier un streamer username:nom_du_streamer`\nOu: `/affiliate nom_du_streamer`',
                inline: false
            });
            
            await interaction.reply({ embeds: [embed], ephemeral: false });
            client.logger?.info(`📋 Liste des non-affiliés consultée par ${interaction.user.username}`);
            
        } catch (error) {
            console.error('Erreur lors de la récupération des non-affiliés:', error);
            return interaction.reply({
                content: '❌ Une erreur est survenue lors de la récupération de la liste.',
                flags: [64]
            });
        }
    }
};

// Exporter seulement la commande affiliate (garde la structure simple)
module.exports = affiliateCommand;