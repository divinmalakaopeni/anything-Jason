import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { repoApi } from '../utils/api.js';
import { useStore } from '../stores/useStore.js';
import CreateRepoModal from '../components/CreateRepoModal.jsx';
import ImportModal     from '../components/ImportModal.jsx';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

export default function HomePage() {
  const navigate    = useNavigate();
  const user        = useStore(s => s.user);
  const setUser     = useStore(s => s.setUser);
  const setCurrentRepo = useStore(s => s.setCurrentRepo);

  const [repos,       setRepos]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [showImport,  setShowImport]  = useState(false);
  const [importRepoId, setImportRepoId] = useState(null);

  const [editingUser, setEditingUser] = useState(false);
  const [draftUser,   setDraftUser]   = useState({ ...user });

  const load = async () => {
    try {
      setLoading(true);
      const list = await repoApi.list();
      setRepos(list);
    } catch (err) {
      toast.error('Could not load repos: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openRepo = (repo) => {
    setCurrentRepo(repo);
    navigate(`/editor/${repo.id}`);
  };

  const deleteRepo = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this repository? This cannot be undone.')) return;
    await repoApi.delete(id);
    setRepos(r => r.filter(x => x.id !== id));
    toast.success('Repository deleted');
  };

  const handleImport = (repoId) => {
    setImportRepoId(repoId);
    setShowImport(true);
  };

  const COLORS = ['#89b4fa','#a6e3a1','#f9e2af','#cba6f7','#94e2d5','#f38ba8','#fab387'];
  const colorFor = (name) => COLORS[(name?.charCodeAt(0) || 0) % COLORS.length];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg1)',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={{ fontSize: 20 }}>📝</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>GitEditor</span>
          <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 8px', borderRadius: 10 }}>
            collaborative
          </span>
        </div>

        {/* User identity */}
        {editingUser ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={draftUser.name}
              onChange={e => setDraftUser(d => ({ ...d, name: e.target.value }))}
              placeholder="Your name"
              style={{ width: 130 }}
            />
            <input
              value={draftUser.email}
              onChange={e => setDraftUser(d => ({ ...d, email: e.target.value }))}
              placeholder="your@email.com"
              style={{ width: 170 }}
            />
            <button className="btn btn-primary btn-sm" onClick={() => {
              setUser({ ...draftUser, color: colorFor(draftUser.name) });
              setEditingUser(false);
              toast.success('Identity saved');
            }}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditingUser(false)}>Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => { setDraftUser({ ...user }); setEditingUser(true); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: 'var(--text1)',
              border: '1px solid var(--border)', borderRadius: 20,
              padding: '4px 12px 4px 6px', fontSize: 12,
            }}
          >
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: user.color, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#11111b',
            }}>
              {(user.name || 'A')[0].toUpperCase()}
            </div>
            {user.name}
          </button>
        )}
      </header>

      {/* Main */}
      <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
        {/* Actions row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, flex: 1 }}>Your repositories</h1>
          <button className="btn btn-ghost" onClick={() => navigate('/setup')}>
            ⚙ Settings
          </button>
          <button className="btn btn-ghost" onClick={() => setShowCreate('clone')}>
            ⬇ Clone repo
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate('create')}>
            + New repository
          </button>
        </div>

        {/* Repo grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
            <div className="spin" style={{ display: 'inline-block', fontSize: 24, marginBottom: 12 }}>⟳</div>
            <p>Loading repositories…</p>
          </div>
        ) : repos.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 80,
            border: '2px dashed var(--border)', borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>No repositories yet</p>
            <p style={{ color: 'var(--text3)', marginBottom: 20 }}>
              Create a new repository or clone an existing one to get started
            </p>
            <button className="btn btn-primary" onClick={() => setShowCreate('create')}>
              + Create your first repository
            </button>
          </div>
        ) : (
          <div className="repo-list" style={{ padding: 0 }}>
            {repos.map(repo => (
              <div key={repo.id} className="repo-card" onClick={() => openRepo(repo)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <h3>{repo.name}</h3>
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleImport(repo.id)}
                      title="Import JSON file"
                    >⬆ Import</button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={e => deleteRepo(e, repo.id)}
                      title="Delete repository"
                    >✕</button>
                  </div>
                </div>
                <p>{repo.description || <span style={{ fontStyle: 'italic' }}>No description</span>}</p>
                <div className="meta">
                  {repo.lastCommit ? (
                    <>
                      <span className="badge badge-mauve">
                        {repo.lastCommit.shortHash}
                      </span>
                      <span>{repo.lastCommit.author}</span>
                      <span>·</span>
                      <span>{formatDistanceToNow(new Date(repo.lastCommit.date), { addSuffix: true })}</span>
                    </>
                  ) : (
                    <span>No commits yet</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateRepoModal
          mode={showCreate}
          user={user}
          onClose={() => setShowCreate(false)}
          onCreate={(repo) => {
            setRepos(r => [repo, ...r]);
            setShowCreate(false);
            toast.success(`Repository "${repo.name}" created`);
            openRepo(repo);
          }}
        />
      )}

      {showImport && importRepoId && (
        <ImportModal
          repoId={importRepoId}
          user={user}
          onClose={() => { setShowImport(false); setImportRepoId(null); }}
          onImported={() => {
            setShowImport(false);
            load();
            toast.success('Document imported successfully');
          }}
        />
      )}
    </div>
  );
}
