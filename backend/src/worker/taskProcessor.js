const { buildContextBlock } = require("../tasks/contextBuilder");

/**
 * TaskProcessor: runs one cycle of the queue (get next queued task → worktree → coder → merge/remove → notify).
 * All dependencies are injected for testability (DIP).
 *
 * @param {object} deps
 * @param {object} deps.taskService - createTask, getTask, listTasks, updateTask, deleteTask, enqueueTask, getNextQueued, appendEvent, getTaskLog, getTaskComments, addComment
 * @param {(options: object) => object} deps.createCoder
 * @param {{ createWorktree: function, mergeWorktree: function, removeWorktree: function }} deps.worktree
 * @param {{ notifyTaskUpdated: (taskId: number | string) => void }} deps.notifier
 * @param {{ logInfo: (msg: string) => void, logError: (msg: string, err?: Error) => void, getRecentLogLines: () => string[] }} deps.logger
 * @param {(update: object) => void} deps.writeStatus
 * @param {string | undefined} deps.cursorApiKey
 * @param {() => boolean} deps.isAgentInPath
 * @param {(taskId: number | string) => string} deps.getWorkspacePath
 * @param {string} deps.repoRoot
 * @param {string|number|null} [deps.projectId] - Optional project id for queue filtering (worker consumes only this project).
 */
function createTaskProcessor(deps) {
  const {
    taskService,
    createCoder,
    worktree,
    notifier,
    logger,
    writeStatus,
    cursorApiKey,
    isAgentInPath,
    getWorkspacePath,
    repoRoot,
    projectId,
  } = deps;

  async function runOneTask(task, startedAt) {
    try {
      logger.logInfo(`Processing task ${task.id}: ${task.title}`);
      await Promise.resolve(taskService.updateTask(task.id, { status: "in_progress" }));
      await Promise.resolve(taskService.appendEvent(task.id, { type: "worker_start", text: "Worker started task." }));
      await Promise.resolve(taskService.appendEvent(task.id, { type: "started", text: "Agent started." }));
      await notifier.notifyTaskUpdated(task.id);

      if (!isAgentInPath()) {
        logger.logError("Binary 'agent' not found in PATH");
        const msg = "Binary 'agent' not found in PATH";
        await Promise.resolve(taskService.appendEvent(task.id, { type: "error", text: msg }));
        await Promise.resolve(taskService.updateTask(task.id, { status: "rejected", failure_reason: msg }));
        await Promise.resolve(taskService.addComment(task.id, { author: "agent", content: msg }));
        await notifier.notifyTaskUpdated(task.id);
        await Promise.resolve(writeStatus({
          lastPollAt: new Date().toISOString(),
          lastTaskId: task.id,
          lastTaskStatus: "rejected",
          lastTaskAt: new Date().toISOString(),
          lastError: "Binary 'agent' not found in PATH",
          recentLogLines: logger.getRecentLogLines(),
        }));
        await Promise.resolve(taskService.appendEvent(task.id, { type: "worker_end", durationMs: Date.now() - startedAt }));
        return;
      }

      const workspacePath = getWorkspacePath(task.id);
      try {
        worktree.createWorktree(repoRoot, workspacePath, task.id);
      } catch (worktreeErr) {
        const msg = worktreeErr.message || "Failed to create git worktree";
        logger.logError("createWorktree failed", worktreeErr);
        await Promise.resolve(taskService.appendEvent(task.id, { type: "error", text: msg }));
        await Promise.resolve(taskService.updateTask(task.id, { status: "rejected", failure_reason: msg }));
        await Promise.resolve(taskService.addComment(task.id, { author: "agent", content: msg }));
        await notifier.notifyTaskUpdated(task.id);
        await Promise.resolve(writeStatus({
          lastPollAt: new Date().toISOString(),
          lastTaskId: task.id,
          lastTaskStatus: "rejected",
          lastTaskAt: new Date().toISOString(),
          lastError: msg,
          recentLogLines: logger.getRecentLogLines(),
        }));
        await Promise.resolve(taskService.appendEvent(task.id, { type: "worker_end", durationMs: Date.now() - startedAt }));
        return;
      }

      const coder = createCoder({ workspace: workspacePath, outputFormat: "stream" });
      const contextBlock = buildContextBlock(repoRoot, task.context || []);
      const bodyText = task.body?.trim() || task.title || "Execute this task.";
      const prompt = contextBlock ? contextBlock + bodyText : bodyText;

      if (typeof coder.command === "function") {
        const rawCmd = coder.command(prompt);
        const safeCmd = rawCmd.replace(/--api-key "[^"]*"/, '--api-key "***"');
        logger.logInfo(`Agent command (api-key redacted): ${safeCmd}`);
      }

      const callbacks = {
        onChunk(text) {
          Promise.resolve(taskService.appendEvent(task.id, { type: "chunk", text })).catch(() => {});
        },
        onDone(result) {
          Promise.resolve(taskService.appendEvent(task.id, { type: "done", result: result ?? null })).catch(() => {});
        },
      };

      const { response } = coder.code(prompt, callbacks);
      await response;
      const durationMs = Date.now() - startedAt;
      try {
        worktree.mergeWorktree(repoRoot, workspacePath, task.id);
      } catch (mergeErr) {
        logger.logError("mergeWorktree failed", mergeErr);
        await Promise.resolve(taskService.appendEvent(task.id, { type: "error", text: mergeErr.message }));
        worktree.removeWorktree(repoRoot, workspacePath, task.id);
        await Promise.resolve(taskService.updateTask(task.id, {
          status: "rejected",
          failure_reason: `Merge falhou: ${mergeErr.message}`,
        }));
        await Promise.resolve(taskService.addComment(task.id, { author: "agent", content: mergeErr.message }));
        await notifier.notifyTaskUpdated(task.id);
        await Promise.resolve(writeStatus({
          lastPollAt: new Date().toISOString(),
          lastTaskId: task.id,
          lastTaskStatus: "rejected",
          lastTaskAt: new Date().toISOString(),
          lastError: mergeErr.message,
          recentLogLines: logger.getRecentLogLines(),
        }));
        await Promise.resolve(taskService.appendEvent(task.id, { type: "worker_end", durationMs }));
        return;
      }
      await Promise.resolve(taskService.appendEvent(task.id, { type: "worker_end", durationMs }));
      await Promise.resolve(taskService.updateTask(task.id, { status: "done" }));
      await Promise.resolve(taskService.addComment(task.id, { author: "agent", content: "Tarefa concluída com sucesso." }));
      await notifier.notifyTaskUpdated(task.id);
      logger.logInfo(`Task ${task.id} done (${durationMs}ms).`);
      await Promise.resolve(writeStatus({
        lastPollAt: new Date().toISOString(),
        lastTaskId: task.id,
        lastTaskStatus: "done",
        lastTaskAt: new Date().toISOString(),
        recentLogLines: logger.getRecentLogLines(),
      }));
    } catch (err) {
      logger.logError("runOneTask error", err);
      const durationMs = Date.now() - startedAt;
      if (task && task.id) {
        const workspacePath = getWorkspacePath(task.id);
        try {
          worktree.removeWorktree(repoRoot, workspacePath, task.id);
        } catch (_) {}
        const stderrText = err.stderr ? String(err.stderr).trim().slice(0, 2000) : "";
        const stdoutText = err.stdout ? String(err.stdout).trim().slice(0, 2000) : "";
        const detail = stderrText || stdoutText;
        const displayMessage = detail
          ? `${err.message}${stderrText ? `\n\nStderr:\n${stderrText}` : ""}${stdoutText ? `\n\nStdout:\n${stdoutText}` : ""}`
          : err.message;
        const errorPayload = {
          type: "error",
          text: displayMessage,
          stack: err.stack,
        };
        if (stderrText) errorPayload.stderr = stderrText;
        if (stdoutText) errorPayload.stdout = stdoutText;
        await Promise.resolve(taskService.appendEvent(task.id, errorPayload));
        await Promise.resolve(taskService.appendEvent(task.id, { type: "worker_end", durationMs }));
        await Promise.resolve(taskService.updateTask(task.id, {
          status: "rejected",
          failure_reason: detail || err.message,
        }));
        await Promise.resolve(taskService.addComment(task.id, { author: "agent", content: detail || err.message }));
        await notifier.notifyTaskUpdated(task.id);
      }
      await Promise.resolve(writeStatus({
        lastPollAt: new Date().toISOString(),
        lastTaskId: task?.id ?? null,
        lastTaskStatus: "rejected",
        lastTaskAt: new Date().toISOString(),
        lastError: err.message,
        recentLogLines: logger.getRecentLogLines(),
      }));
    }
  }

  async function processNextTask() {
    await Promise.resolve(writeStatus({ lastPollAt: new Date().toISOString(), recentLogLines: logger.getRecentLogLines() }));
    if (!cursorApiKey) {
      logger.logInfo("CURSOR_API_KEY not set; agent runs will fail");
      return;
    }
    const task = await Promise.resolve(taskService.getNextQueued(projectId));
    if (!task) return;
    const startedAt = Date.now();
    await runOneTask(task, startedAt);
  }

  async function processTaskById(taskId) {
    await Promise.resolve(writeStatus({ lastPollAt: new Date().toISOString(), recentLogLines: logger.getRecentLogLines() }));
    if (!cursorApiKey) {
      logger.logInfo("CURSOR_API_KEY not set; agent runs will fail");
      return;
    }
    const task = await Promise.resolve(taskService.getTask(taskId));
    if (!task || task.status !== "queued") return;
    if (projectId != null && Number(task.project_id) !== Number(projectId)) return;
    const startedAt = Date.now();
    await runOneTask(task, startedAt);
  }

  return { processNextTask, processTaskById };
}

module.exports = { createTaskProcessor };
