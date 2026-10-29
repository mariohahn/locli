// guide: the project's translation guide (tone per language, glossary) and the texts that break it.
import fs from 'node:fs';
import path from 'node:path';
import { openConfig } from '../context.js';
import { requireProject } from '../remote.js';
import { LocliError, plural } from '../util.js';

/** Whole-word match, so "Pro" doesn't match "Profile"; the backend's Glossary.contains. */
/** @param {string} text @param {string} term @param {boolean} caseSensitive */
function containsWord(text, term, caseSensitive) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, caseSensitive ? 'u' : 'iu').test(text);
}

/**
 * Glossary terms of `source` that `translation` doesn't carry over: keep-terms as written, others in
 * one of their accepted forms ("anmelden | melde dich an").
 * @param {string} source @param {string} translation @param {string} locale @param {{ terms: any[] }} guide
 */
export function glossaryMisses(source, translation, locale, guide) {
  if (!translation?.trim()) return [];
  return (guide.terms ?? []).flatMap((term) => {
    if (!containsWord(source, term.term, false)) return [];
    if (term.keep) return containsWord(translation, term.term, true) ? [] : [{ term: term.term, message: `“${term.term}” must stay “${term.term}”.` }];
    const forms = String(term.translations?.[locale.toLowerCase()] ?? '').split('|').map((form) => form.trim()).filter(Boolean);
    return !forms.length || forms.some((form) => containsWord(translation, form, false)) ? [] : [{ term: term.term, message: `“${term.term}” should be “${forms.join('” or “')}”.` }];
  });
}

/**
 * Reads the guide and the glossary issues of the current texts; older servers have neither.
 * @param {any} api @param {string} projectID
 * @returns {Promise<{ guide: { tone: Record<string, string>, terms: any[] }, issues: any[] } | null>}
 */
export async function loadGuide(api, projectID) {
  try {
    const [guide, issues] = await Promise.all([api.get(`/api/projects/${projectID}/guide`), api.get(`/api/projects/${projectID}/guide/issues`)]);
    return { guide: { tone: guide?.tone ?? {}, terms: guide?.terms ?? [] }, issues: Array.isArray(issues) ? issues : [] };
  } catch { return null; }
}

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, set?: string }} flags
 */
export async function guide(ctx, flags) {
  const { config, api } = openConfig(ctx, flags);
  const project = await requireProject(api, config.project);
  if (flags.set) {
    const file = path.resolve(ctx.cwd, flags.set);
    let body;
    try { body = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
      throw new LocliError(`Cannot read ${flags.set}: ${/** @type {Error} */ (error).message}`, 2);
    }
    if (body?.guide) body = body.guide; // accept the output of `locli guide --json`
    await api.put(`/api/projects/${project.id}/guide`, { tone: body?.tone ?? {}, terms: body?.terms ?? [] });
  }
  const loaded = await loadGuide(api, project.id);
  if (!loaded) throw new LocliError('This locli server has no translation guide yet.');
  if (flags.json) { ctx.out(JSON.stringify(loaded, null, 2)); return loaded; }
  const { guide: g, issues } = loaded;
  if (flags.set) ctx.out(`Saved the translation guide of ${config.project}.`);
  if (!Object.keys(g.tone).length && !g.terms.length) {
    ctx.out(`${config.project} has no translation guide yet. Add tone and glossary in the project settings, or with locli guide --set guide.json.`);
    return loaded;
  }
  if (Object.keys(g.tone).length) {
    ctx.out('Tone:');
    for (const [code, text] of Object.entries(g.tone)) ctx.out(`  ${code.padEnd(6)} ${text}`);
  }
  if (g.terms.length) {
    ctx.out(`Glossary (${plural(g.terms.length, 'term')}):`);
    const width = Math.min(24, Math.max(...g.terms.map((t) => t.term.length)));
    for (const t of g.terms) {
      const rule = t.keep ? 'keep as written' : Object.entries(t.translations ?? {}).map(([code, text]) => `${code}: ${text}`).join(' · ') || 'no fixed translation';
      ctx.out(`  ${t.term.padEnd(width)}  ${rule}${t.note ? ` (${t.note})` : ''}`);
    }
  }
  if (issues.length) {
    ctx.out(`${plural(issues.length, 'glossary issue')}:`);
    for (const issue of issues.slice(0, 50)) ctx.out(`  ${issue.key} (${issue.locale}): ${issue.message}`);
    if (issues.length > 50) ctx.out(`  … and ${issues.length - 50} more (--json lists all)`);
  } else if (g.terms.length) ctx.out('Every translation follows the glossary.');
  return loaded;
}
