---
'@objectstack/lint': minor
---

fix(lint)!: a view container whose `object` names no object is refused by `os validate`, `os build` and `os lint` (`object-reference-unknown`), and the refusal names the namespace-prefixed object when that is the one the stack declares (#20216)

Clause-②: no (narrowing)

**BREAKING** — an accept-set narrowing on one authored key, shipped as `minor` under the
launch-window convention (`check-changeset-no-major` refuses `major` until GA; breaking-ness
is carried by this banner and the ADR-0087 disposition below, not by the level).

**What changed.** `ViewSchema.object` is how a stack-level `views: [...]` container says
which object its views belong to, and it is the key the runtime indexes views by
(`getViewsByObject()` / `GET /meta/view?object=`). The schema declares it `z.string()`, and
nothing resolved it: `defineStack`'s cross-reference check reads a container's
`list.data` / `form.data` bindings, never the container's own key. So a container bound to a
name no object carries passed: `os validate` printed "Validation passed" and exited 0,
saying nothing about the view, and `os build` / `os lint` run the same rule table. At
runtime none of its views was found for any object. The common case is not a typo but a
missing namespace prefix — `object: 'order_line'` in a project whose object is
`my_app_order_line` — which is exactly what `os generate view` wrote in every namespaced
project until its template learned the prefix.

The key now joins `validateObjectReferences` and rides the ladder every other object-name
site on that rule uses, resolved against the same set as a field's relationship target:

1. the stack's own objects, or an object an entry of the artifact's `packages[]` provides → ok;
2. a known platform object (`PLATFORM_PROVIDED_OBJECT_NAMES`) → ok;
3. unresolved and not platform-prefixed → **`error`** `object-reference-unknown` at
   `views[N].object`, so `os validate` / `os build` / `os lint` exit 1;
4. unresolved, platform-prefixed, registered by nothing → the existing
   `object-reference-unregistered-platform` advisory.

The refusal lists the objects the stack does declare, and when the bound name is exactly a
declared object minus the stack's `manifest.namespace` prefix, the hint names that prefixed
object outright. Not judged, on purpose: a container that carries no `object` (its binding
then falls back to `list.data.object` / `form.data.object` / its `name`, a different
reference), and a container authored at runtime (this rule does not run on a `view` write at
the runtime publish gate; that door is unchanged).

## The accept set, before and after

This is a behaviour table, not a rewrite: the FROM column is what the door did, the TO
column is what it does now.

| where | FROM | TO |
|:--|:--|:--|
| `os validate`, `os build`, `os lint` on a view container bound to a name no object carries | exit 0, no finding | exit 1, `object-reference-unknown` at `views[N].object` |
| the same, on a platform-prefixed name nothing registers | exit 0, no finding | the `object-reference-unregistered-platform` advisory, exit unchanged |
| a runtime `view` write | unchanged | unchanged |

Nothing an author writes changes spelling, and no key or value is retired. A container that
is refused was already dead at runtime; the finding's own hint says which object to bind it
to.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `packages/spec` is untouched, `ViewSchema.object` keeps its key, its type and its legality, and no stored metadata representation changes shape, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What narrows is the set of VALUES the author-time rule accepts for a reference that must resolve to a declared object, and which declared object an author meant is a fact about their stack, never something a mechanical conversion can derive; the refusal carries its own correction. The other categories are closed on facts: `@objectstack/lint` publishes (not `unpublished`); no ADR-0087 id covers it (not `registered` / `already-registered`); and the change is rule behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
