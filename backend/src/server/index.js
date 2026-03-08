const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const tasks = require("../tasks");
const config = require("../config");
const { createWorkerStatusReader, STATUS_FILE } = require("../worker/workerStatus");
const { findGitRoot } = require("../coder/worktree");
const { listRepoFiles } = require("./repoFiles");

function getWorkerStatusReader() {
  if (process.env.DATABASE_URL) {
    return require("../data/postgres/workerStatus").createWorkerStatusReader();
  }
  return createWorkerStatusReader(STATUS_FILE);
}

const app = express();
app.use(express.json());

function isLocalhost(req) {
  const addr = req.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::ffff:127.0.0.1" || addr === "::1";
}

app.get("/api/projects", async (_req, res) => {
  try {
    const list = await tasks.listProjects();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const project = await tasks.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Projeto não encontrado" });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, slug, clone_url, default_branch } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name é obrigatório" });
    }
    const id = await tasks.createProject({
      name: name.trim(),
      slug: slug != null ? String(slug).trim() || null : null,
      clone_url: clone_url != null ? String(clone_url).trim() || null : null,
      default_branch: default_branch != null ? String(default_branch).trim() || null : null,
    });
    const project = await tasks.getProject(id);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const existing = await tasks.getProject(req.params.id);
    if (!existing) return res.status(404).json({ error: "Projeto não encontrado" });
    const { name, slug, clone_url, default_branch } = req.body ?? {};
    await tasks.updateProject(req.params.id, {
      ...(name !== undefined && { name: typeof name === "string" ? name.trim() : existing.name }),
      ...(slug !== undefined && { slug: slug != null ? String(slug).trim() || null : null }),
      ...(clone_url !== undefined && { clone_url: clone_url != null ? String(clone_url).trim() || null : null }),
      ...(default_branch !== undefined && { default_branch: default_branch != null ? String(default_branch).trim() || null : null }),
    });
    const project = await tasks.getProject(req.params.id);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const existing = await tasks.getProject(req.params.id);
    if (!existing) return res.status(404).json({ error: "Projeto não encontrado" });
    await tasks.deleteProject(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks", async (req, res) => {
  try {
    const projectId = req.query.project_id != null && req.query.project_id !== ""
      ? Number(req.query.project_id)
      : undefined;
    const list = await tasks.listTasks(projectId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id", async (req, res) => {
  try {
    const task = await tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CONTEXT_TYPES = ["file", "folder", "codebase", "docs", "git", "skill", "rule"];

function normalizeContext(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((ref) => ref && typeof ref === "object" && typeof ref.type === "string")
    .map((ref) => {
      const { type, path, scope, name, url } = ref;
      const normalized = { type: String(type).toLowerCase() };
      if (CONTEXT_TYPES.includes(normalized.type)) {
        if (path != null) normalized.path = String(path);
        if (scope != null) normalized.scope = String(scope);
        if (name != null) normalized.name = String(name);
        if (url != null) normalized.url = String(url);
      }
      return normalized;
    })
    .filter((ref) => CONTEXT_TYPES.includes(ref.type));
}

app.post("/api/tasks", async (req, res) => {
  try {
    const { title, body, status, context, project_id } = req.body ?? {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title é obrigatório" });
    }
    const task = await tasks.createTask({
      title: title.trim(),
      body: typeof body === "string" ? body : "",
      status: status || "open",
      context: normalizeContext(context),
      project_id: project_id != null && project_id !== "" ? Number(project_id) : undefined,
    });
    res.status(201).json(task);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { title, body, status, failure_reason, context } = req.body ?? {};
    const task = await tasks.updateTask(req.params.id, {
      ...(title !== undefined && { title: typeof title === "string" ? title.trim() : "" }),
      ...(body !== undefined && { body: typeof body === "string" ? body : "" }),
      ...(status !== undefined && { status }),
      ...(failure_reason !== undefined && { failure_reason: typeof failure_reason === "string" ? failure_reason : null }),
      ...(context !== undefined && { context: normalizeContext(context) }),
    });
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    res.json(task);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const deleted = await tasks.deleteTask(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Tarefa não encontrada" });
    const id = Number(req.params.id);
    res.status(204).send();
    const io = req.app.get("io");
    if (io) io.emit("task:deleted", { id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/queue", async (req, res) => {
  try {
    const task = await tasks.enqueueTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    if (process.env.DATABASE_URL) {
      try {
        const queue = require("../queue/pgboss");
        await queue.sendAgentTask(task.project_id ?? 1, task.id);
      } catch (queueErr) {
        console.error("Queue send failed:", queueErr.message);
      }
    }
    res.json(task);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id/log", async (req, res) => {
  try {
    const task = await tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const lastParam = req.query.last;
    const options =
      lastParam != null && String(lastParam).trim() !== ""
        ? { last: Math.min(Math.max(1, parseInt(lastParam, 10) | 0), config.maxLogLines) }
        : undefined;
    const log = await tasks.getTaskLog(req.params.id, options);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id/comments", async (req, res) => {
  try {
    const task = await tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const comments = await tasks.getTaskComments(req.params.id);
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/comments", async (req, res) => {
  try {
    const task = await tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const { content, author } = req.body ?? {};
    const authorVal = author === "agent" ? "agent" : "user";
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content é obrigatório (string)" });
    }
    const comment = await tasks.addComment(req.params.id, {
      content: typeof content === "string" ? content : "",
      author: authorVal,
    });
    res.status(201).json(comment);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task: await tasks.getTask(task.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/worker/status", async (_req, res) => {
  try {
    if (process.env.DATABASE_URL) await tasks.getTaskService();
    const reader = getWorkerStatusReader();
    const data = await Promise.resolve(reader.read());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getRepoRootForProject(projectId) {
  if (projectId == null) return findGitRoot(process.cwd());
  const envKey = `PROJECT_ROOT_${projectId}`;
  const pathFromEnv = process.env[envKey];
  if (pathFromEnv && typeof pathFromEnv === "string") return pathFromEnv.trim();
  return findGitRoot(process.cwd());
}

app.get("/api/repo/files", (req, res) => {
  try {
    const projectIdParam = req.query.project_id;
    const projectId = projectIdParam != null && projectIdParam !== "" ? Number(projectIdParam) : null;
    const repoRoot = getRepoRootForProject(projectId);
    const subPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
    const entries = listRepoFiles(repoRoot, subPath || ".");
    res.json({ path: subPath || ".", entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/internal/broadcast", (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { event, data } = req.body ?? {};
  if (!event || typeof event !== "string") {
    return res.status(400).json({ error: "event is required" });
  }
  const io = req.app.get("io");
  if (io) io.emit(event, data);
  res.status(204).send();
});

const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
const publicDir = path.join(__dirname, "..", "..", "public");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  app.use(express.static(publicDir));
}

async function startServer(port = 3000, host = process.env.HOST || "0.0.0.0") {
  const server = http.createServer(app);
  const { Server } = require("socket.io");
  const io = new Server(server);
  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = await import("@socket.io/redis-adapter");
      const { createClient } = await import("redis");
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();
      await pubClient.connect();
      await subClient.connect();
      io.adapter(createAdapter(pubClient, subClient));
      console.log("Socket.IO using Redis adapter");
    } catch (err) {
      console.error("Redis adapter failed:", err.message);
    }
  }
  app.set("io", io);
  return server.listen(port, host, () => {
    console.log(`Servidor em http://localhost:${port} (rede: http://${host}:${port})`);
  });
}

module.exports = { app, startServer };
