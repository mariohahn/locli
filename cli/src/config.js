import fs from 'node:fs';
import path from 'node:path';
import { LocliError } from './util.js';

export const CONFIG_FILE = 'locli.json';
export const SCHEMA_URL = 'https://locli.dev/schema/locli.json';
export const DEFAULT_API_URL = 'https://locli.dev';
export const PLATFORMS = ['ios', 'android', 'web', 'backend'];
export const FORMATS = { ios: ['xcstrings'], android: ['android-xml'], web: ['json'], backend: ['json'] };

/**
 * @typedef {{ platform: 'ios' | 'android' | 'web' | 'backend', format: 'xcstrings' | 'android-xml' | 'json', path: string, file?: string, keyPrefix?: string }} Target
 * @typedef {{ $schema?: string, apiURL?: string, project: string, name?: string, sourceLanguage: string, targets: Target[] }} Config
 * @typedef {{ file: string, dir: string, data: Config }} LoadedConfig
 */

/**
 * Finds the config: explicit path, LOCLI_CONFIG, or the nearest locli.json upwards from cwd.
 * @param {string} cwd @param {NodeJS.ProcessEnv} env @param {string} [explicit]
 */
export function findConfig(cwd, env, explicit) {
  const given = explicit ?? env.LOCLI_CONFIG;
  if (given) return path.resolve(cwd, given);
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** @param {unknown} target @param {number} index @returns {Target} */
export function validateTarget(target, index = 0) {
  const t = /** @type {any} */ (target);
  const where = `targets[${index}]`;
  if (!t || typeof t !== 'object') throw new LocliError(`${CONFIG_FILE}: ${where} must be an object`);
  if (!PLATFORMS.includes(t.platform)) throw new LocliError(`${CONFIG_FILE}: ${where}.platform must be one of ${PLATFORMS.join(', ')}`);
  const formats = FORMATS[/** @type {keyof typeof FORMATS} */ (t.platform)];
  if (!formats.includes(t.format)) throw new LocliError(`${CONFIG_FILE}: ${where}.format for ${t.platform} must be ${formats.join(' or ')}`);
  if (typeof t.path !== 'string' || !t.path.trim()) throw new LocliError(`${CONFIG_FILE}: ${where}.path is required`);
  if (t.format === 'json' && !t.path.includes('{locale}')) throw new LocliError(`${CONFIG_FILE}: ${where}.path needs a {locale} placeholder, e.g. messages/{locale}.json`);
  return t;
}

/**
 * @param {string | null} file
 * @returns {LoadedConfig}
 */
export function loadConfig(file) {
  if (!file || !fs.existsSync(file)) {
    throw new LocliError(`No ${CONFIG_FILE} found. Run \`npx @locli/cli init\` in the app's repository root first.`);
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    throw new LocliError(`${file}: invalid JSON (${/** @type {Error} */ (error).message})`);
  }
  if (!data || typeof data !== 'object') throw new LocliError(`${file}: expected an object`);
  if (typeof data.project !== 'string' || !data.project) throw new LocliError(`${CONFIG_FILE}: "project" (the project slug) is required`);
  if (typeof data.sourceLanguage !== 'string' || !data.sourceLanguage) throw new LocliError(`${CONFIG_FILE}: "sourceLanguage" is required`);
  data.targets = Array.isArray(data.targets) ? data.targets.map(validateTarget) : [];
  return { file, dir: path.dirname(file), data };
}

/** @param {string} file @param {Config} config */
export function saveConfig(file, config) {
  const ordered = {
    $schema: SCHEMA_URL,
    apiURL: config.apiURL,
    project: config.project,
    ...(config.name ? { name: config.name } : {}),
    sourceLanguage: config.sourceLanguage,
    targets: config.targets.map((t) => ({ platform: t.platform, format: t.format, path: t.path, ...(t.file ? { file: t.file } : {}), ...(t.keyPrefix ? { keyPrefix: t.keyPrefix } : {}) })),
  };
  const content = JSON.stringify(ordered, null, 2) + '\n';
  let previous = null;
  try { previous = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  if (previous !== content) fs.writeFileSync(file, content);
  return previous !== content;
}

/**
 * `--api-url` > LOCLI_API_URL > LOCALIZE_API_URL > config apiURL > https://locli.dev
 * @param {{ apiUrl?: string }} flags @param {NodeJS.ProcessEnv} env @param {Partial<Config>} [config]
 */
export function resolveApiURL(flags, env, config) {
  const value = flags.apiUrl || env.LOCLI_API_URL || env.LOCALIZE_API_URL || config?.apiURL || DEFAULT_API_URL;
  return value.replace(/\/+$/, '');
}

/**
 * Parses `platform:format:path` (format optional: `android:app/src/main/res`).
 * @param {string} spec
 * @returns {Target}
 */
export function parseTargetSpec(spec) {
  const parts = spec.split(':');
  if (parts.length < 2) throw new LocliError(`--target must be platform:format:path, e.g. web:json:messages/{locale}.json (got "${spec}")`, 2);
  const platform = parts[0];
  let format;
  let rest;
  const formats = FORMATS[/** @type {keyof typeof FORMATS} */ (platform)];
  if (formats && formats.includes(parts[1])) { format = parts[1]; rest = parts.slice(2).join(':'); } else { format = formats?.[0]; rest = parts.slice(1).join(':'); }
  try {
    return validateTarget({ platform, format, path: rest });
  } catch (error) {
    throw new LocliError(`--target ${spec}: ${/** @type {Error} */ (error).message.replace(`${CONFIG_FILE}: targets[0].`, '')}`, 2);
  }
}
