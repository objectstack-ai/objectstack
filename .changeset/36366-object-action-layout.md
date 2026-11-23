---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/lint': minor
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/platform-objects': patch
'@object-ui/types': minor
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat: an object arranges its actions per scope (`actionLayout`: pinned buttons and the 「More」 order), and the design mode sets it

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #36630

A page header draws at most three of its actions as buttons and puts the rest in its 「More」 menu. An object now arranges them itself with the new optional key `actionLayout` on `ObjectSchema` and `ObjectExtensionSchema`: `{ list?: Arm, record?: Arm }`, where `Arm = { pinned: string[], more?: string[] }`. `pinned` names the buttons in the order drawn, at most three (`[]` pins none); `more` orders the 「More」 menu; an action the scope places that neither part names goes to the end of 「More」 in its default order. A pinned action that is hidden leaves its button out, and no other action takes its place.

- `list` arranges the actions placed at `list_toolbar` and the list page's built-ins `$import` and `$export`. A built-in is only ever pinned: one named in `more` is refused with its reason, since not pinned the list page draws it in its own Import / Export menu.
- `record` arranges the actions placed at `record_header` or `record_more`. It is a scope, not a page: the record page header, the side preview and a phone's bottom action bar all read it. A `page:header` that authors its own `actions` list keeps that list.
- An arm left out (or the key left out) draws that scope exactly as before.

What each package gains:

- `@objectstack/spec`: the key and its shape refusals at every door (more than three pinned, a name given twice in one part or in both, a malformed name, a built-in the scope does not have, a built-in in `more`, since a built-in is only ever pinned), each with its reason. New exports `OBJECT_ACTION_LAYOUT_PINNED_LIMIT`, `OBJECT_ACTION_LAYOUT_SCOPES`, `OBJECT_ACTION_LAYOUT_BUILTINS` and the types `ObjectActionLayoutScope`, `ObjectActionLayout`, `ObjectActionLayoutArm`. The object form offers it under Advanced, one JSON row per arm.
- `@objectstack/objectql`: `actionLayout` joins `fieldGroups` and `relatedLists` as a key only the base's paired `.custom` package writes on an `object_extension` (ADR-0146 D10). It is applied last, after every other layer, arm by arm: each arm it writes replaces the served arm for that scope whole, and an arm it leaves out stays. A manifest's `objectExtensions` entry now carries the key to the fold.
- `@objectstack/metadata-protocol`: the one judge refuses `actionLayout` from any other package, naming the action's own `locations` and `order` as the way to place an action the package brings. Each door says it its own way: publish, restore and draft promotion of an `object_extension` answer `VALIDATION_ERROR` / 400; marketplace install refuses the package body with `VALIDATION_ERROR` / 422; `os validate` and `os build` exit non-zero and print the row; the registry fold skips the key and leaves a note.
- `@objectstack/lint`: `validateObjectActionLayout` (`object-action-layout-unknown`, `object-action-layout-not-placed`, at `error`) refuses in `os validate`, `os build` and `os lint` a name, in either part, that is no action of the object or is not placed in the scope its arm arranges.
- `@object-ui/types`: `arrangedHeaderActions(actions, arm, scope)`, the one reader both record headers and the list header apply, and `readActionLayoutArm`.
- The console: both record headers (the default page's and an authored `page:header` with `placedActions: true`) and the list header draw the arrangement. In the design mode, 「Header buttons」 at the end of the page header lists the scope's actions under 「Pinned to header」 and 「Other」 (the 「More」 menu), each dragged into order; a dot moves an action between them, a fourth pin is refused with a toast, the header shows the change at once, and 「Save」 writes only the arms that changed: into the object's own package when it is writable, else into the installed object's customization package as an `object_extension`, through the one writer of an installed object's arrangement (`saveObjectExtensionArrangement`, whose patch type now takes the object-shaped `actionLayout`), which refuses a customization package the server does not list writable. A name the scope no longer offers is listed in the panel as left out. A name the header cannot draw is refused at save with its reason. New `@object-ui/i18n` keys under `designMode.pins`.
