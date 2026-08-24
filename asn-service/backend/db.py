"""db.py — Camada de acesso ao banco para ASN Service.

Suporta DATABASE_URL em runtime:
- sqlite:///... (default local)
- mysql+pymysql://user:pass@host:3306/dbname

Com fallback opcional:
- Se MySQL falhar/timeout, usa SQLite local com o schema da aplicação.
- Mantém fila local (outbox) para sincronizar alterações no MySQL quando voltar.
- Em cenário com múltiplos containers, usa lock distribuído no MySQL + replay
  idempotente para reduzir colisões.
"""

from __future__ import annotations

import json
import os
import socket
import sqlite3
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pymysql
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "asn.db"
FALLBACK_DB_PATH = Path(os.getenv("FALLBACK_DB_PATH", str(BASE_DIR / "asn_fallback.db")))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH.as_posix()}")


def _is_mysql_url(url: str) -> bool:
    return url.startswith("mysql+") or url.startswith("mysql://")


def _normalize_mysql_url(url: str) -> str:
    if url.startswith("mysql://"):
        return "mysql+pymysql://" + url[len("mysql://") :]
    return url


def _safe_int(env_name: str, default: int) -> int:
    try:
        return int(os.getenv(env_name, str(default)))
    except Exception:
        return default


def _safe_float(env_name: str, default: float) -> float:
    try:
        return float(os.getenv(env_name, str(default)))
    except Exception:
        return default


def _env_bool(env_name: str, default: bool) -> bool:
    raw = os.getenv(env_name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None

    txt = value.strip()
    if not txt:
        return None

    candidates = [txt, txt.replace("Z", "+00:00")]
    for item in candidates:
        try:
            return datetime.fromisoformat(item)
        except Exception:
            pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(txt, fmt)
        except Exception:
            pass
    return None


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
        self.configured_mysql = _is_mysql_url(DATABASE_URL)
        self.fallback_enabled = _env_bool("DB_ENABLE_SQLITE_FALLBACK", True)
        self.auto_init = _env_bool("DB_AUTO_INIT", True)
        self.recovery_check_seconds = _safe_float("DB_RECOVERY_CHECK_SECONDS", 10.0)
        self.sync_batch_size = _safe_int("DB_SYNC_BATCH_SIZE", 200)
        self.sync_lock_name = os.getenv("DB_SYNC_LOCK_NAME", "asn_fallback_sync_lock")
        self.instance_id = os.getenv("CONTAINER_INSTANCE_ID", socket.gethostname())

        self._engine: Engine | None = None
        self._conn: Any = None
        self._last_recovery_attempt = 0.0
        self._last_fallback_reason: str | None = None
        self.mysql_mode = False

        self._init_connection()

    def _mysql_connect_args(self) -> dict:
        return {
            "connect_timeout": _safe_int("DB_CONNECT_TIMEOUT_SECONDS", 3),
            "read_timeout": _safe_int("DB_READ_TIMEOUT_SECONDS", 5),
            "write_timeout": _safe_int("DB_WRITE_TIMEOUT_SECONDS", 5),
            "charset": "utf8mb4",
        }

    def _create_engine(self) -> Engine:
        url = _normalize_mysql_url(DATABASE_URL)
        return create_engine(
            url,
            pool_pre_ping=True,
            pool_recycle=1800,
            connect_args=self._mysql_connect_args(),
        )

    def _init_connection(self) -> None:
        if self.configured_mysql:
            try:
                self._conn = self._connect_mysql()
                self.mysql_mode = True
                self._last_fallback_reason = None
            except Exception as exc:
                if not self.fallback_enabled:
                    raise
                self._activate_fallback(str(exc))
        else:
            self._conn = self._connect_sqlite(DB_PATH)
            self.mysql_mode = False

        if self.auto_init:
            script = _mysql_bootstrap_script() if self.mysql_mode else _sqlite_bootstrap_script()
            self.executescript(script)
            self.commit()

    def _connect_sqlite(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _connect_mysql(self):
        if self._engine is None:
            self._engine = self._create_engine()
        return self._engine.raw_connection()

    def _activate_fallback(self, reason: str) -> None:
        self._close_current_connection()
        self._conn = self._connect_sqlite(FALLBACK_DB_PATH)
        self.mysql_mode = False
        self._last_fallback_reason = reason
        if self.auto_init:
            self.executescript(_sqlite_bootstrap_script())
            self.commit()

    def _close_current_connection(self) -> None:
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass

    def _adapt_query(self, query: str) -> str:
        if not self.mysql_mode:
            return query
        return query.replace("?", "%s")

    def _is_connection_error(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        indicators = (
            "timeout",
            "timed out",
            "can't connect",
            "cannot connect",
            "connection refused",
            "server has gone away",
            "lost connection",
            "broken pipe",
            "connection reset",
        )
        return any(token in msg for token in indicators)

    def ensure_runtime_mode(self) -> None:
        if self.mysql_mode:
            try:
                if hasattr(self._conn, "ping"):
                    self._conn.ping(reconnect=False)
                else:
                    cur = self._conn.cursor()
                    cur.execute("SELECT 1")
                    cur.close()
            except Exception as exc:
                if self.configured_mysql and self.fallback_enabled and self._is_connection_error(exc):
                    self._activate_fallback(str(exc))
            return

        if not self.is_fallback_mode():
            return

        now = time.time()
        if now - self._last_recovery_attempt < self.recovery_check_seconds:
            return
        self._last_recovery_attempt = now
        self._try_recover_primary()

    def execute(self, query: str, params: tuple | list | None = None):
        params = params or ()
        if self.mysql_mode:
            try:
                cursor = self._conn.cursor(pymysql.cursors.DictCursor)
                cursor.execute(self._adapt_query(query), params)
                return _ResultAdapter(cursor, mysql_mode=True)
            except Exception as exc:
                if self.configured_mysql and self.fallback_enabled and self._is_connection_error(exc):
                    self._activate_fallback(str(exc))
                raise

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
        self._close_current_connection()

    def is_fallback_mode(self) -> bool:
        return self.configured_mysql and not self.mysql_mode

    def enqueue_sync_event(self, entity: str, entity_key: str, payload: dict) -> None:
        if not self.is_fallback_mode():
            return

        event_id = str(uuid.uuid4())
        payload_json = json.dumps(payload, ensure_ascii=False)
        self.execute(
            """
            INSERT INTO sync_outbox (event_id, source_instance, entity, entity_key, payload_json, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
            """,
            (event_id, self.instance_id, entity, entity_key, payload_json, _utc_now_iso()),
        )

    def pending_sync_count(self) -> int:
        if not self.is_fallback_mode():
            return 0
        row = self.execute("SELECT COUNT(1) AS c FROM sync_outbox WHERE status='pending'").fetchone()
        return int(row["c"] if row else 0)

    def runtime_status(self) -> dict:
        mode = "primary" if self.mysql_mode else ("fallback" if self.is_fallback_mode() else "sqlite")
        return {
            "mode": mode,
            "configured_backend": "mysql" if self.configured_mysql else "sqlite",
            "fallback_enabled": self.fallback_enabled,
            "instance_id": self.instance_id,
            "fallback_reason": self._last_fallback_reason,
            "pending_sync_events": self.pending_sync_count(),
            "fallback_db_path": str(FALLBACK_DB_PATH),
        }

    def _try_recover_primary(self) -> None:
        try:
            primary_conn = self._connect_mysql()
        except Exception as exc:
            self._last_fallback_reason = str(exc)
            return

        try:
            synced = self._sync_fallback_outbox_to_primary(primary_conn)
            if not synced:
                try:
                    primary_conn.close()
                except Exception:
                    pass
                return
        except Exception as exc:
            try:
                primary_conn.close()
            except Exception:
                pass
            self._last_fallback_reason = str(exc)
            return

        self._close_current_connection()
        self._conn = primary_conn
        self.mysql_mode = True
        self._last_fallback_reason = None

        if self.auto_init:
            self.executescript(_mysql_bootstrap_script())
            self.commit()

    def _sync_fallback_outbox_to_primary(self, primary_conn) -> bool:
        pending_count = self.pending_sync_count()
        if pending_count == 0:
            return True

        primary_cursor = primary_conn.cursor(pymysql.cursors.DictCursor)
        try:
            primary_cursor.execute(_adapt_mysql_placeholders("SELECT GET_LOCK(?, 0) AS lock_ok"), (self.sync_lock_name,))
            lock_row = primary_cursor.fetchone() or {}
            if int(lock_row.get("lock_ok") or 0) != 1:
                return False

            self._ensure_primary_sync_tables(primary_conn)

            while True:
                pending = self.execute(
                    """
                    SELECT id, event_id, source_instance, entity, entity_key, payload_json
                    FROM sync_outbox
                    WHERE status='pending'
                    ORDER BY id ASC
                    LIMIT ?
                    """,
                    (self.sync_batch_size,),
                ).fetchall()

                if not pending:
                    break

                for evt in pending:
                    try:
                        payload = json.loads(evt["payload_json"])
                        self._apply_event_to_primary(primary_conn, evt, payload)
                        self.execute(
                            "UPDATE sync_outbox SET status='synced', synced_at=?, attempts=attempts+1, last_error=NULL WHERE id=?",
                            (_utc_now_iso(), evt["id"]),
                        )
                        self.commit()
                    except Exception as exc:
                        self.execute(
                            "UPDATE sync_outbox SET attempts=attempts+1, last_error=? WHERE id=?",
                            (str(exc), evt["id"]),
                        )
                        self.commit()
                        raise
            return True
        finally:
            try:
                primary_cursor.execute(_adapt_mysql_placeholders("SELECT RELEASE_LOCK(?)"), (self.sync_lock_name,))
            except Exception:
                pass
            primary_cursor.close()

    def _ensure_primary_sync_tables(self, primary_conn) -> None:
        cur = primary_conn.cursor()
        try:
            statements = [s.strip() for s in _mysql_sync_tables_script().split(";") if s.strip()]
            for stmt in statements:
                cur.execute(stmt)
            primary_conn.commit()
        finally:
            cur.close()

    def _apply_event_to_primary(self, primary_conn, event_row: dict, payload: dict) -> None:
        cur = primary_conn.cursor(pymysql.cursors.DictCursor)
        try:
            try:
                cur.execute(
                    _adapt_mysql_placeholders(
                        """
                        INSERT INTO fallback_sync_events (event_id, source_instance, entity, entity_key, created_at)
                        VALUES (?, ?, ?, ?, NOW())
                        """
                    ),
                    (
                        event_row["event_id"],
                        event_row["source_instance"],
                        event_row["entity"],
                        event_row["entity_key"],
                    ),
                )
            except Exception as exc:
                if "duplicate" in str(exc).lower():
                    primary_conn.rollback()
                    return
                raise

            entity = event_row["entity"]
            if entity == "aviso_embarque":
                self._upsert_aviso_primary(cur, payload)
            elif entity == "nfe_label_data":
                self._upsert_nfe_label_primary(cur, payload)
            else:
                raise RuntimeError(f"Entidade não suportada no sync: {entity}")

            primary_conn.commit()
        except Exception:
            primary_conn.rollback()
            raise
        finally:
            cur.close()

    def _upsert_aviso_primary(self, cur, payload: dict) -> None:
        id_meta = payload.get("id_meta")
        if not id_meta:
            raise RuntimeError("Evento aviso_embarque sem id_meta")

        incoming_ts = _parse_ts(payload.get("updated_at"))
        cur.execute(_adapt_mysql_placeholders("SELECT updated_at FROM avisos_embarque WHERE id_meta=?"), (id_meta,))
        row = cur.fetchone()
        if row:
            current_ts = _parse_ts(row.get("updated_at"))
            if current_ts and incoming_ts and current_ts > incoming_ts:
                return

        cur.execute(
            _adapt_mysql_placeholders(
                """
                INSERT INTO avisos_embarque (
                    id_meta, chave_nfe, num_nf, fabrica, doca, local_entrega,
                    call_delivery, cod_cliente, emitente_nome, emitente_cnpj,
                    emitente_endereco, destinatario_nome, destinatario_cnpj,
                    data_emissao_nfe, serie_nfe, nat_operacao, itens_json,
                    mapeamento_swpaas_id, mapeamento_nome,
                    xml_asn_gerado, rnd004_path, rnd004_length,
                    created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE
                    chave_nfe=VALUES(chave_nfe),
                    num_nf=VALUES(num_nf),
                    fabrica=VALUES(fabrica),
                    doca=VALUES(doca),
                    local_entrega=VALUES(local_entrega),
                    call_delivery=VALUES(call_delivery),
                    cod_cliente=VALUES(cod_cliente),
                    emitente_nome=VALUES(emitente_nome),
                    emitente_cnpj=VALUES(emitente_cnpj),
                    emitente_endereco=VALUES(emitente_endereco),
                    destinatario_nome=VALUES(destinatario_nome),
                    destinatario_cnpj=VALUES(destinatario_cnpj),
                    data_emissao_nfe=VALUES(data_emissao_nfe),
                    serie_nfe=VALUES(serie_nfe),
                    nat_operacao=VALUES(nat_operacao),
                    itens_json=VALUES(itens_json),
                    mapeamento_swpaas_id=VALUES(mapeamento_swpaas_id),
                    mapeamento_nome=VALUES(mapeamento_nome),
                    xml_asn_gerado=VALUES(xml_asn_gerado),
                    rnd004_path=VALUES(rnd004_path),
                    rnd004_length=VALUES(rnd004_length),
                    created_at=VALUES(created_at),
                    updated_at=VALUES(updated_at)
                """
            ),
            (
                payload.get("id_meta"),
                payload.get("chave_nfe"),
                payload.get("num_nf"),
                payload.get("fabrica"),
                payload.get("doca"),
                payload.get("local_entrega"),
                payload.get("call_delivery"),
                payload.get("cod_cliente"),
                payload.get("emitente_nome"),
                payload.get("emitente_cnpj"),
                payload.get("emitente_endereco"),
                payload.get("destinatario_nome"),
                payload.get("destinatario_cnpj"),
                payload.get("data_emissao_nfe"),
                payload.get("serie_nfe"),
                payload.get("nat_operacao"),
                payload.get("itens_json") or "[]",
                payload.get("mapeamento_swpaas_id"),
                payload.get("mapeamento_nome"),
                payload.get("xml_asn_gerado"),
                payload.get("rnd004_path"),
                payload.get("rnd004_length"),
                payload.get("created_at") or _utc_now_iso(),
                payload.get("updated_at") or _utc_now_iso(),
            ),
        )

    def _upsert_nfe_label_primary(self, cur, payload: dict) -> None:
        chave = payload.get("chave_acesso")
        if not chave:
            raise RuntimeError("Evento nfe_label_data sem chave_acesso")

        incoming_ts = _parse_ts(payload.get("updated_at"))
        cur.execute(_adapt_mysql_placeholders("SELECT updated_at FROM nfe_label_data WHERE chave_acesso=?"), (chave,))
        row = cur.fetchone()
        if row:
            current_ts = _parse_ts(row.get("updated_at"))
            if current_ts and incoming_ts and current_ts > incoming_ts:
                return

        cur.execute(
            _adapt_mysql_placeholders(
                """
                INSERT INTO nfe_label_data (chave_acesso, etiquetas_json, updated_at, updated_by)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    etiquetas_json = VALUES(etiquetas_json),
                    updated_at = VALUES(updated_at),
                    updated_by = VALUES(updated_by)
                """
            ),
            (
                payload.get("chave_acesso"),
                payload.get("etiquetas_json") or "[]",
                payload.get("updated_at") or _utc_now_iso(),
                payload.get("updated_by"),
            ),
        )


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

    CREATE TABLE IF NOT EXISTS sync_outbox (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id        TEXT UNIQUE NOT NULL,
        source_instance TEXT NOT NULL,
        entity          TEXT NOT NULL,
        entity_key      TEXT NOT NULL,
        payload_json    TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        synced_at       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_id ON sync_outbox(status, id);
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

    CREATE TABLE IF NOT EXISTS fallback_sync_events (
        event_id        VARCHAR(64) PRIMARY KEY,
        source_instance VARCHAR(255) NOT NULL,
        entity          VARCHAR(64) NOT NULL,
        entity_key      VARCHAR(255) NOT NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_sync_entity_key (entity, entity_key)
    );
    """


def _mysql_sync_tables_script() -> str:
    return """
    CREATE TABLE IF NOT EXISTS fallback_sync_events (
        event_id        VARCHAR(64) PRIMARY KEY,
        source_instance VARCHAR(255) NOT NULL,
        entity          VARCHAR(64) NOT NULL,
        entity_key      VARCHAR(255) NOT NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_sync_entity_key (entity, entity_key)
    );
    """


def _adapt_mysql_placeholders(query: str) -> str:
    return query.replace("?", "%s")


def init_db() -> DBConnection:
    return DBConnection()


_conn: DBConnection | None = None


def db() -> DBConnection:
    global _conn
    if _conn is None:
        _conn = init_db()
    _conn.ensure_runtime_mode()
    return _conn


def is_mysql() -> bool:
    if _conn is not None:
        return _conn.mysql_mode
    return _is_mysql_url(DATABASE_URL)


def db_runtime_status() -> dict:
    return db().runtime_status()
