---
"@objectstack/runtime": major
---

feat(runtime)!: action body `ctx.session` emits `positions` (canonical) alongside the deprecated `roles` (#5613)

`buildActionSession()` — the one producer of the action-body `ctx.session` — now
emits the caller's position names under **both** `positions` (canonical) and
`roles` (deprecated alias), with the same array under both names. This is the
**runtime half** of #5613 phase 2 under the maintainer's contract-first ruling
("C skeleton + A semantics"); the spec half (#5779) declared the shape this now
produces, and phase 1 (#5697) declared the shape it produced before.

**What was wrong.** The builder copied `ExecutionContext.positions` into a key
spelled `roles` — the one spelling ADR-0090 D3 bans — while its own docblock
claimed it "mirrors the hook `ctx.session` shape". That sentence stopped being
true at #5050, which retired `HookContext.session.roles` outright: a body author
met two different answers to one key name on one platform, and the comment
pointed at the wrong one. The key set reached no schema and no gate until #5697,
so nothing could see it drift.

**Migration prescription — do this now.**

- Read `ctx.session.positions`. It carries exactly the array `ctx.session.roles`
  carried (`ExecutionContext.positions` — the rename is a rename, not a semantic
  change), and it is the spelling the platform now uses everywhere: the
  execution context, the sharing service, `ctx.user.positions`, and the hook
  `ctx.session.positions` (#5605).
- `ctx.session.roles` still resolves for the length of the deprecation window
  announced by the ADR-0087 semantic migration
  `action-session-roles-to-positions`, and is then removed on the path
  `session.tenantId` already walked (#3280 deprecated → #3290 removed in v11). A
  body still reading it at that point sees `undefined` with nothing to catch the
  change — which is why the read moves **inside** the window, not at its close.
- Do **not** migrate an access check by renaming it. `roles.includes('admin')`
  rewritten as `positions.includes('admin')` migrates the defect: neither array
  is an authorization input. Privilege is judged by the security service, which
  evaluates capability grants, placements and the derived posture (ADR-0095).
- Presence semantics are unchanged: a context with no positions (or a non-array
  `positions`) yields **neither** key — `'positions' in ctx.session` answers
  `false` exactly when `'roles' in ctx.session` does — and a call with no
  identity envelope still yields no session at all rather than `{}` (#3712).

**Also breaking, for TypeScript consumers of the sandbox seam.**
`ScriptContext.session` (`@objectstack/runtime`, `sandbox/script-runner.ts`) was
`unknown` and is now the exported union `ScriptSession = ActionSession |
HookContext['session']` — the two declared producer shapes this one seam
actually carries. Code that read an arbitrary property off it must now
discriminate the body kind (or read one of the keys both shapes declare:
`userId`, `organizationId`, `positions`). It is deliberately **not** narrowed to
`ActionSession` alone: the seam really does carry hook sessions, and declaring
otherwise would re-create the "one key, two realities" defect this change
closes.

The consistency between what the producer builds and what `ActionSessionSchema`
declares stays pinned in
`packages/runtime/src/action-session-shape-contract.test.ts`, and the observed
shape is verified through a real dispatch in `http-dispatcher.test.ts`.
