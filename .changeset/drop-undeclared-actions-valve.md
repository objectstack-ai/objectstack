---
'@objectstack/runtime': major
---

**[ADR-0110 D3, revised] The undeclared-action refusal has no opt-out —
`OS_ALLOW_UNDECLARED_ACTIONS` is removed before 17 ships.**

D3 as accepted refused an undeclared handler but shipped
`OS_ALLOW_UNDECLARED_ACTIONS=1` as a migration valve that ran it anyway,
"slated for removal in 18". Removed now, for two reasons:

- **It contradicts the ruling it accompanies.** A flag that executes an
  ungoverned, system-elevated handler *is* the fail-open D3 closes. ADR-0049's
  trichotomy has no "enforced unless a flag says otherwise" state.
- **It had no observed users.** A reconciliation sweep across the platform
  packages, every example and every plugin found the only `engine.registerAction`
  call sites are `app-todo`'s eight, all declared. The valve would have shipped
  a documented way to reopen the gate for a population nobody has ever seen.

What it was buying is covered without it: the app still boots, every declared
action still works, D5's boot inventory names each offender at startup, and the
404 names the `defineAction` to add. Migration costs a code change rather than
an env var — the correct price for reopening an authorization gate.

Setting the retired variable has no effect; a regression test pins that, so a
stale deployment script fails loudly rather than silently re-opening the gate.
