# Recognizing and using backend plurals

Start with the [shared plural rules](plurals.md). Artifact loading and per-recipient
language selection are covered in [backend integration](backend-integration.md).

## Recognize the format and recipient

- Localize's backend export contains ICU MessageFormat strings for plural entries.
- Look for server-generated email, notification, document and user-facing response
  text that branches on `count == 1`, concatenates suffixes or formats raw printf
  templates instead of evaluating the exported ICU message.
- Select the message and formatter locale for the **recipient**, not the server's
  operating-system locale. Background jobs need the same explicit language policy
  as HTTP requests.
- A backend may instead return a stable message key and arguments for the client
  to localize. Follow that API contract rather than mixing server-localized prose
  and client-localized messages accidentally.

Example exported catalog:

```json
{
  "en": {
    "receipt_count": "{count, plural, one {# receipt} other {# receipts}}"
  }
}
```

## Consume with the backend's ICU implementation

Use an ICU MessageFormat-compatible library in the service's language. Do not assume
that a standard printf formatter or a plural-category function can evaluate a full
ICU message. Confirm support for the syntax emitted by Localize, including number
skeletons when additional numeric arguments require them.

For a Node.js service, one concrete example is:

```typescript
import { IntlMessageFormat } from "intl-messageformat";

// In production, obtain both from the catalog resolved for the recipient.
const resolvedLocale = "en";
const message = "{count, plural, one {# receipt} other {# receipts}}";
const formatter = new IntlMessageFormat(message, resolvedLocale);
const text = formatter.format({ count: 3 }); // "3 receipts"
```

Node.js is an example, not a requirement. Java, .NET, Swift, Python and other
services must use their actual project's compatible formatter/integration. This
skill does not imply Localize ships SDKs for each language.

## Multiple arguments and concurrency

Argument names (`count` for the selector, `argN` for the others) are the same as
on the web; see [web plurals](web-plurals.md#multiple-arguments). Keep numeric
arguments numeric and format with the locale of the message actually selected after
fallback. Do not mutate a process-wide locale per request; respect the formatter's
thread-safety rules and cache compiled patterns by release, locale and message.

## Zero and verification

ICU `=0` provides an exact-zero message when exported; the `zero` category alone
is not a universal exact-zero rule. Use the message's defined cases rather than
implementing language-specific plural rules in business logic.

Test 0, 1, 2 and a larger quantity, language-specific categories, reordered arguments
and fallback. Test two recipients with different locales concurrently and in queued
jobs; neither should inherit another recipient's language. Verify the intended
catalog release and that raw keys/templates do not leak into emails or notifications.
Escape the formatted result for its delivery context, such as HTML email, using
the service's existing rendering pipeline.
