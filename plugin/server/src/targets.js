import path from 'node:path';
import { readXcstrings } from './formats/xcstrings.js';
import { readAndroid } from './formats/android.js';
import { readJsonTarget } from './formats/json.js';
import { LocliError } from './util.js';

/**
 * Reads a target's local texts.
 * @param {string} root config directory @param {import('./config.js').Target} target @param {string} sourceLanguage
 * @returns {import('./formats/model.js').LocalTexts}
 */
export function readTarget(root, target, sourceLanguage) {
  if (target.format === 'xcstrings') return readXcstrings(path.resolve(root, target.path));
  if (target.format === 'android-xml') return readAndroid(path.resolve(root, target.path), { sourceLanguage, file: target.file });
  if (target.format === 'json') return readJsonTarget(root, target);
  throw new LocliError(`Unsupported target format ${target.format}`);
}

/** @param {import('./config.js').Target} target */
export function describeTarget(target) {
  return `${target.platform} ${target.path}${target.file ? ` (${target.file})` : ''}`;
}

/**
 * @param {import('./config.js').Target[]} targets @param {string | undefined} platform
 */
export function selectTargets(targets, platform) {
  if (!targets.length) {
    throw new LocliError('locli.json has no targets. Add one (e.g. {"platform":"web","format":"json","path":"messages/{locale}.json"}) or rerun `npx @locli/cli init --target platform:format:path`.');
  }
  if (!platform) return targets;
  const selected = targets.filter((t) => t.platform === platform || t.path === platform);
  if (!selected.length) throw new LocliError(`No target for "${platform}" in locli.json (targets: ${targets.map((t) => t.platform).join(', ')}).`, 2);
  return selected;
}
