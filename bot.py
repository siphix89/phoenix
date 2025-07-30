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
    """Configuration simplifiée du bot"""
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
    
    def update_rule_section(self, section_key: str, title: str, content: str, updated_by: str) -> bool:
        """Mettre à jour ou créer une section de règlement"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO rules_sections 
                    (section_key, section_title, section_content, updated_at, updated_by)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
                """, (section_key, title, content, updated_by))
                conn.commit()
                logger.info(f"✅ Section de règlement {section_key} mise à jour par {updated_by}")
                return True
        except Exception as e:
            logger.error(f"❌ Erreur lors de la mise à jour de la section {section_key}: {e}")
            return False
    
    def get_rule_section(self, section_key: str) -> Optional[Dict[str, str]]:
        """Récupérer une section de règlement spécifique"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM rules_sections WHERE section_key = ?", 
                    (section_key,)
                )
                row = cursor.fetchone()
                
                if row:
                    return {
                        'title': row['section_title'],
                        'content': row['section_content'],
                        'updated_at': row['updated_at'],
                        'updated_by': row['updated_by']
                    }
                return None
        except Exception as e:
            logger.error(f"❌ Erreur lors de la récupération de la section {section_key}: {e}")
            return None
    
    def get_all_rule_sections(self) -> Dict[str, Dict[str, str]]:
        """Récupérer toutes les sections de règlement personnalisées"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("SELECT * FROM rules_sections ORDER BY section_key")
                
                sections = {}
                for row in cursor.fetchall():
                    sections[row['section_key']] = {
                        'title': row['section_title'],
                        'content': row['section_content'],
                        'updated_at': row['updated_at'],
                        'updated_by': row['updated_by']
                    }
                
                return sections
        except Exception as e:
            logger.error(f"❌ Erreur lors de la récupération de toutes les sections: {e}")
            return {}

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
            <p>Interface d'administration complète</p>
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
        
        document.getElementById('streamerUrl').addEventListener('input', function() {
            const url = this.value;
            const twitchPattern = /^https:\\/\\/www\\.twitch\\.tv\\/[a-zA-Z0-9_]{4,25}$/;
            
            if (url && !twitchPattern.test(url)) {
                this.style.borderColor = '#dc3545';
                this.style.boxShadow = '0 0 0 3px rgba(220, 53, 69, 0.1)';
            } else {
                this.style.borderColor = '#dee2e6';
                this.style.boxShadow = 'none';
            }
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
            
            const twitchPattern = /^https:\\/\\/www\\.twitch\\.tv\\/[a-zA-Z0-9_]{4,25}$/;
            if (!twitchPattern.test(data.url)) {
                showAlert('❌ URL Twitch invalide. Format: https://www.twitch.tv/username', 'danger');
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
        
        @self.app.route('/api/streamers', methods=['GET'])
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
                import threading
                
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
        
        @self.app.route('/api/remove-streamer', methods=['POST'])
        def remove_streamer_api():
            try:
                data = request.get_json()
                
                if not data or not data.get('name'):
                    return jsonify({'success': False, 'error': 'Nom du streamer requis'}), 400
                
                name = data.get('name').strip()
                success = self.bot.db.remove_streamer(name)
                
                if success:
                    if hasattr(self.bot, 'live_streamers'):
                        self.bot.live_streamers.pop(name, None)
                        self.bot.live_messages.pop(name, None)
                    
                    logger.info(f"✅ Streamer {name} supprimé via interface web")
                    return jsonify({'success': True, 'message': f'Streamer {name} supprimé avec succès'})
                else:
                    return jsonify({'success': False, 'error': f'Streamer {name} introuvable'}), 404
                
            except Exception as e:
                logger.error(f"❌ Erreur API remove-streamer: {e}")
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
        
        # Démarrer le serveur web
        self.web_server = WebServer(self)
        
        # Configuration du serveur web depuis les variables d'environnement  
        web_host = os.getenv('WEB_HOST', '127.0.0.1')
        web_port = int(os.getenv('WEB_PORT', '5000'))
        web_debug = os.getenv('WEB_DEBUG', 'false').lower() == 'true'
        
        self.web_server.start_server(host=web_host, port=web_port, debug=web_debug)
        
        logger.info("🤖 Configuration du bot terminée avec serveur web")
    
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
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching, 
            name=f"{streamers_count} streamers | Web: {os.getenv('WEB_HOST', '127.0.0.1')}:{os.getenv('WEB_PORT', '5000')}"
        )
    )
    
    logger.info("✅ Bot entièrement initialisé avec interface web, système de bienvenue et dashboard de règlement!")

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
        
        # Message privé de bienvenue
        try:
            dm_embed = discord.Embed(
                title="👋 Bienvenue !",
                description=f"Salut {member.name} !\n\nMerci de rejoindre **{member.guild.name}** !\n\n🔴 **Important:** Utilise `/reglement` dans le serveur pour voir les règles complètes ! 📋",
                color=discord.Color.blue()
            )
            
            dm_embed.add_field(
                name="🆘 Besoin d'aide ?",
                value="Contacte un modérateur ou utilise la commande `/reglement` dans le serveur !",
                inline=False
            )
            
            await member.send(embed=dm_embed)
            logger.info(f"✅ MP de bienvenue envoyé à {member.name}")
            
        except discord.Forbidden:
            logger.info(f"⚠️ Impossible d'envoyer un MP à {member.name} (MP désactivés)")
        except Exception as e:
            logger.error(f"❌ Erreur lors de l'envoi du MP à {member.name}: {e}")
    
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
                       "**Administrateurs :**\n"
                       "• `/test-bienvenue` - Tester le message de bienvenue\n"
                       "• `/config-bienvenue` - Configurer le système de bienvenue\n"
                       "• `/reglement-dashboard` - Créer le dashboard de règlement\n"
                       "• `/modifier-reglement` - Modifier une section du règlement\n\n"
                       f"**Interface Web :**\n"
                       f"• http://{os.getenv('WEB_HOST', '127.0.0.1')}:{os.getenv('WEB_PORT', '5000')}",
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
    
    # Récupérer les sections personnalisées depuis la base de données
    custom_sections = bot.db.get_all_rule_sections()
    
    # Sections par défaut
    default_rules = [
        ("1. 🤝 Respect mutuel", "• Soyez respectueux envers tous les membres\n• Pas d'insultes, de harcèlement ou de discrimination\n• Traitez les autres comme vous aimeriez être traités"),
        ("2. 💬 Communication appropriée", "• Utilisez les bons channels pour vos messages\n• Pas de spam ou de flood\n• Évitez les CAPS LOCK excessifs\n• Restez dans le sujet des discussions"),
        ("3. 🔞 Contenu approprié", "• Pas de contenu NSFW (Not Safe For Work)\n• Respectez les limites d'âge Discord (13+)\n• Évitez les sujets controversés ou polémiques"),
        ("4. 🎮 Streams et promotion", "• Auto-promotion limitée dans les channels dédiés\n• Respectez les autres streamers\n• Pas de promotion excessive ou répétitive\n• Partagez vos streams dans les channels appropriés"),
        ("5. 🛡️ Utilisation des bots", "• Utilisez les commandes dans les channels appropriés\n• Ne spammez pas les commandes du bot\n• Respectez les cooldowns des commandes"),
        ("6. ⚖️ Sanctions", "• **1ère fois:** Avertissement verbal\n• **2ème fois:** Mute temporaire (1h-24h)\n• **3ème fois:** Kick temporaire\n• **Récidive:** Ban permanent\n• Les modérateurs ont le dernier mot")
    ]
    
    # Ajouter les règles (personnalisées si disponibles, sinon par défaut)
    section_mapping = {
        "respect": 0, "communication": 1, "contenu": 2, 
        "streams": 3, "bots": 4, "sanctions": 5
    }
    
    for title, content in default_rules:
        # Vérifier si une version personnalisée existe
        section_key = None
        for key, idx in section_mapping.items():
            if idx == default_rules.index((title, content)):
                section_key = key
                break
        
        if section_key and section_key in custom_sections:
            # Utiliser la version personnalisée
            custom_section = custom_sections[section_key]
            embed.add_field(
                name=custom_section['title'],
                value=custom_section['content'][:1024],  # Limite Discord
                inline=False
            )
        else:
            # Utiliser la version par défaut
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
    
    await interaction.response.send_message(embed=embed)
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

@bot.tree.command(name="supprimer-streamer", description="Supprimer un streamer")
async def supprimer_streamer(interaction: discord.Interaction, nom: str):
    if not bot.is_moderator(interaction.user):
        await interaction.response.send_message("❌ Permissions insuffisantes!", ephemeral=True)
        return
    
    success = bot.db.remove_streamer(nom)
    
    if success:
        embed = discord.Embed(
            title="✅ Streamer Supprimé",
            description=f"**{nom}** a été supprimé!",
            color=discord.Color.red()
        )
        await interaction.response.send_message(embed=embed)
        
        # Supprimer du suivi live
        bot.live_streamers.pop(nom, None)
        bot.live_messages.pop(nom, None)
        
        bot.metrics.record_command("supprimer-streamer", interaction.user.id)
        logger.info(f"Streamer {nom} supprimé par {interaction.user.name}")
    else:
        await interaction.response.send_message(f"❌ Streamer '{nom}' introuvable!", ephemeral=True)

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

@bot.tree.command(name="test-bienvenue", description="Tester le message de bienvenue (Admin)")
async def test_bienvenue(interaction: discord.Interaction, utilisateur: discord.Member = None):
    """Commande pour tester le message de bienvenue"""
    if not bot.is_admin(interaction.user):
        await interaction.response.send_message("❌ Seuls les administrateurs peuvent utiliser cette commande!", ephemeral=True)
        return
    
    # Utiliser l'utilisateur spécifié ou celui qui fait la commande
    target_member = utilisateur or interaction.user
    
    try:
        # Simuler l'événement de bienvenue
        await on_member_join(target_member)
        
        embed = discord.Embed(
            title="✅ Test réussi",
            description=f"Message de bienvenue envoyé pour {target_member.mention}",
            color=discord.Color.green()
        )
        
        await interaction.response.send_message(embed=embed, ephemeral=True)
        bot.metrics.record_command("test-bienvenue", interaction.user.id)
        logger.info(f"🧪 Test de message de bienvenue déclenché par {interaction.user.name} pour {target_member.name}")
        
    except Exception as e:
        embed = discord.Embed(
            title="❌ Erreur",
            description=f"Erreur lors du test: {str(e)[:500]}",
            color=discord.Color.red()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        logger.error(f"❌ Erreur test bienvenue: {e}")

@bot.tree.command(name="config-bienvenue", description="Configurer le système de bienvenue (Admin)")
async def config_bienvenue(interaction: discord.Interaction, channel: discord.TextChannel = None):
    """Configurer le channel de bienvenue"""
    if not bot.is_admin(interaction.user):
        await interaction.response.send_message("❌ Seuls les administrateurs peuvent utiliser cette commande!", ephemeral=True)
        return
    
    if channel:
        # Mettre à jour le channel de bienvenue
        bot.config.welcome_channel = channel.id
        
        # Mettre à jour la variable d'environnement en mémoire
        os.environ['CHANNEL_WELCOME'] = str(channel.id)
        
        embed = discord.Embed(
            title="✅ Configuration mise à jour",
            description=f"Channel de bienvenue configuré: {channel.mention}",
            color=discord.Color.green()
        )
        
        embed.add_field(
            name="💡 Note",
            value="Pour rendre cette configuration permanente, mettez à jour `CHANNEL_WELCOME` dans votre fichier .env",
            inline=False
        )
        
        await interaction.response.send_message(embed=embed)
        bot.metrics.record_command("config-bienvenue", interaction.user.id)
        logger.info(f"✅ Channel de bienvenue configuré sur {channel.name} par {interaction.user.name}")
    
    else:
        # Afficher la configuration actuelle
        current_channel = bot.get_channel(bot.config.welcome_channel) if bot.config.welcome_channel != 0 else None
        
        embed = discord.Embed(
            title="⚙️ Configuration de bienvenue",
            color=discord.Color.blue()
        )
        
        if current_channel:
            embed.add_field(
                name="📍 Channel actuel",
                value=f"{current_channel.mention} (`{current_channel.id}`)",
                inline=False
            )
        else:
            embed.add_field(
                name="⚠️ Aucun channel configuré",
                value="Utilisez `/config-bienvenue #channel` pour configurer",
                inline=False
            )
        
        embed.add_field(
            name="🔧 Utilisation",
            value="• `/config-bienvenue #channel` - Définir le channel\n• `/test-bienvenue` - Tester le message\n• `/config-bienvenue` - Voir la config actuelle",
            inline=False
        )
        
        await interaction.response.send_message(embed=embed, ephemeral=True)

@bot.tree.command(name="reglement-dashboard", description="Créer le dashboard du règlement (Admin)")
async def reglement_dashboard(interaction: discord.Interaction, channel: discord.TextChannel = None):
    """Créer un dashboard permanent du règlement"""
    if not bot.is_admin(interaction.user):
        await interaction.response.send_message("❌ Seuls les administrateurs peuvent utiliser cette commande!", ephemeral=True)
        return
    
    target_channel = channel or interaction.channel
    
    # Embed principal du règlement
    main_embed = discord.Embed(
        title="📋 RÈGLEMENT DU SERVEUR",
        description="**Bienvenue dans notre communauté !** 🎉\n\nPour maintenir une ambiance conviale et respectueuse, merci de suivre ces règles simples :",
        color=discord.Color.gold()
    )
    
    # Règles principales découpées pour respecter la limite de 1024 caractères par champ
    main_embed.add_field(
        name="",
        value=(
            "**1. 🤝 Respect mutuel**\n"
            "Soyez respectueux envers tous les membres. Aucune forme de harcèlement, d'insulte ou de discrimination ne sera tolérée.\n\n"
            "**2. 💬 Communication appropriée**\n"
            "Utilisez les bons channels, évitez le spam et gardez un langage approprié. Les discussions doivent au minimum rester constructives.\n\n"
            "**3. 🔞 Contenu approprié**\n"
            "Aucun contenu NSFW ou inapproprié. Respectez les limites d'âge de Discord (13+)."
        ),
        inline=False
    )

    main_embed.add_field(
        name="",
        value=(
            "**4. 📝 Présentation de votre chaîne**\n"
            "Votre présentation est importante : elle permet de vous attribuer le bon rôle et de se faire une idée de votre chaîne ainsi que de votre communauté.\n\n"
            "**5. 🤝 Le follow**\n"
            "Vous n'êtes forcé de follow personne. Suivez qui vous voulez, librement et sans pression.\n\n"
            "**6. 🌙 Le lurk**\n"
            "Laisser un lurk ne coûte rien : ouvrir la page Twitch en arrière-plan apporte du soutien à tout le monde."
        ),
        inline=False
    )

    main_embed.add_field(
        name="",
        value=(
            "**7. 🛡️ Utilisation des bots**\n"
            "Utilisez les commandes des bots de manière appropriée et dans les bons channels.\n\n"
            "**8. ⚖️ Système de sanctions**\n"
            "```\nAvertissement → Mute → Kick → Ban\n```\n"
            "Les modérateurs appliquent les sanctions selon la gravité."
        ),
        inline=False
    )
    
    # Informations utiles
    main_embed.add_field(
        name="🎯 Channels importants",
        value="• 📢 <#1400035914809479219> Annonces officielles\n• 🔴 <#1399525054890377239> Streams des affiliés\n• 🔴 <#1399525130878582934> Streams des non affiliés\n• 💬 <#1400057946934739066> presentation\n• 🆘 <#1399525678671724604> Aide et support",
        inline=True
    )
    
    main_embed.add_field(
        name="🤖 Commandes utiles",
        value="• `/liste-affilie` - Voir les streamers affiliés\n• `/stats` - Statistiques du serveur\n• `/live-status` - streamers en live\n• `/reglement` - Afficher ce règlement",
        inline=True
    )
    
    # Footer
    footer_text = f"Serveur {interaction.guild.name} • Mis à jour le"
    main_embed.set_footer(text=footer_text, icon_url=interaction.guild.icon.url if interaction.guild.icon else None)
    main_embed.timestamp = datetime.datetime.now(UTC)
    
    try:
        # Envoyer l'embed
        await target_channel.send(embed=main_embed)
        
        # Confirmation
        success_embed = discord.Embed(
            title="✅ Dashboard créé",
            description=f"Le dashboard du règlement a été créé dans {target_channel.mention}",
            color=discord.Color.green()
        )
        success_embed.add_field(
            name="🔧 Modification",
            value="Utilisez `/modifier-reglement` pour mettre à jour le contenu",
            inline=False
        )
        
        await interaction.response.send_message(embed=success_embed, ephemeral=True)
        bot.metrics.record_command("reglement-dashboard", interaction.user.id)
        logger.info(f"✅ Dashboard de règlement créé dans {target_channel.name} par {interaction.user.name}")
        
    except Exception as e:
        error_embed = discord.Embed(
            title="❌ Erreur",
            description=f"Impossible de créer le dashboard: {str(e)[:500]}",
            color=discord.Color.red()
        )
        await interaction.response.send_message(embed=error_embed, ephemeral=True)
        logger.error(f"❌ Erreur création dashboard règlement: {e}")

@bot.tree.command(name="modifier-reglement", description="Modifier une section du règlement (Admin)")
async def modifier_reglement(interaction: discord.Interaction, 
                           section: str, 
                           titre: str,
                           nouveau_contenu: str):
    """Modifier une section spécifique du règlement"""
    if not bot.is_admin(interaction.user):
        await interaction.response.send_message("❌ Seuls les administrateurs peuvent utiliser cette commande!", ephemeral=True)
        return
    
    sections_disponibles = {
        "respect": "🤝 Respect mutuel",
        "communication": "💬 Communication appropriée", 
        "contenu": "🔞 Contenu approprié",
        "streams": "🎮 Streams et promotion",
        "bots": "🛡️ Utilisation des bots",
        "sanctions": "⚖️ Sanctions",
        "contact": "🆘 Contact modération"
    }
    
    if section.lower() not in sections_disponibles:
        embed = discord.Embed(
            title="❌ Section invalide",
            description="Sections disponibles :",
            color=discord.Color.red()
        )
        
        for key, value in sections_disponibles.items():
            embed.add_field(name=f"`{key}`", value=value, inline=True)
        
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return
    
    # Sauvegarder la modification dans la base de données
    success = bot.db.update_rule_section(
        section_key=section.lower(),
        title=titre,
        content=nouveau_contenu,
        updated_by=f"{interaction.user.name}#{interaction.user.discriminator}"
    )
    
    if success:
        embed = discord.Embed(
            title="✅ Section modifiée",
            description=f"La section **{section.lower()}** a été mise à jour",
            color=discord.Color.green()
        )
        
        embed.add_field(
            name="📝 Nouveau titre",
            value=titre,
            inline=False
        )
        
        embed.add_field(
            name="📝 Nouveau contenu",
            value=nouveau_contenu[:500] + ("..." if len(nouveau_contenu) > 500 else ""),
            inline=False
        )
        
        embed.add_field(
            name="💡 Note",
            value="Utilisez `/reglement-dashboard` pour recréer le dashboard avec les modifications",
            inline=False
        )
        
        await interaction.response.send_message(embed=embed, ephemeral=True)
        bot.metrics.record_command("modifier-reglement", interaction.user.id)
        logger.info(f"✅ Section de règlement '{section}' modifiée par {interaction.user.name}")
    else:
        error_embed = discord.Embed(
            title="❌ Erreur",
            description="Impossible de sauvegarder la modification dans la base de données.",
            color=discord.Color.red()
        )
        await interaction.response.send_message(embed=error_embed, ephemeral=True)

# ==================== GESTION D'ERREURS ====================
@bot.event
async def on_application_command_error(interaction: discord.Interaction, error):
    """Gérer les erreurs des commandes slash"""
    logger.error(f"Erreur de commande dans {interaction.command.name if interaction.command else 'inconnue'}: {error}")
    
    embed = discord.Embed(
        title="❌ Erreur",
        color=discord.Color.red()
    )
    
    if isinstance(error, commands.MissingPermissions):
        embed.description = "Vous n'avez pas les permissions nécessaires."
    elif isinstance(error, commands.CommandOnCooldown):
        embed.description = f"Commande en cooldown. Réessayez dans {error.retry_after:.1f} secondes."
    else:
        embed.description = "Une erreur inattendue s'est produite."
        embed.add_field(name="Détails", value=str(error)[:500], inline=False)
    
    try:
        if not interaction.response.is_done():
            await interaction.response.send_message(embed=embed, ephemeral=True)
        else:
            await interaction.followup.send(embed=embed, ephemeral=True)
    except:
        logger.error("Échec de l'envoi du message d'erreur")

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

# === API TWITCH (Optionnel mais recommandé) ===
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret

# === CONFIGURATION BOT ===
COMMAND_PREFIX=!
AUTO_NOTIFICATIONS=true
NOTIFICATION_INTERVAL=2

# === CONFIGURATION SERVEUR WEB ===
WEB_HOST=127.0.0.1
WEB_PORT=5000
WEB_DEBUG=false
FLASK_SECRET_KEY=your-super-secret-key-change-this-in-production
"""
        
        try:
            with open(env_file, 'w', encoding='utf-8') as f:
                f.write(default_env)
            
            logger.info("✅ Fichier .env créé")
            logger.info("🔧 Éditez le fichier .env avec vos informations")
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
║          🎮 Bot Discord Streamer v2.4 🤖                    ║
║     avec Interface Web, Bienvenue & Dashboard Règlement 🌐  ║
║                                                              ║
║     ✨ Fonctionnalités:                                     ║
║     • Notifications automatiques des streams                 ║
║     • Messages de bienvenue automatiques                     ║
║     • Système de règlement personnalisable                   ║
║     • Dashboard de règlement interactif                      ║
║     • Commandes slash modernes                               ║
║     • Gestion des streamers affiliés/non-affiliés            ║
║     • Statistiques en temps réel                             ║
║     • Interface d'administration web complète                ║
║     • API REST avec formulaire d'ajout de streamers          ║
║                                                              ║
║     🚀 Prêt pour la production!                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"""
    print(banner)

# ==================== FONCTION PRINCIPALE ====================
def main():
    """Fonction principale avec gestion d'erreurs"""
    
    print_startup_banner()
    
    # Vérifier les dépendances Flask
    try:
        import flask
        import flask_cors
    except ImportError:
        logger.error("❌ Dépendances Flask manquantes!")
        logger.error("💿 Installez avec: pip install flask flask-cors")
        input("Appuyez sur Entrée pour quitter...")
        return
    
    # Vérifier le fichier .env
    if not create_default_env():
        print("\n❌ Configuration requise!")
        print("📝 Un fichier .env par défaut a été créé.")
        print("🔧 Éditez-le avec votre token Discord et les IDs des channels.")
        print("🌐 Les paramètres web sont pré-configurés.")
        print("🎉 N'oubliez pas de configurer CHANNEL_WELCOME pour les messages de bienvenue!")
        print("📋 Le système de règlement est maintenant disponible avec /reglement !")
        print("➕ Interface web avec formulaire d'ajout de streamers disponible !")
        print("🚀 Puis relancez le bot.")
        input("Appuyez sur Entrée pour quitter...")
        return
    
    # Valider la configuration
    TOKEN = config.discord_token
    
    if not TOKEN or TOKEN == "your_discord_bot_token_here":
        logger.error("❌ Token Discord manquant!")
        logger.error("💡 Éditez le fichier .env avec votre token")
        input("Appuyez sur Entrée pour quitter...")
        return
    
    # Vérifier la configuration
    config_errors = config.validate()
    if config_errors:
        logger.error("❌ Erreurs de configuration:")
        for field, error in config_errors.items():
            logger.error(f"  - {field}: {error}")
        
        if 'discord_token' in config_errors:
            logger.error("🛑 Impossible de continuer sans token Discord!")
            input("Appuyez sur Entrée pour quitter...")
            return
        else:
            logger.warning("⚠️ Le bot démarrera avec des fonctionnalités limitées")
            response = input("Continuer quand même? (o/N): ")
            if response.lower() != 'o':
                return
    
    # Afficher le résumé de la configuration
    web_host = os.getenv('WEB_HOST', '127.0.0.1')
    web_port = os.getenv('WEB_PORT', '5000')
    
    logger.info("📋 Résumé de la configuration:")
    logger.info(f"  - Token Discord: {'✅ Configuré' if config.discord_token else '❌ Manquant'}")
    logger.info(f"  - Channel Affilié: {'✅' if config.live_affilie_channel else '❌'} ({config.live_affilie_channel})")
    logger.info(f"  - Channel Non-Affilié: {'✅' if config.live_non_affilie_channel else '❌'} ({config.live_non_affilie_channel})")
    logger.info(f"  - Channel Bienvenue: {'✅' if config.welcome_channel else '❌'} ({config.welcome_channel})")
    logger.info(f"  - Channel Logs: {'✅' if config.logs_channel else '❌'} ({config.logs_channel})")
    logger.info(f"  - API Twitch: {'✅' if config.twitch_client_id else '❌'}")
    logger.info(f"  - Notifications Auto: {'✅' if config.auto_notifications else '❌'}")
    logger.info(f"  - Interface Web: ✅ http://{web_host}:{web_port}")
    logger.info(f"  - Système de Règlement: ✅ Activé avec DB")
    logger.info(f"  - Formulaire Web: ✅ Ajout de streamers intégré")
    
    # Démarrer le bot
    logger.info("🚀 Démarrage du bot avec toutes les fonctionnalités...")
    logger.info(f"🌐 Interface web disponible sur: http://{web_host}:{web_port}")
    logger.info("🎉 Système de bienvenue activé!")
    logger.info("📋 Système de règlement personnalisable activé!")
    logger.info("➕ Formulaire d'ajout de streamers via interface web activé!")
    logger.info("=" * 60)
    
    try:
        bot.run(TOKEN, log_handler=None)
        
    except discord.LoginFailure:
        logger.error("❌ ERREUR D'AUTHENTIFICATION!")
        logger.error("🔑 Le token Discord est invalide")
        logger.error("💡 Vérifiez votre token dans le fichier .env")
        
    except KeyboardInterrupt:
        logger.info("🛑 Bot arrêté par l'utilisateur (Ctrl+C)")
        
    except Exception as e:
        logger.error(f"❌ ERREUR CRITIQUE: {type(e).__name__}: {e}")
        
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
        print(f"🐍 Version actuelle: {sys.version}")
        input("Appuyez sur Entrée pour quitter...")
        sys.exit(1)
    
    # Exécuter le bot avec toutes les fonctionnalités
    keep_alive()
    main()
