// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The reach of `defineStack`'s page cross-reference checks, extended into tab
// and accordion panels. Both checks (inline-action targets, inline grid
// columns) read a page through one traversal, which descended only arrays of
// component-shaped entries; a `page:tabs` / `page:accordion` item is a panel
// record, so the traversal stopped at it and every component inside a panel
// went unjudged. It now also descends the panel positions the component rows
// declare, the list the other page walks read. D3 only: the refusal is at
// authoring time, nothing on the metadata load path refuses the shape, and a
// dangling target or a refused column key has no lossless rewrite.
export const entry: SemanticMigration = {
  id: 'ui-page-panel-children-cross-references-judged',
  surface: 'page components under a `page:tabs` or `page:accordion` item\'s `children` '
    + '(`properties.items[].children[]`, at any depth), as `defineStack`\'s page cross-reference '
    + 'checks judge them: an inline action\'s `type: \'modal\'` or `type: \'flow\'` `target` '
    + '(`properties.action`), and an inline grid column that declares no `type` in an '
    + '`object-master-detail-form` block\'s `details[].columns[]` or a `record:line_items` block\'s '
    + '`columns[]`',
  replacement: 'what the same component is held to at region level: an inline `type: \'modal\'` '
    + 'action\'s `target` names a page the stack declares and a `type: \'flow\'` action\'s `target` a '
    + 'flow it declares; an identity-only column over a `currency` field of the child object carries '
    + 'no `scale` — delete the key, nothing replaces it, the currency\'s ISO 4217 minor unit decides. '
    + 'The panel, its items and their keys do not change.',
  reason: '`defineStack` judges a page\'s components through one traversal, shared by its '
    + 'inline-action target check and its inline grid column check. The traversal descended an '
    + 'array under `properties` only when its entries were component-shaped (an object carrying a '
    + 'string `type`), and a tab or accordion item is a panel record (`{ label, value?, children }`), '
    + 'not a component, so it stopped at the item and nothing inside a tab or an accordion panel was '
    + 'judged. A button whose modal target named no page built green inside a tab while the same '
    + 'button at region level was refused, and an identity-only `scale` column over a `currency` '
    + 'child field split the same way on both page blocks that draw an inline grid. The traversal '
    + 'now also descends the panel positions the component rows declare (`pageComponentSlotPositions` '
    + 'in `ui/component.zod.ts`; today `items[].children`, declared by `page:tabs` and '
    + '`page:accordion`), the list the exported page walk, the ADR-0087 conversion walker and the '
    + 'component-props gate already read, matched by shape on every component as they match it. A '
    + 'component in a panel is refused with the region-level message and status 422, located through '
    + 'the panel (`regions.0.components.0.properties.items.1.children.0`). A record under a key no '
    + 'row declares a panel list is not descended. No conversion is registered: the refusal is at '
    + 'authoring time (`defineStack`, and so `objectstack validate` and `objectstack build`), nothing '
    + 'on the metadata load path refuses the shape, and a dangling target has no right value to '
    + 'guess. Population measured at the change, on origin/main 31e7d0ba2: four authored pages nest '
    + 'components under a panel item (the showcase project detail page, whose `record:line_items` '
    + 'block declares a `type` on all five columns; the platform user and organization record pages; '
    + 'the approval request record page), one documentation example does (three tabs of record '
    + 'blocks), and the published skills carry none. None of them holds an inline action target or '
    + 'an identity-only column under a panel, so none changes verdict. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: '`objectstack validate` and `defineStack` report no cross-reference finding on '
    + 'a path through `properties.items.N.children`. Every inline `type: \'modal\'` action inside a tab '
    + 'or accordion panel names a page the stack declares, every `type: \'flow\'` action a declared '
    + 'flow, and no identity-only column there over a `currency` child field carries `scale` — the '
    + 'verdicts the same components get at region level.',
};
