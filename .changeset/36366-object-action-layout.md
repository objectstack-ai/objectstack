---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/lint': minor
'@objectstack/metadata-core': patch
'@objectstack/platform-objects': patch
'@object-ui/types': minor
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat: an object chooses its page headers' buttons (`actionLayout`), and the design mode sets them

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ui/rules/actions.md (its token ceiling has no room: 3,711, and the paragraph costs ~170)

A page header draws at most three of its actions as buttons and puts the rest in its 「More」 menu. An object now chooses which, per page type, with the new optional key `actionLayout` on `ObjectSchema` and `ObjectExtensionSchema`: `{ list?: string[]; record?: string[] }`, each at most three names, in the order drawn. `list` names actions placed at `list_toolbar` and the list page's built-ins `$import` and `$export`; `record` names actions placed at `record_header` or `record_more`. Every other action the page places goes to 「More」. An arm left out (or the key left out) keeps the header's own choice, as before.

- `@objectstack/spec`: the key and its shape refusals at every door (more than three, a name twice, a malformed name, a built-in the page does not have), each with its reason. New exports `OBJECT_PINNED_ACTION_LIMIT`, `OBJECT_PINNED_ACTION_PAGES`, `OBJECT_PINNED_BUILTIN_ACTIONS` and the types `ObjectPinnedActionPage`, `ObjectPinnedActions`. The object form offers it under Advanced.
- `@objectstack/objectql`: an `object_extension`'s `actionLayout` folds onto the object arm by arm (the last extender by priority wins), and yields to a tenant's own pins as `label` does (ADR-0029 D9.2a). New export `foldScalarOverridesPackagedBase`.
- `@objectstack/lint`: `validateObjectActionLayout` (`object-action-layout-unknown`, `object-action-layout-not-placed`, at `error`) refuses in `os validate`, `os build` and `os lint` a pinned name that is no action of the object, or one not placed on that page.
- `@object-ui/types`: `arrangedHeaderActions(actions, pins, page)`, the one reader both record headers and the list header apply.
- The console: both record headers (the default page's and an authored `page:header` with `placedActions: true`) and the list header draw the pins. In the design mode, 「Header buttons」 at the end of the page header lists the page's actions under 「Pinned to header」 (dragged into order) and 「Other」; a dot moves an action between them, a fourth pin is refused with a toast, the header shows the change at once, and 「Save」 writes it: into the object's own package when it is writable, else into the installed object's customization package as an `object_extension`. A name the header cannot draw is refused at save with its reason. New `@object-ui/i18n` keys under `designMode.pins`.
