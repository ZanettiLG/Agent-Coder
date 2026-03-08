# Agent Coder – Guia para agentes de código

Este documento orienta agentes e LLMs a manter, estender e depurar o projeto. Humanas também podem usá-lo como referência.

---

## 1. Visão geral

**Agent Coder** é uma aplicação que:

- Gerencia **tarefas** (CRUD) com conteúdo em Markdown.
- Expõe uma **fila de processos**: tarefas com status `queued` são consumidas por um **worker** que executa uma thread do agente (Cursor) por tarefa, com **contexto isolado** (workspace e “chat” por tarefa).
- **Backend**: Express; persistência em **PostgreSQL** (quando `DATABASE_URL`) ou SQLite + arquivos (modo legado). Tarefas pertencem a **projetos**; fila por projeto com **pg-boss**; worker consome da fila ou por polling.
- **Frontend**: React, MUI, Redux Toolkit, RTK Query (em `frontend/`).

O agente **não** é iniciado em `src/index.js`; esse arquivo só exporta módulos. O agente roda apenas via **worker** (`npm run worker`), uma tarefa por vez.

**Arquitetura alvo (escala horizontal)**: Persistência em **PostgreSQL**; fila de jobs com **pg-boss** (fila por projeto); **workers** rodando dentro de cada repositório, consumindo apenas a fila daquele projeto; API central opcionalmente com **Redis** para Socket.IO multi-instância. Detalhes em [docs/03-arquitetura.md](docs/03-arquitetura.md) e nos planos em [docs/plans/](docs/plans/) (01–05).

---

## 2. Estrutura do projeto

```
agent-coder/
├── src/
│   ├── index.js           # Não inicia o agente; exporta createCoder e tasks
│   ├── config/            # Config (ex.: CURSOR_API_KEY)
│   ├── server/            # Express: API REST + servir frontend build
│   │   ├── index.js       # Rotas /api/tasks e estáticos
│   │   └── run.js         # Entry: npm run server
│   ├── tasks/             # Lógica de tarefas (Repository + Service + composition root)
│   │   ├── index.js       # Composition root: cria repositórios e TaskService; exporta createTask, getTask, listTasks, updateTask, deleteTask, enqueueTask, getNextQueued, appendEvent, getTaskLog, getTaskComments, addComment
│   │   ├── db.js          # SQLite singleton (metadados: tasks, task_comments); getDb(), ensureTasksDir, funções de acesso
│   │   ├── repositories.js # Factories: createTaskMetaRepository(db), createTaskBodyStorage(tasksDir), createCommentRepository(db), createTaskLogRepository(tasksDir)
│   │   ├── taskService.js # createTaskService({ taskMetaRepo, taskBodyStorage, commentRepo, taskLogRepo }) – orquestração sem depender de módulos concretos
│   │   ├── storage.js     # Leitura/escrita de .md em ./tasks/{id}.md
│   │   └── taskLog.js     # appendEvent(taskId, event), getTaskLog(taskId) – NDJSON em tasks/workspaces/{id}/agent.log
│   ├── worker/            # Consumidor da fila (composition root em run.js)
│   │   ├── run.js         # Entry: npm run worker; composition root (notifier, taskProcessor); setInterval(processNextTask)
│   │   ├── taskProcessor.js # createTaskProcessor(deps): processNextTask() – worktree, coder, notifier, writeStatus
│   │   ├── notifier.js    # createNotifier(serverUrl, getTask): notifyTaskUpdated(taskId) → POST /api/internal/broadcast
│   │   ├── logger.js      # Log estruturado [worker] + timestamp + nível; buffer recentLogLines
│   │   └── workerStatus.js # writeStatus(update); createWorkerStatusReader(path) para GET /api/worker/status
│   └── coder/             # Integração com agente (Cursor)
│       ├── index.js       # createCoder(options), default coder
│       ├── worktree.js    # Git worktree: createWorktree, mergeWorktree, removeWorktree (por tarefa)
│       └── providers/     # BaseCoder, CursorCoder (spawn do CLI)
├── frontend/              # App React (Vite, MUI, Redux Toolkit, RTK Query)
│   └── src/
│       ├── app/           # store, api/tasksApi.js
│       └── features/tasks # Board, Column, TaskCard, DraggableCard, TaskDetailOverlay, TaskFormOverlay, statusLabels
├── tasks/                 # Arquivos .md por tarefa (id.md); workspaces em tasks/workspaces/{id}
├── data/                  # SQLite (tasks.db) – ignorado no git
├── public/                # Fallback estático quando frontend/dist não existe
├── docs/                  # Jornada do usuário, pesquisa, etc.
└── package.json
```

---

## 3. Scripts (raiz)

| Script | Comando | Descrição |
|--------|---------|-----------|
| `start` / `server` | `node src/server/run.js` | Sobe a API Express; serve `frontend/dist` se existir. |
| `worker` | `node src/worker/run.js` | Worker que consome a fila e executa o agente por tarefa. |
| `build:frontend` | `cd frontend && npm run build` | Gera `frontend/dist` para produção. |

**Desenvolvimento**: em um terminal `npm run server` (porta 3000); em outro `cd frontend && npm run dev` (Vite com proxy `/api` → Express). Frontend e backend escutam em todas as interfaces (rede interna): acesse pelo IP da máquina (ex.: `http://192.168.x.x:5173` para o Vite; API e Socket.IO são repassados pelo proxy).

---

## 4. API de tarefas

- `GET /api/projects` – lista projetos. `GET /api/projects/:id`, `POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id` – CRUD de projetos.
- `GET /api/tasks` – lista tarefas. Query opcional `?project_id=N` para filtrar por projeto.
- `GET /api/tasks/:id` – uma tarefa (com body).
- `GET /api/tasks/:id/log` – log de eventos do agente para a tarefa (array: started, chunk, done, error, worker_start, worker_end). Query opcional `?last=N`: retorna apenas as últimas N linhas (limitado por `config.maxLogLines`; configurável via `TASK_LOG_MAX_LINES`). Sem `last`, retorna no máximo `maxLogLines` eventos (evita carregar log gigante).
- `GET /api/tasks/:id/comments` – lista de comentários da tarefa (ordenados por `created_at`); 404 se tarefa não existir.
- `POST /api/tasks/:id/comments` – criar comentário; body: `{ content (string), author?: 'user'|'agent' }` (default `user`); 404 se tarefa não existir.
- `POST /api/tasks` – criar; body: `{ title, body?, status?, context?, project_id? }`. `project_id` (opcional) associa à tarefa; default 1. `context` é um array de referências (ex.: `[{ type: 'file', path: 'src/foo.js' }, { type: 'git', scope: 'working' }]`). Tipos: `file`, `folder`, `codebase`, `docs`, `git`, `skill`, `rule`.
- `PUT /api/tasks/:id` – atualizar; body: `{ title?, body?, status?, failure_reason?, context? }`.
- `DELETE /api/tasks/:id` – excluir.
- `POST /api/tasks/:id/queue` – enfileirar (status → `queued`).
- `POST /api/internal/broadcast` – interno: emite evento Socket.IO (body `{ event, data }`); **apenas localhost** (403 fora).
- `GET /api/worker/status` – status do worker: `alive` (último poll &lt; 60s), `lastPollAt`, `lastTaskId`, `lastTaskStatus`, `lastTaskAt`, `lastError`, `recentLogLines`. Com `DATABASE_URL`, dados vêm da tabela `worker_heartbeats`; senão de `data/worker-status.json`.
- `GET /api/repo/files` – lista arquivos e pastas do repositório (para o seletor de contexto). Query: `?path=src` (opcional), `?project_id=N` (opcional). Com `project_id`, o servidor usa o path do env `PROJECT_ROOT_<id>` se definido; senão usa a raiz git do `cwd`. Retorna `{ path, entries: [{ path, type: 'file'|'folder', name }] }`.

Status: `open`, `queued`, `in_progress`, `done`, `rejected`. Quando o worker falha, o status vai para `rejected` e a justificativa fica em `failure_reason` (resposta de `GET`/`PUT` inclui o campo quando existir).

O servidor usa **Socket.IO**; eventos emitidos: `task:updated` (payload `{ id, task }`) e `task:deleted` (payload `{ id }`). O worker notifica o servidor via `POST /api/internal/broadcast` após alterar uma tarefa (done/rejected), para o frontend atualizar em tempo real.

---

## 5. Fila e worker

- Tarefas com status **`queued`** são consumidas pelo worker. Com **`DATABASE_URL`** e **`PROJECT_ID`**: o worker inscreve-se na fila **pg-boss** `agent-tasks:${PROJECT_ID}` e processa jobs (um job por tarefa enfileirada; ao enfileirar, a API publica o job). Sem Postgres: **polling** (intervalo `WORKER_POLL_MS`).
- **Git worktree**: antes de rodar o agente, o worker cria um **git worktree** em `tasks/workspaces/{taskId}` com branch `agent/task-{taskId}` (via `src/coder/worktree.js`). O agente roda nesse worktree. Se a tarefa **concluir com sucesso** → commit das alterações no worktree (se houver), **merge** da branch no repositório principal, remoção do worktree e da branch. Se **falhar** → **removeWorktree** (worktree e branch removidos).
- Para cada tarefa: status → `in_progress`, **appendEvent(taskId, { type: 'started' })**, **createWorktree(repoRoot, workspacePath, taskId)**, **buildContextBlock(repoRoot, task.context)** monta o bloco de contexto (arquivos, pastas, git diff, codebase, skills) a partir das referências da tarefa; o **prompt** enviado ao coder é `contextBlock + body` (ou só body se não houver contexto). **Novo coder** via `createCoder({ workspace, outputFormat: 'stream' })`, **code(prompt, { onChunk, onDone })** com callbacks que chamam **appendEvent** (chunk, done, error). Ao terminar → **mergeWorktree** (ou em erro **removeWorktree**), então status `done` e **addComment** (sucesso) ou `rejected`, **addComment** (falha).
- Cada execução do agente é **contexto limpo** (outro “chat”): um coder por tarefa, workspace = worktree isolado. Log do agente em `tasks/workspaces/{taskId}/agent.log` (NDJSON).

**Logs e diagnóstico do worker**

- **Console do worker**: saída com prefixo `[worker]`, timestamp ISO e nível (`info` ou `error`). Ex.: `[worker] 2025-03-07T12:00:00.000Z info Listening for queued tasks (poll every 5000 ms)`.
- **Log por tarefa**: `tasks/workspaces/{taskId}/agent.log` — NDJSON, uma linha por evento. Eventos: `started` (agente iniciou), `chunk` (trecho de saída), `done` (agente finalizou), `error` (falha; pode ter `text`, `stack`, `stderr`), `worker_start` (worker começou a tarefa), `worker_end` (worker terminou; campo `durationMs`). Em falha, o último `error` contém a mensagem e, quando disponível, trecho de stderr do processo do agente.
- **Status do worker**: o worker grava `data/worker-status.json` a cada poll e ao concluir/rejeitar tarefa. O servidor usa `createWorkerStatusReader(STATUS_FILE)` e a rota `GET /api/worker/status` devolve `reader.read()` (alive, lastPollAt, lastTaskId, etc.).

---

## 6. Coder (agente)

- `src/coder/index.js`: exporta o coder default e **`createCoder(options)`**. Opções: `workspace`, `outputFormat` ('json' padrão ou 'stream').
- **code(prompt, callbacks)**: callbacks opcionais `{ onChunk?(text), onDone?(result) }` para observar saída (Observer). Modo **stream** (outputFormat === 'stream'): lê stdout por linhas, emite onChunk por linha; onDone ao final. Modo **json** (batch): uma linha JSON, onDone(result), resolve(response).
- **-p (debug)**: flag opcional em `cursor.js`; usar só para debug local (mais verbosidade no CLI). Ver `docs/01-produto.md`.
- O coder usa o CLI do Cursor (`agent --trust ...`); ver `src/coder/providers/cursor.js` e `base.js`.

---

## 7. Frontend

- **Stack**: React, MUI, Redux Toolkit, RTK Query, react-router-dom, react-markdown, remark-gfm, @dnd-kit (core, sortable, utilities) para drag-and-drop.
- **Vista principal**: **Board Kanban** (rota `/`) com 5 colunas por status (Aberta, Na fila, Em progresso, Concluída, Rejeitada). Cards arrastáveis entre colunas; clique no card abre **detalhe em drawer**; “Adicionar card” por coluna abre **formulário em modal**. No formulário (criar/editar) há **contexto tipo Cursor**: botão “Adicionar @” para anexar referências (Arquivo, Pasta, Codebase, Git diff, Skill/Regras); as referências aparecem como chips e são enviadas no campo `context` da tarefa. No detalhe, o contexto anexado é exibido em chips. Mover card = `PUT /api/tasks/:id` com novo `status`. Tarefas rejeitadas exibem `failure_reason` no detalhe.
- **Rotas**: `/` (board), `/tasks/:id` (board com detalhe da tarefa aberto – deep link).
- **API**: `frontend/src/app/api/tasksApi.js` (baseUrl `/`; em dev o Vite faz proxy para o Express).
- **Status**: labels e chips para `open`, `queued`, `in_progress`, `done`, `rejected`; botão “Enfileirar” no overlay de detalhe quando status é `open`. Atualização em tempo real via Socket.IO (invalidação de cache RTK Query nos eventos `task:updated` e `task:deleted`).
- **Componentes**: `Board.jsx` (DndContext, colunas), `Column.jsx` (useDroppable), `DraggableCard.jsx` / `TaskCard.jsx`, `TaskDetailOverlay.jsx` (drawer com seção "Progresso do agente" – log via `getTaskLog`, polling a cada 3 s quando status = in_progress – e seção "Comentários": lista de comentários e campo para novo comentário; comentários do agente aparecem ao concluir/rejeitar tarefa), `TaskFormOverlay.jsx` (modal). API: `getTaskLog`, `getTaskComments`, `addComment` em `tasksApi.js`. Agrupamento por status: `groupTasksByStatus` e `STATUS_ORDER` em `statusLabels.js`. Ao receber `task:updated` via Socket.IO, o cache de comentários da tarefa é invalidado para atualização em tempo real.

---

## 8. Convenções para agentes

- **Backend (Node)**: CommonJS; preferir **funções e composição** em vez de classes onde fizer sentido; manter `src/tasks` e `src/worker` sem side-effects desnecessários no load.
- **Frontend (React)**: seguir padrões do projeto em `frontend/src` (features, app/store, app/api); evitar proliferação de boolean props; usar RTK Query para dados da API.
- **Testes**: **Backend** (TDD): testes em `backend/test/`, espelhando `backend/src/` (pastas `tasks/`, `server/`, `worker/`, `coder/`). Runner: Node.js `node:test`; descoberta automática via `node test/run-tests.js`. Executar: `cd backend && npm test`; cobertura: `cd backend && npm run test:coverage` (relatório em `backend/coverage/`). **Frontend**: Vitest e testes em `frontend/src` (ex.: `statusLabels.test.js`, `tasksApi.test.js`). Novas regras de negócio devem ter testes quando fizer sentido; não criar arquivos de exemplo em vez de testes.
- **Documentação**: planos e decisões em `docs/`; não editar o plano em `.cursor/plans/` a menos que o usuário peça.
- **Causa raiz**: ao corrigir bugs, identificar e corrigir a causa exata; não apenas contornar com fallbacks.
- **Uso de código**: usar variáveis e funções já criadas ou removê-las se ficarem obsoletas.
- **Dados grandes (context, arrays)**: para conteúdo &gt; ~100KB por tarefa (ex.: um array muito grande), não guardar em coluna única no SQLite; preferir arquivo dedicado (ex.: `context.json` no workspace da tarefa) ou tabela normalizada com paginação. Valores configuráveis (ex.: limites de log) ficam em `backend/src/config`; a lógica não define magic numbers.

---

## 9. Ambiente (variáveis de ambiente)

Arquivo **`.env`** na raiz (não versionado). Tabela por contexto:

| Variável | Onde | Obrigatório | Descrição |
|----------|------|-------------|-----------|
| **API (servidor)** |
| `PORT` | API | Não (default 3000) | Porta do servidor HTTP. |
| `HOST` | API | Não (default `0.0.0.0`) | Interface (ex.: `0.0.0.0` para rede interna). |
| `DATABASE_URL` | API | Sim (arquitetura alvo) | URL de conexão PostgreSQL (ex.: `postgresql://user:pass@host:5432/db`). Sem ela, o sistema pode usar SQLite/arquivos (modo legado). |
| `REDIS_URL` | API | Não | URL do Redis (ex.: `redis://localhost:6379`). Quando definida, habilita **Socket.IO Redis adapter** para broadcast entre múltiplas instâncias da API. |
| **Worker** |
| `PROJECT_ID` | Worker | Sim (arquitetura alvo) | ID do projeto (repositório) que este worker atende. O worker consome apenas a fila `agent-tasks:${PROJECT_ID}`. |
| `REPO_ROOT` | Worker | Não | Path absoluto da raiz do repositório. Se omitido, usa `process.cwd()` (ou `findGitRoot(process.cwd())`). |
| `DATABASE_URL` | Worker | Sim (arquitetura alvo) | Mesmo Postgres da API; usado para ler tarefas e gravar heartbeats em `worker_heartbeats`. |
| `SERVER_URL` | Worker | Não | URL do servidor para notificar broadcast (ex.: `http://localhost:3000`). Padrão: `http://localhost:${PORT}`. Usado em `POST /api/internal/broadcast` após concluir/rejeitar tarefa. |
| `CURSOR_API_KEY` | Worker | Sim (para rodar agente) | Chave para o CLI do Cursor (coder). |
| `WORKER_POLL_MS` | Worker | Não | Intervalo de polling em ms (modo legado, sem DATABASE_URL). Com pg-boss o worker consome da fila. |
| `WORKER_ID` | Worker | Não | Identificador do processo (default: hostname-pid). Usado em `worker_heartbeats` quando DATABASE_URL. |
| **API (repo/files)** |
| `PROJECT_ROOT_<id>` | API | Não | Path absoluto do repositório do projeto `<id>` para `GET /api/repo/files?project_id=<id>`. Ex.: `PROJECT_ROOT_1=/var/repos/meu-projeto`. |
| **Comum** |
| `TASK_LOG_MAX_LINES` | API | Não (default 2000) | Limite máximo de linhas/eventos retornados em `GET /api/tasks/:id/log`. |

**Quando usar**: Em desenvolvimento local pode-se usar apenas SQLite (sem `DATABASE_URL`) e um worker no mesmo host. Para escala horizontal: definir `DATABASE_URL` (Postgres), um worker por projeto com `PROJECT_ID` e `REPO_ROOT` (se necessário); para várias instâncias da API, definir `REDIS_URL`.

---

## 10. Deploy

Ordem recomendada e dependências:

1. **PostgreSQL**: Banco disponível; aplicar **migrations** (`backend/migrations/` ou equivalente) antes de subir a API (schema: `projects`, `tasks`, `task_comments`, `task_log_events`, `worker_heartbeats`; pg-boss cria suas próprias tabelas ao iniciar).
2. **API**: `npm run server` (ou `npm start`). Definir `DATABASE_URL`. Opcional: `REDIS_URL` para múltiplas instâncias da API atrás de load balancer (Socket.IO com Redis adapter).
3. **Workers**: Um **processo worker por projeto/repositório**. Em cada máquina ou diretório onde há um clone do repo, subir um worker com `PROJECT_ID` igual ao id desse projeto no banco e, se necessário, `REPO_ROOT` apontando para a raiz do clone. Comando: `npm run worker`. O worker conecta ao mesmo Postgres (e pg-boss), inscreve-se na fila `agent-tasks:${PROJECT_ID}` e processa apenas tarefas desse projeto. Vários workers do **mesmo** projeto podem rodar em paralelo (mesma fila, jobs distribuídos).

**Resumo**: (1) Migrations → (2) API com `DATABASE_URL` (e opcionalmente `REDIS_URL`) → (3) Workers com `PROJECT_ID`, `DATABASE_URL`, `SERVER_URL`, `CURSOR_API_KEY`. Ver [docs/03-arquitetura.md](docs/03-arquitetura.md) para arquitetura e [docs/plans/](docs/plans/) para detalhes de cada módulo.

**Config e Docker**

- **`.env.example`** (raiz): template de variáveis; copiar para `.env` e preencher (`.env` não é versionado).
- **`docker-compose.yml`** (raiz): sobe Postgres, Redis e o serviço **api** (backend). O serviço **worker** está em profile `worker`; para subir: `docker compose --profile worker up`. O worker usa `env_file: .env` (definir `CURSOR_API_KEY` no `.env`). Migrations rodam automaticamente no primeiro uso da API (composition root com Postgres).

---

## 11. Referências no repositório

- **docs/README.md** – índice da documentação.
- Produto e visibilidade do agente: `docs/01-produto.md`.
- Jornada do usuário (Kanban + legado): `docs/02-jornada-usuario.md`.
- Arquitetura e decisões (stack, rotas, deploy): `docs/03-arquitetura.md`.
- UX, responsividade e acessibilidade: `docs/04-ux-acessibilidade.md`.
- Roadmap e histórico: `docs/05-roadmap.md`.
- **Planos de implementação (escala horizontal)** em **docs/plans/**:
  - [01-postgres-migration.md](docs/plans/01-postgres-migration.md) – Schema Postgres e migrations (T1–T3).
  - [02-projects-entity.md](docs/plans/02-projects-entity.md) – Projetos como entidade, API e frontend (T4–T5).
  - [03-queue-pgboss.md](docs/plans/03-queue-pgboss.md) – Fila pg-boss por projeto (T6).
  - [04-worker-client.md](docs/plans/04-worker-client.md) – Worker desacoplado por projeto (T7).
  - [05-api-realtime.md](docs/plans/05-api-realtime.md) – Socket.IO Redis, repo/files por projeto (T8).
