---
"@objectstack/objectql": patch
---

fix(objectql): the redactor's end-of-message head invariant becomes a load-time guard and a type, not a doc comment (#9359)

#9275 made the driver-fault statement cut **template-aware**: a separator standing
immediately before a *measured* diagnostic head is the true cut point wherever it falls,
so the head survives and the caller's value is dropped whole. That amendment is safe
because of exactly one property:

> **Only an end-of-message template may declare a head.**

That property is what bounds a hostile value's influence to **over-redaction** — a value
spelling a known head can suppress a real diagnostic and show a forged one, but it cannot
make a value leak. Give a `head` to a family with a **right anchor** and the same cut keeps
everything after that anchor, which on such a cut is statement, which is caller values.

Until now the invariant was held by **prose plus one behavioural case** that forges the
heads the table declares *today*. Nothing stopped a future author adding a head-bearing
row whose `whole` is not end-anchored — the single shape that turns the amendment into a
leak surface.

**The argument for closing it structurally comes from this file's own history.** The head
note once claimed leak-freedom rested on taking the LAST matching head as well as on
end-of-message. Ablated: with the cut changed to take the FIRST head, all 50 cases in the
suite stayed green — an end-of-message pattern matches only once, from its earliest
position. A documented property about this very mechanism was wrong for weeks of reading
and fell only to an ablation. A doc comment is not a guard.

The invariant is now held in two places a future author cannot write past:

- **The type.** `ValueBearingTemplate` is a union of `AnchoredTemplate` (`tail?`, and
  `head?: never`) and `EndOfMessageTemplate` (`head`, and `tail?: never`), so a row
  carrying both no longer compiles.
- **`assertHeadBearingTemplatesAreEndAnchored()`**, called at module load over
  `VALUE_BEARING_TEMPLATES` — the `assertMetaUrlSpellingsAgree()` shape. For every row
  that declares a `head` it requires the `whole` to end with `$()`, to carry no `m` flag
  (under `m`, `$` is end of LINE, so an "end-anchored" template would stop at the first
  newline of a multi-line dump and leave the rest standing) and to have exactly two
  capture groups (`redactDiagnosticValues` reads `whole[1]` and `whole[2]` by index).

**No redaction behaviour changes.** The statement cut, the head set and the templates
themselves are untouched; the guard only refuses tables that could not have been correct.
The existing behavioural case that forges each head is kept — it is evidence, and the
guard is additional rather than a replacement.

The guard is proved to FIRE rather than merely to exist: eight new cases drive each shape
it rejects (right-anchored `whole` with a head, the `m` flag, a wrong group count, a bad
row behind a good one) and pin that it does **not** fire on the shipped rows or on
right-anchored rows that correctly take a `tail`. Reverse-verified both legs — a
head-bearing right-anchored row added to the shipped table makes every test in the package
fail at module load, and a row carrying `head` and `tail` together fails `tsc`.
