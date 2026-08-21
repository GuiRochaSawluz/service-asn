using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.OpenApi.Models;
using StimulusoftService.Services;

var builder = WebApplication.CreateBuilder(args);

// ─── Services ────────────────────────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddMemoryCache();
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/json"]);
});

builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Stimulsoft Print Microservice",
        Version = "v1",
        Description = "Motor de geração de relatórios e etiquetas Stimulsoft (.NET) — GateVirtual"
    });
    var xmlFile = "StimulusoftService.xml";
    if (File.Exists(xmlFile))
        c.IncludeXmlComments(xmlFile);
});

// CORS — permite chamadas do frontend Next.js e do backend Python
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod());
});

// Singleton: motor Stimulsoft (licença carregada uma vez ao startup)
builder.Services.AddSingleton<StimulusoftEngine>();

// Pasta de templates MRT — configurável via appsettings
builder.Services.AddOptions<TemplatesOptions>()
    .Bind(builder.Configuration.GetSection("Templates"))
    .ValidateDataAnnotations();

var app = builder.Build();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.UseCors("AllowAll");
app.UseResponseCompression();

if (app.Environment.IsDevelopment() || true) // sempre ligado para inspeção local
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "Stimulsoft Service v1");
        c.RoutePrefix = string.Empty; // Swagger na raiz
    });
}

app.MapControllers();

app.MapGet("/health", () => Results.Json(new
{
    status = "ok",
    service = "stimulsoft-service",
    timestamp = DateTime.UtcNow,
}));

// ─── Inicializa licença Stimulsoft ────────────────────────────────────────────
var engine = app.Services.GetRequiredService<StimulusoftEngine>();
engine.Initialize();

Console.WriteLine("═══════════════════════════════════════════════════════");
Console.WriteLine("  Stimulsoft Print Microservice — GateVirtual");
Console.WriteLine($"  Porta: {builder.Configuration["Urls"] ?? "http://localhost:5055"}");
Console.WriteLine($"  Templates: {engine.TemplatesPath}");
Console.WriteLine("  Swagger UI disponível em: http://localhost:5055");
Console.WriteLine("═══════════════════════════════════════════════════════");

app.Run();
