# Recognizing and using Android plurals

Start with the [shared plural rules](plurals.md). Resource-module ownership and
export ingestion are covered in [Android integration](android-integration.md).

## Recognize the source and call site

- A `<plurals>` resource with `<item quantity="…">` entries is a plural definition.
  A `<string>` containing `%d` alone is not.
- Look for `getQuantityString`, Compose `pluralStringResource`, and manual branches
  such as `if (count == 1)`. Convert manual grammar decisions to one plural key.
- String arrays are ordered lists, not plural definitions.
- Keep the identifier `receipt_count` identical to Localize and other platforms;
  the resource type changes from `R.string` to `R.plurals` when converting a key.

## Resource example

For an English-source example, the exported resource is:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="receipt_count">
        <item quantity="one">"%1$d receipt"</item>
        <item quantity="other">"%1$d receipts"</item>
    </plurals>
</resources>
```

The current direct XML export contains the project's **source language only**.
Other `values-<locale>/` resources need the application's existing locale-aware
resource generation workflow; do not relabel an English export as German or
invent a CLI language flag. Fill each language's required categories, including
`other`, when generating its resources.

## Kotlin and Compose calls

```kotlin
val count: Int = 3
val text = context.resources.getQuantityString(
    R.plurals.receipt_count,
    count, // Selects the locale-specific category.
    count  // Supplies the %1$d formatting argument.
)
```

For Compose:

```kotlin
import androidx.compose.ui.res.pluralStringResource

val text = pluralStringResource(R.plurals.receipt_count, count, count)
```

The quantity does not automatically fill the formatting placeholder. Supplying
only the selector can leave a raw format in the output. Supply an integer, not
an already localized string such as `"1,000"`. Use the `R` class belonging to the
resource module when the project uses non-transitive resource classes.

## Multiple arguments

For source forms `%1$@ has %2$lld receipt(s)` and quantity selector **2**, the Android
export uses `%1$s` and `%2$d`. The selection argument is followed by **all** format
arguments in their original positions:

```kotlin
val text = context.resources.getQuantityString(
    R.plurals.owner_receipt_count,
    count,
    ownerName,
    count
)
```

Translations may reorder positional references; application argument order stays
the same. Consume the exported Java Formatter syntax rather than converting it again.

## Zero and verification

`quantity="zero"` is a CLDR category, not an exact-zero rule. English/German 0
normally uses `other`. If the product needs a specific empty-state message,
explicitly select its localized text for exactly 0; let Android choose all remaining
plural categories. See the [shared zero rules](plurals.md#zero-and-other-platform-differences).

Build the resource-owning module and each app/widget consumer. Test 0, 1, 2 and a
larger number in multiple configured app languages, with Polish 5/22 or other
language-specific categories when supported. Include Compose recomposition after
language/count changes, multiple arguments and platform overrides. No raw `%1$d`
or incorrect `R.string` lookup should reach the UI.
