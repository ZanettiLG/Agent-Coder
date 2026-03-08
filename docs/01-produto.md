# Produto – Agent Coder

Escopo, direcionamento e visibilidade do agente. Referência única para o que o produto é e como o usuário vê o estado do pipeline e do agente.

---

## 1. Escopo

- **O quê:** Sistema de tarefas pessoal para o programador, com execução assíncrona por um agente (Cursor).
- **Quem:** Programador que enfileira tarefas, acompanha o pipeline (status) e quer ver o progresso e o raciocínio do agente por tarefa.
- **Visibilidade:**
  1. **Pipeline no board:** `open` → `queued` → `in_progress` → `done` ou `rejected`. Em falha do agente a tarefa vai para a coluna Rejeitada e o usuário vê o motivo em `failure_reason` no detalhe.
  2. **Log/progresso do agente:** por tarefa, no detalhe (seção "Progresso do agente"), com eventos em tempo (quase) real via `GET /api/tasks/:id/log`.

---

## 2. Decisões de produto

| Decisão | Escolha |
|--------|---------|
| Onde exibir progresso do agente | No detalhe da tarefa (drawer), seção "Progresso do agente" / "Log". |
| Formato do log | Log em tempo real (linhas/NDJSON) persistido por tarefa; leitura via `GET /api/tasks/:id/log`. |
| Flag `-p` (debug) | Opcional no coder; só para debug local. |
| Modo stream / json | Coder suporta modo "stream" (stdout por linhas/NDJSON) e "json" (batch). |
| Persistência de eventos | Um arquivo por tarefa: `tasks/workspaces/{taskId}/agent.log` (append NDJSON). |
| Real-time no frontend | Polling de `GET /api/tasks/:id/log` quando status = in_progress (ex.: 3 s). SSE em fase posterior se necessário. |

---

## 3. Referências

- Jornada do usuário: [02-jornada-usuario.md](02-jornada-usuario.md).
- Arquitetura e stack: [03-arquitetura.md](03-arquitetura.md).
