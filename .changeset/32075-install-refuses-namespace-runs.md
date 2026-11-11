---
'@objectstack/spec': minor
'@objectstack/core': patch
---

fix(spec)!: install refuses the namespace `runs`, so every package with a hook has a qualified hook address (ADR-0150 D5)

Clause-②: yes (narrowing, as the card declares: install refuses a namespace it accepts today)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an author does about a refused namespace is rename it, which no conversion can choose for them -->

**BREAKING** accept-set narrowing for ADR-0150 D5: `runs` joins the namespaces the address grammar refuses (`actions`, `connectors`, `global`, `hooks`, `oauth`, `trigger`). Measured first-party: 0 manifests, examples, fixtures or templates declare it.

- **Why.** The qualified inbound hook `POST /api/v1/automation/hooks/:ns/:flowName/:hookId` never takes `runs` as its qualifier: `POST /api/v1/automation/hooks/runs/:runId/resume`, `…/cancel` and `…/restore-suspension` are the run doors of a flow named `hooks`, with the same verb and arity. A package namespaced `runs` therefore had no qualified hook address, and it was the one such namespace install still accepted.
- **Before.** A package under `namespace: 'runs'` validated, built and installed, and its hook answered at the bare path only.
- **Now.** `NAMESPACE_POSITION_LITERALS.inboundHook.literals` (`@objectstack/spec/kernel`) reads `['runs']`, so `NAMESPACE_REFUSED_LITERALS` holds `runs` and the one judge (`validateNamespaceNotAddressLiteral`) names it with its door, `/automation/hooks/runs`. Every reader of that judge follows with no code of its own: the running install door answers `422 NAMESPACE_CONFLICT`, `os validate` and `os build` exit 1 and `os build` writes no artifact, `defineStack` warns once and still returns the stack, and `os migrate stored-references` lists an installed one under `literalNamespaces`. `readNamespacePositionSegment('inboundHook', 'runs', …)` now reads `literal`.
- **One source.** `INBOUND_HOOK_QUALIFIER_EXCLUSIONS` (`@objectstack/core`) is that spec entry itself, no longer a second spelling of `['runs']`. Its value is unchanged, and so is every answer of the allow-list row and of the trigger mount.
- **Who moves.** An author whose stack, or a `packages[]` body, declares `namespace: 'runs'`, at `os validate`, `os build` and a new install. **The one-line fix:** FROM `namespace: 'runs'` TO any other namespace, e.g. `namespace: 'runs_app'`, and its object names' prefix with it. An object's name is its table name, so a deployment that already holds data under the old names and moves to the new namespace renames those objects, and with them their tables: plan that data move before upgrading the package, or keep the package installed under `runs`, which the server keeps booting.
- **Unchanged.** A package a deployment already holds under `runs` keeps booting with one warning, and a re-install or upgrade under the same id and namespace still installs. Its qualified addresses on the other doors (`/automation/runs/:name`, `/actions/runs/…`, `/meta/:type/runs/:name`) answer as before, and its hook is still reached bare. A namespace that only contains the literal (`runs_app`, `reruns`) is accepted.
