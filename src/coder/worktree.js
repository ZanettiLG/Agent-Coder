/**
 * Git worktree para execução isolada do agente por tarefa.
 * Cria worktree antes de rodar a tarefa; em sucesso faz merge e remove;
 * em falha apenas remove worktree e branch.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("node:child_process");

const BRANCH_PREFIX = "agent/task-";

function getWorktreeBranchName(taskId) {
  return `${BRANCH_PREFIX}${taskId}`;
}

function ensureIsGitRepo(repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
}

function runGit(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: repoRoot,
    ...options,
  });
}

/**
 * Executa comando git com argumentos entre aspas para o shell.
 * Caminhos com espaços (ex.: "Agent Coder") não são partidos; evita
 * "fatal: invalid reference: Coder/..." quando o path contém espaço.
 */
function runGitQuoted(repoRoot, ...args) {
  const quoted = args.map((a) => (typeof a === "string" ? JSON.stringify(a) : String(a)));
  return execSync(["git", ...quoted].join(" "), { encoding: "utf8", cwd: repoRoot });
}

function isWorktreePath(repoRoot, worktreePath) {
  try {
    const out = runGit(repoRoot, ["worktree", "list", "--porcelain"]);
    return out.split("\n").some((line) => {
      const match = line.match(/^worktree\s+(.+)/);
      return match && path.resolve(match[1].trim()) === path.resolve(worktreePath);
    });
  } catch (_) {
    return false;
  }
}

/**
 * Cria um git worktree em worktreePath com branch agent/task-{taskId} a partir do HEAD do repo.
 * Se o path já existir (worktree ou dir comum), remove antes de criar.
 * @param {string} repoRoot - Raiz do repositório git (absoluto)
 * @param {string} worktreePath - Caminho onde o worktree será criado (absoluto)
 * @param {number|string} taskId - ID da tarefa
 * @returns {string} worktreePath resolvido
 */
function createWorktree(repoRoot, worktreePath, taskId) {
  const root = path.resolve(repoRoot);
  const wtPath = path.resolve(worktreePath);
  ensureIsGitRepo(root);

  const branchName = getWorktreeBranchName(taskId);

  if (fs.existsSync(wtPath)) {
    if (isWorktreePath(root, wtPath)) {
      runGitQuoted(root, "worktree", "remove", "--force", wtPath);
    } else {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
  }

  runGitQuoted(root, "worktree", "add", wtPath, "-b", branchName);
  return wtPath;
}

/**
 * Faz commit das alterações no worktree (se houver), merge da branch no repo principal,
 * remove o worktree e deleta a branch.
 * @param {string} repoRoot - Raiz do repositório
 * @param {string} worktreePath - Caminho do worktree
 * @param {number|string} taskId - ID da tarefa
 */
function mergeWorktree(repoRoot, worktreePath, taskId) {
  const root = path.resolve(repoRoot);
  const wtPath = path.resolve(worktreePath);
  const branchName = getWorktreeBranchName(taskId);

  if (!fs.existsSync(wtPath)) return;

  try {
    const status = runGit(wtPath, ["status", "--porcelain"]).trim();
    if (status) {
      runGit(wtPath, ["add", "-A"]);
      runGit(wtPath, ["commit", "-m", `Agent task ${taskId}`]);
    }
  } catch (_) {
    // Nada para commitar ou já commitado
  }

  runGit(root, ["merge", branchName, "--no-edit"]);
  runGitQuoted(root, "worktree", "remove", wtPath);
  runGit(root, ["branch", "-d", branchName]);
}

/**
 * Remove o worktree (--force) e deleta a branch (-D).
 * Usado quando a tarefa falha ou é rejeitada.
 * @param {string} repoRoot - Raiz do repositório
 * @param {string} worktreePath - Caminho do worktree
 * @param {number|string} taskId - ID da tarefa
 */
function removeWorktree(repoRoot, worktreePath, taskId) {
  const root = path.resolve(repoRoot);
  const wtPath = path.resolve(worktreePath);
  const branchName = getWorktreeBranchName(taskId);

  try {
    if (isWorktreePath(root, wtPath)) {
      runGitQuoted(root, "worktree", "remove", "--force", wtPath);
    } else if (fs.existsSync(wtPath)) {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
  } catch (_) {}

  try {
    runGit(root, ["branch", "-D", branchName]);
  } catch (_) {
    // Branch pode já não existir
  }
}

module.exports = {
  getWorktreeBranchName,
  createWorktree,
  mergeWorktree,
  removeWorktree,
  ensureIsGitRepo,
};
