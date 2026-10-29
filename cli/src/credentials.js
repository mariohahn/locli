import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {NodeJS.ProcessEnv} env */
export function credentialsFile(env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'locli', 'credentials.json');
}

/**
 * @typedef {{ token: string, tokenID?: string, email?: string }} Credential
 * @param {NodeJS.ProcessEnv} env @returns {Record<string, Credential>}
 */
export function loadCredentials(env) {
  try {
    const data = JSON.parse(fs.readFileSync(credentialsFile(env), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Writes with 0600 in a 0700 directory so the token is never readable by others. */
export function saveCredentials(/** @type {NodeJS.ProcessEnv} */ env, /** @type {Record<string, Credential>} */ credentials) {
  const file = credentialsFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* not owner / Windows */ }
  const descriptor = fs.openSync(file, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(credentials, null, 2) + '\n');
  } finally {
    fs.closeSync(descriptor);
  }
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  return file;
}

/**
 * LOCLI_TOKEN > LOCALIZE_TOKEN > stored credential for this API URL.
 * @param {string} apiURL @param {NodeJS.ProcessEnv} env
 * @returns {{ token: string, source: 'env' | 'stored' } | null}
 */
export function resolveToken(apiURL, env) {
  const fromEnv = env.LOCLI_TOKEN || env.LOCALIZE_TOKEN;
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const stored = loadCredentials(env)[apiURL.replace(/\/+$/, '')];
  return stored?.token ? { token: stored.token, source: 'stored' } : null;
}
