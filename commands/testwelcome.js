const { SlashCommandBuilder, EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testwelcome')
        .setDescription('🧪 Teste le message de bienvenue')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Utilisateur à simuler (défaut: vous)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const testUser = interaction.options.getUser('user') || interaction.user;
        const testMember = await interaction.guild.members.fetch(testUser.id);

        console.log(`🧪 [testwelcome] Test pour ${testUser.tag}`);

        // Vérifier la config
        if (!client.config.welcomeChannel) {
            const noConfigEmbed = new EmbedBuilder()
                .setTitle('❌ Channel de bienvenue non configuré')
                .setColor('Red')
                .setDescription(
                    `Le channel de bienvenue n'est pas configuré.\n\n` +
                    `**Solution 1: Utiliser la commande**\n` +
                    `\`/setwelcome channel:#votre-channel\`\n\n` +
                    `**Solution 2: Modifier .env**\n` +
                    `Ajoutez: \`WELCOME_CHANNEL_ID=123456789\`\n` +
                    `Puis redémarrez le bot.`
                )
                .addFields({
                    name: '💡 Comment trouver l\'ID ?',
                    value: '1. Activez le mode développeur Discord\n2. Clic droit sur le channel → Copier l\'identifiant',
                    inline: false
                });

            return interaction.editReply({ embeds: [noConfigEmbed] });
        }

        const welcomeChannel = client.channels.cache.get(client.config.welcomeChannel.toString());
        if (!welcomeChannel) {
            const notFoundEmbed = new EmbedBuilder()
                .setTitle('❌ Channel de bienvenue introuvable')
                .setColor('Red')
                .setDescription(
                    `Le channel configuré n'existe pas ou le bot n'y a pas accès.`
                )
                .addFields(
                    { name: '🆔 ID configuré', value: `\`${client.config.welcomeChannel}\``, inline: false },
                    { name: '📝 Solution', value: 'Utilisez `/setwelcome` pour reconfigurer', inline: false }
                );

            return interaction.editReply({ embeds: [notFoundEmbed] });
        }

        const botPermissions = welcomeChannel.permissionsFor(interaction.guild.members.me);
        if (!botPermissions.has(['SendMessages', 'EmbedLinks'])) {
            const permEmbed = new EmbedBuilder()
                .setTitle('❌ Permissions manquantes')
                .setColor('Red')
                .setDescription(
                    `Le bot n'a pas les permissions nécessaires dans ${welcomeChannel.toString()}`
                )
                .addFields({
                    name: '🔒 Permissions requises',
                    value: '• Voir le salon\n• Envoyer des messages\n• Intégrer des liens',
                    inline: false
                });

            return interaction.editReply({ embeds: [permEmbed] });
        }

        try {
            // Récupérer les stats du serveur
            const guildStreamers = await client.db.getGuildStreamers(interaction.guild.id);

            let roleText = '';
            if (client.config.autoRoleId && client.config.autoRoleId !== 0) {
                const role = interaction.guild.roles.cache.get(client.config.autoRoleId.toString());
                if (role) {
                    roleText = `\n🎭 Rôle **${role.name}** attribué automatiquement`;
                }
            }

            // Créer l'embed de bienvenue (identique à celui du vrai système)
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎉 Bienvenue sur le serveur !')
                .setDescription(`Salut ${testMember.toString()} ! Nous sommes ravis de t'accueillir parmi nous ! 🚀${roleText}`)
                .setColor(Colors.Green)
                .setThumbnail(testUser.displayAvatarURL())
                .addFields(
                    {
                        name: '📋 Première étape',
                        value: '• Lis le règlement\n• Présente-toi si tu le souhaites\n• Explore les différents channels',
                        inline: false,
                    },
                    {
                        name: '📊 Serveur',
                        value: `👥 **${interaction.guild.memberCount}** membres\n🎮 **${guildStreamers.length}** streamers suivis`,
                        inline: true,
                    }
                )
                .setFooter({
                    text: `Membre #${interaction.guild.memberCount} • Bienvenue ! [🧪 MODE TEST]`,
                    iconURL: interaction.guild.iconURL() || undefined,
                })
                .setTimestamp();

            // Envoyer le message de test
            await welcomeChannel.send({ 
                content: `🎊 Tout le monde, accueillez ${testMember.toString()} ! 🧪`, 
                embeds: [welcomeEmbed] 
            });

            // Confirmation pour l'admin
            const confirmEmbed = new EmbedBuilder()
                .setTitle('✅ Test réussi !')
                .setColor('Green')
                .setDescription(
                    `Message de bienvenue envoyé dans ${welcomeChannel.toString()}\n\n` +
                    `Le système fonctionne correctement ! 🎉`
                )
                .addFields(
                    { name: '👤 Utilisateur simulé', value: testUser.tag, inline: true },
                    { name: '📺 Channel', value: welcomeChannel.toString(), inline: true },
                    { name: '🎭 Rôle auto', value: client.config.autoRoleId ? '✅ Configuré' : '❌ Non configuré', inline: true },
                    { name: '🔔 Intention Discord', value: '✅ Server Members Intent activé', inline: false }
                )
                .setFooter({ text: 'Le système de bienvenue est opérationnel' })
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            if (client.logger) {
                client.logger.info(`✅ [testwelcome] Test réussi pour ${testUser.tag}`);
            }

            console.log(`✅ [testwelcome] Test réussi - Message envoyé dans ${welcomeChannel.name}`);

        } catch (error) {
            console.error(`❌ [testwelcome] Erreur:`, error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Erreur lors du test')
                .setColor('Red')
                .setDescription(`\`\`\`${error.message}\`\`\``)
                .addFields({
                    name: '📝 Stack trace',
                    value: `\`\`\`${error.stack?.substring(0, 1000) || 'Non disponible'}\`\`\``,
                    inline: false
                });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};