const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-reglement-role')
        .setDescription('Configurer le rôle du règlement (Admin)')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Rôle à configurer')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        // Vérification des permissions admin
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({
                content: '❌ Seuls les administrateurs peuvent utiliser cette commande!',
                ephemeral: true
            });
        }

        const role = interaction.options.getRole('role');

        if (role) {
            // Vérifier les permissions
            const botMember = interaction.guild.members.cache.get(client.user.id);
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || 
                role.position >= botMember.roles.highest.position) {
                
                const embed = new EmbedBuilder()
                    .setTitle('❌ Rôle non assignable')
                    .setDescription(`Le bot ne peut pas accorder le rôle **${role.name}**`)
                    .setColor('Red')
                    .addFields({
                        name: '🔧 Solutions',
                        value: '• Placez le rôle du bot au-dessus du rôle cible\n• Vérifiez que le bot a la permission \'Gérer les rôles\'\n• Choisissez un rôle plus bas dans la hiérarchie',
                        inline: false
                    });

                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Mettre à jour les variables d'environnement en mémoire
            process.env.RULES_ROLE_ID = role.id;
            process.env.RULES_ROLE_NAME = role.name;

            const embed = new EmbedBuilder()
                .setTitle('✅ Configuration mise à jour')
                .setDescription(`Rôle du règlement configuré: ${role}`)
                .setColor('Green')
                .addFields(
                    {
                        name: '💡 Note',
                        value: 'Pour rendre cette configuration permanente, mettez à jour `RULES_ROLE_ID` dans votre fichier .env',
                        inline: false
                    },
                    {
                        name: '🔄 Prochaine étape',
                        value: 'Utilisez `/reglement-dashboard` pour créer/mettre à jour le dashboard avec le bouton',
                        inline: false
                    }
                );

            await interaction.reply({ embeds: [embed] });
            client.logger?.info(`✅ Rôle de règlement configuré sur ${role.name} par ${interaction.user.username}`);

        } else {
            // Afficher la configuration actuelle
            const currentRole = process.env.RULES_ROLE_ID && process.env.RULES_ROLE_ID !== '0' ? 
                interaction.guild.roles.cache.get(process.env.RULES_ROLE_ID) : null;

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Configuration du rôle de règlement')
                .setColor('Blue');

            if (currentRole) {
                embed.addFields({
                    name: '🎯 Rôle actuel',
                    value: `${currentRole} (\`${currentRole.id}\`)`,
                    inline: false
                });

                // Vérifier si le rôle est toujours assignable
                const botMember = interaction.guild.members.cache.get(client.user.id);
                if (botMember.permissions.has(PermissionFlagsBits.ManageRoles) && 
                    currentRole.position < botMember.roles.highest.position) {
                    embed.addFields({ name: '✅ Status', value: 'Rôle assignable', inline: true });
                } else {
                    embed.addFields({ name: '⚠️ Status', value: 'Rôle non assignable', inline: true });
                }
            } else {
                embed.addFields({
                    name: '⚠️ Aucun rôle configuré',
                    value: 'Utilisez `/config-reglement-role @role` pour configurer',
                    inline: false
                });
            }

            embed.addFields({
                name: '🔧 Utilisation',
                value: '• `/config-reglement-role @role` - Définir le rôle\n• `/reglement-dashboard` - Créer le dashboard\n• `/config-reglement-role` - Voir la config actuelle',
                inline: false
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
};