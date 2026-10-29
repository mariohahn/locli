// areas: the project's feature areas (first key segment), and which one a new feature's texts belong to.
import { openConfig } from '../context.js';
import { requireProject, projectDetail } from '../remote.js';
import { areaOf, plural } from '../util.js';

/** Words that name the same feature area, so "login" finds an existing auth_ or signin_ area. */
const SYNONYMS = [
  ['login', 'signin', 'sign', 'auth', 'logon', 'account'],
  ['signup', 'register', 'registration', 'onboarding'],
  ['settings', 'preferences', 'prefs', 'options'],
  ['paywall', 'plan', 'billing', 'subscription', 'pricing', 'purchase'],
  ['profile', 'account', 'user'],
  ['error', 'errors', 'alert', 'alerts'],
  ['notification', 'notifications', 'push'],
  ['search', 'filter', 'filters'],
];

const slug = (/** @type {string} */ text) => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, feature?: string }} flags
 */
export async function areas(ctx, flags) {
  const { config, api } = openConfig(ctx, flags);
  const project = await requireProject(api, config.project);
  const detail = await projectDetail(api, project.id);
  /** @type {Map<string, string[]>} */
  const byArea = new Map();
  for (const key of detail.keys) {
    if (key.storeField) continue;
    const area = areaOf(key.key);
    byArea.set(area, [...(byArea.get(area) ?? []), key.key]);
  }
  const list = [...byArea].map(([area, keys]) => ({ area, keys: keys.length, examples: keys.sort().slice(0, 5) })).sort((a, b) => a.area.localeCompare(b.area));
  /** @type {{ feature: string, area: string, exists: boolean, matchedBy: string, examples: string[], hint: string } | null} */
  let suggestion = null;
  if (flags.feature) {
    const wanted = slug(flags.feature);
    const words = wanted.split('_').filter(Boolean);
    const related = new Set(words.flatMap((word) => SYNONYMS.find((group) => group.includes(word)) ?? [word]));
    const exact = list.find((entry) => entry.area === wanted || words.includes(entry.area));
    const similar = exact ?? list.filter((entry) => related.has(entry.area)).sort((a, b) => b.keys - a.keys)[0];
    if (similar) {
      suggestion = { feature: flags.feature, area: similar.area, exists: true, matchedBy: exact ? 'name' : 'synonym', examples: similar.examples,
        hint: `Use the existing area "${similar.area}" (${plural(similar.keys, 'key')}): name new keys ${similar.area}_<element>, e.g. ${similar.area}_username_label, and reuse keys that already mean the same thing.` };
    } else {
      const area = words[0] ?? wanted;
      suggestion = { feature: flags.feature, area, exists: false, matchedBy: 'new', examples: [],
        hint: `No area matches "${flags.feature}". Start the new area "${area}" by naming keys ${area}_<element> (e.g. ${area}_title); it is created with the first push.` };
    }
  }
  const result = { project: config.project, areas: list, suggestion };
  if (flags.json) { ctx.out(JSON.stringify(result, null, 2)); return result; }
  if (suggestion) ctx.out(suggestion.hint);
  if (!flags.feature || !suggestion?.exists) {
    ctx.out(`${plural(list.length, 'area')} in ${config.project}:`);
    for (const entry of list) ctx.out(`  ${entry.area.padEnd(18)} ${String(entry.keys).padStart(4)}  ${entry.examples.slice(0, 3).join(', ')}`);
  }
  return result;
}
