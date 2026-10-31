"""
Parser de mensagem XML-ASN (ARQUIVOEDI / ASN_SET).

Extrai o máximo possível de cabeçalho, expedição, itens e etiquetas,
mapeia campos de etiqueta vazios para preenchimento manual e preserva
os conceitos de UC/UM já usados na geração a partir de procNFe.

Não altera o fluxo de geração ASN via procNFe (asn_generator.gerar_xml_asn).
"""
from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from typing import Any


# Campos da etiqueta alinhados ao grid / GeracaoLote / asn_generator (UC)
LABEL_FIELD_SPECS: list[dict[str, str]] = [
    {"key": "numeroUC", "xml": "DbEtqNroEtiquetaUnidadeCondicionamento", "label": "UC (Caixa)", "severity": "critical"},
    {"key": "numeroUM", "xml": "DbEtqNroEtiquetaUnidadeMovimentacao", "label": "UM (Pallet)", "severity": "critical"},
    {"key": "quantidadePecasUC", "xml": "DbEtqQuantidadeDePecasNaUC", "label": "Qtd Peças na UC", "severity": "critical"},
    {"key": "codigoEmbalagemUC", "xml": "DbEtqCodigoEmbalagemUC", "label": "Cód. Embalagem UC", "severity": "important"},
    {"key": "numeroDocumento", "xml": "DbEtqTextoLivre", "label": "No. Documento (NF)", "severity": "important"},
    {"key": "doca", "xml": "DbEtqDoca", "label": "Doca", "severity": "optional"},
    {"key": "ran", "xml": "DbEtqCallDelivery", "label": "RAN (Call Delivery)", "severity": "optional"},
    {"key": "localUtilizacao", "xml": "DbEtqPontoDeUso", "label": "Local Utilização", "severity": "optional"},
    {"key": "lote", "xml": "DbEtqLoteFabricacao", "label": "Lote", "severity": "optional"},
    {"key": "dataFabricacao", "xml": "DbEtqDtFabricacao", "label": "Data Fabricação", "severity": "optional"},
    {"key": "codigoEmbalagemUM", "xml": "DbEtqCodigoEmbalagemUM", "label": "Cód. Embalagem UM", "severity": "optional"},
]


def _txt(el: ET.Element | None, tag: str, default: str = "") -> str:
    if el is None:
        return default
    child = el.find(tag)
    if child is None or child.text is None:
        return default
    return (child.text or "").strip()


def _first(*values: str) -> str:
    for v in values:
        if v and str(v).strip() and str(v).strip() != "?":
            return str(v).strip()
    return ""


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    s = str(value).strip()
    return s == "" or s == "?"


def _new_id() -> str:
    return uuid.uuid4().hex[:8]


def _call_delivery_fallback(item_el: ET.Element) -> str:
    for cd in item_el.findall(".//Tb_ASNItemCallDelivery"):
        val = _txt(cd, "DbCDVCallDelivery")
        if val:
            return val
    return ""


def _parse_etiqueta(
    etq_el: ET.Element,
    item_occ: str,
    defaults: dict[str, str],
) -> dict[str, Any]:
    raw = {
        "numeroUM": _txt(etq_el, "DbEtqNroEtiquetaUnidadeMovimentacao"),
        "numeroUC": _txt(etq_el, "DbEtqNroEtiquetaUnidadeCondicionamento"),
        "quantidadePecasUC": _txt(etq_el, "DbEtqQuantidadeDePecasNaUC"),
        "codigoEmbalagemUC": _txt(etq_el, "DbEtqCodigoEmbalagemUC"),
        "codigoEmbalagemUM": _txt(etq_el, "DbEtqCodigoEmbalagemUM"),
        "localUtilizacao": _txt(etq_el, "DbEtqPontoDeUso"),
        "lote": _txt(etq_el, "DbEtqLoteFabricacao"),
        "numeroDocumento": _txt(etq_el, "DbEtqTextoLivre"),
        "dataFabricacao": _txt(etq_el, "DbEtqDtFabricacao"),
        "doca": _txt(etq_el, "DbEtqDoca"),
        "ran": _txt(etq_el, "DbEtqCallDelivery"),
        "dataDe": "",
        "crossDock": "",
    }

    # Herda cabeçalho/expedição/call-delivery quando a etiqueta veio vazia
    filled = {
        "id": _new_id(),
        "itemOcc": item_occ,
        "selected": True,
        "numeroUM": raw["numeroUM"],
        "numeroUC": raw["numeroUC"],
        "quantidadePecasUC": raw["quantidadePecasUC"] or "0",
        "codigoEmbalagemUC": raw["codigoEmbalagemUC"],
        "codigoEmbalagemUM": raw["codigoEmbalagemUM"],
        "localUtilizacao": _first(raw["localUtilizacao"], defaults.get("localEntrega", "")),
        "lote": raw["lote"],
        "numeroDocumento": _first(raw["numeroDocumento"], defaults.get("numNf", "")),
        "dataFabricacao": raw["dataFabricacao"],
        "doca": _first(raw["doca"], defaults.get("doca", "")),
        "ran": _first(raw["ran"], defaults.get("ran", "")),
        "dataDe": "",
        "crossDock": "",
        "source": "xml-asn",
    }

    missing: list[dict[str, str]] = []
    for spec in LABEL_FIELD_SPECS:
        val = filled.get(spec["key"], "")
        if _is_empty(val) or (spec["key"] == "quantidadePecasUC" and str(val).strip() in ("0", "0.0", "0.000")):
            # qtd 0 só é gap se também não houver número — evita falso positivo
            if spec["key"] == "quantidadePecasUC" and not _is_empty(filled.get("numeroUC")):
                # qty explícita 0 ainda é problemático para impressão
                if str(val).strip() in ("", "0", "0.0", "0.000"):
                    missing.append({**spec})
                continue
            missing.append({**spec})

    filled["camposFaltantes"] = missing
    filled["completo"] = len([m for m in missing if m["severity"] == "critical"]) == 0
    return filled


def parse_xml_asn(xml_content: str | bytes) -> dict[str, Any]:
    """
    Parse completo de ARQUIVOEDI → estrutura para a aba Etiqueta.

    Retorna:
      expedicao, cabecalho, items[], etiquetas[], resumo{...}
    """
    if isinstance(xml_content, bytes):
        xml_content = xml_content.decode("utf-8", errors="replace")

    text = xml_content.strip()
    if not text:
        raise ValueError("XML-ASN vazio")

    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"XML-ASN inválido: {exc}") from exc

    # Aceita raiz ARQUIVOEDI ou documento já com ASN_SET
    if root.tag != "ARQUIVOEDI" and root.find(".//ARQUIVOEDI") is None and root.find(".//Tb_ASNCabecalho") is None:
        raise ValueError("Arquivo não é XML-ASN (ARQUIVOEDI/ASN_SET esperado)")

    cab_el = root.find(".//Tb_ASNCabecalho")
    exp_el = root.find(".//Expedicao")
    header_el = root.find(".//Tb_HeaderEDI")
    valores_el = root.find(".//ValoresTotais")
    tx_el = root.find(".//ParceiroTransmissor")
    rx_el = root.find(".//ParceiroReceptor")

    def _parceiro(el: ET.Element | None) -> dict[str, str]:
        if el is None:
            return {"idEdi": "", "codigo": "", "nome": "", "razaoSocial": "", "endereco": "", "comCode": ""}
        return {
            "idEdi": _txt(el, "DbParceiroIdEDI"),
            "codigo": _txt(el, "DbParceiroCodigo"),
            "nome": _txt(el, "DbParceiroNome"),
            "razaoSocial": _txt(el, "DbParceiroRazaoSocial") or _txt(el, "DbParceiroNome"),
            "endereco": _txt(el, "DbParceiroEndereco"),
            "comCode": _txt(el, "DbParceiroComCode"),
        }

    cabecalho = {
        "chaveNfe": _txt(cab_el, "DbChaveNFe"),
        "numNf": _txt(cab_el, "DbNotaFiscal"),
        "serie": _txt(cab_el, "DbSerie"),
        "especie": _txt(cab_el, "DbEspecie"),
        "dataEmissao": _txt(cab_el, "DbDataEmissao"),
        "dataVencimento": _txt(cab_el, "DbDataVencimento"),
        "cfop": _txt(cab_el, "DbCFOP"),
        "naturezaOperacao": _txt(cab_el, "DbNaturezaOperacao"),
        "parceiroLocal": _txt(cab_el, "DbSWEDI_ParceiroLocal") or _txt(header_el, "DbSWEDI_ParceiroLocal"),
        "parceiroExterno": _txt(cab_el, "DbSWEDI_ParceiroExterno") or _txt(header_el, "DbSWEDI_ParceiroExterno"),
        "clienteCodigo": _txt(cab_el, "DbSWEDI_ClienteCodigo"),
        "dtHrMovimento": _txt(cab_el, "DbDtHrMovimento"),
        "emitente": _parceiro(tx_el),
        "destinatario": _parceiro(rx_el),
        "valores": {
            "valorTotal": _txt(valores_el, "DbValorTotal"),
            "baseIcms": _txt(valores_el, "DbBaseICMS"),
            "valorIcms": _txt(valores_el, "DbValorICMS"),
            "valorIpi": _txt(valores_el, "DbValorIPI"),
            "valorFrete": _txt(valores_el, "DbValorFrete"),
            "valorDesconto": _txt(valores_el, "DbValorDesconto"),
        },
    }

    expedicao = {
        "doca": _txt(exp_el, "DbDoca"),
        "fabrica": _txt(exp_el, "DbFabricaCliente"),
        "localEntrega": _txt(exp_el, "DbLocalEntrega"),
        "clienteCodigo": cabecalho["clienteCodigo"],
        "numDocto": cabecalho["numNf"],
        "pesoBruto": _txt(exp_el, "DbPesoBruto"),
        "pesoLiquido": _txt(exp_el, "DbPesoLiquido"),
        "totalVolumes": _txt(exp_el, "DbTotalVolumes"),
        "dtHrEmbarque": _txt(exp_el, "DbDtHrEmbarque"),
        "placaVeiculo": _txt(exp_el, "DbPlacaVeiculo"),
        "rota": _txt(exp_el, "DbRota"),
    }

    items: list[dict[str, Any]] = []
    etiquetas: list[dict[str, Any]] = []
    items_sem_etiqueta: list[str] = []

    for item_el in root.findall(".//Tb_ASNItem"):
        occ = _txt(item_el, "DbItOcc") or str(len(items) + 1)
        ran_fallback = _call_delivery_fallback(item_el)
        defaults = {
            "doca": expedicao["doca"],
            "numNf": cabecalho["numNf"],
            "localEntrega": expedicao["localEntrega"],
            "ran": ran_fallback,
        }

        item = {
            "occ": occ,
            "produtoLocal": _first(_txt(item_el, "DbItProdutoLocal")),
            "produtoCliente": _first(_txt(item_el, "DbItProdutoCliente")),
            "produtoClienteVs": _txt(item_el, "DbItProdutoClienteVs"),
            "descricao": _txt(item_el, "DbItProdutoClienteDescricao"),
            "qtdFaturada": _txt(item_el, "DbItQtdFaturada", "0"),
            "unidade": _txt(item_el, "DbItUnidadeMedidaNF", "PC"),
            "numPedido": _txt(item_el, "DbItNumeroPedido"),
            "pedidoDsh": _txt(item_el, "DbItPedidoDSH"),
            "cfop": _txt(item_el, "DbItCFOitem"),
            "tipoFornecimento": _txt(item_el, "DbItTipoFornecimento"),
            "ncm": _txt(item_el, "DbItClassificacaoFiscal"),
            "totalDefaultUcsPorUm": _txt(item_el, "DbItTotalDefaultUCsPor1UM"),
            "pesoBruto": _txt(item_el, "DbItPesoBruto"),
            "pesoLiquido": _txt(item_el, "DbItPesoLiquido"),
            "valorUnitario": _txt(item_el, "DbItValorUnitario"),
            "valorTotal": _txt(item_el, "DbItValorTotal"),
            "source": "xml-asn",
        }
        items.append(item)

        etq_els = item_el.findall(".//Tb_ASNItemEtiqueta")
        if not etq_els:
            items_sem_etiqueta.append(occ)
            continue

        for etq_el in etq_els:
            etiquetas.append(_parse_etiqueta(etq_el, occ, defaults))

    critical_gaps = sum(
        1 for e in etiquetas for m in e.get("camposFaltantes", []) if m["severity"] == "critical"
    )
    important_gaps = sum(
        1 for e in etiquetas for m in e.get("camposFaltantes", []) if m["severity"] == "important"
    )
    optional_gaps = sum(
        1 for e in etiquetas for m in e.get("camposFaltantes", []) if m["severity"] == "optional"
    )

    # Agrega campos faltantes por chave (para painel do usuário)
    missing_by_field: dict[str, dict[str, Any]] = {}
    for e in etiquetas:
        for m in e.get("camposFaltantes", []):
            entry = missing_by_field.setdefault(
                m["key"],
                {"key": m["key"], "label": m["label"], "severity": m["severity"], "count": 0, "itemOccs": []},
            )
            entry["count"] += 1
            if e["itemOcc"] not in entry["itemOccs"]:
                entry["itemOccs"].append(e["itemOcc"])

    return {
        "ok": True,
        "formato": "xml-asn",
        "cabecalho": cabecalho,
        "expedicao": expedicao,
        "items": items,
        "etiquetas": etiquetas,
        "resumo": {
            "totalItens": len(items),
            "totalEtiquetas": len(etiquetas),
            "itensSemEtiqueta": items_sem_etiqueta,
            "etiquetasIncompletas": sum(1 for e in etiquetas if not e.get("completo")),
            "etiquetasCompletas": sum(1 for e in etiquetas if e.get("completo")),
            "gapsCriticos": critical_gaps,
            "gapsImportantes": important_gaps,
            "gapsOpcionais": optional_gaps,
            "camposFaltantesAgregados": list(missing_by_field.values()),
            "precisaGerarLoteUc": len(items_sem_etiqueta) > 0,
            "precisaPreencherManual": critical_gaps + important_gaps > 0,
        },
        "camposEtiquetaCatalogo": LABEL_FIELD_SPECS,
    }


def map_missing_fields(etiquetas: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Reavalia campos faltantes em etiquetas já editadas pelo usuário
    (mesma regra UC/UM do parse inicial).
    """
    result = []
    for etq in etiquetas:
        missing = []
        for spec in LABEL_FIELD_SPECS:
            val = etq.get(spec["key"], "")
            empty = _is_empty(val)
            if spec["key"] == "quantidadePecasUC":
                empty = empty or str(val).strip() in ("0", "0.0", "0.000")
            if empty:
                missing.append({**spec})
        row = {**etq, "camposFaltantes": missing}
        row["completo"] = len([m for m in missing if m["severity"] == "critical"]) == 0
        result.append(row)

    by_field: dict[str, dict[str, Any]] = {}
    for e in result:
        for m in e.get("camposFaltantes", []):
            entry = by_field.setdefault(
                m["key"],
                {"key": m["key"], "label": m["label"], "severity": m["severity"], "count": 0, "itemOccs": []},
            )
            entry["count"] += 1
            occ = str(e.get("itemOcc") or "")
            if occ and occ not in entry["itemOccs"]:
                entry["itemOccs"].append(occ)

    return {
        "etiquetas": result,
        "camposFaltantesAgregados": list(by_field.values()),
        "etiquetasIncompletas": sum(1 for e in result if not e.get("completo")),
        "etiquetasCompletas": sum(1 for e in result if e.get("completo")),
    }
