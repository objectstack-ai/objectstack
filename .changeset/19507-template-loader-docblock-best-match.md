---
'@objectstack/plugin-email': patch
---

docs(plugin-email): the `TemplateLoader` docblock opened on a "best match" its own next paragraph denies (#19507)

Clause-②: no — no accept set moves, no published payload key changes, no
export is added or removed. The corrected prose ships as JSDoc in
`@objectstack/plugin-email`'s `dist/index.d.ts` (the package publishes `dist`),
which is why this is a changeset rather than `skip-changeset`.

`TemplateLoader`'s docblock in `packages/plugins/plugin-email/src/email-service.ts`
contradicted itself inside one paragraph. It opened with *"Returns the
best-matching row for `(name, locale)`"* and then, two lines later, correctly
said *"`locale` set → an EXACT match for that locale, or `null`"*.
`SendTemplateInput.template` (`packages/spec/src/contracts/email-service.ts`)
declares the opposite of the opening in as many words: there is no "best match"
and no language-subtag folding, the locale row is resolved by the exact ladder.

The opening now states what `createSysEmailTemplateLoader` implements, measured
against the code at this branch's base rather than against any transcription of
it — `load(name, locale)`:

- `locale` given ⇒ `first({ name, locale }, BY_ID)`, an exact `(name, locale)`
  match ordered by `id`, or `null`;
- `locale` absent ⇒ `first({ name, locale: 'en-US' }, BY_ID)` first, and only
  when that misses, `first({ name }, BY_LOCALE)` — the bundle's lowest locale
  tag, ordered;
- no branch asks the store to pick a locale, and none folds a subtag.

This is the fourth shipped carrier of the same false declaration and the first
outside the set #18499 enumerated: that probe was written as the literal strings
`best-matching locale` / `picks the best`, and this sentence says
"best-matching **row**", so it was never in the hit set. A carrier set built
from literal strings is blind to its own synonyms.

No resolution behaviour changes: the edit is prose. `createSysEmailTemplateLoader`,
the `sendTemplate` ladder and every `where` clause are untouched.
