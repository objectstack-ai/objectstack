---
"@objectstack/plugin-approvals": minor
---

**BREAKING** (compile-time only): `ApprovalServiceOptions['logger']` now
declares a **non-optional** `warn`, so a durability report always has
somewhere to land (#9754, #10556). This is the thirteenth of the thirteen
mechanical repairs the card names — held out of #10691 to serialize against
PR #10547, which owned `approval-service.ts` while it was open; that fence
has since cleared.

`minor`, not `major`: during the launch window this stack ships breaking
changes as `minor` — every publishable package versions in lockstep, so a
`major` would promote the whole release. `patch` would be wrong in the other
direction, because this *can* break a consumer's build. This is the same
reasoning #10691 used for the twelve sibling repairs; no exemption for a
types-only break was found there either, and none applies here.

`error` stays optional — hosts legitimately inject reduced sinks, and
requiring `error` was measured and rejected as #9754 option C. What changes
is that its *absence* now has a declared, guaranteed destination. Call sites
keep the `logger?.warn?.(…)` spelling as the backstop for hosts the type
cannot reach, so **no runtime behaviour changes**: nothing that printed
before stops printing, and nothing silent starts printing.

### Who has to change, and what to do

Only a caller that constructs `ApprovalService` (or an `ApprovalServiceOptions`
value) with a `logger` object that has **no `warn` method** — for example
`{ error }` alone. Add a `warn` member; there is no rename, no removal, and no
stored value or metadata key to rewrite. The only non-test construction site
in this repo (`ApprovalsServicePlugin.start`, in this same package) passes the
kernel `ctx.logger`, whose `warn` is already required, so the in-repo cost is
zero.

<!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-approvals/src/approval-service.ts#ApprovalServiceOptions) the tightened type is a plain TypeScript logger interface -- no Zod projection, no metadata surface, and it is referenced by none -- so `objectstack migrate meta` has nothing to rewrite. Nothing is removed or renamed and no stored value moves; the only consumer action is adding a `warn` member at a construction site the compiler names. -->
