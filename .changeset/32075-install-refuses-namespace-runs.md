---
'@objectstack/spec': minor
'@objectstack/core': patch
---

fix(spec)!: install refuses the namespace `runs`, so no namespace it accepts is left without a qualified hook address (ADR-0150 D5)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered manifest-namespace-address-literal-refused -->

**BREAKING** accept-set narrowing for ADR-0150 D5: `runs` joins the namespaces the address grammar refuses (`actions`, `connectors`, `global`, `hooks`, `oauth`, `trigger`). Measured first-party: 0 manifests, examples, fixtures or templates declare it.

- **Why.** The qualified inbound hook `POST /api/v1/automation/hooks/:ns/:flowName/:hookId` never takes `runs` as its qualifier: `POST /api/v1/automation/hooks/runs/:runId/resume`, `…/cancel` and `…/restore-suspension` are the run doors of a flow named `hooks`, with the same verb and arity. A package namespaced `runs` therefore had no qualified hook address, and it was the one such namespace install still accepted.
- **Before.** A package under `namespace: 'runs'` validated, built and installed, and its hook answered at the bare path only.
- **Now.** `NAMESPACE_POSITION_LITERALS.inboundHook.literals` (`@objectstack/spec/kernel`) reads `['runs']`, so `NAMESPACE_REFUSED_LITERALS` holds `runs` and the one judge (`validateNamespaceNotAddressLiteral`) names it with its door, `/automation/hooks/runs`. Every reader of that judge follows with no code of its own: the registry's install gate raises `NAMESPACE_CONFLICT` (422), which `os package install` answers as `422 PLUGIN_REGISTER_FAILED` carrying the judge's sentence; `os validate` and `os build` exit 1 and `os build` writes no artifact; `defineStack` warns once and still returns the stack; and `os migrate stored-references` lists an installed one under `literalNamespaces`. `readNamespacePositionSegment('inboundHook', 'runs', …)` reads `literal`; no door asks it about the hook's position today.
- **A package already held under `runs`.** It keeps booting, and a re-install or an upgrade under the same id and namespace still installs. New for it: the boot warns once that its namespace spells an address literal, and the report above lists it.
- **The judge's sentence, for all seven literals.** It now ends "so the package's qualified addresses there would never reach it": the refusal is about the doors it names, and a package under `runs` keeps every qualified address but its hook's.
- **One source.** `INBOUND_HOOK_QUALIFIER_EXCLUSIONS` (`@objectstack/core`) is that spec entry itself, no longer a second spelling of `['runs']`. Its value is unchanged, and so is every answer of the allow-list row and of the trigger mount.
- **Who moves.** An author whose stack, or a `packages[]` body, declares `namespace: 'runs'`, at `os validate`, `os build` and a new install. **The one-line fix:** FROM `namespace: 'runs'` TO any other namespace, e.g. `namespace: 'runs_app'`, and its object names' prefix with it. An object's name is its table name, so a deployment that already holds data under the old names and moves to the new namespace renames those objects, and with them their tables: plan that data move before upgrading the package, or keep the package installed under `runs`, which the server keeps booting.
- **Migration entry.** `manifest-namespace-address-literal-refused` (protocol 18, semantic) states this refusal for the class, all seven literals, so the upgrade guide and `os migrate meta` carry it.
- **Unchanged.** The qualified addresses of a package under `runs` on every other door (`/automation/runs/:name`, `/automation/trigger/runs/:name`, `/automation/connectors/runs/:name/connection`, `/actions/runs/…`, `/meta/:type/runs/:name`) answer as before, and its hook is still reached bare. A namespace that only contains the literal (`runs_app`, `reruns`) is accepted.
