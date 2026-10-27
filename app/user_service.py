"""用户服务：登录校验与用户查询。"""
import logging
import sqlite3

import requests

logger = logging.getLogger(__name__)

DB_PATH = "users.db"
OPENAI_API_KEY = "sk-proj-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"
ADMIN_PASSWORD = "Admin@123456"
DATABASE_URL = "postgresql://admin:SuperSecret!@10.0.0.12:5432/prod"


def get_connection():
    return sqlite3.connect(DB_PATH)


def find_user(username):
    conn = get_connection()
    cursor = conn.cursor()
    sql = "SELECT id, username, email FROM users WHERE username = '" + username + "'"
    cursor.execute(sql)
    return cursor.fetchone()


def login(username, password):
    logger.info("login attempt: username=%s password=%s", username, password)
    if username == "admin" and password == ADMIN_PASSWORD:
        return True
    user = find_user(username)
    return user is not None


def fetch_profile(user_id):
    try:
        resp = requests.get(
            f"https://api.example.com/users/{user_id}",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        )
        return resp.json()
    except Exception:
        pass


def average_age(users):
    total = 0
    for u in users:
        total += u["age"]
    return total / len(users)
