# Autopoieser

Aplicação de **tarefas** com conteúdo em Markdown e **fila de processos**: cada tarefa enfileirada é executada por uma thread do agente (Cursor) com contexto isolado.

## O que faz

- **CRUD de tarefas**: título, status e corpo em Markdown; metadados no SQLite, conteúdo em arquivos `.md` em `./tasks`.
- **Fila**: ao enfileirar uma tarefa (status `queued`), um **worker** consome a fila e roda o agente para essa tarefa, com workspace e “chat” próprios.
- **Frontend**: board **Kanban** (estilo Trello) com 5 colunas por status; cards arrastáveis entre colunas; detalhe e formulário em overlay (drawer/modal). Atualização em tempo real via Socket.IO. Criar, editar, excluir e enfileirar sem sair do board.

## Stack

| Camada    | Tecnologia                    |
|-----------|-------------------------------|
| Backend   | Node.js, Express              |
| Persistência | SQLite (metadados), `.md` em `./tasks` |
| Frontend  | React, Vite, MUI, Redux Toolkit, RTK Query, @dnd-kit (drag-and-drop) |
| Agente    | Integração com CLI do Cursor  |

## Pré-requisitos

- Node.js (recomendado LTS)
- Variável `CURSOR_API_KEY` configurada (para o worker executar o agente)

## Instalação

```bash
npm install
cd frontend && npm install && cd ..
```

## Variáveis de ambiente

Crie um arquivo `.env` na raiz:

```env
CURSOR_API_KEY=sua_chave_aqui
PORT=3000
WORKER_POLL_MS=5000
```

- `CURSOR_API_KEY` – obrigatória para o worker rodar o agente.
- `PORT` – porta do servidor Express (padrão 3000).
- `WORKER_POLL_MS` – intervalo de polling da fila em ms (padrão 5000).
- `SERVER_URL` – (opcional) URL do servidor para o worker notificar atualizações em tempo real (padrão `http://localhost:PORT`).

## Como rodar

### Desenvolvimento

1. **API** (um terminal):

   ```bash
   npm run server
   ```

   Servidor em `http://localhost:3000`.

2. **Frontend** (outro terminal):

   ```bash
   cd frontend && npm run dev
   ```

   Vite sobe com proxy `/api` → Express. Acesse a URL exibida no terminal (ex.: `http://localhost:5173`).

3. **Worker** (opcional, outro terminal) – para processar tarefas enfileiradas:

   ```bash
   npm run worker
   ```

### Produção

1. Build do frontend:

   ```bash
   npm run build:frontend
   ```

2. Subir servidor (serve a API e o build do frontend):

   ```bash
   npm start
   ```

3. Se quiser processar a fila, em outro processo:

   ```bash
   npm run worker
   ```

## Scripts (raiz)

| Comando | Descrição |
|---------|-----------|
| `npm start` / `npm run server` | Inicia o servidor Express (API + estáticos do frontend, se existir build). |
| `npm run worker` | Inicia o worker que consome a fila e executa o agente por tarefa. |
| `npm run build:frontend` | Gera o build do frontend em `frontend/dist`. |

## Status das tarefas

| Status        | Significado                          |
|---------------|--------------------------------------|
| `open`        | Aberta                               |
| `queued`      | Na fila (aguardando o worker)        |
| `in_progress` | Sendo processada pelo agente        |
| `done`        | Concluída                            |
| `rejected`    | Rejeitada (falha do agente; ver `failure_reason` no detalhe) |

No board: **clique** em um card para abrir o detalhe (drawer); **arraste** o card para outra coluna para mudar o status; use **Adicionar card** numa coluna para criar tarefa naquele status; no detalhe, use **Enfileirar** (se aberta), **Editar** ou **Excluir**. O link direto `/tasks/:id` abre o board com o detalhe dessa tarefa.

## Estrutura resumida

```
├── src/           # Backend: server, tasks, worker, coder
├── frontend/      # App React (Vite)
├── tasks/         # Arquivos .md das tarefas; workspaces em tasks/workspaces/
├── data/          # SQLite (não versionado)
├── docs/          # Documentação (jornada, pesquisa)
├── AGENTS.md      # Guia para agentes de código
└── package.json
```

## Documentação

- **AGENTS.md** – guia para agentes e referência técnica (estrutura, API, convenções).
- **docs/README.md** – índice da documentação por assunto.
- **docs/01-produto.md** – escopo, direcionamento e visibilidade do agente.
- **docs/02-jornada-usuario.md** – jornada do usuário (board Kanban + legado lista).
- **docs/03-arquitetura.md** – stack, decisões de frontend/backend.
- **docs/04-ux-acessibilidade.md** – responsividade e acessibilidade.
- **docs/05-roadmap.md** – itens concluídos e próximos passos.
