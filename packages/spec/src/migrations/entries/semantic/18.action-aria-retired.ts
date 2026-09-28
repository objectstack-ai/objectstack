// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20323 — ADR-0049 enforce-or-remove (triage record 5860351140) — the D3 entry
// of the `action-aria-removed` family (ruling B on #17152: one D3 entry per
// retirement family, even when D2 is lossless). Its OWN family, not a member of
// `chart-config-aria-retired`: a different schema, a different measurement and
// a different replacement channel (the action's `label`, not a chart
// `description`). Registered key: `ui/Action:aria`, over two authored sites.
// The strip changes nothing a screen reader hears; the name the author wrote
// was never announced, and moving it is the author's edit.
export const entry: SemanticMigration = {
  id: 'action-aria-retired',
  surface: 'action.aria / object.actions[].aria — the ARIA block on an action',
  replacement: "The action's required `label`, which every action renderer uses as the accessible "
    + 'name (the visible button or menu-item text, and the `aria-label` of an icon-only action). '
    + 'To name the region that places the actions, the `aria` block of the placing node — '
    + '`page.components[].aria` or the list view `aria`.',
  reason: 'The D2 conversion `action-aria-removed` deletes `aria` from every stack action and every '
    + 'object-nested action, and the delete is lossless: no surface that renders an action ever '
    + 'read the block, so the ARIA attributes it declared never reached the DOM. The residue is '
    + 'accessibility work the author did that no user benefited from. An author who wrote '
    + '`aria.ariaLabel` believed screen-reader users heard that name; they heard the `label`. The '
    + 'strip deletes the text along with the key, and only the author can say whether it should '
    + 'become the `label` — which sighted users read too — or whether it described the toolbar '
    + 'or list the action sits in, and belongs in that node\'s `aria` block instead.',
  acceptanceCriteria: 'No action, top-level or nested under an object, carries `aria`; the parse '
    + 'refuses it. Every action that had carried an `aria.ariaLabel` has a `label` conveying what '
    + 'that name was meant to announce, or the author has moved the text to the placing '
    + "component's or list view's `aria` block, or confirmed the existing label already says it. "
    + 'With a screen reader, focusing an icon-only action announces its label.',
};
