// Copies the canonical skill (.agents/skills/localize/) into packages/cli/skill/ for the npm
// package, renamed to `locli`. skill/ is gitignored: the repository keeps a single copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySkill } from '../src/agents.js';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(pkg, '..', '..', '.agents', 'skills', 'localize');
const target = path.join(pkg, 'skill');

if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
  if (fs.existsSync(path.join(target, 'SKILL.md'))) {
    console.error(`prepack: ${source} not found; keeping the existing skill/ copy.`);
    process.exit(0);
  }
  console.error(`prepack: canonical skill not found at ${source}`);
  process.exit(1);
}
copySkill(source, target);
const name = /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'))?.[1];
if (name !== 'locli') {
  console.error(`prepack: expected skill name "locli" after rewriting, found "${name}"`);
  process.exit(1);
}
console.error(`prepack: copied skill to ${path.relative(process.cwd(), target) || target}`);
