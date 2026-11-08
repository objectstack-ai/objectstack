---
'@object-ui/core': patch
---

refactor(core)!: retire two zero-consumer exports from the package entry (`RegisteredAction`, `deepFreeze`)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/core#RegisteredAction, @object-ui/core#deepFreeze) the retired operands are a TypeScript interface and a helper function of the core package; nothing in the workspace or in hotcrm imports either from the package entry (the only other spellings are local declarations of the same names in unrelated test files and in sandbox source text, none of which imports the package), and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `RegisteredAction` or `deepFreeze` from `@object-ui/core`. Neither had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

Both stay in their modules, which this package's own code still reads; only the entry stops publishing them:

- `RegisteredAction` types `ActionEngine`'s private action registry and is not part of any public `ActionEngine` method.
- `deepFreeze` is the freezing step inside `defineSystemView`.

Every other name the entry exported stays exported unchanged, among them `ActionEngine`, `ShortcutBinding`, `ActionLocation`, `ACTION_LOCATIONS`, `defineSystemView`, `isSystemView`, `cloneAsOverride`, `SYSTEM_VIEW_MARKER`, `SystemView`, `DeepReadonly` and `DeepMutable`.

What leaves, and what to write instead:

- FROM `RegisteredAction` TO the host's own type: register actions through `ActionEngine.registerAction()` and read them back through its public methods, which never expose the registry entry shape.
- FROM `deepFreeze` TO `defineSystemView()` for a System View, or `Object.freeze()` applied recursively in the host for any other object graph.
