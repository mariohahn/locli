# Translating

Out of the box, a model translates word by word: the wrong form of address, product
names in French, a dropped placeholder, a button label three times too long. Follow
this whole workflow whenever you write or change translations, not only for big batches.

## 1. Read the guide first

`npx @locli/cli guide` (MCP: `locli_guide`) shows the project's translation guide:

- **Tone** per language: form of address (du/Sie, tu/vous), register, length. A `*`
  entry applies to every language. No entry: match the tone of the existing texts in
  that language, and if there are none, ask the user once and offer to save the answer.
- **Glossary**: terms with their required translation per language (several accepted
  forms separated by `|`, e.g. `anmelden | melde dich an`), and terms marked *keep* that stay
  exactly as written (product and plan names, brands, code words).
- **Glossary issues**: current translations that break it. Fix them as part of the task.

When you decide on a recurring term yourself, propose it to the user and add it with
`locli guide --json > guide.json`, edit, `locli guide --set guide.json` (editor role or
write token). Never remove or change someone else's term without asking.

## 2. Know where each text is used

`npx @locli/cli context` (MCP: `locli_context`, `--key auth` for one area) scans the code on
every platform (Swift, Kotlin/Java, Android layouts, TS/JS, Python, Ruby, Go …) and says for
each key where it is used and as what: toolbar item, tab, button, menu item, screen title, form
field, push notification, email, alert, error message, accessibility label or text. Roles with
little room get a length budget in characters (a toolbar item about 12, never less than 1.3 ×
the source) and the command lists every translation in the files that exceeds it.

- Write each text for its role: a toolbar item is one or two words, a title has no period, an
  accessibility label is read aloud and describes instead of abbreviating, a push notification
  is cut after about two lines.
- `push` writes the role as the comment ("Used as a toolbar item: …") for keys nobody described,
  so translators in the editor see it too. A comment someone wrote always wins.
- A key it can't find is unused or built at runtime; look at the code before translating it.
- The budget is a heuristic. When a longer text reads better and the layout can wrap (or you
  make it wrap), that is fine; check it in layer 4.

## 3. Translate from the source

- Translate from the source language (`sourceLanguage` in `locli.json`), never from
  another translation, and use the key's comment for context (where it appears, what each
  placeholder holds). No comment and the meaning is unclear: look at the code that uses
  the key before guessing.
- Keep placeholders exactly ([placeholder rules](../SKILL.md#rules-that-always-apply)),
  keep plural categories complete for the language ([plurals](plurals.md)), keep
  keys, URLs, markup and the glossary's *keep* terms untouched.
- Stay within the length the UI allows (`locli context`): toolbar items, tabs, buttons and
  store fields ([store listings](store-listings.md)) are short; when the source is short, the
  translation is too.
- Work in batches of about 50 texts per language, so each batch can be checked.

## 4. Check in four layers

Report the result of each layer to the user; don't skip one silently.

1. **Mechanical.** Run `npx @locli/cli push --dry-run` first: it checks the files against
   the glossary and the length budget of each key's role before anything is uploaded. Fix
   every warning in the files, because once a
   text is in locli `push` never overwrites it. Then `push` validates placeholders and plural
   forms; a 422 means the text is wrong ([errors](errors.md)). Build the app's catalogs
   (Xcode, Gradle, the web build) so a broken file fails now.
   A glossary warning on a correct inflected form ("Melde dich an" for *anmelden*,
   "Connecte-toi" for *se connecter*): rephrase with the glossary form where that reads
   naturally ("Jetzt anmelden …"); otherwise ask the user to add the form to the term
   (`anmelden | melde dich an`) instead of ignoring the warning.
2. **Back-translation.** Translate each new text back into the source language, without
   looking at the source, and compare the meaning. Where a browser or a translation API
   is available (Google Translate, DeepL), use it as a second engine; a meaning that
   comes back wrong in both is a real error. Small wording differences are fine.
3. **Independent review.** Ask a reviewer that did not write the text, ideally a different
   model or provider (a sub-agent, a second CLI), to check each language for meaning,
   tone, glossary and length. The reviewer reports only and does not edit. Check its claims
   about platform terminology against the official help pages (Apple, Google) before
   applying a change, then let a second reviewer look at the fixed texts.
4. **Visual.** Run the app or capture screenshots in the longest language you added
   (often German or Finnish) and in a right-to-left language if the app has one. Look for
   wrapping, truncation and cut-off buttons; shorten in locli where needed.

## 5. Hand over

`npx @locli/cli status` shows what waits for a release. Tell the user which languages
you translated, how many texts, what each layer found and fixed, and which texts you were
unsure about. A project owner approves the release; never approve it yourself.
