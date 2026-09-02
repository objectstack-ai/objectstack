---
"@objectstack/lint": patch
---

fix(lint): `sharing-rule-runtime-variable-condition`'s fix-hint no longer sends authors to RLS to widen a `private` object (#14234)

The hint printed for a sharing-rule `condition` that reads `current_user.*`
ended in an **unqualified** remedy: "express per-user access with the mechanism
that runs per request instead — an RLS policy on a permission set
(`rowLevelSecurity[].using`, where `current_user.*` IS resolved)". That advice
is sound on an open OWD and **structurally impossible on `private`**, which is
the sharing model an author hitting this rule is most likely to be on.

Measured, not argued. The security layers are AND-composed —
`plugin-security`'s `getReadFilter` returns
`andComposeLayers(andComposeLayers(filter, cbpFilter), sharingFilter)`, and its
own prose promises "the same filter the engine middleware AND-s into" every
find — while `plugin-sharing`'s `buildReadFilter` constrains `private` only
(`effectiveSharingModel(schema) !== 'private'` returns `null`). So:

- `public_read` / `public_read_write` → the sharing layer imposes nothing on
  reads, and an RLS policy **narrows** an open baseline. The original advice is
  correct here and is kept, now with the models it holds for attached.
- `private` → the sharing layer has already withheld the row, and **an AND term
  can only remove rows, never add one back**. An RLS "widener" there lints
  clean, passes every gate, and grants nothing — a silent failure at the
  security boundary, which is the worst possible feedback shape. The card
  records an application author who followed this path and shipped the grant
  unauthored/fail-closed instead.

The hint now splits on `sharingModel` and, for the `private` case, states what
is true: the two doors that widen a private object for a non-admin principal
both key on **who owns the row** or on an **explicit share row**, never on a
property of the record — the ADR-0057 D1 depth scopes (`readScope`/`writeScope`,
which widen the owner-match to `owner_id IN (…)`) and a `sys_record_share` row,
which on this path only a criteria sharing rule writes. Where neither fits, it
names the gap **in words** — a known platform limitation, not something a
different spelling of this rule can close — rather than inventing a mechanism,
and it warns that `position` recipients resolve **tenant-wide**: the
neighbouring temptation is an over-broad grant that also lints clean, not the
narrower one the author meant. The tracker anchor for that gap sits in an
adjacent source comment, not in the message, because a runtime string reaches
authors and generated surfaces that cannot resolve `#NNNN`
(`check:doc-authoring`, maintainer ruling 2026-08-12) — a pin asserts the
message carries no tracker id.

**The explanation is preserved byte-for-byte.** The opening sentence — the
MATERIALISED/`criteria_json` explanation of *why* the condition is refused — is
the most useful part of the diagnostic and is unchanged; a pin asserts it
verbatim. The file's own docblock carried the same unqualified "the fix is RLS"
claim one layer up and is corrected in the same edit.

**No behaviour change**: the rule's accept/reject verdict, its ids, severities,
paths and `message` text are untouched — this is `hint` prose only. AND
composition is correct by design and is not touched either.

A new pin holds the split, because prose is invisible to every other gate —
nothing else in CI reads a word of this hint. Reverse-verified by restoring the
shipped wording: **7 legs go red** (the unqualified-RLS leg, the AND-composition
leg, the widening-doors leg, the `position` warning, the #14103 gap, and both
vocabulary legs), while the verbatim-explanation leg correctly stays green. The
vocabulary legs check every sharing model and depth scope the hint names against
the **spec-owned** `OWDModel` / `ObjectAccessScopeSchema` enums, so a rename in
the spec reds this file instead of leaving the hint quoting values the platform
no longer has — without it the hint and its expectations would move together and
nothing would go red.
