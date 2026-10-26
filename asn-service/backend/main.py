"""
main.py — FastAPI: ASN Service (Etiqueta + Aviso de Embarque)

Porta: 8003  (8000=umbrella, 8001=monolito, 8002=GateVirtual)
DB:    asn.db (SQLite dedicado, isolado do monolito)

Endpoints:
  GET    /health
  GET    /api/avisos-embarque?id_meta=X
  POST   /api/avisos-embarque
  PUT    /api/avisos-embarque/{id}
  POST   /api/avisos-embarque/{id}/gerar
  GET    /api/avisos-embarque/{id}/download-rnd004
  GET    /api/mapeamentos
  GET    /api/labels/nfes/{chave_acesso}
  POST   /api/labels/nfes/{chave_acesso}/save
  POST   /api/labels/sequence/generate
  POST   /api/labels/xml-asn
  POST   /api/labels/render
  GET    /api/swpaas/mrt-file/{version_id}
  GET    /api/labels/mrt/{filename}
  GET    /api/swpaas/report-labels
  POST   /api/swpaas/logos
  GET    /api/intercambios/s3-download
  GET    /api/swpaas/env
"""

import io
import base64
import hashlib
import hmac
import json
import logging
import os
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List
from collections import defaultdict
import time

from dotenv import load_dotenv
import httpx
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

# Carrega .env local antes de importar módulos que lêem os envs
load_dotenv(Path(__file__).parent / ".env")

import swpaas_client as swpaas
from asn_generator import gerar_xml_asn, parse_itens_json, validate_xml_asn
from db import db, db_runtime_status, is_mysql
from models import (
    AvisoEmbarqueCreate,
    AvisoEmbarqueUpdate,
    GerarRequest,
    GerarResponse,
)

logger = logging.getLogger("asn")


# ── Lifespan ────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Inicializa DB (cria tabelas se necessário)
    db()
    yield


# ── App ─────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="ASN Service — Etiqueta + Aviso de Embarque",
    description=(
        "Microsserviço dedicado à geração de Avisos de Embarque (ASN/DESADV/856) "
        "e impressão de etiquetas ODETTE/VDA via Stimulsoft + SwPaaS."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5175",   # Frontend ASN (dev)
        "http://localhost:5174",   # Frontend monolito (dev) — cross-service calls
        "http://localhost:5173",
        "http://localhost:3000",   # Umbrella Hub
        "http://localhost:3001",   # Umbrella Experience / GateVirtual frontend
        "http://localhost:3005",   # GateVirtual-Enzo frontend (dev)
        "http://localhost:8004",   # GateVirtual-Enzo backend (dev)
        "http://localhost:8005",   # Swpaas-Enzo backend (dev)
        "https://hub.taggen.net",
        "https://*.taggen.net",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STARTED_AT = time.time()
REQUEST_COUNTER = defaultdict(int)
PUBLIC_API_PATHS = {
    "/api/auth/token/exchange",
    "/api/auth/session",
    "/api/auth/session/validate",
}


@app.middleware("http")
async def collect_request_stats(request: Request, call_next):
    if request.method != "OPTIONS" and request.url.path.startswith("/api"):
        if request.url.path not in PUBLIC_API_PATHS:
            _extract_and_validate_temp_token_from_request(request)

    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api/stimulsoft"):
        REQUEST_COUNTER["stimulsoft"] += 1
    elif path.startswith("/api"):
        REQUEST_COUNTER["asn_api"] += 1
    else:
        REQUEST_COUNTER["system"] += 1
    return response


# ── Helpers ─────────────────────────────────────────────────────────────────────
def _row_to_dict(row) -> dict:
    return dict(row) if row else None


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _get_stimulsoft_base_url() -> str:
    return os.getenv("STIMULSOFT_BASE_URL", "http://127.0.0.1:5055").rstrip("/")


def _request_public_origin(request: Optional[Request]) -> str:
    if request is None:
        return ""
    headers = request.headers
    host = (headers.get("x-forwarded-host") or headers.get("host") or "").split(",")[0].strip()
    if not host:
        return ""
    # O nginx do container repassa X-Forwarded-Proto=$scheme (http atrás do ALB), e o ALB
    # responde 301 para chamadas http; por isso só localhost usa http.
    is_local = host.split(":")[0] in {"localhost", "127.0.0.1"}
    return f"{'http' if is_local else 'https'}://{host}"


def _get_report_service_url(request: Optional[Request] = None) -> str:
    """Base do report-sat. Inclui /reports quando a chamada passa pelo nginx do satélite.

    Local: http://127.0.0.1:5000
    HML/PRD: REPORT_SERVICE_URL (URL completa) ou REPORT_BASE_PATH (ex.: /report-g-prd),
    resolvido sobre REPORT_PUBLIC_ORIGIN ou sobre o host público da requisição recebida.
    """
    raw = (
        os.getenv("REPORT_SERVICE_URL")
        or os.getenv("REPORT_SERVICE_INTERNAL_URL")
        or ""
    ).strip().rstrip("/")
    if raw:
        return raw

    base_path = os.getenv("REPORT_BASE_PATH", "").strip().strip("/")
    if base_path:
        origin = (
            os.getenv("REPORT_PUBLIC_ORIGIN", "").strip().rstrip("/")
            or _request_public_origin(request)
        )
        if origin:
            return f"{origin}/{base_path}/reports"

    return "http://127.0.0.1:5000"


def _report_prepare_body(mrt_content: str, data: str) -> dict:
    content = (data or "").strip()
    is_xml = content.startswith("<")
    return {
        "mrtContent": mrt_content,
        "xmlData": content if is_xml else "",
        "jsonData": "" if is_xml else content,
        "datasetName": "DATASET",
        "resourceName": "DATASET",
    }


def _token_validation_headers(token: str) -> dict:
    client_id = os.getenv("SATELLITE_CLIENT_ID", "")
    satellite_hash = os.getenv("SATELLITE_SECRET_KEY", "")
    if not client_id or not satellite_hash:
        raise HTTPException(
            status_code=500,
            detail="SATELLITE_CLIENT_ID/SATELLITE_SECRET_KEY não configurados.",
        )
    return {
        "Authorization": f"Bearer {token}",
        "X-Client-Id": client_id,
        "X-Satellite-Hash": satellite_hash,
    }


def _sign_temp_access_token(payload: dict, ttl_seconds: int) -> str:
    secret = os.getenv("TEMP_TOKEN_SECRET") or os.getenv("SATELLITE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_SECRET não configurado.")

    algorithm = os.getenv("TEMP_TOKEN_ALGORITHM", "HS256")
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=ttl_seconds)
    claims = {
        "iss": "asn-unified-service",
        "aud": "asn-service",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        **payload,
    }
    return _jwt_encode_hs256(claims, secret, algorithm)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _jwt_encode_hs256(claims: dict, secret: str, algorithm: str) -> str:
    if algorithm != "HS256":
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_ALGORITHM suportado: HS256.")
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    claims_b64 = _b64url_encode(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{claims_b64}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{claims_b64}.{_b64url_encode(signature)}"


def _jwt_decode_hs256(token: str, secret: str, algorithm: str) -> dict:
    if algorithm != "HS256":
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_ALGORITHM suportado: HS256.")

    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=401, detail="Token temporário inválido.")

    header_b64, claims_b64, signature_b64 = parts
    signing_input = f"{header_b64}.{claims_b64}".encode("ascii")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    provided_sig = _b64url_decode(signature_b64)

    if not hmac.compare_digest(expected_sig, provided_sig):
        raise HTTPException(status_code=401, detail="Token temporário inválido.")

    claims = json.loads(_b64url_decode(claims_b64).decode("utf-8"))
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if int(claims.get("exp", 0)) < now_ts:
        raise HTTPException(status_code=401, detail="Token temporário expirado.")
    if claims.get("aud") != "asn-service":
        raise HTTPException(status_code=401, detail="Token temporário inválido.")
    return claims


def _require_temp_token(
    authorization: Optional[str] = Header(None),
    sat_tmp_auth: Optional[str] = Cookie(default=None),
) -> dict:
    enforce = os.getenv("REQUIRE_TEMP_TOKEN", "false").lower() in {"1", "true", "yes", "on"}
    if not enforce:
        return {"mode": "bypass"}

    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        token = (sat_tmp_auth or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token temporário obrigatório.")
    secret = os.getenv("TEMP_TOKEN_SECRET") or os.getenv("SATELLITE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_SECRET não configurado.")

    algorithm = os.getenv("TEMP_TOKEN_ALGORITHM", "HS256")
    return _jwt_decode_hs256(token, secret, algorithm)


def _extract_and_validate_temp_token_from_request(request: Request) -> dict:
    enforce = os.getenv("REQUIRE_TEMP_TOKEN", "false").lower() in {"1", "true", "yes", "on"}
    if not enforce:
        return {"mode": "bypass"}

    bearer = request.headers.get("authorization", "")
    token = ""
    if bearer.startswith("Bearer "):
        token = bearer.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get("sat_tmp_auth", "").strip()

    if not token:
        raise HTTPException(status_code=401, detail="Token temporário obrigatório.")

    secret = os.getenv("TEMP_TOKEN_SECRET") or os.getenv("SATELLITE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_SECRET não configurado.")

    algorithm = os.getenv("TEMP_TOKEN_ALGORITHM", "HS256")
    return _jwt_decode_hs256(token, secret, algorithm)


def _compact_principal(principal: dict) -> dict:
    """Mantém só identidade. O /me do Hub inteiro estoura o limite do cookie."""
    if not isinstance(principal, dict):
        return {}
    user = principal.get("user") if isinstance(principal.get("user"), dict) else {}
    compact = {
        "email": principal.get("email") or principal.get("mail") or user.get("email") or user.get("mail") or "",
        "name": principal.get("name") or user.get("name") or "",
        "sub": principal.get("sub") or user.get("sub") or "",
    }
    if user.get("email") or user.get("mail"):
        compact["user"] = {
            "email": user.get("email") or user.get("mail") or "",
            "name": user.get("name") or "",
        }
    return {key: value for key, value in compact.items() if value}


def _extract_email_from_claims(claims: dict) -> str:
    principal = claims.get("principal") or {}
    if isinstance(principal, dict):
        direct = principal.get("email") or principal.get("mail")
        if isinstance(direct, str) and direct.strip():
            return direct.strip().lower()

        nested_user = principal.get("user")
        if isinstance(nested_user, dict):
            nested = nested_user.get("email") or nested_user.get("mail")
            if isinstance(nested, str) and nested.strip():
                return nested.strip().lower()

    root_email = claims.get("email") or claims.get("mail")
    if isinstance(root_email, str) and root_email.strip():
        return root_email.strip().lower()
    return ""


def _is_sawluz_email(email: str) -> bool:
    return email.endswith("@sawluz.com.br")


def _require_sawluz_operator(claims: dict = Depends(_require_temp_token)) -> dict:
    email = _extract_email_from_claims(claims)
    if not email:
        raise HTTPException(status_code=403, detail="Usuário sem e-mail no contexto Umbrella.")
    if not _is_sawluz_email(email):
        raise HTTPException(status_code=403, detail="Acesso restrito a usuários @sawluz.com.br.")
    return claims


def _is_local_origin(origin: str) -> bool:
    o = (origin or "").lower()
    return "localhost" in o or "127.0.0.1" in o


def _require_admin_migration_token(request: Request) -> None:
    expected = os.getenv("MIGRATIONS_ADMIN_TOKEN", "").strip()
    if not expected:
        return
    provided = request.headers.get("x-admin-token", "").strip()
    if provided != expected:
        raise HTTPException(status_code=403, detail="Admin token inválido para migrações.")


def _run_alembic(*args: str) -> dict:
    backend_dir = Path(__file__).parent
    alembic_ini = backend_dir / "alembic.ini"
    cmd = ["alembic", "-c", str(alembic_ini), *args]
    env = os.environ.copy()

    proc = subprocess.run(
        cmd,
        cwd=str(backend_dir),
        env=env,
        capture_output=True,
        text=True,
    )
    return {
        "ok": proc.returncode == 0,
        "code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "command": " ".join(cmd),
    }


# ── Health ───────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health():
    try:
        conn = db()
        conn.execute("SELECT 1")
        return {
            "status": "ok",
            "service": "asn-service",
            "port": 8003,
            "swpaas_env": os.getenv("SWPAAS_ENV", "hml"),
            "database_url": os.getenv("DATABASE_URL", "sqlite:///backend/asn.db"),
            "database_runtime": conn.runtime_status(),
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


class M2MExchangeRequest(BaseModel):
    m2m_token: Optional[str] = None
    ttl_seconds: Optional[int] = None
    scope: Optional[str] = "satellite:access"


class SessionTokenRequest(BaseModel):
    token: str


class MigrationUpgradeRequest(BaseModel):
    revision: str = "head"


@app.post("/api/auth/token/exchange", tags=["Auth"])
async def exchange_m2m_token(payload: M2MExchangeRequest, authorization: str = Header(None)):
    """
    Recebe token M2M do backend satélite, valida no Hub Umbrella e retorna
    um token temporário assinado localmente para autorização das chamadas.
    """
    incoming = payload.m2m_token
    if not incoming and authorization and authorization.startswith("Bearer "):
        incoming = authorization.split(" ", 1)[1].strip()
    if not incoming:
        raise HTTPException(status_code=400, detail="m2m_token obrigatório.")

    umbrella_api = os.getenv("UMBRELLA_API_URL", "").rstrip("/")
    if not umbrella_api:
        raise HTTPException(status_code=500, detail="UMBRELLA_API_URL não configurado.")

    validate_url = f"{umbrella_api}/api/common/v1/external-satellite/me"
    timeout = float(os.getenv("UMBRELLA_TIMEOUT_SECONDS", "5"))

    async with httpx.AsyncClient(timeout=timeout) as client:
        validation = await client.get(validate_url, headers=_token_validation_headers(incoming))

    if validation.status_code != 200:
        raise HTTPException(status_code=401, detail="Token m2m inválido no Umbrella.")

    principal = validation.json()
    max_ttl = int(os.getenv("TEMP_TOKEN_TTL_SECONDS", "300"))
    ttl = min(max(payload.ttl_seconds or max_ttl, 60), max_ttl)

    access_token = _sign_temp_access_token(
        {
            "scope": payload.scope,
            "client_id": os.getenv("SATELLITE_CLIENT_ID", ""),
            "principal": _compact_principal(principal),
        },
        ttl,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": ttl,
    }


@app.get("/api/admin/migrations/status", tags=["Admin"])
def migrations_status(request: Request, _claims: dict = Depends(_require_sawluz_operator)):
    _require_admin_migration_token(request)
    current = _run_alembic("current")
    history = _run_alembic("history", "--verbose")
    return {"current": current, "history": history}


@app.post("/api/admin/migrations/upgrade", tags=["Admin"])
def migrations_upgrade(payload: MigrationUpgradeRequest, request: Request, _claims: dict = Depends(_require_sawluz_operator)):
    _require_admin_migration_token(request)
    result = _run_alembic("upgrade", payload.revision)
    status_code = 200 if result["ok"] else 500
    return Response(
        content=json.dumps(result, ensure_ascii=False),
        media_type="application/json",
        status_code=status_code,
    )


@app.post("/api/auth/session", tags=["Auth"])
def create_front_session(payload: SessionTokenRequest, request: Request, response: Response):
    """
    Recebe token temporário no handshake do iframe, valida e guarda em cookie HttpOnly.
    O frontend não precisa armazenar token sensível.
    """
    secret = os.getenv("TEMP_TOKEN_SECRET") or os.getenv("SATELLITE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_SECRET não configurado.")

    algorithm = os.getenv("TEMP_TOKEN_ALGORITHM", "HS256")
    claims = _jwt_decode_hs256(payload.token, secret, algorithm)

    max_age = max(1, int(claims.get("exp", int(datetime.now(timezone.utc).timestamp()) + 60) - int(datetime.now(timezone.utc).timestamp())))
    origin = request.headers.get("origin", "")
    is_local = _is_local_origin(origin)
    prefix = (request.headers.get("x-forwarded-prefix") or "").strip().rstrip("/")
    cookie_path = f"{prefix}/" if prefix.startswith("/") else "/"

    response.set_cookie(
        key="sat_tmp_auth",
        value=payload.token,
        httponly=True,
        secure=not is_local,
        samesite="none" if not is_local else "lax",
        max_age=max_age,
        path=cookie_path,
    )

    return {
        "authenticated": True,
        "expires_in": max_age,
        "scope": claims.get("scope"),
    }


@app.get("/api/auth/session/validate", tags=["Auth"])
def validate_front_session(
    request: Request,
    sat_tmp_auth: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
):
    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        token = (sat_tmp_auth or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sessão não autenticada.")

    secret = os.getenv("TEMP_TOKEN_SECRET") or os.getenv("SATELLITE_JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="TEMP_TOKEN_SECRET não configurado.")
    algorithm = os.getenv("TEMP_TOKEN_ALGORITHM", "HS256")
    claims = _jwt_decode_hs256(token, secret, algorithm)
    email = _extract_email_from_claims(claims)

    return {
        "authenticated": True,
        "client_id": claims.get("client_id"),
        "scope": claims.get("scope"),
        "exp": claims.get("exp"),
        "email": email,
        "is_sawluz": _is_sawluz_email(email) if email else False,
    }


@app.get("/api/me", tags=["Auth"])
def get_me(claims: dict = Depends(_require_temp_token)):
    principal = claims.get("principal") or {}
    email = _extract_email_from_claims(claims)
    if isinstance(principal, dict):
        return {
            **principal,
            "email": email or principal.get("email") or principal.get("mail") or "",
            "is_sawluz": _is_sawluz_email(email) if email else False,
        }
    return {
        "email": email,
        "is_sawluz": _is_sawluz_email(email) if email else False,
    }


@app.get("/api/system/health", tags=["System"])
async def unified_health(request: Request, _claims: dict = Depends(_require_sawluz_operator)):
    """Health consolidado do ASN, do report-sat e do Stimulsoft legado."""
    stimulsoft_base = _get_stimulsoft_base_url()

    asn_status = "ok"
    asn_db = {}
    try:
        conn = db()
        conn.execute("SELECT 1")
        asn_db = conn.runtime_status()
        if asn_db.get("mode") == "fallback":
            asn_status = "degraded"
    except Exception:
        asn_status = "error"
        asn_db = {"mode": "error"}

    stimulsoft_status = "error"
    stimulsoft_detail = None
    report_base = _get_report_service_url(request)
    report_status = "error"
    report_detail = None

    async with httpx.AsyncClient(timeout=3.0) as client:
        try:
            r = await client.get(f"{stimulsoft_base}/health")
            if r.status_code == 200:
                stimulsoft_status = "ok"
                stimulsoft_detail = r.json()
            else:
                stimulsoft_detail = {"status_code": r.status_code}
        except Exception as exc:
            stimulsoft_detail = {"error": str(exc)}

        try:
            report_response = await client.get(f"{report_base}/health")
            if report_response.status_code == 200:
                report_status = "ok"
                report_detail = report_response.json()
            else:
                report_detail = {"status_code": report_response.status_code}
        except Exception as exc:
            report_detail = {"error": str(exc)}

    overall = "ok" if asn_status == "ok" and report_status == "ok" else "degraded"
    return {
        "status": overall,
        "services": {
            "asn": {"status": asn_status, "port": 8003, "database": asn_db},
            "report": {"status": report_status, "base_url": report_base, "detail": report_detail},
            "stimulsoft": {"status": stimulsoft_status, "base_url": stimulsoft_base, "detail": stimulsoft_detail},
        },
        "timestamp": _now_iso(),
    }


@app.get("/api/system/stats", tags=["System"])
def unified_stats(_claims: dict = Depends(_require_sawluz_operator)):
    """Estatísticas gerais para tela de operações."""
    conn = db()
    avisos = conn.execute("SELECT COUNT(1) AS c FROM avisos_embarque").fetchone()["c"]
    labels = conn.execute("SELECT COUNT(1) AS c FROM nfe_label_data").fetchone()["c"]

    return {
        "service": "asn-unified",
        "uptime_seconds": int(time.time() - STARTED_AT),
        "database": {
            "avisos_embarque": avisos,
            "nfe_labels": labels,
            "runtime": db_runtime_status(),
        },
        "requests": {
            "asn_api": REQUEST_COUNTER["asn_api"],
            "stimulsoft": REQUEST_COUNTER["stimulsoft"],
            "system": REQUEST_COUNTER["system"],
        },
    }


class LabelRenderRequest(BaseModel):
    mrtContent: str
    data: str = ""


@app.post("/api/labels/render", tags=["Etiquetas"])
async def render_label_pdf(req: LabelRenderRequest, request: Request):
    """Gera o PDF da etiqueta no report-sat (PrepareReport + GetPdf)."""
    if not (req.mrtContent or "").strip():
        raise HTTPException(status_code=400, detail="mrtContent é obrigatório.")

    base = _get_report_service_url(request)
    body = _report_prepare_body(req.mrtContent, req.data)
    pdf = None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(110.0, connect=10.0)) as client:
            prepared = await client.post(f"{base}/api/Viewer/PrepareReport", json=body)
            if prepared.status_code >= 400:
                detail = (prepared.text or "")[:500] or f"HTTP {prepared.status_code}"
                raise HTTPException(
                    status_code=502,
                    detail=f"Report recusou a etiqueta ({prepared.status_code}): {detail}",
                )
            try:
                payload = prepared.json()
            except ValueError:
                payload = None
            report_id = payload.get("reportId") if isinstance(payload, dict) else None
            if not report_id:
                snippet = (prepared.text or "")[:300]
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"Report não retornou reportId em {base}/api/Viewer/PrepareReport "
                        f"(HTTP {prepared.status_code}, {prepared.headers.get('content-type', '?')}): {snippet}"
                    ),
                )

            pdf = await client.get(
                f"{base}/api/Viewer/GetPdf",
                params={"reportId": report_id},
            )
            if pdf.status_code >= 400 or not pdf.content:
                detail = (pdf.text or "")[:500] or f"HTTP {pdf.status_code}"
                raise HTTPException(
                    status_code=502,
                    detail=f"Report não gerou o PDF ({pdf.status_code}): {detail}",
                )
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Tempo esgotado ao gerar a etiqueta em {base}.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Não foi possível conectar ao report em {base} "
                f"({type(exc).__name__}: {exc}). "
                "Defina REPORT_SERVICE_URL no ASN de HML e PRD."
            ),
        ) from exc
    except Exception as exc:
        logger.exception("Falha ao gerar etiqueta no report %s", base)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao gerar etiqueta no report {base}: {type(exc).__name__}: {exc}",
        ) from exc

    return Response(
        content=pdf.content,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=etiqueta.pdf"},
    )


@app.api_route("/api/stimulsoft/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def stimulsoft_proxy(path: str, request: Request):
    """Proxy interno para expor o Stimulsoft sob o mesmo backend ASN."""
    target = f"{_get_stimulsoft_base_url()}/{path.lstrip('/')}"
    body = await request.body()

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "content-length", "connection"}
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        upstream = await client.request(
            method=request.method,
            url=target,
            headers=headers,
            content=body,
            params=request.query_params,
        )

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
    )


# ══════════════════════════════════════════════════════════════════════════════
# AVISOS DE EMBARQUE
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/avisos-embarque", tags=["Avisos de Embarque"])
def get_aviso(id_meta: str = Query(..., description="IdMeta do intercâmbio")):
    """Retorna o aviso de embarque salvo para um IdMeta, ou null se não existir."""
    row = db().execute(
        "SELECT * FROM avisos_embarque WHERE id_meta = ?", (id_meta,)
    ).fetchone()
    if not row:
        return None
    return _row_to_dict(row)


@app.post("/api/avisos-embarque", status_code=201, tags=["Avisos de Embarque"])
def create_aviso(payload: AvisoEmbarqueCreate):
    """Cria um novo aviso de embarque. Retorna { id }."""
    now = _now_iso()
    conn = db()
    try:
        cur = conn.execute(
            """
            INSERT INTO avisos_embarque (
                id_meta, chave_nfe, num_nf, fabrica, doca, local_entrega,
                call_delivery, cod_cliente, emitente_nome, emitente_cnpj,
                emitente_endereco, destinatario_nome, destinatario_cnpj,
                data_emissao_nfe, serie_nfe, nat_operacao, itens_json,
                mapeamento_swpaas_id, mapeamento_nome,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                payload.id_meta, payload.chave_nfe, payload.num_nf,
                payload.fabrica, payload.doca, payload.local_entrega,
                payload.call_delivery, payload.cod_cliente,
                payload.emitente_nome, payload.emitente_cnpj,
                payload.emitente_endereco, payload.destinatario_nome,
                payload.destinatario_cnpj, payload.data_emissao_nfe,
                payload.serie_nfe, payload.nat_operacao,
                payload.itens_json or "[]",
                payload.mapeamento_swpaas_id, payload.mapeamento_nome,
                now, now,
            ),
        )

        saved = conn.execute(
            "SELECT * FROM avisos_embarque WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        if saved:
            conn.enqueue_sync_event("aviso_embarque", payload.id_meta, dict(saved))

        conn.commit()
        return {"id": cur.lastrowid}
    except Exception as exc:
        if "UNIQUE constraint" in str(exc) or "Duplicate entry" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=f"Aviso de embarque já existe para id_meta={payload.id_meta}",
            )
        raise HTTPException(status_code=500, detail=str(exc))


@app.put("/api/avisos-embarque/{aviso_id}", tags=["Avisos de Embarque"])
def update_aviso(aviso_id: int, payload: AvisoEmbarqueUpdate):
    """Atualiza um aviso de embarque existente (auto-save do formulário)."""
    conn = db()
    existing = conn.execute(
        "SELECT id FROM avisos_embarque WHERE id = ?", (aviso_id,)
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail=f"Aviso {aviso_id} não encontrado.")

    updates = []
    values = []
    fields = {
        "chave_nfe": payload.chave_nfe,
        "num_nf": payload.num_nf,
        "fabrica": payload.fabrica,
        "doca": payload.doca,
        "local_entrega": payload.local_entrega,
        "call_delivery": payload.call_delivery,
        "cod_cliente": payload.cod_cliente,
        "emitente_nome": payload.emitente_nome,
        "emitente_cnpj": payload.emitente_cnpj,
        "emitente_endereco": payload.emitente_endereco,
        "destinatario_nome": payload.destinatario_nome,
        "destinatario_cnpj": payload.destinatario_cnpj,
        "data_emissao_nfe": payload.data_emissao_nfe,
        "serie_nfe": payload.serie_nfe,
        "nat_operacao": payload.nat_operacao,
        "itens_json": payload.itens_json,
        "mapeamento_swpaas_id": payload.mapeamento_swpaas_id,
        "mapeamento_nome": payload.mapeamento_nome,
    }
    for col, val in fields.items():
        if val is not None:
            updates.append(f"{col} = ?")
            values.append(val)

    if not updates:
        return {"ok": True, "message": "Nenhum campo para atualizar."}

    updates.append("updated_at = ?")
    values.append(_now_iso())
    values.append(aviso_id)

    conn.execute(
        f"UPDATE avisos_embarque SET {', '.join(updates)} WHERE id = ?",
        values,
    )

    saved = conn.execute(
        "SELECT * FROM avisos_embarque WHERE id = ?",
        (aviso_id,),
    ).fetchone()
    if saved:
        conn.enqueue_sync_event("aviso_embarque", saved["id_meta"], dict(saved))

    conn.commit()
    return {"ok": True}


@app.post("/api/avisos-embarque/{aviso_id}/gerar", tags=["Avisos de Embarque"])
async def gerar_aviso(aviso_id: int, payload: GerarRequest):
    """
    Gera o XML-ASN em memória a partir dos dados do aviso e dos itens,
    faz upload automático no SWPaaS (gzip + base64) e salva o XML no banco.
    Retorna o conteúdo para visualização/download e status do upload.
    """
    conn = db()
    row = conn.execute(
        "SELECT * FROM avisos_embarque WHERE id = ?", (aviso_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Aviso {aviso_id} não encontrado.")

    aviso = dict(row)
    itens = parse_itens_json(aviso.get("itens_json"))

    # Valida campos obrigatórios mínimos
    if not aviso.get("fabrica") or not aviso.get("local_entrega"):
        raise HTTPException(
            status_code=422,
            detail="Campos obrigatórios ausentes: fábrica e/ou local de entrega."
        )
    if not (aviso.get("cod_cliente") or "").strip():
        raise HTTPException(
            status_code=422,
            detail="Campo obrigatório ausente: código do cliente."
        )
    if not itens:
        raise HTTPException(
            status_code=422,
            detail="Nenhum item de produto cadastrado no aviso."
        )

    missing_tipo = [
        idx
        for idx, item in enumerate(itens, start=1)
        if not str(item.get("tipo_fornecimento") or "").strip()
    ]
    if missing_tipo:
        raise HTTPException(
            status_code=422,
            detail=(
                "Campo obrigatório ausente: tipo de fornecimento nos itens "
                + ", ".join(str(i) for i in missing_tipo)
            ),
        )

    if not str(aviso.get("num_nf") or "").strip() or not str(aviso.get("chave_nfe") or "").strip():
        raise HTTPException(
            status_code=422,
            detail="Número e chave da NF-e devem ser carregados a partir do XML antes da geração."
        )

    # ── Gera XML-ASN em memória ────────────────────────────────────────────────
    try:
        xml_content = gerar_xml_asn(aviso, itens)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar XML-ASN: {exc}")

    # ── Valida XML-ASN com XSD + estrutura do XML de exemplo ──────────────────
    try:
        validate_xml_asn(xml_content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro interno na validação do XML-ASN: {exc}")

    xml_bytes = xml_content.encode("utf-8")
    num_nf = aviso.get("num_nf") or "SEM_NF"
    filename = f"ASN_{num_nf}_{aviso_id}.xml"

    # Salva no banco
    conn.execute(
        "UPDATE avisos_embarque SET xml_asn_gerado = ?, rnd004_path = ?, rnd004_length = ?, updated_at = ? WHERE id = ?",
        (xml_content, filename, len(xml_bytes), _now_iso(), aviso_id),
    )

    saved = conn.execute(
        "SELECT * FROM avisos_embarque WHERE id = ?",
        (aviso_id,),
    ).fetchone()
    if saved:
        conn.enqueue_sync_event("aviso_embarque", saved["id_meta"], dict(saved))

    conn.commit()

    # Upload automático para API legado SWPaaS
    try:
        upload_payload = swpaas.build_upload_payload(filename, xml_bytes)
        upload_result = await swpaas.upload_arquivo(upload_payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erro ao enviar XML-ASN para SWPaaS: {exc}")

    return GerarResponse(
        ok=True,
        xml_asn=xml_content,
        path=filename,
        rnd004_length=len(xml_bytes),
        upload_ok=True,
        upload_result=upload_result,
        mensagem=f"XML-ASN gerado e enviado ao SWPaaS com sucesso ({len(itens)} itens).",
    )


@app.get("/api/avisos-embarque/{aviso_id}/download-rnd004", tags=["Avisos de Embarque"])
def download_rnd004(aviso_id: int):
    """Download do XML-ASN gerado (último gerado para este aviso)."""
    row = db().execute(
        "SELECT num_nf, xml_asn_gerado, rnd004_path FROM avisos_embarque WHERE id = ?",
        (aviso_id,),
    ).fetchone()
    if not row or not row["xml_asn_gerado"]:
        raise HTTPException(
            status_code=404,
            detail="XML-ASN não encontrado. Gere o aviso primeiro.",
        )

    content = row["xml_asn_gerado"].encode("utf-8")
    filename = row["rnd004_path"] or f"ASN_{aviso_id}.xml"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ══════════════════════════════════════════════════════════════════════════════
# MAPEAMENTOS EDI (via SwPaaS API — sem DLL local)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/mapeamentos", tags=["Mapeamentos"])
async def list_mapeamentos(
    sentido: str = Query("0", description="0=todos, 1=envio, 2=recepção"),
    nome_entidade: str = Query("0"),
    padrao: str = Query("0"),
    mensagem: str = Query("0", description="Ex: DESADV, 856, 004"),
    versao: str = Query("0"),
):
    """
    Lista mapeamentos EDI via SwPaaS API.
    GET /Admin/GetMapeamentos/{Sentido}/{NomeEntidade}/{Padrao}/{Mensagem}/{Versao}
    """
    try:
        items = await swpaas.get_mapeamentos(
            sentido=sentido,
            nome_entidade=nome_entidade,
            padrao=padrao,
            mensagem=mensagem,
            versao=versao,
        )
        return {"items": items}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SwPaaS GetMapeamentos: {exc}")


# ══════════════════════════════════════════════════════════════════════════════
# SWPAAS PROXIES
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/swpaas/env", tags=["SwPaaS"])
def swpaas_env():
    return {"env": os.getenv("SWPAAS_ENV", "hml")}


@app.get("/api/swpaas/report-labels", tags=["SwPaaS"])
async def list_report_labels(
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
    sortDescending: bool = Query(True),
    currentVersions: bool = Query(True),
    tenantId: int = Query(0),
    ownerId: int = Query(0),
    padrao: Optional[str] = Query(None),
    mensagem: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
):
    """Lista relatórios/etiquetas disponíveis no SwPaaS."""
    try:
        items = await swpaas.get_report_labels(
            page=page,
            page_size=pageSize,
            sort_descending=sortDescending,
            current_versions=currentVersions,
            tenant_id=tenantId,
            owner_id=ownerId,
        )

        filtered = []
        for it in items:
            it_pattern = (it.get("pattern") or "").lower()
            it_msg = (it.get("message") or "").lower()
            it_type = (it.get("type") or "").lower()

            if padrao and padrao.lower() not in it_pattern and it_pattern != "":
                continue
            if mensagem and mensagem.lower() not in it_msg and it_msg != "":
                continue
            if tipo:
                tipo_lower = tipo.lower()
                if tipo_lower == "relatorio" and it_type != "report":
                    continue
                if tipo_lower == "etiqueta" and it_type != "label":
                    continue

            versions = it.get("versions") or [{}]
            current_version = next((v for v in versions if v.get("isCurrent")), versions[0] if versions else {})
            version_id = (
                current_version.get("id")
                or it.get("version_id")
                or it.get("versionId")
                or it.get("id")
            )
            file_name = (
                current_version.get("fileName")
                or it.get("mrt_filename")
                or it.get("template_filename")
                or it.get("fileName")
            )

            filtered.append({
                "id": it.get("id"),
                "nome": it.get("name") or it.get("nome"),
                "mrt_filename": file_name,
                "version_id": version_id,
                "alias_emitente": it.get("ownerName") or it.get("alias_emitente"),
                "alias_destinatario": it.get("tenantName") or it.get("alias_destinatario"),
                "pattern": it.get("pattern"),
                "message": it.get("message"),
                "tipo": it_type,
                "name": it.get("name"),
                "type": it.get("type"),
                "category": it.get("category"),
                "description": it.get("description"),
                "versions": it.get("versions"),
                "currentVersionLabel": it.get("currentVersionLabel"),
                "lastModifiedAt": it.get("lastModifiedAt") or it.get("updatedAt"),
                "createdAt": it.get("createdAt"),
                "lastModifiedBy": it.get("lastModifiedBy") or it.get("updatedBy"),
                "createdBy": it.get("createdBy"),
            })

        return {"items": filtered}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/swpaas/mrt-file/{version_id}", tags=["SwPaaS"])
async def get_mrt_by_version(version_id: str):
    """Retorna conteúdo bruto (.mrt) de um template pelo versionId."""
    try:
        content = await swpaas.get_mrt_content(version_id)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{version_id}.mrt"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/labels/mrt/{filename:path}", tags=["SwPaaS"])
async def get_mrt_by_name(filename: str):
    """Retorna conteúdo bruto (.mrt) de um template pelo nome do arquivo."""
    if not filename.endswith(".mrt"):
        raise HTTPException(status_code=400, detail="Apenas arquivos .mrt são suportados.")
    try:
        content, found_name = await swpaas.get_mrt_by_filename(filename)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{found_name}"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/api/swpaas/logos", tags=["SwPaaS"])
async def logos_proxy(request: Request):
    """Proxy para POST /Admin/GetListEntidadesLogos."""
    entity_ids = await request.json()
    if not isinstance(entity_ids, list):
        raise HTTPException(status_code=400, detail="Body deve ser um array de strings.")
    try:
        return await swpaas.get_logos(entity_ids)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/intercambios/s3-download", tags=["SwPaaS"])
async def s3_download(
    id_meta:     Optional[int] = Query(None, description="IdMeta do intercâmbio ProcNFe"),
    id_meta_ref: Optional[int] = Query(None, description="IdMetaArquivoReferenciado — prefixo preferencial"),
    preview:     bool          = Query(False),
    path_nuvem:  Optional[str] = Query(None),
):
    """
    Busca o conteúdo do ProcNFe via SwPaaS ConteudoArquivo.

    A API SwPaaS é:
      GET /Intercambios/ConteudoArquivo/{IdMetaArquivoReferenciado}/{tipo}

    Regras:
      - Usa SEMPRE id_meta_ref (IdMetaArquivoReferenciado) + tipo='edi'
      - id_meta é usado como fallback somente se id_meta_ref não estiver disponível
      - O monolito usa S3 em PRD (mais rápido); o ASN Service usa sempre SwPaaS
        pois não tem acesso ao S3
    """
    target_id = id_meta_ref or id_meta
    if not target_id:
        raise HTTPException(status_code=400, detail="id_meta_ref (IdMetaArquivoReferenciado) é obrigatório.")
    try:
        content = await swpaas.get_conteudo_arquivo(target_id, tipo="edi")
        return PlainTextResponse(content=content, media_type="text/xml; charset=utf-8")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ══════════════════════════════════════════════════════════════════════════════
# ETIQUETAS — Labels persistence + sequences + xml-asn
# (Mesmas rotas do monolito, banco isolado: asn.db)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/labels/nfes/{chave_acesso}", tags=["Etiquetas"])
def get_nfe_labels(chave_acesso: str):
    """Lê etiquetas salvas para uma NF-e (por chave de acesso). Retorna {etiquetas:[]} se vazio."""
    row = db().execute(
        "SELECT etiquetas_json FROM nfe_label_data WHERE chave_acesso=?",
        (chave_acesso,),
    ).fetchone()
    if not row or not row["etiquetas_json"]:
        return {"etiquetas": []}
    import json as _json
    return {"etiquetas": _json.loads(row["etiquetas_json"])}


class SaveEtiquetasRequest(BaseModel):
    etiquetas: list
    updated_by: Optional[int] = None


@app.post("/api/labels/nfes/{chave_acesso}/save", tags=["Etiquetas"])
def save_nfe_labels(chave_acesso: str, req: SaveEtiquetasRequest):
    """Persiste etiquetas para uma NF-e (upsert por chave_acesso)."""
    import json as _json
    conn = db()
    etiquetas_json = _json.dumps(req.etiquetas, ensure_ascii=False)
    updated_at = _now_iso()
    if is_mysql():
        conn.execute(
            """
            INSERT INTO nfe_label_data (chave_acesso, etiquetas_json, updated_at, updated_by)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                etiquetas_json = VALUES(etiquetas_json),
                updated_at = VALUES(updated_at),
                updated_by = VALUES(updated_by)
            """,
            (chave_acesso, etiquetas_json, updated_at, req.updated_by),
        )
    else:
        conn.execute(
            """
            INSERT INTO nfe_label_data (chave_acesso, etiquetas_json, updated_at, updated_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(chave_acesso) DO UPDATE SET
                etiquetas_json = excluded.etiquetas_json,
                updated_at     = excluded.updated_at,
                updated_by     = excluded.updated_by
            """,
            (chave_acesso, etiquetas_json, updated_at, req.updated_by),
        )

    if conn.is_fallback_mode():
        conn.enqueue_sync_event(
            "nfe_label_data",
            chave_acesso,
            {
                "chave_acesso": chave_acesso,
                "etiquetas_json": etiquetas_json,
                "updated_at": updated_at,
                "updated_by": req.updated_by,
            },
        )

    conn.commit()
    return {"status": "ok"}


# ── Sequências UM/UC ─────────────────────────────────────────────────────────

class SequenceRequest(BaseModel):
    cliente_codigo: str
    sequence_type:  str    # "UM" | "UC"
    count:          int    = 1
    prefix:         str    = ""


@app.post("/api/labels/sequence/generate", tags=["Etiquetas"])
def generate_label_sequence(req: SequenceRequest):
    """
    Gera `count` sequenciais para UM ou UC de forma atômica.
    Usa BEGIN IMMEDIATE para evitar deadlock com chamadas paralelas (Promise.all UM+UC).
    Retorna lista de strings com prefixo + número zero-padded (9 dígitos).
    """
    import time
    if req.count < 1 or req.count > 500:
        raise HTTPException(status_code=400, detail="count deve estar entre 1 e 500")

    conn = db()
    if conn.is_fallback_mode():
        raise HTTPException(
            status_code=503,
            detail=(
                "Geração de sequência indisponível em fallback SQLite. "
                "Em ambiente com múltiplos containers, aguarde o retorno do banco primário "
                "para evitar colisão de sequenciais."
            ),
        )

    if is_mysql():
        try:
            conn.execute("START TRANSACTION")
            row = conn.execute(
                "SELECT current_value FROM label_sequences WHERE cliente_codigo=? AND sequence_type=? FOR UPDATE",
                (req.cliente_codigo, req.sequence_type),
            ).fetchone()

            start = (int(row["current_value"]) if row else 0) + 1
            end = start + req.count - 1

            if row:
                conn.execute(
                    "UPDATE label_sequences SET current_value=? WHERE cliente_codigo=? AND sequence_type=?",
                    (end, req.cliente_codigo, req.sequence_type),
                )
            else:
                conn.execute(
                    "INSERT INTO label_sequences (cliente_codigo, sequence_type, prefix, current_value) VALUES (?,?,?,?)",
                    (req.cliente_codigo, req.sequence_type, req.prefix, end),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    else:
        max_retries = 5
        for attempt in range(max_retries):
            try:
                conn.execute("BEGIN IMMEDIATE")
                break
            except Exception as e:
                if attempt < max_retries - 1 and "locked" in str(e).lower():
                    time.sleep(0.05 * (attempt + 1))
                    continue
                raise HTTPException(status_code=503, detail="Banco de dados ocupado, tente novamente")

        try:
            row = conn.execute(
                "SELECT current_value FROM label_sequences WHERE cliente_codigo=? AND sequence_type=?",
                (req.cliente_codigo, req.sequence_type),
            ).fetchone()

            start = (row["current_value"] if row else 0) + 1
            end   = start + req.count - 1

            if row:
                conn.execute(
                    "UPDATE label_sequences SET current_value=? WHERE cliente_codigo=? AND sequence_type=?",
                    (end, req.cliente_codigo, req.sequence_type),
                )
            else:
                conn.execute(
                    "INSERT INTO label_sequences (cliente_codigo, sequence_type, prefix, current_value) VALUES (?,?,?,?)",
                    (req.cliente_codigo, req.sequence_type, req.prefix, end),
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

    prefix    = req.prefix or req.sequence_type
    sequences = [f"{prefix}{str(n).zfill(9)}" for n in range(start, end + 1)]
    return {"sequences": sequences}


# ── XML-ASN via SwPaaS ConteudoArquivo ──────────────────────────────────────

class XmlAsnRequest(BaseModel):
    meta_ids: list[int]


@app.post("/api/labels/xml-asn", tags=["Etiquetas"])
async def get_labels_xml_asn(payload: XmlAsnRequest):
    """
    Obtém o XML-ASN vinculado via SwPaaS ConteudoArquivo.
    Tenta cada IdMeta fornecido com tipo='edi' até encontrar um arquivo ASN/DESADV válido.
    """
    from fastapi.responses import Response as FastResponse

    if not payload.meta_ids:
        raise HTTPException(status_code=400, detail="meta_ids é obrigatório")

    last_err = "Nenhum meta_id retornou arquivo válido."
    for mid in payload.meta_ids:
        try:
            content = await swpaas.get_conteudo_arquivo(mid, tipo="edi")
            if content and len(content.strip()) > 10:
                return FastResponse(
                    content=content.encode("utf-8"),
                    media_type="application/xml",
                )
        except Exception as e:
            last_err = str(e)
            continue

    raise HTTPException(status_code=404, detail=f"XML-ASN não encontrado. {last_err}")


# ── Entrypoint ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("ASN_PORT", 8003))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
