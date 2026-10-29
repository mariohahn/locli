import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_URL } from '../src/config.js';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const served = path.resolve(pkg, '..', '..', 'localize-backend', 'Public', 'schema', 'locli.json');

test('the schema served at SCHEMA_URL matches the packaged schema', { skip: !fs.existsSync(served) && 'backend checkout not present' }, () => {
  const packaged = fs.readFileSync(path.join(pkg, 'schema', 'locli.json'), 'utf8');
  assert.equal(JSON.parse(packaged).$id, SCHEMA_URL);
  assert.equal(fs.readFileSync(served, 'utf8'), packaged, 'copy packages/cli/schema/locli.json to localize-backend/Public/schema/');
});
