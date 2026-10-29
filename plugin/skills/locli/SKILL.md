---
name: locli
description: "Use when an app gets or changes user-facing text (UI labels, errors, emails, notifications, App Store/Google Play listings) or when adding localization/i18n/translations to an iOS, Android, web or backend project: set up locli, push new keys and translations, pull approved releases. Never hard-code UI strings."
---

# locli

locli holds the app's texts per language and platform. You add keys and translations;
a human project owner approves each release; the app ships only approved releases.

## If the repository has no `locli.json` yet

1. Make sure the platform's catalog exists (String Catalog `.xcstrings` in Xcode,
   Android `res/values/strings.xml`, web/backend `messages/<locale>.json`).
2. Run `npx @locli/cli init`. It links or creates the project and installs the full
   locli skill into `.agents/skills/locli/` plus a block in `AGENTS.md`.
3. Continue with that installed skill; it is the detailed reference.

## If it already has `locli.json`

Follow `.agents/skills/locli/SKILL.md` (or `.claude/skills/locli/`). In short:
for a new feature run `npx @locli/cli areas --feature <name>` and use the area it names; reuse a key with the same meaning, otherwise add a `lower_snake_case` key named after
the feature area with a comment; `npx @locli/cli push` (never overwrites existing
texts); tell the user how many texts wait for a release; after they approve it,
`npx @locli/cli pull`. Before translating, read `npx @locli/cli guide` (tone,
glossary) and follow it. The MCP tools `locli_areas`, `locli_guide`, `locli_find_texts`,
`locli_add_texts`, `locli_status`, `locli_push` and `locli_pull` do the same from
inside the session.

## Authentication is the user's

On "not logged in", ask the user to run `npx @locli/cli login` (browser approval,
free sign-up). Never read credential files or print tokens. Never approve or publish
a release yourself.

Full guide: https://locli.dev/docs/agents.md
