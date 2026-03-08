# UX, responsividade e acessibilidade

Comportamento atual do board e recomendações para responsividade e acessibilidade.

---

## 1. Responsividade (estado atual)

- **Board:** Container com `overflowX: 'auto'`; colunas com `minWidth: 280px` e `flexShrink: 0`. Em viewports menores que a soma das colunas → **scroll horizontal**.
- **Colunas:** `maxHeight: calc(100vh - 120px)` e `overflowY: 'auto'` para scroll vertical quando há muitos cards.
- **Overlays:** MUI Drawer/modal adaptam ao viewport.

**Recomendação:** Validar em mobile/tablet; deixar óbvio que há mais conteúdo (ex.: sombra ou indicador de scroll).

---

## 2. Acessibilidade (recomendações)

- **ARIA:** Colunas e cards com `aria-label` ou `role="region"` e nome do status; botões "Adicionar card", "Enfileirar", "Editar", "Excluir" são nativos ou MUI com texto visível.
- **Foco:** Ao abrir/fechar overlays, foco no primeiro elemento interativo (ex.: título no formulário, botão fechar no detalhe). MUI costuma gerenciar trap de foco.
- **Teclado:** Navegação por Tab entre colunas e cards; drag-and-drop hoje não tem equivalente por teclado (alternativa: abrir detalhe e "Editar" para mudar status).
- **Contraste:** Chips e botões seguem tema MUI; garantir contraste em temas claro/escuro.

---

## 3. Referências

- Jornada e regras de UX: [02-jornada-usuario.md](02-jornada-usuario.md).
- Roadmap e melhorias: [05-roadmap.md](05-roadmap.md).
