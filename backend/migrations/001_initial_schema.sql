-- Migration 001: initial Postgres schema for Agent Coder
-- Replaces SQLite (tasks, task_comments) + files (body, agent.log, worker-status.json).
-- See docs/plans/01-postgres-migration.md for full documentation.

BEGIN;

-- Control table for versioned migrations (run once before applying migrations)
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 1. Projects (first-class entity; tasks belong to a project)
CREATE TABLE projects (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT UNIQUE,
  clone_url      TEXT,
  default_branch TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_projects_slug ON projects(slug) WHERE slug IS NOT NULL;

-- 2. Tasks (meta + body; project_id NOT NULL)
CREATE TABLE tasks (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','queued','in_progress','done','rejected')),
  body           TEXT NOT NULL DEFAULT '',
  failure_reason TEXT,
  context        JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX idx_tasks_queued ON tasks(project_id, id) WHERE status = 'queued';

-- 3. Task comments
CREATE TABLE task_comments (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author     TEXT NOT NULL DEFAULT 'user' CHECK (author IN ('user','agent')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);

-- 4. Task log events (replaces NDJSON files per task)
CREATE TABLE task_log_events (
  id         BIGSERIAL PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  event_type TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_task_log_events_task_id_at ON task_log_events(task_id, at ASC);

-- 5. Worker heartbeats (replaces worker-status.json)
CREATE TABLE worker_heartbeats (
  worker_id         TEXT PRIMARY KEY,
  project_id        BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  last_poll_at      TIMESTAMPTZ,
  last_task_id      BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  last_task_status  TEXT,
  last_task_at      TIMESTAMPTZ,
  last_error        TEXT,
  recent_log_lines  JSONB NOT NULL DEFAULT '[]',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_worker_heartbeats_project_id ON worker_heartbeats(project_id);
CREATE INDEX idx_worker_heartbeats_last_poll_at ON worker_heartbeats(last_poll_at);

-- Default project so existing/migrated tasks can reference project_id = 1
INSERT INTO projects (id, name, slug, updated_at) VALUES (1, 'Default', 'default', clock_timestamp())
  ON CONFLICT (id) DO NOTHING;

-- Optional: set sequence for projects if we want next id to be 2 (only if table was empty)
-- SELECT setval('projects_id_seq', (SELECT COALESCE(MAX(id), 1) FROM projects));

COMMIT;
