using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.Security.Cryptography;
using System.Text;
using StimulusoftService.Models;
using StimulusoftService.Services;

namespace StimulusoftService.Controllers;

/// <summary>
/// Endpoints de geração e exportação de relatórios/etiquetas via Stimulsoft.
/// </summary>
[ApiController]
[Route("api/print")]
[Produces("application/json")]
public class PrintController(StimulusoftEngine engine, ILogger<PrintController> logger, IMemoryCache cache) : ControllerBase
{
    private static readonly TimeSpan PreviewCacheTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan ViewerSessionTtl = TimeSpan.FromMinutes(20);

    private sealed record ViewerSessionState(
        string SessionId,
        string Fingerprint,
        string MrtContent,
        string Data,
        bool IsEtiqueta,
        string Format,
        float ThumbDpi,
        int TotalPages,
        IReadOnlyList<PreviewPageItemResponse> Thumbnails,
        string PdfUrl,
        string PdfPageUrlTemplate,
        string ComponentUrl,
        string PageUrlTemplate
    );

    // ─── GET /api/print/info ──────────────────────────────────────────────────
    /// <summary>Retorna informações do serviço e status da licença.</summary>
    [HttpGet("info")]
    [ProducesResponseType<ServiceInfoResponse>(200)]
    public IActionResult GetInfo()
    {
        return Ok(new ServiceInfoResponse(
            Version: "1.0.0",
            TemplatesPath: engine.TemplatesPath,
            EtiquetasPath: engine.EtiquetasPath,
            LicenseLoaded: true
        ));
    }

    // ─── GET /api/print/templates ─────────────────────────────────────────────
    /// <summary>Lista todos os templates .mrt disponíveis (relatórios e etiquetas).</summary>
    [HttpGet("templates")]
    [ProducesResponseType<TemplateListResponse>(200)]
    public IActionResult ListTemplates()
    {
        return Ok(new TemplateListResponse(
            Reports: engine.ListReportTemplates(),
            Labels:  engine.ListLabelTemplates()
        ));
    }

    // ─── GET /api/print/templates/{filename} ──────────────────────────────────
    /// <summary>Baixa o arquivo .mrt bruto pelo nome.</summary>
    [HttpGet("templates/{filename}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public IActionResult GetTemplate(string filename, [FromQuery] bool isEtiqueta = false)
    {
        try
        {
            var path = engine.ResolveMrtPath(filename, isEtiqueta);
            return PhysicalFile(path, "application/octet-stream", filename);
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
    }

    // ─── POST /api/print/pdf ─────────────────────────────────────────────────
    /// <summary>
    /// Renderiza um relatório por nome de arquivo em disco e retorna o PDF binário.
    /// Corpo: { templateName, data, isEtiqueta }
    /// </summary>
    [HttpPost("pdf")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderPdf([FromBody] RenderPdfRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var mrtPath    = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            var pdfBytes   = engine.ExportToPdf(mrtContent, req.Data, new ExportOptions());
            var safeName   = Path.GetFileNameWithoutExtension(req.TemplateName);
            return File(pdfBytes, "application/pdf", $"{safeName}.pdf");
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar PDF: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/pdf-content ─────────────────────────────────────────
    /// <summary>
    /// Renderiza PDF a partir do conteúdo bruto do .mrt (sem necessidade de arquivo em disco).
    /// Usado pelo GateVirtual quando o template vem do SwPaaS (remoto).
    /// Corpo: { mrtContent, data, isEtiqueta }
    /// </summary>
    [HttpPost("pdf-content")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]

    public IActionResult RenderPdfContent([FromBody] RenderPdfContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var pdfBytes = engine.ExportToPdf(req.MrtContent, req.Data, new ExportOptions());
            return File(pdfBytes, "application/pdf", "relatorio.pdf");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar PDF (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/images ───────────────────────────────────────────────
    /// <summary>
    /// Renderiza e retorna imagens (JPEG ou PNG) de cada página como Base64 JSON.
    /// Corpo: { templateName, data, isEtiqueta, dpi, quality, fromPage, toPage, format }
    /// </summary>
    [HttpPost("images")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderImages([FromBody] RenderImageRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var mrtPath    = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            var opts       = new JpegExportOptions(req.Dpi, req.Quality, req.FromPage, req.ToPage);
            bool isPng     = req.Format.Equals("png", StringComparison.OrdinalIgnoreCase);
            var pages      = engine.ExportToImages(mrtContent, req.Data, opts, isPng);
            var result     = pages.Select((b, i) => new
            {
                page      = (req.FromPage ?? 1) + i,
                format    = req.Format.ToLowerInvariant(),
                base64    = Convert.ToBase64String(b),
                sizeBytes = b.Length,
            });
            return Ok(new { pages = result, total = pages.Count });
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar imagens: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/images-content ──────────────────────────────────────
    /// <summary>
    /// Renderiza imagens JPEG/PNG a partir do conteúdo bruto do .mrt.
    /// Usado pelo GateVirtual para gerar thumbnails sem arquivo em disco.
    /// Corpo: { mrtContent, data, isEtiqueta, dpi, quality, fromPage, toPage, format }
    /// </summary>
    [HttpPost("images-content")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderImagesContent([FromBody] RenderImageContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var opts   = new JpegExportOptions(req.Dpi, req.Quality, req.FromPage, req.ToPage);
            bool isPng = req.Format.Equals("png", StringComparison.OrdinalIgnoreCase);
            var pages  = engine.ExportToImages(req.MrtContent, req.Data, opts, isPng);
            var result = pages.Select((b, i) => new
            {
                page      = (req.FromPage ?? 1) + i,
                format    = req.Format.ToLowerInvariant(),
                base64    = Convert.ToBase64String(b),
                sizeBytes = b.Length,
            });
            return Ok(new { pages = result, total = pages.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar imagens (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview ─────────────────────────────────────────────
    /// <summary>
    /// Retorna pacote de preview para navegação: miniaturas de todas as páginas + página principal selecionada.
    /// Corpo: { templateName, data, isEtiqueta, selectedPage, mainDpi, thumbDpi, format }
    /// </summary>
    [HttpPost("preview")]
    [ProducesResponseType<RenderPreviewResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderPreview([FromBody] RenderPreviewRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var mrtPath = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            bool isPng = req.Format.Equals("png", StringComparison.OrdinalIgnoreCase);
            var preview = engine.ExportPreview(
                mrtContent,
                req.Data,
                new PreviewExportOptions(req.SelectedPage, req.MainDpi, req.ThumbDpi, req.Quality),
                isPng);

            return Ok(ToPreviewResponse(preview, req.Format));
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar preview: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-content ─────────────────────────────────────
    /// <summary>
    /// Retorna pacote de preview a partir de conteúdo raw do .mrt.
    /// Corpo: { mrtContent, data, isEtiqueta, selectedPage, mainDpi, thumbDpi, format }
    /// </summary>
    [HttpPost("preview-content")]
    [ProducesResponseType<RenderPreviewResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderPreviewContent([FromBody] RenderPreviewContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            bool isPng = req.Format.Equals("png", StringComparison.OrdinalIgnoreCase);
            var preview = engine.ExportPreview(
                req.MrtContent,
                req.Data,
                new PreviewExportOptions(req.SelectedPage, req.MainDpi, req.ThumbDpi, req.Quality),
                isPng);

            return Ok(ToPreviewResponse(preview, req.Format));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar preview (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-metadata ───────────────────────────────────
    /// <summary>
    /// Retorna apenas metadados de preview (total de páginas), para inicialização rápida do viewer.
    /// </summary>
    [HttpPost("preview-metadata")]
    [ProducesResponseType<PreviewMetadataResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult PreviewMetadata([FromBody] PreviewMetadataRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var mrtPath = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            int pages = engine.CountPages(mrtContent, req.Data);
            return Ok(new PreviewMetadataResponse(pages));
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao obter preview metadata: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-metadata-content ───────────────────────────
    [HttpPost("preview-metadata-content")]
    [ProducesResponseType<PreviewMetadataResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult PreviewMetadataContent([FromBody] PreviewMetadataContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            int pages = engine.CountPages(req.MrtContent, req.Data);
            return Ok(new PreviewMetadataResponse(pages));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao obter preview metadata (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-thumbnails ─────────────────────────────────
    [HttpPost("preview-thumbnails")]
    [ProducesResponseType<PreviewThumbnailsResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult PreviewThumbnails([FromBody] PreviewThumbnailsRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var mrtPath = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            return Ok(BuildThumbnailsResponse(mrtContent, req.Data, req.ThumbDpi, req.Format));
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar preview thumbnails: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-thumbnails-content ─────────────────────────
    [HttpPost("preview-thumbnails-content")]
    [ProducesResponseType<PreviewThumbnailsResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult PreviewThumbnailsContent([FromBody] PreviewThumbnailsContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            return Ok(BuildThumbnailsResponse(req.MrtContent, req.Data, req.ThumbDpi, req.Format));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar preview thumbnails (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-page ───────────────────────────────────────
    /// <summary>
    /// Retorna somente a página selecionada como imagem binária (sem Base64).
    /// </summary>
    [HttpPost("preview-page")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult PreviewPage([FromBody] PreviewPageRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });
        if (req.Page < 1)
            return BadRequest(new { error = "page deve ser >= 1." });

        try
        {
            var mrtPath = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            return RenderMainPageFile(mrtContent, req.Data, req.Page, req.MainDpi, req.Format, req.TemplateName);
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar preview page: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/preview-page-content ───────────────────────────────
    [HttpPost("preview-page-content")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult PreviewPageContent([FromBody] PreviewPageContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });
        if (req.Page < 1)
            return BadRequest(new { error = "page deve ser >= 1." });

        try
        {
            return RenderMainPageFile(req.MrtContent, req.Data, req.Page, req.MainDpi, req.Format, "relatorio");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar preview page (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/image/single ────────────────────────────────────────
    /// <summary>
    /// Retorna a imagem de UMA página específica diretamente como Content-Type image/jpeg.
    /// Útil para preview rápido sem JSON overhead.
    /// </summary>
    [HttpPost("image/single")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderSingleImage([FromBody] RenderImageRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });

        try
        {
            var mrtPath    = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            int page       = req.FromPage ?? 1;
            var opts       = new JpegExportOptions(req.Dpi, req.Quality, page, page);
            bool isPng     = req.Format.Equals("png", StringComparison.OrdinalIgnoreCase);
            var pages      = engine.ExportToImages(mrtContent, req.Data ?? "<DATASET/>", opts, isPng);

            if (pages.Count == 0)
                return NotFound(new { error = $"Página {page} não encontrada." });

            var mime = isPng ? "image/png" : "image/jpeg";
            var ext  = isPng ? "png" : "jpg";
            var name = $"{Path.GetFileNameWithoutExtension(req.TemplateName)}_p{page}.{ext}";
            return File(pages[0], mime, name);
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar imagem única: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/html ─────────────────────────────────────────────────
    /// <summary>Exporta o relatório como HTML5 embutido.</summary>
    [HttpPost("html")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult RenderHtml([FromBody] RenderHtmlRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });

        try
        {
            var mrtPath    = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            var htmlBytes  = engine.ExportToHtml(mrtContent, req.Data ?? "<DATASET/>");
            return File(htmlBytes, "text/html; charset=utf-8");
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao renderizar HTML: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/pages ────────────────────────────────────────────────
    /// <summary>Conta quantas páginas o relatório gerado possui (por nome de arquivo).</summary>
    [HttpPost("pages")]
    [ProducesResponseType<CountPagesResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult CountPages([FromBody] CountPagesRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.TemplateName))
            return BadRequest(new { error = "templateName é obrigatório." });

        try
        {
            var mrtPath    = engine.ResolveMrtPath(req.TemplateName, req.IsEtiqueta);
            var mrtContent = System.IO.File.ReadAllText(mrtPath);
            int pages      = engine.CountPages(mrtContent, req.Data ?? "<DATASET/>");
            return Ok(new CountPagesResponse(pages));
        }
        catch (FileNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao contar páginas: {Template}", req.TemplateName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/pages-content ───────────────────────────────────────
    /// <summary>
    /// Conta quantas páginas o relatório possui a partir do conteúdo bruto do .mrt.
    /// </summary>
    [HttpPost("pages-content")]
    [ProducesResponseType<CountPagesResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult CountPagesContent([FromBody] CountPagesContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });

        try
        {
            int pages = engine.CountPages(req.MrtContent, req.Data ?? "<DATASET/>");
            return Ok(new CountPagesResponse(pages));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao contar páginas (content)");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── POST /api/print/viewer-content/init ───────────────────────────────
    /// <summary>
    /// Inicializa sessão de viewer server-driven para PDF nativo + thumbnails.
    /// Retorna URLs de navegação para o frontend ficar quase só na camada de interface.
    /// </summary>
    [HttpPost("viewer-content/init")]
    [ProducesResponseType<ViewerSessionInfoResponse>(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(500)]
    public IActionResult InitViewerContent([FromBody] ViewerInitContentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MrtContent))
            return BadRequest(new { error = "mrtContent é obrigatório." });
        if (string.IsNullOrWhiteSpace(req.Data))
            return BadRequest(new { error = "data é obrigatório." });

        try
        {
            var normalizedFormat = req.Format.Equals("png", StringComparison.OrdinalIgnoreCase) ? "png" : "jpeg";
            var fingerprint = BuildViewerFingerprint(req.MrtContent, req.Data, req.IsEtiqueta, normalizedFormat, req.ThumbDpi);
            var fingerprintKey = ViewerFingerprintKey(fingerprint);

            if (cache.TryGetValue<string>(fingerprintKey, out var existingSessionId) &&
                !string.IsNullOrWhiteSpace(existingSessionId) &&
                TryGetViewerSession(existingSessionId, out var existingSession))
            {
                return Ok(ToViewerSessionInfo(existingSession));
            }

            var thumbsResponse = BuildThumbnailsResponse(req.MrtContent, req.Data, req.ThumbDpi, normalizedFormat);
            var thumbs = thumbsResponse.Thumbnails.ToList();
            var sessionId = Guid.NewGuid().ToString("N");

            var state = new ViewerSessionState(
                SessionId: sessionId,
                Fingerprint: fingerprint,
                MrtContent: req.MrtContent,
                Data: req.Data,
                IsEtiqueta: req.IsEtiqueta,
                Format: normalizedFormat,
                ThumbDpi: req.ThumbDpi,
                TotalPages: thumbsResponse.TotalPages,
                Thumbnails: thumbs,
                PdfUrl: $"/api/print/viewer-content/{sessionId}/pdf",
                PdfPageUrlTemplate: $"/api/print/viewer-content/{sessionId}/pdf#page={{page}}",
                ComponentUrl: $"/api/print/viewer-content/{sessionId}/component",
                PageUrlTemplate: $"/api/print/viewer-content/{sessionId}/page/{{page}}"
            );

            cache.Set(ViewerSessionKey(sessionId), state, new MemoryCacheEntryOptions
            {
                SlidingExpiration = ViewerSessionTtl,
                AbsoluteExpirationRelativeToNow = ViewerSessionTtl
            });

            cache.Set(fingerprintKey, sessionId, new MemoryCacheEntryOptions
            {
                SlidingExpiration = ViewerSessionTtl,
                AbsoluteExpirationRelativeToNow = ViewerSessionTtl
            });

            return Ok(ToViewerSessionInfo(state));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao inicializar viewer-content");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── GET /api/print/viewer-content/{sessionId}/metadata ────────────────
    [HttpGet("viewer-content/{sessionId}/metadata")]
    [ProducesResponseType<PreviewMetadataResponse>(200)]
    [ProducesResponseType(404)]
    public IActionResult ViewerMetadata(string sessionId)
    {
        if (!TryGetViewerSession(sessionId, out var session))
            return NotFound(new { error = "Sessão de viewer não encontrada ou expirada." });

        return Ok(new PreviewMetadataResponse(session.TotalPages));
    }

    // ─── GET /api/print/viewer-content/{sessionId}/thumbnails ──────────────
    [HttpGet("viewer-content/{sessionId}/thumbnails")]
    [ProducesResponseType<PreviewThumbnailsResponse>(200)]
    [ProducesResponseType(404)]
    public IActionResult ViewerThumbnails(string sessionId)
    {
        if (!TryGetViewerSession(sessionId, out var session))
            return NotFound(new { error = "Sessão de viewer não encontrada ou expirada." });

        return Ok(new PreviewThumbnailsResponse(
            TotalPages: session.TotalPages,
            Format: session.Format,
            Thumbnails: session.Thumbnails
        ));
    }

    // ─── GET /api/print/viewer-content/{sessionId}/pdf ─────────────────────
    [HttpGet("viewer-content/{sessionId}/pdf")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(404)]
    [ProducesResponseType(500)]
    public IActionResult ViewerPdf(string sessionId)
    {
        if (!TryGetViewerSession(sessionId, out var session))
            return NotFound(new { error = "Sessão de viewer não encontrada ou expirada." });

        try
        {
            var bytes = cache.GetOrCreate(ViewerPdfKey(sessionId), entry =>
            {
                entry.SlidingExpiration = ViewerSessionTtl;
                entry.AbsoluteExpirationRelativeToNow = ViewerSessionTtl;
                return engine.ExportToPdf(session.MrtContent, session.Data, new ExportOptions());
            }) ?? Array.Empty<byte>();

            if (bytes.Length == 0)
                return NotFound(new { error = "PDF não disponível para a sessão informada." });

            return File(bytes, "application/pdf");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao obter PDF da sessão {SessionId}", sessionId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

        // ─── GET /api/print/viewer-content/{sessionId}/component ───────────────
        /// <summary>
        /// Componente HTML server-driven para visualizacao de PDF com thumbnails.
        /// Navegacao por thumbnail altera apenas o fragmento #page no iframe do PDF.
        /// </summary>
        [HttpGet("viewer-content/{sessionId}/component")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult ViewerComponent(
                string sessionId,
                [FromQuery] int page = 1,
                [FromQuery] string zoom = "page-fit")
        {
                if (!TryGetViewerSession(sessionId, out var session))
                        return NotFound(new { error = "Sessão de viewer não encontrada ou expirada." });

                var selectedPage = Math.Clamp(page, 1, Math.Max(1, session.TotalPages));
                var safeZoom = string.IsNullOrWhiteSpace(zoom) ? "page-fit" : zoom;
                var basePath = $"/api/print/viewer-content/{sessionId}";
                var html = $$"""
<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Viewer PDF</title>
    <style>
        :root {
            --bg: #f3f5f8;
            --panel: #ffffff;
            --line: #d7dde7;
            --text: #1f2937;
            --muted: #64748b;
            --brand: #0f766e;
        }
        * { box-sizing: border-box; }
        html, body { height: 100%; margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: var(--bg); color: var(--text); }
        .shell { height: 100%; display: grid; grid-template-columns: 220px 1fr; gap: 12px; padding: 12px; }
        .thumbs { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: auto; padding: 8px; }
        .thumb-btn {
            width: 100%; border: 1px solid transparent; background: #fff; border-radius: 8px;
            margin-bottom: 8px; padding: 6px; cursor: pointer; text-align: left;
            transition: border-color .14s ease, transform .14s ease;
        }
        .thumb-btn:hover { border-color: #bfd6d3; transform: translateY(-1px); }
        .thumb-btn.active { border-color: var(--brand); box-shadow: 0 0 0 1px rgba(15, 118, 110, .1); }
        .thumb-btn img { width: 100%; display: block; border-radius: 4px; }
        .thumb-label { margin-top: 5px; color: var(--muted); font-size: 12px; }
        .main { min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
        .toolbar {
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid var(--line); padding: 8px 10px; background: #fafbfd;
            font-size: 13px;
        }
        .toolbar strong { color: var(--brand); }
        iframe { width: 100%; height: calc(100% - 40px); border: 0; background: #fff; }
        @media (max-width: 900px) {
            .shell { grid-template-columns: 1fr; grid-template-rows: 180px 1fr; }
            .thumbs { display: flex; gap: 8px; overflow: auto; }
            .thumb-btn { min-width: 118px; margin-bottom: 0; }
        }
    </style>
</head>
<body>
    <div class="shell">
        <aside class="thumbs" id="thumbs" aria-label="Miniaturas"></aside>
        <section class="main">
            <div class="toolbar">
                <div>Página atual: <strong id="currentPage">{{selectedPage}}</strong> / <span id="totalPages">{{session.TotalPages}}</span></div>
                <div id="status">PDF carregado uma única vez</div>
            </div>
            <iframe id="pdfFrame" title="Visualizador PDF" src="{{basePath}}/pdf#page={{selectedPage}}&zoom={{Uri.EscapeDataString(safeZoom)}}"></iframe>
        </section>
    </div>

    <script>
        const sessionBase = {{System.Text.Json.JsonSerializer.Serialize(basePath)}};
        const selectedInit = {{selectedPage}};
        const thumbsEl = document.getElementById('thumbs');
        const frame = document.getElementById('pdfFrame');
        const currentPageEl = document.getElementById('currentPage');
        const totalPagesEl = document.getElementById('totalPages');

        let currentPage = selectedInit;

        function applyPage(page) {
            currentPage = page;
            currentPageEl.textContent = String(page);
            frame.src = `${sessionBase}/pdf#page=${page}&zoom=${encodeURIComponent({{System.Text.Json.JsonSerializer.Serialize(safeZoom)}})}`;

            const buttons = thumbsEl.querySelectorAll('.thumb-btn');
            buttons.forEach((btn) => {
                if (Number(btn.dataset.page) === page) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        }

        async function init() {
            const res = await fetch(`${sessionBase}/thumbnails`, { credentials: 'same-origin' });
            if (!res.ok) {
                document.getElementById('status').textContent = 'Falha ao carregar miniaturas';
                return;
            }
            const data = await res.json();
            totalPagesEl.textContent = String(data.totalPages || 0);

            data.thumbnails.forEach((thumb) => {
                const btn = document.createElement('button');
                btn.className = 'thumb-btn';
                btn.dataset.page = String(thumb.page);
                btn.type = 'button';
                btn.innerHTML = `
                    <img alt="Página ${thumb.page}" src="data:image/${thumb.format};base64,${thumb.base64}" loading="lazy" />
                    <div class="thumb-label">Página ${thumb.page}</div>
                `;
                btn.addEventListener('click', () => applyPage(thumb.page));
                thumbsEl.appendChild(btn);
            });

            applyPage(selectedInit);
        }

        init();
    </script>
</body>
</html>
""";

                return Content(html, "text/html; charset=utf-8");
        }

    // ─── GET /api/print/viewer-content/{sessionId}/page/{page} ─────────────
    [HttpGet("viewer-content/{sessionId}/page/{page:int}")]
    [ProducesResponseType(200, Type = typeof(FileContentResult))]
    [ProducesResponseType(404)]
    [ProducesResponseType(500)]
    public IActionResult ViewerPage(
        string sessionId,
        int page,
        [FromQuery] float dpi = 96f,
        [FromQuery] string format = "jpeg")
    {
        if (page < 1)
            return BadRequest(new { error = "page deve ser >= 1." });

        if (!TryGetViewerSession(sessionId, out var session))
            return NotFound(new { error = "Sessão de viewer não encontrada ou expirada." });

        try
        {
            var normalizedFormat = format.Equals("png", StringComparison.OrdinalIgnoreCase) ? "png" : "jpeg";
            bool isPng = normalizedFormat == "png";

            var bytes = cache.GetOrCreate(ViewerPageKey(sessionId, page, normalizedFormat, dpi), entry =>
            {
                entry.SlidingExpiration = ViewerSessionTtl;
                entry.AbsoluteExpirationRelativeToNow = ViewerSessionTtl;
                return engine.ExportMainPage(session.MrtContent, session.Data, page, dpi, isPng);
            }) ?? Array.Empty<byte>();

            if (bytes.Length == 0)
                return NotFound(new { error = "Página não disponível para a sessão informada." });

            var mime = isPng ? "image/png" : "image/jpeg";
            var ext = isPng ? "png" : "jpg";
            return File(bytes, mime, $"viewer_p{page}.{ext}");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erro ao obter página {Page} da sessão {SessionId}", page, sessionId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─── DELETE /api/print/viewer-content/{sessionId} ───────────────────────
    [HttpDelete("viewer-content/{sessionId}")]
    [ProducesResponseType(204)]
    [ProducesResponseType(404)]
    public IActionResult DeleteViewerSession(string sessionId)
    {
        if (!TryGetViewerSession(sessionId, out var session))
            return NotFound(new { error = "Sessão de viewer não encontrada ou expirada." });

        cache.Remove(ViewerSessionKey(sessionId));
        cache.Remove(ViewerFingerprintKey(session.Fingerprint));
        return NoContent();
    }

    private static RenderPreviewResponse ToPreviewResponse(PreviewExportResult preview, string format)
    {
        var normalizedFormat = format.ToLowerInvariant();
        var main = new MainPreviewPageResponse(
            preview.MainPage.Page,
            normalizedFormat,
            Convert.ToBase64String(preview.MainPage.Bytes),
            preview.MainPage.Bytes.Length);

        var thumbs = preview.Thumbnails.Select(p => new PreviewPageItemResponse(
            p.Page,
            normalizedFormat,
            Convert.ToBase64String(p.Bytes),
            p.Bytes.Length,
            p.IsSelected));

        return new RenderPreviewResponse(preview.TotalPages, preview.SelectedPage, main, thumbs);
    }

    private static ViewerSessionInfoResponse ToViewerSessionInfo(ViewerSessionState session)
    {
        return new ViewerSessionInfoResponse(
            SessionId: session.SessionId,
            TotalPages: session.TotalPages,
            Format: session.Format,
            ThumbDpi: session.ThumbDpi,
            PdfUrl: session.PdfUrl,
            PdfPageUrlTemplate: session.PdfPageUrlTemplate,
            ComponentUrl: session.ComponentUrl,
            PageUrlTemplate: session.PageUrlTemplate,
            Thumbnails: session.Thumbnails
        );
    }

    private PreviewThumbnailsResponse BuildThumbnailsResponse(string mrtContent, string data, float thumbDpi, string format)
    {
        bool isPng = format.Equals("png", StringComparison.OrdinalIgnoreCase);
        var normalizedFormat = isPng ? "png" : "jpeg";

        var cacheKey = BuildCacheKey("preview-thumb", mrtContent, data, normalizedFormat, thumbDpi, null);
        var pages = cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = PreviewCacheTtl;
            return engine.ExportThumbnails(mrtContent, data, thumbDpi, isPng);
        }) ?? [];

        var thumbs = pages.Select(p => new PreviewPageItemResponse(
            p.Page,
            normalizedFormat,
            Convert.ToBase64String(p.Bytes),
            p.Bytes.Length,
            false));

        return new PreviewThumbnailsResponse(pages.Count, normalizedFormat, thumbs);
    }

    private IActionResult RenderMainPageFile(string mrtContent, string data, int page, float mainDpi, string format, string sourceName)
    {
        bool isPng = format.Equals("png", StringComparison.OrdinalIgnoreCase);
        var normalizedFormat = isPng ? "png" : "jpeg";

        var cacheKey = BuildCacheKey("preview-main", mrtContent, data, normalizedFormat, mainDpi, page);
        var bytes = cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = PreviewCacheTtl;
            return engine.ExportMainPage(mrtContent, data, page, mainDpi, isPng);
        }) ?? Array.Empty<byte>();

        if (bytes.Length == 0)
            return NotFound(new { error = "Nenhuma página disponível para preview." });

        var mime = isPng ? "image/png" : "image/jpeg";
        var ext = isPng ? "png" : "jpg";
        var safe = Path.GetFileNameWithoutExtension(sourceName);
        return File(bytes, mime, $"{safe}_p{page}.{ext}");
    }

    private static string BuildCacheKey(string prefix, string mrtContent, string data, string format, float dpi, int? page)
    {
        var raw = $"{prefix}|{format}|{dpi}|{page}|{mrtContent}|{data}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return $"{prefix}:{Convert.ToHexString(hash)}";
    }

    private static string BuildViewerFingerprint(string mrtContent, string data, bool isEtiqueta, string format, float thumbDpi)
    {
        var raw = $"viewer|{isEtiqueta}|{format}|{thumbDpi}|{mrtContent}|{data}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(hash);
    }

    private static string ViewerSessionKey(string sessionId) => $"viewer:session:{sessionId}";
    private static string ViewerFingerprintKey(string fingerprint) => $"viewer:fp:{fingerprint}";
    private static string ViewerPdfKey(string sessionId) => $"viewer:pdf:{sessionId}";
    private static string ViewerPageKey(string sessionId, int page, string format, float dpi)
        => $"viewer:page:{sessionId}:{page}:{format}:{dpi}";

    private bool TryGetViewerSession(string sessionId, out ViewerSessionState session)
    {
        var cached = cache.Get<ViewerSessionState>(ViewerSessionKey(sessionId));
        if (cached is null)
        {
            session = default!;
            return false;
        }

        session = cached;
        return true;
    }
}
