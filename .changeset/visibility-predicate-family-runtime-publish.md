---
"@objectstack/lint": minor
---

feat(lint): the `views[]` visibility-predicate family now gates runtime `view` publishes (#7220)

The four rules that judge a `views[]` conditional-visibility predicate ran on the
three CLI commands only. A `view` written through the runtime publish door —
Studio's designer, REST `/meta`, MCP — was judged by **none** of them, and that
door is the only one most tenants have and the one AI authors use. A predicate
that cannot parse saved clean and then failed OPEN in the console: the element
renders unconditionally, pixel-identical to one carrying no predicate at all
(#5149).

Both registry entries move to `surfaces: ['cli', 'runtime-publish']` with
`runtimeTypes: ['view']`, in one edit. A publish of a `view` is now refused with
`422 invalid_metadata` when a predicate on it:

- is not valid CEL (`visibility-predicate-syntax` — `===` instead of `==`);
- is valid CEL but overruns a parse bound (`visibility-predicate-over-budget`);
- names a bare identifier no binding root resolves (`visibility-bare-identifier`
  — `status` instead of `record.status`);
- names a path the target schema does not declare, or a schema key without its
  root (`predicate-path-unresolved` / `predicate-path-unrooted`, schema-bound
  forms only).

A mis-layered binding root (`visibility-root-mislayered`) is `warning` on every
surface and does not block: it rides back on the 2xx save response under
`advisories` (#4717), which is what let this move happen at all — running rules
and discarding their verdicts is the shape #4463 exists to close.

**They move together on purpose.** The rule for predicate paths had its solo
wiring implemented and then reverted, because a `view` refused for an
unresolvable path while a predicate that does not parse at all walks through the
same door is less predictable than refusing neither. `authoring-rule-wiring.test.ts`
now pins the family property directly — all of this surface's ids are gated at the
runtime door, or none is — so the halves cannot drift apart again.

Nothing changes for `os validate` / `os build` / `os lint`: the runtime door and
the CLI reach identical verdicts (same id, severity and path) on every input, and
a valid `view` still publishes with an empty `advisories` set.

Writes that carry one of the defects above and used to succeed will now be
refused. The findings name the site and the fix, `OS_ALLOW_UNLINTED_METADATA_WRITES=1`
remains the migration hatch, and drafts are never gated — only a publish is.
