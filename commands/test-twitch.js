// ===== commands/test-twitch.js =====
const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test-twitch')
    .setDescription('Test la connexion et les fonctionnalités Twitch')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Nom d\'utilisateur Twitch à tester (optionnel)')
        .setRequired(false)
    ),

  async execute(interaction, bot) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({
        content: '❌ Permissions administrateur requises',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const testUsername = interaction.options.getString('username') || 'ninja';
    
    try {
      if (!bot.twitch) {
        throw new Error('TwitchManager non disponible');
      }

      // Tester l'initialisation du client
      let tokenStatus = '❌';
      try {
        await bot.twitch.ensureValidToken();
        tokenStatus = bot.twitch.accessToken ? '✅' : '❌';
      } catch (tokenError) {
        tokenStatus = `❌ (${tokenError.message})`;
      }

      // Tester la récupération d'informations utilisateur
      let userTest = '❌';
      let streamTest = '❌';
      let testDetails = 'Non testé';

      try {
        const userInfo = await bot.twitch.getUserInfo(testUsername);
        if (userInfo) {
          userTest = '✅';
          
          // Tester la vérification de stream
          const { isLive, streamInfo } = await bot.twitch.checkStreamStatus(testUsername);
          streamTest = '✅';
          testDetails = `**${userInfo.displayName}**\n• Live: ${isLive ? '🔴 Oui' : '⚫ Non'}\n• Followers: ${userInfo.followerCount?.toLocaleString() || 'N/A'}`;
          
          if (isLive && streamInfo) {
            testDetails += `\n• Viewers: ${streamInfo.viewerCount}\n• Jeu: ${streamInfo.game}`;
          }
        } else {
          userTest = '⚠️ (Utilisateur non trouvé)';
        }
      } catch (apiError) {
        userTest = `❌ (${apiError.message})`;
      }

      const embed = new EmbedBuilder()
        .setTitle('🧪 Test Twitch API')
        .setDescription('Résultats des tests de connectivité Twitch')
        .addFields(
          { name: '🔑 Token d\'accès', value: tokenStatus, inline: true },
          { name: '👤 Test utilisateur', value: userTest, inline: true },
          { name: '🔴 Test stream', value: streamTest, inline: true },
          { name: `📊 Détails (${testUsername})`, value: testDetails, inline: false }
        )
        .setColor(tokenStatus === '✅' && userTest === '✅' ? Colors.Green : Colors.Orange)
        .setFooter({ text: `Testé avec l'utilisateur: ${testUsername}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Erreur de test')
        .setDescription(`**Erreur lors du test:**\n\`\`\`${error.message}\`\`\``)
        .setColor(Colors.Red)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
