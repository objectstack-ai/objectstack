---
'@object-ui/plugin-grid': minor
---

fix(plugin-grid)!: a list's selection bar and row menu draw only actions the object declares; an undeclared bare `bulkActions` / `rowActions` name draws nothing and warns once in development (#30169)

Clause-②: no (narrowing) — the grid stops drawing a bare `bulkActions` or legacy `rowActions` name that matches no action the object declares, which it drew before by humanized name. `packages/spec/src/ui/bulk-action.zod.ts` already says the member "names an action the object declares", and lint `action-name-undefined` (ADR-0049) refuses any other at authoring. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: no move — `skills/**` teaches no handler-only bulk or row action name (searched for `bulkActions` / `rowActions` examples and runner-handler text); `content/docs/ui/**` already names only declared actions in its `bulkActions` / `rowActions` examples.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, export or stored row changes shape: `bulkActions` and `rowActions` keep their `string[]` form and meaning. What narrows is the renderer's draw set, back to the spec's own sentence. Whether an undeclared name was a misspelling, an action still to declare or a handler the host meant to keep is a judgement about the view, so no rewrite derives the fix; the development warning names each name. -->

**BREAKING** for a host that registered a runner handler under a bare name the object does not declare (`ActionProvider handlers` / `runner.registerHandler('NAME', …)`) and listed that name in a view's `bulkActions` or `rowActions`.

- **Before.** `resolveBulkActions` and `resolveLegacyRowActions` kept a name that matched no declared action, and `ObjectGrid` drew it by humanized name and dispatched it to the runner by name. A name nothing handled toasted "not executable" on click. This is how a list whose app had a package disabled kept a ghost button: the server withholds that package's actions from the served object, so their names matched nothing.
- **Now.** Such a name gets no selection-bar button and no row-menu entry, and in development the console logs one warning per list naming the key, the block and each name. The resolvers return those names as `undeclared` (renamed from `unresolved`), used only for that warning. The canonical `'delete'` (and the row menu's `'edit'` / `'delete'`) keep their own paths, unchanged.
- **Unchanged.** A name that matches a declared action is promoted to that action's def exactly as before, under the action's own label, icon, params, `visible` and `requiredPermissions`.

**FROM → TO.** `bulkActions: ['NAME']` (or `rowActions: ['NAME']`) where the object declares no `NAME` action, served by a runner handler → declare `NAME` as an action on the object, or remove the name. An action withheld by a disabled package needs nothing: it returns when the package is enabled.
