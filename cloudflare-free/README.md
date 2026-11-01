# Observabilidade no Workers Free

Worker nativo em TypeScript, sem Containers, Durable Objects, R2, D1 ou novas assinaturas.
Preserva `/health`, `/api/observability/dashboard`, métricas, CORS e o formato consumido pelo frontend.
O dashboard continua público, conforme o backend original. Prompts, outputs e identificadores de usuários
não são consultados nem enviados ao frontend. A chave LangSmith deve ser configurada como Secret.

## Limites desta adaptação

- Até 500 traces raiz por consulta, em vez do limite de 5.000 do backend anterior.
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


## Continuidade durante limites do LangSmith

As leituras bem-sucedidas tambem sao guardadas na Cache API do Cloudflare por ate 24 horas, sem credenciais nem identificadores de traces. Uma nova instancia pode recuperar a amostra no mesmo datacenter e recalcular o ROI sem consultar novamente o LangSmith. A data de atualizacao e o intervalo permanecem os da leitura original; dados vencidos sao sinalizados como parciais.

A Cache API pode remover entradas e nao replica dados entre datacenters. Sem uma leitura anterior disponivel, o painel ainda depende de o LangSmith aceitar a consulta. Esse mecanismo reduz interrupcoes e nao elimina os limites do provedor.


## Filtros e limites de consulta

- Hoje usa meia-noite no fuso configurado; 24h, 7d e 30d usam janelas corridas. As consultas raiz e de agentes enviam start_time e end_time explicitamente.
- A API v1 permanece em uso. O agendador reserva intervalos de 1,1 segundo para consultas de ate 7 dias e 3,5 segundos para periodos maiores, por integracao na mesma instancia. A concorrencia entre datacenters e outros clientes ainda pode gerar HTTP 429.
- Um 429 na consulta principal continua respeitando Retry-After e o cache de contingencia. Um 429 em feedback ou runs filhos preserva as metricas raiz ja obtidas e sinaliza os campos complementares como parciais.
- TRACE_RETENTION_DAYS (14 neste projeto) informa a retencao base observada no LangSmith. Consultas que incluem datas anteriores recebem aviso de historico possivelmente incompleto. A variavel nao muda a retencao nem recupera dados removidos.
- A API v2 foi avaliada, mas nao foi adotada: o contrato testado retornou apenas identificadores, insuficientes para as metricas atuais. Uma migracao requer validacao especifica de filtros, projecao de campos e paginacao.

Referencia: https://docs.langchain.com/langsmith/usage-and-billing#run-query-endpoint


A leitura raiz pagina ate 500 registros (cinco paginas), com deduplicacao e aviso quando ainda ha cursor. Datas sem sufixo de fuso retornadas pelo LangSmith sao interpretadas como UTC. Consultas de feedback sao divididas por lotes de 100 traces para evitar URLs excessivas. Custo total do LangSmith tem prioridade; na ausencia dele, observed_cost_usd dos metadados raiz e usado quando a API de IA confirmou custo para todas as chamadas do turno. Custos de traces antigos ausentes nao sao reconstruidos. A versao do cache foi atualizada para descartar amostras anteriores a esta correcao.
