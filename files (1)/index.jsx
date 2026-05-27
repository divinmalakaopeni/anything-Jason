// HistoryPanel.jsx
import { useEffect, useState } from 'react';
import { repoApi, docApi } from '../utils/api.js';
import { useStore } from '../stores/useStore.js';
import { formatDistanceToNow } from 'date-fns';

export function HistoryPanel({ repoId }) {
  const [history, setHistory]  = useState([]);
  const selectedCommit = useStore(s => s.selectedCommit);
  const setSelectedCommit = useStore(s => s.setSelectedCommit);
  const setDocument = useStore(s => s.setDocument);
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    repoApi.history(repoId, 50).then(setHistory);
  }, [repoId]);

  const viewCommit = async (commit) => {
    if (selectedCommit?.hash === commit.hash) {
      setSelectedCommit(null);
      const doc = await docApi.get(repoId);
      setDocument(doc);
      return;
    }
    setSelectedCommit(commit);
    const doc = await repoApi.commitDoc(repoId, commit.hash);
    setDocument(doc);
  };

  const viewDiff = async (commit, e) => {
    e.stopPropagation();
    const d = await repoApi.diff(repoId, commit.hash + '^', commit.hash);
    setDiff(d);
    setShowDiff(true);
  };

  return (
    <div className="history-panel fade-in">
      <h3>Git history</h3>
      {selectedCommit && (
        <div style={{ padding:'8px 14px', background:'rgba(249,226,175,0.08)', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--yellow)' }}>
          Viewing {selectedCommit.shortHash} — click again to return to HEAD
        </div>
      )}
      <div className="commit-list">
        {history.map(c => (
          <div
            key={c.hash}
            className={`commit-item ${selectedCommit?.hash === c.hash ? 'active' : ''}`}
            onClick={() => viewCommit(c)}
          >
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <span className="commit-hash">{c.shortHash}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => viewDiff(c, e)}
                style={{ fontSize:10, padding:'1px 6px' }}
              >
                diff
              </button>
            </div>
            <div className="commit-msg">{c.message}</div>
            <div className="commit-meta">
              {c.author} · {formatDistanceToNow(new Date(c.date), { addSuffix: true })}
            </div>
          </div>
        ))}
        {history.length === 0 && (
          <p style={{ padding:20, color:'var(--text3)', fontSize:12 }}>No commits yet</p>
        )}
      </div>

      {showDiff && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowDiff(false)}>
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:20, width:'90%', maxWidth:700 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
              <h3 style={{ fontSize:14 }}>Diff</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDiff(false)}>✕</button>
            </div>
            <DiffView raw={diff} />
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView({ raw }) {
  if (!raw) return <p style={{ color:'var(--text3)', fontSize:12 }}>No diff available</p>;
  const lines = raw.split('\n');
  return (
    <div className="diff-view">
      {lines.map((line, i) => (
        <div key={i} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : line.startsWith('@@') ? 'diff-meta' : ''}>
          {line || '\n'}
        </div>
      ))}
    </div>
  );
}

// ── PresenceBar ──────────────────────────────────────────────────────────────
export function PresenceBar({ users, currentUser }) {
  const all = [{ ...currentUser, isMe: true }, ...users];
  if (all.length === 0) return <p style={{ fontSize:12, color:'var(--text3)' }}>Only you</p>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {all.map((u, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
          <div style={{
            width:24, height:24, borderRadius:'50%',
            background: u.color || '#89b4fa',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:10, fontWeight:700, color:'#11111b', flexShrink:0,
          }}>
            {(u.name || 'A')[0].toUpperCase()}
          </div>
          <span style={{ color: u.isMe ? 'var(--text0)' : 'var(--text2)' }}>
            {u.name} {u.isMe ? '(you)' : ''}
          </span>
          <span style={{ marginLeft:'auto', width:7, height:7, borderRadius:'50%', background: u.isMe ? 'var(--green)' : 'var(--blue)' }} />
        </div>
      ))}
    </div>
  );
}

// ── CreateRepoModal ───────────────────────────────────────────────────────────
export function CreateRepoModal({ mode, user, onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '', description: '', url: '',
    authorName: user.name, authorEmail: user.email,
  });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (mode === 'create' && !form.name) return;
    if (mode === 'clone'  && !form.url)  return;
    setLoading(true);
    try {
      const { repoApi } = await import('../utils/api.js');
      const repo = mode === 'create'
        ? await repoApi.create(form)
        : await repoApi.clone(form);
      onCreate(repo);
    } catch (err) {
      const { default: toast } = await import('react-hot-toast');
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{mode === 'create' ? '+ New repository' : '⬇ Clone repository'}</h2>

        {mode === 'clone' ? (
          <div className="form-group">
            <label>Remote URL</label>
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://github.com/you/repo.git" />
          </div>
        ) : (
          <>
            <div className="form-group">
              <label>Repository name *</label>
              <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Document" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description…" />
            </div>
          </>
        )}

        <div className="divider" />
        <p className="label">Git identity</p>
        <div className="form-group">
          <label>Author name</label>
          <input value={form.authorName} onChange={e => setForm(f => ({ ...f, authorName: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Author email</label>
          <input value={form.authorEmail} onChange={e => setForm(f => ({ ...f, authorEmail: e.target.value }))} />
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? '…' : mode === 'create' ? 'Create' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ImportModal ───────────────────────────────────────────────────────────────
export function ImportModal({ repoId, user, onClose, onImported }) {
  const [file,    setFile]    = useState(null);
  const [merge,   setMerge]   = useState('replace');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const submit = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const { importApi } = await import('../utils/api.js');
      const result = await importApi.upload(repoId, file, {
        merge, authorName: user.name, authorEmail: user.email,
      });
      const { default: toast } = await import('react-hot-toast');
      toast.success(`Imported ${result.blocksImported} blocks`);
      onImported();
    } catch (err) {
      const { default: toast } = await import('react-hot-toast');
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>⬆ Import JSON document</h2>
        <p style={{ fontSize:12, color:'var(--text3)', marginBottom:16 }}>
          Drop a pdf2json output file to import it into this repository as a Git-tracked document.
        </p>

        <div
          className={`dropzone ${dragging ? 'active' : ''} ${file ? 'active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f?.name.endsWith('.json')) setFile(f);
          }}
          onClick={() => document.getElementById('json-file-input').click()}
        >
          <div style={{ fontSize:32 }}>📄</div>
          <p>{file ? `✓ ${file.name}` : 'Drop your .json file here, or click to browse'}</p>
          <input id="json-file-input" type="file" accept=".json" style={{ display:'none' }}
            onChange={e => setFile(e.target.files[0])} />
        </div>

        <div className="form-group" style={{ marginTop:16 }}>
          <label>Import mode</label>
          <select value={merge} onChange={e => setMerge(e.target.value)}>
            <option value="replace">Replace current content</option>
            <option value="append">Append to existing content</option>
          </select>
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!file || loading}>
            {loading ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── BranchPanel ───────────────────────────────────────────────────────────────
export function BranchPanel({ repoId, branches, onClose, onSwitch }) {
  const [newBranch, setNewBranch] = useState('');
  const [loading,   setLoading]   = useState(false);

  const switchTo = async (name, create = false) => {
    setLoading(true);
    try { await onSwitch(name, create); }
    catch (err) {
      const { default: toast } = await import('react-hot-toast');
      toast.error(err.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>🌿 Branches</h2>
        <p className="label">Current: {branches.current}</p>
        <div style={{ maxHeight:200, overflowY:'auto', marginBottom:16 }}>
          {branches.all.map(b => (
            <div key={b} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color: b === branches.current ? 'var(--blue)' : 'var(--text1)' }}>
                {b === branches.current ? '→ ' : '  '}{b}
              </span>
              {b !== branches.current && (
                <button className="btn btn-ghost btn-sm" onClick={() => switchTo(b)} disabled={loading}>
                  Switch
                </button>
              )}
            </div>
          ))}
        </div>

        <p className="label">Create new branch</p>
        <div style={{ display:'flex', gap:8 }}>
          <input value={newBranch} onChange={e => setNewBranch(e.target.value)} placeholder="feature/my-branch" />
          <button className="btn btn-primary" style={{ whiteSpace:'nowrap' }} onClick={() => newBranch && switchTo(newBranch, true)} disabled={!newBranch || loading}>
            Create & switch
          </button>
        </div>

        <div className="actions" style={{ marginTop:16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
