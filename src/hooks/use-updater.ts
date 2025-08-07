import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';

export function useUpdater() {
  const checkForUpdates = async () => {
    try {
      const update = await check();
      if (update?.available) {
        const wantsToUpdate = await ask(`Version ${update.version} is available. Do you want to install it?`, {
          title: 'Update Available',
          okLabel: 'Install',
          cancelLabel: 'Later',
        });
        if (wantsToUpdate) {
          await update.downloadAndInstall();
          // Explicitly restart the app after the update
          await relaunch();
        }
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  };

  return { checkForUpdates };
}