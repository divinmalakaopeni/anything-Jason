/**
 * hooks/useAutoSave.js
 * ─────────────────────
 * Periodically saves the document to the server and commits to git.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../stores/useStore.js';
import { docApi } from '../utils/api.js';
import { notifySaved } from './useSocket.js';
import toast from 'react-hot-toast';

export function useAutoSave(repoId, intervalSeconds = 30) {
  const document   = useStore(s => s.document);
  const isDirty    = useStore(s => s.isDirty);
  const setDirty   = useStore(s => s.setDirty);
  const user       = useStore(s => s.user);
  const timerRef   = useRef(null);
  const savingRef  = useRef(false);

  const save = useCallback(async (manual = false) => {
    if (!repoId || !document || savingRef.current) return;
    if (!isDirty && !manual) return;

    savingRef.current = true;
    try {
      const result = await docApi.save(repoId, {
        document,
        authorName:  user.name,
        authorEmail: user.email,
        message: manual ? `Manual save by ${user.name}` : undefined,
      });

      setDirty(false);

      if (result.committed) {
        notifySaved(repoId, result);
        if (manual) toast.success(`Saved — ${result.hash}`);
      }
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      savingRef.current = false;
    }
  }, [repoId, document, isDirty, user]);

  // Auto-save timer
  useEffect(() => {
    if (!repoId) return;
    timerRef.current = setInterval(() => save(false), intervalSeconds * 1000);
    return () => clearInterval(timerRef.current);
  }, [repoId, intervalSeconds, save]);

  return { save };
}
