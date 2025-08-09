const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('liste-non-affiliates')
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
            
            // Lister les streamers non-affiliés avec numérotation
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
                // Si la liste est trop longue, la diviser en deux colonnes
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
                        value: firstHalf.length > 1024 ? firstHalf.substring(0, 1021) + '...' : firstHalf,
                        inline: true
                    },
                    {
                        name: '📋 Liste des streamers (2ème partie)',
                        value: secondHalf.length > 1024 ? secondHalf.substring(0, 1021) + '...' : secondHalf,
                        inline: true
                    }
                );
            }
            
            // Ajouter les instructions d'utilisation
            embed.addFields({
                name: '💡 Comment affilier un streamer',
                value: '**Méthode 1:** `/liste-non-affiliates action:Affilier un streamer username:nom_du_streamer`\n**Méthode 2:** `/affiliate nom_du_streamer`',
                inline: false
            });
            
            await interaction.reply({ embeds: [embed], ephemeral: false });
            client.logger?.info(`📋 Liste des non-affiliés consultée par ${interaction.user.username}`);
            
        } catch (error) {
            console.error('Erreur lors de la récupération des non-affiliés:', error);
            return interaction.reply({
                content: '❌ Une erreur est survenue lors de la récupération de la liste.',
                flags: [64] // MessageFlags.Ephemeral
            });
        }
    }
};