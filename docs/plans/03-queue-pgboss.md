# Plano 03: Fila de jobs com pg-boss

Documento do **T6** do plano "Escala horizontal e worker desacoplado": integrar pg-boss; ao `enqueueTask` publicar job com `{ taskId, projectId }`; worker consumir da fila em vez de `getNextQueued`.

**Referências no código**: [backend/src/tasks/taskService.js](../../backend/src/tasks/taskService.js) (`enqueueTask`, `getNextQueued`), [backend/src/worker/run.js](../../backend/src/worker/run.js) (polling atual), [backend/src/worker/taskProcessor.js](../../backend/src/worker/taskProcessor.js) (pipeline worktree → coder → merge/remove → notifier).

**Dependências**: Este módulo assume **T1**, **T2**, **T3** e **T4** concluídos: Postgres como persistência, repositórios em uso, composition root já usando Postgres, e tabela `projects` + `project_id` em `tasks`. Sem `project_id` na tarefa não há como publicar o job na fila do projeto correto.

---

## 1. Setup pg-boss

### 1.1 Dependência

- Adicionar ao `backend/package.json`: **`pg-boss`** (versão estável atual; verificar compatibilidade com Node e Postgres).
- Instalação: `npm install pg-boss` no diretório `backend/`.

### 1.2 Conexão

- pg-boss usa **PostgreSQL**; conectar ao **mesmo banco** da aplicação via **`DATABASE_URL`** (já utilizado pelos repositórios após T3).
- Inicialização típica: `new PgBoss({ connectionString: process.env.DATABASE_URL })`; chamar `boss.start()` antes de publicar ou consumir jobs; em shutdown, `boss.stop()`.
- O pg-boss cria suas próprias tabelas no schema público (ou configurável); não conflitar com tabelas `projects`, `tasks`, etc.
- **Onde criar a instância**: (a) no **servidor** (API): para publicar jobs em `enqueueTask`; (b) no **worker**: para consumir jobs. Cada processo (API vs worker) pode ter sua própria instância de PgBoss apontando para o mesmo `DATABASE_URL`.

---

## 2. Fila por projeto

- **Nome da fila**: `agent-tasks:${projectId}`.
- `projectId` é o identificador do projeto (ex.: id numérico ou UUID, conforme schema de T1/T4). Exemplo: `agent-tasks:1`, `agent-tasks:abc-123`.
- Cada worker (T7) será configurado com um **único** `project_id` e se inscreverá **apenas** na fila `agent-tasks:${projectId}` desse projeto, de modo que só processe tarefas daquele repositório.

---

## 3. Enfileiramento: publicar job em `enqueueTask`

- **Onde**: na função `enqueueTask` do [taskService.js](../../backend/src/tasks/taskService.js) (ou no ponto que a chama, ex.: rota `POST /api/tasks/:id/queue` no servidor).
- **Fluxo**:
  1. Obter a tarefa (ex.: `getTask(id)`) para ter `project_id`.
  2. Validar que a tarefa existe e que o status permite enfileirar (ex.: só de `open` → `queued`).
  3. Atualizar status para `queued` (como hoje: `updateTask(id, { status: 'queued' })`).
  4. **Publicar job** na fila `agent-tasks:${projectId}` com payload:
     - `{ taskId, projectId }`
     - `taskId`: id da tarefa; `projectId`: id do projeto (para validação no worker e logs).
- A tabela `tasks` continua sendo a **fonte da verdade** do status; o job é a **notificação** para um worker processar a tarefa.

---

## 4. Worker: consumir da fila em vez de `getNextQueued`

- **Onde**: [backend/src/worker/run.js](../../backend/src/worker/run.js) e [backend/src/worker/taskProcessor.js](../../backend/src/worker/taskProcessor.js).
- **Comportamento atual**: `run.js` faz `setInterval(..., POLL_MS)` chamando `taskProcessor.processNextTask()`; `processNextTask()` chama `taskService.getNextQueued()` e, se houver tarefa, executa o pipeline (worktree, contextBuilder, coder, merge/remove, notifier).
- **Comportamento alvo**:
  1. Worker **não** usa mais `setInterval` + `getNextQueued`.
  2. Worker obtém `projectId` (configuração: env `PROJECT_ID` ou equivalente, ver T7).
  3. Worker **inscreve-se** na fila `agent-tasks:${projectId}` (pg-boss: `boss.work('agent-tasks:${projectId}', handler)` ou equivalente).
  4. **Ao receber um job** (payload `{ taskId, projectId }`):
     - Carregar a tarefa (ex.: `taskService.getTask(taskId)`).
     - Validar que `task.project_id === projectId` (segurança: não processar tarefa de outro projeto).
     - Executar o **mesmo pipeline** que hoje está em `processNextTask`: marcar `in_progress`, worktree, buildContextBlock, coder, merge ou removeWorktree, notifier, atualizar status `done`/`rejected`, comentários, etc. Ou seja: **reutilizar** a lógica de `taskProcessor` (ex.: extrair uma função `processTask(task)` chamada pelo handler do job).
  5. Em caso de falha no handler, pg-boss pode **retentar** o job conforme política (retries, backoff); combinar com atualização de status `rejected` e comentário na tarefa.

---

## 5. Concorrência e idempotência

- **Objetivo**: Evitar que uma mesma tarefa seja processada por mais de um worker (ou duas vezes pelo mesmo worker).
- **Abordagem**:
  1. No **início do handler** do job (ao receber `{ taskId, projectId }`):
     - Marcar a tarefa como `in_progress` (ex.: `taskService.updateTask(taskId, { status: 'in_progress' })`).
     - Fazer isso numa **transação** ou com **condição**: só atualizar se o status atual for `queued` (ex.: `UPDATE tasks SET status = 'in_progress' WHERE id = ? AND status = 'queued'`; se nenhuma linha afetada, considerar que outro worker já pegou e sair sem processar).
  2. Alternativa ou complemento: usar **idempotency** no job (ex.: job id ou `taskId` como chave); se o job for reprocessado (retry), a checagem "status ainda é queued?" evita reprocessamento.
  3. A tabela `tasks` é a fonte da verdade; o lock implícito (status `queued` → `in_progress`) garante que apenas um consumer processe a tarefa.

---

## 6. Checklist de implementação

- [ ] **Setup**: Adicionar dependência `pg-boss` em `backend/`; configurar conexão com `DATABASE_URL` (servidor e worker).
- [ ] **API**: Inicializar PgBoss no servidor (ou no módulo que expõe `enqueueTask`); em `enqueueTask`, após `updateTask(id, { status: 'queued' })`, publicar job em `agent-tasks:${projectId}` com `{ taskId, projectId }`; garantir que a tarefa tenha `project_id` (depende de T4).
- [ ] **Worker**: Remover polling (`setInterval` + `getNextQueued`); inscrever-se na fila `agent-tasks:${projectId}` (projectId vindo de config/env).
- [ ] **TaskProcessor**: Extrair lógica “processar uma tarefa já conhecida” (ex.: `processTask(task)`) para ser chamada pelo handler do job; no início do handler, marcar `in_progress` somente se status ainda for `queued` (transação ou UPDATE condicional).
- [ ] **Falha e retry**: Definir política de retry no pg-boss para o queue; em falha definitiva, garantir que a tarefa fique `rejected` e com comentário (já feito hoje no `taskProcessor`).
- [ ] **Testes**: Ajustar testes do worker/taskProcessor que hoje mockam `getNextQueued` para cobrir o fluxo via job (handler recebe `{ taskId, projectId }` e chama o pipeline); testes de integração opcionais com pg-boss e Postgres.

---

## 7. Referências rápidas

| Artefato | Uso |
|----------|-----|
| [backend/src/tasks/taskService.js](../../backend/src/tasks/taskService.js) | `enqueueTask` (atualizar status + novo: publicar job); `getNextQueued` deixa de ser usado pelo worker. |
| [backend/src/worker/run.js](../../backend/src/worker/run.js) | Trocar polling por inscrição na fila `agent-tasks:${projectId}`. |
| [backend/src/worker/taskProcessor.js](../../backend/src/worker/taskProcessor.js) | Extrair `processTask(task)` (ou equivalente) para ser invocado pelo handler do job; manter pipeline: worktree, contextBuilder, coder, merge/remove, notifier. |

---

## 8. Resumo e dependências

- **Resumo**: pg-boss conectado ao mesmo Postgres (`DATABASE_URL`); fila por projeto `agent-tasks:${projectId}`; em `enqueueTask` publicar job `{ taskId, projectId }`; worker deixa de usar `getNextQueued` e consome jobs da fila do projeto, executando o mesmo pipeline (worktree, contextBuilder, coder, merge/remove, notifier); concorrência tratada marcando `in_progress` no início do handler apenas se status for `queued`.
- **Dependências**: **T1** (schema Postgres), **T2** (repositórios Postgres), **T3** (wiring para Postgres), **T4** (tabela `projects` e `project_id` em `tasks`). Sem T4, não há `project_id` para escolher a fila e o payload do job.
