/**
 * routes/import.js
 * ─────────────────
 * Import a pdf2json output file into an existing repo.
 * Converts pdf2json blocks → editor blocks and commits.
 */
import { Router } from 'express';
import multer from 'multer';
import { saveAndCommit, readDocument } from '../services/git.js';

const router  = Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * Convert pdf2json element → editor block.
 */
function convertBlock(el, index) {
  const id = el.id || `imported_${index}`;

  switch (el.type) {
    case 'heading':
      return {
        id,
        type:  'heading',
        level: el.level || 2,
        text:  el.text  || '',
        page:  el.page,
        bounding_box: el.bounding_box,
        font: el.font,
        font_size: el.font_size,
      };

    case 'paragraph':
      return {
        id,
        type:   'paragraph',
        text:   el.text || '',
        page:   el.page,
        bounding_box: el.bounding_box,
        font:   el.font,
        font_size: el.font_size,
        bold:   el.bold   || false,
        italic: el.italic || false,
      };

    case 'table':
      return {
        id,
        type:    'table',
        headers: el.headers || [],
        rows:    el.rows    || [],
        page:    el.page,
        bounding_box: el.bounding_box,
        extraction_method: el.extraction_method,
        accuracy: el.accuracy,
      };

    case 'image':
      return {
        id,
        type:    'image',
        subtype: el.subtype || 'raster',
        page:    el.page,
        bounding_box: el.bounding_box,
        extracted_image_path: el.extracted_image_path,
        caption: el.caption || '',
        width_px:  el.width_px,
        height_px: el.height_px,
      };

    default:
      return {
        id,
        type: 'paragraph',
        text: el.text || JSON.stringify(el),
        page: el.page,
      };
  }
}

// POST /api/import/:repoId
// Body: multipart/form-data with field "file" (JSON file)
router.post('/:repoId', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const raw = req.file.buffer.toString('utf-8');
    let imported;
    try {
      imported = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON file' });
    }

    // Support both raw pdf2json format and already-converted format
    const isP2J = Array.isArray(imported.content) &&
                  imported.content.length > 0 &&
                  imported.content[0].type !== undefined;

    if (!isP2J) {
      return res.status(400).json({ error: 'File does not look like a pdf2json output' });
    }

    // Convert blocks
    const convertedBlocks = imported.content.map(convertBlock);

    // Load existing doc and merge or replace
    const existing = await readDocument(req.params.repoId);
    const { merge = 'replace' } = req.body; // 'replace' or 'append'

    const newContent = merge === 'append'
      ? [...(existing.content || []), ...convertedBlocks]
      : convertedBlocks;

    const updatedDoc = {
      ...existing,
      document_metadata: {
        ...existing.document_metadata,
        ...(imported.document_metadata || {}),
        imported_at: new Date().toISOString(),
        source: req.file.originalname,
      },
      content: newContent,
    };

    const { authorName, authorEmail } = req.body;
    const result = await saveAndCommit(
      req.params.repoId,
      updatedDoc,
      {
        message: `Import document from ${req.file.originalname}`,
        authorName,
        authorEmail,
      }
    );

    res.json({
      success: true,
      blocksImported: convertedBlocks.length,
      commit: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
