// login (browser-approved device flow), logout, whoami.
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Api, ApiError, NOT_LOGGED_IN } from '../http.js';
import { findConfig, resolveApiURL } from '../config.js';
import { loadCredentials, saveCredentials, credentialsFile, resolveToken } from '../credentials.js';
import { LocliError } from '../util.js';

/**
 * API URL for account commands: flags/env, else locli.json if there is one, else the default.
 * @param {import('../context.js').Context} ctx @param {{ apiUrl?: string, config?: string }} flags
 */
export function accountApiURL(ctx, flags) {
  let config;
  const file = findConfig(ctx.cwd, ctx.env, flags.config);
  if (file && fs.existsSync(file)) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore a broken config here */ }
  }
  return resolveApiURL(flags, ctx.env, config);
}

/** Opens a URL in the default browser; failures are ignored. @param {string} url */
export function openBrowser(url) {
  try {
    const [command, args] = process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* no browser */ }
}

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ apiUrl?: string, config?: string, browser?: boolean }} flags
 */
export async function login(ctx, flags) {
  const apiURL = accountApiURL(ctx, flags);
  const api = new Api(apiURL, { env: ctx.env, fetch: ctx.fetch, token: null });
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = await api.post('/api/auth/device', { clientName: `locli CLI (${os.hostname()})` }, { auth: false });
  if (!start?.deviceCode || !start?.userCode || !start?.verificationURL) throw new LocliError(`Invalid API response from ${apiURL}/api/auth/device`);
  ctx.info('');
  ctx.info(`  To sign in, open:  ${start.verificationURL}`);
  ctx.info(`  and confirm code:  ${start.userCode}`);
  ctx.info('');
  if (flags.browser !== false && !ctx.env.CI) (ctx.openBrowser ?? openBrowser)(start.verificationURL);
  let interval = Math.max(0, Number(start.interval ?? 5)) * 1000;
  const deadline = Date.now() + Math.max(1, Number(start.expiresIn ?? 600)) * 1000;
  ctx.info('Waiting for approval in the browser …');
  for (;;) {
    if (Date.now() > deadline) throw new LocliError('The login code expired. Run `npx @locli/cli login` again.');
    await sleep(interval);
    try {
      const created = await api.post('/api/auth/device/token', { deviceCode: start.deviceCode }, { auth: false });
      if (!created?.token || !created?.details?.id) throw new LocliError('Invalid API response: token missing');
      const me = await api.get('/api/me', { token: created.token });
      const credentials = loadCredentials(ctx.env);
      credentials[apiURL] = { token: created.token, tokenID: created.details.id, email: me?.user?.email };
      const file = saveCredentials(ctx.env, credentials);
      ctx.out(`Logged in to ${apiURL} as ${me?.user?.email ?? 'unknown'} (token stored in ${file}).`);
      return { apiURL, email: me?.user?.email };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 428 || error.reason === 'authorization_pending') continue;
      if (error.status === 429 || error.reason === 'slow_down') { interval += 5000; continue; }
      if (error.status === 410 || error.reason === 'expired_token') throw new LocliError('The login code expired. Run `npx @locli/cli login` again.');
      if (error.status === 403 || error.reason === 'access_denied') throw new LocliError('The login was denied in the browser.');
      throw error;
    }
  }
}

/** @param {import('../context.js').Context} ctx @param {{ apiUrl?: string, config?: string }} flags */
export async function logout(ctx, flags) {
  const apiURL = accountApiURL(ctx, flags);
  const credentials = loadCredentials(ctx.env);
  const entry = credentials[apiURL];
  if (!entry) {
    ctx.out(`No stored login for ${apiURL}.`);
    return { apiURL, removed: false };
  }
  delete credentials[apiURL];
  if (entry.tokenID) {
    try {
      await new Api(apiURL, { env: ctx.env, fetch: ctx.fetch, token: entry.token }).delete(`/api/me/tokens/${encodeURIComponent(entry.tokenID)}`);
    } catch (error) {
      ctx.warn(`could not revoke the token on the server: ${/** @type {Error} */ (error).message}`);
    }
  }
  saveCredentials(ctx.env, credentials);
  ctx.out(`Logged out of ${apiURL}.`);
  return { apiURL, removed: true };
}

/** @param {import('../context.js').Context} ctx @param {{ apiUrl?: string, config?: string, json?: boolean }} flags */
export async function whoami(ctx, flags) {
  const apiURL = accountApiURL(ctx, flags);
  const token = resolveToken(apiURL, ctx.env);
  if (!token) throw new LocliError(NOT_LOGGED_IN);
  const me = await new Api(apiURL, { env: ctx.env, fetch: ctx.fetch }).get('/api/me');
  const via = token.source === 'env' ? 'token from LOCLI_TOKEN/LOCALIZE_TOKEN' : `stored login (${credentialsFile(ctx.env)})`;
  const result = { apiURL, email: me?.user?.email ?? null, name: me?.user?.name ?? null, via };
  if (flags.json) ctx.out(JSON.stringify(result, null, 2));
  else ctx.out(`${result.email} on ${apiURL} (${via})`);
  return result;
}
