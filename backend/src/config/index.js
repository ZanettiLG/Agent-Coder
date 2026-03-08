require("dotenv").config();

const maxLogLines = process.env.TASK_LOG_MAX_LINES != null
  ? Math.max(1, parseInt(process.env.TASK_LOG_MAX_LINES, 10) || 2000)
  : 2000;

module.exports = {
  cursorApiKey: process.env.CURSOR_API_KEY,
  maxLogLines,
};