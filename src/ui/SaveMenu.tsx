import { getSaveText, loadSaveText, status } from '../bridge/client';
import { gunzipIfNeeded, gzip, platform } from '../platform';
import { dayToDate } from '../sim/calendar';
import { showToast } from './App';

const QUICK_SLOT = 'save:quick';

async function guard(label: string, fn: () => Promise<string | void>) {
  try {
    const msg = await fn();
    if (msg) showToast(msg);
  } catch (e) {
    showToast(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function fileName() {
  const d = dayToDate(status.value.day);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `interregnum-${d.year}-${pad(d.month)}-${pad(d.day)}.json.gz`;
}

const save = () => guard('Save', async () => {
  await platform.storage.set(QUICK_SLOT, await gzip(await getSaveText()));
  return 'Game saved';
});

const load = () => guard('Load', async () => {
  const bytes = await platform.storage.get(QUICK_SLOT);
  if (!bytes) return 'No saved game yet';
  await loadSaveText(await gunzipIfNeeded(bytes));
  return 'Game loaded';
});

const exportFile = () => guard('Export', async () => {
  await platform.files.save(fileName(), await gzip(await getSaveText()), 'application/gzip');
});

const importFile = () => guard('Import', async () => {
  const bytes = await platform.files.open('.gz,.json');
  if (!bytes) return;
  await loadSaveText(await gunzipIfNeeded(bytes));
  return 'Save file imported';
});

export function SaveMenu() {
  return (
    <nav class="save-menu panel" aria-label="Saves">
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
      <button title="Download a save file, e.g. to attach to a bug report" onClick={exportFile}>Export</button>
      <button title="Load a save file from disk" onClick={importFile}>Import</button>
    </nav>
  );
}
