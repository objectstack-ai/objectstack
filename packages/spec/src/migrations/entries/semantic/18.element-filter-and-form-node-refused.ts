// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17594 — the D3 half of the node-level refusal #15110 landed. The two D2
// conversions `element-filter-removed` / `element-form-removed` strip all
// twelve authorable keys and DELIBERATELY leave the bare component node:
// deleting an authored page node is a layout decision a mechanical conversion
// must not make. That residue was inert until `element:filter` /
// `element:form` joined `RETIRED_PAGE_COMPONENT_TYPES` and the parse began
// refusing them BY NAME — at which point the deletion stopped being optional
// and became a required step of the 17 → 18 chain.
//
// Without this entry the chain ends `schemaValid: false` and `os migrate meta`
// closes with "resolve the manual changes above" over a manual-change list
// that names neither node: measured on a source carrying both, 0 of the 115
// step-18 todos matched `element:filter`, `element:form`, `ElementFilter` or
// `ElementForm`, while sibling entries naming `element:number` and
// `element:record_picker` matched 3 each. ADR-0087 D3 calls for a structured
// TODO "rather than silence" for exactly this: a step that cannot be expressed
// declaratively, because only the author knows what the region should hold
// once the node is gone.
//
// The prescriptions are not new prose — they are the two node-level refusal
// messages in `RETIRED_PAGE_COMPONENT_TYPES` (ui/page.zod.ts), so the door that
// refuses and the chain that prescribes carry one instruction.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'element-filter-and-form-node-refused',
  surface:
    'page.component.element:filter / page.component.element:form — the bare component '
    + 'node itself, left standing by the `element-filter-removed` and '
    + '`element-form-removed` conversions after they strip its properties',
  replacement:
    'Delete the component node. `element:filter` → a list surface owns its own '
    + "filtering: use a view's `userFilters` quick-filter bar or the list toolbar's "
    + 'filter builder. `element:form` → the object-bound `object-form` block, which is '
    + 'rendered, designer-publishable and carries the same intent (`objectName`, '
    + '`fields`, `mode`, `submitText`). Nothing is placed where the node was unless the '
    + 'page needs it — which region keeps its layout is the judgment this step delegates',
  reason:
    'Both elements were retired whole at element grain (ADR-0049 enforce-or-remove): no '
    + 'renderer for either ever shipped in objectui, framework or cloud, so every '
    + 'authorable key was a capability claim nothing kept. The conversions are mechanical '
    + 'where they can be — they strip all twelve keys losslessly — and stop at the node, '
    + 'because removing an authored page node changes the LAYOUT of a page the author '
    + 'composed, and a conversion cannot know whether the region should close up, hold a '
    + 'replacement, or keep its slot. That residue is no longer inert: both names are '
    + 'members of `RETIRED_PAGE_COMPONENT_TYPES`, so `PageComponentSchema.type` refuses '
    + 'them by name, and a stack that replays the chain and stops there is schema-INVALID. '
    + 'Mechanical where it can be, delegated where it cannot — this entry is the '
    + 'delegation, in writing',
  acceptanceCriteria:
    'No `element:filter` and no `element:form` component remains in any page — regions, '
    + 'named slots and nested containers alike (the conversions walk all three, so every '
    + 'place they stripped properties is a place a bare node can be sitting). `os validate` '
    + 'is clean: the refusal is reported at the node\'s `type` path with '
    + '`params.retiredComponentType` naming the element, so a remaining node is named '
    + 'individually rather than as one page-level failure. Replaying the same 17 → 18 chain '
    + 'over the edited source then reports the migrated stack schema-valid — '
    + '`schemaValid: true` in `--json`, and the run closes with the schema-valid line '
    + 'rather than the manual-changes warning',
};
