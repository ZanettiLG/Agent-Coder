# Roadmap e histórico de melhorias

Itens concluídos e próximos passos. Baseado em alinhamento doc ↔ implementação e melhorias de produto/UX.

**Última atualização:** Março 2026.

---

## 1. Concluído

### Documentação
- Jornada Kanban atualizada para 5 colunas; Rejeitada, Comentários, Progresso do agente e deep link descritos.
- Jornada lista com nota sobre 5 status (doc legado).
- Direcionamento do produto com `rejected` no pipeline e visibilidade de falha.
- Pesquisa frontend alinhada: rotas `/` e `/tasks/:id`; estrutura Board + overlays.

### Código
- Vista lista (TaskList, TaskDetail, TaskForm) removida; criação/edição apenas por overlay no Board.
- Board com 5 colunas documentado no código.

### Produto / UX
- Indicador do worker na UI (status ativo/inativo via `GET /api/worker/status`).
- Otimistic update no drag-and-drop ao mover card entre colunas.
- Feedback ao enfileirar: drawer fecha ao enfileirar com sucesso; cache/Socket atualizam a UI.
- Responsividade e acessibilidade documentadas em [04-ux-acessibilidade.md](04-ux-acessibilidade.md).

---

## 2. Próximos passos (sugestões)

- Testes de responsividade e acessibilidade em dispositivos reais; ajustes de ARIA/teclado conforme necessário.
- SSE (ou similar) para log do agente em tempo real, se polling não for suficiente.
- Outras prioridades a definir com o time/produto.

---

## 3. Referências

- Detalhes de UX e acessibilidade: [04-ux-acessibilidade.md](04-ux-acessibilidade.md).
- Jornada e cenários: [02-jornada-usuario.md](02-jornada-usuario.md).
