import { create } from 'zustand';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

interface UpdaterState {
  checking: boolean;
  available: boolean;
  version: string | null;
  body: string | null;
  downloading: boolean;
  progress: number;
  error: string | null;
  update: Update | null;
  checkForUpdates: () => Promise<boolean>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  checking: false,
  available: false,
  version: null,
  body: null,
  downloading: false,
  progress: 0,
  error: null,
  update: null,

  checkForUpdates: async () => {
    set({ checking: true, error: null });
    try {
      const update = await check();
      if (update) {
        set({
          checking: false,
          available: true,
          version: update.version,
          body: update.body || null,
          update,
        });
        return true;
      } else {
        set({ checking: false, available: false });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let friendlyError = message;
      if (message.includes('fetch') || message.includes('JSON') || message.includes('network')) {
        friendlyError = 'Unable to check for updates. Please try again later.';
      } else if (message.includes('offline')) {
        friendlyError = 'No internet connection.';
      }
      set({ checking: false, error: friendlyError });
      return false;
    }
  },

  downloadAndInstall: async () => {
    const { update } = get();
    if (!update) {
      set({ error: 'No update available' });
      return;
    }

    set({ downloading: true, progress: 0, error: null });

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
            set({ progress });
          }
        } else if (event.event === 'Finished') {
          set({ progress: 100 });
        }
      });

      await relaunch();
    } catch (error) {
      set({
        downloading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  dismissUpdate: () => {
    set({ available: false, version: null, body: null, update: null });
  },
}));
