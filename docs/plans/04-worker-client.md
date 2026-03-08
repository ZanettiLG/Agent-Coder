# Plano 04: Worker desacoplado (ativo dentro do repositório)

Documento do **T7** do plano "Escala horizontal e worker desacoplado": worker que roda **dentro** de um repositório, com `PROJECT_ID` e repo root, consumindo apenas a fila do projeto e gravando heartbeats em DB. **Não** inclui clone sob demanda.

Referências ao código atual do worker: [backend/src/worker/run.js](../../backend/src/worker/run.js), [backend/src/worker/taskProcessor.js](../../backend/src/worker/taskProcessor.js), [backend/src/worker/notifier.js](../../backend/src/worker/notifier.js), [backend/src/worker/workerStatus.js](../../backend/src/worker/workerStatus.js), [backend/src/worker/logger.js](../../backend/src/worker/logger.js).

Dependências deste plano: **T6** (fila pg-boss por projeto), **T1/T3** (schema e repositório `worker_heartbeats` em Postgres).

---

## 1. Comportamento atual (resumo)

| Aspecto | Hoje |
|--------|------|
| Obtenção de tarefas | [taskProcessor.js](../../backend/src/worker/taskProcessor.js) chama `taskService.getNextQueued()` (polling no DB; sem filtro por projeto). |
| Repo root | [run.js](../../backend/src/worker/run.js) usa `findGitRoot(process.cwd())` e injeta em `taskProcessor`. |
| Projeto | Não existe; todas as tarefas em fila única. |
| Status do worker | [workerStatus.js](../../backend/src/worker/workerStatus.js) grava em arquivo `data/worker-status.json` via `writeStatus(update)`; servidor lê com `createWorkerStatusReader()`. Campos: lastPollAt, lastTaskId, lastTaskStatus, lastTaskAt, lastError, recentLogLines. |
| Notificação | [notifier.js](../../backend/src/worker/notifier.js) envia POST `/api/internal/broadcast` com `task:updated` após alterar tarefa. |

---

## 2. Um worker = um projeto

### 2.1 Identificação do projeto

- **Variável `PROJECT_ID`**: ao iniciar, o worker usa o `project_id` (do banco `projects`) daquele repositório. Valor obrigatório por configuração: `PROJECT_ID=<id>` (ou descoberta por registro no servidor, se implementado: ex. API que, dado o `remote`/path do repo, devolve o `project_id`).
- **Não** incluir clone sob demanda: quem processa tarefas do projeto X é um worker rodando **dentro** do repo X (cwd ou `REPO_ROOT`).

### 2.2 Raiz do repositório

- **`REPO_ROOT`** (opcional): path absoluto da raiz do repositório. Se não definido, usar `process.cwd()` como raiz (equivalente ao atual `findGitRoot(process.cwd())` em [run.js](../../backend/src/worker/run.js)).
- O worker usa esse path para: `createWorktree(repoRoot, workspacePath, task.id)`, `mergeWorktree`, `removeWorktree` e `buildContextBlock(repoRoot, task.context)` em [taskProcessor.js](../../backend/src/worker/taskProcessor.js).

### 2.3 Arquivos a alterar

- [run.js](../../backend/src/worker/run.js): ler `PROJECT_ID` (e opcionalmente `REPO_ROOT`); validar que `PROJECT_ID` está definido antes de iniciar o loop; passar `projectId` e `repoRoot` para o taskProcessor (ou para um módulo de fila que inscreve o worker na fila do projeto).

---

## 3. Consumir apenas a fila do projeto

### 3.1 Nome da fila

- Fila por projeto: **`agent-tasks:${projectId}`** (ex.: `agent-tasks:1`, `agent-tasks:2`). Definido no T6 ([03-queue-pgboss.md](03-queue-pgboss.md) quando existir).
- O worker **só** se inscreve nessa fila; não chama mais `taskService.getNextQueued()`.

### 3.2 Fluxo

1. Worker inicia com `PROJECT_ID` e `repoRoot`.
2. Conecta ao pg-boss (ou ao serviço que abstrai a fila) e subscreve em `agent-tasks:${projectId}`.
3. Ao receber job com `{ taskId, projectId }`, valida que `projectId === PROJECT_ID` do worker; se diferente, rejeita/ignora o job (ou não recebe, se a fila já for exclusiva do projeto).
4. Carrega a tarefa do DB/API, executa o mesmo pipeline atual: worktree → contextBuilder → coder → merge/remove → notifier (ver [taskProcessor.js](../../backend/src/worker/taskProcessor.js)).

### 3.3 Arquivos a alterar

- [taskProcessor.js](../../backend/src/worker/taskProcessor.js): em vez de chamar `taskService.getNextQueued()`, receber a tarefa como argumento (job da fila). Manter a assinatura `processNextTask()` compatível com um handler de job: `processJob({ taskId, projectId })` ou `processNextTask()` internamente chamado pelo callback do pg-boss com a tarefa já resolvida.
- [run.js](../../backend/src/worker/run.js): integrar com o cliente pg-boss (ou adapter): subscrever em `agent-tasks:${projectId}` e, a cada job, chamar o taskProcessor com `taskId`/`projectId`; opcionalmente manter um polling interno se pg-boss for usado em modo poll.

---

## 4. Heartbeats em DB com project_id

### 4.1 Tabela `worker_heartbeats`

Schema definido no **T1** ([01-postgres-migration.md](01-postgres-migration.md)): `worker_id`, `project_id`, `last_poll_at`, `last_task_id`, `last_task_status`, `last_task_at`, `last_error`, `recent_log_lines` (JSONB), `updated_at`.

- **worker_id**: identificador único do processo (ex.: UUID gerado no start, ou `hostname:pid`).
- **project_id**: o `PROJECT_ID` do worker; permite listar workers por projeto na API.

### 4.2 Escrita de heartbeats

- Em vez de [workerStatus.js](../../backend/src/worker/workerStatus.js) gravar em `data/worker-status.json`, o worker deve usar um **repositório de heartbeats** (contract do T2/T3): ex. `workerHeartbeatRepo.upsert({ workerId, projectId, lastPollAt, lastTaskId, lastTaskStatus, lastTaskAt, lastError, recentLogLines })`.
- Chamar upsert a cada poll (e ao concluir/rejeitar tarefa), com os mesmos campos que hoje são passados para `writeStatus()` em [taskProcessor.js](../../backend/src/worker/taskProcessor.js).

### 4.3 Arquivos a alterar

- [workerStatus.js](../../backend/src/worker/workerStatus.js): substituir escrita em arquivo por chamada ao repositório de heartbeats (injetado no worker). Manter `writeStatus(update)` como interface; internamente chama o repo com `worker_id` e `project_id` fixos do processo.
- [run.js](../../backend/src/worker/run.js): gerar ou ler `worker_id`; obter função de heartbeat (ex. do composition root) que recebe `workerId` e `projectId`; passar para taskProcessor/workerStatus.
- Servidor (T3): `GET /api/worker/status` passa a ler de `worker_heartbeats` (e opcionalmente filtrar por `project_id` ou `worker_id`), em vez de [createWorkerStatusReader](../../backend/src/worker/workerStatus.js) em arquivo.

---

## 5. Pacote/entrypoint reutilizável

### 5.1 Objetivo

- O worker deve ser **instalável em qualquer repositório**. Ao rodar **dentro** desse repo (cwd = raiz do repo ou `REPO_ROOT`), ele atende **somente** às tarefas do projeto associado (`PROJECT_ID`).
- Um único entrypoint (ex.: `node src/worker/run.js` ou `npm run worker`) que: lê config (PROJECT_ID, REPO_ROOT, DATABASE_URL, SERVER_URL, etc.), conecta ao Postgres e à fila, inscreve-se em `agent-tasks:${projectId}`, e a cada job executa o pipeline de processamento.

### 5.2 Configuração

- Variáveis de ambiente: `PROJECT_ID`, `REPO_ROOT` (opcional), `DATABASE_URL`, `SERVER_URL`, `CURSOR_API_KEY`, `WORKER_POLL_MS` (se aplicável). Documentar em AGENTS.md e neste plano.
- Não exigir que o servidor central tenha clones dos repositórios; o worker está no repo local e usa esse path.

### 5.3 O que não fazer

- **Não** incluir clone sob demanda de repositórios. O worker assume que já está rodando dentro do clone correto.

---

## 6. Checklist de implementação (referências aos arquivos)

- [ ] **Config PROJECT_ID e REPO_ROOT**  
  - [run.js](../../backend/src/worker/run.js): ler `process.env.PROJECT_ID` e `process.env.REPO_ROOT`; repo root = `REPO_ROOT || findGitRoot(process.cwd())`; falhar ao iniciar se `PROJECT_ID` estiver ausente.

- [ ] **Worker_id**  
  - [run.js](../../backend/src/worker/run.js) (ou módulo pequeno): gerar/definir `worker_id` (UUID ou hostname:pid) uma vez no start; passar para heartbeat.

- [ ] **Consumir apenas fila do projeto**  
  - Integrar com pg-boss (T6): inscrever em `agent-tasks:${projectId}` em [run.js](../../backend/src/worker/run.js).  
  - [taskProcessor.js](../../backend/src/worker/taskProcessor.js): receber tarefa/job (taskId, projectId) em vez de chamar `getNextQueued()`; validar projectId; manter resto do pipeline (worktree, coder, merge/remove, notifier).

- [ ] **Heartbeats em DB**  
  - [workerStatus.js](../../backend/src/worker/workerStatus.js): trocar escrita em arquivo por repositório de heartbeats (upsert por worker_id); incluir `project_id` em todo upsert.  
  - [run.js](../../backend/src/worker/run.js): injetar no worker o writer de heartbeat com worker_id e project_id.

- [ ] **API GET /api/worker/status**  
  - Servidor: ler de `worker_heartbeats` (agregar por worker ou por project_id), substituindo leitura de arquivo; manter contrato de resposta (alive, lastPollAt, lastTaskId, etc.) para compatibilidade com frontend.

- [ ] **Notifier**  
  - [notifier.js](../../backend/src/worker/notifier.js): sem mudança de contrato; continua POST `/api/internal/broadcast` com task:updated.

- [ ] **Logger**  
  - [logger.js](../../backend/src/worker/logger.js): manter `getRecentLogLines()` para envio no heartbeat; sem alteração necessária.

- [ ] **Documentação**  
  - AGENTS.md: documentar `PROJECT_ID`, `REPO_ROOT`, variáveis do worker e que um worker atende só a um projeto.  
  - Este plano: referências cruzadas para T6 (fila) e T1/T3 (worker_heartbeats).

---

## 7. Relação com outros to-dos

| To-do | Relação |
|------|--------|
| **T6** (fila) | Worker deixa de usar `getNextQueued()` e passa a consumir jobs da fila `agent-tasks:${projectId}`. O enfileiramento (enqueueTask) publica job nessa fila (T6). |
| **T1** | Schema `worker_heartbeats` com worker_id, project_id, last_poll_at, last_task_id, last_error, recent_log_lines, etc. |
| **T3** | Composition root e servidor usam Postgres; repositório de heartbeats implementado e usado pelo worker; GET /api/worker/status lê da tabela em vez do arquivo. |
