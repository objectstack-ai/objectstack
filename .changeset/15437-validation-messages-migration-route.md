---
'@objectstack/spec': patch
---

The `translation-validation-messages-removed` migration text names the object-scoped bundle key, not just the authored literal

`validationMessages` was retired in 17.0.0 (#4667). The ADR-0087 conversion that
migrates it told an author to author the message on the rule
(`object.validations[].message`) and stopped there. Since 17.3.0 (#14381,
#14253) that message has a translation route —
`objects.<object_name>._validations.<rule_name>.message`, resolved on the write
path — and the sibling prescription ten metres away in the same package
(`TRANSLATION_KEY_GUIDANCE.validationMessages`, the text the strict door
returns) already names it.

⛔ Nothing the old text said was false, and none of it is deleted. The defect is
**silence**: this is the *migration* text, read by exactly the population that
authored the retired key — the authors who wanted their rule messages
translated — and it steered them to a plain authored literal without mentioning
that the bundle key now exists. The literal advice stays; the route is added
after it.

**Two texts in the file carried the narrow prescription, not one.** The
conversion's `summary` is the one the card named; the docblock above it asserted
that rule messages are *"not translated through a group"*, which would have sat
directly above the corrected summary. Both are completed. The docblock keeps its
17.0.0 sentence — still true of the retired key — and says what 17.3.0 changed,
including why the object-scoped group is not `validationMessages` returning (the
retired one was keyed by rule name at the top level, could not tell two objects'
rules apart, and had no reader).

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `packages/spec/src/conversions/registry.ts` is not a
`.zod.ts`, so it is not shipped as source — but two published paths move,
measured on the built tree rather than reasoned about:

- `dist` is in `files[]`, and the new sentence is emitted into six built files
  (`dist/index.js` / `.mjs`, `dist/shared/index.js` / `.mjs`,
  `dist/browser/index.js` / `.mjs`); a negative control string scored 0 on the
  same tree. An author running `os migrate meta --from 16` reads the changed
  notice out of that runtime string.
- `spec-changes.json` is itself listed in `files[]`, and it carries the summary
  twice. It is generated (`gen:spec-changes`), and `check:generated` caught it
  stale — the conversion registry feeds two generated artifacts, not one.

`docs/protocol-upgrade-guide.md` is the third, regenerated with
`gen:upgrade-guide` and verified by `check:upgrade-guide`; all three are
regenerated, never hand-edited.

⛔ No behaviour changes. The conversion id, its `apply`, its accept set and its
fixture are untouched; no authorable key is added or removed.
