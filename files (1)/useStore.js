/**
 * stores/useStore.js
 * ───────────────────
 * Global state: current user, current repo, document, presence.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set, get) => ({
      // ── User ──────────────────────────────────────────────────────────
      user: {
        name:  'Anonymous',
        email: 'anon@giteditor.local',
        color: '#89b4fa',
      },
      setUser: (user) => set({ user }),

      // ── Current repo ──────────────────────────────────────────────────
      currentRepo: null,
      setCurrentRepo: (repo) => set({ currentRepo: repo }),

      // ── Document ──────────────────────────────────────────────────────
      document: null,
      setDocument: (doc) => set({ document: doc }),

      isDirty: false,
      setDirty: (v) => set({ isDirty: v }),

      // ── Presence (other users) ─────────────────────────────────────────
      onlineUsers: [],
      setOnlineUsers: (users) => set({ onlineUsers: users }),

      // ── Block locks ───────────────────────────────────────────────────
      locks: {},           // { blockId: { socketId, userName } }
      setLocks: (locks) => set({ locks }),
      setBlockLock: (blockId, info) => set(s => ({
        locks: { ...s.locks, [blockId]: info }
      })),
      removeBlockLock: (blockId) => set(s => {
        const locks = { ...s.locks };
        delete locks[blockId];
        return { locks };
      }),

      // ── History panel ─────────────────────────────────────────────────
      showHistory: false,
      toggleHistory: () => set(s => ({ showHistory: !s.showHistory })),

      selectedCommit: null,
      setSelectedCommit: (c) => set({ selectedCommit: c }),

      // ── Auto-save ─────────────────────────────────────────────────────
      autoSaveInterval: 30, // seconds
    }),
    {
      name: 'giteditor-state',
      partialize: (s) => ({ user: s.user, autoSaveInterval: s.autoSaveInterval }),
    }
  )
);
