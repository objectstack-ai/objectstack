---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

fix(spec): stop offering retired `app` keys in the metadata form, and make the reconciliation gate see tombstones (#5280)

The `app` authoring form rendered **eight** controls for keys `AppSchema` had
already retired to `retiredKey()` tombstones in 17.0.0 — `version`, `homePageId`,
`objects`, `apis`, `sharing`, `embed`, `mobileNavigation` and `aria`. A tombstone
is `z.never().optional()`, so filling one of those controls did not lose the
value quietly: it failed the **entire save** with the key's removal
prescription. The controls are gone, each with a comment in place naming where
the capability went (`manifest.version`; the first `navigation` item by `order`
plus `isDefault`; `defineStack({ objects })`; `defineStack({ apis })`;
`FormView.sharing` for both public access and embedding; the component that
renders the DOM node for `aria`).

Nothing about the contract changes — every one of these keys was already
rejected at parse. What changes is that an author is no longer shown a control
that can only produce a 422.

**The reconciliation gate now judges the right thing.** #3786's
`metadata-form-zod-reconciliation.test.ts` asked whether an offered key was
`∈ shape`. That was the same question as "may the author write this" until
`retiredKey()` existed: a tombstone **deliberately stays in the shape** so the
removal can carry its own upgrade prescription, so every one of those eight keys
read as "the Zod accepts it" and the gate stayed green over all of them. It now
asserts `∈ shape` **and not a tombstone**, in both directions — a retired key
may not be offered, and its absence needs no ledger entry to excuse it. The
detector reads the schema node (`z.never()` under the optional wrapper), never a
list of key names, mirroring `isRetired()` on the JSON-Schema side of
`build-schemas.ts`. The next `retiredKey()` retirement that forgets a form now
fails this test instead of reaching an author.

Retiring an authorable key already required pruning its form input; that step is
now enforced rather than remembered.
