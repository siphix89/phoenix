const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setwelcome')
        .setDescription('⚙️ Configure le channel de bienvenue')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Le channel où envoyer les messages de bienvenue')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const channel = interaction.options.getChannel('channel');

        if (channel.type !== 0) {
            return interaction.editReply({
                content: '❌ Vous devez sélectionner un channel texte.'
            });
        }

        const botPermissions = channel.permissionsFor(interaction.guild.members.me);
        if (!botPermissions.has(['SendMessages', 'EmbedLinks'])) {
            return interaction.editReply({
                content: `❌ Le bot n'a pas les permissions nécessaires dans ${channel.toString()}\n\n` +
                        `Permissions requises:\n` +
                        `• Voir le salon\n` +
                        `• Envoyer des messages\n` +
                        `• Intégrer des liens`
            });
        }

        try {
            // ✅ Méthode 1: Mettre à jour le .env (recommandé)
            const envPath = path.join(__dirname, '..', '.env');
            
            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf8');
                
                // Vérifier si WELCOME_CHANNEL_ID existe déjà
                if (envContent.includes('WELCOME_CHANNEL_ID=')) {
                    // Remplacer la valeur existante
                    envContent = envContent.replace(
                        /WELCOME_CHANNEL_ID=.*/g,
                        `WELCOME_CHANNEL_ID=${channel.id}`
                    );
                } else {
                    // Ajouter la ligne
                    if (!envContent.endsWith('\n')) {
                        envContent += '\n';
                    }
                    envContent += `WELCOME_CHANNEL_ID=${channel.id}\n`;
                }
                
                fs.writeFileSync(envPath, envContent, 'utf8');
                
                // Mettre à jour la config en mémoire
                client.config.welcomeChannel = channel.id;
                
                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Channel de bienvenue configuré')
                    .setColor('Green')
                    .addFields(
                        { name: '📺 Channel', value: channel.toString(), inline: true },
                        { name: '🆔 ID', value: `\`${channel.id}\``, inline: true }
                    )
                    .setDescription(
                        `Les nouveaux membres recevront un message de bienvenue dans ${channel.toString()}\n\n` +
                        `⚠️ **Important:** Redémarrez le bot pour que les changements prennent effet.\n\n` +
                        `💡 Testez avec \`/testwelcome\` après le redémarrage.`
                    )
                    .setFooter({ text: 'Configuration enregistrée dans .env' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                if (client.logger) {
                    client.logger.info(`⚙️ ${interaction.user.tag} a configuré le channel de bienvenue: ${channel.name} (${channel.id})`);
                }

                console.log(`✅ [setwelcome] Channel configuré: ${channel.name} (${channel.id})`);
                console.log(`⚠️ [setwelcome] Redémarrage du bot nécessaire`);

            } else {
                return interaction.editReply({
                    content: `❌ Fichier .env non trouvé.\n\n` +
                            `Ajoutez manuellement dans votre .env:\n` +
                            `\`\`\`\nWELCOME_CHANNEL_ID=${channel.id}\n\`\`\`\n` +
                            `Puis redémarrez le bot.`
                });
            }

        } catch (error) {
            console.error(`❌ [setwelcome] Erreur:`, error);
            
            // Fallback: donner les instructions manuelles
            const fallbackEmbed = new EmbedBuilder()
                .setTitle('⚠️ Configuration manuelle requise')
                .setColor('Orange')
                .setDescription(
                    `Impossible de modifier automatiquement le .env.\n\n` +
                    `**Ajoutez cette ligne dans votre fichier .env:**\n` +
                    `\`\`\`\nWELCOME_CHANNEL_ID=${channel.id}\n\`\`\`\n` +
                    `Puis redémarrez le bot avec \`node bot.js\``
                )
                .addFields(
                    { name: '📺 Channel sélectionné', value: channel.toString(), inline: true },
                    { name: '🆔 ID à copier', value: `\`${channel.id}\``, inline: true }
                )
                .setFooter({ text: `Erreur: ${error.message}` });

            await interaction.editReply({ embeds: [fallbackEmbed] });
        }
    }
};
