using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Stimulsoft.Base;
using Stimulsoft.Report;
using Stimulsoft.Report.Dictionary;
using Stimulsoft.Report.Export;
using System.Text.RegularExpressions;
using System.Xml;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace StimulusoftService.Services;

public sealed record PreviewExportOptions(
    int   SelectedPage = 1,
    float MainDpi      = 180f,
    float ThumbDpi     = 55f,
    float Quality      = 0.85f
);

public sealed record PreviewPageItem(
    int    Page,
    byte[] Bytes,
    bool   IsSelected
);

public sealed record PreviewExportResult(
    int                     TotalPages,
    int                     SelectedPage,
    PreviewPageItem         MainPage,
    IReadOnlyList<PreviewPageItem> Thumbnails
);

/// <summary>
/// Motor central Stimulsoft: carrega licença, resolve templates MRT e exporta relatórios/etiquetas.
/// </summary>
public sealed class StimulusoftEngine
{
    private readonly ILogger<StimulusoftEngine> _logger;
    private readonly IConfiguration _config;

    public string TemplatesPath { get; private set; } = string.Empty;
    public string EtiquetasPath { get; private set; } = string.Empty;

    // ─── ASN relation definitions (mirror do StiLabelViewer.tsx) ─────────────
    private static readonly (string Parent, string ParentCol, string Child)[] RelationDefs =
    [
        ("ARQUIVOEDI",                       "ASN_SET",         "ARQUIVOEDI_ASN_SET"),
        ("ARQUIVOEDI_ASN_SET",               "ASN_SUBSET",      "ARQUIVOEDI_ASN_SET_ASN_SUBSET"),
        ("ARQUIVOEDI_ASN_SET_ASN_SUBSET",    "ASNoccs",         "ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs"),
        ("ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs", "Tb_ASNCabecalho", "ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho"),
        ("ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho", "SubsetITENS", "ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS"),
        ("ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS", "Tb_ASNItem", "ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem"),
        ("ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem", "SubsetETIQUETAS", "ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS"),
        ("ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS", "Tb_ASNItemEtiqueta", "ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS_Tb_ASNItemEtiqueta"),
    ];

    private static readonly string[] FallbackAliases =
    [
        "NFe", "NFeProc", "nfeProcV4", "procNFe", "NFeDataset", "Dataset",
        "CTe", "CTeProc", "cteProcV4", "procCTe", "cTe", "CTeDataset",
    ];

    public StimulusoftEngine(ILogger<StimulusoftEngine> logger, IConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    // ─── Inicialização de licença ─────────────────────────────────────────────
    public void Initialize()
    {
        TemplatesPath = _config["Templates:MrtRootPath"] ?? AppContext.BaseDirectory;
        EtiquetasPath = Path.Combine(TemplatesPath, "Etiquetas");

        var keyPath = _config["Templates:LicenseKeyPath"];
        if (!string.IsNullOrWhiteSpace(keyPath) && File.Exists(keyPath))
        {
            try
            {
                var key = File.ReadAllText(keyPath).Trim();
                StiLicense.LoadFromString(key);
                _logger.LogInformation("✅ Licença Stimulsoft carregada de: {Path}", keyPath);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "⚠️ Falha ao carregar licença Stimulsoft. Rodando em modo trial.");
            }
        }
        else
        {
            _logger.LogWarning("⚠️ license.key não encontrado em '{Path}'. Rodando em modo trial.", keyPath);
        }

        _logger.LogInformation("📁 Templates: {Path}", TemplatesPath);
        _logger.LogInformation("🏷️  Etiquetas: {Path}", EtiquetasPath);
    }

    // ─── Resolve caminho do .mrt ──────────────────────────────────────────────
    public string ResolveMrtPath(string filename, bool isEtiqueta = false)
    {
        if (isEtiqueta)
        {
            var etqPath = Path.Combine(EtiquetasPath, filename);
            if (File.Exists(etqPath)) return etqPath;
        }
        var mrtPath = Path.Combine(TemplatesPath, filename);
        if (File.Exists(mrtPath)) return mrtPath;
        throw new FileNotFoundException($"Template MRT não encontrado: {filename}", filename);
    }

    // ─── Lista templates disponíveis ──────────────────────────────────────────
    public IEnumerable<string> ListReportTemplates()
    {
        if (!Directory.Exists(TemplatesPath)) return [];
        return Directory.GetFiles(TemplatesPath, "*.mrt", SearchOption.TopDirectoryOnly)
                        .Select(Path.GetFileName).Where(f => f != null).Cast<string>().OrderBy(f => f);
    }

    public IEnumerable<string> ListLabelTemplates()
    {
        if (!Directory.Exists(EtiquetasPath)) return [];
        return Directory.GetFiles(EtiquetasPath, "*.mrt", SearchOption.TopDirectoryOnly)
                        .Select(Path.GetFileName).Where(f => f != null).Cast<string>().OrderBy(f => f);
    }

    // ─── Exporta para PDF ─────────────────────────────────────────────────────
    public byte[] ExportToPdf(string mrtContent, string dataPayload, ExportOptions opts)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);

        using var ms = new MemoryStream();
        var svc = new StiPdfExportService();
        var settings = new StiPdfExportSettings
        {
            PageRange    = StiPagesRange.All,
            EmbeddedFonts = true,
        };
        svc.ExportTo(report, ms, settings);
        return ms.ToArray();
    }

    // ─── Exporta para imagem por página (JPEG ou PNG) ────────────────────────
    public List<byte[]> ExportToImages(string mrtContent, string dataPayload, JpegExportOptions opts, bool png = false)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);

        int totalPages = report.RenderedPages.Count;
        int fromPage   = opts.FromPage ?? 1;
        int toPage     = opts.ToPage   ?? totalPages;

        var results = new List<byte[]>();
        for (int p = fromPage; p <= toPage; p++)
        {
            using var ms = new MemoryStream();

            var settings = new StiImageExportSettings
            {
                PageRange      = new StiPagesRange(StiRangeType.Pages, p.ToString(), p),
                ImageResolution = (int)opts.Dpi,
                ImageType      = png ? StiImageType.Png : StiImageType.Jpeg,
            };

            var svc = new StiImageExportService();
            svc.ExportTo(report, ms, settings);
            results.Add(ms.ToArray());
        }
        return results;
    }

    // ─── Exporta pacote de preview (thumbnails + página principal) ──────────
    public PreviewExportResult ExportPreview(string mrtContent, string dataPayload, PreviewExportOptions opts, bool png = false)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);

        int totalPages = report.RenderedPages.Count;
        if (totalPages <= 0)
            return new PreviewExportResult(0, 1, new PreviewPageItem(1, Array.Empty<byte>(), true), []);

        int selectedPage = Math.Clamp(opts.SelectedPage, 1, totalPages);
        var thumbnails = new List<PreviewPageItem>(totalPages);

        for (int page = 1; page <= totalPages; page++)
        {
            var thumbBytes = ExportSinglePage(report, page, opts.ThumbDpi, png);
            thumbnails.Add(new PreviewPageItem(page, thumbBytes, page == selectedPage));
        }

        var mainBytes = ExportSinglePage(report, selectedPage, opts.MainDpi, png);
        var mainPage = new PreviewPageItem(selectedPage, mainBytes, true);

        return new PreviewExportResult(totalPages, selectedPage, mainPage, thumbnails);
    }

    public IReadOnlyList<PreviewPageItem> ExportThumbnails(string mrtContent, string dataPayload, float thumbDpi, bool png = false)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);

        int totalPages = report.RenderedPages.Count;
        if (totalPages <= 0) return [];

        var thumbnails = new List<PreviewPageItem>(totalPages);
        for (int page = 1; page <= totalPages; page++)
        {
            var thumbBytes = ExportSinglePage(report, page, thumbDpi, png);
            thumbnails.Add(new PreviewPageItem(page, thumbBytes, false));
        }

        return thumbnails;
    }

    public byte[] ExportMainPage(string mrtContent, string dataPayload, int page, float mainDpi, bool png = false)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);

        int totalPages = report.RenderedPages.Count;
        if (totalPages <= 0) return Array.Empty<byte>();

        int selectedPage = Math.Clamp(page, 1, totalPages);
        return ExportSinglePage(report, selectedPage, mainDpi, png);
    }

    // ─── Exporta para HTML ────────────────────────────────────────────────────
    public byte[] ExportToHtml(string mrtContent, string dataPayload)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);

        using var ms = new MemoryStream();
        var svc      = new StiHtml5ExportService();
        var settings = new StiHtmlExportSettings
        {
            ExportMode        = StiHtmlExportMode.Table,
            UseEmbeddedImages = true,
        };
        svc.ExportTo(report, ms, settings);
        return ms.ToArray();
    }

    // ─── Conta páginas sem exportar ───────────────────────────────────────────
    public int CountPages(string mrtContent, string dataPayload)
    {
        var report = BuildReport(mrtContent, dataPayload);
        report.Render(false);
        return report.RenderedPages.Count;
    }

    private static byte[] ExportSinglePage(StiReport report, int page, float dpi, bool png)
    {
        using var ms = new MemoryStream();
        var settings = new StiImageExportSettings
        {
            PageRange = new StiPagesRange(StiRangeType.Pages, page.ToString(), page),
            ImageResolution = (int)dpi,
            ImageType = png ? StiImageType.Png : StiImageType.Jpeg,
        };

        var svc = new StiImageExportService();
        svc.ExportTo(report, ms, settings);
        return ms.ToArray();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNALS — Montagem do relatório (replica StiLabelViewer.tsx)
    // ══════════════════════════════════════════════════════════════════════════

    private StiReport BuildReport(string mrtContent, string dataPayload)
    {
        var report = new StiReport();
        report.LoadFromString(mrtContent);

        bool isJson = dataPayload.TrimStart().StartsWith('{') || dataPayload.TrimStart().StartsWith('[');

        if (isJson)
        {
            // ── JSON: DataSet em memória com expansão recursiva de arrays ──────────────
            // Replicamos exatamente o que o StiJsonDatabase faria ao ler um arquivo:
            //  - Array raiz  → tabela "root"
            //  - Array aninhado em prop X  → tabela "root_X" + coluna relationId
            //  - As relações no .mrt usam root.X = root_X.relationId

            // Coleta APENAS os nomes de DATABASE declarados no .mrt (não datasources)
            var dbNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (StiDatabase db in report.Dictionary.Databases)
            {
                if (!string.IsNullOrEmpty(db.Name)) dbNames.Add(db.Name);
            }
            if (dbNames.Count == 0) dbNames.Add("DATASET");

            report.Dictionary.Databases.Clear();

            foreach (var dbName in dbNames)
            {
                try
                {
                    var ds = new System.Data.DataSet(dbName);
                    FillFromJson(ds, dataPayload);
                    report.RegData(dbName, dbName, ds);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug("RegData JSON '{Name}' falhou: {Msg}", dbName, ex.Message);
                }
            }

            report.Dictionary.Synchronize();
            return report;
        }

        // ── XML: fluxo original ───────────────────────────────────────────────
        string rootName  = "DATASET";
        string cleanXml  = string.Empty;
        string finalXml  = string.Empty;
        bool   requiresHierarchical = false;

        cleanXml = StripXmlNamespaces(dataPayload);
        rootName = DetectXmlRootName(cleanXml);

        // Verifica se o relatório precisa de nomes hierárquicos (ex: nfeProc_NFe_infNFe)
        foreach (StiDataSource ds in report.Dictionary.DataSources)
        {
            if (ds is StiDataTableSource dts && dts.NameInSource?.Contains('_') == true)
            {
                requiresHierarchical = true;
                break;
            }
        }

        finalXml = requiresHierarchical ? BuildHierarchicalXml(cleanXml) : cleanXml;

        // ─── Coleta nomes de databases declarados no .mrt ─────────────────
        var expectedNames = new HashSet<string>(FallbackAliases) { rootName, "DATASET" };
        foreach (StiDatabase db in report.Dictionary.Databases)
        {
            if (!string.IsNullOrEmpty(db.Name))  expectedNames.Add(db.Name);
            if (!string.IsNullOrEmpty(db.Alias)) expectedNames.Add(db.Alias);
        }

        report.Dictionary.Databases.Clear();

        // ─── Registra dados para cada nome esperado ───────────────────────
        foreach (var dbName in expectedNames)
        {
            try
            {
                var ds = new System.Data.DataSet(dbName);
                FillFromXml(ds, finalXml);
                report.RegData(dbName, dbName, ds);
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Dataset '{Name}' não registrado: {Msg}", dbName, ex.Message);
            }
        }

        report.Dictionary.Synchronize();

        // ─── Patch de relações ASN ────────────────────────────────────────
        if (rootName == "ARQUIVOEDI" || finalXml.Contains("<ARQUIVOEDI"))
            PatchAsnRelations(report);

        return report;
    }




    // ─── Strip namespace XML ──────────────────────────────────────────────────
    private static string StripXmlNamespaces(string xml)
    {
        if (string.IsNullOrWhiteSpace(xml)) return xml;
        xml = xml.TrimStart('\uFEFF');
        xml = Regex.Replace(xml, @" xmlns(:\w+)?=""[^""]*""", "");
        xml = Regex.Replace(xml, @"<(\w+):", "<");
        xml = Regex.Replace(xml, @"</(\w+):", "</");
        return xml;
    }

    // ─── Detecta nome raiz do XML ─────────────────────────────────────────────
    private static string DetectXmlRootName(string xml)
    {
        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var name = doc.DocumentElement?.LocalName;
            if (!string.IsNullOrEmpty(name) && name != "parsererror" && name != "DATASET")
                return name;
        }
        catch { /* ignored */ }
        return "DATASET";
    }

    // ─── Constrói XML hierárquico ─────────────────────────────────────────────
    private string BuildHierarchicalXml(string xmlString)
    {
        try
        {
            var doc  = new XmlDocument();
            doc.LoadXml(xmlString);
            var root = doc.DocumentElement!;

            void Traverse(XmlElement node, string prefix)
            {
                bool isTable = node.ChildNodes.Cast<XmlNode>().Any(n => n.NodeType == XmlNodeType.Element);
                if (!isTable) return;

                var newName = string.IsNullOrEmpty(prefix) ? node.LocalName : $"{prefix}_{node.LocalName}";
                var newNode = doc.CreateElement(newName);

                foreach (XmlAttribute attr in node.Attributes!)
                    newNode.SetAttribute(attr.Name, attr.Value);

                foreach (var child in node.ChildNodes.Cast<XmlNode>().ToList())
                    newNode.AppendChild(child.CloneNode(true));

                node.ParentNode!.ReplaceChild(newNode, node);

                foreach (XmlElement child in newNode.ChildNodes.OfType<XmlElement>().ToList())
                    Traverse(child, newName);
            }

            if (root.LocalName == "DATASET")
            {
                foreach (XmlElement child in root.ChildNodes.OfType<XmlElement>().ToList())
                    foreach (XmlElement grand in child.ChildNodes.OfType<XmlElement>().ToList())
                        Traverse(grand, child.LocalName);
            }
            else
            {
                foreach (XmlElement child in root.ChildNodes.OfType<XmlElement>().ToList())
                    Traverse(child, root.LocalName);
            }

            return doc.OuterXml;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Erro ao construir XML hierárquico — usando original.");
            return xmlString;
        }
    }

    // ─── Preenche DataSet a partir de XML ────────────────────────────────────
    private static void FillFromXml(System.Data.DataSet ds, string xml)
    {
        using var reader = new StringReader(xml);
        ds.ReadXml(reader);
    }

    // ─── Preenche DataSet a partir de JSON (expansão recursiva) ─────────────────────────
    // Replica o comportamento do StiJsonDatabase:
    //  - Array raiz  → tabela "root"
    //  - Array aninhado em prop "X"  → tabela "root_X", coluna "relationId" = índice do pai
    //  - Relacióes hierarquicas: root.X (valor = idx) ↔ root_X.relationId (valor = idx)
    private static void FillFromJson(System.Data.DataSet ds, string json)
    {
        var token = JToken.Parse(json);
        var rootArray = token is JArray arr ? arr : new JArray(token);
        ExpandArrayToTables(ds, "root", rootArray);
    }

    /// <summary>
    /// Expande recursivamente um JArray em DataTable(s) no DataSet.
    /// Arrays aninhados viram tabelas filho (tableName_propName) com coluna relationId.
    /// Replica o comportamento do StiJsonDatabase nativo do Stimulsoft.
    /// </summary>
    private static void ExpandArrayToTables(System.Data.DataSet ds, string tableName, JArray array)
    {
        if (array.Count == 0) return;

        var table = new System.Data.DataTable(tableName);
        ds.Tables.Add(table);

        // Acumula arrays aninhados para processar depois
        var childQueues = new Dictionary<string, List<(string parentKey, JArray rows)>>(StringComparer.Ordinal);

        for (int i = 0; i < array.Count; i++)
        {
            if (array[i] is not JObject item) continue;

            var row = table.NewRow();

            foreach (var prop in item.Properties())
            {
                if (prop.Value is JArray nestedArray)
                {
                    // Array aninhado → coluna pai recebe o índice, filho recebe relationId
                    if (!table.Columns.Contains(prop.Name))
                        table.Columns.Add(prop.Name, typeof(string));
                    row[prop.Name] = i.ToString();

                    if (!childQueues.ContainsKey(prop.Name))
                        childQueues[prop.Name] = new List<(string, JArray)>();
                    childQueues[prop.Name].Add((i.ToString(), nestedArray));
                }
                else
                {
                    if (!table.Columns.Contains(prop.Name))
                        table.Columns.Add(prop.Name, typeof(string));
                    row[prop.Name] = prop.Value?.Type is JTokenType.Null or JTokenType.Undefined
                        ? string.Empty
                        : (prop.Value?.ToString() ?? string.Empty);
                }
            }

            table.Rows.Add(row);
        }

        // Constrói tabelas filho recursivamente
        foreach (var (propName, batches) in childQueues)
        {
            var childTableName = $"{tableName}_{propName}";
            var merged = new JArray();

            foreach (var (parentKey, childRows) in batches)
            {
                foreach (var childToken in childRows)
                {
                    if (childToken is JObject childObj)
                    {
                        var clone = (JObject)childObj.DeepClone();
                        clone["relationId"] = parentKey; // liga ao pai via relação do .mrt
                        merged.Add(clone);
                    }
                }
            }

            if (merged.Count > 0)
                ExpandArrayToTables(ds, childTableName, merged);
        }
    }


    // ─── Patch de relações ASN para etiquetas ARQUIVOEDI ─────────────────────
    private void PatchAsnRelations(StiReport report)
    {
        try
        {
            if (report.Dictionary.Relations.Count > 0) return;

            // Cria dicionário para lookup por name
            var sourcesByName = new Dictionary<string, StiDataSource>(StringComparer.OrdinalIgnoreCase);
            foreach (StiDataSource ds in report.Dictionary.DataSources)
                sourcesByName[ds.Name] = ds;

            foreach (var (parent, parentCol, child) in RelationDefs)
            {
                if (!sourcesByName.TryGetValue(parent, out var parentDS)) continue;
                if (!sourcesByName.TryGetValue(child,  out var childDS))  continue;

                var rel = new StiDataRelation(
                    $"rel_{parent}_{child}",
                    parentDS, childDS,
                    new[] { parentCol },
                    new[] { "relationId" });

                report.Dictionary.Relations.Add(rel);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("PatchAsnRelations: {Msg}", ex.Message);
        }
    }
}

// ─── Option helpers ───────────────────────────────────────────────────────────
public record ExportOptions(bool EmbedFonts = true);

public record JpegExportOptions(
    float Dpi      = 200f,
    float Quality  = 0.90f,
    int?  FromPage = null,
    int?  ToPage   = null);
