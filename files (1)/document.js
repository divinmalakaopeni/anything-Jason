/**
 * routes/document.js
 * ───────────────────
 * Read and save the document.json inside a repo.
 */
import { Router } from 'express';
import { readDocument, saveAndCommit } from '../services/git.js';

const router = Router();

// Read current document
router.get('/:repoId', async (req, res) => {
  try {
    const doc = await readDocument(req.params.repoId);
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save and commit
router.post('/:repoId/save', async (req, res) => {
  try {
    const { document, message, authorName, authorEmail } = req.body;
    if (!document) return res.status(400).json({ error: 'document is required' });

    const result = await saveAndCommit(
      req.params.repoId,
      document,
      { message, authorName, authorEmail }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
