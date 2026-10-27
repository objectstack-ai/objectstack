---
'@object-ui/types': minor
---

refactor(types)!: `object-form` and `object-calendar` declare the four spec keys their renderers read, and `@object-ui/types/zod` renames its legacy `ActionSchema` to `CRUDActionSchema` (#25923)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No `@objectstack/spec` key, object definition, stored row or stored shape moves. The four keys are members the spec's `ComponentPropsMap['object-form']` and `['object-calendar']` rows already declare, now declared by reference on the `@object-ui/types` mirror of those rows, so `objectui validate` refuses exactly the values the spec refuses and `objectstack migrate meta` has nothing to rewrite. The renamed zod const validates a legacy `type: 'action'` node that is not metadata and has no stored representation; the affected party is a JavaScript or TypeScript consumer importing it by name, reached by its own compiler or bundler. `runtime-export-retired` would be the natural category, but it reads only a package's main entry and refuses an operand declared in a `*.zod.ts`, and this export lives on the `./zod` subpath in `crud.zod.ts`. The package publishes (not unpublished); no ADR-0087 id covers this change (not registered or already-registered); and the symbols are zod-backed (not runtime-interface-only or type-surface-only). -->

`@object-ui/types` mirrors `@objectstack/spec` schemas so that `objectui validate` and `os validate` give one verdict. Over every schema a mirror pairs with (same-name exports, and the `ComponentPropsMap` row of each node type), eleven spec keys were neither declared nor refused on objectui's side. Four of them are read by a renderer, and those are now declared:

- **`ObjectFormSchema`** (TypeScript and zod) declares `contentLayout` and `confirmOnDiscard`, the `ComponentPropsMap['object-form']` members by reference. `ModalForm` reads `contentLayout`; `ModalForm` and `DrawerForm` read `confirmOnDiscard`.
- **`ObjectCalendarSchema`** (TypeScript and zod) declares `locale` and `loading`, the `ComponentPropsMap['object-calendar']` members by reference. `plugin-calendar` reads both off the node. They are node keys, not the calendar field-name keys that live in the `calendar` block.

The other seven are the spec form-view entry's keys on `FormFieldSchema`, which is objectui's runtime form field, a different layer under the same name. `normalizeSectionField` in `@object-ui/plugin-form` translates between the two layers, and each key's handling is now recorded beside the mirrors.

The legacy `type: 'action'` node's zod schema was exported as `ActionSchema`, the name of `@objectstack/spec/ui`'s action metadata schema, with which it shares no vocabulary. It is now `CRUDActionSchema`, beside `CRUDDialogSchema` and `CRUDComponentSchema`; what it accepts is unchanged. Its TypeScript twin keeps the deprecated `ActionSchema` name in `@object-ui/types`.

**BREAKING** for code that imports the zod const by its old name, and for nodes that carry a value the spec refuses on the four keys.

- **Before.** `import { ActionSchema } from '@object-ui/types/zod'` resolved to the legacy action node's schema. `ObjectFormSchema.safeParse({ type: 'object-form', objectName: 'account', mode: 'create', contentLayout: 'tabs' })` succeeded and kept the value, which stacked the sections.
- **Now.** The old import name is gone. The zod mirrors refuse `contentLayout: 'tabs'`, a non-boolean `confirmOnDiscard` or `loading`, and a non-string `locale`, at the key's own path, as the spec does.
- **Fix.** FROM `import { ActionSchema } from '@object-ui/types/zod'` TO `import { CRUDActionSchema } from '@object-ui/types/zod'`. Write `contentLayout` as `'simple'` or `'tabbed'`.
