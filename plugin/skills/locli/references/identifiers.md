# Identifiers and areas

## Application text convention

**Always use `lower_snake_case`, identical on every platform.** New identifiers
contain lowercase ASCII letters, digits and single underscores separating words,
starting with a letter. Pattern: `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`.

| Use | Do not introduce |
| --- | --- |
| `account_login` | `account.login`, `accountLogin`, `account-login` |
| `receipt_count` | `receipt.count`, `receipt_count_ios`, `receipt_count_android` for the same semantic text |
| `order_item_count` | Another identifier merely because Android needs different wording |

An identifier is a stable semantic name, not a visible sentence or format argument.
"%lld receipts" is the **text value**; `receipt_count` is the **identifier**.

**Never key by the text.** Migrating an app whose code calls `t("Projekte")` or
`NSLocalizedString("Save changes?", …)` means giving every text an identifier first
(`projects_title`, `editor_unsaved_changes`), then pushing. Pushed as is, each sentence
becomes its own area and every wording change becomes a rename. `npx @locli/cli push`
refuses new keys with spaces, punctuation, braces or non-ASCII characters and names
them; `--allow-text-keys` exists only for catalogs that are keyed by text on purpose.
Texts used on many screens ("Cancel", "Save") get one shared key such as
`common_cancel`, not one per screen.
The iOS catalog, Android resource, Localize and application lookups all use that
identifier. A generated Swift accessor may still be named `Strings.receiptCount`;
its underlying lookup key is what must follow the convention.

Apply this rule to new iOS-only texts too, so enabling Android later does not
require a second key. This is an authoring convention: legacy dotted names are not
rewritten automatically. The server enforces names only for Android
(`^[A-Za-z_][A-Za-z0-9_]*$`): a dotted key assigned to Android is rejected with 422
on create, update, import and export. Dotted iOS-only keys remain valid.

Do not apply global replacements to `%2$.1f`, file extensions, URLs, language codes,
Swift member access or managed store-field identifiers such as
`appstore.name` or `googleplay.shortDescription`.

## Areas and identifier prefixes

Localize derives the editor's **area** (the **Bereiche** filter) from the first
identifier segment. With the underscore convention, that is the part before the
first `_`:

| Identifier | Area |
| --- | --- |
| `account_login` | `account` |
| `account_logout` | `account` |
| `order_item_count` | `order` |
| `order_item_remove_confirmation` | `order` |
| `widget_empty_title` | `widget` |
| `welcome` | `welcome` (no separator) |

- Choose a consistent semantic feature prefix, e.g. `account`, `order`, `receipt`
  or `widget`. Reuse the application's existing naming scheme.
- Further underscores do **not** create nested areas: `order_item_count` belongs
  to `order`, not `order_item`. For multiword features, agree on a suitable first
  segment rather than expecting hierarchical groups.
- Do not prefix everything with `ios_` or `android_`; platform assignment is a
  separate setting, and such names would group unrelated features by platform.
- Areas are not created separately. The list groups keys under their derived
  prefixes when multiple areas are shown. Selecting exactly one area removes the
  redundant group headings. The area filter is offered when multiple areas exist.
- Grouping does not rename export keys, create nested JSON objects, choose a
  resource file or depend on the app's directory/package layout. The stored
  `namespace` field is not the source of this editor grouping.
- Legacy `account.login` also groups under `account`: the editor recognizes both
  `.` and `_` as separators for existing keys. This compatibility does not change
  the underscore convention or make dotted/underscore counterparts the same key.
- Changing the prefix changes the identifier and therefore the area. Treat it as
  a key rename: update all application lookups and catalogs, not just the display.

## Starting a feature

When the user asks for a feature ("build the login screen"), find its area before
writing the first text:

1. `npx @locli/cli areas --feature login` (MCP: `locli_areas` with `feature`). It returns
   the existing area to use, by name or by synonym (`login` finds `auth`, `signin` or
   `account`), with example keys, or proposes a new area when nothing matches.
2. Existing area: name every new key `<area>_<element>` (`auth_username_label`,
   `auth_password_forgot_link`) and reuse keys that already mean the same thing
   (`locli_find_texts`). Never start a second area for the same feature (`login_` next to
   `auth_`).
3. No area yet: start it with the proposed prefix. There is nothing to create
   separately; the first push of keys with that prefix creates the area in locli.
4. Tell the user which area the feature's texts went to, and whether it was new.

## Before creating a key or pushing

1. Search the app catalog and correct Localize project for the canonical identifier
   and possible legacy counterparts (`account_login` / `account.login`).
2. Reuse the appropriate existing key and extend its platform assignments. Different
   wording belongs in a variant, not an `_ios`/`_android` duplicate.
3. Compare context and call sites. Two "Open" labels need not mean the same thing;
   different concepts deserve distinct, meaningful underscore names.
4. Handle legacy names with the [merge workflow](merge.md) before pushing. Blindly replacing
   `.` with `_` can overwrite existing values or introduce collisions.

Two names for the same text, or a rename of an existing key: follow
[renaming and merging keys](merge.md).
