---
'@object-ui/types': patch
'@object-ui/core': patch
'@object-ui/components': patch
'@object-ui/plugin-form': patch
---

fix(types,core,components,plugin-form)!: `FormField` drops its open index signature, and a form-view field's `immutable` locks the control once the record exists

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/types/src/form.ts#FormField, ui/packages/core/src/validation/server-owned-value.ts#FieldWithDeclaredDefault) Two published TypeScript interfaces each lose their open index signature and nothing else: no member is removed or renamed, no metadata key, accepted value, export or error code moves, the zod mirror `FormFieldSchema` and the strict authoring face are unchanged, and `objectstack migrate meta` has nothing to rewrite. The affected party is a TypeScript consumer, reached by its own compiler (excess-property error naming the undeclared key). -->

**BREAKING** type-surface narrowing, compile-time only.

- **`@object-ui/types`.** `FormField` no longer ends in `[key: string]: any`. A key no member declares — a misspelling included — is now a compile error on a fresh `FormField` literal, as it already was on every node type since `BaseSchema` closed. The declared members are unchanged, and so are the zod mirror `FormFieldSchema` and the strict face `StrictAnyComponentSchema`, which already refused undeclared keys.
- **`@object-ui/core`.** `FieldWithDeclaredDefault`, the parameter type of `isServerOwnedValue`, drops its `[key: string]: unknown` signature, so a `FormField` value is assignable to it. It still reads only `field.defaultValue`.
- **`@object-ui/components`.** The form renderer types the field's raw metadata carrier as `Record<string, unknown> | FormField` (the stashed object field, else the field config itself), instead of reading the config through the signature.
- **`@object-ui/plugin-form`.** The host-written `group` key (copied from the object field for the field-group fallback) and the section-divider disclosure keys (`collapsible`, `collapsed`, `onToggle`) are typed on package-local hand-off types instead of riding the signature.

**Fix (`@object-ui/plugin-form`).** A form-view field declaring `immutable: true` (spec `FormField.immutable`, "editable on create, locked once the record exists") is now drawn disabled when the form edits an existing record, and stays editable on a create form. It used to be copied onto the runtime field as `immutable`, which no renderer reads, so an edit form left the control editable.

What to do: nothing if your `FormField` literals use only declared keys. Otherwise the compiler names each undeclared key on the literal that carries it (an excess-property error): correct a misspelling to the declared member, or, for a key only your host writes and reads, type it on a local intersection such as `FormField & { group?: string }` where its producer and reader live.
