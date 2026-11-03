// community: what the project's community suggested in the public catalog, and the team's decisions.
import { openConfig } from '../context.js';
import { requireProject } from '../remote.js';
import { LocliError, plural } from '../util.js';

const STATUSES = ['open', 'accepted', 'rejected', 'hidden'];

/**
 * Lists suggestions (default: open, the most voted first), or decides one: --accept ID makes it the working
 * text (it ships with the next approved release), --reject ID declines it, --hide ID removes spam publicly.
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, locale?: string, status?: string, accept?: string, reject?: string, hide?: string, note?: string }} flags
 */
export async function community(ctx, flags) {
  const { config, api } = openConfig(ctx, flags);
  const project = await requireProject(api, config.project);
  const decisions = [['accept', flags.accept], ['reject', flags.reject], ['hide', flags.hide]].filter(([, id]) => id);
  if (decisions.length > 1) throw new LocliError('Pass only one of --accept, --reject or --hide.', 2);
  if (decisions.length) {
    const [decision, id] = /** @type {[string, string]} */ (decisions[0]);
    return review(ctx, api, project, { id, decision, note: flags.note, json: flags.json });
  }
  const status = flags.status ?? 'open';
  if (!STATUSES.includes(status)) throw new LocliError(`--status must be one of ${STATUSES.join(', ')}.`, 2);
  const settings = await api.get(`/api/projects/${project.id}/community`);
  const query = new URLSearchParams({ status });
  if (flags.locale) query.set('locale', flags.locale);
  const suggestions = await api.get(`/api/projects/${project.id}/community/suggestions?${query}`);
  const result = { enabled: settings.enabled, path: settings.path, locales: settings.locales, suggestions };
  if (flags.json) { ctx.out(JSON.stringify(result, null, 2)); return result; }
  ctx.out(settings.enabled ? `Community catalog: ${api.baseURL ?? ''}${settings.path}` : 'The community catalog is off (switch it on in locli under Community).');
  if (!suggestions.length) { ctx.out(`No ${status} suggestions.`); return result; }
  ctx.out(`${plural(suggestions.length, `${status} suggestion`)}, the most voted first:`);
  for (const s of suggestions) {
    ctx.out(`- ${s.id}  ${s.key} (${s.locale})  score ${s.score}, ${plural(s.votes, 'vote')}${s.authorName ? `, by ${s.authorName}` : ''}`);
    ctx.out(`    source:     ${s.source}`);
    ctx.out(`    now:        ${s.current ?? '(missing)'}`);
    ctx.out(`    suggestion: ${s.text}`);
    for (const c of s.discussion) ctx.out(`    comment:    ${c.text}${c.authorName ? ` (${c.authorName})` : ''}`);
  }
  return result;
}

/**
 * @param {import('../context.js').Context} ctx @param {any} api @param {{ id: string, slug: string }} project
 * @param {{ id: string, decision: string, note?: string, json?: boolean }} input
 */
export async function review(ctx, api, project, input) {
  const base = `/api/projects/${project.id}/community/suggestions/${encodeURIComponent(input.id)}`;
  if (input.decision === 'accept') await api.post(`${base}/accept`, { note: input.note });
  else if (input.decision === 'reject' || input.decision === 'hide') await api.post(`${base}/reject`, { note: input.note, hide: input.decision === 'hide' });
  else throw new LocliError('decision must be accept, reject or hide.', 2);
  const message = input.decision === 'accept'
    ? `Accepted ${input.id}: it is the working text now and waits for the next approved release.`
    : input.decision === 'hide' ? `Hid ${input.id} from the public catalog.` : `Rejected ${input.id}.`;
  if (input.json) ctx.out(JSON.stringify({ id: input.id, decision: input.decision }, null, 2)); else ctx.out(message);
  return { id: input.id, decision: input.decision, message };
}
