---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
---

feat(automation): a flow's `successMessage` / `errorMessage` are `{{ }}` text slots over the run's variables

Clause-②: yes (widening)
Metadata-protocol: semantic

A screen flow can now finish on "3 contacts enrolled": `successMessage: '{{ enrolledCount }} contacts enrolled'` renders the count the run bound. Until now the engine copied both messages onto the run result as written, so a `{{ }}` hole reached the user raw.

- **Spec (`@objectstack/spec`).** `FlowSchema.successMessage` and `errorMessage` join the flow text slots (`FLOW_TEXT_SLOTS`, `flowTextSlotSources` in `automation/flow-text-slot-template.ts`): `{{ path }}` and `{{ path | formatter }}` holes over the run's variables, the grammar a refusing `end` node's `message` reads. The `flows.<flow>.successMessage` / `.errorMessage` translations are the same text slot as their source, so a single-brace `{token}` in one is refused, and `flowTerminalMessageKey(flow, key)` spells the key the engine reads.
- **Engine (`@objectstack/service-automation`).** Every terminal exit renders the message instead of copying it: `successMessage` over the variables the run finished with (first run, a retried attempt, a resume), `errorMessage` over the variables at the failure point (`{{ $error.message }}` included; the retry-exhausted exit reports the last attempt's rendering). The translated template is picked in the run's locale before the holes are filled, exactly as for a screen's heading. A hole over a variable the run never bound renders nothing, as in every text slot, and a message with no hole is byte-identical. A message that cannot render (a `{{ x | currency }}` hole with no tenant default currency) is left off the result with a warning; the run's verdict stands.
- **Doors (`registerFlow`, `objectstack validate`, the publish gate).** Both keys are judged as a node's text slot is: a single-brace `{var}` token is refused with its `{{ var }}` spelling, and a hole that does not compile (`{{ a + b }}`) is refused with the compile step's words.
- **Console (`@object-ui/app-shell`).** The flow's toasts are drawn as served. The client overlay of `flows.<flow>.successMessage` / `.errorMessage` is removed, because the engine now serves them translated and filled, and an overlay would put the bundle's template, holes raw, over the filled sentence. `launchConsoleFlow` takes the host's `language` in place of `translation: { i18n, language }`, and `interpretFlowResponse` takes the locale string in place of `FlowCopyLocale`.

**What changes for an existing flow.** A stored message containing `{{` now renders its holes, and one containing a single-brace `{…}` token is refused at registration with its `{{ }}` spelling. No first-party flow message contains either.
