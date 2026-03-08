# Plano: API e real-time multi-instância

Documento de implementação do **T8** do plano "Escala horizontal e worker desacoplado": Socket.IO com Redis adapter para broadcast entre instâncias; `GET /api/repo/files` por `project_id` com mapeamento config/DB; autenticação documentada como fase 2.

**Dependências**: Este módulo assume que **T4** (projetos como entidade, tabela `projects`, `task.project_id`) está em uso ou em implementação. O Redis adapter é independente; `GET /api/repo/files` com `project_id` depende do modelo de projetos e do mapeamento projeto → path no servidor.

---

## 1. Socket.IO com Redis adapter (broadcast multi-instância)

### 1.1 Objetivo

Com várias instâncias do servidor API atrás de um load balancer, um `io.emit(...)` em uma instância hoje só alcança os clientes conectados a essa instância. Para que `task:updated` e `task:deleted` (e qualquer outro evento emitido via Socket.IO) cheguem a **todos** os clientes em **qualquer** instância, as instâncias precisam compartilhar um **pub/sub** (Redis).

### 1.2 Implementação

- **Pacote**: `@socket.io/redis-adapter` (e dependência `redis` ou `ioredis` para o cliente Redis).
- **Configuração**: Variável de ambiente `REDIS_URL` (ex.: `redis://localhost:6379`). Se não estiver definida, o servidor sobe Socket.IO **sem** adapter (comportamento atual: broadcast apenas na instância local).
- **Wiring**: No arranque do servidor, após criar `new Server(server)`:
  - Se `REDIS_URL` existir: criar cliente(s) Redis, criar `createAdapter(pubClient, subClient)` e chamar `io.adapter(redisAdapter)` antes de `app.set("io", io)`.
  - Documentar que, em deploy multi-instância, é necessário um Redis acessível por todas as instâncias e configurar `REDIS_URL`.
- **Eventos afetados**: Todos os que hoje usam `req.app.get("io").emit(...)` passam a ser replicados automaticamente via adapter: `task:updated`, `task:deleted`, e qualquer outro emit usado em `POST /api/internal/broadcast`.

### 1.3 Referências no código

| Arquivo | Onde alterar |
|---------|----------------|
| [backend/src/server/index.js](backend/src/server/index.js) | Função `startServer`: criação do `Server` Socket.IO; condicional para Redis URL; `io.adapter(redisAdapter)` quando Redis configurado. |
| [backend/src/server/run.js](backend/src/server/run.js) | Apenas chama `startServer`; sem mudança se a lógica ficar em `index.js`. |
| [backend/package.json](backend/package.json) | Adicionar dependências: `@socket.io/redis-adapter`, `redis` (ou `ioredis`). |

### 1.4 Comportamento esperado

- **Sem REDIS_URL**: Socket.IO sobe como hoje; broadcast só na instância local.
- **Com REDIS_URL**: Socket.IO usa Redis adapter; qualquer `io.emit(event, data)` é publicado no Redis e recebido por todas as instâncias que compartilham o mesmo adapter, repassando aos seus clientes.

---

## 2. GET /api/repo/files por project_id

### 2.1 Estado atual

- Rota: `GET /api/repo/files?path=...`
- Implementação: usa `findGitRoot(process.cwd())` como raiz do repositório e `listRepoFiles(repoRoot, subPath)`.
- Limitação: assume um único repo (o `cwd` do processo). Não há noção de projeto; não funciona quando a API serve vários projetos e cada projeto tem um clone em um path diferente.

### 2.2 Contrato desejado

- **Query**: aceitar `project_id` (identificador do projeto) e opcionalmente `path` (subpasta relativa ao root do projeto).
  - Ex.: `GET /api/repo/files?project_id=123`, `GET /api/repo/files?project_id=123&path=src`.
- **Resposta**: mesmo formato atual `{ path, entries: [{ path, type, name }] }`.
- **Mapeamento project_id → path no disco**: o servidor precisa saber onde está o clone do repositório do projeto. Duas opções:
  1. **Config**: arquivo ou variáveis de ambiente (ex.: `REPO_PATHS='{"project-id-1":"/abs/path/to/repo1","project-id-2":"/abs/path/to/repo2"}'` ou ficheiro `config/repo-paths.json`).
  2. **Banco**: coluna `storage_path` (ou `repo_path`) na tabela `projects` (path absoluto no servidor onde o clone do projeto está). Requer que o servidor (ou algum processo) tenha acesso a esse diretório.

### 2.3 Regras

- Se **`project_id` for omitido** e o servidor tiver apenas um “projeto default” (ex.: único repo conhecido), pode-se manter comportamento legado: usar `findGitRoot(process.cwd())` como hoje. Caso contrário, exigir `project_id` e retornar 400 se faltar.
- Se **`project_id` for enviado** mas **não houver mapeamento** para esse projeto (nem em config nem em DB): retornar **501 Not Implemented** com corpo explicando que o servidor não tem clone/configuração para esse projeto (ou retornar `{ path: ".", entries: [] }` e documentar que frontend deve desabilitar/ocultar seletor de arquivos nesse caso).
- Se o **path mapeado não existir** ou **não for um repositório git válido**: retornar 404 ou 500 com mensagem clara.
- **Path traversal**: manter a garantia atual (em [backend/src/server/repoFiles.js](backend/src/server/repoFiles.js)) de que `path` fica dentro do `repoRoot`; ao resolver `repoRoot` por `project_id`, usar esse root na mesma lógica.

### 2.4 Quando o servidor não tem clones

Se o desenho for “API central sem clones; workers com clone local”, então nesta API:

- **Opção A**: Retornar **501** para `GET /api/repo/files?project_id=...` quando não houver mapeamento, e documentar que o frontend deve desabilitar o seletor de arquivos do repositório nesse modo (ou usar outro fluxo futuro, ex.: worker expondo proxy ou contexto apenas por path textual).
- **Opção B**: Retornar **200** com `{ path: ".", entries: [] }` e documentar que listagem vazia significa “servidor sem clone para este projeto”.

O plano adota **501** quando não houver mapeamento, para deixar explícito que a funcionalidade não está disponível nessa configuração.

### 2.5 Referências no código

| Arquivo | Onde alterar |
|---------|----------------|
| [backend/src/server/index.js](backend/src/server/index.js) | Handler `GET /api/repo/files`: ler `project_id` (e `path`) da query; resolver `repoRoot` por projeto (config ou DB); chamar `listRepoFiles(repoRoot, subPath)`; 501 se sem mapeamento. |
| [backend/src/server/repoFiles.js](backend/src/server/repoFiles.js) | Manter `listRepoFiles` e `resolveWithinRepo`; não precisa de `project_id` — quem resolve o root é o handler. Opcional: extrair `getRepoRootForProject(projectId, getProjectById, configRepoPaths)` em módulo de config ou em `index.js`. |
| [backend/src/coder/worktree.js](backend/src/coder/worktree.js) | `findGitRoot` continua útil quando não há `project_id` (fallback legado) ou para validar que o path mapeado é um repo git. |
| Tabela `projects` (se existir) | Adicionar coluna `storage_path` (VARCHAR/TEXT, nullable) na migration de projetos; preencher onde o servidor tiver clone. Ref.: [docs/plans/02-projects-entity.md](docs/plans/02-projects-entity.md). |

---

## 3. Autenticação (API key / JWT) — fase 2 (to-do)

Para workers remotos e cenários multi-tenant, a API e o “claim” de jobs (se exposto via HTTP) devem ser protegidos por autenticação.

- **Escopo**: Autenticação para rotas da API (e, se aplicável, para o worker ao notificar ou ao consumir fila via HTTP). Não implementar na primeira fase do T8; apenas **documentar** como to-do.
- **Opções a considerar**: API key em header (ex.: `Authorization: Bearer <key>` ou `X-API-Key`); ou JWT para sessão/worker. Rotas internas (ex.: `POST /api/internal/broadcast`) podem continuar restritas por rede (localhost) ou exigir mesmo token.
- **Artefato**: Módulo ou doc `docs/plans/06-auth.md` (ou seção em doc de deploy) com: requisitos de auth, rotas a proteger, formato de API key/JWT, e checklist de implementação. **Não** implementar neste plano.

---

## 4. Checklist de tarefas (com referências)

### Socket.IO Redis adapter

- [ ] Adicionar dependências `@socket.io/redis-adapter` e `redis` (ou `ioredis`) em [backend/package.json](backend/package.json).
- [ ] Em [backend/src/server/index.js](backend/src/server/index.js), na função `startServer`: ler `REDIS_URL` (ex.: `process.env.REDIS_URL`); se definida, criar cliente(s) Redis, criar adapter com `createAdapter(pubClient, subClient)` e chamar `io.adapter(redisAdapter)` após criar `new Server(server)`.
- [ ] Garantir que `app.set("io", io)` ocorre após o adapter estar configurado; nenhuma alteração nos handlers que já usam `req.app.get("io").emit(...)`.
- [ ] Documentar `REDIS_URL` em AGENTS.md (ou em docs de ambiente): opcional; quando definida, habilita broadcast multi-instância.

### GET /api/repo/files por project_id

- [ ] Definir origem do mapeamento `project_id → path`: (1) config (arquivo ou env, ex. `REPO_PATHS`) ou (2) coluna `storage_path` na tabela `projects`. Se usar DB, garantir que a migration de projetos inclui `storage_path` (ref. [docs/plans/02-projects-entity.md](docs/plans/02-projects-entity.md)).
- [ ] No handler `GET /api/repo/files` em [backend/src/server/index.js](backend/src/server/index.js): ler query `project_id` e `path`; se `project_id` for fornecido, resolver `repoRoot` via mapeamento (config ou `getProjectById(id).storage_path`); se não houver mapeamento, responder **501** com mensagem; senão chamar `listRepoFiles(repoRoot, subPath)` e devolver `{ path, entries }`.
- [ ] Comportamento sem `project_id`: manter fallback com `findGitRoot(process.cwd())` se for aceitável (um único repo no servidor); ou exigir `project_id` e 400 quando omitido — documentar a escolha.
- [ ] Validar que o path resolvido é um diretório e, se desejado, que contém um repo git (ex.: `findGitRoot(resolvedPath)`); em caso de path inválido, retornar 404 ou 500 conforme regras acima.
- [ ] Atualizar documentação da API (AGENTS.md ou doc de API): `GET /api/repo/files?project_id=...&path=...`; 501 quando servidor não tem clone/config para o projeto.

### Auth (fase 2 — só documentar)

- [ ] Criar to-do ou doc (ex.: `docs/plans/06-auth.md` ou seção em deploy): requisitos de autenticação (API key ou JWT), rotas a proteger, e checklist de implementação para fase 2. Nenhuma alteração de código no T8.

---

## 5. Resumo e dependências

| Item | Descrição |
|------|-----------|
| **Socket.IO Redis** | Adapter `@socket.io/redis-adapter` com `REDIS_URL`; broadcast `task:updated` / `task:deleted` entre instâncias. |
| **GET /api/repo/files** | Query `project_id` (e `path`); mapeamento project_id → path via config ou coluna `storage_path` em `projects`; 501 (ou vazio documentado) quando servidor não tem clone. |
| **Auth** | Documentado como to-do fase 2 (API key/JWT); não implementado no T8. |
| **Arquivos impactados** | [backend/src/server/index.js](backend/src/server/index.js), [backend/src/server/repoFiles.js](backend/src/server/repoFiles.js) (se extrair helper de resolução de root), [backend/package.json](backend/package.json), AGENTS.md, tabela `projects` (se usar `storage_path`). |

**Dependências de outros to-dos**

- **T4 (Projetos)**: Necessário para `project_id` e, se o mapeamento for por DB, para a tabela `projects` e coluna `storage_path`. Sem projetos, `GET /api/repo/files` pode continuar apenas com `path` (comportamento atual) e o Redis adapter pode ser implementado independentemente.
- **Projetos com `storage_path` ou config**: Para `GET /api/repo/files?project_id=...` funcionar, ou existe config (ex.: `REPO_PATHS`) no servidor, ou a tabela `projects` possui `storage_path` preenchido onde o servidor tem clone. Caso contrário, a rota retorna 501 e o frontend deve tratar (desabilitar seletor de arquivos nesse modo).
