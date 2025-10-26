const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-live-channels')
    .setDescription('Configure les channels de notification pour les streamers affiliés et non-affiliés')
    .addChannelOption(option =>
      option
        .setName('channel-affilie')
        .setDescription('Channel pour les streamers affiliés')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(option =>
      option
        .setName('channel-non-affilie')
        .setDescription('Channel pour les streamers non-affiliés')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, bot) {
    const affilieChannel = interaction.options.getChannel('channel-affilie');
    const nonAffilieChannel = interaction.options.getChannel('channel-non-affilie');

    // Au moins un channel doit être fourni
    if (!affilieChannel && !nonAffilieChannel) {
      return interaction.reply({
        content: '❌ Tu dois spécifier au moins un channel !',
        ephemeral: true
      });
    }

    try {
      // Récupérer la config actuelle
      const currentConfig = await bot.db.getGuildConfig(interaction.guildId);

      // Mettre à jour les channels
      if (affilieChannel) {
        await bot.db.setLiveChannel(interaction.guildId, 'affilie', affilieChannel.id);
      }
      
      if (nonAffilieChannel) {
        await bot.db.setLiveChannel(interaction.guildId, 'non_affilie', nonAffilieChannel.id);
      }

      // Message de confirmation
      let confirmMessage = '✅ **Channels de notification configurés :**\n\n';
      
      if (affilieChannel) {
        confirmMessage += `⭐ **Affiliés** : ${affilieChannel}\n`;
      } else if (currentConfig?.live_affilie_channel_id) {
        const existingChannel = interaction.guild.channels.cache.get(currentConfig.live_affilie_channel_id);
        confirmMessage += `⭐ **Affiliés** : ${existingChannel || 'Channel supprimé'} (inchangé)\n`;
      }
      
      if (nonAffilieChannel) {
        confirmMessage += `🌟 **Non-affiliés** : ${nonAffilieChannel}\n`;
      } else if (currentConfig?.live_non_affilie_channel_id) {
        const existingChannel = interaction.guild.channels.cache.get(currentConfig.live_non_affilie_channel_id);
        confirmMessage += `🌟 **Non-affiliés** : ${existingChannel || 'Channel supprimé'} (inchangé)\n`;
      }

      confirmMessage += '\n💡 *Si un channel n\'est pas configuré, le channel de notification général sera utilisé.*';

      await interaction.reply({
        content: confirmMessage,
        ephemeral: false
      });

      console.log(`✅ Channels live configurés sur ${interaction.guild.name} par ${interaction.user.username}`);
      
    } catch (error) {
      console.error('Erreur lors de la configuration des channels:', error);
      await interaction.reply({
        content: '❌ Erreur lors de la configuration des channels. Vérifie les logs.',
        ephemeral: true
      });
    }
  },
};