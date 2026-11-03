import { test } from 'node:test';
import assert from 'node:assert/strict';
import { community } from '../src/commands/community.js';
import { callTool, TOOLS } from '../src/mcp.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const suggestion = (id, extra = {}) => ({
  id, keyID: 'k1', key: 'chat_title', comment: 'Title of the chat screen', locale: 'fr', source: 'Chat with %@', current: null,
  text: 'Discuter avec %@', authorName: 'Alice', score: 3, votes: 3, status: 'open', discussion: [{ id: 'c1', text: 'Plus naturel ?', authorName: null }], ...extra,
});
const seed = () => ({
  slug: 'hermes', defaultLocale: 'en', locales: ['en', 'fr'],
  community: { enabled: true, locales: [], path: '/c/hermes', openSuggestions: 2 },
  suggestions: [suggestion('s1'), suggestion('s2', { text: 'BUY NOW %@', score: -2, votes: 2, authorName: null, discussion: [] })],
});

function project(server) {
  const root = tempDir();
  writeFiles(root, { 'locli.json': { project: 'hermes', sourceLanguage: 'en', targets: [{ platform: 'ios', format: 'xcstrings', path: 'Localizable.xcstrings' }] } });
  return { root, ctx: testContext({ cwd: root, env: testEnv(server.url) }) };
}

test('community lists open suggestions with source, current text and discussion', async () => {
  const server = await fakeServer(seed());
  try {
    const { ctx } = project(server);
    const result = await community(ctx, {});
    assert.equal(result.suggestions.length, 2);
    const out = ctx.output.join('\n');
    assert.match(out, /Community catalog: http:\/\/127\.0\.0\.1:\d+\/c\/hermes/);
    assert.match(out, /2 open suggestions, the most voted first:/);
    assert.match(out, /- s1 {2}chat_title \(fr\) {2}score 3, 3 votes, by Alice/);
    assert.match(out, / {4}now: {8}\(missing\)/);
    assert.match(out, / {4}comment: {4}Plus naturel \?/);
    assert.equal(server.calls('GET', '/community/suggestions')[0].path.includes('status=open'), true);
  } finally { await server.close(); }
});

test('community --accept, --reject and --hide decide one suggestion; only one at a time', async () => {
  const server = await fakeServer(seed());
  try {
    const { ctx } = project(server);
    await community(ctx, { accept: 's1', note: 'Natural' });
    assert.deepEqual(server.calls('POST', '/community/suggestions/s1/accept')[0].body, { note: 'Natural' });
    await community(ctx, { hide: 's2' });
    assert.deepEqual(server.calls('POST', '/community/suggestions/s2/reject')[0].body, { hide: true });
    assert.match(ctx.output.join('\n'), /Accepted s1: it is the working text now and waits for the next approved release\.\nHid s2 from the public catalog\./);
    await assert.rejects(community(ctx, { accept: 's1', reject: 's2' }), /Pass only one of --accept, --reject or --hide/);
    await assert.rejects(community(ctx, { status: 'new' }), /--status must be one of/);
  } finally { await server.close(); }
});

test('the MCP tools list and review community suggestions', async () => {
  assert.ok(TOOLS.some((tool) => tool.name === 'locli_community_suggestions' && tool.annotations.readOnlyHint));
  const server = await fakeServer(seed());
  try {
    const { root } = project(server);
    const listed = await callTool('locli_community_suggestions', { locale: 'fr' }, { cwd: root, env: testEnv(server.url) });
    assert.equal(listed.isError, false);
    assert.equal(JSON.parse(listed.content[0].text).suggestions[0].text, 'Discuter avec %@');
    const reviewed = await callTool('locli_community_review', { id: 's2', decision: 'reject', note: 'Spammy' }, { cwd: root, env: testEnv(server.url) });
    assert.equal(reviewed.isError, false, reviewed.content[0].text);
    assert.match(reviewed.content[0].text, /Rejected s2\./);
    assert.deepEqual(server.calls('POST', '/community/suggestions/s2/reject')[0].body, { note: 'Spammy', hide: false });
  } finally { await server.close(); }
});
