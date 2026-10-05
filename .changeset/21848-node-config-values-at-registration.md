---
'@objectstack/service-automation': minor
---

fix(service-automation)!: a flow the `kernel:ready` cold-boot bind refuses is no longer left registered and `active` from the boot pull

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a narrowing of what stays loaded at boot: a flow whose registration the kernel:ready cold-boot bind refuses is now withdrawn instead of staying registered from the boot pull. What is refused is unchanged, it is the same refusal registerFlow already made; only its outcome at boot changes. No authorable key, spelling, export or stored shape moves: FlowSchema and every node schema parse exactly what they parsed, the package exports the same names with the same types, no stored row is read or rewritten, and which value an author meant is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered or already-registered); and the change narrows what boot keeps registered, not a runtime interface or a type surface alone (not runtime-interface-only or type-surface-only). -->

**BREAKING**: a flow that loaded `active` before can now be absent after boot. It ships as `minor` under the launch-window convention for accept-set narrowings.

**What was kept before.** A boot registers a package's flows twice. The boot pull runs before a plugin that contributes a node type has registered its executor from its own `start()`, so it cannot check that node's config keys against the descriptor's `configSchema`, and it registers the flow and arms its trigger. The `kernel:ready` bind then re-registers every flow once the executor exists. When it refused one, for an undeclared config key for instance, it logged `[Automation] cold-boot flow bind: failed to register flow` and nothing else: the boot pull's registration stayed, `active` and bound to its trigger, so every run reached the node the refusal located.

**What happens now.** A flow the `kernel:ready` bind refuses is withdrawn: it is not registered, its trigger is unbound, and the same warning names the flow and the refusal. Only that flow is withdrawn; the rest of the package loads, as it already did for a flow the boot pull refuses. A failed or empty read of the flow list still tears nothing down.

**What an author sees now.** The flow is absent (`GET /automation/:name` answers `404`), and the boot warning carries the located refusal. The handling is to correct the config the warning locates; the flow then registers as before.

**Unchanged.** What `registerFlow` refuses, at any door. A flow refused through the `/automation` write doors keeps the definition the engine already held, and a runtime reload that brings a refused body keeps the registered one.
