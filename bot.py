import discord
import os
from dotenv import load_dotenv
from discord.ext import commands
from keep_alive import keep_alive
load_dotenv()

print("Lancement du bot...")
bot = commands.Bot(command_prefix="!", intents=discord.Intents.all())

@bot.event
async def on_ready():
    print("bot allumé !")
    try:
       synced = await bot.tree.sync()
       print(f"commandes slash synchronisée : {len(synced)}")
    except Exception as e:
        print(e)


@bot.event
async def on_message(message):
    if message.author.bot:
        return
    
    if message.content.lower() == 'bonjours':
        channel = message.channel
        author = message.author
        await author.send("comment tu vas ?")

    if message.content.lower() == 'je viens d arrivé':
        welcome_channel = bot.get_channel(1399549708350918677)
        await welcome_channel.send("bienvenue à toi")

@bot.tree.command(name="affillié", description="affiche les affillié avec leur chaine")
async def test(interaction: discord.Interaction):
    embed = discord.Embed(
        title="affillié",
        description="voici la liste des affillié",
        color=discord.Color.blue()
    )
    embed.add_field(name="Rockets_TW", value="https://www.twitch.tv/rockets_tw", inline=False)
    embed.add_field(name="siphix89", value="https://www.twitch.tv/siphix89", inline=False)
    embed.set_footer(text="liste évolutive")
    await interaction.response.send_message(embed=embed)
    

@bot.tree.command(name="test", description="tester les embeds")
async def test(interaction: discord.Interaction):
    embed = discord.Embed(
        title="affillié",
        description="voici la liste des affillié",
        color=discord.Color.blue()
    )
    embed.add_field(name="t", value="logique", inline=False)
    embed.add_field(name="s", value="logique", inline=False)
    embed.set_footer(text="liste évolutive")
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="info", description="informé une personne")
async def info(interaction: discord.Interaction, membre: discord.Member):
    await interaction.response.send_message("info envoyer")
    await membre.send("pour rappel ce discord est la pour s'entraider, donc n oublie pas de faire ta presentation.  que les autres sachent a quoi s'attendre sur ta chaine")

@bot.tree.command(name="ban", description="Bannir une personne")
async def info(interaction: discord.Interaction, membre: discord.Member):
    await interaction.response.send_message("ban effectué")
    await membre.ban(reason="non respect du réglement")
    await membre.send("tu as été banni")
        
@bot.tree.command(name="nonaffillié", description="vous envoies la liste")
async def nonaffillié(interaction: discord.Interaction):
    await interaction.response.send_message("voici la liste des non affillié :https://www.twitch.tv/siphix89")

keep_alive()
bot.run(os.getenv('DISCORD_TOKEN'))