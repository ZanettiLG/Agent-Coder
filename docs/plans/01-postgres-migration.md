# Plano 01: Migração para PostgreSQL

Documento do **T1** do plano "Escala horizontal e worker desacoplado": definição do schema Postgres e estratégia de migrations. Referências ao modelo atual: [backend/src/tasks/db.js](../../backend/src/tasks/db.js), [backend/src/tasks/storage.js](../../backend/src/tasks/storage.js), [backend/src/tasks/taskLog.js](../../backend/src/tasks/taskLog.js), [backend/src/worker/workerStatus.js](../../backend/src/worker/workerStatus.js).

---

## 1. Modelo atual (resumo)

| Recurso | Onde está hoje | Semântica |
|--------|-----------------|-----------|
| Metadados da tarefa | SQLite `tasks` | id, title, status (open \| queued \| in_progress \| done \| rejected), created_at, updated_at, failure_reason, context (JSON array) |
| Corpo da tarefa (body) | Arquivos `tasks/{id}.md` | Markdown; leitura/escrita em [storage.js](../../backend/src/tasks/storage.js) |
| Comentários | SQLite `task_comments` | id, task_id, author ('user' \| 'agent'), content, created_at |
| Log do agente | NDJSON em `tasks/workspaces/{id}/agent.log` | Eventos: type (started, chunk, done, error, worker_start, worker_end), text?, result?, at (ISO), error: stderr?, stdout?; worker_end: durationMs |
| Status do worker | Arquivo `data/worker-status.json` | lastPollAt, lastTaskId, lastTaskStatus, lastTaskAt, lastError, recentLogLines[] |

Contratos usados por [taskService.js](../../backend/src/tasks/taskService.js) e [repositories.js](../../backend/src/tasks/repositories.js): insert/getById/list/update/getNextQueued/delete (task meta), read/write/delete (body), listByTaskId/insert/deleteByTaskId (comments), append/getLog (task log), writeStatus/read (worker status).

---

## 2. Schema SQL completo (Postgres)

Compatibilidade semântica mantida: mesmos status, `context` como array JSON, `failure_reason`, autor de comentários, tipos de evento de log e campos de heartbeat.

### 2.1 Tabela `projects`

Entidade de primeiro nível; tarefas pertencem a um projeto (repositório). Uso futuro: fila por projeto, worker por projeto.

```sql
CREATE TABLE projects (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  clone_url  TEXT,
  default_branch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_projects_slug ON projects(slug) WHERE slug IS NOT NULL;
```

### 2.2 Tabela `tasks`

Substitui a tabela SQLite `tasks` e incorpora o body (hoje em arquivos `.md`). `project_id` NOT NULL para alinhar ao modelo alvo (um default project pode ser criado na migração inicial).

```sql
CREATE TABLE tasks (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','queued','in_progress','done','rejected')),
  body            TEXT NOT NULL DEFAULT '',
  failure_reason  TEXT,
  context         JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX idx_tasks_queued ON tasks(project_id, id) WHERE status = 'queued';
```

- **context**: array JSON no mesmo formato atual (ex.: `[{"type":"file","path":"src/foo.js"},{"type":"git","scope":"working"}]`). Uso em [db.js](../../backend/src/tasks/db.js) (`parseContext`, insert/update).
- **body**: migração do conteúdo dos arquivos `tasks/{id}.md`; repositório de body passa a ler/escrever nesta coluna.

### 2.3 Tabela `task_comments`

Equivalente à tabela SQLite `task_comments`; mesma semântica de `author` e ordenação por `created_at`.

```sql
CREATE TABLE task_comments (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author     TEXT NOT NULL DEFAULT 'user' CHECK (author IN ('user','agent')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
```

### 2.4 Tabela `task_log_events`

Substitui o arquivo NDJSON por tarefa. Um evento por linha; payload flexível em JSONB para `text`, `result`, `durationMs`, `stderr`, `stdout`, etc., conforme [taskLog.js](../../backend/src/tasks/taskLog.js) e [taskProcessor.js](../../backend/src/worker/taskProcessor.js).

```sql
CREATE TABLE task_log_events (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  event_type TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_task_log_events_task_id_at ON task_log_events(task_id, at ASC);
```

- **event_type**: `started`, `chunk`, `done`, `error`, `worker_start`, `worker_end`.
- **payload**: ex. `{"text":"..."}`, `{"result":null}`, `{"durationMs":1234}`, `{"text":"...","stderr":"...","stdout":"..."}` para errors.
- Leitura com limite (equivalente a `maxLogLines` em [config](../../backend/src/config/index.js)): `ORDER BY at ASC` e `LIMIT N` ou leitura das últimas N linhas por task_id (ver T2).

### 2.5 Tabela `worker_heartbeats`

Substitui `data/worker-status.json`; um registro por worker (upsert por `worker_id`). Campos espelhados de [workerStatus.js](../../backend/src/worker/workerStatus.js); `project_id` para filtrar workers por projeto.

```sql
CREATE TABLE worker_heartbeats (
  worker_id        TEXT PRIMARY KEY,
  project_id      BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  last_poll_at    TIMESTAMPTZ,
  last_task_id    BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  last_task_status TEXT,
  last_task_at    TIMESTAMPTZ,
  last_error      TEXT,
  recent_log_lines JSONB NOT NULL DEFAULT '[]',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_worker_heartbeats_project_id ON worker_heartbeats(project_id);
CREATE INDEX idx_worker_heartbeats_last_poll_at ON worker_heartbeats(last_poll_at);
```

- **recent_log_lines**: array JSON de strings (ex.: `["line1","line2"]`), equivalente ao campo atual no JSON do worker.
- Cálculo de "alive": `last_poll_at` dentro do último intervalo (ex. 60s), como em [workerStatus.js](../../backend/src/worker/workerStatus.js) (`STALE_MS`).

---

## 3. Estratégia de migrations

### 3.1 Opções

| Abordagem | Prós | Contras |
|-----------|------|--------|
| **SQL versionado (pasta `migrations/`)** | Sem dependência extra; controle total; fácil revisão em PR | Rollback manual; sem histórico automático no DB |
| **Lib de migrations (node-pg-migrate, db-migrate, knex)** | Histórico no DB; rollback declarado; convenções | Nova dependência; mais configuração |

Recomendação: **SQL versionado** em `backend/migrations/` (ou `backend/src/data/migrations/`), com convenção de nomes `NNN_descricao.sql` (ex.: `001_initial_schema.sql`). Execução via script npm que aplica arquivos ainda não aplicados (registro em tabela `schema_migrations` com nome do arquivo ou número). Mantém o projeto simples e evita nova lib; rollback documentado no próprio plano quando necessário.

### 3.2 Convenção

- Arquivos: `001_initial_schema.sql`, `002_add_foo.sql`, …
- Tabela de controle: `schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`.
- Ordem de aplicação: numérica por prefixo; cada arquivo é transacional (um único script por migração).

### 3.3 Migração inicial (dados existentes)

Se houver dados em SQLite e arquivos em `tasks/`:

1. Criar schema no Postgres (projects, tasks, task_comments, task_log_events, worker_heartbeats).
2. Inserir um projeto default (ex.: id=1, name='Default').
3. Migrar linhas da tabela `tasks` do SQLite para `tasks` do Postgres (`project_id=1`, `body` lido de `tasks/{id}.md`).
4. Migrar `task_comments`.
5. Opcional: migrar logs NDJSON de `tasks/workspaces/{id}/agent.log` para `task_log_events` (script separado ou migração 002).
6. Worker status: não migrar arquivo JSON; workers novos passam a escrever em `worker_heartbeats`.

---

## 4. Checklist de tarefas concretas (T1 + encadeamento)

### T1 – Schema e migrations (este documento)

- [x] Documentar schema completo das 5 tabelas (projects, tasks, task_comments, task_log_events, worker_heartbeats) mantendo compatibilidade semântica.
- [x] Documentar estratégia de migrations (SQL versionado + tabela `schema_migrations`).
- [x] Incluir checklist com referências aos arquivos do código.
- [x] **Arquivo**: Criar primeiro SQL de migração de exemplo: [backend/migrations/001_initial_schema.sql](../../backend/migrations/001_initial_schema.sql) (aplica o schema e insere projeto default).

### T2 – Implementar repositórios Postgres

- [ ] **backend/src/data/postgres/** (ou equivalente): implementar módulos que implementem os mesmos contratos que [repositories.js](../../backend/src/tasks/repositories.js): taskMetaRepo (insert, getById, list, update, getNextQueued, delete) usando [db.js](../../backend/src/tasks/db.js) como referência de campos; taskBodyStorage (read, write, delete) usando coluna `tasks.body`; commentRepo (listByTaskId, insert, deleteByTaskId); taskLogRepo (append → INSERT em task_log_events, getLog → SELECT com limite e opção `last`); workerStatusRepo (writeStatus → upsert em worker_heartbeats, read → select por worker_id ou agregado).
- [ ] **Contrato**: Manter assinaturas esperadas por [taskService.js](../../backend/src/tasks/taskService.js) e por [worker/taskProcessor.js](../../backend/src/worker/taskProcessor.js) e [worker/workerStatus.js](../../backend/src/worker/workerStatus.js).

### T3 – Wiring e remoção de SQLite/arquivos

- [ ] **backend/src/tasks/index.js** (composition root): escolher implementação (SQLite ou Postgres) via env (ex. `DATABASE_URL`); instanciar repositórios Postgres quando presente; exportar mesma API (createTask, getTask, listTasks, updateTask, deleteTask, enqueueTask, getNextQueued, appendEvent, getTaskLog, getTaskComments, addComment).
- [ ] **backend/src/server/index.js**: usar composition root de tasks; se houver leitura de worker status, usar reader que lê de Postgres (worker_heartbeats) em vez de [workerStatus.js](../../backend/src/worker/workerStatus.js) readStatusRaw/arquivo.
- [ ] Remover ou desativar uso de [db.js](../../backend/src/tasks/db.js) (SQLite), [storage.js](../../backend/src/tasks/storage.js) (arquivos .md), [taskLog.js](../../backend/src/tasks/taskLog.js) (arquivos agent.log) e arquivo `data/worker-status.json` quando Postgres estiver ativo.
- [ ] Testes em [backend/test/](../../backend/test/): ajustar para usar Postgres ou manter SQLite em teste (conforme decisão de config).

### T4 (Projects) – Já coberto pelo schema

- [ ] Tabela `projects` e `project_id` em `tasks` já definidas neste schema; API CRUD de projects e filtro por `project_id` em tasks serão implementados em outro plano (docs/plans/02-projects-entity.md ou equivalente).

---

## 5. Referências rápidas

| Arquivo | Uso no plano |
|---------|----------------|
| [backend/src/tasks/db.js](../../backend/src/tasks/db.js) | Colunas e semântica de tasks e task_comments; parseContext; getNextQueued. |
| [backend/src/tasks/storage.js](../../backend/src/tasks/storage.js) | Body em arquivo → coluna `tasks.body`. |
| [backend/src/tasks/taskLog.js](../../backend/src/tasks/taskLog.js) | Formato de eventos (type, at, text, result, durationMs, stderr, stdout) → task_log_events.event_type + payload. |
| [backend/src/tasks/repositories.js](../../backend/src/tasks/repositories.js) | Contratos dos repositórios a replicar em Postgres. |
| [backend/src/tasks/taskService.js](../../backend/src/tasks/taskService.js) | Orquestração que consome os repositórios; não deve mudar de interface. |
| [backend/src/worker/workerStatus.js](../../backend/src/worker/workerStatus.js) | Campos de status do worker → worker_heartbeats. |
| [backend/src/worker/taskProcessor.js](../../backend/src/worker/taskProcessor.js) | Chama appendEvent e writeStatus; repositórios devem manter a mesma API. |
| [backend/src/config/index.js](../../backend/src/config/index.js) | maxLogLines (TASK_LOG_MAX_LINES) para limite de eventos no getLog. |

---

## 6. Próximos passos

1. **Criar e aplicar** o arquivo de migração inicial (ex.: `001_initial_schema.sql`) no repositório.
2. **T2**: Implementar camada de acesso Postgres (repositórios) em módulo dedicado, mantendo contratos atuais.
3. **T3**: Alterar composition root e servidor para usar Postgres quando `DATABASE_URL` estiver definido; remover uso de SQLite e arquivos de body/log/worker-status em produção.
4. **T4**: Implementar API de projects e filtro por project_id (schema já pronto).
