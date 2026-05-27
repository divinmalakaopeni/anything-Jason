/**
 * BlockEditor.jsx
 * ────────────────
 * Renders each JSON block as an editable element.
 * Handles: contenteditable for text, table rendering, image display.
 * Manages: block locking, dirty state, add/delete/reorder blocks.
 */
import { useCallback, useRef } from 'react';
import { useStore } from '../stores/useStore.js';
import { lockBlock, unlockBlock, broadcastChange } from '../hooks/useSocket.js';
import { v4 as uuid } from 'uuid';

const BLOCK_TYPES = ['paragraph','heading','table','image'];
const LEVEL_LABELS = { 1:'H1', 2:'H2', 3:'H3', 4:'H4' };

function genId() { return 'b_' + uuid().slice(0,8); }

export default function BlockEditor({ repoId }) {
  const document   = useStore(s => s.document);
  const setDocument = useStore(s => s.setDocument);
  const setDirty   = useStore(s => s.setDirty);
  const locks      = useStore(s => s.locks);
  const user       = useStore(s => s.user);
  const selectedCommit = useStore(s => s.selectedCommit);

  const readOnly = !!selectedCommit;

  const updateBlocks = useCallback((newBlocks) => {
    setDocument({ ...document, content: newBlocks });
    setDirty(true);
  }, [document, setDocument, setDirty]);

  const updateBlock = useCallback((id, patch) => {
    const newBlocks = document.content.map(b =>
      b.id === id ? { ...b, ...patch } : b
    );
    updateBlocks(newBlocks);
    broadcastChange(repoId, id, patch);
  }, [document, updateBlocks, repoId]);

  const deleteBlock = useCallback((id) => {
    unlockBlock(id);
    updateBlocks(document.content.filter(b => b.id !== id));
  }, [document, updateBlocks]);

  const addBlockAfter = useCallback((afterId, type = 'paragraph') => {
    const idx = document.content.findIndex(b => b.id === afterId);
    const newBlock = {
      id:   genId(),
      type,
      text: '',
      ...(type === 'heading' ? { level: 2 } : {}),
      ...(type === 'table'   ? { headers: ['Column 1', 'Column 2'], rows: [['', '']] } : {}),
    };
    const newBlocks = [
      ...document.content.slice(0, idx + 1),
      newBlock,
      ...document.content.slice(idx + 1),
    ];
    updateBlocks(newBlocks);
  }, [document, updateBlocks]);

  const moveBlock = useCallback((id, dir) => {
    const idx = document.content.findIndex(b => b.id === id);
    const newBlocks = [...document.content];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= newBlocks.length) return;
    [newBlocks[idx], newBlocks[swap]] = [newBlocks[swap], newBlocks[idx]];
    updateBlocks(newBlocks);
  }, [document, updateBlocks]);

  const blocks = document?.content || [];

  return (
    <div>
      {/* Document title */}
      <div
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={e => {
          setDocument({
            ...document,
            document_metadata: { ...document.document_metadata, title: e.target.innerText },
          });
          setDirty(true);
        }}
        style={{
          fontSize: '2.2em', fontWeight: 700, fontFamily: 'var(--font-sans)',
          outline: 'none', marginBottom: 32, color: 'var(--text0)',
          borderBottom: readOnly ? 'none' : '1px solid transparent',
          paddingBottom: 8,
          lineHeight: 1.2,
        }}
        data-placeholder="Document title…"
      >
        {document?.document_metadata?.title}
      </div>

      {/* Blocks */}
      {blocks.map(block => (
        <Block
          key={block.id}
          block={block}
          readOnly={readOnly}
          locked={locks[block.id]}
          isLockedByMe={false}
          onUpdate={(patch) => updateBlock(block.id, patch)}
          onDelete={() => deleteBlock(block.id)}
          onAddAfter={(type) => addBlockAfter(block.id, type)}
          onMove={(dir) => moveBlock(block.id, dir)}
          onFocus={() => !readOnly && lockBlock(block.id)}
          onBlur={() => unlockBlock(block.id)}
          user={user}
        />
      ))}

      {/* Add block button at end */}
      {!readOnly && (
        <div style={{ marginTop: 20, display: 'flex', gap: 8, opacity: 0.5 }}>
          {['paragraph','heading','table'].map(t => (
            <button
              key={t}
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const last = blocks[blocks.length - 1];
                if (last) addBlockAfter(last.id, t);
                else updateBlocks([...blocks, { id: genId(), type: t, text: '', ...(t==='heading'?{level:2}:{}), ...(t==='table'?{headers:['Col 1','Col 2'],rows:[['','']]}:{}) }]);
              }}
            >
              + {t}
            </button>
          ))}
        </div>
      )}

      {readOnly && (
        <div style={{
          marginTop: 24, padding: '10px 14px', background: 'rgba(249,226,175,0.08)',
          border: '1px solid var(--yellow)', borderRadius: 'var(--radius)',
          fontSize: 12, color: 'var(--yellow)',
        }}>
          ⚠ Viewing historical version — read only. Switch back to HEAD to edit.
        </div>
      )}
    </div>
  );
}

// ── Single block ──────────────────────────────────────────────────────────────

function Block({ block, readOnly, locked, onUpdate, onDelete, onAddAfter, onMove, onFocus, onBlur, user }) {
  const lockerName = locked?.name || 'Another user';
  const isLockedByOther = locked && locked.socketId !== undefined;

  const blockClass = [
    'block',
    `block-${block.type === 'heading' ? `h${block.level||2}` : block.type}`,
    isLockedByOther ? 'locked' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={blockClass} style={{ position: 'relative' }}>
      {isLockedByOther && (
        <div className="lock-badge">{lockerName}</div>
      )}

      {/* Block content */}
      {block.type === 'table' ? (
        <TableBlock block={block} readOnly={readOnly || isLockedByOther} onUpdate={onUpdate} onFocus={onFocus} onBlur={onBlur} />
      ) : block.type === 'image' ? (
        <ImageBlock block={block} />
      ) : (
        <TextBlock
          block={block}
          readOnly={readOnly || isLockedByOther}
          onUpdate={onUpdate}
          onFocus={onFocus}
          onBlur={onBlur}
          onAddAfter={onAddAfter}
          onDelete={onDelete}
        />
      )}

      {/* Toolbar */}
      {!readOnly && !isLockedByOther && (
        <div className="block-toolbar">
          {block.type === 'heading' && (
            <select
              value={block.level || 2}
              onChange={e => onUpdate({ level: parseInt(e.target.value) })}
              style={{ background:'var(--bg3)', color:'var(--text1)', border:'none', fontSize:11, padding:'2px 4px' }}
            >
              {[1,2,3,4].map(l => <option key={l} value={l}>H{l}</option>)}
            </select>
          )}
          <button onClick={() => onMove('up')}  title="Move up">↑</button>
          <button onClick={() => onMove('down')} title="Move down">↓</button>
          <button onClick={() => onAddAfter('paragraph')} title="Add paragraph below">¶</button>
          <button onClick={() => onAddAfter('heading')}   title="Add heading below">H</button>
          <button onClick={() => onAddAfter('table')}     title="Add table below">⊞</button>
          <button onClick={onDelete} title="Delete block" style={{ color:'var(--red)' }}>✕</button>
        </div>
      )}

      {/* Page badge */}
      {block.page && (
        <span style={{ position:'absolute', right:4, bottom:4, fontSize:9, color:'var(--text3)', pointerEvents:'none' }}>
          p.{block.page}
        </span>
      )}
    </div>
  );
}

function TextBlock({ block, readOnly, onUpdate, onFocus, onBlur, onAddAfter, onDelete }) {
  const placeholder = block.type === 'heading'
    ? `Heading ${block.level || 2}…`
    : 'Start writing…';

  return (
    <div
      contentEditable={!readOnly}
      suppressContentEditableWarning
      className="block-content"
      data-placeholder={placeholder}
      onFocus={onFocus}
      onBlur={e => {
        onBlur();
        onUpdate({ text: e.target.innerText });
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey && block.type !== 'heading') {
          e.preventDefault();
          onAddAfter('paragraph');
        }
        if (e.key === 'Backspace' && e.currentTarget.innerText === '') {
          e.preventDefault();
          onDelete();
        }
      }}
      dangerouslySetInnerHTML={{ __html: block.text || '' }}
    />
  );
}

function TableBlock({ block, readOnly, onUpdate, onFocus, onBlur }) {
  const headers = block.headers || [];
  const rows    = block.rows    || [];

  const updateCell = (ri, ci, val) => {
    if (ri === -1) {
      const h = [...headers];
      h[ci] = val;
      onUpdate({ headers: h });
    } else {
      const r = rows.map((row, i) => i === ri ? row.map((c,j) => j === ci ? val : c) : row);
      onUpdate({ rows: r });
    }
  };

  const addRow = () => onUpdate({ rows: [...rows, headers.map(() => '')] });
  const addCol = () => {
    onUpdate({
      headers: [...headers, `Col ${headers.length + 1}`],
      rows: rows.map(r => [...r, '']),
    });
  };

  return (
    <div className="block-table" onFocus={onFocus} onBlur={onBlur} style={{ padding: '8px 12px' }}>
      <table>
        <thead>
          <tr>
            {headers.map((h, ci) => (
              <th key={ci}>
                <div
                  contentEditable={!readOnly}
                  suppressContentEditableWarning
                  onBlur={e => updateCell(-1, ci, e.target.innerText)}
                  dangerouslySetInnerHTML={{ __html: h }}
                  style={{ outline:'none', minWidth: 60 }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>
                  <div
                    contentEditable={!readOnly}
                    suppressContentEditableWarning
                    onBlur={e => updateCell(ri, ci, e.target.innerText)}
                    dangerouslySetInnerHTML={{ __html: cell }}
                    style={{ outline:'none', minWidth: 60 }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div style={{ display:'flex', gap:8, marginTop:6 }}>
          <button className="btn btn-ghost btn-sm" onClick={addRow}>+ Row</button>
          <button className="btn btn-ghost btn-sm" onClick={addCol}>+ Column</button>
        </div>
      )}
    </div>
  );
}

function ImageBlock({ block }) {
  return (
    <div className="block-image">
      {block.extracted_image_path ? (
        <img
          src={`/images/${encodeURIComponent(block.extracted_image_path.split('/').pop())}`}
          alt={block.caption || ''}
          onError={e => { e.target.style.display='none'; }}
        />
      ) : (
        <div style={{
          background:'var(--bg3)', borderRadius:'var(--radius)',
          padding:40, color:'var(--text3)', fontSize:12,
        }}>
          📷 {block.subtype === 'vector_region' ? 'Vector diagram' : 'Image'} — {block.caption || 'No caption'}
        </div>
      )}
      {block.caption && (
        <figcaption>{block.caption}</figcaption>
      )}
    </div>
  );
}
