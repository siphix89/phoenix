import discord
from discord.ext import commands, tasks
import os
from dotenv import load_dotenv
import asyncio
import logging
from logging.handlers import RotatingFileHandler
import aiohttp
import sqlite3
import re
import datetime
from datetime import timezone, UTC
from typing import Dict, Optional, Any, List, Tuple, Union
from dataclasses import dataclass, field
import time
from collections import defaultdict
import json
import psutil
import hashlib
from enum import Enum
import signal
import sys
import threading
from flask import Flask, jsonify, request, render_template_string
from flask_cors import CORS
from keep_alive import keep_alive

# Essayer d'importer TwitchAPI
try:
    from twitchAPI.twitch import Twitch
    from twitchAPI.helper import first
    from twitchAPI.type import TwitchAPIException
    TWITCH_API_AVAILABLE = True
except ImportError:
    TWITCH_API_AVAILABLE = False
    print("⚠️ TwitchAPI non installé. Exécutez: pip install twitchAPI")

# Charger les variables d'environnement
load_dotenv()

# ==================== DÉTECTION ENVIRONNEMENT ====================
def is_production_environment():
    """Détecter si on est dans un environnement de production"""
    return any([
        os.getenv('RENDER'),
        os.getenv('HEROKU'),
        os.getenv('RAILWAY_ENVIRONMENT'),
        os.getenv('VERCEL'),
        os.getenv('NODE_ENV') == 'production',
        os.getenv('ENVIRONMENT') == 'production',
        not (hasattr(sys.stdin, 'isatty') and sys.stdin.isatty())
    ])

IS_PRODUCTION = is_production_environment()

# ==================== CONFIGURATION LOGGING ====================
def setup_logging():
    """Configure le système de logging avancé avec rotation"""
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    # Handler pour la console
    console_handler = logging.StreamHandler()
    console_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(console_formatter)
    
    # Handler pour fichier avec rotation (10MB, garder 5 fichiers)
    file_handler = RotatingFileHandler(
        'bot.log', maxBytes=10*1024*1024, backupCount=5, encoding='utf-8'
    )
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
    )
    file_handler.setFormatter(file_formatter)
    
    # Handler pour les erreurs
    error_handler = RotatingFileHandler(
        'bot_errors.log', maxBytes=5*1024*1024, backupCount=3, encoding='utf-8'
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(file_formatter)
    
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
    logger.addHandler(error_handler)
    
    return logger

logger = setup_logging()

# ==================== ÉNUMÉRATIONS ET CONSTANTES ====================
class StreamerStatus(Enum):
    AFFILIE = "affilie"
    NON_AFFILIE = "non_affilie"

class ErrorType(Enum):
    API_ERROR = "api_error"
    DATABASE_ERROR = "database_error"
    PERMISSION_ERROR = "permission_error"
    VALIDATION_ERROR = "validation_error"
    RATE_LIMIT_ERROR = "rate_limit_error"

class HealthStatus(Enum):
    HEALTHY = "healthy"
    WARNING = "warning" 
    UNHEALTHY = "unhealthy"
    ERROR = "error"

# ==================== CLASSES DE CONFIGURATION ====================
@dataclass
class BotConfig:
    """Configuration complète du bot avec système de rôle"""
    # Paramètres principaux
    discord_token: str
    command_prefix: str = "!"
    
    # Channels (simplifié)
    live_affilie_channel: int = 0
    live_non_affilie_channel: int = 0
    welcome_channel: int = 0
    logs_channel: int = 0
    
    # API Twitch
    twitch_client_id: str = ""
    twitch_client_secret: str = ""
    
    # Système de rôle de règlement
    rules_role_id: int = 0
    rules_role_name: str = ""
    
    # Fonctionnalités
    auto_notifications: bool = True
    notification_interval_minutes: int = 2
    
    @classmethod
    def from_env(cls) -> 'BotConfig':
        """Charger la configuration depuis l'environnement"""
        return cls(
            discord_token=os.getenv('DISCORD_TOKEN', ''),
            command_prefix=os.getenv('COMMAND_PREFIX', '!'),
            live_affilie_channel=int(os.getenv('CHANNEL_LIVE_AFFILIE', '0')),
            live_non_affilie_channel=int(os.getenv('CHANNEL_LIVE_NON_AFFILIE', '0')),
            welcome_channel=int(os.getenv('CHANNEL_WELCOME', '0')),
            logs_channel=int(os.getenv('CHANNEL_LOGS', '0')),
            twitch_client_id=os.getenv('TWITCH_CLIENT_ID', ''),
            twitch_client_secret=os.getenv('TWITCH_CLIENT_SECRET', ''),
            # Système de rôle de règlement
            rules_role_id=int(os.getenv('RULES_ROLE_ID', '0')),
            rules_role_name=os.getenv('RULES_ROLE_NAME', 'Membre Vérifié'),
            auto_notifications=os.getenv('AUTO_NOTIFICATIONS', 'true').lower() == 'true',
            notification_interval_minutes=int(os.getenv('NOTIFICATION_INTERVAL', '2'))
        )
    
    def validate(self) -> Dict[str, str]:
        """Valider la configuration"""
        errors = {}
        
        if not self.discord_token:
            errors['discord_token'] = "Token Discord requis"
        
        if self.live_affilie_channel == 0:
            errors['live_affilie_channel'] = "ID du channel live affilié requis"
        
        if self.live_non_affilie_channel == 0:
            errors['live_non_affilie_channel'] = "ID du channel live non-affilié requis"
        
        return errors

# ==================== MODÈLES DE DONNÉES ====================
@dataclass
class StreamerData:
    name: str
    url: str
    status: StreamerStatus
    description: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    followers: int = 0
    total_streams: int = 0
    total_hours: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'name': self.name,
            'url': self.url,
            'status': self.status.value,
            'description': self.description,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'followers': self.followers,
            'total_streams': self.total_streams,
            'total_hours': self.total_hours
        }

@dataclass 
class StreamInfo:
    title: str
    game: str
    viewer_count: int
    started_at: datetime.datetime
    thumbnail_url: str = ""

@dataclass
class BotMetrics:
    start_time: datetime.datetime
    commands_executed: int = 0
    notifications_sent: int = 0
    errors_encountered: int = 0
    unique_users_served: set = field(default_factory=set)
    most_used_commands: Dict[str, int] = field(default_factory=dict)
    
    def record_command(self, command_name: str, user_id: int):
        self.commands_executed += 1
        self.unique_users_served.add(user_id)
        self.most_used_commands[command_name] = self.most_used_commands.get(command_name, 0) + 1

# ==================== VUE POUR LE BOUTON DE RÔLE ====================
class RuleAcceptanceView(discord.ui.View):
    def __init__(self, role_id: int, role_name: str):
        super().__init__(timeout=None)  # Pas de timeout pour un bouton permanent
        self.role_id = role_id
        self.role_name = role_name
    
    @discord.ui.button(
        label="✅ J'accepte le règlement", 
        style=discord.ButtonStyle.green,
        emoji="📋",
        custom_id="accept_rules_button"
    )
    async def accept_rules(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Bouton pour accepter le règlement et recevoir le rôle"""
        try:
            # Récupérer le rôle
            role = interaction.guild.get_role(self.role_id)
            
            if not role:
                embed = discord.Embed(
                    title="❌ Erreur",
                    description="Le rôle configuré est introuvable. Contactez un administrateur.",
                    color=discord.Color.red()
                )
                await interaction.response.send_message(embed=embed, ephemeral=True)
                return
            
            # Vérifier si l'utilisateur a déjà le rôle
            if role in interaction.user.roles:
                embed = discord.Embed(
                    title="ℹ️ Déjà possédé",
                    description=f"Vous avez déjà le rôle **{role.name}** !",
                    color=discord.Color.blue()
                )
                await interaction.response.send_message(embed=embed, ephemeral=True)
                return
            
            # Accorder le rôle
            await interaction.user.add_roles(role, reason="Acceptation du règlement")
            
            # Message de confirmation
            embed = discord.Embed(
                title="✅ Règlement accepté",
                description=f"Félicitations ! Vous avez reçu le rôle **{role.name}** 🎉\n\nMerci d'avoir lu et accepté notre règlement !",
                color=discord.Color.green()
            )
            
            embed.add_field(
                name="🎯 Que faire maintenant ?",
                value="• Explorez les différents channels\n• Présentez-vous si vous le souhaitez\n• Rejoignez notre communauté !",
                inline=False
            )
            
            await interaction.response.send_message(embed=embed, ephemeral=True)
            
            # Log de l'événement
            logger.info(f"✅ Rôle '{role.name}' accordé à {interaction.user.name} ({interaction.user.id}) via bouton de règlement")
            
        except discord.Forbidden:
            embed = discord.Embed(
                title="❌ Permissions insuffisantes",
                description="Le bot n'a pas les permissions pour accorder ce rôle. Contactez un administrateur.",
                color=discord.Color.red()
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            logger.error(f"❌ Permissions insuffisantes pour accorder le rôle {self.role_name} à {interaction.user.name}")
        
        except Exception as e:
            embed = discord.Embed(
                title="❌ Erreur inattendue",
                description="Une erreur s'est produite. Contactez un administrateur.",
                color=discord.Color.red()
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)
            logger.error(f"❌ Erreur lors de l'attribution du rôle: {e}")

# ==================== BASE DE DONNÉES ====================
class DatabaseManager:
    def __init__(self, db_path: str = "streamers.db"):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Initialiser la base de données SQLite"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS streamers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        url TEXT UNIQUE NOT NULL,
                        status TEXT NOT NULL CHECK(status IN ('affilie', 'non_affilie')),
                        description TEXT NOT NULL,
                        followers INTEGER DEFAULT 0,
                        total_streams INTEGER DEFAULT 0,
                        total_hours REAL DEFAULT 0.0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS stream_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        streamer_name TEXT NOT NULL,
                        started_at TIMESTAMP NOT NULL,
                        ended_at TIMESTAMP,
                        max_viewers INTEGER DEFAULT 0,
                        game TEXT,
                        title TEXT,
                        FOREIGN KEY (streamer_name) REFERENCES streamers(name)
                    )
                """)
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS rules_sections (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        section_key TEXT UNIQUE NOT NULL,
                        section_title TEXT NOT NULL,
                        section_content TEXT NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_by TEXT
                    )
                """)
                
                conn.commit()
                logger.info("✅ Base de données initialisée avec succès")
                
        except Exception as e:
            logger.error(f"❌ Échec de l'initialisation de la base de données: {e}")
            raise
    
    def add_streamer(self, name: str, url: str, status: str, description: str) -> bool:
        """Ajouter un nouveau streamer"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT INTO streamers (name, url, status, description)
                    VALUES (?, ?, ?, ?)
                """, (name, url, status.lower(), description))
                conn.commit()
                logger.info(f"✅ Streamer {name} ajouté")
                return True
        except sqlite3.IntegrityError:
            logger.warning(f"⚠️ Le streamer {name} existe déjà")
            return False
        except Exception as e:
            logger.error(f"❌ Erreur lors de l'ajout du streamer {name}: {e}")
            return False
    
    def get_all_streamers(self) -> List[StreamerData]:
        """Récupérer tous les streamers"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("SELECT * FROM streamers ORDER BY name")
                
                streamers = []
                for row in cursor.fetchall():
                    streamers.append(StreamerData(
                        name=row['name'],
                        url=row['url'],
                        status=StreamerStatus(row['status']),
                        description=row['description'],
                        created_at=datetime.datetime.fromisoformat(row['created_at']),
                        updated_at=datetime.datetime.fromisoformat(row['updated_at']),
                        followers=row['followers'],
                        total_streams=row['total_streams'],
                        total_hours=row['total_hours']
                    ))
                
                return streamers
        except Exception as e:
            logger.error(f"❌ Erreur lors de la récupération des streamers: {e}")
            return []
    
    def remove_streamer(self, name: str) -> bool:
        """Supprimer un streamer"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("DELETE FROM streamers WHERE name = ?", (name,))
                if cursor.rowcount > 0:
                    conn.commit()
                    logger.info(f"✅ Streamer {name} supprimé")
                    return True
                return False
        except Exception as e:
            logger.error(f"❌ Erreur lors de la suppression du streamer {name}: {e}")
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Récupérer les statistiques de base"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                
                cursor = conn.execute("SELECT COUNT(*) as total FROM streamers")
                total_streamers = cursor.fetchone()['total']
                
                cursor = conn.execute("SELECT COUNT(*) as count FROM streamers WHERE status = 'affilie'")
                affilies = cursor.fetchone()['count']
                
                cursor = conn.execute("SELECT COUNT(*) as count FROM streamers WHERE status = 'non_affilie'")
                non_affilies = cursor.fetchone()['count']
                
                return {
                    'total_streamers': total_streamers,
                    'affilies': affilies,
                    'non_affilies': non_affilies,
                    'affiliation_rate': round((affilies / total_streamers * 100) if total_streamers > 0 else 0, 1)
                }
        except Exception as e:
            logger.error(f"❌ Erreur lors de la récupération des stats: {e}")
            return {'total_streamers': 0, 'affilies': 0, 'non_affilies': 0, 'affiliation_rate': 0}

# ==================== GESTIONNAIRE TWITCH ====================
class TwitchManager:
    def __init__(self, config: BotConfig):
        self.config = config
        self.client: Optional[Twitch] = None
    
    async def init_client(self) -> bool:
        """Initialiser le client API Twitch"""
        if not self.config.twitch_client_id or not TWITCH_API_AVAILABLE:
            logger.warning("⚠️ API Twitch non disponible")
            return False
        
        try:
            self.client = await Twitch(self.config.twitch_client_id, self.config.twitch_client_secret)
            logger.info("✅ API Twitch initialisée")
            return True
        except Exception as e:
            logger.error(f"❌ Échec de l'API Twitch: {e}")
            return False
    
    async def check_stream_status(self, username: str) -> Tuple[bool, Optional[StreamInfo]]:
        """Vérifier si un streamer est en live"""
        # Essayer l'API d'abord
        if self.client:
            try:
                users_gen = self.client.get_users(logins=[username])
                user_info = await first(users_gen)
                
                if not user_info:
                    return False, None

                streams_gen = self.client.get_streams(user_id=[user_info.id])
                stream = await first(streams_gen)
                
                if not stream:
                    return False, None

                stream_info = StreamInfo(
                    title=stream.title,
                    game=stream.game_name or "Inconnu",
                    viewer_count=stream.viewer_count,
                    started_at=stream.started_at,
                    thumbnail_url=stream.thumbnail_url.format(width=320, height=180) if stream.thumbnail_url else ""
                )
                
                return True, stream_info
                
            except Exception as e:
                logger.error(f"Erreur API Twitch pour {username}: {e}")
        
        # Solution de repli par scraping
        try:
            url = f"https://www.twitch.tv/{username}"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        content = await response.text()
                        is_live = '"isLiveBroadcast":true' in content or 'isLive":true' in content
                        return is_live, None
                    return False, None
        except Exception as e:
            logger.error(f"Erreur de scraping pour {username}: {e}")
            return False, None

# ==================== SERVEUR WEB FLASK ====================
class WebServer:
    def __init__(self, bot_instance):
        self.bot = bot_instance
        self.app = Flask(__name__)
        CORS(self.app)
        
        self.app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'dev-key-change-in-production')
        self.app.config['JSON_AS_ASCII'] = False
        
        self.setup_routes()
        self.server_thread = None
    
    def setup_routes(self):
        @self.app.route('/')
        def index():
            return """<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bot Discord Streamer - Panneau Admin</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: rgba(255, 255, 255, 0.95); 
            padding: 30px; 
            border-radius: 15px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        .header { 
            text-align: center; 
            color: #7289da; 
            margin-bottom: 30px; 
            border-bottom: 3px solid #7289da;
            padding-bottom: 20px;
        }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .status { 
            padding: 15px; 
            border-radius: 10px; 
            margin: 15px 0; 
            text-align: center; 
            font-weight: bold;
            font-size: 1.1em;
            transition: all 0.3s ease;
        }
        .online { 
            background: linear-gradient(135deg, #4CAF50, #45a049); 
            color: white; 
            box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
        }
        .offline { 
            background: linear-gradient(135deg, #f44336, #da190b); 
            color: white; 
            box-shadow: 0 4px 15px rgba(244, 67, 54, 0.3);
        }
        .grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); 
            gap: 25px; 
            margin-top: 30px;
        }
        .card { 
            background: linear-gradient(135deg, #f8f9fa, #e9ecef); 
            padding: 25px; 
            border-radius: 12px; 
            border: 1px solid #dee2e6; 
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 35px rgba(0,0,0,0.15);
        }
        .card h3 { 
            color: #495057; 
            margin-bottom: 20px; 
            font-size: 1.3em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .btn { 
            padding: 12px 20px; 
            background: linear-gradient(135deg, #7289da, #5865f2); 
            color: white; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            margin: 8px; 
            text-decoration: none;
            display: inline-block;
            font-weight: 600;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(114, 137, 218, 0.3);
        }
        .btn:hover { 
            background: linear-gradient(135deg, #5865f2, #4752c4); 
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(114, 137, 218, 0.4);
        }
        .btn-success {
            background: linear-gradient(135deg, #28a745, #20c997);
            box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);
        }
        .btn-success:hover {
            background: linear-gradient(135deg, #20c997, #17a2b8);
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #495057;
            font-weight: 600;
        }
        .form-control {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
            background: white;
        }
        .form-control:focus {
            outline: none;
            border-color: #7289da;
            box-shadow: 0 0 0 3px rgba(114, 137, 218, 0.1);
        }
        select.form-control {
            cursor: pointer;
        }
        textarea.form-control {
            resize: vertical;
            min-height: 80px;
        }
        .alert {
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            font-weight: 500;
            display: none;
        }
        .alert-success {
            background: linear-gradient(135deg, #d4edda, #c3e6cb);
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .alert-danger {
            background: linear-gradient(135deg, #f8d7da, #f1b0b7);
            color: #721c24;
            border: 1px solid #f1b0b7;
        }
        @media (max-width: 768px) {
            .container { padding: 20px; }
            .grid { grid-template-columns: 1fr; }
            .header h1 { font-size: 2em; }
        }
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #7289da;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-left: 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Bot Discord Streamer</h1>
            <p>Interface d'administration complète avec système de rôle</p>
        </div>
        
        <div id="status" class="status">🔄 Vérification du statut...</div>
        
        <div class="grid">
            <div class="card">
                <h3>📊 Statistiques</h3>
                <div id="stats">Chargement...</div>
            </div>
            
            <div class="card">
                <h3>🔗 API & Outils</h3>
                <a href="/api/stats" target="_blank" class="btn">📊 Stats JSON</a>
                <a href="/api/streamers" target="_blank" class="btn">👥 Streamers JSON</a>
                <a href="/api/health" target="_blank" class="btn">💚 Santé API</a>
                <button onclick="forceCheck()" class="btn btn-success">🔍 Vérifier Lives</button>
            </div>
            
            <div class="card" style="grid-column: 1 / -1;">
                <h3>➕ Ajouter un Streamer</h3>
                <div id="add-alert" class="alert"></div>
                
                <form id="addStreamerForm">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
                        <div class="form-group">
                            <label for="streamerName">📝 Nom du Streamer *</label>
                            <input type="text" id="streamerName" name="name" class="form-control" 
                                   placeholder="Ex: MonStreamer_FR" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="streamerUrl">🔗 URL Twitch *</label>
                            <input type="url" id="streamerUrl" name="url" class="form-control" 
                                   placeholder="https://www.twitch.tv/username" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="streamerStatus">⭐ Statut *</label>
                            <select id="streamerStatus" name="status" class="form-control" required>
                                <option value="">-- Choisir un statut --</option>
                                <option value="affilie">⭐ Affilié</option>
                                <option value="non_affilie">💫 Non-Affilié</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="streamerDescription">💬 Description</label>
                        <textarea id="streamerDescription" name="description" class="form-control" 
                                  placeholder="Décrivez le streamer et son contenu..." maxlength="500"></textarea>
                        <small style="color: #6c757d;">Caractères restants: <span id="charCount">500</span></small>
                    </div>
                    
                    <button type="submit" class="btn btn-success" style="font-size: 1.1em; padding: 15px 30px;">
                        ➕ Ajouter le Streamer
                    </button>
                </form>
            </div>
            
            <div class="card" style="grid-column: 1 / -1;">
                <h3>👥 Liste des Streamers</h3>
                <div id="streamersList">Chargement de la liste...</div>
            </div>
        </div>
    </div>
    
    <script>
        function showAlert(message, type = 'success') {
            const alert = document.getElementById('add-alert');
            alert.className = `alert alert-${type}`;
            alert.innerHTML = message;
            alert.style.display = 'block';
            setTimeout(() => { alert.style.display = 'none'; }, 5000);
        }
        
        function formatDate(dateString) {
            return new Date(dateString).toLocaleDateString('fr-FR', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }
        
        document.getElementById('streamerDescription').addEventListener('input', function() {
            const remaining = 500 - this.value.length;
            document.getElementById('charCount').textContent = remaining;
            document.getElementById('charCount').style.color = remaining < 50 ? '#dc3545' : '#6c757d';
        });
        
        document.getElementById('addStreamerForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            const data = {
                name: formData.get('name').trim(),
                url: formData.get('url').trim(),
                status: formData.get('status'),
                description: formData.get('description').trim() || 'Nouveau streamer'
            };
            
            if (!data.name || !data.url || !data.status) {
                showAlert('❌ Veuillez remplir tous les champs obligatoires', 'danger');
                return;
            }
            
            const submitBtn = this.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '⏳ Ajout en cours... <span class="spinner"></span>';
            submitBtn.disabled = true;
            
            try {
                const response = await fetch('/api/add-streamer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showAlert(`✅ ${data.name} a été ajouté avec succès !`, 'success');
                    this.reset();
                    document.getElementById('charCount').textContent = '500';
                    loadStreamers();
                    loadStats();
                } else {
                    showAlert(`❌ ${result.error || 'Erreur lors de l\\'ajout'}`, 'danger');
                }
            } catch (error) {
                console.error('Erreur:', error);
                showAlert('❌ Erreur de connexion au serveur', 'danger');
            } finally {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        });
        
        async function loadStatus() {
            try {
                const response = await fetch('/api/health');
                const data = await response.json();
                const statusDiv = document.getElementById('status');
                
                if (data.bot_online) {
                    statusDiv.className = 'status online';
                    statusDiv.innerHTML = '✅ Bot en ligne - Uptime: ' + data.uptime;
                } else {
                    statusDiv.className = 'status offline';
                    statusDiv.innerHTML = '❌ Bot hors ligne';
                }
            } catch (error) {
                document.getElementById('status').innerHTML = '⚠️ Erreur de connexion';
                document.getElementById('status').className = 'status offline';
            }
        }
        
        async function loadStats() {
            try {
                const response = await fetch('/api/stats');
                const data = await response.json();
                
                if (data.success) {
                    const stats = data.data.streamer_stats;
                    const liveStats = data.data.live_stats;
                    
                    document.getElementById('stats').innerHTML = `
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; text-align: center;">
                            <div style="background: #e3f2fd; padding: 15px; border-radius: 8px;">
                                <div style="font-size: 1.8em; font-weight: bold; color: #1976d2;">${stats.total_streamers}</div>
                                <div style="color: #666; font-size: 0.9em;">Total</div>
                            </div>
                            <div style="background: #f3e5f5; padding: 15px; border-radius: 8px;">
                                <div style="font-size: 1.8em; font-weight: bold; color: #7b1fa2;">${stats.affilies}</div>
                                <div style="color: #666; font-size: 0.9em;">Affiliés</div>
                            </div>
                            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
                                <div style="font-size: 1.8em; font-weight: bold; color: #388e3c;">${stats.non_affilies}</div>
                                <div style="color: #666; font-size: 0.9em;">Non-Affiliés</div>
                            </div>
                            <div style="background: #ffebee; padding: 15px; border-radius: 8px;">
                                <div style="font-size: 1.8em; font-weight: bold; color: #d32f2f;">${liveStats.live_streamers}</div>
                                <div style="color: #666; font-size: 0.9em;">En Live</div>
                            </div>
                        </div>
                        ${stats.affiliation_rate ? `<p style="text-align: center; margin-top: 15px; color: #666;">Taux d'affiliation: <strong>${stats.affiliation_rate}%</strong></p>` : ''}
                    `;
                }
            } catch (error) {
                document.getElementById('stats').innerHTML = 'Erreur de chargement des statistiques';
            }
        }
        
        async function loadStreamers() {
            try {
                const response = await fetch('/api/streamers');
                const data = await response.json();
                
                if (data.success && data.data.length > 0) {
                    const streamersHtml = data.data.map(streamer => `
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid ${streamer.status === 'affilie' ? '#7b1fa2' : '#1976d2'};">
                            <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 200px;">
                                    <h4 style="margin: 0 0 8px 0; color: #333;">
                                        ${streamer.status === 'affilie' ? '⭐' : '💫'} ${streamer.name}
                                    </h4>
                                    <p style="margin: 5px 0; color: #666; font-size: 0.9em;">${streamer.description}</p>
                                    <a href="${streamer.url}" target="_blank" style="color: #7289da; text-decoration: none; font-size: 0.9em;">🔗 ${streamer.url}</a>
                                </div>
                                <div style="text-align: right; min-width: 120px; margin-left: 15px;">
                                    <span style="background: ${streamer.status === 'affilie' ? '#7b1fa2' : '#1976d2'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8em;">
                                        ${streamer.status === 'affilie' ? 'AFFILIÉ' : 'NON-AFFILIÉ'}
                                    </span>
                                    <div style="font-size: 0.8em; color: #999; margin-top: 5px;">
                                        Ajouté le ${formatDate(streamer.created_at)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('');
                    
                    document.getElementById('streamersList').innerHTML = streamersHtml;
                } else {
                    document.getElementById('streamersList').innerHTML = '<p style="text-align: center; color: #666; font-style: italic;">Aucun streamer ajouté pour le moment</p>';
                }
            } catch (error) {
                document.getElementById('streamersList').innerHTML = '<p style="color: #dc3545;">Erreur lors du chargement de la liste</p>';
            }
        }
        
        async function forceCheck() {
            const btn = event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '🔄 Vérification... <span class="spinner"></span>';
            btn.disabled = true;
            
            try {
                const response = await fetch('/api/force-check', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    showAlert('✅ Vérification des lives effectuée !', 'success');
                    loadStats();
                } else {
                    showAlert('❌ Erreur lors de la vérification', 'danger');
                }
            } catch (error) {
                showAlert('❌ Erreur de connexion', 'danger');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
        
        loadStatus();
        loadStats();
        loadStreamers();
        setInterval(loadStatus, 30000);
        setInterval(loadStats, 60000);
    </script>
</body>
</html>"""
        
        @self.app.route('/api/health')
        def health_check():
            return jsonify({
                'status': 'healthy',
                'bot_online': self.bot.is_ready() if hasattr(self.bot, 'is_ready') else False,
                'timestamp': datetime.datetime.now(UTC).isoformat(),
                'uptime': str(datetime.datetime.now(UTC) - self.bot.metrics.start_time) if hasattr(self.bot, 'metrics') else 'Inconnu'
            })
        
        @self.app.route('/api/stats')
        def get_stats():
            try:
                db_stats = self.bot.db.get_stats()
                
                return jsonify({
                    'success': True,
                    'data': {
                        'bot_stats': {
                            'is_online': self.bot.is_ready() if hasattr(self.bot, 'is_ready') else False,
                            'guilds': len(self.bot.guilds) if hasattr(self.bot, 'guilds') else 0,
                            'uptime': str(datetime.datetime.now(UTC) - self.bot.metrics.start_time) if hasattr(self.bot, 'metrics') else 'Inconnu',
                        },
                        'streamer_stats': db_stats,
                        'live_stats': {
                            'live_streamers': len(self.bot.live_streamers) if hasattr(self.bot, 'live_streamers') else 0,
                            'live_list': list(self.bot.live_streamers.keys()) if hasattr(self.bot, 'live_streamers') else []
                        }
                    }
                })
            except Exception as e:
                return jsonify({'success': False, 'error': str(e)}), 500
        
        @self.app.route('/api/streamers')
        def get_streamers():
            try:
                streamers = self.bot.db.get_all_streamers()
                streamers_data = [s.to_dict() for s in streamers]
                return jsonify({'success': True, 'data': streamers_data})
            except Exception as e:
                return jsonify({'success': False, 'error': str(e)}), 500
        
        @self.app.route('/api/add-streamer', methods=['POST'])
        def add_streamer_api():
            try:
                data = request.get_json()
                
                if not data:
                    return jsonify({'success': False, 'error': 'Aucune donnée reçue'}), 400
                
                name = data.get('name', '').strip()
                url = data.get('url', '').strip()
                status = data.get('status', '').strip().lower()
                description = data.get('description', 'Nouveau streamer').strip()
                
                if not name:
                    return jsonify({'success': False, 'error': 'Le nom du streamer est requis'}), 400
                
                if not url:
                    return jsonify({'success': False, 'error': 'L\'URL Twitch est requise'}), 400
                
                if status not in ['affilie', 'non_affilie']:
                    return jsonify({'success': False, 'error': 'Statut invalide'}), 400
                
                if not self.bot.validate_twitch_url(url):
                    return jsonify({'success': False, 'error': 'URL Twitch invalide'}), 400
                
                if len(description) > 500:
                    description = description[:500]
                
                success = self.bot.db.add_streamer(name, url, status, description)
                
                if success:
                    logger.info(f"✅ Streamer {name} ajouté via interface web")
                    return jsonify({
                        'success': True, 
                        'message': f'Streamer {name} ajouté avec succès',
                        'data': {'name': name, 'url': url, 'status': status, 'description': description}
                    })
                else:
                    return jsonify({'success': False, 'error': f'Le streamer {name} existe déjà'}), 409
                
            except Exception as e:
                logger.error(f"❌ Erreur API add-streamer: {e}")
                return jsonify({'success': False, 'error': f'Erreur serveur: {str(e)}'}), 500
        
        @self.app.route('/api/force-check', methods=['POST'])
        def force_live_check():
            try:
                def run_check():
                    try:
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        
                        if hasattr(self.bot, 'check_streamers_live'):
                            loop.run_until_complete(self.bot.check_streamers_live())
                        
                        loop.close()
                        logger.info("🔍 Vérification forcée des lives terminée via interface web")
                    except Exception as e:
                        logger.error(f"❌ Erreur lors de la vérification forcée: {e}")
                
                threading.Thread(target=run_check, daemon=True).start()
                return jsonify({'success': True, 'message': 'Vérification des lives lancée'})
                
            except Exception as e:
                logger.error(f"❌ Erreur API force-check: {e}")
                return jsonify({'success': False, 'error': f'Erreur serveur: {str(e)}'}), 500
    
    def start_server(self, host='127.0.0.1', port=5000, debug=False):
        def run_server():
            try:
                logger.info(f"🌐 Démarrage du serveur web sur http://{host}:{port}")
                self.app.run(host=host, port=port, debug=debug, use_reloader=False, threaded=True)
            except Exception as e:
                logger.error(f"❌ Erreur du serveur web: {e}")
        
        self.server_thread = threading.Thread(target=run_server, daemon=True)
        self.server_thread.start()
        logger.info("✅ Serveur web démarré en arrière-plan")
    
    def stop_server(self):
        logger.info("🛑 Arrêt du serveur web...")

# ==================== CLASSE PRINCIPALE DU BOT ====================
class StreamerBot(commands.Bot):
    def __init__(self, config: BotConfig):
        intents = discord.Intents.all()
        super().__init__(command_prefix=config.command_prefix, intents=intents)
        
        self.config = config
        self.db = DatabaseManager()
        self.twitch = TwitchManager(config)
        self.live_streamers: Dict[str, bool] = {}
        self.live_messages: Dict[str, int] = {}
        self.metrics = BotMetrics(start_time=datetime.datetime.now(UTC))
        
        # Serveur web
        self.web_server = None
    
    def validate_twitch_url(self, url: str) -> bool:
        """Valider une URL Twitch"""
        pattern = r'^https://www\.twitch\.tv/[a-zA-Z0-9_]{4,25}$'
        return bool(re.match(pattern, url))
    
    def is_admin(self, user: discord.Member) -> bool:
        return user.guild_permissions.administrator
    
    def is_moderator(self, user: discord.Member) -> bool:
        return user.guild_permissions.manage_messages or self.is_admin(user)
    
    async def setup_hook(self):
        """Hook de configuration appelé au démarrage du bot"""
        await self.twitch.init_client()
        
        # Ajouter la vue persistante pour les boutons de règlement
        if self.config.rules_role_id != 0:
            self.add_view(RuleAcceptanceView(self.config.rules_role_id, self.config.rules_role_name))
        
        # Démarrer le serveur web
        self.web_server = WebServer(self)
        
        # Configuration du serveur web depuis les variables d'environnement  
        if os.getenv('RENDER'):
            # Configuration spéciale pour Render
            web_host = '0.0.0.0'  # Obligatoire pour Render
            web_port = int(os.getenv('PORT', '10000'))  # Render définit PORT automatiquement
        else:
            web_host = os.getenv('WEB_HOST', '127.0.0.1')
            web_port = int(os.getenv('WEB_PORT', '5000'))
        
        web_debug = os.getenv('WEB_DEBUG', 'false').lower() == 'true'
        
        self.web_server.start_server(host=web_host, port=web_port, debug=web_debug)
        
        logger.info("🤖 Configuration du bot terminée avec serveur web et système de rôle")
    
    async def close(self):
        """Surcharger la méthode close pour arrêter le serveur web"""
        if self.web_server:
            self.web_server.stop_server()
        await super().close()
    
    async def check_streamers_live(self):
        """Méthode pour vérifier manuellement les streamers en live (utilisée par l'interface web)"""
        try:
            logger.info("🔍 Vérification manuelle des streamers en live...")
            
            streamers = self.db.get_all_streamers()
            live_found = 0
            
            for streamer in streamers:
                try:
                    twitch_name = streamer.url.split("/")[-1]
                    is_live, stream_info = await self.twitch.check_stream_status(twitch_name)
                    
                    if is_live and streamer.name not in self.live_streamers:
                        # Stream commencé
                        await send_live_notification(streamer, stream_info)
                        self.live_streamers[streamer.name] = True
                        live_found += 1
                        logger.info(f"🔴 {streamer.name} détecté en live")
                        
                    elif not is_live and streamer.name in self.live_streamers:
                        # Stream terminé
                        await remove_live_notification(streamer.name)
                        self.live_streamers.pop(streamer.name, None)
                        logger.info(f"⚫ {streamer.name} n'est plus en live")
                        
                except Exception as e:
                    logger.error(f"Erreur lors de la vérification de {streamer.name}: {e}")
            
            logger.info(f"✅ Vérification terminée - {live_found} nouveaux lives détectés")
            return True
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de la vérification manuelle: {e}")
            return False

# Créer l'instance du bot
config = BotConfig.from_env()
bot = StreamerBot(config)

# ==================== SYSTÈME DE NOTIFICATIONS LIVE ====================
@tasks.loop(minutes=2)
async def check_streamers_live():
    """Vérifier les streamers en live"""
    if not bot.is_ready():
        return
    
    logger.info("🔍 Vérification des streamers en live...")
    
    streamers = bot.db.get_all_streamers()
    
    for streamer in streamers:
        try:
            twitch_name = streamer.url.split("/")[-1]
            is_live, stream_info = await bot.twitch.check_stream_status(twitch_name)
            
            if is_live and streamer.name not in bot.live_streamers:
                # Stream commencé
                await send_live_notification(streamer, stream_info)
                bot.live_streamers[streamer.name] = True
                
            elif not is_live and streamer.name in bot.live_streamers:
                # Stream terminé
                await remove_live_notification(streamer.name)
                bot.live_streamers.pop(streamer.name, None)
                
        except Exception as e:
            logger.error(f"Erreur lors de la vérification de {streamer.name}: {e}")

async def send_live_notification(streamer: StreamerData, stream_info: Optional[StreamInfo]):
    """Envoyer une notification de live"""
    try:
        if streamer.status == StreamerStatus.AFFILIE:
            channel_id = bot.config.live_affilie_channel
            ping_message = "@everyone"
            color = discord.Color.purple()
        else:
            channel_id = bot.config.live_non_affilie_channel
            ping_message = "@here"
            color = discord.Color.blue()
        
        channel = bot.get_channel(channel_id)
        if not channel:
            logger.error(f"Channel {channel_id} non trouvé!")
            return
        
        embed = discord.Embed(
            title="🔴 STREAM EN DIRECT !",
            description=f"**{streamer.name}** vient de commencer son stream !",
            color=color,
            url=streamer.url
        )
        
        if stream_info:
            title = stream_info.title[:100] + "..." if len(stream_info.title) > 100 else stream_info.title
            embed.add_field(name="🎮 Titre", value=title, inline=False)
            embed.add_field(name="🕹️ Jeu", value=stream_info.game, inline=True)
            embed.add_field(name="👥 Viewers", value=str(stream_info.viewer_count), inline=True)
            embed.add_field(name="⏰ Démarré", value=discord.utils.format_dt(stream_info.started_at, 'R'), inline=True)
            
            if stream_info.thumbnail_url:
                embed.set_image(url=stream_info.thumbnail_url)
        
        embed.add_field(name="💬 Description", value=streamer.description, inline=False)
        embed.add_field(name="🔗 Lien", value=f"[Regarder sur Twitch]({streamer.url})", inline=False)
        
        status_text = "⭐ Streamer Affilié" if streamer.status == StreamerStatus.AFFILIE else "💫 En progression"
        embed.add_field(name="📊 Status", value=status_text, inline=True)
        
        embed.set_footer(text="Notification automatique")
        embed.timestamp = datetime.datetime.now(UTC)
        
        message = await channel.send(content=ping_message, embed=embed)
        bot.live_messages[streamer.name] = message.id
        bot.metrics.notifications_sent += 1
        
        logger.info(f"✅ Notification live envoyée pour {streamer.name}")
        
    except Exception as e:
        logger.error(f"Erreur lors de l'envoi de notification pour {streamer.name}: {e}")

async def remove_live_notification(streamer_name: str):
    """Supprimer/mettre à jour la notification live quand le stream se termine"""
    try:
        message_id = bot.live_messages.get(streamer_name)
        if not message_id:
            return
        
        # Essayer de trouver et mettre à jour le message
        for channel_id in [bot.config.live_affilie_channel, bot.config.live_non_affilie_channel]:
            if channel_id == 0:
                continue
                
            channel = bot.get_channel(channel_id)
            if not channel:
                continue
                
            try:
                message = await channel.fetch_message(message_id)
                
                if message.embeds:
                    embed = message.embeds[0]
                    embed.title = "⚫ STREAM TERMINÉ"
                    embed.color = discord.Color.dark_grey()
                    embed.set_footer(text="Stream terminé")
                    
                    await message.edit(embed=embed)
                    logger.info(f"🔄 Notification mise à jour pour {streamer_name}")
                    
                    # Supprimer après 5 minutes
                    await asyncio.sleep(300)
                    await message.delete()
                    logger.info(f"🗑️ Notification supprimée pour {streamer_name}")
                break
                
            except discord.NotFound:
                continue
            except Exception as e:
                logger.error(f"Erreur lors de la mise à jour du message pour {streamer_name}: {e}")
        
        bot.live_messages.pop(streamer_name, None)
        
    except Exception as e:
        logger.error(f"Erreur lors de la suppression de notification pour {streamer_name}: {e}")

# ==================== ÉVÉNEMENTS DU BOT ====================
@bot.event
async def on_ready():
    """Démarrage du bot"""
    logger.info("🤖 Bot en ligne!")
    logger.info(f'🆔 {bot.user.name} ({bot.user.id}) connecté')
    
    # Informations sur la base de données
    streamers_count = len(bot.db.get_all_streamers())
    logger.info(f'📊 {streamers_count} streamers chargés')
    
    # Synchroniser les commandes slash
    try:
        synced = await bot.tree.sync()
        logger.info(f"⚡ {len(synced)} commandes slash synchronisées")
    except Exception as e:
        logger.error(f"❌ Erreur lors de la synchronisation des commandes: {e}")
    
    # Démarrer les notifications live
    if not check_streamers_live.is_running():
        check_streamers_live.start()
        logger.info("🔔 Système de notifications live démarré")
    
    # Définir le statut du bot
    if os.getenv('RENDER'):
        web_info = f"Web: Render App"
    else:
        web_host = os.getenv('WEB_HOST', '127.0.0.1')
        web_port = os.getenv('WEB_PORT', '5000')
        web_info = f"Web: {web_host}:{web_port}"
    
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching, 
            name=f"{streamers_count} streamers | {web_info}"
        )
    )
    
    logger.info("✅ Bot entièrement initialisé!")

@bot.event
async def on_member_join(member: discord.Member):
    """Envoyer un message de bienvenue quand un nouveau membre rejoint"""
    try:
        # Vérifier si le channel de bienvenue est configuré
        if bot.config.welcome_channel == 0:
            logger.warning(f"⚠️ Channel de bienvenue non configuré pour le nouveau membre: {member.name}")
            return
        
        welcome_channel = bot.get_channel(bot.config.welcome_channel)
        if not welcome_channel:
            logger.error(f"❌ Channel de bienvenue {bot.config.welcome_channel} non trouvé!")
            return
        
        # Créer l'embed de bienvenue 
        embed = discord.Embed(
            title="🎉 Bienvenue sur le serveur !",
            description=f"Salut {member.mention} ! Nous sommes ravis de t'accueillir parmi nous ! 🚀",
            color=discord.Color.green()
        )
        
        # Avatar du nouvel utilisateur
        embed.set_thumbnail(url=member.display_avatar.url)
        
        # Informations importantes
        embed.add_field(
            name="📋 Première étape",
            value="• Lis le règlement avec `/reglement`\n• Présente-toi si tu le souhaites\n• Explore les différents channels",
            inline=False
        )
        
        # Informations sur le serveur
        guild_stats = f"👥 **{member.guild.member_count}** membres\n🎮 **{len(bot.db.get_all_streamers())}** streamers"
        embed.add_field(
            name="📊 Serveur",
            value=guild_stats,
            inline=True
        )
        
        embed.add_field(
            name="🤖 Commandes utiles",
            value="• `/reglement` - Voir le règlement\n• `/liste-affilie` - Streamers affiliés\n• `/stats` - Statistiques",
            inline=True
        )
        
        # Footer avec timestamp
        embed.set_footer(
            text=f"Membre #{member.guild.member_count} • Bienvenue !",
            icon_url=member.guild.icon.url if member.guild.icon else None
        )
        embed.timestamp = datetime.datetime.now(UTC)
        
        # Envoyer le message de bienvenue
        await welcome_channel.send(content=f"🎊 Tout le monde, accueillez {member.mention} !", embed=embed)
        
        # Log de l'événement
        logger.info(f"✅ Message de bienvenue envoyé pour {member.name} ({member.id})")
        
    except Exception as e:
        logger.error(f"❌ Erreur dans le message de bienvenue pour {member.name}: {e}")

@bot.event
async def on_message(message):
    """Gérer les messages"""
    if message.author.bot:
        return
    
    content_lower = message.content.lower()
    
    # Réponses automatiques simples
    if content_lower in ['stream', 'live']:
        embed = discord.Embed(
            description=f"👋 Salut {message.author.mention} ! Découvre nos streamers avec `/liste-affilie` ou `/stats` !",
            color=discord.Color.blue()
        )
        await message.reply(embed=embed, mention_author=False)
    
    elif content_lower in ['aide', 'help', 'commandes']:
        web_info = "Interface Web: Render App" if os.getenv('RENDER') else f"http://{os.getenv('WEB_HOST', '127.0.0.1')}:{os.getenv('WEB_PORT', '5000')}"
        
        embed = discord.Embed(
            title="🆘 Aide Rapide",
            description="**Commandes disponibles :**\n"
                       "• `/liste-affilie` - Streamers affiliés\n"
                       "• `/liste-non-affilie` - Streamers non-affiliés\n"
                       "• `/stats` - Statistiques\n"
                       "• `/live-status` - Qui est en live\n"
                       "• `/reglement` - Voir le règlement du serveur\n\n"
                       "**Modérateurs :**\n"
                       "• `/ajouter-streamer` - Ajouter un streamer\n"
                       "• `/supprimer-streamer` - Supprimer un streamer\n\n"
                       f"**{web_info}**",
            color=discord.Color.green()
        )
        await message.reply(embed=embed, mention_author=False)
    
    elif content_lower in ['reglement', 'règlement', 'regles', 'règles']:
        embed = discord.Embed(
            description=f"📋 {message.author.mention}, utilise la commande `/reglement` pour voir le règlement complet du serveur !",
            color=discord.Color.gold()
        )
        await message.reply(embed=embed, mention_author=False)
    
    await bot.process_commands(message)

# ==================== COMMANDES SLASH ====================
@bot.tree.command(name="ajouter-streamer", description="Ajouter un nouveau streamer")
async def ajouter_streamer(interaction: discord.Interaction, nom: str, url: str, status: str, description: str = "Nouveau streamer"):
    if not bot.is_moderator(interaction.user):
        await interaction.response.send_message("❌ Permissions insuffisantes!", ephemeral=True)
        return
    
    if not bot.validate_twitch_url(url):
        await interaction.response.send_message("❌ URL Twitch invalide!", ephemeral=True)
        return
    
    if status.lower() not in ["affilie", "non_affilie"]:
        await interaction.response.send_message("❌ Status invalide! Utilisez 'affilie' ou 'non_affilie'", ephemeral=True)
        return
    
    success = bot.db.add_streamer(nom, url, status, description)
    
    if success:
        embed = discord.Embed(
            title="✅ Streamer Ajouté",
            description=f"**{nom}** a été ajouté avec succès!",
            color=discord.Color.green()
        )
        embed.add_field(name="URL", value=url, inline=False)
        embed.add_field(name="Status", value=status, inline=True)
        embed.add_field(name="Description", value=description, inline=True)
        
        await interaction.response.send_message(embed=embed)
        bot.metrics.record_command("ajouter-streamer", interaction.user.id)
        logger.info(f"Streamer {nom} ajouté par {interaction.user.name}")
    else:
        await interaction.response.send_message("❌ Erreur lors de l'ajout!", ephemeral=True)

@bot.tree.command(name="reglement", description="Afficher le règlement du serveur")
async def reglement(interaction: discord.Interaction):
    """Afficher le règlement complet du serveur"""
    
    embed = discord.Embed(
        title="📋 RÈGLEMENT DU SERVEUR",
        description="Merci de lire et respecter ces règles pour maintenir une bonne ambiance ! 🌟",
        color=discord.Color.blue()
    )
    
    # Sections par défaut
    default_rules = [
        ("1. 🤝 Respect mutuel", "• Soyez respectueux envers tous les membres\n• Pas d'insultes, de harcèlement ou de discrimination\n• Traitez les autres comme vous aimeriez être traités"),
        ("2. 💬 Communication appropriée", "• Utilisez les bons channels pour vos messages\n• Pas de spam ou de flood\n• Évitez les CAPS LOCK excessifs\n• Restez dans le sujet des discussions"),
        ("3. 🔞 Contenu approprié", "• Pas de contenu NSFW (Not Safe For Work)\n• Respectez les limites d'âge Discord (13+)\n• Évitez les sujets controversés ou polémiques"),
        ("4. 🎮 Streams et promotion", "• Auto-promotion limitée dans les channels dédiés\n• Respectez les autres streamers\n• Pas de promotion excessive ou répétitive\n• Partagez vos streams dans les channels appropriés"),
        ("5. 🛡️ Utilisation des bots", "• Utilisez les commandes dans les channels appropriés\n• Ne spammez pas les commandes du bot\n• Respectez les cooldowns des commandes"),
        ("6. ⚖️ Sanctions", "• **1ère fois:** Avertissement verbal\n• **2ème fois:** Mute temporaire (1h-24h)\n• **3ème fois:** Kick temporaire\n• **Récidive:** Ban permanent\n• Les modérateurs ont le dernier mot")
    ]
    
    # Ajouter les règles
    for title, content in default_rules:
        embed.add_field(
            name=title,
            value=content,
            inline=False
        )
    
    # Informations supplémentaires
    embed.add_field(
        name="ℹ️ Informations importantes",
        value="• En cas de problème, contactez un modérateur\n• Ce règlement peut être modifié à tout moment\n• L'ignorance du règlement n'excuse pas son non-respect",
        inline=False
    )
    
    embed.set_footer(
        text="Dernière mise à jour",
        icon_url=interaction.guild.icon.url if interaction.guild.icon else None
    )  
    embed.timestamp = datetime.datetime.now(UTC)
    
    # Ajouter le bouton d'acceptation si le rôle est configuré
    view = None
    if bot.config.rules_role_id != 0:
        view = RuleAcceptanceView(bot.config.rules_role_id, bot.config.rules_role_name)
    
    await interaction.response.send_message(embed=embed, view=view)
    bot.metrics.record_command("reglement", interaction.user.id)

@bot.tree.command(name="stats", description="Statistiques du bot")
async def stats(interaction: discord.Interaction):
    stats = bot.db.get_stats()
    uptime = datetime.datetime.now(UTC) - bot.metrics.start_time
    
    embed = discord.Embed(
        title="📊 Statistiques",
        color=discord.Color.blue()
    )
    
    embed.add_field(name="👥 Total Streamers", value=str(stats['total_streamers']), inline=True)
    embed.add_field(name="⭐ Affiliés", value=str(stats['affilies']), inline=True)
    embed.add_field(name="💫 Non-Affiliés", value=str(stats['non_affilies']), inline=True)
    embed.add_field(name="🔴 En Live", value=str(len(bot.live_streamers)), inline=True)
    embed.add_field(name="📈 Taux d'Affiliation", value=f"{stats['affiliation_rate']}%", inline=True)
    embed.add_field(name="⚡ Uptime", value=f"{uptime.days}j {uptime.seconds//3600}h", inline=True)
    embed.add_field(name="🔧 Commandes", value=str(bot.metrics.commands_executed), inline=True)
    embed.add_field(name="👥 Utilisateurs", value=str(len(bot.metrics.unique_users_served)), inline=True)
    embed.add_field(name="🔔 Notifications", value=str(bot.metrics.notifications_sent), inline=True)
    
    if bot.live_streamers:
        live_list = ", ".join(list(bot.live_streamers.keys())[:5])
        if len(bot.live_streamers) > 5:
            live_list += f" +{len(bot.live_streamers)-5} autres"
        embed.add_field(name="🔴 Actuellement Live", value=live_list, inline=False)
    
    await interaction.response.send_message(embed=embed, ephemeral=True)
    bot.metrics.record_command("stats", interaction.user.id)

@bot.tree.command(name="liste-affilie", description="Voir les streamers affiliés")
async def liste_affilie(interaction: discord.Interaction):
    streamers = [s for s in bot.db.get_all_streamers() if s.status == StreamerStatus.AFFILIE]
    
    if not streamers:
        await interaction.response.send_message("❌ Aucun streamer affilié!", ephemeral=True)
        return
    
    embed = discord.Embed(
        title="⭐ Streamers Affiliés",
        description=f"{len(streamers)} streamer(s) affilié(s)",
        color=discord.Color.purple()
    )
    
    for streamer in streamers[:25]:
        live_status = "🔴 LIVE" if streamer.name in bot.live_streamers else "⚫ Offline"
        embed.add_field(
            name=streamer.name,
            value=f"{live_status}\n🔗 {streamer.url}\n💬 {streamer.description}",
            inline=True
        )
    
    await interaction.response.send_message(embed=embed, ephemeral=True)
    bot.metrics.record_command("liste-affilie", interaction.user.id)

@bot.tree.command(name="liste-non-affilie", description="Voir les streamers non-affiliés")
async def liste_non_affilie(interaction: discord.Interaction):
    streamers = [s for s in bot.db.get_all_streamers() if s.status == StreamerStatus.NON_AFFILIE]
    
    if not streamers:
        await interaction.response.send_message("❌ Aucun streamer non-affilié!", ephemeral=True)
        return
    
    embed = discord.Embed(
        title="💫 Streamers Non-Affiliés",
        description=f"{len(streamers)} streamer(s) non-affilié(s)",
        color=discord.Color.blue()
    )
    
    for streamer in streamers[:25]:
        live_status = "🔴 LIVE" if streamer.name in bot.live_streamers else "⚫ Offline"
        embed.add_field(
            name=streamer.name,
            value=f"{live_status}\n🔗 {streamer.url}\n💬 {streamer.description}",
            inline=True
        )
    
    await interaction.response.send_message(embed=embed, ephemeral=True)
    bot.metrics.record_command("liste-non-affilie", interaction.user.id)

@bot.tree.command(name="live-status", description="Voir qui est en live")
async def live_status(interaction: discord.Interaction):
    if not bot.live_streamers:
        embed = discord.Embed(
            title="⚫ Aucun Stream",
            description="Personne n'est en live actuellement.",
            color=discord.Color.orange()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return
    
    embed = discord.Embed(
        title="🔴 Streamers Live",
        description=f"{len(bot.live_streamers)} streamer(s) en direct",
        color=discord.Color.red()
    )
    
    all_streamers = bot.db.get_all_streamers()
    streamer_dict = {s.name: s for s in all_streamers}
    
    for streamer_name in bot.live_streamers:
        streamer = streamer_dict.get(streamer_name)
        if streamer:
            status_emoji = "⭐" if streamer.status == StreamerStatus.AFFILIE else "💫"
            embed.add_field(
                name=f"{status_emoji} {streamer.name}",
                value=f"🔗 {streamer.url}\n💬 {streamer.description}",
                inline=True
            )
    
    await interaction.response.send_message(embed=embed, ephemeral=True)
    bot.metrics.record_command("live-status", interaction.user.id)

# ==================== FONCTIONS UTILITAIRES ====================
def create_default_env():
    """Créer un fichier .env par défaut s'il n'existe pas"""
    env_file = ".env"
    
    if not os.path.exists(env_file):
        logger.info("📝 Création du fichier .env par défaut...")
        
        default_env = """# Configuration du Bot Discord Streamer
# Remplacez les valeurs par vos vraies informations

# === OBLIGATOIRE ===
DISCORD_TOKEN=your_discord_bot_token_here

# === CHANNELS DISCORD (IDs requis) ===
CHANNEL_LIVE_AFFILIE=0
CHANNEL_LIVE_NON_AFFILIE=0
CHANNEL_WELCOME=0
CHANNEL_LOGS=0

# === SYSTÈME DE RÔLE DE RÈGLEMENT ===
RULES_ROLE_ID=0
RULES_ROLE_NAME=Membre Vérifié

# === API TWITCH (Optionnel mais recommandé) ===
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret

# === CONFIGURATION BOT ===
COMMAND_PREFIX=!
AUTO_NOTIFICATIONS=true
NOTIFICATION_INTERVAL=2

# === CONFIGURATION SERVEUR WEB ===
WEB_HOST=0.0.0.0
WEB_PORT=10000
WEB_DEBUG=false
FLASK_SECRET_KEY=your-super-secret-key-change-this-in-production
"""
        
        try:
            with open(env_file, 'w', encoding='utf-8') as f:
                f.write(default_env)
            
            logger.info("✅ Fichier .env créé avec configuration pour production")
            logger.info("🔧 Configurez vos variables d'environnement")
            
            if IS_PRODUCTION:
                logger.warning("🚀 Environnement de production détecté")
                logger.warning("⚠️ Configurez les variables d'environnement sur votre plateforme")
                return False
            else:
                logger.info("💻 Environnement de développement - éditez le fichier .env")
                return False
            
        except Exception as e:
            logger.error(f"❌ Impossible de créer .env: {e}")
            return False
    
    return True

def print_startup_banner():
    """Afficher la bannière de démarrage"""
    banner = """
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║          🎮 Bot Discord Streamer v3.0 🤖                    ║
║   avec Interface Web, Bienvenue, Règlement & Bouton Rôle 🌐 ║
║                                                              ║
║     ✨ Fonctionnalités:                                     ║
║     • Notifications automatiques des streams                 ║
║     • Messages de bienvenue automatiques                     ║
║     • Système de règlement personnalisable                   ║
║     • Dashboard de règlement avec bouton de rôle             ║
║     • Attribution automatique de rôles                       ║
║     • Commandes slash modernes                               ║
║     • Gestion des streamers affiliés/non-affiliés            ║
║     • Statistiques en temps réel                             ║
║     • Interface d'administration web complète                ║
║     • API REST avec formulaire d'ajout de streamers          ║
║     • Support complet Render/Heroku/Railway                  ║
║                                                              ║
║     🚀 Prêt pour la production!                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"""
    print(banner)

# ==================== FONCTION PRINCIPALE ====================
def main():
    """Fonction principale avec gestion d'erreurs pour production"""
    
    print_startup_banner()
    
    logger.info(f"🌍 Environnement: {'Production' if IS_PRODUCTION else 'Développement'}")
    
    # Vérifier les dépendances Flask
    try:
        import flask
        import flask_cors
    except ImportError:
        logger.error("❌ Dépendances Flask manquantes!")
        logger.error("💿 Installez avec: pip install flask flask-cors")
        if not IS_PRODUCTION:
            print("\n❌ Dépendances manquantes!")
            print("💿 Exécutez: pip install flask flask-cors")
            print("🔄 Puis relancez le bot.")
        sys.exit(1)
    
    # Vérifier le fichier .env en développement seulement
    if not IS_PRODUCTION:
        if not create_default_env():
            print("\n❌ Configuration requise!")
            print("📝 Un fichier .env par défaut a été créé.")
            print("🔧 Éditez-le avec votre token Discord et les IDs des channels.")
            print("🚀 Puis relancez le bot.")
            return
    
    # Valider la configuration
    TOKEN = config.discord_token
    
    if not TOKEN or TOKEN == "your_discord_bot_token_here":
        logger.error("❌ Token Discord manquant!")
        
        if IS_PRODUCTION:
            logger.error("⚙️ Configurez la variable DISCORD_TOKEN sur votre plateforme")
            sys.exit(1)
        else:
            logger.error("💡 Éditez le fichier .env avec votre token")
            print("\n❌ Token Discord manquant!")
            print("🔧 Éditez le fichier .env avec votre token Discord.")
            return
    
    # Démarrer le bot
    logger.info("🚀 Démarrage du bot avec toutes les fonctionnalités...")
    logger.info("🔧 Support production Render/Heroku/Railway activé!")
    logger.info("=" * 60)
    
    try:
        keep_alive()
        bot.run(TOKEN, log_handler=None)
        
    except discord.LoginFailure:
        logger.error("❌ ERREUR D'AUTHENTIFICATION!")
        logger.error("🔑 Le token Discord est invalide")
        sys.exit(1)
        
    except KeyboardInterrupt:
        logger.info("🛑 Bot arrêté par l'utilisateur (Ctrl+C)")
        
    except Exception as e:
        logger.error(f"❌ ERREUR CRITIQUE: {type(e).__name__}: {e}")
        if not IS_PRODUCTION:
            print(f"\n❌ ERREUR CRITIQUE: {type(e).__name__}: {e}")
            print("📋 Vérifiez les logs pour plus de détails.")
        sys.exit(1)
        
    finally:
        # Nettoyage
        logger.info("🧹 Nettoyage final...")
        
        try:
            if check_streamers_live.is_running():
                check_streamers_live.cancel()
            logger.info("✅ Tâches de fond arrêtées")
        except Exception as e:
            logger.error(f"Erreur lors du nettoyage: {e}")
        
        logger.info("🏁 Arrêt du bot terminé")

# ==================== POINT D'ENTRÉE ====================
if __name__ == "__main__":
    # Vérifier la version Python
    if sys.version_info < (3, 8):
        print("❌ Python 3.8+ requis!")
        print(f"🔧 Version actuelle: {sys.version}")
        
        if IS_PRODUCTION:
            logger.error("❌ Version Python insuffisante - fermeture automatique")
            sys.exit(1)
        else:
            print("🔄 Mettez à jour Python et relancez le bot.")
            sys.exit(1)
    
    # Exécuter le bot avec toutes les fonctionnalités
    main()
