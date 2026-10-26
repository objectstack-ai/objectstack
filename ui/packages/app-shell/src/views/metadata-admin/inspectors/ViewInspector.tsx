// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ViewInspector — routes the View right-panel to the right sub-inspector.
 *
 *   • Scoped (a selection exists):
 *       - `{ kind:'column', id:'<variant>.columns[<i>]' }` → ViewColumnInspector
 *       - `{ kind:'view',   id:'<variant>' }`              → ViewVariantInspector
 *   • Default (no selection) → ViewVariantInspector for the primary variant
 *     ("home" panel: pick view type + manage fields, Airtable-style).
 *
 * Routing is by `selection.kind` FIRST — the column inspector's id regex
 * would not match a bare variant id, so we must dispatch before it runs.
 */

import * as React from 'react';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { ViewColumnInspector } from './ViewColumnInspector.js';
import { ViewVariantInspector } from './ViewVariantInspector.js';
import { bindingForStoreKey, primaryVariantBinding } from '../view-variant-model.js';

/** Scoped inspector: a selection is always present here. */
export function ViewInspector(props: MetadataInspectorProps) {
  const { selection } = props;
  if (selection.kind === 'column') {
    return <ViewColumnInspector {...props} />;
  }
  // kind === 'view' (or any non-column kind) → variant home, scoped.
  // `selection.id` carries the variant's STORE key (the tab strip emits it).
  const binding =
    bindingForStoreKey(props.draft, selection.id || undefined) ??
    primaryVariantBinding(props.draft);
  return (
    <ViewVariantInspector
      type={props.type}
      name={props.name}
      draft={props.draft}
      onPatch={props.onPatch}
      onSelectionChange={props.onSelectionChange}
      onClearSelection={props.onClearSelection}
      // The host's blocking-issues channel must survive this router, or the
      // variant inspector's CEL verdicts stop one component short of Save
      // and the wiring is inert (objectui#4527). The default (home) path
      // below has no such prop to forward — see ViewVariantInspectorProps.
      onBlockingIssuesChange={props.onBlockingIssuesChange}
      readOnly={props.readOnly}
      locale={props.locale}
      variantKey={binding?.storeKey ?? 'list'}
      familyKey={binding?.familyKey ?? binding?.storeKey ?? 'list'}
      isHome={false}
    />
  );
}

/** Default inspector: no selection — the View's "home" panel. */
export function ViewDefaultInspector(props: MetadataDefaultInspectorProps) {
  const binding = primaryVariantBinding(props.draft);
  return (
    <ViewVariantInspector
      {...props}
      variantKey={binding?.storeKey ?? 'list'}
      familyKey={binding?.familyKey ?? binding?.storeKey ?? 'list'}
      isHome
    />
  );
}
