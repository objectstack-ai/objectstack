---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
---

feat(automation): a flow's `successMessage` / `errorMessage` are `{{ }}` text slots over the run's variables

Clause-②: no (narrowing) — `registerFlow` and `objectstack validate` (compile, the publish gate) now refuse a flow whose `successMessage` / `errorMessage` carries a single-brace `{token}` or a `{{ }}` hole that does not compile, where they accepted any string before. A `{{ }}` hole in either key now renders instead of being copied, which changes what a stored message means and widens no accept set.

Metadata-protocol: narrowed (`FlowSchema.successMessage` / `errorMessage`, and the `flows.FLOW.successMessage` / `.errorMessage` translation leaves, are refused at the flow doors and the translation parse when they carry a single-brace token or an uncompilable hole; the meaning shift of a `{{ }}` hole, from literal text to a rendered slot, is the semantic half and ranks below it)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed, and a message no first-party producer writes is the only one refused: measured, 0 first-party flow messages (examples, package sources, dogfood fixtures, skills) carry a brace at all. A refused message is one that would otherwise reach the user with its braces raw, and the refusal names the key and spells the `{{ var }}` form to write. A conversion cannot tell whether a literal brace was meant as a hole or as text, so the author decides: write the hole, or rephrase the brace. -->

A screen flow can now finish on "3 contacts enrolled": `successMessage: '{{ enrolledCount }} contacts enrolled'` renders the count the run bound. Until now the engine copied both messages onto the run result as written, so a `{{ }}` hole reached the user raw.

- **Spec (`@objectstack/spec`).** `FlowSchema.successMessage` and `errorMessage` join the flow text slots (`FLOW_TEXT_SLOTS`, `flowTextSlotSources` in `automation/flow-text-slot-template.ts`): `{{ path }}` and `{{ path | formatter }}` holes over the run's variables, the grammar a refusing `end` node's `message` reads. The `flows.<flow>.successMessage` / `.errorMessage` translations are the same text slot as their source, so a single-brace `{token}` in one is refused, and `flowTerminalMessageKey(flow, key)` spells the key the engine reads.
- **Engine (`@objectstack/service-automation`).** Every terminal exit renders the message instead of copying it: `successMessage` over the variables the run finished with (first run, a retried attempt, a resume), `errorMessage` over the variables at the failure point (`{{ $error.message }}` included; the retry-exhausted exit reports the last attempt's rendering). The translated template is picked in the run's locale before the holes are filled, exactly as for a screen's heading. A hole over a variable the run never bound renders nothing, as in every text slot, and a message with no hole is byte-identical. A message that cannot render (a `{{ x | currency }}` hole with no tenant default currency) is left off the result with a warning; the run's verdict stands.
- **Doors (`registerFlow`, `objectstack validate`, the publish gate).** Both keys are judged as a node's text slot is: a single-brace `{var}` token is refused with its `{{ var }}` spelling, and a hole that does not compile (`{{ a + b }}`) is refused with the compile step's words.
- **Console (`@object-ui/app-shell`).** The flow's toasts are drawn as served. The client overlay of `flows.<flow>.successMessage` / `.errorMessage` is removed, because the engine now serves them translated and filled, and an overlay would put the bundle's template, holes raw, over the filled sentence. `launchConsoleFlow` takes the host's `language` in place of `translation: { i18n, language }`, and `interpretFlowResponse` takes the locale string in place of `FlowCopyLocale`.

**BREAKING** accept-set narrowing at the flow doors (`@objectstack/spec`, `@objectstack/service-automation`, `@objectstack/lint`), shipped as `minor`.

- **Before.** `successMessage: 'Enrolled {count} contacts'` registered, `objectstack validate` exited 0, and the run's result carried the string as written, braces and all. A `{{ enrolledCount }}` hole was copied the same way.
- **Now.** `registerFlow` refuses that flow at `successMessage` with the text-slot refusal an `end` node's `message` gets, spelling `{{ count }}`; `objectstack validate` / compile / the publish gate report the issue at `flows[i].successMessage` and exit 1. A hole that does not compile (`{{ a + b }}`) is refused with the compile step's words. A translated `flows.FLOW.successMessage` / `.errorMessage` with a single-brace token is refused by the translation parse. A well-formed `{{ enrolledCount }}` renders over the run's variables at the terminal exit.
- **Unchanged.** A message with no brace renders byte-identical. An absent message stays absent. A hole over a variable the run never bound renders blank, as in every text slot. The run's own verdict, status and history row do not depend on the message.
- **Who sees it.** An author whose flow message carries a closed single-brace token, a hole that does not compile, or a hole over a `$` root the engine does not bind: 0 first-party flows do.

**The remedy.** Write `{{ var }}` holes over the run's variables, spelled as the refusal prints them. For a `{word}` meant as literal text, rephrase it so no closed single-brace token remains (drop the braces, or use other brackets); a lone `{` that closes nothing is not judged.
