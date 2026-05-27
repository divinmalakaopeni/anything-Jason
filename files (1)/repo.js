/**
 * routes/repo.js
 * ───────────────
 * Repository management: create, clone, list, delete, history, branches.
 */
import { Router } from 'express';
import {
  createRepo, cloneRepo, listRepos, deleteRepo,
  getHistory, getDocumentAtCommit, getDiff,
  getBranches, switchBranch, pushToRemote, addRemote,
} from '../services/git.js';

const router = Router();

// List all repos
router.get('/', async (req, res) => {
  try {
    const repos = await listRepos();
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new repo
router.post('/create', async (req, res) => {
  try {
    const { name, description, authorName, authorEmail } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const repo = await createRepo({ name, description, authorName, authorEmail });
    res.status(201).json({ repo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clone a remote repo
router.post('/clone', async (req, res) => {
  try {
    const { url, authorName, authorEmail } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const repo = await cloneRepo({ url, authorName, authorEmail });
    res.status(201).json({ repo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a repo
router.delete('/:repoId', async (req, res) => {
  try {
    await deleteRepo(req.params.repoId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get commit history
router.get('/:repoId/history', async (req, res) => {
  try {
    const history = await getHistory(req.params.repoId, {
      maxCount: parseInt(req.query.limit) || 50,
    });
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get document at a specific commit
router.get('/:repoId/commit/:hash', async (req, res) => {
  try {
    const doc = await getDocumentAtCommit(req.params.repoId, req.params.hash);
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get diff between commits
router.get('/:repoId/diff', async (req, res) => {
  try {
    const diff = await getDiff(req.params.repoId, req.query.from, req.query.to);
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get branches
router.get('/:repoId/branches', async (req, res) => {
  try {
    const branches = await getBranches(req.params.repoId);
    res.json({ branches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch / create branch
router.post('/:repoId/branches', async (req, res) => {
  try {
    const { name, create } = req.body;
    await switchBranch(req.params.repoId, name, create);
    res.json({ success: true, branch: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add remote
router.post('/:repoId/remote', async (req, res) => {
  try {
    const { url, name } = req.body;
    await addRemote(req.params.repoId, url, name || 'origin');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push to remote
router.post('/:repoId/push', async (req, res) => {
  try {
    const { remote, branch } = req.body;
    const result = await pushToRemote(req.params.repoId, remote, branch);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
