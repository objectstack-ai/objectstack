---
"@objectstack/driver-turso": patch
---

fix(driver-turso): narrow every override's `options` from `any` to `DriverOptions` (#6402)

`TursoDriver` overrides 17 methods that take an `options` argument, and every one
of them declared `options?: any` while the base it forwards to (`SqlDriver`, and
behind it the `IDataDriver` contract) declared `DriverOptions`. The keys
`DriverOptions` names — `bypassTenantAudit`, `tenantId`, `transaction`,
`accessible_org_ids`, `skipCache`, `timeout`, … — were therefore unchecked at all
17 doors.

The argument is #5181's, one axis over. An internal caller that misspells
`bypassTenantAudit` gets no runtime complaint: the typo'd key is simply never
read, the write proceeds unaudited, and nothing anywhere says so. `tsc` is the
only channel that ever objects, and `any` had switched it off. Nothing is known
to have gone wrong through this gap — it is closed because the door was open, not
because someone walked through it.

**Why all 17 at once.** The shape was character-identical across every override,
so narrowing a subset would read to the next person as a *verdict* on the rest.
That is not hypothetical: #6075 (PR #6210) narrowed `count`'s `query` and
deliberately left its `options`, and #6212 batch B did the same on `aggregate` —
each leaving a comment saying so. Those comments are now discharged. The three
prior narrowings (#5181 / PR #6076, #6075 / PR #6210, #6212) each closed the
`query` axis; this closes the `options` axis, which had never been touched.

**Consumer impact.** Annotation-only — no runtime behaviour changes, and the full
monorepo typecheck is unchanged at 125/125 green, so no caller in this repo was
passing an off-contract value. It is a `patch` rather than a docs-only change
because the narrowed signatures are public: a downstream TypeScript consumer
holding a `TursoDriver`-typed reference and passing an `options` value that is not
a `DriverOptions` will now see a compile error where it previously saw none. That
error is the point — the value was already being ignored by the driver.
