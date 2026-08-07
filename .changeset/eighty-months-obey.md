---
'@objectstack/spec': patch
---

ADR-0087 semantic-migration ledger: register the immediate retirement of the `ctx.user.roles` alias

The `roles` alias on `ActorUser` — the `user` envelope an action body reads as `ctx.user` and an
AI route handler reads as `req.user` — was removed outright in protocol 17 (#6011, runtime half in
PR #6048): no deprecation window, no dual-emit. The retirement had shipped, but the ADR-0087
migration ledger carried no entry for it, so it was invisible to `objectstack migrate meta`,
`spec-changes.json` and the generated upgrade guide — while all three sibling faces of the same
ADR-0090 rename (`data.hookContext.session.roles`, `ui.actionSession.roles`,
`CEL/formula: current_user.roles`) were registered. This adds the missing entry
(`actor-user-roles-to-positions`) and regenerates the artifacts projected from it.

FROM `ctx.user.roles` / `req.user.roles` → TO `ctx.user.positions` / `req.user.positions`. The
value is unchanged: both keys were filled from one assignment (`roles: core.positions`), so this is
a pure key rename. Fix: rewrite the read. `roles.includes('admin')` used as an ACCESS CHECK is not
renamed to `positions.includes('admin')` — ask the security service instead (ADR-0095); renaming
that read migrates the defect rather than the code.

Note this face has **no window**, unlike its neighbour `ctx.session.roles` (#5613), which still
dual-emits for one release. `ctx.user.roles` is already absent in 17: a typed body fails `tsc` at
the read, an untyped or sandboxed one silently sees `undefined` — so move the read as you upgrade,
not after. `ctx.user` has never had a spec schema (it is a runtime TS interface), so no
`retiredKey()` tombstone can carry the prescription; this ledger entry and the generated upgrade
guide are the channel.

Spec source change is the registry entry only — no schema, no export, and no authorable key moved.
