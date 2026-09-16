export const STORAGE_KEYS = Object.freeze({
  vault: 'passman_encrypted_vault_v2',
  masterWrapper: 'passman_master_wrapper_v1',
  recoveryWrapper: 'passman_recovery_wrapper_v1',
  theme: 'passman_theme',
  session: 'passman_session_expires'
});

export function readJson(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || ''); } catch { return fallback; }
}

export function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
