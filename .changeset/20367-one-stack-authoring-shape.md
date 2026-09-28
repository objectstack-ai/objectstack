---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

**BREAKING — one authoring shape for a stack config.** `objectstack validate` and `objectstack build` now refuse a config whose default export was not built by `defineStack(...)` (either mode) or `composeStacks(...)`, with `STACK_PROVENANCE_MISSING` and exit 1, right after the config loads and before any other check. `composeStacks` refuses an input no producer built the same way.

Why: the stack family's cross-field refusals (`STACK_CAPABILITY_UNKNOWN`, `STACK_CROSS_REFERENCE_INVALID`, `STACK_NAMESPACE_PREFIX_INVALID`, `STACK_SINGLE_APP_VIOLATION`, `STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED`, `STACK_TRIGGER_CAPABILITY_REQUIRED`) run inside `defineStack` only. The same defective stack exported as a plain object passed both commands at exit 0, and `objectstack build` shipped it. Re-running those refusals on whatever the config exports cannot fix that: a built stack carries each bound action twice, so the re-run refuses every correct project that has one. So the commands check who BUILT the export instead.

- `@objectstack/spec`: `defineStack` and `composeStacks` stamp a non-enumerable `Symbol.for` provenance mark on what they return. The mark is invisible to the schema, to `Object.keys` and to `JSON.stringify`, so no compiled artifact changes. New export: `hasStackProvenance(value)` — `true` only for a value one of the two producers returned. New registered error code: `STACK_PROVENANCE_MISSING` (422), raised by `composeStacks` for an unbuilt input.
- `@objectstack/cli`: `loadConfig` reads the mark off the default export before merging named exports into it (the merge is a spread, which drops the mark), and exposes it as `LoadedConfig.stackProvenance`. `objectstack validate` / `objectstack build` refuse on `false` through their existing error path: under `--json`, `error` + `code: 'STACK_PROVENANCE_MISSING'`. The envelope has no new fields. `objectstack dev` compiles through `objectstack build`, so it refuses the same way when it compiles. `objectstack serve`, `objectstack migrate`, `objectstack lint` and `objectstack generate` load configs exactly as before.

**Migration** — FROM a plain-object (or copied) default export TO the value `defineStack` returns:

```ts
// FROM
export default {
  manifest: { id: 'com.example.app', namespace: 'app', version: '1.0.0', type: 'app', name: 'App' },
  objects: [/* … */],
};
// or: export default { ...defineStack({ … }), api: { … } };

// TO
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.app', namespace: 'app', version: '1.0.0', type: 'app', name: 'App' },
  objects: [/* … */],
  // every stack key inside the call — `api`, `plugins`, `requires`, …
});
```

One-line fix: wrap the export in `defineStack(...)`, and move any key spread onto a copy into the call. For compositions, wrap each input: `composeStacks([defineStack({ … }), …])`. Once wrapped, a config that used to pass can now fail with one of the family's own codes. Those findings were always there; the plain export hid them. Fix each one as its message says. Host-style configs whose `plugins` hold plugin instances are covered by the same rule, and the same wrap fixes them (`defineStack` accepts plugin instances). A project already exporting `defineStack(...)` or `composeStacks([...])` of `defineStack` inputs is unaffected.

Clause-②: yes (narrowing)

<!-- adr-0087: registered stack-config-default-export-unbuilt-refused -->
