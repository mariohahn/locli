// init: detect the stack, write locli.json and agent instructions, create the project in locli.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { CONFIG_FILE, findConfig, saveConfig, resolveApiURL, parseTargetSpec, validateTarget } from '../config.js';
import { detectTargets, SETUP_HINTS } from '../detect.js';
import { writeAgentFiles } from '../agents.js';
import { readTarget, describeTarget } from '../targets.js';
import { Api, NOT_LOGGED_IN } from '../http.js';
import { findProject, projectDetail, ensurePlatforms, ensureLocales, projectURL } from '../remote.js';
import { LocliError, slugify, normalizeLocale } from '../util.js';

/** @param {string} dir */
function repoRoot(dir) {
  try {
    const result = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && result.stdout.trim()) return path.resolve(result.stdout.trim());
  } catch { /* no git */ }
  return path.resolve(dir);
}

/** @param {string} file */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The Python CLI's Config/localize.json, if the app used it. @param {string} root */
function legacyConfig(root) {
  for (const candidate of ['Config/localize.json', 'config/localize.json', 'localize.json']) {
    const file = path.join(root, candidate);
    const data = readJson(file);
    if (data?.slug) {
      const target = data.catalog ? { platform: 'ios', format: 'xcstrings', path: path.relative(root, path.resolve(path.dirname(file), data.catalog)).split(path.sep).join('/') } : null;
      return { file: candidate, apiURL: data.apiURL, name: data.name, slug: data.slug, sourceLanguage: data.sourceLanguage, target };
    }
  }
  return null;
}

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ name?: string, slug?: string, source?: string, yes?: boolean, agentFiles?: boolean, target?: string[], apiUrl?: string, config?: string }} flags
 */
export async function init(ctx, flags) {
  const found = findConfig(ctx.cwd, ctx.env, flags.config);
  const existingFile = found && fs.existsSync(found) ? found : null;
  const root = existingFile ? path.dirname(existingFile) : repoRoot(ctx.cwd);
  const file = existingFile ?? path.join(root, CONFIG_FILE);
  const existing = existingFile ? readJson(existingFile) : null;
  if (existingFile && !existing) throw new LocliError(`${existingFile}: invalid JSON; fix or delete it and rerun init.`);
  const legacy = existing ? null : legacyConfig(root);
  const detected = detectTargets(root);

  /** @type {import('../config.js').Target[]} */
  let targets;
  // --target paths are typed relative to where init runs; the config lives at the repo root.
  if (flags.target?.length) targets = flags.target.map(parseTargetSpec).map((t) => ({ ...t, path: path.relative(root, path.resolve(ctx.cwd, t.path)).split(path.sep).join('/') }));
  else if (existing?.targets?.length) targets = existing.targets.map(validateTarget);
  else targets = detected.targets;
  if (!flags.target?.length && legacy?.target && !targets.some((t) => t.path === legacy.target?.path)) targets = [/** @type {any} */ (legacy.target), ...targets];

  const packageName = readJson(path.join(root, 'package.json'))?.name?.replace(/^@[^/]+\//, '');
  let name = flags.name ?? existing?.name ?? legacy?.name ?? packageName ?? path.basename(root);
  let sourceLanguage = flags.source ?? existing?.sourceLanguage ?? legacy?.sourceLanguage ?? detected.sourceLanguage;
  if (ctx.interactive && !flags.yes && !existing) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      if (!flags.name && !flags.slug) name = (await rl.question(`Project name (${name}): `)).trim() || name;
      if (!sourceLanguage) sourceLanguage = (await rl.question('Source language (en): ')).trim() || 'en';
    } finally { rl.close(); }
  }
  sourceLanguage ??= 'en';
  const slug = slugify(flags.slug ?? existing?.project ?? legacy?.slug ?? name);
  if (!slug) throw new LocliError('Could not derive a project slug; pass --slug my-app', 2);
  const apiURL = resolveApiURL(flags, ctx.env, existing ?? legacy ?? undefined);
  const config = { apiURL, project: slug, sourceLanguage, targets };

  const wrote = saveConfig(file, config);
  ctx.out(`${wrote ? (existingFile ? 'Updated' : 'Wrote') : 'Kept'} ${path.relative(ctx.cwd, file) || CONFIG_FILE}: project ${slug}, source language ${sourceLanguage}.`);
  if (legacy) ctx.out(`Imported settings from ${legacy.file} (the Python CLI's config).`);
  for (const note of detected.notes) ctx.info(note);
  if (targets.length) for (const t of targets) ctx.out(`  target ${describeTarget(t)}`);
  else {
    ctx.out('No localization files found yet. Create the source-language file for your stack, then rerun init:');
    for (const hint of SETUP_HINTS) ctx.out(`  - ${hint}`);
  }
  if (flags.agentFiles !== false) for (const change of writeAgentFiles(root, config)) ctx.out(`  ${change}`);

  // Remote setup: project, platforms, languages.
  const api = new Api(apiURL, { env: ctx.env, fetch: ctx.fetch });
  if (!api.token) throw new LocliError(`${NOT_LOGGED_IN} Then rerun \`npx @locli/cli init\` to create the project in locli.`);
  let project = await findProject(api, slug);
  let created = false;
  if (!project) {
    project = await api.post('/api/projects', { name, slug, defaultLocale: sourceLanguage });
    created = true;
    if (project.slug !== slug) { config.project = project.slug; saveConfig(file, config); }
  }
  const detail = await projectDetail(api, project.id);
  if (normalizeLocale(detail.defaultLocale) !== normalizeLocale(sourceLanguage)) {
    throw new LocliError(`Project ${detail.slug} uses source language ${detail.defaultLocale}, but locli.json says ${sourceLanguage}. Fix sourceLanguage (or --source) to match.`);
  }
  const enabled = await ensurePlatforms(api, detail, targets.map((t) => t.platform));
  const codes = new Set(detected.locales);
  for (const target of targets) {
    try { for (const code of Object.keys(readTarget(root, target, sourceLanguage).locales)) codes.add(code); } catch (error) {
      ctx.warn(`${describeTarget(target)}: ${/** @type {Error} */ (error).message}`);
    }
  }
  const { created: locales } = await ensureLocales(api, detail, [...codes]);
  ctx.out(`${created ? 'Created' : 'Using'} project ${detail.slug}: ${projectURL(apiURL, detail.id)}`);
  if (enabled.length) ctx.out(`Enabled platform: ${enabled.join(', ')}`);
  if (locales.length) ctx.out(`Created languages: ${locales.join(', ')}`);
  ctx.out(targets.length ? 'Next: `npx @locli/cli push` uploads the texts locli does not have yet.' : 'Next: add a text file (see above) and rerun `npx @locli/cli init`.');
  return { file, project: detail.slug, projectID: detail.id, created, targets, enabledPlatforms: enabled, createdLocales: locales };
}
