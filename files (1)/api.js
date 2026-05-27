import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// ── Repos ──────────────────────────────────────────────────────────────────
export const repoApi = {
  list:         ()           => api.get('/repo').then(r => r.data.repos),
  create:       (data)       => api.post('/repo/create', data).then(r => r.data.repo),
  clone:        (data)       => api.post('/repo/clone', data).then(r => r.data.repo),
  delete:       (id)         => api.delete(`/repo/${id}`),
  history:      (id, limit)  => api.get(`/repo/${id}/history`, { params: { limit } }).then(r => r.data.history),
  commitDoc:    (id, hash)   => api.get(`/repo/${id}/commit/${hash}`).then(r => r.data.document),
  diff:         (id, from, to) => api.get(`/repo/${id}/diff`, { params: { from, to } }).then(r => r.data.diff),
  branches:     (id)         => api.get(`/repo/${id}/branches`).then(r => r.data.branches),
  switchBranch: (id, data)   => api.post(`/repo/${id}/branches`, data),
  addRemote:    (id, data)   => api.post(`/repo/${id}/remote`, data),
  push:         (id, data)   => api.post(`/repo/${id}/push`, data).then(r => r.data),
};

// ── Document ───────────────────────────────────────────────────────────────
export const docApi = {
  get:  (repoId)         => api.get(`/document/${repoId}`).then(r => r.data.document),
  save: (repoId, data)   => api.post(`/document/${repoId}/save`, data).then(r => r.data),
};

// ── Export ─────────────────────────────────────────────────────────────────
export const exportApi = {
  pdf:        (repoId) => `/api/export/${repoId}/pdf`,
  googleDocs: (repoId, accessToken) =>
    api.post(`/export/${repoId}/googledocs`, { accessToken }).then(r => r.data),
};

// ── Import ─────────────────────────────────────────────────────────────────
export const importApi = {
  upload: (repoId, file, opts = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (opts.merge)       form.append('merge',       opts.merge);
    if (opts.authorName)  form.append('authorName',  opts.authorName);
    if (opts.authorEmail) form.append('authorEmail', opts.authorEmail);
    return api.post(`/import/${repoId}`, form).then(r => r.data);
  },
};

export default api;
