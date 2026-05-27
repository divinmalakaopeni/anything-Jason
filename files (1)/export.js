/**
 * services/export.js
 * ───────────────────
 * PDF export via Puppeteer.
 * Google Docs export via Google Docs API.
 */
import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import { config } from 'dotenv';

config();

// ── Helpers ────────────────────────────────────────────────────────────────

function blockToHTML(block) {
  const text = block.text || '';
  switch (block.type) {
    case 'heading':
      return `<h${block.level || 2}>${text}</h${block.level || 2}>`;
    case 'paragraph':
      return `<p>${text}</p>`;
    case 'table': {
      const headers = (block.headers || [])
        .map(h => `<th>${h}</th>`).join('');
      const rows = (block.rows || [])
        .map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    case 'image':
      return `<figure>
        <img src="${block.extracted_image_path || ''}" alt="${block.caption || ''}" />
        ${block.caption ? `<figcaption>${block.caption}</figcaption>` : ''}
      </figure>`;
    default:
      return `<p>${text}</p>`;
  }
}

function documentToHTML(document) {
  const meta   = document.document_metadata || {};
  const blocks = document.content || [];

  const body = blocks.map(blockToHTML).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${meta.title || 'Document'}</title>
  <style>
    body {
      font-family: 'Georgia', serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 60px 40px;
      font-size: 16px;
      line-height: 1.8;
      color: #1a1a1a;
    }
    h1 { font-size: 2em; margin-bottom: 0.3em; }
    h2 { font-size: 1.5em; margin-top: 2em; }
    h3 { font-size: 1.2em; margin-top: 1.5em; }
    h4 { font-size: 1em; margin-top: 1.2em; font-weight: 600; }
    p  { margin: 0.8em 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5em 0;
      font-size: 14px;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 8px 12px;
      text-align: left;
    }
    th { background: #f4f4f4; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
    figcaption { text-align: center; font-size: 13px; color: #666; margin-top: 4px; }
    figure { margin: 1.5em 0; }
    @media print {
      body { padding: 20px; }
    }
  </style>
</head>
<body>
  ${meta.title ? `<h1>${meta.title}</h1>` : ''}
  ${meta.description ? `<p style="color:#666;font-style:italic">${meta.description}</p>` : ''}
  ${body}
</body>
</html>`;
}

// ── PDF Export ─────────────────────────────────────────────────────────────

export async function exportToPDF(document) {
  const html = documentToHTML(document);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: true,
    });

    return pdf;
  } finally {
    await browser.close();
  }
}

// ── Google Docs Export ─────────────────────────────────────────────────────

/**
 * Convert a document JSON to Google Docs requests array.
 */
function documentToGoogleDocsRequests(document) {
  const requests = [];
  const blocks   = (document.content || []).slice().reverse(); // insert at index 1, reversed

  for (const block of blocks) {
    if (!block.text && block.type !== 'table') continue;

    switch (block.type) {
      case 'heading': {
        const style = ['HEADING_1','HEADING_2','HEADING_3','HEADING_4'][
          Math.min((block.level || 1) - 1, 3)
        ];
        requests.push(
          { insertText: { location: { index: 1 }, text: block.text + '\n' } },
          {
            updateParagraphStyle: {
              range: { startIndex: 1, endIndex: 1 + block.text.length + 1 },
              paragraphStyle: { namedStyleType: style },
              fields: 'namedStyleType',
            },
          }
        );
        break;
      }
      case 'paragraph':
        requests.push({
          insertText: { location: { index: 1 }, text: block.text + '\n' },
        });
        break;
      case 'table': {
        if (!block.headers?.length) break;
        const cols = block.headers.length;
        const rows = 1 + (block.rows?.length || 0);
        requests.push({ insertTable: { rows, columns: cols, location: { index: 1 } } });
        break;
      }
      default:
        if (block.text) {
          requests.push({ insertText: { location: { index: 1 }, text: block.text + '\n' } });
        }
    }
  }

  return requests;
}

export async function exportToGoogleDocs(document, accessToken) {
  if (!accessToken) throw new Error('Google OAuth access token required');

  const auth   = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const docs   = google.docs({ version: 'v1', auth });
  const drive  = google.drive({ version: 'v3', auth });

  const meta = document.document_metadata || {};

  // Create blank doc
  const created = await docs.documents.create({
    requestBody: { title: meta.title || 'Exported Document' },
  });

  const docId = created.data.documentId;

  // Batch insert content
  const requests = documentToGoogleDocsRequests(document);
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  return {
    documentId: docId,
    url: `https://docs.google.com/document/d/${docId}/edit`,
    title: meta.title || 'Exported Document',
  };
}
