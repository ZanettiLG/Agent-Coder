const { execSync } = require("node:child_process");
const path = require("path");
require("dotenv").config();

const tasks = require("../tasks");
const { createCoder } = require("../coder");
const { createWorktree, mergeWorktree, removeWorktree, findGitRoot } = require("../coder/worktree");
const { cursorApiKey } = require("../config");
const { logInfo, logError, getRecentLogLines } = require("./logger");
const { createNotifier } = require("./notifier");
const { createTaskProcessor } = require("./taskProcessor");

const POLL_MS = Number(process.env.WORKER_POLL_MS) || 5000;
const SERVER_URL =
  process.env.SERVER_URL ||
  `http://localhost:${Number(process.env.PORT) || 3000}`;

const projectId = process.env.PROJECT_ID != null && process.env.PROJECT_ID !== ""
  ? Number(process.env.PROJECT_ID)
  : undefined;

const writeStatus = process.env.DATABASE_URL
  ? require("../data/postgres/workerStatus").writeStatus
  : require("./workerStatus").writeStatus;

function isAgentInPath() {
  try {
    execSync("which agent", { encoding: "utf8" });
    return true;
  } catch (_) {
    return false;
  }
}

const repoRoot = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : findGitRoot(process.cwd());

function getWorkspacePathForTask(taskId) {
  return path.join(repoRoot, "tasks", "workspaces", String(taskId));
}

const notifier = createNotifier(SERVER_URL, (id) => tasks.getTask(id), logError);
const taskProcessor = createTaskProcessor({
  taskService: tasks,
  createCoder,
  worktree: { createWorktree, mergeWorktree, removeWorktree },
  notifier,
  logger: { logInfo, logError, getRecentLogLines },
  writeStatus,
  cursorApiKey,
  isAgentInPath,
  getWorkspacePath: getWorkspacePathForTask,
  repoRoot,
  projectId,
});

async function run() {
  if (process.env.DATABASE_URL) {
    await tasks.getTaskService();
  }

  const useQueue = process.env.DATABASE_URL && projectId != null;

  if (useQueue) {
    const queue = require("../queue/pgboss");
    await queue.start();
    await queue.workAgentTasks(projectId, async ({ taskId }) => {
      await taskProcessor.processTaskById(taskId).catch((err) => {
        logError("processTaskById threw", err);
      });
    });
    logInfo(`Listening for jobs on queue agent-tasks:${projectId} (project ${projectId})`);
  } else {
    logInfo(`Listening for queued tasks (poll every ${POLL_MS} ms)`);
    setInterval(() => {
      taskProcessor.processNextTask().catch((err) => {
        logError("setInterval processNextTask threw", err);
      });
    }, POLL_MS);
    taskProcessor.processNextTask().catch((err) => {
      logError("initial processNextTask threw", err);
    });
  }
}

run().catch((err) => {
  logError("worker run failed", err);
  process.exit(1);
});
