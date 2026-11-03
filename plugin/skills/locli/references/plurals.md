# Plurals across iOS, Android, web and backend

## One key, platform-specific output

Plural forms belong to a **Localize key**, not to a particular platform. Use one
identifier such as `receipt_count`, assign the required platforms and define the
language-specific forms and quantity selector once. Shared forms serve all assigned
platforms. A platform override can supply different forms for a particular language
without creating another identifier.

Example shared English values:

```text
Identifier: receipt_count
Quantity argument: 1
one:   %lld receipt
other: %lld receipts
```

| Platform | Exported representation | Consumer responsibility |
| --- | --- | --- |
| [iOS](ios-plurals.md) | `.xcstrings` with plural variations, optionally an explicit substitution | Look up the correct bundle and format with the integer argument. |
| [Android](android-plurals.md) | `<plurals name="receipt_count">` with quantity items | Use Android's quantity-resource API and pass formatting arguments. |
| [Web](web-plurals.md) | JSON containing ICU plural messages | Use an ICU MessageFormat-compatible formatter with the requested language and numeric `count`. |
| [Backend](backend-plurals.md) | JSON containing ICU plural messages | Use an ICU-compatible formatter in the backend language, with the recipient's language and numeric `count`. |

## Recognizing a plural requirement

| Finding | Interpretation |
| --- | --- |
| "1 receipt" / "2 receipts", variable file counts or remaining steps | Use plural forms instead of manual language branches. |
| A `count == 1` / `count === 1` branch, appended `s`, or separate `_singular`/`_plural` keys | Candidate for one plural key; inspect the semantic context. |
| Number plus noun with identical spelling in one language, such as German "%lld Artikel" | Other languages may still need distinct forms. |
| "Version 3", an order number, time, percentage or decimal measurement | Not automatically quantity-dependent. |
| A numeric count converted into a `%@` string | Keep the quantity numeric for selection; use the matching integer format. |

Identify which number determines grammar rather than blindly choosing the first
one. A source language with identical forms is not evidence that all translations
can use a single plain sentence.

## Shared authoring rules

- A variable count that changes grammar needs plurals, even if the source language
  happens to spell both forms identically. Avoid separate `_singular`/`_plural`
  identifiers, appended `s` and application-side `count == 1` language rules.
- The current Localize workflow uses one **integer** argument as the selector.
  Select the correct argument when multiple numbers occur. Do not pass a formatted
  string such as `"1,000"` in place of the quantity.
- `other` is required. Supply each target language's relevant CLDR categories;
  `one`, `few` and `many` are language rules, not universal numeric constants.
- Preserve all format arguments and their types in every form. Each translated
  form is checked against the base language's form of the **same category**, or its
  `other` if that category is absent. A translated `zero` such as "Keine Belege"
  without `%lld` is therefore rejected (422) unless the base language also has a
  `zero` form without it: add the base `zero` first. Number multiple arguments
  consistently so translations can reorder them.
- Enable **Mengenabhängig (Plural)** beside the source text and use **Menge steht in**
  for its selector. Check every language and any platform overrides; apps receive
  the forms with the next approved release.
- String arrays are not plurals: they are ordered Android lists, not count-selected
  forms. Device/nested-selector variations are not supported by the current workflow.

## Arguments across export formats

- iOS keeps supported printf arguments and identifies the integer plural selector.
- Android converts supported types to Java Formatter syntax, such as `%lld` to
  `%1$d` and `%@` to `%1$s`. Quantity selection and format arguments are separate
  parameters of Android's resource API.
- Web/backend plural exports map the selected quantity to ICU **`count`** and
  other arguments to **`argN`**, where N is the source argument position. For
  `%1$@ has %2$lld receipts` with selector 2, consumers pass `arg1` and `count`.
- These ICU rules describe plural messages, not every plain JSON text. Do not
  assume all plain printf text has also been converted to ICU.
- Preserve the actual export contract instead of applying a second format rewrite.
  Each platform reference contains concrete consumption examples.

## Zero and other platform differences

- An explicit Localize `zero` text can be exported as an Apple zero form. In ICU,
  Localize emits an exact **`=0`** case as well as the CLDR `zero` category.
- Android's `quantity="zero"` is a **CLDR category**, not a universal exact-zero
  override. For English/German, `getQuantityString(..., 0, ...)` normally selects
  `other`, not `zero`. If an exact-zero business message is required there, handle
  that explicit case with an appropriate localized text; do not implement the
  remaining language-specific plural rules yourself.
- These distinctions matter even when the source forms are shared. Test the
  actual platform runtime rather than assuming all renderers treat `zero` alike.

## Verification in consumers

For each assigned platform, exercise 0, 1, 2 and a larger quantity in multiple
languages. Add language-specific cases such as Polish 5/22 or Arabic 2/11. Test
multiple arguments with distinct quantities, argument reordering, platform overrides
and any explicit zero message. Verify that each built app/service uses the intended
release and that no raw key, printf format or ICU template reaches the user.
