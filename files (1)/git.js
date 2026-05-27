/**
 * services/git.js
 * ───────────────
 * All Git operations: init, clone, commit, log, diff, branch.
 * Uses simple-git under the hood.
 */
import simpleGit from 'simple-git';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { config } from 'dotenv';

config();

const REPOS_DIR = process.env.REPOS_DIR || path.join(process.cwd(), 'repos');

// Ensure repos directory exists
await fs.ensureDir(REPOS_DIR);

/**
 * Get or create a git instance for a repo.
 */
function getGit(repoId) {
  const repoPath = path.join(REPOS_DIR, repoId);
  return simpleGit(repoPath);
}

/**
 * Get the filesystem path of a repo.
 */
export function getRepoPath(repoId) {
  return path.join(REPOS_DIR, repoId);
}

/**
 * Create a new local git repository.
 */
export async function createRepo({ name, description = '', authorName, authorEmail }) {
  const repoId = uuid();
  const repoPath = path.join(REPOS_DIR, repoId);

  await fs.ensureDir(repoPath);

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.name',  authorName  || 'GitEditor User');
  await git.addConfig('user.email', authorEmail || 'user@giteditor.local');

  // Create initial document structure
  const initialDoc = {
    document_metadata: {
      title: name,
      description,
      created_at: new Date().toISOString(),
      version: '1.0.0',
    },
    content: [],
  };

  const docPath = path.join(repoPath, 'document.json');
  await fs.writeJSON(docPath, initialDoc, { spaces: 2 });

  // README
  await fs.writeFile(
    path.join(repoPath, 'README.md'),
    `# ${name}\n\n${description}\n\nManaged by GitEditor.\n`
  );

  await git.add('.');
  await git.commit(`Initial commit: create document "${name}"`);

  return {
    id: repoId,
    name,
    description,
    path: repoPath,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Clone a remote repository.
 */
export async function cloneRepo({ url, authorName, authorEmail }) {
  const repoId = uuid();
  const repoPath = path.join(REPOS_DIR, repoId);

  await fs.ensureDir(repoPath);

  const git = simpleGit();
  await git.clone(url, repoPath);

  const localGit = simpleGit(repoPath);
  await localGit.addConfig('user.name',  authorName  || 'GitEditor User');
  await localGit.addConfig('user.email', authorEmail || 'user@giteditor.local');

  // Get repo name from URL
  const name = url.split('/').pop().replace('.git', '');

  return {
    id: repoId,
    name,
    path: repoPath,
    clonedFrom: url,
    createdAt: new Date().toISOString(),
  };
}

/**
 * List all local repos.
 */
export async function listRepos() {
  const entries = await fs.readdir(REPOS_DIR);
  const repos = [];

  for (const entry of entries) {
    const repoPath = path.join(REPOS_DIR, entry);
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) continue;

    try {
      const git = simpleGit(repoPath);
      const log = await git.log(['--max-count=1']);
      const docPath = path.join(repoPath, 'document.json');
      const doc = await fs.readJSON(docPath).catch(() => null);

      repos.push({
        id: entry,
        name: doc?.document_metadata?.title || entry,
        description: doc?.document_metadata?.description || '',
        lastCommit: log.latest ? {
          hash:    log.latest.hash.slice(0, 7),
          message: log.latest.message,
          date:    log.latest.date,
          author:  log.latest.author_name,
        } : null,
      });
    } catch {
      // Skip invalid repos
    }
  }

  return repos;
}

/**
 * Delete a repo.
 */
export async function deleteRepo(repoId) {
  const repoPath = path.join(REPOS_DIR, repoId);
  await fs.remove(repoPath);
}

/**
 * Read the document.json from a repo.
 */
export async function readDocument(repoId) {
  const repoPath = getRepoPath(repoId);
  const docPath = path.join(repoPath, 'document.json');
  return fs.readJSON(docPath);
}

/**
 * Save the document and commit to git.
 */
export async function saveAndCommit(repoId, document, { message, authorName, authorEmail }) {
  const repoPath = getRepoPath(repoId);
  const docPath = path.join(repoPath, 'document.json');

  // Update metadata
  document.document_metadata = {
    ...document.document_metadata,
    updated_at: new Date().toISOString(),
  };

  await fs.writeJSON(docPath, document, { spaces: 2 });

  const git = getGit(repoId);

  // Configure author for this commit
  if (authorName)  await git.addConfig('user.name',  authorName);
  if (authorEmail) await git.addConfig('user.email', authorEmail);

  await git.add('document.json');

  const status = await git.status();
  if (status.staged.length === 0) {
    return { committed: false, reason: 'No changes to commit' };
  }

  const commitMsg = message || `Update document — ${new Date().toLocaleString()}`;
  const result = await git.commit(commitMsg);

  return {
    committed: true,
    hash: result.commit,
    message: commitMsg,
    author: authorName,
  };
}

/**
 * Get the full commit history.
 */
export async function getHistory(repoId, { maxCount = 50 } = {}) {
  const git = getGit(repoId);
  const log = await git.log([`--max-count=${maxCount}`]);

  return log.all.map(c => ({
    hash:      c.hash,
    shortHash: c.hash.slice(0, 7),
    message:   c.message,
    author:    c.author_name,
    email:     c.author_email,
    date:      c.date,
  }));
}

/**
 * Get the document at a specific commit.
 */
export async function getDocumentAtCommit(repoId, commitHash) {
  const git = getGit(repoId);
  const content = await git.show([`${commitHash}:document.json`]);
  return JSON.parse(content);
}

/**
 * Get diff between two commits (or HEAD vs working tree).
 */
export async function getDiff(repoId, fromHash, toHash = 'HEAD') {
  const git = getGit(repoId);

  let rawDiff;
  if (fromHash) {
    rawDiff = await git.diff([fromHash, toHash, '--', 'document.json']);
  } else {
    rawDiff = await git.diff(['HEAD', '--', 'document.json']);
  }

  return rawDiff;
}

/**
 * Get all branches.
 */
export async function getBranches(repoId) {
  const git = getGit(repoId);
  const result = await git.branch();
  return {
    current: result.current,
    all: result.all,
  };
}

/**
 * Create or switch branch.
 */
export async function switchBranch(repoId, branchName, create = false) {
  const git = getGit(repoId);
  if (create) {
    await git.checkoutLocalBranch(branchName);
  } else {
    await git.checkout(branchName);
  }
}

/**
 * Push to remote (if configured).
 */
export async function pushToRemote(repoId, remote = 'origin', branch = 'main') {
  const git = getGit(repoId);
  try {
    await git.push(remote, branch);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Add a remote URL to a repo.
 */
export async function addRemote(repoId, url, name = 'origin') {
  const git = getGit(repoId);
  await git.addRemote(name, url);
}

/**
 * Get git status.
 */
export async function getStatus(repoId) {
  const git = getGit(repoId);
  return git.status();
}
