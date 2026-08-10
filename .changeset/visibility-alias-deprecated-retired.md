---
"@objectstack/lint": minor
---

refactor(lint)!: retire `visibility-alias-deprecated` — the rule could not fire on any real CLI input (#6318, ADR-0049)

`@objectstack/lint` shipped a fourth conditional-visibility rule whose only job
was to report the deprecated predicate **key** (`visibleOn` on a view form
section/field, `visibility` on a page component) and steer the author to
`visibleWhen`. It never reported on anything a command actually loads.

**Why it could not fire.** The rule is registered `input: 'normalized'`, so what
`os validate` / `os build` / `os lint` hand it is the output of
`normalizeStackInput`. The two ADR-0087 D2 conversions that fold the alias —
`view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen` —
run **inside** `normalizeStackInput`, one layer above. The key is therefore
already renamed by the time the rule sees the stack. Re-measured per site:

| alias site | rule fed the raw authored object | rule fed the `normalized` tier |
|---|---|---|
| `views[].form.sections[]` | 1 finding | **0** |
| `views[].formViews.edit.sections[]` | 1 finding | **0** |
| `pages[].regions[].components[]` | 1 finding | **0** |

The one shape it did still fire on is a view **container** carrying top-level
`sections` — the shape its own unit tests used, and the shape strict
`ViewSchema` refuses outright (`Unrecognized key(s) on this view container:
\`sections\``). A green unit test over a fixture production can never send.

**No working app loses a signal.** Authors were never hearing this rule, and
they do hear the conversion: the same D2 entry emits a `warnConversionNotice`
from `defineStack` that names the site, the conversion id and the retirement
window — wording the lint rule never had.

```
defineStack: views[0].form.sections[0].visibleWhen: 'visibleOn' -> 'visibleWhen'
  (converted at load; conversion 'view-visibleOn-to-visibleWhen', retires in protocol 16).
  Update the source to the canonical shape — the conversion stops running then.
```

**Authored metadata is unaffected.** `visibleOn` / `visibility` remain accepted
exactly as before, still fold to `visibleWhen`, and still retire with protocol
16. Nothing an app author writes has to change.

**Consumer migration — one removed export.** The rule id constant leaves the
published barrel:

- `VISIBILITY_ALIAS_DEPRECATED` (`'visibility-alias-deprecated'`) is removed from
  `@objectstack/lint`. Delete the import; no finding carries that `rule` value
  any more, so a `suppressWarnings: ['visibility-alias-deprecated']` entry or a
  filter comparing against it is now dead code and can go with it.

The other three rules in the same module are **unchanged** — they judge the
predicate's *value*, which crosses the fold into `visibleWhen` intact, and each
still reports normally on the `normalized` tier:
`visibility-root-mislayered`, `visibility-bare-identifier`,
`visibility-predicate-syntax`. `checkElement` also keeps reading the predicate
through the deprecated keys (canonical-first, so an alias can never override
`visibleWhen`), which is what lets those three still judge an alias-spelled
predicate handed to the exported function directly.

Retired rather than re-anchored: making the rule read a genuine pre-normalize
value would have changed `runAuthoringRules`' external input contract, which is
a `packages/lint` public-API decision for the maintainer rather than a rule
file's to take.

<!-- adr-0087: not-required (already-registered view-visibleOn-to-visibleWhen, page-component-visibility-to-visibleWhen) The authored alias surface is already covered by those two D2 conversions, which are unchanged by this PR — they keep accepting `visibleOn` / `visibility`, keep folding them to `visibleWhen`, and keep their protocol-16 retirement window. This change removes only a lint rule id from a TS export surface; no authored or stored metadata shape changes, so there is nothing new for the ledger to carry. -->
