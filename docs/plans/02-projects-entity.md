# Plano: Projetos (repositórios) como entidade

Documento de implementação do **T4** do plano "Escala horizontal e worker desacoplado": tabela `projects`, `project_id` em `tasks`, API CRUD de projetos e filtro por projeto nas tarefas.

**Dependências**: Este módulo assume que **T1**, **T2** e **T3** (Postgres + repositórios + wiring) já foram concluídos. Sem Postgres, a tabela `projects` e a FK em `tasks` não existem; a implementação deve ser feita sobre a camada Postgres já definida.

---

## 1. Schema: tabela `projects` e alteração em `tasks`

### 1.1 Tabela `projects`

| Coluna           | Tipo         | Restrições                    | Descrição                                      |
|------------------|--------------|-------------------------------|------------------------------------------------|
| `id`             | UUID ou SERIAL | PK, gerado                    | Identificador único do projeto.                |
| `name`           | VARCHAR(255) | NOT NULL                      | Nome de exibição do projeto.                   |
| `slug`           | VARCHAR(255) | NOT NULL, UNIQUE              | Identificador URL-safe (ex.: `meu-repo`).      |
| `clone_url`      | VARCHAR(1024)| NULL                          | URL do repositório remoto (opcional).          |
| `default_branch` | VARCHAR(255) | NULL                          | Branch padrão (ex.: `main`).                   |
| `created_at`     | TIMESTAMPTZ  | NOT NULL, default now()      | Data de criação.                                |
| `updated_at`     | TIMESTAMPTZ  | NOT NULL, default now()      | Data da última atualização.                    |

- Índice único em `slug` para buscas e unicidade.
- Migration: criar tabela `projects` antes de alterar `tasks`.

### 1.2 Alteração na tabela `tasks`

- Adicionar coluna **`project_id`** (tipo igual ao PK de `projects`: UUID ou INTEGER).
- **NOT NULL** após migração (todo task pertence a um projeto).
- **FK** para `projects(id)` com `ON DELETE RESTRICT` (ou política definida: não apagar projeto com tarefas).
- Índice em `tasks(project_id)` para listagem e filtros por projeto.

Migration sugerida (exemplo com SERIAL em `projects`):

1. Criar tabela `projects` (como acima).
2. Adicionar `project_id` em `tasks` como NULLável.
3. Inserir um projeto default (ex.: "Projeto principal", slug `default`) e atualizar todas as tarefas existentes com esse `project_id`.
4. Alterar `project_id` para NOT NULL.
5. Adicionar constraint de FK e índice.

---

## 2. API CRUD de projetos

| Método | Rota                    | Descrição |
|--------|-------------------------|-----------|
| GET    | `/api/projects`         | Lista todos os projetos (id, name, slug, clone_url, default_branch, created_at, updated_at). |
| POST   | `/api/projects`         | Cria projeto. Body: `{ name, slug?, clone_url?, default_branch? }`. `slug` opcional: derivado de `name` se omitido. Retorna 201 e o projeto criado. |
| GET    | `/api/projects/:id`     | Retorna um projeto por id; 404 se não existir. |
| PUT    | `/api/projects/:id`     | Atualiza projeto. Body: `{ name?, slug?, clone_url?, default_branch? }`. Retorna o projeto atualizado; 404 se não existir. |
| DELETE | `/api/projects/:id`     | Remove projeto. 409 se houver tarefas vinculadas (ou 400 com mensagem clara); 204 sem body em sucesso. |

Regras de validação:

- **POST**: `name` obrigatório; `slug` único; se `slug` vazio/omitido, gerar a partir de `name` (normalizar para URL-safe).
- **PUT**: não permitir trocar `slug` para um já existente em outro projeto.

---

## 3. Alterações em POST/GET `/api/tasks` (e listagem por projeto)

### 3.1 POST `/api/tasks`

- **Body** deve aceitar **`project_id`** (obrigatório após T4, ou default para o único projeto existente em transição).
- Payload: `{ title, body?, status?, context?, project_id }`.
- Validação: `project_id` deve existir em `projects`; caso contrário 400.
- Referência: [backend/src/server/index.js](backend/src/server/index.js) (handler de `POST /api/tasks`), [backend/src/tasks/taskService.js](backend/src/tasks/taskService.js) (`createTask`), repositório de tarefas (insert com `project_id`).

### 3.2 GET `/api/tasks`

- **Query** aceitar **`project_id`** (opcional).
- Ex.: `GET /api/tasks?project_id=123` retorna apenas tarefas do projeto 123.
- Sem `project_id`: retornar tarefas de todos os projetos (comportamento atual de listagem global).
- Referência: [backend/src/server/index.js](backend/src/server/index.js) (handler `GET /api/tasks`), [backend/src/tasks/taskService.js](backend/src/tasks/taskService.js) (`listTasks`), repositório de tarefas (`list`/`listByProjectId`).

### 3.3 GET `/api/tasks/:id`

- Sem mudança de contrato; a tarefa retornada já inclui `project_id` (metadado). Garantir que o DTO da tarefa exponha `project_id`.

### 3.4 PUT `/api/tasks/:id`

- Opcionalmente permitir **`project_id`** no body para mover tarefa de projeto (validar existência do projeto destino). Pode ficar como melhoria posterior; o mínimo é criar/lista com `project_id`.

---

## 4. Checklist de tarefas (com referências)

- [ ] **Migration**: criar tabela `projects` e adicionar `project_id` em `tasks` (com projeto default e NOT NULL + FK).  
  - Ref.: módulo de migrations Postgres (T1); schema em `docs/plans/01-postgres-migration.md` ou equivalente.

- [ ] **Repositório de projetos**: implementar `projectRepo` (ou `createProjectRepository`) com: `list()`, `getById(id)`, `insert({ name, slug, clone_url?, default_branch? })`, `update(id, fields)`, `delete(id)`, e opcionalmente `getBySlug(slug)`.  
  - Ref.: [backend/src/tasks/repositories.js](backend/src/tasks/repositories.js) (padrão de factories); novo arquivo em `backend/src/data/postgres/` ou em `backend/src/tasks/` conforme estrutura pós-T2.

- [ ] **Task meta repository**: estender contrato para incluir `project_id` em `insert` e `list(filters?)` (ex.: `list({ projectId })`).  
  - Ref.: [backend/src/tasks/repositories.js](backend/src/tasks/repositories.js) (`createTaskMetaRepository`), [backend/src/tasks/db.js](backend/src/tasks/db.js) ou repositório Postgres de tasks (T2).

- [ ] **TaskService**: em `createTask`, aceitar `project_id` e repassar ao meta repo; em `listTasks`, aceitar opcional `projectId` e repassar ao meta repo.  
  - Ref.: [backend/src/tasks/taskService.js](backend/src/tasks/taskService.js).

- [ ] **Composition root (tasks)**: registrar `projectRepo` e passar ao service ou rotas que precisem; garantir que `listTasks(projectId?)` e `createTask(..., project_id)` estejam disponíveis.  
  - Ref.: [backend/src/tasks/index.js](backend/src/tasks/index.js).

- [ ] **Servidor API**: rotas GET/POST `/api/projects` e GET/PUT/DELETE `/api/projects/:id`; em POST/GET `/api/tasks`, ler `project_id` do body ou query e repassar ao service.  
  - Ref.: [backend/src/server/index.js](backend/src/server/index.js).

- [ ] **Validação**: POST projects (name obrigatório, slug único); POST tasks (project_id obrigatório e existente); DELETE project (409 se houver tasks).  
  - Ref.: handlers em [backend/src/server/index.js](backend/src/server/index.js) ou middleware/validators.

- [ ] **Testes**: testes de API para CRUD de projetos e para listagem/criação de tarefas com `project_id`.  
  - Ref.: [backend/test/server/api.test.js](backend/test/server/api.test.js); testes de repositório se houver em `backend/test/`.

---

## 5. Resumo e dependências

| Item | Descrição |
|------|-----------|
| **Schema** | Tabela `projects` (id, name, slug, clone_url, default_branch, created_at, updated_at); `tasks.project_id` NOT NULL FK. |
| **API Projects** | GET/POST `/api/projects`, GET/PUT/DELETE `/api/projects/:id`. |
| **API Tasks** | POST aceita `project_id` no body; GET aceita `project_id` na query para filtrar por projeto. |
| **Arquivos impactados** | Migrations, project repo, task meta repo, [backend/src/tasks/taskService.js](backend/src/tasks/taskService.js), [backend/src/tasks/index.js](backend/src/tasks/index.js), [backend/src/server/index.js](backend/src/server/index.js). |

**Dependências de outros to-dos**:

- **T1** (schema Postgres e migrations): necessário para criar tabela `projects` e coluna `tasks.project_id` no próprio schema Postgres.
- **T2** (repositórios Postgres): necessário para implementar `projectRepo` e estender task meta repo com `project_id` e filtro por projeto.
- **T3** (wiring no composition root e remoção de SQLite/arquivos): necessário para que a API e o worker usem apenas Postgres; T4 integra projetos nesse contexto.

Sem T1/T2/T3 concluídos, é possível apenas **documentar** e **especificar** as mudanças (como neste plano); a implementação efetiva deve seguir após a migração para Postgres.

---

## 6. Frontend (T5): seletor de projeto e board por projeto

Esta seção descreve as alterações no frontend para suportar **projeto** na tarefa e **listagem/board filtrada por projeto**. Depende do **T4** concluído (API `GET /api/projects`, `project_id` em POST/GET tasks).

### 6.1 Seletor de projeto ao criar/editar tarefa

- **Campo**: `project_id` (obrigatório na criação; exibido e editável na edição).
- **Fonte de dados**: lista de projetos via **`GET /api/projects`** (retorno: array com `id`, `name`, `slug`, etc.).
- **Onde**: formulário de criar/editar tarefa (modal) — [frontend/src/features/tasks/TaskFormOverlay.jsx](frontend/src/features/tasks/TaskFormOverlay.jsx).
- **Comportamento**:
  - **Criar**: usuário escolhe o projeto no select; valor enviado no body de `POST /api/tasks` como `project_id`.
  - **Editar**: carregar `task.project_id` do GET da tarefa; permitir alterar projeto (se a API aceitar `project_id` no `PUT /api/tasks/:id`).
- **Default**: se houver um único projeto, pode-se pré-selecionar; caso contrário exibir placeholder "Selecione o projeto".

### 6.2 Listagem/board por projeto

- **API**: **`GET /api/tasks?project_id=<id>`** — filtrar tarefas por projeto (conforme seção 3.2). Sem `project_id`: listar todas (comportamento "Todos os projetos").
- **UI**: uma das opções (escolher conforme UX):
  - **Dropdown no AppBar**: select "Projeto: [Todos | Projeto A | Projeto B | …]"; ao mudar, refetch de `getTasks` com o `project_id` selecionado (ou sem parâmetro para "Todos").
  - **Tabs**: uma tab "Todos" + uma tab por projeto; ao clicar na tab, filtrar lista pelo projeto.
  - **Combo**: dropdown com opção "Todos os projetos" no topo e depois a lista de projetos.
- **Onde**: [frontend/src/features/tasks/Board.jsx](frontend/src/features/tasks/Board.jsx) — componente que hoje chama `useGetTasksQuery()` sem argumentos; precisa passar o `project_id` selecionado (estado local ou URL, ex.: `?project=slug`).
- **Estado do filtro**: manter em estado local (useState) no Board ou em slice Redux; opcionalmente refletir na URL (ex.: `/projects/:slug` ou `/?project_id=123`) para deep link e compartilhamento.

### 6.3 Checklist de alterações (Frontend)

| # | Item | Arquivo(s) / referência |
|---|------|-------------------------|
| 1 | **API: projects** — endpoint `getProjects` e tag para cache | [frontend/src/app/api/tasksApi.js](frontend/src/app/api/tasksApi.js) (ou novo `projectsApi.js`; se manter em tasksApi, adicionar `getProjects`, tag `ProjectList`) |
| 2 | **getTasks com filtro** — `getTasks(projectId?)` com query `?project_id=...` quando informado | [frontend/src/app/api/tasksApi.js](frontend/src/app/api/tasksApi.js) — alterar `getTasks` para aceitar um argumento (ex.: `projectId`) e montar `query: (projectId) => ({ url: '/api/tasks', params: projectId ? { project_id: projectId } : {} })`; ajustar `providesTags` para incluir o projectId na chave do cache |
| 3 | **createTask / updateTask** — enviar `project_id` no body; createTask invalidar listas do projeto e/ou LIST | [frontend/src/app/api/tasksApi.js](frontend/src/app/api/tasksApi.js) — mutations; garantir que o payload de create inclua `project_id`; update pode incluir `project_id` se a API aceitar |
| 4 | **Hook useTaskForm** — estado `projectId`, setter, valor inicial a partir de `task.project_id`; reset no "criar" (ex.: projeto default ou vazio); enviar no payload | [frontend/src/features/tasks/useTaskForm.js](frontend/src/features/tasks/useTaskForm.js) |
| 5 | **TaskFormOverlay** — Select de projeto (lista vinda de getProjects); binding com projectId do useTaskForm; label "Projeto" | [frontend/src/features/tasks/TaskFormOverlay.jsx](frontend/src/features/tasks/TaskFormOverlay.jsx) |
| 6 | **Board** — estado "projeto selecionado" (id ou "all"); dropdown/tabs com lista de projetos + "Todos"; passar projectId para `useGetTasksQuery(projectId)` | [frontend/src/features/tasks/Board.jsx](frontend/src/features/tasks/Board.jsx) |
| 7 | **TaskDetailOverlay** — exibir nome do projeto da tarefa (opcional: chip ou texto; pode usar getTask que já retorna `project_id`, e lista de projetos para mostrar o nome) | [frontend/src/features/tasks/TaskDetailOverlay.jsx](frontend/src/features/tasks/TaskDetailOverlay.jsx) |
| 8 | **Store** — se usar slice para projeto atual: criar slice `currentProject` ou manter apenas estado no Board; store já registra tasksApi | [frontend/src/app/store.js](frontend/src/app/store.js) (só se optar por estado global do projeto) |

Resumo de arquivos impactados: **tasksApi.js**, **useTaskForm.js**, **TaskFormOverlay.jsx**, **Board.jsx**, **TaskDetailOverlay.jsx** (opcional exibição), **store.js** (opcional).

### 6.4 Dependência do T4

- **GET /api/projects**: obrigatório para popular o seletor de projetos.
- **POST /api/tasks** com `project_id` no body e **GET /api/tasks?project_id=** para filtro: obrigatórios para criar tarefa com projeto e listar por projeto.
- **GET /api/tasks/:id** e **PUT /api/tasks/:id** retornando/aceitando `project_id`: necessários para edição e exibição no detalhe.
