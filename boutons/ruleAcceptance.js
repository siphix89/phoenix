// =======================================
//            Bouton règlement
// ========================================
const { EmbedBuilder } = require('discord.js');

module.exports = {
    async handle(interaction, client) {
        // Répondre immédiatement
        await interaction.deferReply({ ephemeral: true });

        const roleId = interaction.customId.replace('accept_rules_', '');
        const role = interaction.guild.roles.cache.get(roleId);

        if (!role) {
            await interaction.editReply({
                content: '❌ Rôle introuvable. Contactez un administrateur.'
            });
            return true;
        }

        // Vérifier si l'utilisateur a déjà le rôle
        if (interaction.member.roles.cache.has(roleId)) {
            await interaction.editReply({
                content: `✅ Vous avez déjà le rôle **${role.name}** !`
            });
            return true;
        }

        // Ajouter le rôle
        await interaction.member.roles.add(role);
        
        const embed = new EmbedBuilder()
            .setTitle('✅ Règlement accepté')
            .setDescription(`Félicitations ! Vous avez reçu le rôle **${role.name}** 🎉`)
            .setColor('Green')
            .addFields({
                name: '🎯 Bienvenue !',
                value: 'Vous avez maintenant accès à tous les channels du serveur. Amusez-vous bien !',
                inline: false
            });

        await interaction.editReply({ embeds: [embed] });
        client.logger?.info(`✅ ${interaction.user.username} a accepté le règlement et reçu le rôle ${role.name}`);

        return true;
    }
};