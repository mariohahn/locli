# Recognizing and correctly using iOS plurals

Start with the [shared plural rules](plurals.md). This reference covers iOS detection
and consumption; package ownership, app/extension dependencies and catalog sync
are covered in [iOS integration](ios-integration.md).

## Recognize iOS call sites

Apply the [shared recognition rules](plurals.md#recognizing-a-plural-requirement).
In iOS code, look for `NSLocalizedString`, `String(localized:)`, SwiftUI `Text`,
generated accessors, number interpolation and manual singular/plural branches.
In particular, `String(count)` passed to `%@` hides a numeric selector as text.

## Recognizing plural definitions in a String Catalog

- **Plain text:** `localizations.<language>.stringUnit.value`. Containing `%lld`
  alone does not make the entry plural.
- **Plural:** `localizations.<language>.variations.plural` with category entries.
  Xcode calls the corresponding action **Vary by Plural**.
- **Explicit selector:** A single `substitutions` definition containing `argNum`,
  an integer `formatSpecifier` and `variations.plural`. This matters when a later
  number or an argument after a string controls the quantity.
- **Legacy `.stringsdict`:** `NSStringPluralRuleType` also indicates a plural.
  Localize's CLI reads `.xcstrings`; migrate legacy resources using the project's
  Xcode workflow before synchronizing them.

The current sync supports flat categories and **one** plural selector, alongside
other ordinary arguments. Device variations and nested selectors are rejected,
not silently simplified. Xcode's `%arg` inside a supported substitution is mapped
to the numbered argument during push; do not manually replace it in translations.

## Complete basic catalog example

Use underscore identifiers on iOS too, such as `receipt_count`. Placeholders belong
in translated values, not the identifier. German and English example values are
deliberately retained in their respective languages:

```json
{
  "sourceLanguage": "de",
  "version": "1.0",
  "strings": {
    "receipt_count": {
      "extractionState": "manual",
      "comment": "Number of receipts shown in the overview",
      "localizations": {
        "de": {
          "variations": {
            "plural": {
              "one": { "stringUnit": { "state": "translated", "value": "%lld Beleg" } },
              "other": { "stringUnit": { "state": "translated", "value": "%lld Belege" } }
            }
          }
        },
        "en": {
          "variations": {
            "plural": {
              "one": { "stringUnit": { "state": "translated", "value": "%lld receipt" } },
              "other": { "stringUnit": { "state": "translated", "value": "%lld receipts" } }
            }
          }
        }
      }
    }
  }
}
```

`stringUnit.state` is catalog metadata, not a replacement for Localize release approval.

## Catalog synchronization

Author forms using the [shared Localize workflow](plurals.md#shared-authoring-rules),
then consume an approved release or explicitly inspect working state during development.

If a plural entry is authored in Xcode first, `push` uploads its forms for languages
Localize does not have yet and enables plural on the key. Existing Localize values
are never replaced: convert those in Localize, then synchronize.

## Swift / SwiftUI calls

Prefer the project's existing typed formatter or generated accessor if it supports
plurals correctly. The following fallback assumes an **app-owned catalog in the
main bundle**; use the [shared-package accessors](ios-integration.md) when resources
belong to a Swift package:

```swift
import Foundation

func receiptCountText(_ count: Int64) -> String {
    let format = String(localized: "receipt_count")
    return String.localizedStringWithFormat(format, count)
}
```

```swift
import SwiftUI

// count is numeric, not an already formatted string.
Text(verbatim: receiptCountText(Int64(count)))
```

The catalog must belong to the bundle used for lookup. Package resources require
`bundle: .module` inside the package. These examples use Foundation localization:
setting only SwiftUI's `environment(\.locale, ...)` does not automatically change
that Foundation lookup. Use the application's actual language/bundle mechanism
in tests as well.

### Common mistakes

```swift
// Wrong for receipt_count: this creates a different interpolated lookup key.
Text("receipt_count \(count)")

// Does not perform plural formatting: the quantity is never supplied.
Text("receipt_count")

// Wrong for a %lld argument: supplies a string instead of an integer.
String.localizedStringWithFormat(format, String(count))

// Do not replace language-dependent plural rules with this branch.
count == 1 ? "1 receipt" : "\(count) receipts"
```

The formatted result is already localized. `Text(verbatim:)` displays it without
another key lookup. Do not append a plural suffix or localize the result again.

## Multiple arguments and quantity selection

Example German forms with owner and quantity, identifier `owner_receipt_count`:

```text
one:   %1$@ hat %2$lld Beleg
other: %1$@ hat %2$lld Belege
```

```swift
let format = String(localized: "owner_receipt_count")
let text = String.localizedStringWithFormat(format, ownerName, Int64(count))
```

Argument 1 is the string; argument 2 is the quantity. Set the Localize selector to
**2**. A translation may place `%2$lld` before `%1$@`; supplied arguments keep their
positions and types. Do not mix numbered and unnumbered placeholders in one text.
For package resources, these lookups belong inside the package and must also pass
`bundle: .module`.

A supported explicit substitution for one language looks like this:

```json
{
  "stringUnit": { "state": "translated", "value": "%#@count@" },
  "substitutions": {
    "count": {
      "argNum": 2,
      "formatSpecifier": "lld",
      "variations": {
        "plural": {
          "one": { "stringUnit": { "state": "translated", "value": "%1$@ hat %2$lld Beleg" } },
          "other": { "stringUnit": { "state": "translated", "value": "%1$@ hat %2$lld Belege" } }
        }
      }
    }
  }
}
```

For the naturally first integer selector, the export may instead produce direct
`variations.plural`. Retain the structure generated by Xcode/export rather than
manually converting every entry into a substitution.

## Language rules and verification

- German/English use `one` and `other` for usual integer counts. Polish additionally
  needs `few` and `many`; Arabic needs further categories. Use the complete forms
  required by Localize and the target language.
- A `zero` value has platform-specific semantics. Apple's explicit zero form and
  ICU `=0` are not Android's CLDR `zero` category. Do not assume Android selects
  `zero` for a German count of 0.
- Pass the matching integer type for `%lld` and text for `%@`. Preserve precision
  such as `%.1f` and escaped literal percent `%%`. A decimal placeholder is not a
  supported quantity selector for this Localize/iOS workflow.
- Test 0, 1, 2 and a larger count in the built application. For Polish, include
  values such as 5 and 22. When multiple numbers occur, use distinct values to
  reveal selector mistakes, e.g. 7 of **1** versus 1 of **7**.
- Also test argument reordering, platform overrides and the catalog diff after
  pull. Finding `%lld` or parsing valid JSON does not prove runtime plural behavior.
- For a shared package, verify both the host app and the independently running
  widget/extension. A successful app lookup alone does not prove extension wiring.
