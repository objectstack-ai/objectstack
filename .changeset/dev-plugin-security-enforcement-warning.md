---
"@objectstack/plugin-dev": patch
---

fix(plugin-dev): ask the published `security` service — in `start()` — whether anything is enforcing, so the "RBAC/RLS/masking are NOT enforced" warning can fire in the state it describes (#10036)

DevPlugin's security warning probed `security.permissions` / `security.rls` /
`security.fieldMasker` from `init()`. Both halves were wrong, and wrong in the
direction that is hardest to notice — silence read as health.

**Wrong signal.** Those three are `SecurityPlugin.init()` registrations. The
`ISecurityService` contract in `@objectstack/spec` names them "implementation
internals and deliberately NOT part of this contract"; the published `security`
service is the contract. Their presence answers "is SecurityPlugin loaded?",
not "is anything being enforced?" — and the two answers come apart at
`SecurityPlugin.start()`, which returns early (when `objectql`/`metadata` will
not resolve, and when the engine cannot take middleware) **before** it publishes
`security` and before it registers a single enforcement middleware. A stack in
that state holds all three internal handles and enforces nothing, so the warning
stayed silent in the one state where its own text is literally true.

**Wrong phase.** `security` is registered in `SecurityPlugin.start()`, which
DevPlugin runs in its own `start()`. Probing it from `init()` would find it
absent on *every* stack, healthy ones included — so swapping only the service
name turns a false negative into a permanent false positive. The check now runs
after the child-start loop, in the boot banner an operator actually reads
(the placement #3900 already established for the production-override brand).

Observable behaviour change, both directions:

- A stack whose `SecurityPlugin.start()` bailed now gets a warning that names
  that state ("LOADED but did not finish starting"), where it previously got
  silence. The internal handles keep their one honest use — telling "never
  loaded" apart from "loaded, then failed to start" — so the operator is
  pointed at the right fix.
- The absent-plugin warning is unchanged in meaning and wording, but is now
  emitted from `start()` rather than `init()`.

This is the same move #10035 made for the other consumer this signal misled
(`plugin-hono-server`'s `/auth/me/permissions` and `/me/apps`). Two consumers,
two packages, one misread — a property of the signal, not of either reader.
