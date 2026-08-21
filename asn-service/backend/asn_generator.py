"""
asn_generator.py — Geração do XML-ASN em memória (Python puro).

Responsabilidade:
    - Receber os dados do formulário Aviso de Embarque (cabeçalho + itens)
    - Produzir XML-ASN no layout ARQUIVOEDI/ASN_SET compatível com XSD
        (XML-ASNvs02_alterado.xsd)
    - NÃO usa DLL Altova local — a transformação para o formato final
        (DESADV/856/RND004) é responsabilidade do SwPaaS após o upload do XML-ASN.
"""

import json
import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from lxml import etree as LET


SCHEMA_DIR = Path(__file__).parent / "schema"
DEFAULT_XSD_PATH = SCHEMA_DIR / "XML-ASNvs02_alterado.xsd"
DEFAULT_EXAMPLE_XML_PATH = SCHEMA_DIR / "1095017_MICHELIN.xml"


def _txt(parent: ET.Element, tag: str, value: Any) -> ET.SubElement:
    """Cria sub-elemento com texto, tratando None como string vazia."""
    el = ET.SubElement(parent, tag)
    el.text = str(value) if value is not None else ""
    return el


def _s(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _dec(value: Any, places: int = 2, default: str = "0.00") -> str:
    text = _s(value)
    if not text:
        return default
    try:
        quant = Decimal("1") if places == 0 else Decimal(f"1.{'0' * places}")
        return str(Decimal(text.replace(",", ".")).quantize(quant))
    except (InvalidOperation, ValueError):
        return default


def _int(value: Any, default: int = 0) -> str:
    text = _s(value)
    if not text:
        return str(default)
    try:
        return str(int(Decimal(text.replace(",", "."))))
    except (InvalidOperation, ValueError):
        return str(default)


def _fmt_dt(value: Any | None = None) -> str:
    if value is None or str(value).strip() == "":
        dt = datetime.now()
        return dt.strftime("%Y/%m/%d %H:%M:%S")

    raw = str(value).strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%d",
        "%Y/%m/%d",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            if "H" in fmt:
                return dt.strftime("%Y/%m/%d %H:%M:%S")
            return dt.strftime("%Y/%m/%d 00:00:00")
        except ValueError:
            continue
    return _fmt_dt()


def _fmt_date(value: Any | None = None) -> str:
    if value is None or str(value).strip() == "":
        return datetime.now().strftime("%Y/%m/%d")

    raw = str(value).strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%d",
        "%Y/%m/%d",
    ):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y/%m/%d")
        except ValueError:
            continue
    return datetime.now().strftime("%Y/%m/%d")


def _iter_call_deliveries(item: dict) -> list[dict]:
    call_deliveries = item.get("call_deliveries") or []
    if not call_deliveries and item.get("call_delivery"):
        call_deliveries = [
            {
                "call_delivery": item.get("call_delivery", ""),
                "quantidade": item.get("quantidade") or item.get("qtd_nfe") or "",
            }
        ]
    if not call_deliveries:
        call_deliveries = [{"call_delivery": "", "quantidade": ""}]
    return call_deliveries


def _first_by_tag(root: ET.Element, tag: str) -> ET.Element | None:
    if root.tag == tag:
        return root
    return root.find(f".//{tag}")


def _ordered_child_tags(node: ET.Element | None) -> list[str]:
    if node is None:
        return []
    return [child.tag for child in list(node)]


def validate_xml_asn(
    xml_content: str,
    xsd_path: str | Path = DEFAULT_XSD_PATH,
    example_xml_path: str | Path = DEFAULT_EXAMPLE_XML_PATH,
) -> None:
    """
    Valida o XML-ASN gerado:
      1) Conformidade formal com o XSD
      2) Estrutura-base comparada ao XML de exemplo

    Raises:
        ValueError: quando qualquer validação falhar.
    """
    errors: list[str] = []

    # 1) Validação formal pelo XSD
    try:
        schema_doc = LET.parse(str(xsd_path))
        schema = LET.XMLSchema(schema_doc)
        xml_doc = LET.fromstring(xml_content.encode("utf-8"))
        if not schema.validate(xml_doc):
            for e in schema.error_log:
                errors.append(f"XSD line {e.line}: {e.message}")
    except FileNotFoundError:
        errors.append(f"XSD não encontrado em: {xsd_path}")
    except LET.XMLSyntaxError as exc:
        errors.append(f"XML malformado: {exc}")
    except LET.XMLSchemaParseError as exc:
        errors.append(f"Erro ao carregar XSD: {exc}")
    except Exception as exc:
        errors.append(f"Erro na validação XSD: {exc}")

    # 2) Validação estrutural baseada no XML exemplo
    #    (presença de nós-chave e estrutura de blocos, sem impor ordem exata).
    try:
        generated_root = ET.fromstring(xml_content)
        with open(example_xml_path, "r", encoding="iso-8859-1") as f:
            sample_text = f.read()
        sample_root = ET.fromstring(sample_text)

        xsd_tree = ET.parse(xsd_path)
        xsd_root = xsd_tree.getroot()
        xsd_defined_tags = {
            el.attrib.get("name", "")
            for el in xsd_root.findall(".//{http://www.w3.org/2001/XMLSchema}element")
            if el.attrib.get("name")
        }

        key_nodes = [
            "ARQUIVOEDI",
            "ASN_SET",
            "ASN_SUBSET",
            "Tb_HeaderEDI",
            "Tb_HeaderEDI_Parceiros",
            "Tb_ASNCabecalho",
            "ValoresTotais",
            "Expedicao",
            "EspecificoGM",
            "Tb_ASNItem",
        ]

        for tag in key_nodes:
            sample_node = _first_by_tag(sample_root, tag)
            generated_node = _first_by_tag(generated_root, tag)

            if sample_node is None:
                continue
            if generated_node is None:
                errors.append(f"Estrutura-exemplo: nó obrigatório ausente no gerado: {tag}")
                continue

            # O exemplo é referência de blocos; exige presença dos filhos do exemplo,
            # mas permite campos extras no gerado.
            sample_children = set(_ordered_child_tags(sample_node))
            generated_children = set(_ordered_child_tags(generated_node))
            missing_children = sorted(
                child
                for child in (sample_children - generated_children)
                if child in xsd_defined_tags
            )
            if missing_children:
                errors.append(
                    f"Estrutura-exemplo: em {tag}, faltam nós filhos: {missing_children}"
                )

        # Valida os parceiros e seus sufixos conforme convenção do XML de exemplo.
        expected_partner_suffix = {
            "ParceiroTransmissor": "T",
            "ParceiroReceptor": "R",
            "ParceiroEmbarcador": "EbM",
            "ParceiroOperadorLogistico": "OpL",
            "ParceiroRecebedorMercadoria": "RbM",
            "ParceiroDirectShip": "DSH",
        }
        for partner_tag, suffix in expected_partner_suffix.items():
            partner_node = _first_by_tag(generated_root, partner_tag)
            if partner_node is None:
                errors.append(f"Estrutura-exemplo: parceiro ausente no gerado: {partner_tag}")
                continue
            got_suffix = partner_node.attrib.get("Sufixo")
            if got_suffix != suffix:
                errors.append(
                    f"Estrutura-exemplo: atributo Sufixo inválido em {partner_tag}: esperado={suffix}, gerado={got_suffix}"
                )

        # Garante atributos obrigatórios do nó raiz presentes (seguindo exemplo).
        if "Nome" not in generated_root.attrib or "Data" not in generated_root.attrib:
            errors.append("Estrutura-exemplo: ARQUIVOEDI deve conter atributos Nome e Data")
    except FileNotFoundError:
        errors.append(f"XML de exemplo não encontrado em: {example_xml_path}")
    except ET.ParseError as exc:
        errors.append(f"Erro de parse na validação estrutural: {exc}")
    except Exception as exc:
        errors.append(f"Erro na validação estrutural por exemplo: {exc}")

    if errors:
        raise ValueError("Validação do XML-ASN falhou:\n- " + "\n- ".join(errors))


def gerar_xml_asn(aviso: dict, itens: list[dict]) -> str:
    """
    Gera o XML-ASN hierárquico a partir dos dados do aviso de embarque.

    Args:
        aviso: dicionário com campos do cabeçalho (fabrica, doca, local_entrega,
               cod_cliente, emitente_cnpj, destinatario_cnpj, chave_nfe, etc.)
        itens: lista de dicts com os itens (produto_local, produto_externo,
               quantidade, call_delivery, lote, cfop, etc.)

    Returns:
        String XML pronta para upload no SwPaaS ou uso no StiLabelViewer.
    """
    now_dt = _fmt_dt()
    emitente_nome = _s(aviso.get("emitente_nome"))
    destinatario_nome = _s(aviso.get("destinatario_nome"))
    cod_cliente = _s(aviso.get("cod_cliente"))
    parceiro_local = emitente_nome or _s(aviso.get("fabrica"))
    parceiro_externo = destinatario_nome
    cfop_header = _s(aviso.get("cfop")) or _s((itens[0] if itens else {}).get("cfop")) or _s((itens[0] if itens else {}).get("nfe_cfop"))

    peso_bruto = _dec((itens[0] if itens else {}).get("nfe_pesoB"), places=3, default="0.000")
    peso_liquido = _dec((itens[0] if itens else {}).get("nfe_pesoL"), places=3, default="0.000")

    total_qtd = Decimal("0")
    total_vlr = Decimal("0")
    total_base_icms = Decimal("0")
    total_icms = Decimal("0")
    for item in itens:
        try:
            total_qtd += Decimal(_s(item.get("quantidade") or item.get("qtd_nfe") or "0").replace(",", "."))
        except InvalidOperation:
            pass
        try:
            total_vlr += Decimal(_s(item.get("valor_total") or "0").replace(",", "."))
        except InvalidOperation:
            pass
        try:
            total_base_icms += Decimal(_s(item.get("base_icms") or item.get("nfe_vBC") or "0").replace(",", "."))
        except InvalidOperation:
            pass
        try:
            total_icms += Decimal(_s(item.get("valor_icms") or item.get("nfe_vICMS") or "0").replace(",", "."))
        except InvalidOperation:
            pass

    total_vnf_item = _s((itens[0] if itens else {}).get("nfe_vNF"))
    total_valor = _dec(total_vnf_item, places=2, default=_dec(total_vlr, places=2, default="0.00"))
    total_base = _dec(total_base_icms, places=2, default="0.00")
    total_icms_valor = _dec(total_icms, places=2, default="0.00")
    total_volumes = _int(total_qtd, default=len(itens) if itens else 0)

    root = ET.Element("ARQUIVOEDI", {"Nome": "", "Data": now_dt})
    asn_set = ET.SubElement(root, "ASN_SET")
    asn_subset = ET.SubElement(asn_set, "ASN_SUBSET")

    header_edi = ET.SubElement(asn_subset, "Tb_HeaderEDI")
    _txt(header_edi, "DbPadraoEDI", _s(aviso.get("padrao_edi"), ""))
    _txt(header_edi, "DbRNDcodigo", _s(aviso.get("rnd_codigo"), "004"))
    _txt(header_edi, "DbEDIversao", _s(aviso.get("edi_versao"), "99"))
    _txt(header_edi, "DbRNDversao", _s(aviso.get("rnd_versao"), "99"))
    _txt(header_edi, "DbDtHrMovimento", now_dt)
    _txt(header_edi, "DbSwNro", _s(aviso.get("sw_nro")))
    _txt(header_edi, "DbNroTransmissao", _s(aviso.get("nro_transmissao")))
    _txt(header_edi, "DbSWEDI_ParceiroLocal", parceiro_local)
    _txt(header_edi, "DbSWEDI_ParceiroExterno", parceiro_externo)

    parceiros = ET.SubElement(header_edi, "Tb_HeaderEDI_Parceiros")

    transmissor = ET.SubElement(parceiros, "ParceiroTransmissor", {"Sufixo": "T"})
    _txt(transmissor, "DbParceiroIdEDI", _s(aviso.get("emitente_cnpj")))
    _txt(transmissor, "DbParceiroCodigo", _s(aviso.get("emitente_codigo"), parceiro_local))
    _txt(transmissor, "DbParceiroNome", parceiro_local)
    _txt(transmissor, "DbParceiroQualif", _s(aviso.get("emitente_qualif")))
    _txt(transmissor, "DbParceiroComCode", _s(aviso.get("emitente_com_code"), cod_cliente))
    _txt(transmissor, "DbParceiroRazaoSocial", _s(aviso.get("emitente_razao_social"), emitente_nome))
    _txt(transmissor, "DbParceiroEndereco", _s(aviso.get("emitente_endereco")))

    receptor = ET.SubElement(parceiros, "ParceiroReceptor", {"Sufixo": "R"})
    _txt(receptor, "DbParceiroIdEDI", _s(aviso.get("destinatario_cnpj")))
    _txt(receptor, "DbParceiroCodigo", _s(aviso.get("destinatario_codigo"), cod_cliente or parceiro_externo))
    _txt(receptor, "DbParceiroNome", parceiro_externo)
    _txt(receptor, "DbParceiroQualif", _s(aviso.get("destinatario_qualif")))
    _txt(receptor, "DbParceiroComCode", _s(aviso.get("destinatario_com_code")))

    embarcador = ET.SubElement(parceiros, "ParceiroEmbarcador", {"Sufixo": "EbM"})
    _txt(embarcador, "DbParceiroCodigo", _s(aviso.get("embarcador_codigo")))
    _txt(embarcador, "DbParceiroNome", _s(aviso.get("embarcador_nome")))
    _txt(embarcador, "DbParceiroQualif", _s(aviso.get("embarcador_qualif")))

    operador = ET.SubElement(parceiros, "ParceiroOperadorLogistico", {"Sufixo": "OpL"})
    _txt(operador, "DbParceiroCodigo", _s(aviso.get("operador_logistico_codigo")))
    _txt(operador, "DbParceiroNome", _s(aviso.get("operador_logistico_nome")))
    _txt(operador, "DbParceiroQualif", _s(aviso.get("operador_logistico_qualif")))

    recebedor = ET.SubElement(parceiros, "ParceiroRecebedorMercadoria", {"Sufixo": "RbM"})
    _txt(recebedor, "DbParceiroCodigo", _s(aviso.get("recebedor_codigo"), cod_cliente))
    _txt(recebedor, "DbParceiroNome", _s(aviso.get("recebedor_nome")))
    _txt(recebedor, "DbParceiroQualif", _s(aviso.get("recebedor_qualif")))

    direct_ship = ET.SubElement(parceiros, "ParceiroDirectShip", {"Sufixo": "DSH"})
    _txt(direct_ship, "DbParceiroCodigo", _s(aviso.get("direct_ship_codigo")))
    _txt(direct_ship, "DbParceiroNome", _s(aviso.get("direct_ship_nome")))
    _txt(direct_ship, "DbParceiroQualif", _s(aviso.get("direct_ship_qualif")))

    asn_occs = ET.SubElement(asn_subset, "ASNoccs")
    cab = ET.SubElement(asn_occs, "Tb_ASNCabecalho")

    _txt(cab, "DbOcc", "1")
    _txt(cab, "DbEDIversao", _s(aviso.get("edi_versao"), "99"))
    _txt(cab, "DbEDIvs", _s(aviso.get("edi_vs"), "99"))
    _txt(cab, "DbDtHrMovimento", now_dt)
    _txt(cab, "DbFilial", _s(aviso.get("filial"), _s(aviso.get("fabrica"), "1")))
    _txt(cab, "DbNotaFiscal", _s(aviso.get("num_nf")))
    _txt(cab, "DbChaveNFe", _s(aviso.get("chave_nfe")))
    _txt(cab, "DbAtoConcessorioDrawback", _s(aviso.get("ato_concessorio_drawback")))
    _txt(cab, "DbEspecie", _s(aviso.get("especie"), "02"))
    _txt(cab, "DbSerie", _s(aviso.get("serie_nfe"), "1"))
    _txt(cab, "DbInvoice", _s(aviso.get("invoice")))
    _txt(cab, "DbDataEmissao", _fmt_date(aviso.get("data_emissao_nfe")))
    _txt(cab, "DbDataVencimento", _fmt_date(aviso.get("data_vencimento_nfe") or aviso.get("data_vencimento")))
    _txt(cab, "DbCFOP", cfop_header)
    _txt(cab, "DbNaturezaOperacao", _s(aviso.get("nat_operacao")))
    _txt(cab, "DbSWEDI_ParceiroLocal", parceiro_local)
    _txt(cab, "DbSWEDI_ParceiroExterno", parceiro_externo)
    _txt(cab, "DbSWEDI_ClienteCodigo", cod_cliente)

    totais = ET.SubElement(cab, "ValoresTotais")
    _txt(totais, "DbValorDesconto", _dec(aviso.get("valor_desconto"), 2, "0.00"))
    _txt(totais, "DbValorDespesa", _dec(aviso.get("valor_despesa"), 2, "0.00"))
    _txt(totais, "DbValorDescontoICMS", _dec(aviso.get("valor_desconto_icms"), 2, "0.00"))
    _txt(totais, "DbValorFrete", _dec(aviso.get("valor_frete"), 2, "0.00"))
    _txt(totais, "DbBaseICMS", total_base)
    _txt(totais, "DbValorICMS", total_icms_valor)
    _txt(totais, "DbBaseICMSsubsTrib", _dec(aviso.get("base_icms_subs_trib"), 2, "0.00"))
    _txt(totais, "DbValorICMSsubsTrib", _dec(aviso.get("valor_icms_subs_trib"), 2, "0.00"))
    _txt(totais, "DbValorIPI", _dec(aviso.get("valor_ipi"), 2, "0.00"))
    _txt(totais, "DbValorPIS", _dec(aviso.get("valor_pis"), 2, "0.00"))
    _txt(totais, "DbValorCOFINS", _dec(aviso.get("valor_cofins"), 2, "0.00"))
    _txt(totais, "DbValorSeguro", _dec(aviso.get("valor_seguro"), 2, "0.00"))
    _txt(totais, "DbValorServicoIndustr", _dec(aviso.get("valor_servico_industr"), 2, "0.00"))
    _txt(totais, "DbValorTotal", total_valor)

    expedicao = ET.SubElement(cab, "Expedicao")
    _txt(expedicao, "DbFabricaCliente", _s(aviso.get("fabrica_cliente"), _s(aviso.get("fabrica"))))
    _txt(expedicao, "DbLocalEntrega", _s(aviso.get("local_entrega")))
    _txt(expedicao, "DbDoca", _s(aviso.get("doca")))
    _txt(expedicao, "DbLocalCobranca", _s(aviso.get("local_cobranca")))
    _txt(expedicao, "DbLocalFaturamento", _s(aviso.get("local_faturamento")))
    _txt(expedicao, "DbFabricaTransmissor", _s(aviso.get("fabrica_transmissor"), _s(aviso.get("fabrica"))))
    _txt(expedicao, "DbDtHrEmbarque", _fmt_dt(aviso.get("data_embarque")))
    _txt(expedicao, "DbDtHrChegadaPrevista", _fmt_dt(aviso.get("data_chegada_prevista") or aviso.get("data_embarque")))
    _txt(expedicao, "DbRota", _s(aviso.get("rota")))
    _txt(expedicao, "DbTipoTransporte", _s(aviso.get("tipo_transporte")))
    _txt(expedicao, "DbPlacaVeiculo", _s(aviso.get("placa_veiculo")))
    _txt(expedicao, "DbPesoBruto", _dec(aviso.get("peso_bruto"), 3, peso_bruto))
    _txt(expedicao, "DbUnidadeMedidaPesoBruto", _s(aviso.get("un_med_peso_bruto"), "K"))
    _txt(expedicao, "DbPesoLiquido", _dec(aviso.get("peso_liquido"), 3, peso_liquido))
    _txt(expedicao, "DbUnidadeMedidaPesoLiquido", _s(aviso.get("un_med_peso_liquido"), "K"))
    _txt(expedicao, "DbTotalVolumes", _int(aviso.get("total_volumes"), int(total_volumes)))
    _txt(expedicao, "DbUnidadeMedidaVolumes", _s(aviso.get("un_med_volumes"), "U"))

    gm = ET.SubElement(cab, "EspecificoGM")
    _txt(gm, "GMContatoFornecedor", _s(aviso.get("gm_contato_fornecedor")))
    _txt(gm, "GMContatoGM", _s(aviso.get("gm_contato_gm")))
    _txt(gm, "GMDtJanela", _s(aviso.get("gm_dt_janela")))
    _txt(gm, "GMFoneFornecedor", _s(aviso.get("gm_fone_fornecedor")))
    _txt(gm, "GMSenha", _s(aviso.get("gm_senha")))

    subset_itens = ET.SubElement(cab, "SubsetITENS", {"DbTotalItens": str(len(itens))})

    for seq, item in enumerate(itens, start=1):
        qtd_nf = _s(item.get("qtd_nfe") or item.get("quantidade"), "0")
        qtd_exp = _s(item.get("quantidade") or item.get("qtd_nfe"), "0")
        unidade = _s(item.get("unidade_medida"), "PC")
        call_deliveries = _iter_call_deliveries(item)

        asn_item = ET.SubElement(subset_itens, "Tb_ASNItem")
        _txt(asn_item, "DbItOcc", _int(item.get("occ"), seq))
        _txt(asn_item, "DbItProdutoLocal", _s(item.get("produto_local")))
        _txt(asn_item, "DbItProdutoLocalVs", _s(item.get("produto_local_vs")))
        _txt(asn_item, "DbItProdutoCliente", _s(item.get("produto_externo")))
        _txt(asn_item, "DbItProdutoClienteVs", _s(item.get("produto_externo_vs")))
        _txt(asn_item, "DbItProdutoClienteDescricao", _s(item.get("descricao")))
        _txt(asn_item, "DbItClassificacaoFiscal", _s(item.get("ncm")))
        _txt(asn_item, "DbItNumeroPedido", _s(item.get("num_pedido")))
        _txt(asn_item, "DbItPedidoDSH", _s(item.get("pedido_dsh")))
        _txt(asn_item, "DbItCFOitem", _s(item.get("cfop") or item.get("nfe_cfop")))
        _txt(asn_item, "DbItTipoFornecimento", _s(item.get("tipo_fornecimento")))
        _txt(asn_item, "DbItUnidadeMedidaNF", _s(item.get("un_med_nf"), unidade))
        _txt(asn_item, "DbItQtdFaturada", _dec(qtd_nf, 3, "0.000"))
        _txt(asn_item, "DbItValorUnitario", _dec(item.get("valor_unitario"), 5, "0.00000"))
        _txt(asn_item, "DbItAliquotaIPI", _dec(item.get("aliquota_ipi"), 2, "0.00"))
        _txt(asn_item, "DbItValorIPI", _dec(item.get("valor_ipi"), 2, "0.00"))
        _txt(asn_item, "DbItBaseICMS", _dec(item.get("base_icms") or item.get("nfe_vBC"), 2, "0.00"))
        _txt(asn_item, "DbItAliquotaICMS", _dec(item.get("aliquota_icms"), 2, "0.00"))
        _txt(asn_item, "DbItValorICMS", _dec(item.get("valor_icms") or item.get("nfe_vICMS"), 2, "0.00"))
        _txt(asn_item, "DbItValorDescontoICMS", _dec(item.get("valor_desconto_icms"), 2, "0.00"))
        _txt(asn_item, "DbItBaseICMSsubsTribut", _dec(item.get("base_icms_subs_tribut"), 2, "0.00"))
        _txt(asn_item, "DbItAliquotaICMSsubsTribut", _dec(item.get("aliquota_icms_subs_tribut"), 2, "0.00"))
        _txt(asn_item, "DbItValorICMSsubsTribut", _dec(item.get("valor_icms_subs_tribut"), 2, "0.00"))
        _txt(asn_item, "DbItValorServicoIndustr", _dec(item.get("valor_servico_industr"), 2, "0.00"))
        _txt(asn_item, "DbItValorPIS", _dec(item.get("valor_pis"), 2, "0.00"))
        _txt(asn_item, "DbItValorCOFINS", _dec(item.get("valor_cofins"), 2, "0.00"))
        _txt(asn_item, "DbItAliquotaDoDesconto", _dec(item.get("aliquota_desconto"), 2, "0.00"))
        _txt(asn_item, "DbItValorDoDesconto", _dec(item.get("valor_desconto"), 2, "0.00"))
        _txt(asn_item, "DbItValorTotal", _dec(item.get("valor_total"), 2, _dec(item.get("nfe_vNF"), 2, "0.00")))
        _txt(asn_item, "DbItMultiplicador", _dec(item.get("multiplicador"), 2, "0.00"))
        _txt(asn_item, "DbItPesoBruto", _dec(item.get("peso_bruto"), 3, "0.000"))
        _txt(asn_item, "DbItPesoLiquido", _dec(item.get("peso_liquido"), 3, "0.000"))
        _txt(asn_item, "DbItCodigoSTE", _s(item.get("codigo_ste"), "00"))
        _txt(asn_item, "DbItCodigoSTF", _s(item.get("codigo_stf")))
        _txt(asn_item, "DbPaisOrigemFabricacao", _s(item.get("pais_origem_fabricacao")))
        _txt(asn_item, "DbItNumeroDoDesenhoDoCliente", _s(item.get("num_desenho_cliente")))
        _txt(asn_item, "DbItDataDeAlteracaoDoDesenho", _s(item.get("dt_alteracao_desenho")))
        _txt(asn_item, "DbItUnidadeMedidaEst", _s(item.get("un_med_est"), unidade))
        _txt(asn_item, "DbItQtdEstoque", _dec(item.get("qtd_estoque") or qtd_exp, 3, "0.000"))
        _txt(asn_item, "DbItUnidadeMedidaCmp", _s(item.get("un_med_cmp"), unidade))
        _txt(asn_item, "DbItQtdCompras", _dec(item.get("qtd_compras") or qtd_exp, 3, "0.000"))
        _txt(asn_item, "DbItQuantidadeAcumuladaEntregue", _dec(item.get("qtd_acumulada_entregue"), 3, "0.000"))
        _txt(asn_item, "DbItTotalDefaultUCsPor1UM", _int(item.get("total_default_ucs_por_um"), 0))
        _txt(asn_item, "DbItHonda_SlipNumber", _s(item.get("honda_slip_number")))
        _txt(asn_item, "DbItHonda_TipoPedido", _s(item.get("honda_tipo_pedido")))
        _txt(asn_item, "DbItHonda_Seppen", _s(item.get("honda_seppen")))
        _txt(asn_item, "DbItHonda_LoteProducao", _s(item.get("honda_lote_producao")))
        _txt(asn_item, "DbItHonda_CPI", _s(item.get("honda_cpi")))

        subset_etq = ET.SubElement(asn_item, "SubsetETIQUETAS", {"DbTotalEtiquetas": "1"})
        etiqueta = ET.SubElement(subset_etq, "Tb_ASNItemEtiqueta")
        _txt(etiqueta, "DbEtqOcc", _int(item.get("occ"), seq))
        _txt(etiqueta, "DbEtqNroSequencial", _int(item.get("nro_sequencial_etq"), seq))
        _txt(etiqueta, "DbEtqCallDelivery", _s(call_deliveries[0].get("call_delivery")))
        _txt(etiqueta, "DbEtqDtGeracaoCallDelivery", _fmt_dt(item.get("dt_geracao_call_delivery")))
        _txt(etiqueta, "DbEtqCodigoEmbalagemUC", _s(item.get("codigo_embalagem_uc")))
        _txt(etiqueta, "DbEtqNroEtiquetaUnidadeCondicionamento", _s(item.get("numero_uc"), f"UC{seq:06d}"))
        _txt(etiqueta, "DbEtqQuantidadeDePecasNaUC", _int(item.get("qtd_pecas_uc"), int(Decimal(_dec(qtd_exp, 0, "0")))))
        _txt(etiqueta, "DbEtqValorDaEmbalagemUC", _dec(item.get("valor_embalagem_uc"), 2, "0.00"))
        _txt(etiqueta, "DbEtqCodigoEmbalagemUM", _s(item.get("codigo_embalagem_um")))
        _txt(etiqueta, "DbEtqNroEtiquetaUnidadeMovimentacao", _s(item.get("numero_um"), f"UM{seq:06d}"))
        _txt(etiqueta, "DbEtqEstoquista", _s(item.get("estoquista")))
        _txt(etiqueta, "DbEtqDoca", _s(item.get("doca"), _s(aviso.get("doca"))))
        _txt(etiqueta, "DbEtqPontoDeUso", _s(item.get("ponto_uso"), _s(aviso.get("local_entrega"))))
        _txt(etiqueta, "DbEtqNroSequencialViaProdutoEtqNaNF", _s(item.get("nro_seq_prod_etq_nf"), str(seq)))
        _txt(etiqueta, "DbEtqCodigoMudancaEngenharia", _s(item.get("codigo_mudanca_engenharia")))
        _txt(etiqueta, "DbEtqDtUltimaModificacao", _fmt_dt(item.get("dt_ult_modificacao")))
        _txt(etiqueta, "DbEtqDtValidade", _s(item.get("dt_validade")))
        _txt(etiqueta, "DbEtqLoteFabricacao", _s(item.get("lote")))
        _txt(etiqueta, "DbEtqLoteQuantidade", _dec(item.get("lote_quantidade") or qtd_exp, 3, "0.000"))
        _txt(etiqueta, "DbEtqLoteSobDesvio", _s(item.get("lote_sob_desvio")))
        _txt(etiqueta, "DbEtqTextoLivre", _s(item.get("texto_livre"), _s(aviso.get("num_nf"))))
        _txt(etiqueta, "DbEtqNFDataOriginalEmbalagemUC", _s(item.get("nf_data_original_embalagem_uc")))
        _txt(etiqueta, "DbEtqNFNroOriginalEmbalagemUC", _s(item.get("nf_nro_original_embalagem_uc")))
        _txt(etiqueta, "DbEtqNFSerieOriginalEmbalagemUC", _s(item.get("nf_serie_original_embalagem_uc")))
        _txt(etiqueta, "DbEtqDtHrUltimaImpressaoEfetiva", _s(item.get("dt_hr_ultima_impressao_efetiva")))
        _txt(etiqueta, "DbEtqDtFabricacao", _s(item.get("data_fabricacao")))

        subset_cd = ET.SubElement(asn_item, "SubsetCALLDELIVERIES", {"DbTotalCallDeliveries": str(len(call_deliveries))})
        for cd_seq, cd in enumerate(call_deliveries, start=1):
            cd_el = ET.SubElement(subset_cd, "Tb_ASNItemCallDelivery")
            _txt(cd_el, "DbCDVOcc", _int(cd.get("occ"), cd_seq))
            _txt(cd_el, "DbCDVNroSequencial", _int(cd.get("nro_sequencial"), cd_seq))
            _txt(cd_el, "DbCDVNroSequencialItem", _int(item.get("occ"), seq))
            _txt(cd_el, "DbCDVKeyAEMnroSequencialCab", _int(cd.get("key_ae_nro_seq_cab"), 1))
            _txt(cd_el, "DbCDVSequencialTXT", _s(cd.get("sequencial_txt"), str(cd_seq)))
            _txt(cd_el, "DbCDVCallDelivery", _s(cd.get("call_delivery")))
            _txt(cd_el, "DbCDVDtGeracaoCallDelivery", _fmt_dt(cd.get("dt_geracao") or item.get("dt_geracao_call_delivery")))
            _txt(cd_el, "DbCDVCrossDock", _s(cd.get("cross_dock")))
            _txt(cd_el, "DbCDVDtEntregaATE_Original", _s(cd.get("dt_entrega_ate_original")))
            _txt(cd_el, "DbCDVDtEntregaDE_Original", _s(cd.get("dt_entrega_de_original")))
            _txt(cd_el, "DbCDVEmbalagemUM_codigo", _s(cd.get("embalagem_um_codigo")))
            _txt(cd_el, "DbCDVEmbalagemUM_undMed", _s(cd.get("embalagem_um_und_med"), unidade))
            _txt(cd_el, "DbCDVEmbalagemUC_codigo", _s(cd.get("embalagem_uc_codigo")))
            _txt(cd_el, "DbCDVEmbalagemUC_undMed", _s(cd.get("embalagem_uc_und_med"), unidade))
            _txt(cd_el, "DbCDVEmbalagemUC_qtdPc", _dec(cd.get("embalagem_uc_qtd_pc") or qtd_exp, 3, "0.000"))
            _txt(cd_el, "DbCDVEmbalagemUM_qtdUC", _dec(cd.get("embalagem_um_qtd_uc"), 3, "0.000"))
            _txt(cd_el, "DbCDVQuantidadeEmbalagens", _dec(cd.get("qtd_embalagens"), 3, "0.000"))
            _txt(cd_el, "DbCDVLocalDestino", _s(cd.get("local_destino"), _s(aviso.get("local_entrega"))))
            _txt(cd_el, "DbCDVRota", _s(cd.get("rota"), _s(aviso.get("rota"))))
            _txt(cd_el, "DbCDVDoca", _s(cd.get("doca"), _s(aviso.get("doca"))))
            _txt(cd_el, "DbCDVDeposito", _s(cd.get("deposito"), _s(aviso.get("fabrica"))))
            _txt(cd_el, "DbCDVPtoUso", _s(cd.get("pto_uso"), _s(aviso.get("local_entrega"))))
            _txt(cd_el, "DbCDVQtdEntregue", _dec(cd.get("quantidade") or qtd_exp, 3, "0.000"))
            _txt(cd_el, "DbCDVQtdEntrega_Original", _dec(cd.get("qtd_entrega_original") or cd.get("quantidade") or qtd_exp, 3, "0.000"))
            _txt(cd_el, "DbCDVNFeChaveAcesso", _s(aviso.get("chave_nfe")))
            _txt(cd_el, "DbCDVNroNotaFiscal", _s(aviso.get("num_nf")))

    # ── Serialização ─────────────────────────────────────────────────────────────
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(
        root, encoding="unicode", xml_declaration=False
    )


def parse_itens_json(itens_json: str | None) -> list[dict]:
    """Desserializa itens_json do banco de dados."""
    if not itens_json:
        return []
    try:
        data = json.loads(itens_json)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []
