---
'@objectstack/spec': patch
---

`ObjectNavItem.recordId`'s docblock said it was "Mutually exclusive with `viewName`" — the guard tolerates that exact pair, deliberately

The docblock read *"Mutually exclusive with `viewName` (viewName is ignored if
both are set)"*. The parenthetical was the tell: *"ignored if both are set"*
describes a **precedence**, not a refusal, so the sentence's own second clause
contradicted its first — and the code agrees with the second clause.
`recordId` + `viewName` parses clean through `NavigationItemSchema`; it is the
one legacy combination `objectNavTargetExclusivity` lets through, and that
guard's own docblock says so in as many words.

**The harm direction is silent in both directions.** An author (or an agent)
who read "mutually exclusive" would avoid a combination the platform accepts,
or file a bug when it parses. Two docblocks in one file described one rule and
disagreed; the guard's was right.

⛔ **No behaviour changes, and the asymmetry is not "unified".** The tolerance
is a recorded decision, and `app-nav-target-exclusivity-export.test.ts` already
pins `recordId` + `viewName` as accepted precisely so that making the target
fields pairwise exclusive goes red. This changeset corrects the **prose** only:
no schema, no guard, no accept set, no authorable key, no export moves. The
`.describe()` strings — the ones that reach `content/docs/references/` — are
untouched.

The corrected docblock now says the pair is tolerated rather than refused,
names the guard that tolerates it, and points at the test that pins it. The
same test file gains a fifth leg asserting the docblock against the accept set
it describes, so the next copy of this sentence goes red instead of shipping:
prose is the only place the tolerated pair is documented, so nothing else was
watching it.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/spec`'s published `files[]` carries both
`dist` and `src/**/*.zod.ts`, and `src/ui/app.zod.ts` matches that glob — the
edited file is shipped as source verbatim. Measured on the built artifact as
well: the new sentence is present in **18** built files under `dist/` and the
old spelling in **0**, with two untouched sentences from the same region
(`navigate straight to the detail page`, and the `filters` docblock's own TRUE
exclusivity claim over `recordId` / `viewName`) present in **18** each as the
lit controls, so the zero is a reading and not a mistyped anchor. The
declaration files do not carry it — this is a field-level docblock inside a Zod
shape — which is why the reach is stated as the bundles and the shipped source
rather than as `.d.ts`.
