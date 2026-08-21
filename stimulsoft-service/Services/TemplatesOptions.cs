using System.ComponentModel.DataAnnotations;

namespace StimulusoftService.Services;

/// <summary>
/// Opções de configuração lidas de appsettings.json → seção "Templates".
/// </summary>
public class TemplatesOptions
{
    /// <summary>Caminho raiz onde estão os arquivos .mrt</summary>
    [Required]
    public string MrtRootPath { get; set; } = string.Empty;

    /// <summary>Caminho do arquivo license.key do Stimulsoft</summary>
    public string? LicenseKeyPath { get; set; }
}
