// context: where each key is used in the code, as what (toolbar item, button, push notification …),
// its length budget, and translations in the files that exceed it. Local only; needs no server.
import { openConfig } from '../context.js';
import { readTarget, selectTargets } from '../targets.js';
import { keyContext, scanUsages } from '../usage.js';
import { normalizeLocale, plural } from '../util.js';

/** A plural or array text is as long as its longest form. */
function lengthOf(/** @type {import('../formats/model.js').LocalEntry | undefined} */ entry) {
  if (!entry) return 0;
  const texts = entry.forms ? Object.values(entry.forms) : entry.items ?? [entry.value];
  return Math.max(0, ...texts.map((text) => [...String(text ?? '')].length));
}

/**
 * Scans the code once for the keys of every target.
 * @param {string} dir the directory of locli.json @param {{ target: any, texts: import('../formats/model.js').LocalTexts }[]} local
 * @param {string} sourceLanguage
 */
export function usageReport(dir, local, sourceLanguage) {
  /** @type {Map<string, { source: import('../formats/model.js').LocalEntry | undefined, platforms: Set<string>, values: Map<string, import('../formats/model.js').LocalEntry> }>} */
  const keys = new Map();
  for (const { target, texts } of local) {
    const sourceCode = Object.keys(texts.locales).find((code) => normalizeLocale(code) === normalizeLocale(sourceLanguage));
    for (const key of texts.keys) {
      const entry = keys.get(key) ?? { source: undefined, platforms: new Set(), values: new Map() };
      entry.platforms.add(target.platform);
      entry.source ??= sourceCode ? texts.locales[sourceCode][key] : undefined;
      for (const [code, values] of Object.entries(texts.locales)) if (code !== sourceCode && values[key] && !entry.values.has(code)) entry.values.set(code, values[key]);
      keys.set(key, entry);
    }
  }
  const usages = scanUsages(dir, keys.keys());
  const contexts = [];
  const unused = [];
  const tooLong = [];
  for (const [key, entry] of [...keys].sort(([a], [b]) => a.localeCompare(b))) {
    const uses = usages.get(key);
    if (!uses) { unused.push(key); continue; }
    const sourceText = entry.source?.forms ? Object.values(entry.source.forms).sort((a, b) => b.length - a.length)[0] : entry.source?.value;
    const context = { key, platforms: [...entry.platforms].sort(), ...keyContext(uses, sourceText) };
    contexts.push(context);
    if (!context.maxChars) continue;
    for (const [locale, value] of entry.values) {
      const length = lengthOf(value);
      if (length > context.maxChars) tooLong.push({ key, locale, length, maxChars: context.maxChars, role: context.label, text: value.forms?.other ?? value.value });
    }
  }
  return { keys: contexts, unused, tooLong };
}

/** One line per issue, shared with push. @param {{ key: string, locale: string, length: number, maxChars: number, role: string | null, text: string }} issue */
export const describeTooLong = (issue) => `${issue.key} (${issue.locale}): ${issue.length} characters, a ${issue.role} fits about ${issue.maxChars}: “${issue.text}”`;

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, key?: string, target?: string }} flags
 */
export async function context(ctx, flags) {
  const { loaded, config } = openConfig(ctx, flags);
  const local = selectTargets(config.targets, flags.target).map((target) => ({ target, texts: readTarget(loaded.dir, target, config.sourceLanguage) }));
  const report = usageReport(loaded.dir, local, config.sourceLanguage);
  if (flags.key) {
    const match = (/** @type {string} */ key) => key === flags.key || key.startsWith(`${flags.key}_`) || key.startsWith(`${flags.key}.`);
    report.keys = report.keys.filter((k) => match(k.key));
    report.unused = report.unused.filter(match);
    report.tooLong = report.tooLong.filter((issue) => match(issue.key));
  }
  if (flags.json) { ctx.out(JSON.stringify(report, null, 2)); return report; }
  const total = report.keys.length + report.unused.length;
  ctx.out(`${plural(report.keys.length, 'key')} of ${total} found in the code:`);
  const width = Math.min(36, Math.max(8, ...report.keys.map((k) => k.key.length)));
  for (const k of report.keys) {
    const role = k.label ? `${k.label}${k.maxChars ? ` ≤ ${k.maxChars}` : ''}` : 'unknown use';
    const where = `${k.uses[0].file}:${k.uses[0].line}${k.uses.length > 1 ? ` (+${k.uses.length - 1})` : ''}`;
    ctx.out(`  ${k.key.padEnd(width)}  ${role.padEnd(30)}  ${where}`);
  }
  if (report.unused.length) {
    ctx.out(`${plural(report.unused.length, 'key')} not found in the code (unused, or the key is built at runtime): ${report.unused.slice(0, 20).join(', ')}${report.unused.length > 20 ? ' …' : ''}`);
  }
  if (report.tooLong.length) {
    ctx.out(`${plural(report.tooLong.length, 'translation')} longer than the place they are used in:`);
    for (const issue of report.tooLong.slice(0, 30)) ctx.out(`  ${describeTooLong(issue)}`);
  } else if (report.keys.some((k) => k.maxChars)) ctx.out('Every translation fits its length budget.');
  return report;
}
