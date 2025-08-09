const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unaffiliate')
        .setDescription('Retire le statut d\'affilié d\'un streamer')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Nom d\'utilisateur Twitch du streamer')
                .setRequired(true)
        ),
    
    async execute(interaction, client) {
        const username = interaction.options.getString('username');
        
        try {
            const allStreamers = await client.db.getAllStreamers();
            const streamer = allStreamers.find(s => s.name.toLowerCase() === username.toLowerCase());
            
            if (!streamer) {
                return interaction.reply({
                    content: `❌ Streamer "${username}" non trouvé.`,
                    flags: [64]
                });
            }
            
            if (streamer.status === 'non_affilie') {
                return interaction.reply({
                    content: `ℹ️ ${username} n'est pas affilié.`,
                    flags: [64]
                });
            }
            
            const result = await client.db.run(
                'UPDATE streamers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(name) = LOWER(?)',
                ['non_affilie', username]
            );
            
            if (result.changes > 0) {
                client.logger?.info(`✅ ${username} désaffilié`);
                return interaction.reply({
                    content: `✅ ${username} n'est plus affilié.`
                });
            }
            
        } catch (error) {
            console.error('Erreur:', error);
            return interaction.reply({
                content: '❌ Erreur lors de la désaffiliation.',
                flags: [64]
            });
        }
    }
};