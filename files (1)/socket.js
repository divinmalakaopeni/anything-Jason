/**
 * services/socket.js
 * ───────────────────
 * Real-time collaboration:
 * - User presence (cursors, who is editing which block)
 * - Block locking (prevent two people editing the same block)
 * - Live document sync (broadcast changes to all collaborators)
 * - Auto-save triggering
 */

// In-memory state
// repoSessions[repoId] = { users: Map(socketId -> userInfo), locks: Map(blockId -> socketId) }
const repoSessions = new Map();

function getSession(repoId) {
  if (!repoSessions.has(repoId)) {
    repoSessions.set(repoId, {
      users: new Map(),
      locks: new Map(),
    });
  }
  return repoSessions.get(repoId);
}

function broadcastPresence(io, repoId) {
  const session = getSession(repoId);
  const users = Array.from(session.users.values());
  io.to(repoId).emit('presence:update', { users });
}

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    let currentRepoId = null;
    let currentUser   = null;

    // ── Join a document room ───────────────────────────────────────────────
    socket.on('repo:join', ({ repoId, user }) => {
      currentRepoId = repoId;
      currentUser   = { ...user, socketId: socket.id, cursor: null };

      socket.join(repoId);
      const session = getSession(repoId);
      session.users.set(socket.id, currentUser);

      // Send current locks to the new user
      socket.emit('locks:current', {
        locks: Object.fromEntries(session.locks),
      });

      broadcastPresence(io, repoId);
      console.log(`User ${user.name} joined repo ${repoId}`);
    });

    // ── Leave room ─────────────────────────────────────────────────────────
    socket.on('repo:leave', () => {
      if (!currentRepoId) return;
      const session = getSession(currentRepoId);
      session.users.delete(socket.id);

      // Release all locks held by this user
      for (const [blockId, lockHolder] of session.locks) {
        if (lockHolder === socket.id) {
          session.locks.delete(blockId);
          io.to(currentRepoId).emit('block:unlocked', { blockId });
        }
      }

      broadcastPresence(io, currentRepoId);
      socket.leave(currentRepoId);
    });

    // ── Block locking ──────────────────────────────────────────────────────
    socket.on('block:lock', ({ blockId }) => {
      if (!currentRepoId) return;
      const session = getSession(currentRepoId);

      if (session.locks.has(blockId)) {
        // Already locked by someone else
        socket.emit('block:lock:denied', {
          blockId,
          lockedBy: session.users.get(session.locks.get(blockId))?.name || 'Another user',
        });
        return;
      }

      session.locks.set(blockId, socket.id);
      io.to(currentRepoId).emit('block:locked', {
        blockId,
        user: currentUser,
      });
    });

    socket.on('block:unlock', ({ blockId }) => {
      if (!currentRepoId) return;
      const session = getSession(currentRepoId);

      if (session.locks.get(blockId) === socket.id) {
        session.locks.delete(blockId);
        io.to(currentRepoId).emit('block:unlocked', { blockId });
      }
    });

    // ── Document changes ───────────────────────────────────────────────────
    // Broadcast a block change to all OTHER users in the room
    socket.on('block:change', ({ repoId, blockId, data }) => {
      socket.to(repoId).emit('block:change', { blockId, data, from: currentUser });
    });

    // ── Cursor position ────────────────────────────────────────────────────
    socket.on('cursor:move', ({ blockId, offset }) => {
      if (!currentRepoId || !currentUser) return;
      const session = getSession(currentRepoId);
      currentUser.cursor = { blockId, offset };
      session.users.set(socket.id, currentUser);
      socket.to(currentRepoId).emit('cursor:move', {
        user: currentUser,
        blockId,
        offset,
      });
    });

    // ── Auto-save notification ─────────────────────────────────────────────
    socket.on('doc:saved', ({ repoId, commit }) => {
      socket.to(repoId).emit('doc:saved', { commit, by: currentUser });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (!currentRepoId) return;
      const session = getSession(currentRepoId);
      session.users.delete(socket.id);

      for (const [blockId, lockHolder] of session.locks) {
        if (lockHolder === socket.id) {
          session.locks.delete(blockId);
          io.to(currentRepoId).emit('block:unlocked', { blockId });
        }
      }

      // Clean up empty sessions
      if (session.users.size === 0) {
        repoSessions.delete(currentRepoId);
      } else {
        broadcastPresence(io, currentRepoId);
      }

      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}
