"""
swpaas_client.py — Cliente autenticado SwPaaS para o ASN Service.

Responsabilidades:
  - Autenticação via POST /Authentication (token em memória, retry automático em 401)
  - GET /Admin/GetMapeamentos/{Sentido}/{NomeEntidade}/{Padrao}/{Mensagem}/{Versao}
  - GET /ReportLabels e /ReportLabels/Version/{versionId}
  - GET /Intercambios/ConteudoArquivo/{id}/{tipo}
  - POST /Admin/GetListEntidadesLogos
"""

import base64
import gzip
import hashlib
import os
from datetime import datetime, timezone

import httpx

# ── Configuração ────────────────────────────────────────────────────────────────
_ENV = os.getenv("SWPAAS_ENV", "hml").lower()
SWPAAS_BASE = (
    "https://swapihml.sawluz.net" if _ENV == "hml" else "https://swapi.sawluz.net"
)
_USER = os.getenv("VITE_SWPAAS_USERNAME", "")
_PASS = os.getenv("VITE_SWPAAS_PASSWORD", "")

# Upload manual / legado SWPaaS
_UPLOAD_OWNER = os.getenv("SWPAAS_UPLOAD_OWNER", "F6861634-E85D-4BB5-955E-30E5D627999E")
_UPLOAD_CONTEXTO = os.getenv("SWPAAS_UPLOAD_ID_CONTEXTO", "99F19C2B-4BC8-45FE-B8E1-7CBF08D19988")
_UPLOAD_HASH_INSTANCIA = os.getenv(
    "SWPAAS_UPLOAD_HASH_INSTANCIA",
    "54a2195e92ab443aa68ece26d0977ec0831ef3c3a9e84403b08b9c9450489c08",
)

_token: str | None = None


# ── Auth ────────────────────────────────────────────────────────────────────────

async def _authenticate() -> str:
    global _token
    if not _USER or not _PASS:
        raise RuntimeError(
            "SwPaaS: VITE_SWPAAS_USERNAME / VITE_SWPAAS_PASSWORD não configurados no .env"
        )
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{SWPAAS_BASE}/Authentication",
            json={"username": _USER, "password": _PASS},
        )
        res.raise_for_status()
        _token = res.json()["accessToken"]
    return _token


async def _headers() -> dict:
    global _token
    if not _token:
        await _authenticate()
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_token}",
    }


async def _request(method: str, url: str, **kwargs) -> httpx.Response:
    """Executa request com retry automático em 401 (token expirado)."""
    global _token
    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = await _headers()
        kwargs["headers"] = headers
        res = await getattr(client, method)(url, **kwargs)
        if res.status_code == 401:
            _token = None
            kwargs["headers"] = await _headers()
            res = await getattr(client, method)(url, **kwargs)
        return res


# ── Mapeamentos EDI ─────────────────────────────────────────────────────────────

async def get_mapeamentos(
    sentido: str = "0",
    nome_entidade: str = "0",
    padrao: str = "0",
    mensagem: str = "0",
    versao: str = "0",
) -> list[dict]:
    """
    GET /Admin/GetMapeamentos/{Sentido}/{NomeEntidade}/{Padrao}/{Mensagem}/{Versao}

    Parâmetros (use '0' para ignorar / trazer todos):
      sentido       → 0=todos, 1=envio, 2=recepção
      nome_entidade → nome da entidade (ex: "VOLKSWAGEN") ou "0"
      padrao        → padrão EDI (ex: "EDIFACT") ou "0"
      mensagem      → tipo de mensagem (ex: "DESADV", "856", "004") ou "0"
      versao        → versão EDI (ex: "D96A") ou "0"

    Filtra localmente para retornar apenas mapeamentos compatíveis com XML-ASN.
    """
    url = f"{SWPAAS_BASE}/Admin/GetMapeamentos/{sentido}/{nome_entidade}/{padrao}/{mensagem}/{versao}"
    res = await _request("get", url)

    if res.status_code == 404:
        return []
    if res.status_code != 200:
        raise RuntimeError(f"SwPaaS GetMapeamentos: HTTP {res.status_code}")

    raw = res.json()
    items = raw if isinstance(raw, list) else raw.get("items", raw.get("mapeamentos", []))

    # Normaliza campos para o formato esperado pelo frontend
    result = []
    for m in items:
        result.append({
            "id":            str(m.get("id") or m.get("Id") or ""),
            "nome":          m.get("nome") or m.get("Nome") or m.get("name") or "",
            "dll_filename":  m.get("dllFilename") or m.get("dll_filename") or m.get("DllFilename") or "",
            "tem_crossid":   bool(m.get("temCrossId") or m.get("tem_crossid") or False),
            "mensagem_edi":  m.get("mensagemEdi") or m.get("mensagem_edi") or m.get("MensagemEdi") or mensagem,
            "versao_edi":    m.get("versaoEdi") or m.get("versao_edi") or m.get("VersaoEdi") or versao,
            "padrao":        m.get("padrao") or m.get("Padrao") or padrao,
            "sentido":       str(m.get("sentido") or m.get("Sentido") or sentido),
        })
    return result


# ── Templates MRT ───────────────────────────────────────────────────────────────

async def get_report_labels(
    page: int = 1,
    page_size: int = 100,
    sort_descending: bool = True,
    current_versions: bool = True,
    tenant_id: int = 0,
    owner_id: int = 0,
) -> list[dict]:
    """Lista relatórios/etiquetas disponíveis no SwPaaS."""
    params = {
        "page": page,
        "pageSize": page_size,
        "sortDescending": str(sort_descending).lower(),
        "currentVersions": str(current_versions).lower(),
        "tenantId": tenant_id,
        "ownerId": owner_id,
    }
    res = await _request("get", f"{SWPAAS_BASE}/ReportLabels", params=params)
    if res.status_code != 200:
        raise RuntimeError(f"SwPaaS ReportLabels: HTTP {res.status_code}")
    return res.json().get("items", [])


async def get_mrt_content(version_id: str) -> bytes:
    """Baixa e decodifica o conteúdo base64 de um template .mrt pelo versionId."""
    res = await _request("get", f"{SWPAAS_BASE}/ReportLabels/Version/{version_id}")
    if res.status_code != 200:
        raise RuntimeError(f"SwPaaS ReportLabels/Version: HTTP {res.status_code}")
    b64 = res.json().get("fileContentBase64", "")
    if not b64:
        raise RuntimeError(f"fileContentBase64 ausente para versionId={version_id}")
    return base64.b64decode(b64)


async def get_mrt_by_filename(filename: str) -> tuple[bytes, str]:
    """
    Busca .mrt pelo nome do arquivo (ex: 'Etiqueta_DESADV.mrt').
    Retorna (bytes_do_arquivo, nome_arquivo).
    """
    items = await get_report_labels(page_size=200)
    version_id = None
    found_name = filename
    for item in items:
        for v in item.get("versions", []):
            if v.get("fileName", "").lower() == filename.lower() and v.get("isCurrent", False):
                version_id = v["id"]
                found_name = v["fileName"]
                break
        if version_id:
            break

    if not version_id:
        raise RuntimeError(f"Template '{filename}' não encontrado no SwPaaS.")

    content = await get_mrt_content(version_id)
    return content, found_name


# ── Conteúdo de Arquivo (XML/EDI do intercâmbio) ───────────────────────────────

async def get_conteudo_arquivo(id_meta: int, tipo: str = "edi") -> str:
    """
    GET /Intercambios/ConteudoArquivo/{id_meta}/{tipo}

    O tipo deve ser sempre 'edi' para buscar o conteúdo do ProcNFe.
    Decodifica base64 + gzip e retorna texto UTF-8.
    """
    url = f"{SWPAAS_BASE}/Intercambios/ConteudoArquivo/{id_meta}/edi"
    res = await _request("get", url)

    if res.status_code != 200:
        raise RuntimeError(
            f"SwPaaS ConteudoArquivo/{id_meta}/edi: HTTP {res.status_code} ({SWPAAS_BASE}, SWPAAS_ENV={_ENV})"
        )

    raw = res.text.strip()
    try:
        decoded = base64.b64decode(raw)
        if decoded[:2] == b"\x1f\x8b":
            return gzip.decompress(decoded).decode("utf-8", errors="replace")
        return decoded.decode("utf-8", errors="replace")
    except Exception:
        return raw


# ── Logotipos ───────────────────────────────────────────────────────────────────

async def get_logos(entity_ids: list[str]) -> list[dict]:
    """POST /Admin/GetListEntidadesLogos"""
    if not entity_ids:
        return []
    res = await _request("post", f"{SWPAAS_BASE}/Admin/GetListEntidadesLogos", json=entity_ids)
    if res.status_code != 200:
        raise RuntimeError(f"SwPaaS GetListEntidadesLogos: HTTP {res.status_code}")
    return res.json()


# ── Upload de Arquivo (Intercambios/Arquivos/Upload) ─────────────────────────

def build_upload_payload(file_name: str, content_bytes: bytes) -> dict:
    """
    Monta payload para /Intercambios/Arquivos/Upload.
    - Comprime com GZip
    - Converte para base64
    - Calcula MD5 do conteúdo original
    """
    gzip_bytes = gzip.compress(content_bytes)
    b64_content = base64.b64encode(gzip_bytes).decode("ascii")
    md5_hex = hashlib.md5(content_bytes).hexdigest()
    dt_hr_arquivo = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    return {
        "owner": _UPLOAD_OWNER,
        "idContexto": _UPLOAD_CONTEXTO,
        "pathArquivoLocal": f"C:\\Upload\\{file_name}",
        "dtHrArquivo": dt_hr_arquivo,
        "hashInstancia": _UPLOAD_HASH_INSTANCIA,
        "bytes": len(content_bytes),
        "arquivo": b64_content,
        "mD5": md5_hex,
    }


async def upload_arquivo(payload: dict) -> dict:
    """POST /Intercambios/Arquivos/Upload (legado SWPaaS)."""
    res = await _request("post", f"{SWPAAS_BASE}/Intercambios/Arquivos/Upload", json=payload)
    if res.status_code >= 300:
        body = (res.text or "").strip()
        preview = body[:1000] if body else "(empty)"
        raise RuntimeError(f"SwPaaS Upload: HTTP {res.status_code} - {preview}")

    if res.status_code == 204 or not (res.text or "").strip():
        return {"ok": True, "status": res.status_code}

    try:
        return res.json()
    except Exception:
        return {"ok": True, "status": res.status_code, "body": (res.text or "")[:200]}
