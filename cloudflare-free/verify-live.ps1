$ErrorActionPreference = 'Stop'
$periodEnd = [DateTime]::UtcNow
$queryStart = [Uri]::EscapeDataString($periodEnd.AddDays(-7).ToString('yyyy-MM-ddTHH:mm:ssZ'))
$queryEnd = [Uri]::EscapeDataString($periodEnd.ToString('yyyy-MM-ddTHH:mm:ssZ'))
$periodQuery = "period=custom&start=$queryStart&end=$queryEnd"
$comparisonEndpoints = @{
    'live-new.json' = 'https://astro-ai-observabilidade.app-4str0.workers.dev'
    'live-old.json' = 'https://astro-ai-observabilidade.onrender.com'
}
foreach ($comparisonFile in $comparisonEndpoints.Keys) {
    $comparisonResponse = Invoke-WebRequest -Uri "$($comparisonEndpoints[$comparisonFile])/api/observability/dashboard?$periodQuery" -TimeoutSec 60
    $comparisonResponse.Content | Set-Content -LiteralPath (Join-Path $PSScriptRoot $comparisonFile) -Encoding utf8
}
python (Join-Path $PSScriptRoot 'verify-live.py') --files
if ($LASTEXITCODE -ne 0) { throw 'Aggregate comparison failed; keep the frontend on the original backend.' }
