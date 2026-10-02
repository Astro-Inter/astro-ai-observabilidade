# Observabilidade no Workers Free

Worker nativo em TypeScript, sem Containers, Durable Objects, R2, D1 ou novas assinaturas.
Preserva `/health`, `/api/observability/dashboard`, métricas, CORS e o formato consumido pelo frontend.
O dashboard continua público, conforme o backend original. Prompts, outputs e identificadores de usuários
não são consultados nem enviados ao frontend. A chave LangSmith deve ser configurada como Secret.

## Limites desta adaptação

- Até 100 traces raiz por consulta, em vez do limite de 5.000 do backend anterior.
- Até 500 runs filhos e 500 feedbacks por consulta. Resultados incompletos têm aviso explícito.
- Até 20 subrequests; timeout de 60 segundos por requisição ao LangSmith, sem retries automáticos.
- Cache por isolate, por até 300 segundos por padrão, máximo 100 respostas e 16 amostras sanitizadas.
  Consultas simultâneas do mesmo período compartilham a leitura. Alterar parâmetros de ROI não
  repete as consultas ao LangSmith. A API respeita HTTP 429, sem retries automáticos.
- Workers Free: 100.000 chamadas/dia e 10 ms de CPU por invocação. Ultrapassar os limites pode
  interromper chamadas. Não há upgrade automático configurado por esta migração.
- A publicação de 01/10/2026 passou em 14 testes, checagem TypeScript, comparação com o Python
  em três amostras e comparação real de 14 traces. Hoje, 24h, 7d e 30d responderam no Worker.
  O frontend GitHub Pages foi publicado apontando para este backend. O backend Render foi preservado.
- O LangSmith pode limitar consultas com HTTP 429. O Worker mantém o erro temporário e Retry-After,
  compartilha consultas simultâneas e aguarda o intervalo indicado antes de consultar novamente.

## Configuração

Secrets: `LANGSMITH_API_KEY`; opcionalmente `LANGSMITH_WORKSPACE_ID`.
Vars: `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, `CORS_ALLOWED_ORIGINS`,
`ANALYSIS_TIMEZONE`, `CACHE_TTL_SECONDS`. Aceita os endpoints oficiais LangSmith EUA/UE/AWS.

As versões antigas da pasta `cloudflare/` com Containers são rascunhos de uma solução paga
e não devem ser publicadas. Esta pasta contém a alternativa gratuita.

Referências: https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/containers/platform/pricing/

## Grafana

O Worker envia resumos sanitizados das requisições por OTLP/HTTP. GRAFANA_OTLP_ENDPOINT é uma variável e GRAFANA_OTLP_HEADERS fica como Secret. Parâmetros de consulta, dados do LangSmith e credenciais não entram na telemetria; falhas do Grafana não afetam as respostas da API.
