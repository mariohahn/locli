// Agent instructions written by `init`: an AGENTS.md block, CLAUDE.md import and the packaged skill.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const START = '<!-- locli:start -->';
export const END = '<!-- locli:end -->';

/** @param {{ project: string, sourceLanguage: string, targets: { platform: string, path: string }[] }} config */
export function agentsBlock(config) {
  const files = config.targets.length
    ? config.targets.map((t) => `\`${t.path}\` (${t.platform})`).join(', ')
    : 'none yet (add a target to `locli.json`)';
  return `${START}
## User-facing texts (locli)

All user-facing texts of this app are managed in [locli](https://locli.dev) (project \`${config.project}\`,
source language \`${config.sourceLanguage}\`). Text files: ${files}. Config: \`locli.json\`.

1. Never hard-code UI strings. Building a feature (e.g. a login screen): first run
   \`npx @locli/cli areas --feature login\` (MCP \`locli_areas\`) and name every new key with the
   area it reports (\`auth_username_label\`), or the new area it proposes. Reuse an existing key with
   the same meaning (\`locli_find_texts\`). Add new keys to the source-language file with a comment
   saying where the text appears and what each placeholder holds.
2. Translating: read \`npx @locli/cli guide\` (MCP \`locli_guide\`) first and follow its tone and
   glossary; add every language of the project, then check them as the locli skill describes.
3. Run \`npx @locli/cli push --dry-run\`, fix the glossary warnings in your files, then
   \`npx @locli/cli push\` from your working branch. It only adds what locli lacks and never
   overwrites a text once it is there. Tell the user how many texts wait for a release; a
   project owner approves releases in locli. Agents never approve or publish releases.
4. After the release is approved, run \`npx @locli/cli pull\` and commit the updated files.

Never edit existing texts locally: \`push\` does not overwrite them and \`pull\` replaces them.
Change them in locli. If the CLI says "Not logged in", ask the user to run
\`npx @locli/cli login\`; never read or print tokens. More: https://locli.dev/docs/agents.md
${END}`;
}

/**
 * Inserts or replaces the locli block. Returns the new content.
 * @param {string | null} content @param {string} block
 */
export function upsertBlock(content, block) {
  if (content === null || !content.trim()) return `# Agent instructions\n\n${block}\n`;
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start >= 0 && end > start) return content.slice(0, start) + block + content.slice(end + END.length);
  return content.replace(/\s*$/, '') + `\n\n${block}\n`;
}

/** Package root and the skill to install (packaged copy, or the repo's canonical skill). */
export function skillSource() {
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packaged = path.join(pkg, 'skill');
  if (fs.existsSync(path.join(packaged, 'SKILL.md'))) return packaged;
  const canonical = path.resolve(pkg, '..', '..', '.agents', 'skills', 'localize');
  if (fs.existsSync(path.join(canonical, 'SKILL.md'))) return canonical;
  return null;
}

/** Copies a skill directory, naming it `locli`. @param {string} from @param {string} to */
export function copySkill(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copySkill(source, target);
    else if (entry.name === 'SKILL.md') fs.writeFileSync(target, renameSkill(fs.readFileSync(source, 'utf8')));
    else fs.copyFileSync(source, target);
  }
}

/** @param {string} text */
export function renameSkill(text) {
  return text.replace(/^(---\r?\n(?:.*\r?\n)*?)name:\s*localize\s*$/m, '$1name: locli');
}

/**
 * Writes AGENTS.md, the CLAUDE.md import and the skill (+ .claude/skills symlink).
 * @param {string} root @param {any} config @returns {string[]} what changed
 */
export function writeAgentFiles(root, config) {
  const changes = [];
  const agentsFile = path.join(root, 'AGENTS.md');
  const before = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : null;
  const after = upsertBlock(before, agentsBlock(config));
  if (after !== before) { fs.writeFileSync(agentsFile, after); changes.push(before === null ? 'created AGENTS.md' : 'updated AGENTS.md'); }

  const claudeFile = path.join(root, 'CLAUDE.md');
  if (fs.existsSync(claudeFile)) {
    const claude = fs.readFileSync(claudeFile, 'utf8');
    if (!claude.includes('AGENTS.md')) {
      fs.writeFileSync(claudeFile, claude.replace(/\s*$/, '') + '\n\n@AGENTS.md\n');
      changes.push('added @AGENTS.md to CLAUDE.md');
    }
  }

  const source = skillSource();
  if (!source) return [...changes, 'skill not installed (package has no skill/ folder)'];
  const skillDir = path.join(root, '.agents', 'skills', 'locli');
  copySkill(source, skillDir);
  changes.push('installed .agents/skills/locli');
  const link = path.join(root, '.claude', 'skills', 'locli');
  const relative = path.join('..', '..', '.agents', 'skills', 'locli');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  let stat = null;
  try { stat = fs.lstatSync(link); } catch { /* missing */ }
  if (stat?.isSymbolicLink() && fs.readlinkSync(link) === relative) return changes;
  if (stat) fs.rmSync(link, { recursive: true, force: true });
  try {
    fs.symlinkSync(relative, link, 'dir');
    changes.push('linked .claude/skills/locli');
  } catch {
    copySkill(skillDir, link); // Windows without symlink rights
    changes.push('copied .claude/skills/locli');
  }
  return changes;
}
