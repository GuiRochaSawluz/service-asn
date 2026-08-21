namespace StimulusoftService.Models;

// ─── Request: renderiza relatório e exporta PDF ───────────────────────────────
public record RenderPdfRequest(
    /// <summary>Nome do arquivo .mrt (ex: DFeprocNFe.mrt) ou caminho relativo à pasta Templates.</summary>
    string TemplateName,
    /// <summary>Payload de dados: XML (NFe, CTe, ASN) ou JSON.</summary>
    string Data,
    /// <summary>true = pasta Etiquetas, false = pasta Relatorios (default).</summary>
    bool IsEtiqueta = false
);

// ─── Request: renderiza e exporta imagens JPEG ───────────────────────────────
public record RenderImageRequest(
    string TemplateName,
    string Data,
    bool   IsEtiqueta = false,
    float  Dpi        = 200f,
    float  Quality    = 0.90f,
    int?   FromPage   = null,
    int?   ToPage     = null,
    string Format     = "jpeg"  // "jpeg" | "png"
);

// ─── Request: renderiza e exporta HTML ───────────────────────────────────────
public record RenderHtmlRequest(
    string TemplateName,
    string Data,
    bool   IsEtiqueta = false
);

// ─── Request: conta páginas ───────────────────────────────────────────────────
public record CountPagesRequest(
    string TemplateName,
    string Data,
    bool   IsEtiqueta = false
);

// ═══════════════════════════════════════════════════════════════════════════════
//  Requests com conteúdo raw do .mrt (para templates vindos de fontes remotas)
// ═══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Renderiza PDF a partir do conteúdo bruto do .mrt (não precisa do arquivo em disco).
/// Usado pelo GateVirtual quando o template vem do SwPaaS.
/// </summary>
public record RenderPdfContentRequest(
    /// <summary>Conteúdo XML do arquivo .mrt.</summary>
    string MrtContent,
    /// <summary>Payload de dados: XML (NFe, CTe, ASN) ou JSON.</summary>
    string Data,
    /// <summary>true = aplica lógica de etiqueta ASN (relações hierárquicas).</summary>
    bool IsEtiqueta = false
);

/// <summary>
/// Renderiza imagens JPEG/PNG a partir do conteúdo bruto do .mrt.
/// </summary>
public record RenderImageContentRequest(
    string MrtContent,
    string Data,
    bool   IsEtiqueta = false,
    float  Dpi        = 150f,
    float  Quality    = 0.85f,
    int?   FromPage   = null,
    int?   ToPage     = null,
    string Format     = "jpeg"
);

/// <summary>
/// Gera pacote de preview com miniaturas de todas as páginas e página principal selecionada.
/// </summary>
public record RenderPreviewRequest(
    string TemplateName,
    string Data,
    bool   IsEtiqueta  = false,
    int    SelectedPage = 1,
    float  MainDpi     = 180f,
    float  ThumbDpi    = 55f,
    float  Quality     = 0.85f,
    string Format      = "jpeg"
);

/// <summary>
/// Versão do preview para templates recebidos por conteúdo bruto do .mrt.
/// </summary>
public record RenderPreviewContentRequest(
    string MrtContent,
    string Data,
    bool   IsEtiqueta  = false,
    int    SelectedPage = 1,
    float  MainDpi     = 180f,
    float  ThumbDpi    = 55f,
    float  Quality     = 0.85f,
    string Format      = "jpeg"
);

public record PreviewMetadataRequest(
    string TemplateName,
    string Data,
    bool   IsEtiqueta = false
);

public record PreviewMetadataContentRequest(
    string MrtContent,
    string Data,
    bool   IsEtiqueta = false
);

public record PreviewThumbnailsRequest(
    string TemplateName,
    string Data,
    bool   IsEtiqueta = false,
    float  ThumbDpi   = 55f,
    string Format     = "jpeg"
);

public record PreviewThumbnailsContentRequest(
    string MrtContent,
    string Data,
    bool   IsEtiqueta = false,
    float  ThumbDpi   = 55f,
    string Format     = "jpeg"
);

public record PreviewPageRequest(
    string TemplateName,
    string Data,
    int    Page,
    bool   IsEtiqueta = false,
    float  MainDpi    = 180f,
    string Format     = "jpeg"
);

public record PreviewPageContentRequest(
    string MrtContent,
    string Data,
    int    Page,
    bool   IsEtiqueta = false,
    float  MainDpi    = 180f,
    string Format     = "jpeg"
);

/// <summary>
/// Conta páginas a partir do conteúdo bruto do .mrt.
/// </summary>
public record CountPagesContentRequest(
    string MrtContent,
    string Data,
    bool   IsEtiqueta = false
);

// ─── Response: metadados ──────────────────────────────────────────────────────
public record CountPagesResponse(int Pages);

public record TemplateListResponse(
    IEnumerable<string> Reports,
    IEnumerable<string> Labels
);

public record ServiceInfoResponse(
    string Version,
    string TemplatesPath,
    string EtiquetasPath,
    bool   LicenseLoaded
);

public record PreviewPageItemResponse(
    int    Page,
    string Format,
    string Base64,
    int    SizeBytes,
    bool   IsSelected
);

public record MainPreviewPageResponse(
    int    Page,
    string Format,
    string Base64,
    int    SizeBytes
);

public record RenderPreviewResponse(
    int                          TotalPages,
    int                          SelectedPage,
    MainPreviewPageResponse      MainPage,
    IEnumerable<PreviewPageItemResponse> Thumbnails
);

public record PreviewMetadataResponse(int TotalPages);

public record PreviewThumbnailsResponse(
    int TotalPages,
    string Format,
    IEnumerable<PreviewPageItemResponse> Thumbnails
);

// ─── Viewer session (server-driven) ─────────────────────────────────────────
public record ViewerInitContentRequest(
    string MrtContent,
    string Data,
    bool   IsEtiqueta = false,
    float  ThumbDpi   = 55f,
    string Format     = "jpeg"
);

public record ViewerSessionInfoResponse(
    string SessionId,
    int TotalPages,
    string Format,
    float ThumbDpi,
    string PdfUrl,
    string PdfPageUrlTemplate,
    string ComponentUrl,
    string PageUrlTemplate,
    IEnumerable<PreviewPageItemResponse> Thumbnails
);
