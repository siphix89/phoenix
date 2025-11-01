// =======================================
//    boutons/ruleAcceptance.js
// =======================================

const { EmbedBuilder } = require('discord.js');

module.exports = {
    // ✅ IMPORTANT: Votre ButtonManager appelle execute(), pas handle()
    async execute(interaction, client) {
        console.log(`🔍 [ruleAcceptance] Appelé pour ${interaction.user.tag}`);
        console.log(`🔍 [ruleAcceptance] CustomId: ${interaction.customId}`);

        try {
            // ✅ ÉTAPE 1: Répondre immédiatement (< 3 secondes)
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
                console.log(`✅ [ruleAcceptance] Interaction deferred`);
            }

            // ✅ ÉTAPE 2: Extraire le roleId
            const roleId = interaction.customId.replace('accept_rules_', '');
            console.log(`🎭 [ruleAcceptance] RoleId extrait: ${roleId}`);

            // Validation du roleId
            if (!roleId || roleId === interaction.customId) {
                console.error(`❌ [ruleAcceptance] Impossible d'extraire le roleId`);
                await interaction.editReply({
                    content: '❌ Configuration du bouton invalide. Contactez un administrateur.',
                    ephemeral: true
                });
                return true;
            }

            // ✅ ÉTAPE 3: Vérifier que le rôle existe
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
                console.error(`❌ [ruleAcceptance] Rôle ${roleId} introuvable`);
                await interaction.editReply({
                    content: '❌ Le rôle configuré est introuvable. Contactez un administrateur.',
                    ephemeral: true
                });
                return true;
            }

            console.log(`✅ [ruleAcceptance] Rôle trouvé: ${role.name} (${role.id})`);

            // ✅ ÉTAPE 4: Vérifier si l'utilisateur a déjà le rôle
            if (interaction.member.roles.cache.has(roleId)) {
                console.log(`ℹ️ [ruleAcceptance] ${interaction.user.tag} a déjà le rôle`);
                await interaction.editReply({
                    content: `✅ Vous avez déjà le rôle **${role.name}** !`,
                    ephemeral: true
                });
                return true;
            }

            // ✅ ÉTAPE 5: Vérifier les permissions du bot
            const botMember = interaction.guild.members.me;
            
            if (!botMember.permissions.has('ManageRoles')) {
                console.error(`❌ [ruleAcceptance] Bot n'a pas ManageRoles`);
                await interaction.editReply({
                    content: '❌ Je n\'ai pas la permission de gérer les rôles. Contactez un administrateur.',
                    ephemeral: true
                });
                return true;
            }

            // ✅ ÉTAPE 6: Vérifier la hiérarchie des rôles
            const botHighestRole = botMember.roles.highest;
            console.log(`🔍 [ruleAcceptance] Rôle bot: ${botHighestRole.name} (pos: ${botHighestRole.position})`);
            console.log(`🔍 [ruleAcceptance] Rôle cible: ${role.name} (pos: ${role.position})`);

            if (role.position >= botHighestRole.position) {
                console.error(`❌ [ruleAcceptance] Hiérarchie: ${role.position} >= ${botHighestRole.position}`);
                await interaction.editReply({
                    content: '❌ Je ne peux pas attribuer ce rôle car il est trop haut dans la hiérarchie.\n' +
                            `Mon rôle le plus haut: **${botHighestRole.name}** (position ${botHighestRole.position})\n` +
                            `Rôle à attribuer: **${role.name}** (position ${role.position})\n\n` +
                            `➡️ Un administrateur doit déplacer mon rôle au-dessus de **${role.name}**.`,
                    ephemeral: true
                });
                return true;
            }

            // ✅ ÉTAPE 7: Attribuer le rôle
            console.log(`➕ [ruleAcceptance] Attribution du rôle ${role.name} à ${interaction.user.tag}...`);
            
            try {
                await interaction.member.roles.add(role, 'Acceptation du règlement');
                console.log(`✅ [ruleAcceptance] Rôle attribué avec succès`);
            } catch (roleError) {
                console.error(`❌ [ruleAcceptance] Erreur attribution rôle:`, roleError);
                await interaction.editReply({
                    content: `❌ Impossible d'attribuer le rôle: ${roleError.message}`,
                    ephemeral: true
                });
                return true;
            }

            // ✅ ÉTAPE 8: Envoyer la confirmation
            const embed = new EmbedBuilder()
                .setTitle('✅ Règlement accepté')
                .setDescription(`Félicitations **${interaction.user.username}** !\n\nVous avez reçu le rôle **${role.name}** 🎉`)
                .setColor('Green')
                .addFields({
                    name: '🎯 Bienvenue !',
                    value: 'Vous avez maintenant accès à tous les channels du serveur. Amusez-vous bien !',
                    inline: false
                })
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ 
                    text: `${interaction.guild.name}`,
                    iconURL: interaction.guild.iconURL() || undefined
                });

            await interaction.editReply({ 
                embeds: [embed],
                ephemeral: true
            });

            console.log(`✅ [ruleAcceptance] Confirmation envoyée à ${interaction.user.tag}`);

            // ✅ ÉTAPE 9: Logger l'événement
            if (client.logger) {
                client.logger.info(`✅ ${interaction.user.tag} a accepté le règlement et reçu le rôle ${role.name} sur ${interaction.guild.name}`);
            }

            // Optionnel: Envoyer un message dans un channel de logs
            try {
                // Récupérer la config du serveur pour le channel de logs
                const guildConfig = await client.db.getGuildConfig(interaction.guild.id);
                
                if (guildConfig && guildConfig.log_channel_id) {
                    const logChannel = interaction.guild.channels.cache.get(guildConfig.log_channel_id);
                    
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('📋 Règlement accepté')
                            .setDescription(`${interaction.user.toString()} a accepté le règlement`)
                            .addFields(
                                { name: '👤 Utilisateur', value: `${interaction.user.tag}\n\`${interaction.user.id}\``, inline: true },
                                { name: '🎭 Rôle attribué', value: `${role.toString()}\n\`${role.id}\``, inline: true }
                            )
                            .setColor('Green')
                            .setThumbnail(interaction.user.displayAvatarURL())
                            .setTimestamp();

                        await logChannel.send({ embeds: [logEmbed] });
                        console.log(`📝 [ruleAcceptance] Log envoyé dans ${logChannel.name}`);
                    }
                }
            } catch (logError) {
                console.warn(`⚠️ [ruleAcceptance] Impossible d'envoyer dans les logs:`, logError.message);
            }

            return true;

        } catch (error) {
            console.error(`❌ [ruleAcceptance] Erreur générale:`, error);
            console.error(error.stack);
            
            try {
                const errorMsg = {
                    content: `❌ Une erreur est survenue: ${error.message}\n\nContactez un administrateur si le problème persiste.`,
                    ephemeral: true
                };

                if (interaction.deferred) {
                    await interaction.editReply(errorMsg);
                } else if (!interaction.replied) {
                    await interaction.reply(errorMsg);
                }
            } catch (replyError) {
                console.error('❌ [ruleAcceptance] Impossible de répondre:', replyError.message);
            }

            return true;
        }
    }
};
