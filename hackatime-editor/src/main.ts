import '@vscode/codicons/dist/codicon.css';
import './styles.css';
import { Preferences } from '@capacitor/preferences';
import { EditorApp } from './ui/app';
import { Tracker } from './core/tracker/tracker';
import { WakaCli } from './native/wakacli';
import { wordCountPlugin } from './plugins/wordCount';

async function main(): Promise<void> {
  const tracker = new Tracker(WakaCli, {
    get: async (key) => (await Preferences.get({ key })).value,
    set: async (key, value) => Preferences.set({ key, value }),
  });
  const app = new EditorApp(document.getElementById('app')!, tracker);
  await tracker.init();
  await app.start([wordCountPlugin]);

  // First launch: show Settings. When a key exists but was never verified,
  // run "Test tracking" once and show the result.
  const seen = await Preferences.get({ key: 'firstLaunchDone' });
  if (!seen.value || tracker.needsFirstTest()) {
    await Preferences.set({ key: 'firstLaunchDone', value: 'yes' });
    if (tracker.needsFirstTest()) await app.firstLaunchTest();
    else if (!tracker.getState().on) app.openPage('settings');
  }
}

main().catch((e) => {
  document.body.textContent = `Startup failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`;
});
