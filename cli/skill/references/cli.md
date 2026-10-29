# CLI (`@locli/cli`)

One CLI for every stack: `npx @locli/cli <command>` (Node 18+, no install needed).
It syncs iOS String Catalogs, Android `strings.xml` and web/backend JSON. There is no
`merge`, `rename` or `--platform` command.

## Setup and authentication

```sh
npx @locli/cli init
```

`init` detects the text files, writes `locli.json`, writes the locli block into
`AGENTS.md` (between `<!-- locli:start -->` and `<!-- locli:end -->`), adds `@AGENTS.md`
to an existing `CLAUDE.md`, installs this skill to `.agents/skills/locli/` (linked from
`.claude/skills/locli/`) and, when logged in, creates the project, its languages and
platforms. It is safe to rerun. Options: `--name`, `--slug`, `--source LANG`,
`--target platform:format:path` (repeatable, overrides detection), `--yes`,
`--no-agent-files`.

Detection: `*.xcstrings` (ios), `**/src/main/res/values/strings.xml` (android),
`messages|locales|i18n|lang/{locale}.json` (web). If the app has no catalog yet, create
the platform's standard one first, or pass `--target`.

Authentication is the user's. When a command says "Not logged in", ask the user to run
`npx @locli/cli login`: it prints a code, opens the browser, and the user signs in (or
signs up) and approves. The token is stored per server in
`~/.config/locli/credentials.json` (mode 0600). CI sets `LOCLI_TOKEN` from its secrets.
Never read the credentials file, print tokens or commit them. `whoami` shows the account,
`logout` revokes the token.

## `locli.json`

```json
{
  "project": "example-app",
  "sourceLanguage": "en",
  "targets": [
    { "platform": "ios", "format": "xcstrings", "path": "App/Localizable.xcstrings" },
    { "platform": "android", "format": "android-xml", "path": "app/src/main/res" },
    { "platform": "web", "format": "json", "path": "messages/{locale}.json" }
  ]
}
```

- `project` is the slug, `sourceLanguage` must match the catalogs and locli.
- `apiURL` is optional (default `https://locli.dev`; `LOCLI_API_URL` or `--api-url`
  override it).
- Android: `path` is the `res/` directory; optional `file` (default `strings.xml`).
- JSON (`web`, `backend`): `path` needs `{locale}`; nested objects become dotted keys;
  optional `keyPrefix` for i18next namespaces.
- Paths are relative to `locli.json`.

## Commands

| Command | Effect |
| --- | --- |
| `login [--no-browser]` / `logout` / `whoami [--json]` | Browser approval, revoke, show the account. |
| `init` | See above. |
| `push [--dry-run] [--branch B] [--target platform] [--allow-text-keys]` | Add what locli lacks (see below). |
| `pull [--draft] [--release NAME] [--target platform]` | Write the latest approved (or named) release. |
| `status [--json]` | Languages, missing translations, open features, unreleased changes, glossary issues. |
| `areas [--feature NAME] [--json]` | Feature areas with key counts; with `--feature` the area to use or start. |
| `guide [--json] [--set FILE]` | Translation guide (tone, glossary) and the texts that break it; `--set` replaces it. |
| `mcp` | MCP server on stdio. |

Every command takes `--api-url`, `--config FILE` (or `LOCLI_CONFIG`) and `--help`.
Exit codes: 0 ok, 1 error, 2 usage error.

## push

- Writes; use `--dry-run` to see what it would send. Creates missing keys and
  languages, assigns the target's platform, uploads missing values and fills empty
  context from catalog comments. Push only what belongs to the task; the project is
  shared.
- Never overwrites an existing value in locli; edit existing texts in the web app.
- Matches exact identifiers: `account.login` and `account_login` are different keys.
  Apply the [identifier convention](identifiers.md) first.
- Refuses new keys that look like visible text (spaces, punctuation, braces, non-ASCII)
  with exit code 2 and nothing written, and warns about new keys that are not
  `lower_snake_case`. `--allow-text-keys` is only for catalogs keyed by text on purpose.
- Sends large catalogs in batches of 100 keys.
- Before uploading (and with `--dry-run`) it checks the files against the translation
  guide's glossary and warns about every text that drops a term. Fix them in the files first:
  a text in locli is never overwritten. Warnings never block a push; `locli guide` lists the
  ones already in locli.
- A platform that is not enabled for the project needs an owner; the CLI says so.
- Android: string arrays are created as array keys. Strings with markup (`<b>`, `<a>`)
  are skipped with a warning.
- JSON: a top-level ICU plural on `count` or `argN` becomes a plural key; other ICU
  messages are pushed as plain text.
- New keys pushed from a Git feature branch join that branch's
  [feature](features.md); a push from `main` marks features merged. The branch comes
  from `--branch`, `LOCLI_BRANCH`, CI variables or Git.

## pull

- Resolves the latest release once and uses that name for every target, so all
  platforms get the same release.
- Replaces only keys that locli exports; local-only keys and other file content stay.
  Local edits to exported keys are lost, so push or move them to locli first.
  Deletions and renames in locli are not propagated.
- Android writes one `values-<qualifier>/` directory per language.
- iOS: refuses an empty catalog or a changed source language.
- Without any release it fails with a hint; do not silently switch to `--draft`.
  `--draft` writes the unapproved working state, for local checks only.
- Changes reach users with the next app build, not at runtime.

After pulling, review the diff, build the affected targets and check the changed texts
in the languages concerned. Problems: [errors](errors.md).

## MCP server

`npx -y @locli/cli mcp` exposes `locli_status`, `locli_areas` (the area a feature's
keys belong to), `locli_guide` (tone, glossary and its
issues; read before translating), `locli_find_texts` (search keys and
values before creating one), `locli_add_texts` (create keys with values or plural
forms), `locli_push` and `locli_pull`. It reads `locli.json` from the working directory.
Claude Code: `claude mcp add --scope project locli -- npx -y @locli/cli mcp`.

## Older setups

Apps set up before `@locli/cli` may call `Scripts/localize.sh`, which runs
`scripts/localize-ios.py` (or the `scripts/locli` wrapper) from a Localize checkout with
`Config/localize.json` and `LOCALIZE_TOKEN`. It syncs iOS catalogs only, with the same
push/pull rules. Keep using it where it exists, or migrate with `npx @locli/cli init`
(same project slug) and remove the wrapper in the same change.

## Other ways in

File import in the web app (JSON, `.strings`, Android XML) and Google Sheets import
can overwrite existing values, unlike `push`. Align identifiers before importing:
different names become separate keys.
