import { useUpdaterStore } from '../stores/updaterStore';

export function useUpdater() {
  const {
    checking,
    available,
    version,
    body,
    downloading,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  } = useUpdaterStore();

  return {
    checking,
    available,
    version,
    body,
    downloading,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
}
