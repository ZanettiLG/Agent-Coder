# Melhorias e divergências – Agent Coder

Documento de pesquisa que cruza a base de código e a documentação do projeto, sob a ótica do **usuário** e do **produto final**. Objetivo: expor divergências a corrigir e melhorias a considerar.

**Fontes cruzadas:** `docs/jornada-usuario-tarefas.md`, `docs/jornada-usuario-kanban.md`, `docs/direcionamento-produto.md`, `docs/pesquisa-jornada-tarefas.md`, `AGENTS.md`, `README.md`, código em `src/`, `frontend/src/`.

**Método:** Leitura da documentação de produto e jornadas do usuário; inspeção do backend (server, tasks, worker), frontend (Board, overlays, API) e AGENTS.md; cruzamento para identificar onde a doc está atrás do código, onde há lacunas de UX e onde o produto pode evoluir.

**Última revisão:** Março 2026 (validação contra código: rotas, status, componentes, API worker).

---

## 1. Resumo executivo

| Categoria | Quantidade | Ação sugerida |
|-----------|------------|---------------|
| Divergências doc ↔ implementação | 9 | Atualizar documentação ou código para alinhar |
| Melhorias de produto/UX | 5 | Avaliar prioridade e implementar |
| Documentação incompleta | 3 | Completar docs (jornada, roadmap) |

---

## 1.1 O que já está alinhado (doc ↔ código)

- **README.md:** Já descreve 5 colunas, 5 status (`open`, `queued`, `in_progress`, `done`, `rejected`), `failure_reason` no detalhe, deep link `/tasks/:id`, criação/edição por overlay e Socket.IO. Alinhado ao produto atual.
- **AGENTS.md:** API, status, worker, log por tarefa, comentários e `GET /api/worker/status` estão documentados; reflete a implementação.
- **Enfileirar por drag:** Arrastar card para "Na fila" chama `PUT` com `status: 'queued'`; comportamento documentado na jornada Kanban e implementado corretamente.
- **Board.jsx:** Comentário do componente atualizado para "5 colunas" (correção aplicada).

---

## 2. Divergências: documentação vs implementação

### 2.1 Número de colunas e status no board

| Onde | O que diz | Realidade no código |
|------|------------|----------------------|
| **jornada-usuario-kanban.md** | "4 colunas" (Aberta, Na fila, Em progresso, Concluída) | O board tem **5 colunas**: inclui **Rejeitada** (`rejected`). |
| **jornada-usuario-kanban.md** | "Colunas fixas: Aberta, Na fila, Em progresso, Concluída" | Falta listar **Rejeitada**. |
| **Board.jsx** (comentário) | "4 colunas por status" (antes) | Corrigido para 5 colunas; `STATUS_ORDER` e `groupTasksByStatus` usam 5 status. |

**Impacto para o usuário:** A jornada não descreve a coluna "Rejeitada" nem o que acontece quando uma tarefa falha (onde ela aparece, que informação ver no detalhe). O produto já entrega isso; a doc fica atrás.

**Recomendação:** Atualizar `jornada-usuario-kanban.md` para 5 colunas e incluir o status `rejected` em cenários, regras e fluxo. ~~Corrigir o comentário em `Board.jsx` para "5 colunas".~~ **(feito)**

---

### 2.2 Status na jornada “lista” (legado)

| Onde | O que diz | Realidade |
|------|------------|-----------|
| **jornada-usuario-tarefas.md** | Status: "Aberta / Em progresso / Concluída" (3) | O sistema tem 5 status: `open`, `queued`, `in_progress`, `done`, `rejected`. |

**Recomendação:** Ou marcar o doc como "legado (lista)" e acrescentar uma nota de que o pipeline atual tem 5 status, ou atualizar a tabela de etapas para refletir o pipeline completo (pelo menos em nota de rodapé).

---

### 2.3 Pipeline no direcionamento do produto

| Onde | O que diz | Realidade |
|------|------------|-----------|
| **direcionamento-produto.md** | Pipeline: "(open → queued → in_progress → done)" | Falta o estado **rejected** (tarefa falhou; worker/agente rejeita). |

**Recomendação:** Incluir `rejected` no fluxo e mencionar que o usuário vê a tarefa na coluna Rejeitada e o motivo em `failure_reason` no detalhe.

---

### 2.4 Rotas no frontend

| Onde | O que diz | Realidade no App |
|------|------------|-------------------|
| **pesquisa-jornada-tarefas.md** | Rotas: `/`, `/tasks/new`, `/tasks/:id`, `/tasks/:id/edit` | O `App.jsx` só define **`/`** e **`/tasks/:id`**. Não há `/tasks/new` nem `/tasks/:id/edit`. |

**Contexto:** Criação e edição são feitas por **overlay** (modal/drawer) no board, conforme a jornada Kanban. Ou seja, a implementação está alinhada à jornada Kanban, mas a pesquisa ainda descreve rotas de formulário dedicadas.

**Recomendação:** Atualizar `pesquisa-jornada-tarefas.md`: remover ou marcar como "não implementado" as rotas `/tasks/new` e `/tasks/:id/edit`, e deixar explícito que criação/edição são via overlay no board (conforme jornada Kanban).

---

### 2.5 Estrutura de componentes no frontend

| Onde | O que diz | Realidade no código |
|------|------------|----------------------|
| **pesquisa-jornada-tarefas.md** | "features/tasks/: TaskList.jsx, TaskDetail.jsx, TaskForm.jsx" | A aplicação **ativa** usa **Board.jsx**, Column, TaskCard, DraggableCard, **TaskDetailOverlay.jsx**, **TaskFormOverlay.jsx**. Os arquivos TaskList.jsx, TaskDetail.jsx e TaskForm.jsx existem no repositório mas **não são renderizados** por nenhuma rota do App (só há `/` e `/tasks/:id`, ambos com Board). |
| **TaskForm.jsx** (vista lista) | STATUS_OPTIONS com 4 valores | Faltam **rejected** nas opções do select; o backend e o Kanban usam 5 status. |

**Impacto para o usuário:** Nenhum direto (a UI usada é o Kanban). Para quem lê a pesquisa, a estrutura parece ser lista; na prática a entrada é sempre o board. Código morto ou vista lista desativada pode gerar confusão em manutenção.

**Recomendação:** Na pesquisa, descrever a estrutura real (Board + overlays) como principal e marcar TaskList/TaskDetail/TaskForm como "vista lista (legado, não usado nas rotas atuais)" ou removê-los do código se não houver plano de uso. Se a vista lista for mantida, incluir `rejected` em TaskForm.jsx.

---

### 2.6 Enfileirar por drag-and-drop

| Onde | O que diz | Realidade |
|------|------------|-----------|
| **jornada-usuario-kanban.md** | "Enfileirar: (2) arrastar card para a coluna 'Na fila'" | O board usa `STATUS_ORDER` e droppable por `status`; arrastar para a coluna "Na fila" chama `PUT /api/tasks/:id` com `status: 'queued'`. |

**Status:** Implementação **alinhada** à doc. Nenhuma correção necessária; serve como confirmação de que o comportamento está documentado.

---

## 3. Funcionalidades já implementadas não descritas na jornada Kanban

Estes pontos existem no produto mas não estão (ou estão pouco) descritos na jornada do usuário.

| Funcionalidade | Onde está | O que falta na doc |
|----------------|-----------|---------------------|
| **Coluna e fluxo Rejeitada** | Board, `statusLabels`, worker (status `rejected`) | Cenário: "Quando o agente falha, a tarefa vai para Rejeitada; no detalhe aparece o motivo (failure_reason)." |
| **Comentários na tarefa** | TaskDetailOverlay, API `GET/POST /api/tasks/:id/comments` | Cenário: usuário e agente podem comentar; comentário do agente ao concluir/rejeitar. |
| **Progresso do agente (log)** | TaskDetailOverlay, "Progresso do agente", `GET /api/tasks/:id/log`, polling quando `in_progress` | Jornada não descreve que no detalhe há seção de log em tempo (quase) real enquanto a tarefa está em progresso. |
| **Deep link** | App: rota `/tasks/:id` | Jornada Kanban menciona "deep link" em referências; vale deixar explícito na tabela de cenários: "Acessa /tasks/123 → board abre com detalhe da tarefa 123." |

**Recomendação:** Incluir na `jornada-usuario-kanban.md` uma seção ou linhas na tabela de cenários para: Rejeitada, Comentários, Progresso do agente e Deep link.

---

## 4. Melhorias de produto e UX

### 4.1 Visibilidade do worker (status “vivo”)

- **API:** `GET /api/worker/status` existe (alive, lastPollAt, lastTaskId, lastError, recentLogLines).
- **Frontend:** Nenhum componente chama essa API; o usuário não sabe se o worker está rodando ou parado.

**Sugestão:** Exibir no board (ex.: barra superior ou rodapé) um indicador do tipo "Worker ativo" / "Worker inativo" (e opcionalmente último processamento ou último erro), usando `GET /api/worker/status`. Decisão de produto: se queremos que o usuário veja isso na UI principal.

---

### 4.2 Otimistic update no drag-and-drop

- **Jornada:** "Otimistic update desejável" ao mover card.
- **Código:** No `handleDragEnd` do Board, o card só muda de coluna após o `updateTask` retornar com sucesso (sem atualização otimista).

**Sugestão:** Implementar optimistic update no `updateTask` (RTK Query: `onQueryStarted` atualizando o cache antes da resposta) e reverter em caso de erro, para o board parecer mais responsivo ao arrastar.

---

### 4.3 Feedback ao enfileirar (drawer)

- Ao clicar "Enfileirar" no detalhe, o drawer permanece aberto e o card continua aparecendo como "Aberta" até o cache ser invalidado (ou Socket.IO atualizar). O usuário pode não perceber imediatamente que a tarefa foi para "Na fila".

**Sugestão:** Invalidar cache da lista e da tarefa após `queueTask` (já invalida); opcionalmente fechar o drawer ou mostrar mensagem clara "Tarefa enfileirada" (já existe snackbar). Verificar se a invalidação + Socket.IO já deixam a UI consistente em tempo real; se não, considerar fechar o drawer ao enfileirar ou destacar visualmente a mudança de coluna.

---

### 4.4 Responsividade e acessibilidade

- **Jornada:** "Em mobile, scroll horizontal nas colunas."
- **Código:** Column usa `overflowY: 'auto'` e o board usa `overflowX: 'auto'`; não foi validado em mobile nem acessibilidade (ARIA, teclado).

**Sugestão:** Testar em viewport pequeno; documentar ou implementar melhorias de acessibilidade (drag-and-drop por teclado, labels, foco).

---

### 4.5 Roadmap e priorização

- **docs/Roadmap.md** está praticamente vazio.

**Sugestão:** Usar o presente documento como insumo para preencher o Roadmap (ex.: "Alinhar documentação às 5 colunas", "Visibilidade do worker na UI", "Otimistic update no board") e priorizar com o time/produto.

---

## 5. Checklist de correções recomendadas

### Documentação (fazer primeiro)

- [ ] **jornada-usuario-kanban.md:** Atualizar para 5 colunas; incluir Rejeitada em cenários, regras e fluxo; descrever Comentários, Progresso do agente e deep link.
- [ ] **jornada-usuario-tarefas.md:** Nota ou atualização sobre os 5 status (doc legado lista).
- [ ] **direcionamento-produto.md:** Incluir `rejected` no pipeline e na visibilidade (onde o usuário vê falha).
- [ ] **pesquisa-jornada-tarefas.md:** Alinhar rotas ao que existe (`/`, `/tasks/:id`); explicar criação/edição por overlay; descrever estrutura real (Board + overlays) e marcar TaskList/TaskDetail/TaskForm como legado/não usados nas rotas.

### Código (comentários e consistência)

- [x] **Board.jsx:** Alterar comentário "4 colunas" para "5 colunas". **(feito)**
- [ ] **TaskForm.jsx (vista lista):** Se a vista lista for mantida, adicionar status `rejected` em STATUS_OPTIONS para alinhar ao backend.

### Produto/UX (avaliar prioridade)

- [ ] Indicador de status do worker na UI (usando `GET /api/worker/status`).
- [ ] Otimistic update ao mover card entre colunas.
- [ ] Garantir feedback imediato ao enfileirar (drawer/cache/Socket).
- [ ] Testes de responsividade e acessibilidade; documentar no README ou em docs.
- [ ] Preencher **Roadmap.md** com itens deste documento.

---

## 6. Como usar este documento

- **Prioridade:** Corrigir primeiro as divergências de **documentação** (seção 5), para que novos leitores e agentes vejam a realidade do produto (5 colunas, 5 status, overlay, rejeitada, comentários, log).
- **Produto/UX:** As melhorias da seção 4 (worker na UI, optimistic update, feedback ao enfileirar, acessibilidade) devem ser priorizadas com o time; o **Roadmap.md** concentra os itens acionáveis.
- **Revisão periódica:** Ao alterar fluxos, status ou componentes, revalidar este documento (cruzamento doc ↔ código) e atualizar a data em "Última revisão".

---

## 7. Referências

- Jornada Kanban: [jornada-usuario-kanban.md](jornada-usuario-kanban.md)
- Jornada lista: [jornada-usuario-tarefas.md](jornada-usuario-tarefas.md)
- Direcionamento: [direcionamento-produto.md](direcionamento-produto.md)
- Pesquisa frontend: [pesquisa-jornada-tarefas.md](pesquisa-jornada-tarefas.md)
- Guia agentes: [AGENTS.md](../AGENTS.md)
- Roadmap (itens priorizáveis): [Roadmap.md](Roadmap.md)
