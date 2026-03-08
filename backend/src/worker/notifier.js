/**
 * Notifier: sends task:updated broadcast to the server (Socket.IO via POST /api/internal/broadcast).
 * Injected getTask and serverUrl for testability.
 *
 * @param {string} serverUrl - Base URL of the API server (e.g. http://localhost:3000)
 * @param {(taskId: number | string) => object | null} getTask - Function to resolve task by id
 * @param {(message: string, err?: Error) => void} [logError] - Optional error logger
 * @returns {{ notifyTaskUpdated: (taskId: number | string) => void }}
 */
function createNotifier(serverUrl, getTask, logError = () => {}) {
  const baseUrl = serverUrl.replace(/\/$/, "");

  return {
    async notifyTaskUpdated(taskId) {
      const updated = await Promise.resolve(getTask(taskId));
      if (!updated) return;
      fetch(`${baseUrl}/api/internal/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "task:updated",
          data: { id: updated.id, task: updated },
        }),
      }).catch((err) => {
        logError("broadcast failed", err);
      });
    },
  };
}

module.exports = { createNotifier };
