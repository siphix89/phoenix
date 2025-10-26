const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

// Classe pour gérer la vue avec bouton persistant
class RuleAcceptanceView {
    constructor(roleId, roleName) {
        this.roleId = roleId;
        this.roleName = roleName;
    }

    createActionRow() {
        const button = new ButtonBuilder()
            .setCustomId(`accept_rules_${this.roleId}`)
            .setLabel('✅ J\'accepte le règlement')
            .setStyle(ButtonStyle.Success);

        return new ActionRowBuilder().addComponents(button);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reglement-dashboard')
        .setDescription('Créer le dashboard du règlement avec bouton de rôle (Admin)')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Canal où créer le dashboard')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Rôle à accorder lors de l\'acceptation')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        try {
            
            // Vérification des permissions admin
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.editReply({
                    content: '❌ Seuls les administrateurs peuvent utiliser cette commande!'
                });
            }

            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            let targetRole = interaction.options.getRole('role');

            // Déterminer le rôle à utiliser
            if (!targetRole && process.env.RULES_ROLE_ID && process.env.RULES_ROLE_ID !== '0') {
                targetRole = interaction.guild.roles.cache.get(process.env.RULES_ROLE_ID);
            }

            if (!targetRole) {
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ Rôle requis')
                    .setDescription('Vous devez spécifier un rôle ou configurer `RULES_ROLE_ID` dans votre .env')
                    .setColor('Orange')
                    .addFields({
                        name: '💡 Solutions',
                        value: '• Utilisez `/reglement-dashboard #channel @role`\n• Ou configurez `RULES_ROLE_ID` dans le .env\n• Ou créez d\'abord un rôle avec `/config-reglement-role`',
                        inline: false
                    });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Vérifier les permissions du bot
            const botMember = interaction.guild.members.cache.get(client.user.id);
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || 
                targetRole.position >= botMember.roles.highest.position) {
                
                const embed = new EmbedBuilder()
                    .setTitle('❌ Permissions insuffisantes')
                    .setDescription(`Le bot ne peut pas accorder le rôle **${targetRole.name}**`)
                    .setColor('Red')
                    .addFields({
                        name: '🔧 Solutions',
                        value: '• Placez le rôle du bot au-dessus du rôle cible\n• Vérifiez que le bot a la permission \'Gérer les rôles\'\n• Choisissez un rôle plus bas dans la hiérarchie',
                        inline: false
                    });

                return await interaction.editReply({ embeds: [embed] });
            }

            // Embed principal du règlement
            const mainEmbed = new EmbedBuilder()
                .setTitle('📋 RÈGLEMENT DU SERVEUR')
                .setDescription('**Bienvenue dans notre communauté !** 🎉\n\nPour maintenir une ambiance conviviale et respectueuse, merci de suivre ces règles simples :')
                .setColor('Gold')
                .addFields(
                    {
                        name: '\u200B',
                        value: '**1. 🤝 Respect mutuel**\n' +
                               'Soyez respectueux envers tous les membres. Aucune forme de harcèlement, d\'insulte ou de discrimination ne sera tolérée.\n\n' +
                               '**2. 💬 Communication appropriée**\n' +
                               'Utilisez les bons channels, évitez le spam et gardez un langage approprié. Les discussions doivent au minimum rester constructives.\n\n' +
                               '**3. 🔞 Contenu approprié**\n' +
                               'Aucun contenu NSFW ou inapproprié. Respectez les limites d\'âge de Discord (13+).',
                        inline: false
                    },
                    {
                        name: '\u200B',
                        value: '**4. 📝 Présentation de votre chaîne**\n' +
                               'Votre présentation est importante : elle permet de vous attribuer le bon rôle et de se faire une idée de votre chaîne ainsi que de votre communauté.\n\n' +
                               '**5. 🤝 Le follow**\n' +
                               'Vous n\'êtes forcé de follow personne. Suivez qui vous voulez, librement et sans pression.\n\n' +
                               '**6. 🌙 Le lurk**\n' +
                               'Laisser un lurk ne coûte rien : ouvrir la page Twitch en arrière-plan apporte du soutien à tout le monde.',
                        inline: false
                    },
                    {
                        name: '\u200B',
                        value: '**7. 🛡️ Utilisation des bots**\n' +
                               'Utilisez les commandes des bots de manière appropriée et dans les bons channels.\n\n' +
                               '**8. ⚖️ Système de sanctions**\n' +
                               '```\nAvertissement → Mute → Kick → Ban\n```\n' +
                               'Les modérateurs appliquent les sanctions selon la gravité.',
                        inline: false
                    },
                    {
                        name: '🎯 Channels importants',
                        value: '• 📢 <#1400035914809479219> Annonces officielles\n' +
                               '• 🔴 <#1401602225821843487> Streams des affiliés\n' +
                               '• 🔴 <#1401602278443450368> Streams des non affiliés\n' +
                               '• 💬 <#1400057946934739066> presentation\n' +
                               '• 🆘 <#1399525678671724604> Aide et support',
                        inline: true
                    },
                    {
                        name: '🤖 Commandes utiles',
                        value: '• `/streamers` - affiches la liste choisie\n' +
                               '• `/stats` - Statistiques du serveur\n' +
                               '• `/live-status` - streamers en live\n' +
                               '• `/reglement` - Afficher ce règlement',
                        inline: true
                    },
                    {
                        name: '✅ Acceptation du règlement',
                        value: `En cliquant sur le bouton ci-dessous, vous confirmez avoir lu et accepté ce règlement.\nVous recevrez automatiquement le rôle **${targetRole.name}** 🎉`,
                        inline: false
                    }
                )
                .setFooter({
                    text: `Serveur ${interaction.guild.name} • Mis à jour le`,
                    iconURL: interaction.guild.iconURL()
                })
                .setTimestamp();

            // Créer la vue avec le bouton
            const view = new RuleAcceptanceView(targetRole.id, targetRole.name);
            const actionRow = view.createActionRow();

            // Envoyer l'embed avec le bouton
            await targetChannel.send({
                embeds: [mainEmbed],
                components: [actionRow]
            });

            // Confirmation de succès
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Dashboard créé')
                .setDescription(`Le dashboard du règlement a été créé dans ${targetChannel}`)
                .setColor('Green')
                .addFields(
                    {
                        name: '🎯 Rôle configuré',
                        value: `**${targetRole.name}** sera accordé aux membres qui acceptent le règlement`,
                        inline: false
                    },
                    {
                        name: '🔧 Modification',
                        value: '• `/modifier-reglement` pour mettre à jour le contenu\n• `/config-reglement-role` pour changer le rôle',
                        inline: false
                    }
                );

            await interaction.editReply({ embeds: [successEmbed] });
            
            client.logger?.info(`✅ Dashboard de règlement avec bouton créé dans ${targetChannel.name} par ${interaction.user.username} (rôle: ${targetRole.name})`);

        } catch (error) {
            console.error('Erreur dans reglement-dashboard:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Erreur')
                .setDescription(`Impossible de créer le dashboard: ${error.message.substring(0, 500)}`)
                .setColor('Red');

            // Utiliser editReply si déjà différé, sinon reply
            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            
            client.logger?.error(`❌ Erreur création dashboard règlement: ${error}`);
        }
    },

    // Gestionnaire pour les interactions de bouton
    async handleButtonInteraction(interaction, client) {
        if (!interaction.isButton() || !interaction.customId.startsWith('accept_rules_')) {
            return false;
        }

        try {

            // Répondre IMMÉDIATEMENT pour éviter le timeout Discord
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

        } catch (error) {
            console.error('Erreur dans handleButtonInteraction:', error);
            client.logger?.error(`❌ Erreur attribution rôle règlement: ${error}`);
            
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Erreur lors de l\'attribution du rôle. Contactez un administrateur.'
                });
            } else {
                await interaction.reply({
                    content: '❌ Erreur lors de l\'attribution du rôle. Contactez un administrateur.',
                    ephemeral: true
                });
            }
        }

        return true;
    }
};