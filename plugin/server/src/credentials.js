import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {NodeJS.ProcessEnv} env */
export function credentialsFile(env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'locli', 'credentials.json');
}

/**
 * Agent tools often run with their own XDG_CONFIG_HOME (OpenCode, sandboxes), so a login made in
 * the user's terminal sits in ~/.config. Reading falls back to it; writing stays in credentialsFile.
 * @param {NodeJS.ProcessEnv} env @returns {string[]}
 */
function readableFiles(env) {
  const files = [credentialsFile(env)];
  if (env.XDG_CONFIG_HOME && env.HOME) {
    const home = path.join(env.HOME, '.config', 'locli', 'credentials.json');
    if (home !== files[0]) files.push(home);
  }
  return files;
}

/** @param {string} file */
function readFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * @typedef {{ token: string, tokenID?: string, email?: string }} Credential
 * @param {NodeJS.ProcessEnv} env @returns {Record<string, Credential>}
 */
export function loadCredentials(env) {
  return readFile(credentialsFile(env));
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
 * LOCLI_TOKEN > LOCALIZE_TOKEN > stored credential for this API URL ($XDG_CONFIG_HOME, then ~/.config).
 * @param {string} apiURL @param {NodeJS.ProcessEnv} env
 * @returns {{ token: string, source: 'env' | 'stored', file?: string } | null}
 */
export function resolveToken(apiURL, env) {
  const fromEnv = env.LOCLI_TOKEN || env.LOCALIZE_TOKEN;
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const key = apiURL.replace(/\/+$/, '');
  for (const file of readableFiles(env)) {
    const stored = readFile(file)[key];
    if (stored?.token) return { token: stored.token, source: 'stored', file };
  }
  return null;
}
