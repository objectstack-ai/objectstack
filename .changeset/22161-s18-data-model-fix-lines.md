---
"@objectstack/lint": patch
---

fix(lint): the six `data-model-rules.ts` rule ids print a fix line of one remedy sentence, and `os explain RULE_ID` carries what those lines used to explain

Clause-②: no

- **Shorter fix lines.** Each finding of these six rule ids now carries a `fix` of one remedy sentence of at most 200 characters on every variant measured, including long object and column names. The three ADR-0120 uniqueness ids carry it as the `hint` that `os validate` and `os build` print after `fix: `; all six print it as `os lint --fix`'s `→ fix:` line. The longest of each, FROM → TO (characters of the fix text alone):
  - `unique/legacy-organization-composite` 592 → 161;
  - `unique/unscoped-declared-index` 380 → 150;
  - `object/missing-name-field` 327 → 188;
  - `unique/double-declaration` 303 → 159 (the contradiction arm; the two redundancy arms were already short and now drop one word);
  - `rollup/non-numeric-aggregand` 300 → 165 (the line no longer names the parent object, so its length no longer grows with that name);
  - `field/select-missing-options` 207 → 180.
- **What moved.** The text the fix lines stopped saying is in each id's `RULE_EXPLANATIONS` entry, which `os explain RULE_ID` prints:
  - `unique/unscoped-declared-index`: what `unique: 'organization'` makes the driver build, and the `os migrate meta --from 17` route for existing sources (one new paragraph);
  - `unique/legacy-organization-composite`: that the respelling makes the listed organization column NULL-safe in place, what the constraint then means, and that duplicate NULL-organization rows block the `recreate_index` with a report rather than failing a boot (one paragraph extended, one new);
  - `unique/double-declaration`: where each scope word may be written (one new paragraph).
  - `object/missing-name-field` now points at `os explain title-format-retired`, whose entry already says why a `titleFormat` template does not count. `field/select-missing-options` and `rollup/non-numeric-aggregand` lost only wording; the rollup entry already carries the reasoning.
- **Runtime publish gate:** none of the six runs there. The three uniqueness entries are `cli`-only registry rules, and the other three run only in `os lint`'s `lintDataModel` sweep. So no 422 `issues[].hint` and no 2xx `advisories[].hint` changes.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
