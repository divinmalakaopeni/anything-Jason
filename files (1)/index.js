import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import repoRoutes from './routes/repo.js';
import documentRoutes from './routes/document.js';
import exportRoutes from './routes/export.js';
import importRoutes from './routes/import.js';
import { setupSocketHandlers } from './services/socket.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, slow down.' },
}));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/repo',     repoRoutes);
app.use('/api/document', documentRoutes);
app.use('/api/export',   exportRoutes);
app.use('/api/import',   importRoutes);

// Serve built client in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '../client/dist/index.html')));
}

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ── Socket handlers ────────────────────────────────────────────────────────
setupSocketHandlers(io);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 GitEditor server running on http://localhost:${PORT}`);
  console.log(`📁 Repos stored in: ${process.env.REPOS_DIR || './repos'}\n`);
});

export { io };
