// Corre las pruebas de integración contra el emulador de Firestore (Windows, macOS y Linux).
import { spawnSync } from 'node:child_process';

const env = { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '.firebase-config', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true' };
const result = spawnSync('npx', ['firebase', 'emulators:exec', '--project', 'demo-roka-sync', '--only', 'firestore', process.platform === 'win32' ? '"node --test tests/sync-emulator.test.mjs"' : 'node --test tests/sync-emulator.test.mjs'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
});
process.exit(result.status ?? 1);
