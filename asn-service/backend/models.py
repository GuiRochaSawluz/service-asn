"""
models.py — Schemas Pydantic do ASN Service.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ── Itens do Aviso ──────────────────────────────────────────────────────────────

class CallDelivery(BaseModel):
    call_delivery: str = ""
    quantidade: str = ""


class ItemASN(BaseModel):
    id: Optional[str] = None
    produto_local: str = ""
    produto_externo: str = ""
    descricao: str = ""
    qtd_nfe: str = ""
    quantidade: str = ""
    lote: str = ""
    cfop: str = ""
    tipo_fornecimento: str = ""
    nfe_cfop: str = ""
    ncm: str = ""
    valor_unitario: str = ""
    valor_total: str = ""
    call_delivery: str = ""
    call_deliveries: list[CallDelivery] = []
    # Campos extras parseados do XML NF-e
    base_icms: str = ""
    aliquota_icms: str = ""
    valor_icms: str = ""


# ── Aviso de Embarque ───────────────────────────────────────────────────────────

class AvisoEmbarqueCreate(BaseModel):
    id_meta: str
    chave_nfe: Optional[str] = None
    num_nf: Optional[str] = None
    fabrica: Optional[str] = None
    doca: Optional[str] = None
    local_entrega: Optional[str] = None
    call_delivery: Optional[str] = None
    cod_cliente: Optional[str] = None
    emitente_nome: Optional[str] = None
    emitente_cnpj: Optional[str] = None
    emitente_endereco: Optional[str] = None
    destinatario_nome: Optional[str] = None
    destinatario_cnpj: Optional[str] = None
    data_emissao_nfe: Optional[str] = None
    serie_nfe: Optional[str] = None
    nat_operacao: Optional[str] = None
    itens_json: Optional[str] = "[]"
    mapeamento_swpaas_id: Optional[str] = None
    mapeamento_nome: Optional[str] = None


class AvisoEmbarqueUpdate(AvisoEmbarqueCreate):
    """Mesmo schema do Create — todos os campos opcionais na atualização."""
    id_meta: Optional[str] = None  # type: ignore[assignment]


class AvisoEmbarqueResponse(BaseModel):
    id: int
    id_meta: str
    chave_nfe: Optional[str] = None
    num_nf: Optional[str] = None
    fabrica: Optional[str] = None
    doca: Optional[str] = None
    local_entrega: Optional[str] = None
    call_delivery: Optional[str] = None
    cod_cliente: Optional[str] = None
    emitente_nome: Optional[str] = None
    emitente_cnpj: Optional[str] = None
    emitente_endereco: Optional[str] = None
    destinatario_nome: Optional[str] = None
    destinatario_cnpj: Optional[str] = None
    data_emissao_nfe: Optional[str] = None
    serie_nfe: Optional[str] = None
    nat_operacao: Optional[str] = None
    itens_json: Optional[str] = "[]"
    mapeamento_swpaas_id: Optional[str] = None
    mapeamento_nome: Optional[str] = None
    xml_asn_gerado: Optional[str] = None
    rnd004_path: Optional[str] = None
    rnd004_length: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ── Geração ─────────────────────────────────────────────────────────────────────

class GerarRequest(BaseModel):
    mapeamento_id: Optional[str] = None  # ID do mapeamento no SwPaaS


class GerarResponse(BaseModel):
    ok: bool = True
    xml_asn: Optional[str] = None
    path: Optional[str] = None
    rnd004_length: Optional[int] = None
    upload_ok: Optional[bool] = None
    upload_result: Optional[dict] = None
    mensagem: Optional[str] = None
