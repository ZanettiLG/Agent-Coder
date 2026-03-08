# Arquitetura e decisões técnicas

Stack, estrutura de pastas, rotas e decisões de frontend e backend. Consulte **AGENTS.md** na raiz para estrutura detalhada de arquivos e API.

---

## 1. Stack

| Camada | Tecnologia |
|--------|------------|
| Backend | Node.js, Express |
| Persistência | SQLite (metadados), arquivos `.md` em `./tasks` |
| Frontend | React, Vite, MUI, Redux Toolkit, RTK Query, react-router-dom, react-markdown, remark-gfm, @dnd-kit |
| Agente | Integração com CLI do Cursor |

---

## 2. Frontend – decisões

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

## 3. Backend – resumo

- **API:** `src/server/index.js` – rotas `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/log`, `/api/tasks/:id/comments`, `/api/internal/broadcast`, `/api/worker/status`.
- **Tarefas:** `src/tasks/` – composition root, repositórios (meta, body, comments, log), TaskService.
- **Worker:** `src/worker/` – polling da fila, worktree por tarefa, coder, notifier, status em `data/worker-status.json`.
- **Coder:** `src/coder/` – createCoder, worktree (create/merge/remove), providers (Cursor CLI).

---

## 4. Referências

- Guia técnico completo: **AGENTS.md** (raiz).
- Produto e visibilidade: [01-produto.md](01-produto.md).
- Jornada: [02-jornada-usuario.md](02-jornada-usuario.md).
