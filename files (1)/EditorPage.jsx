import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/useStore.js';
import { docApi, repoApi, exportApi } from '../utils/api.js';
import { useSocket } from '../hooks/useSocket.js';
import { useAutoSave } from '../hooks/useAutoSave.js';
import BlockEditor from '../components/BlockEditor.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import PresenceBar  from '../components/PresenceBar.jsx';
import ImportModal  from '../components/ImportModal.jsx';
import BranchPanel  from '../components/BranchPanel.jsx';
import toast from 'react-hot-toast';

export default function EditorPage() {
  const { repoId }      = useParams();
  const navigate        = useNavigate();
  const user            = useStore(s => s.user);
  const document        = useStore(s => s.document);
  const setDocument     = useStore(s => s.setDocument);
  const isDirty         = useStore(s => s.isDirty);
  const showHistory     = useStore(s => s.showHistory);
  const toggleHistory   = useStore(s => s.toggleHistory);
  const onlineUsers     = useStore(s => s.onlineUsers);
  const currentRepo     = useStore(s => s.currentRepo);

  const [loading,      setLoading]      = useState(true);
  const [showImport,   setShowImport]   = useState(false);
  const [showBranch,   setShowBranch]   = useState(false);
  const [branches,     setBranches]     = useState(null);
  const [commitMsg,    setCommitMsg]    = useState('');
  const [showCommit,   setShowCommit]   = useState(false);
  const [exporting,    setExporting]    = useState(false);

  // Init socket
  useSocket(repoId);

  // Auto-save every 30s
  const { save } = useAutoSave(repoId, 30);

  // Load document
  useEffect(() => {
    if (!repoId) return;
    setLoading(true);
    docApi.get(repoId)
      .then(doc => { setDocument(doc); })
      .catch(err => toast.error('Failed to load document: ' + err.message))
      .finally(() => setLoading(false));
  }, [repoId]);

  // Load branches
  useEffect(() => {
    repoApi.branches(repoId).then(setBranches).catch(() => {});
  }, [repoId]);

  // Cmd/Ctrl+S → manual save
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      window.open(exportApi.pdf(repoId), '_blank');
    } finally {
      setExporting(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) { toast.error('Enter a commit message'); return; }
    const result = await docApi.save(repoId, {
      document,
      authorName:  user.name,
      authorEmail: user.email,
      message: commitMsg,
    });
    if (result.committed) {
      toast.success(`Committed: ${result.hash}`);
      setShowCommit(false);
      setCommitMsg('');
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 32 }} className="spin">⟳</div>
      <p style={{ color: 'var(--text3)' }}>Loading document…</p>
    </div>
  );

  return (
    <div className="layout">
      {/* ── Left sidebar ────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'transparent', color: 'var(--text3)', fontSize: 12, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            ← All repos
          </button>
          <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word' }}>
            {document?.document_metadata?.title || 'Untitled'}
          </div>
          {branches && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>branch:</span>
              <button
                onClick={() => setShowBranch(true)}
                style={{ fontSize: 11, color: 'var(--blue)', background: 'transparent', fontFamily: 'var(--font-mono)' }}
              >
                {branches.current} ▾
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Save / commit */}
          <button
            className="btn btn-primary"
            onClick={() => save(true)}
            disabled={!isDirty}
            style={{ opacity: isDirty ? 1 : 0.5 }}
          >
            💾 Save {isDirty ? '●' : ''}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowCommit(true)}>
            ✓ Commit with message
          </button>
          <div className="divider" style={{ margin: '4px 0' }} />
          <button className="btn btn-ghost" onClick={toggleHistory}>
            {showHistory ? '✕ Hide history' : '🕐 Git history'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowImport(true)}>
            ⬆ Import JSON
          </button>
          <div className="divider" style={{ margin: '4px 0' }} />
          <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Export as</p>
          <button className="btn btn-ghost" onClick={handleExportPDF} disabled={exporting}>
            📄 PDF
          </button>
          <button className="btn btn-ghost" onClick={() => toast('Google Docs export requires OAuth setup — see README', { duration: 5000 })}>
            📊 Google Docs
          </button>
        </div>

        {/* Online users */}
        <div style={{ padding: '10px 14px' }}>
          <p className="label">Online now</p>
          <PresenceBar users={onlineUsers} currentUser={user} />
        </div>

        {/* Document stats */}
        {document && (
          <div style={{ padding: '10px 14px', marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
            <p className="label">Document</p>
            <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 2 }}>
              <div>Blocks: <span style={{ color: 'var(--text1)' }}>{document.content?.length || 0}</span></div>
              <div>Pages: <span style={{ color: 'var(--text1)' }}>
                {new Set(document.content?.map(b => b.page).filter(Boolean)).size || '—'}
              </span></div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main editor area ─────────────────────────────────────────────── */}
      <div className="main">
        {/* Top bar */}
        <div className="topbar">
          <span className="topbar-title">
            {document?.document_metadata?.title || 'Untitled'}
          </span>
          <div className="topbar-actions">
            {isDirty && (
              <span style={{ fontSize: 11, color: 'var(--yellow)' }}>● Unsaved changes</span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              Auto-save every 30s · Ctrl+S to save now
            </span>
          </div>
        </div>

        {/* Editor */}
        <div className="editor-wrap">
          <div className="editor-inner">
            {document ? (
              <BlockEditor repoId={repoId} />
            ) : (
              <p style={{ color: 'var(--text3)', textAlign: 'center', marginTop: 60 }}>
                No document found.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── History panel ────────────────────────────────────────────────── */}
      {showHistory && <HistoryPanel repoId={repoId} />}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showImport && (
        <ImportModal
          repoId={repoId}
          user={user}
          onClose={() => setShowImport(false)}
          onImported={async () => {
            setShowImport(false);
            const doc = await docApi.get(repoId);
            setDocument(doc);
            toast.success('Document imported and loaded');
          }}
        />
      )}

      {showBranch && branches && (
        <BranchPanel
          repoId={repoId}
          branches={branches}
          onClose={() => setShowBranch(false)}
          onSwitch={async (name, create) => {
            await repoApi.switchBranch(repoId, { name, create });
            const doc = await docApi.get(repoId);
            setDocument(doc);
            setBranches(await repoApi.branches(repoId));
            setShowBranch(false);
            toast.success(`Switched to ${name}`);
          }}
        />
      )}

      {showCommit && (
        <div className="modal-overlay" onClick={() => setShowCommit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>✓ Commit changes</h2>
            <div className="form-group">
              <label>Commit message</label>
              <input
                autoFocus
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                placeholder="Describe what you changed…"
                onKeyDown={e => e.key === 'Enter' && handleCommit()}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
              Author: {user.name} &lt;{user.email}&gt;
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowCommit(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCommit}>Commit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
