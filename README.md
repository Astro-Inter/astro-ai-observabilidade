# Astro Observabilidade

Projeto **independente** da API de IA do Astro. O mesmo repositório contém o backend FastAPI e o dashboard React/TypeScript. A interface consulta **somente** o backend; a chave do LangSmith fica exclusivamente no servidor.

## O que esta V1 mede

- Traces raiz `astro_chat` do projeto LangSmith já utilizado pelo Astro.
- Tempo total: metadado `total_response_ms`, com fallback para início/fim do run.
- Tempo por agente e entre agentes: JSON dos metadados `agent_latencies_ms` e `agent_transitions_ms`.
- Resolução: feedback existente `resolved` por run; não existe uma nova classificação neste projeto.
- Erro: erro do run ou `error_type` nos metadados.
- Custo: `total_cost` do trace raiz em USD; a atribuição por agente usa o custo observado no run filho externo de cada agente.
- Projeções: custo médio observado × interações por usuário × 100 ou 1.000 usuários semanais.
- ROI: **estimativa operacional**, não receita comprovada. As premissas podem ser alteradas no painel.

Quando parte dos traces não tiver custo, o painel soma os valores disponíveis, mostra a cobertura e identifica o resultado como parcial. Se nenhum trace tiver custo, os indicadores dependentes ficam indisponíveis (`—`). Feedback ausente também deixa seus indicadores dependentes indisponíveis. O Astro não registra UID nos traces por privacidade, portanto não há contagem de usuários únicos. Custos e erros por agente vêm dos runs filhos externos, evitando duplicar os runs internos do modelo.

## Rodar localmente

Requer Python 3.11+ e Node 22+.

1. Em `backend`, copie `.env.example` para `.env` e configure `LANGSMITH_API_KEY` e `LANGSMITH_PROJECT`. `LANGSMITH_WORKSPACE_ID` é opcional conforme sua conta.
2. Instale as dependências e rode a API:

   ```sh
   cd backend
   python -m venv .venv
   # Ative o ambiente virtual conforme o seu sistema.
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

3. Em `frontend`, copie `.env.example` para `.env` e rode:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   Se o servidor de desenvolvimento falhar ao resolver dependências no caminho do OneDrive, teste a versão compilada com `npm run build` e `npm run preview`. A prévia abre em `http://localhost:4173` ou na próxima porta livre. A API aceita qualquer porta local usada pelo Vite.

4. Abra `http://localhost:5173`. O painel carrega sem chave de acesso.

Para testar: `cd backend && python -m pytest -q` e `cd frontend && npm run build`.

## Publicar: GitHub Pages + Render

O GitHub Pages **não executa Python**. O projeto está pronto para publicar a interface no Pages e a API no Render, ainda dentro de um único repositório.

1. Crie um repositório GitHub **separado do astro-ai-api** com o conteúdo deste ZIP e envie à branch `main`.
2. No Render, crie um **Blueprint** apontando para esse repositório. O arquivo `render.yaml` cria o serviço `astro-observabilidade-api` usando `backend` como diretório raiz.
3. Configure no Render:
   - `LANGSMITH_API_KEY`: chave de leitura do workspace/projeto LangSmith.
   - `LANGSMITH_PROJECT`: nome exato do projeto usado pelo Astro, padrão `astro-ai-api`.
   - `LANGSMITH_WORKSPACE_ID`: preencha somente se sua chave precisar dele.
   - `CORS_ALLOWED_ORIGINS`: origem do GitHub Pages, por exemplo `https://SEU_USUARIO.github.io` (sem caminho nem barra final). Separe múltiplas origens por vírgula.
4. Confirme que `https://SEU_SERVICO.onrender.com/health` responde `{"status":"ok"}`.
5. No GitHub, abra **Settings → Secrets and variables → Actions → Variables** e crie `OBSERVABILITY_API_URL` com a URL HTTPS do Render, sem `/` final. Essa URL é pública; **não** coloque a chave do LangSmith nas variáveis do GitHub Actions.
6. Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions**. O workflow `.github/workflows/pages.yml` instala, compila e publica `frontend/dist` a cada push em `main`.
7. Abra a URL do Pages. O painel ficará acessível sem senha para quem tiver o endereço.

O workflow usa automaticamente `/<nome-do-repositório>/` como caminho base. Se o repositório for especial do tipo `usuario.github.io`, altere `GITHUB_PAGES_BASE` no workflow para `/`.

> O dashboard e os dados agregados da API ficam públicos. Não publique a chave do LangSmith no frontend.

## API

`GET /api/observability/dashboard` é público e aceita os parâmetros:

- `period=today|24h|7d|30d|custom`;
- para `custom`, `start` e `end` em ISO 8601 com fuso, até 90 dias;
- `requests_per_user_week`, `minutes_saved_per_resolution`, `hourly_cost_usd`, `other_operational_cost_usd`.

Exemplo:

```sh
curl "http://localhost:8000/api/observability/dashboard?period=7d"
```

Os dados de traces são agregados no backend e ficam em cache em memória por 5 minutos por padrão. O limite padrão da consulta é 5.000 traces raiz, com aviso explícito se houver truncamento. Nenhum prompt, UID ou conteúdo de mensagens é enviado ao frontend.

## Organização

```text
backend/app/integrations/langsmith_source.py   leitura dos runs/feedbacks existentes
backend/app/services/metrics.py                agregação, percentis, cenários e ROI
backend/app/schemas.py                         contratos tipados da API
backend/app/main.py                            endpoint, CORS e cache
frontend/src/                                  interface responsiva
.github/workflows/pages.yml                    publicação da interface
render.yaml                                    hospedagem da API
```

## Limites conhecidos

- O custo por agente e a taxa de erro por agente não são inferidos do custo/erro total do trace; isso evitaria conclusões enganosas.
- Transições com o mesmo nome são somadas no trace atual. Assim, a média apresentada é por trace que contém a transição, não por ocorrência individual quando há repetição no mesmo trace.
- O custo é em USD porque é a moeda retornada pelo LangSmith. Para mostrar ROI em reais, faça conversão explícita com uma cotação definida e identificada antes de preencher o valor da hora.
- O cache é por instância e não substitui um histórico persistido. A V1 não precisa de banco próprio.
