import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';

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
          // The app will restart automatically after the update
        }
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  };

  return { checkForUpdates };
}