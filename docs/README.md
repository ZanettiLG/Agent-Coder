# Documentação – Agent Coder

Índice da documentação por assunto. Para referência técnica completa (estrutura, API, convenções, variáveis de ambiente, deploy), use **AGENTS.md** na raiz do projeto.

| Arquivo | Assunto |
|---------|---------|
| [01-produto.md](01-produto.md) | Escopo, direcionamento e visibilidade do agente (pipeline, log, decisões de produto). |
| [02-jornada-usuario.md](02-jornada-usuario.md) | Jornada do usuário: board Kanban, cenários, regras de UX, fluxo; nota sobre legado (lista). |
| [03-arquitetura.md](03-arquitetura.md) | Stack, arquitetura alvo (Postgres, pg-boss, workers por projeto), deploy e referências. |
| [04-ux-acessibilidade.md](04-ux-acessibilidade.md) | Responsividade do board e recomendações de acessibilidade. |
| [05-roadmap.md](05-roadmap.md) | Itens concluídos e próximos passos. |

### Planos de implementação (escala horizontal)

Planos modulares do “Escala horizontal e worker desacoplado” (Postgres, projetos, fila pg-boss, worker por projeto, API multi-instância):

| Plano | Assunto |
|-------|---------|
| [plans/01-postgres-migration.md](plans/01-postgres-migration.md) | Schema Postgres, migrations, repositórios (T1–T3). |
| [plans/02-projects-entity.md](plans/02-projects-entity.md) | Projetos como entidade, API CRUD, filtro por projeto, frontend (T4–T5). |
| [plans/03-queue-pgboss.md](plans/03-queue-pgboss.md) | Fila pg-boss por projeto, enqueueTask e worker consumindo da fila (T6). |
| [plans/04-worker-client.md](plans/04-worker-client.md) | Worker desacoplado: PROJECT_ID, REPO_ROOT, heartbeats em DB (T7). |
| [plans/05-api-realtime.md](plans/05-api-realtime.md) | Socket.IO Redis adapter, GET /api/repo/files por project_id (T8). |
