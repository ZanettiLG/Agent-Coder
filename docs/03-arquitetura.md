# Arquitetura e decisões técnicas

Stack, estrutura de pastas, rotas e decisões de frontend e backend. Consulte **AGENTS.md** na raiz para estrutura detalhada de arquivos e API.

---

## 1. Stack (estado atual)

| Camada | Tecnologia |
|--------|------------|
| Backend | Node.js, Express |
| Persistência | SQLite (metadados), arquivos `.md` em `./tasks` |
| Frontend | React, Vite, MUI, Redux Toolkit, RTK Query, react-router-dom, react-markdown, remark-gfm, @dnd-kit |
| Agente | Integração com CLI do Cursor |

---

## 2. Arquitetura alvo (escala horizontal)

Após a migração descrita nos planos em **docs/plans/** (01–05):

| Camada | Tecnologia / modelo |
|--------|----------------------|
| Persistência | **PostgreSQL** (projects, tasks, task_comments, task_log_events, worker_heartbeats) |
| Fila de jobs | **pg-boss** (fila por projeto: `agent-tasks:${projectId}`) |
| API | Express; opcional **Redis** (`REDIS_URL`) para Socket.IO adapter e broadcast multi-instância |
| Workers | Um **processo por projeto/repositório**; cada worker roda **dentro** do clone do repo e consome apenas a fila daquele projeto |

- **Central**: API + Postgres + pg-boss. A API publica jobs em `enqueueTask` na fila do projeto; workers em outras máquinas conectam ao mesmo Postgres e à mesma fila do projeto.
- **Workers**: Iniciados com `PROJECT_ID` e (opcionalmente) `REPO_ROOT`; não clonam repositórios — quem processa tarefas do projeto X é um worker rodando no diretório do repo X. Vários workers do mesmo projeto podem rodar em paralelo (mesma fila, jobs distribuídos).
- **Real-time**: Com `REDIS_URL`, várias instâncias da API compartilham eventos Socket.IO (`task:updated`, `task:deleted`) via Redis adapter.

Detalhes de implementação: [docs/plans/01-postgres-migration.md](plans/01-postgres-migration.md) a [05-api-realtime.md](plans/05-api-realtime.md).

---

## 3. Frontend – decisões

| Decisão | Escolha |
|---------|---------|
| Chamadas à API | **RTK Query** (createApi) – cache, loading/error, menos boilerplate |
| Servir frontend em produção | **Express** serve `frontend/dist` – mesma origem, sem CORS |
| Corpo da tarefa (Markdown) | **react-markdown** + **remark-gfm** |
| Rotas | **react-router-dom**: `/` (board), `/tasks/:id` (board + detalhe). Criação/edição por **overlay** no board (sem `/tasks/new` nem `/tasks/:id/edit`) |
| Estrutura features/tasks | Board, Column, TaskCard, DraggableCard, TaskDetailOverlay, TaskFormOverlay, statusLabels |

- **Store:** configureStore com reducer root; RTK Query registrado.
- **Desenvolvimento:** Vite proxy `/api` → Express (ex.: `http://localhost:3000`).
- **Produção:** Express estático + catch-all para SPA.

---

## 4. Backend – resumo

- **API:** `src/server/index.js` – rotas `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/log`, `/api/tasks/:id/comments`, `/api/internal/broadcast`, `/api/worker/status`.
- **Tarefas:** `src/tasks/` – composition root, repositórios (meta, body, comments, log), TaskService.
- **Worker:** `src/worker/` – polling da fila, worktree por tarefa, coder, notifier, status em `data/worker-status.json`.
- **Coder:** `src/coder/` – createCoder, worktree (create/merge/remove), providers (Cursor CLI).

---

## 5. Deploy (arquitetura alvo)

Ordem de subida e dependências:

1. **PostgreSQL**: Banco disponível; executar **migrations** (ex.: `backend/migrations/001_initial_schema.sql` e controle via tabela `schema_migrations`) **antes** de iniciar a API. O pg-boss cria suas tabelas ao conectar.
2. **API**: `npm run server` com `DATABASE_URL`. Para múltiplas instâncias atrás de load balancer, definir `REDIS_URL` para o Socket.IO Redis adapter.
3. **Workers**: Um worker **por projeto**. Em cada host/diretório onde existe um clone do repositório do projeto, iniciar um worker com `PROJECT_ID`, `DATABASE_URL`, `SERVER_URL`, `CURSOR_API_KEY` e, se necessário, `REPO_ROOT`. Comando: `npm run worker`. Não é necessário Redis no worker; a fila é gerenciada pelo Postgres (pg-boss).

Variáveis de ambiente completas e quando usá-las: **AGENTS.md**, seção 9 (Ambiente) e 10 (Deploy).

---

## 6. Referências

- Guia técnico completo: **AGENTS.md** (raiz).
- Produto e visibilidade: [01-produto.md](01-produto.md).
- Jornada: [02-jornada-usuario.md](02-jornada-usuario.md).
