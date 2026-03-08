const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const tasks = require("../tasks");
const config = require("../config");
const { createWorkerStatusReader, STATUS_FILE } = require("../worker/workerStatus");
const { findGitRoot } = require("../coder/worktree");
const { listRepoFiles } = require("./repoFiles");

const workerStatusReader = createWorkerStatusReader(STATUS_FILE);

const app = express();
app.use(express.json());

function isLocalhost(req) {
  const addr = req.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::ffff:127.0.0.1" || addr === "::1";
}

app.get("/api/tasks", (_req, res) => {
  try {
    const list = tasks.listTasks();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id", (req, res) => {
  try {
    const task = tasks.getTask(req.params.id);
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

app.post("/api/tasks", (req, res) => {
  try {
    const { title, body, status, context } = req.body ?? {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title é obrigatório" });
    }
    const task = tasks.createTask({
      title: title.trim(),
      body: typeof body === "string" ? body : "",
      status: status || "open",
      context: normalizeContext(context),
    });
    res.status(201).json(task);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", (req, res) => {
  try {
    const { title, body, status, failure_reason, context } = req.body ?? {};
    const task = tasks.updateTask(req.params.id, {
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

app.delete("/api/tasks/:id", (req, res) => {
  try {
    const deleted = tasks.deleteTask(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Tarefa não encontrada" });
    const id = Number(req.params.id);
    res.status(204).send();
    const io = req.app.get("io");
    if (io) io.emit("task:deleted", { id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/queue", (req, res) => {
  try {
    const task = tasks.enqueueTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    res.json(task);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id/log", (req, res) => {
  try {
    const task = tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const lastParam = req.query.last;
    const options =
      lastParam != null && String(lastParam).trim() !== ""
        ? { last: Math.min(Math.max(1, parseInt(lastParam, 10) | 0), config.maxLogLines) }
        : undefined;
    const log = tasks.getTaskLog(req.params.id, options);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id/comments", (req, res) => {
  try {
    const task = tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const comments = tasks.getTaskComments(req.params.id);
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks/:id/comments", (req, res) => {
  try {
    const task = tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada" });
    const { content, author } = req.body ?? {};
    const authorVal = author === "agent" ? "agent" : "user";
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content é obrigatório (string)" });
    }
    const comment = tasks.addComment(req.params.id, {
      content: typeof content === "string" ? content : "",
      author: authorVal,
    });
    res.status(201).json(comment);
    const io = req.app.get("io");
    if (io) io.emit("task:updated", { id: task.id, task: tasks.getTask(task.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/worker/status", (_req, res) => {
  try {
    res.json(workerStatusReader.read());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/repo/files", (req, res) => {
  try {
    const repoRoot = findGitRoot(process.cwd());
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

function startServer(port = 3000, host = process.env.HOST || "0.0.0.0") {
  const server = http.createServer(app);
  const { Server } = require("socket.io");
  const io = new Server(server);
  app.set("io", io);
  return server.listen(port, host, () => {
    console.log(`Servidor em http://localhost:${port} (rede: http://${host}:${port})`);
  });
}

module.exports = { app, startServer };
