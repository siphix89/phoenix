const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testrole')
        .setDescription('🧪 Teste l\'attribution automatique du rôle')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Utilisateur à tester (défaut: vous)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const testUser = interaction.options.getUser('user') || interaction.user;
        const testMember = await interaction.guild.members.fetch(testUser.id);

        console.log(`🧪 [testrole] Test pour ${testUser.tag}`);

        const diagnosticEmbed = new EmbedBuilder()
            .setTitle('🔍 Diagnostic du système de rôle automatique')
            .setColor('Blue');

        const results = [];

        // ✅ ÉTAPE 1: Vérifier la configuration
        if (!client.config.autoRoleId || client.config.autoRoleId === '') {
            results.push('❌ **AUTO_ROLE_ID non configuré**');
            results.push('   Ajoutez dans .env: `AUTO_ROLE_ID=123456789`');
        } else {
            results.push(`✅ **AUTO_ROLE_ID configuré:** \`${client.config.autoRoleId}\``);

            // ✅ ÉTAPE 2: Vérifier que le rôle existe
            const role = interaction.guild.roles.cache.get(client.config.autoRoleId);
            if (!role) {
                results.push(`❌ **Rôle introuvable:** ID \`${client.config.autoRoleId}\``);
                results.push(`   Le rôle n'existe pas dans ce serveur`);
            } else {
                results.push(`✅ **Rôle trouvé:** ${role.toString()} (${role.name})`);

                // ✅ ÉTAPE 3: Vérifier si l'utilisateur a déjà le rôle
                if (testMember.roles.cache.has(client.config.autoRoleId)) {
                    results.push(`ℹ️ **${testUser.username} a déjà ce rôle**`);
                } else {
                    results.push(`✅ **${testUser.username} n'a pas encore le rôle**`);
                }

                // ✅ ÉTAPE 4: Vérifier les permissions du bot
                const botMember = interaction.guild.members.me;
                if (!botMember.permissions.has('ManageRoles')) {
                    results.push('❌ **Permission manquante:** Manage Roles');
                    results.push('   Le bot doit avoir la permission "Gérer les rôles"');
                } else {
                    results.push('✅ **Permission:** Bot a "Manage Roles"');

                    // ✅ ÉTAPE 5: Vérifier la hiérarchie
                    const botHighestRole = botMember.roles.highest;
                    results.push(`\n📊 **Hiérarchie des rôles:**`);
                    results.push(`   • Rôle du bot: **${botHighestRole.name}** (position: ${botHighestRole.position})`);
                    results.push(`   • Rôle cible: **${role.name}** (position: ${role.position})`);

                    if (role.position >= botHighestRole.position) {
                        results.push('❌ **Problème de hiérarchie!**');
                        results.push(`   Le rôle "${role.name}" est trop haut`);
                        results.push(`   Solution: Déplacez le rôle du bot au-dessus de "${role.name}"`);
                    } else {
                        results.push('✅ **Hiérarchie correcte**');

                        // ✅ ÉTAPE 6: Tester l'attribution
                        if (!testMember.roles.cache.has(client.config.autoRoleId)) {
                            try {
                                results.push(`\n🧪 **Test d'attribution...**`);
                                await testMember.roles.add(role, 'Test du système de rôle automatique');
                                results.push(`✅ **Rôle attribué avec succès!**`);
                                results.push(`   ${testUser.toString()} a maintenant le rôle ${role.toString()}`);
                            } catch (testError) {
                                results.push(`❌ **Échec du test:** ${testError.message}`);
                            }
                        }
                    }
                }
            }
        }

        // ✅ ÉTAPE 7: Vérifier "Server Members Intent"
        results.push(`\n🔔 **Intention Discord:**`);
        results.push(`Pour que le système fonctionne automatiquement:`);
        results.push(`1. Aller sur discord.com/developers/applications`);
        results.push(`2. Sélectionner votre bot`);
        results.push(`3. Bot → Privileged Gateway Intents`);
        results.push(`4. Activer "Server Members Intent"`);

        diagnosticEmbed.setDescription(results.join('\n'));

        // Résumé final
        const hasConfig = client.config.autoRoleId && client.config.autoRoleId !== '';
        const role = interaction.guild.roles.cache.get(client.config.autoRoleId);
        const hasPermission = interaction.guild.members.me.permissions.has('ManageRoles');
        const hierarchyOk = role ? (role.position < interaction.guild.members.me.roles.highest.position) : false;

        const allGood = hasConfig && role && hasPermission && hierarchyOk;

        if (allGood) {
            diagnosticEmbed.setColor('Green');
            diagnosticEmbed.setFooter({ text: '✅ Le système de rôle automatique est opérationnel' });
        } else {
            diagnosticEmbed.setColor('Red');
            diagnosticEmbed.setFooter({ text: '❌ Des problèmes ont été détectés - Suivez les instructions ci-dessus' });
        }

        await interaction.editReply({ embeds: [diagnosticEmbed] });

        if (client.logger) {
            client.logger.info(`🧪 [testrole] Test effectué par ${interaction.user.tag}`);
        }
    }
};