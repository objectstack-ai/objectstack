---
'@objectstack/service-automation': patch
---

fix(service-automation): a currency hole refused after a failed tenant-settings read is a runtime failure, not a guard refusal (#28056)

Clause-②: no (a refusal that followed a failed read of the organization's default currency is now an ordinary runtime failure, which a `fault` edge routes; every run that succeeded still succeeds, and a refusal after a read that succeeded stays the guard refusal it was)
Metadata-protocol: none

A flow text slot's `{{ amount | currency }}` hole with no argument formats in the organization's default currency (`localization.currency`). When none reached the run, the node was refused as a guard refusal: a `fault` edge could not route it, and the message told the operator to set the default currency. That is right when the read succeeded and found none. It was also what happened when the read of `sys_setting` failed, so a transient backend fault failed a `notify` run with a misleading cause, where a retry would succeed.

- **The resolver says when the read failed.** The automation plugin's tenant-currency resolver now rejects when `resolveLocalizationContext` answers `readFailed`, as the messaging channels' reader does (#27257). `FlowTenantCurrencyResolver` documents it: `undefined` means the read succeeded and found no default; a rejection means the read failed.
- **Run setup notes the failure.** Run setup, and a resumed segment that re-reads the default, still leave `AutomationContext.currency` unset, and note the failed read beside that run's context. Nothing is added to `AutomationContext` or the persisted run.
- **The refusal is graded.** When a text slot refuses after a failed read, it is rendered once more with a placeholder currency. If that renders, the only refusal was the missing default: the node fails with a plain runtime error that says the setting could not be read, so a `fault` edge routes it and a flow under `errorHandling.strategy: 'retry'` succeeds once the read does. If it still refuses, a default would not cure it, and the guard refusal stands.
- **Unchanged.** A read that succeeds and finds a default formats in it. A read that succeeds and finds none refuses the node as before.

It applies to every text slot a node renders (`notify`, `http`, `screen`), since they share one renderer.
