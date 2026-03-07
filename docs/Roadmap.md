# Roadmap

Itens derivados do documento [melhorias-e-divergencias.md](melhorias-e-divergencias.md). Prioridade a definir com o time/produto.

---

## Documentação (alinhar doc ↔ implementação)

- [ ] **jornada-usuario-kanban.md:** Atualizar para 5 colunas; incluir Rejeitada em cenários, regras e fluxo; descrever Comentários, Progresso do agente e deep link.
- [ ] **jornada-usuario-tarefas.md:** Nota ou atualização sobre os 5 status (doc legado lista).
- [ ] **direcionamento-produto.md:** Incluir `rejected` no pipeline e na visibilidade (onde o usuário vê falha).
- [ ] **pesquisa-jornada-tarefas.md:** Alinhar rotas (`/`, `/tasks/:id`); explicar criação/edição por overlay; descrever estrutura real (Board + overlays) e marcar TaskList/TaskDetail/TaskForm como legado/não usados nas rotas.

---

## Produto / UX

- [ ] **Indicador do worker na UI:** Exibir no board (barra superior ou rodapé) status "Worker ativo" / "Worker inativo" via `GET /api/worker/status` (opcional: último processamento, último erro).
- [ ] **Otimistic update no drag-and-drop:** Ao mover card entre colunas, atualizar o cache RTK Query antes da resposta e reverter em caso de erro.
- [ ] **Feedback ao enfileirar:** Garantir que, ao clicar "Enfileirar" no detalhe, a UI reflita de imediato a mudança (invalidação/Socket.IO); considerar fechar o drawer ou destacar a mudança.
- [ ] **Responsividade e acessibilidade:** Testar board em viewport pequeno; documentar ou implementar melhorias (ARIA, teclado, drag por teclado).

---

## Referência

- Detalhes, impacto e checklist: [melhorias-e-divergencias.md](melhorias-e-divergencias.md).
