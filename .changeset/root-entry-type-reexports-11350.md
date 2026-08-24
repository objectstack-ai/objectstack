---
"@objectstack/spec": minor
---

Re-export `FormFieldInput`, `NavigationItemInput` and `StateNodeConfig` from the package root entry (#11350). These types appear structurally in the root entry's own public declarations — `defineStack` returns `ObjectStackDefinition`, declared `z.input<typeof ObjectStackDefinitionSchema>`, which the declaration emitter expands structurally rather than preserving as an alias — but they were previously nameable only via the `/ui` and `/automation` subpaths. Any consumer letting TypeScript infer a type through a root-entry function (an un-annotated `export default defineStack(...)`) therefore hit TS2883 naming a hash-named internal dist chunk. With the re-exports, that consumer shape declaration-emits cleanly, with no annotation required. Invariant recorded: a type that appears structurally in an entry's public declarations must be nameable from that same entry.
