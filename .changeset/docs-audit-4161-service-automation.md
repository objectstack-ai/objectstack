---
---

Docs only — no package changes, nothing to release.

Back-fills the implementation-accuracy audit that #4161 never got. Its drift
comment was computed by the mapper bug fixed in #4206: the change to
`packages/services/service-automation` collapsed to the container directory, so
the four docs that actually reference `@objectstack/service-automation` were
either attributed to the wrong package or (on a service-automation-only diff)
not reported at all. Re-derived with the fixed mapper and audited:
`automation/flows.mdx`, `plugins/packages.mdx`, `releases/implementation-status.mdx`,
`releases/v9.mdx`.

44 evidence-backed fixes, 5 repaired by the adversarial verifier. The
substantive ones:

- **`flows.mdx`** — `runAs` now states that a `'user'` run which resolved no
  trigger user has its data operations refused (the axis #4161 tightened);
  `node.type` is documented as an open `string` checked against the live action
  registry at `registerFlow()` (ADR-0018), not a closed enum; the `script`
  executor is described as naming a callable, with `'email'` / `'slack'` called
  out as logger-backed markers that record intent without delivering; the
  `.strict()` flow/node/edge/variable shells and the previously undocumented
  `timeoutMs`, `inputSchema`, `waitEventConfig`, `boundaryConfig`,
  `successMessage`, `errorMessage` keys are added.
- **`implementation-status.mdx`** — REST rows carry their real `/api/v1` prefix;
  the memory driver's capability list is replaced with what `InMemoryDriver.supports`
  actually declares; Cache/Encryption/Dataset/Sorting statuses corrected;
  the `msw` column dropped (not a workspace package); `Role` → `Position`
  (ADR-0090 D3), which ratchets `scripts/role-word-baseline.json` down by one —
  that gate fails on a *decrease* too, so the baseline update ships with it.
- **`packages.mdx`** — package inventory and the `create*` plugin-factory claim
  corrected against the real exports.
- **`v9.mdx`** — notes that `os package publish --visibility` has since shipped
  (`private` / `org` / `marketplace`, default `org`).

18 residual items the agents could not resolve without a code-owner decision are
recorded in the PR body rather than guessed at; two are genuine code/doc
contradictions worth their own issues.
