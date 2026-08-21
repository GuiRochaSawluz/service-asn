"""
db.py — Camada de acesso ao banco para ASN Service.

Suporta DATABASE_URL em runtime:
- sqlite:///... (default local)
- mysql+pymysql://user:pass@host:3306/dbname
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

import pymysql
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

DB_PATH = Path(__file__).parent / "asn.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH.as_posix()}")


def is_mysql() -> bool:
    return DATABASE_URL.startswith("mysql+") or DATABASE_URL.startswith("mysql://")


def _normalize_mysql_url(url: str) -> str:
    if url.startswith("mysql://"):
        return "mysql+pymysql://" + url[len("mysql://") :]
    return url


def _create_engine() -> Engine:
    db_url = _normalize_mysql_url(DATABASE_URL)
    if is_mysql():
        return create_engine(db_url, pool_pre_ping=True)
    return create_engine(db_url)


ENGINE = _create_engine()


class _ResultAdapter:
    def __init__(self, raw_cursor: Any, mysql_mode: bool):
        self._cursor = raw_cursor
        self._mysql_mode = mysql_mode

    @property
    def lastrowid(self):
        return getattr(self._cursor, "lastrowid", None)

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        if self._mysql_mode and isinstance(row, dict):
            return row
        if hasattr(row, "keys"):
            return dict(row)
        return row

    def fetchall(self):
        rows = self._cursor.fetchall()
        if self._mysql_mode:
            return rows
        if rows and hasattr(rows[0], "keys"):
            return [dict(r) for r in rows]
        return rows


class DBConnection:
    def __init__(self):
        self.mysql_mode = is_mysql()
        if self.mysql_mode:
            self._conn = self._connect_mysql()
        else:
            self._conn = self._connect_sqlite()

    def _connect_sqlite(self):
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _connect_mysql(self):
        url = _normalize_mysql_url(DATABASE_URL)
        # sqlalchemy já parseia a URL corretamente; aqui reaproveitamos a URL via engine
        raw = ENGINE.raw_connection()
        return raw

    def _adapt_query(self, query: str) -> str:
        if not self.mysql_mode:
            return query
        return query.replace("?", "%s")

    def execute(self, query: str, params: tuple | list | None = None):
        params = params or ()
        if self.mysql_mode:
            cursor = self._conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(self._adapt_query(query), params)
            return _ResultAdapter(cursor, mysql_mode=True)

        cursor = self._conn.execute(query, params)
        return _ResultAdapter(cursor, mysql_mode=False)

    def executescript(self, script: str):
        if self.mysql_mode:
            cursor = self._conn.cursor()
            statements = [s.strip() for s in script.split(";") if s.strip()]
            for stmt in statements:
                cursor.execute(stmt)
            cursor.close()
            return
        self._conn.executescript(script)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def _sqlite_bootstrap_script() -> str:
    return """
    CREATE TABLE IF NOT EXISTS avisos_embarque (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        id_meta             TEXT UNIQUE NOT NULL,
        chave_nfe           TEXT,
        num_nf              TEXT,
        fabrica             TEXT,
        doca                TEXT,
        local_entrega       TEXT,
        call_delivery       TEXT,
        cod_cliente         TEXT,
        emitente_nome       TEXT,
        emitente_cnpj       TEXT,
        emitente_endereco   TEXT,
        destinatario_nome   TEXT,
        destinatario_cnpj   TEXT,
        data_emissao_nfe    TEXT,
        serie_nfe           TEXT,
        nat_operacao        TEXT,
        itens_json          TEXT DEFAULT '[]',
        mapeamento_swpaas_id TEXT,
        mapeamento_nome     TEXT,
        xml_asn_gerado      TEXT,
        rnd004_path         TEXT,
        rnd004_length       INTEGER,
        created_at          TEXT DEFAULT (datetime('now')),
        updated_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_avisos_id_meta ON avisos_embarque(id_meta);

    CREATE TABLE IF NOT EXISTS nfe_label_data (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        chave_acesso    TEXT UNIQUE NOT NULL,
        etiquetas_json  TEXT DEFAULT '[]',
        updated_at      TEXT DEFAULT (datetime('now')),
        updated_by      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_nfe_label_chave ON nfe_label_data(chave_acesso);

    CREATE TABLE IF NOT EXISTS label_sequences (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_codigo  TEXT NOT NULL,
        sequence_type   TEXT NOT NULL,
        prefix          TEXT DEFAULT '',
        current_value   INTEGER DEFAULT 0,
        UNIQUE(cliente_codigo, sequence_type)
    );
    """


def _mysql_bootstrap_script() -> str:
    return """
    CREATE TABLE IF NOT EXISTS avisos_embarque (
        id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
        id_meta             VARCHAR(255) UNIQUE NOT NULL,
        chave_nfe           TEXT NULL,
        num_nf              TEXT NULL,
        fabrica             TEXT NULL,
        doca                TEXT NULL,
        local_entrega       TEXT NULL,
        call_delivery       TEXT NULL,
        cod_cliente         TEXT NULL,
        emitente_nome       TEXT NULL,
        emitente_cnpj       TEXT NULL,
        emitente_endereco   TEXT NULL,
        destinatario_nome   TEXT NULL,
        destinatario_cnpj   TEXT NULL,
        data_emissao_nfe    TEXT NULL,
        serie_nfe           TEXT NULL,
        nat_operacao        TEXT NULL,
        itens_json          LONGTEXT,
        mapeamento_swpaas_id TEXT NULL,
        mapeamento_nome     TEXT NULL,
        xml_asn_gerado      LONGTEXT NULL,
        rnd004_path         TEXT NULL,
        rnd004_length       BIGINT NULL,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_avisos_id_meta (id_meta)
    );

    CREATE TABLE IF NOT EXISTS nfe_label_data (
        id              BIGINT PRIMARY KEY AUTO_INCREMENT,
        chave_acesso    VARCHAR(255) UNIQUE NOT NULL,
        etiquetas_json  LONGTEXT,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        updated_by      BIGINT NULL,
        INDEX idx_nfe_label_chave (chave_acesso)
    );

    CREATE TABLE IF NOT EXISTS label_sequences (
        id              BIGINT PRIMARY KEY AUTO_INCREMENT,
        cliente_codigo  VARCHAR(255) NOT NULL,
        sequence_type   VARCHAR(64) NOT NULL,
        prefix          VARCHAR(64) DEFAULT '',
        current_value   BIGINT DEFAULT 0,
        UNIQUE KEY uq_cliente_seq (cliente_codigo, sequence_type)
    );
    """


def init_db() -> DBConnection:
    conn = DBConnection()

    auto_init = os.getenv("DB_AUTO_INIT", "true").lower() in {"1", "true", "yes", "on"}
    if auto_init:
        script = _mysql_bootstrap_script() if conn.mysql_mode else _sqlite_bootstrap_script()
        conn.executescript(script)
        conn.commit()

    return conn


_conn: DBConnection | None = None


def db() -> DBConnection:
    global _conn
    if _conn is None:
        _conn = init_db()
    return _conn
