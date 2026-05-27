/**
 * routes/export.js
 */
import { Router } from 'express';
import { readDocument } from '../services/git.js';
import { exportToPDF, exportToGoogleDocs } from '../services/export.js';

const router = Router();

// Export to PDF
router.get('/:repoId/pdf', async (req, res) => {
  try {
    const doc  = await readDocument(req.params.repoId);
    const pdf  = await exportToPDF(doc);
    const name = (doc.document_metadata?.title || 'document').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export to Google Docs
router.post('/:repoId/googledocs', async (req, res) => {
  try {
    const { accessToken } = req.body;
    const doc    = await readDocument(req.params.repoId);
    const result = await exportToGoogleDocs(doc, accessToken);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
