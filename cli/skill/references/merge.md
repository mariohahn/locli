# Renaming and merging keys

Read [identifiers and areas](identifiers.md) first: this workflow moves keys to the
`lower_snake_case` convention described there.

## Rename or merge?

| Situation | Action |
| --- | --- |
| Only `account.login` exists; `account_login` is free | Rename deliberately and update the catalog and application lookups together. |
| Both names exist and represent the same concept | Merge values per language/platform, then switch lookups to the underscore name. |
| Multiple legacy names map to the same underscore name | Treat as a conflict; do not automatically choose the first or last value. |
| Identical wording, different meaning | Keep separate keys with distinct semantic names. |
| Plain/plural/array types or quantity selectors disagree | Resolve the intended meaning/structure before merging. |

**Current tooling:** The CLI has no `merge` or `rename` command. There is also no
dedicated history-preserving merge endpoint. Renaming in the editor does not merge
into an occupied identifier. The following is an application workflow, not an
existing automated migration command.

## Application-side merge workflow

### 1. Record the mapping and source values

For each pair, record both old identifiers and the canonical underscore identifier,
platform assignments, languages, shared values, overrides, context, placeholders
and any plural forms/array items. If history must survive, retain the complete
state including history: a resolved export alone does not contain every override
or historical change.

Example mapping:

| Old | Target | Meaning |
| --- | --- | --- |
| `account.login` (iOS) | `account_login` | Sign-in action |
| `account_login` (Android) | `account_login` | The same action |

Compare the **effective text** per language: override first, then shared value.
Different values on different platforms can be valid variants; different values
for the same language/platform are a conflict. Do not silently fill missing or
empty values.

### 2. Build the target key

- Use the existing underscore key as the target rather than inventing a third name.
- Consider both keys' assignments; those platforms must be available in the project.
- Share genuinely identical values when inheritance is intended. Preserve
  differences as explicit platform variants per language. Using only variants
  without a shared fallback is also valid.
- An identical value may deliberately be pinned as an override to avoid following
  future shared edits. Do not automatically discard that intent.
- Example: iOS "Sign in", Android "Log in" becomes `account_login` with shared
  "Sign in" and Android "Log in". Apply this only to languages whose source values
  actually establish that mapping.
- Missing-value example: if English is absent on iOS but Android has "Log in",
  keep that language's shared value absent and retain the Android value as an
  override. Turning it into shared text would silently create a new iOS translation.
  Check this per language, not only in the source language.
- Preserve **all forms and the quantity selector** for plurals, and **every item
  in order** for arrays. Do not change raw placeholders, argument positions or
  precision as part of renaming an identifier.

You can build the target through deliberate copying and variants in the editor.
That does not merge history: existing changes remain on the old key. If a unified
history is required, a suitable merge capability must be implemented first; copying
and deleting must not be presented as history-preserving.

### 3. Update application code and catalogs together

- Apply the explicit mapping to iOS call sites and catalog keys, including widgets,
  extensions, tests, fallbacks and generated accessors. Check Android/web/backend
  too, even if their names already match. Do not replace unrelated string literals.
- Include all current and historical export names when checking a legacy pair.
  Previously split keys may already be canonical for one platform; do not assume
  the displayed source name is the only name existing consumers used.
- With a [shared localization package](ios-integration.md), update its catalog and
  accessors once, then build every consuming target. Keep lookup identifiers aligned
  even when public Swift accessor names do not need to change.
- Do not overwrite occupied catalog entries. Merge languages, comments, plural
  forms and other metadata, or resolve conflicts first.
- Do not push the unchanged old catalog during migration: it can recreate the old
  identifier or assign its platform again.
- Remove replaced platform assignments from the old Localize key so new exports
  contain only the target identifier. Keeping the old key unassigned can preserve
  its history. Deletion removes its current values and history and is a separate,
  deliberate cleanup decision.
- Use `pull --draft` for verification. Remove obsolete local entries explicitly
  after checking them: `pull` does **not** propagate deletions.

### 4. Verify and distribute

1. Effective values per language/platform match their previous values except for
   explicitly agreed editorial changes.
2. Working-state exports contain the canonical identifier, intended variants and
   unchanged arguments/plural forms.
3. Old names are absent from app code and the local catalog. Xcode extraction must
   not recreate them on the next build.
4. Build the app and extensions and test affected displays in multiple languages.
   Exercise 0, 1, 2 and language-specific plural categories.
5. Once a project owner has approved a new release, `pull` and build the application.
   Existing releases stay immutable and may still contain old names.

**Ordering matters:** The updated app needs a catalog containing the new keys.
Before the new Localize release, regular `pull` may add old names again. Coordinate
the release and application catalog updates.
