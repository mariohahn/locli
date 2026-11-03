# Recognizing and using web plurals

Start with the [shared plural rules](plurals.md). Catalog loading, locale selection
and frontend module ownership are covered in [web integration](web-integration.md).

## Recognize the format

- Localize's web export represents plural entries as **ICU MessageFormat** strings.
- A plain string containing a number or printf placeholder is not automatically
  an ICU plural message.
- Look for hand-written `count === 1` branches, appended `s`, separate singular/plural
  keys and unformatted ICU templates rendered directly into components.

Example exported catalog:

```json
{
  "en": {
    "receipt_count": "{count, plural, one {# receipt} other {# receipts}}"
  }
}
```

## Format with the selected catalog's locale

Use the project's existing ICU-compatible formatter. An example with
`intl-messageformat` is:

```typescript
import { IntlMessageFormat } from "intl-messageformat";

const locale = "en";
const message = "{count, plural, one {# receipt} other {# receipts}}";
const formatter = new IntlMessageFormat(message, locale);
const text = formatter.format({ count: 3 }); // "3 receipts"
```

In the application, `message` comes from its exported locale catalog. Pass a numeric
count and use the **locale of the message actually selected**, including after a
language fallback. Render the formatted result as text. Do not display the template,
apply printf to it, or replace `#` manually. `Intl.PluralRules` alone chooses a
category but does not evaluate the entire ICU message.

When using a framework integration, confirm ICU support is configured; not every
translation function accepts ICU syntax by default. Reuse a compiled formatter
when useful, but invalidate/cache by catalog version, locale and message. Recompute
the displayed result when count or locale changes.

## Multiple arguments

The selected source argument becomes `count`; other arguments become `argN`.
Source `%1$@ has %2$lld receipts`, quantity argument 2:

```typescript
const formatter = new IntlMessageFormat(
  "{count, plural, one {{arg1} has # receipt} other {{arg1} has # receipts}}",
  "en"
);
const text = formatter.format({ arg1: "Ada", count: 2 }); // "Ada has 2 receipts"
```

Do not pass `arg2` instead of `count` for the selector. Supply the other arguments
with their declared types. These names describe plural exports, not a universal
transformation of every plain string in the catalog.

## Zero and verification

An explicit zero form is exported with an ICU `=0` branch as well as `zero`.
The formatter evaluates that exact-zero case before the category fallback.

Test 0, 1, 2 and a larger value in each relevant language. Include locale switching,
message-language fallback, multiple arguments, exact zero and platform variants.
If server-rendered, confirm server and browser select the same catalog/locale so
hydration does not change the text unexpectedly. Escaping and formatting must not
turn translation text into executable markup.
