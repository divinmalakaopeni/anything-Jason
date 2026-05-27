/**
 * hooks/useSocket.js
 * ───────────────────
 * Socket.io connection + collaborative editing events.
 */
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useStore } from '../stores/useStore.js';
import toast from 'react-hot-toast';

let socket = null;

export function getSocket() { return socket; }

export function useSocket(repoId) {
  const user          = useStore(s => s.user);
  const setOnlineUsers = useStore(s => s.setOnlineUsers);
  const setBlockLock   = useStore(s => s.setBlockLock);
  const removeBlockLock = useStore(s => s.removeBlockLock);
  const setLocks        = useStore(s => s.setLocks);
  const connectedRef    = useRef(false);

  useEffect(() => {
    if (!repoId) return;

    // Create socket if not exists
    if (!socket) {
      socket = io({ transports: ['websocket'], autoConnect: true });
    }

    if (!connectedRef.current) {
      socket.emit('repo:join', { repoId, user });
      connectedRef.current = true;
    }

    // ── Presence ──────────────────────────────────────────────────────
    socket.on('presence:update', ({ users }) => {
      setOnlineUsers(users.filter(u => u.socketId !== socket.id));
    });

    // ── Locks ─────────────────────────────────────────────────────────
    socket.on('locks:current', ({ locks }) => {
      setLocks(locks);
    });

    socket.on('block:locked', ({ blockId, user: locker }) => {
      if (locker.socketId !== socket.id) {
        setBlockLock(blockId, locker);
      }
    });

    socket.on('block:unlocked', ({ blockId }) => {
      removeBlockLock(blockId);
    });

    socket.on('block:lock:denied', ({ blockId, lockedBy }) => {
      toast.error(`Block locked by ${lockedBy}`);
    });

    // ── Remote saves ───────────────────────────────────────────────────
    socket.on('doc:saved', ({ commit, by }) => {
      if (by?.socketId !== socket.id) {
        toast(`💾 ${by?.name || 'Someone'} saved — ${commit?.message || ''}`, {
          duration: 3000,
        });
      }
    });

    return () => {
      socket.off('presence:update');
      socket.off('locks:current');
      socket.off('block:locked');
      socket.off('block:unlocked');
      socket.off('block:lock:denied');
      socket.off('doc:saved');
    };
  }, [repoId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket && repoId) {
        socket.emit('repo:leave');
        connectedRef.current = false;
      }
    };
  }, [repoId]);

  return socket;
}

export function lockBlock(blockId) {
  socket?.emit('block:lock', { blockId });
}

export function unlockBlock(blockId) {
  socket?.emit('block:unlock', { blockId });
}

export function broadcastChange(repoId, blockId, data) {
  socket?.emit('block:change', { repoId, blockId, data });
}

export function notifySaved(repoId, commit) {
  socket?.emit('doc:saved', { repoId, commit });
}
