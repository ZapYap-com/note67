import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useState, useCallback, useRef } from 'react';

interface UpdateState {
  checking: boolean;
  available: boolean;
  version: string | null;
  body: string | null;
  downloading: boolean;
  progress: number;
  error: string | null;
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({
    checking: false,
    available: false,
    version: null,
    body: null,
    downloading: false,
    progress: 0,
    error: null,
  });

  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    setState(s => ({ ...s, checking: true, error: null }));
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setState(s => ({
          ...s,
          checking: false,
          available: true,
          version: update.version,
          body: update.body || null,
        }));
        return true;
      } else {
        setState(s => ({ ...s, checking: false, available: false }));
        return false;
      }
    } catch (error) {
      setState(s => ({
        ...s,
        checking: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) {
      setState(s => ({ ...s, error: 'No update available' }));
      return;
    }

    setState(s => ({ ...s, downloading: true, progress: 0, error: null }));

    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            const progress = Math.round((downloaded / contentLength) * 100);
            setState(s => ({ ...s, progress }));
          }
        } else if (event.event === 'Finished') {
          setState(s => ({ ...s, progress: 100 }));
        }
      });

      await relaunch();
    } catch (error) {
      setState(s => ({
        ...s,
        downloading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setState(s => ({ ...s, available: false, version: null, body: null }));
    updateRef.current = null;
  }, []);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}
