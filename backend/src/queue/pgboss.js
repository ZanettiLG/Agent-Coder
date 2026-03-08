/**
 * pg-boss queue for agent tasks. One queue per project: agent-tasks:{projectId}.
 * Uses dynamic import because pg-boss is ESM. Only active when DATABASE_URL is set.
 */
let bossInstance = null;

function getQueueName(projectId) {
  return `agent-tasks:${projectId}`;
}

async function getBoss() {
  if (bossInstance) return bossInstance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const { default: PgBoss } = await import("pg-boss");
  const boss = new PgBoss(connectionString);
  await boss.start();
  bossInstance = boss;
  return boss;
}

async function start() {
  return getBoss();
}

async function stop() {
  if (bossInstance) {
    await bossInstance.stop();
    bossInstance = null;
  }
}

/**
 * Send a task to the project queue. Call after updating task status to queued.
 * @param {number} projectId
 * @param {number} taskId
 * @returns {Promise<string|null>} Job id or null if queue not available
 */
async function sendAgentTask(projectId, taskId) {
  const boss = await getBoss();
  if (!boss) return null;
  const queueName = getQueueName(projectId);
  return boss.send(queueName, { taskId, projectId });
}

/**
 * Subscribe to the project queue and run handler for each job.
 * @param {number} projectId
 * @param {(data: { taskId: number, projectId: number }) => Promise<void>} handler
 */
async function workAgentTasks(projectId, handler) {
  const boss = await getBoss();
  if (!boss) return;
  const queueName = getQueueName(projectId);
  await boss.work(queueName, async (job) => {
    const { taskId, projectId: pId } = job.data || {};
    if (taskId != null) await handler({ taskId, projectId: pId ?? projectId });
  });
}

module.exports = { start, stop, sendAgentTask, workAgentTasks, getQueueName };
