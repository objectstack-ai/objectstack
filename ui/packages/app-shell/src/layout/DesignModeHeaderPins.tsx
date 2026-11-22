// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「Header buttons」, the design mode's control at the right end of a page
 * header's button group (objectstack#36366), and the pins a page header
 * draws.
 *
 * The control is drawn only while the mode is on, and its panel
 * (`DesignModeHeaderPinsPanel.tsx`: the drag-and-drop list and the save
 * behind it) is loaded then, so a page header outside the mode loads none of
 * it. While a change is staged the page's header draws it
 * ({@link useObjectPins}), so the administrator sees the header they are
 * making.
 *
 * @module
 */

import * as React from 'react';
import { useDesignModeActive, useDesignModeChange } from './designMode.js';
import { pinsChangeKey, servedPins, type ObjectPins, type PinCandidate, type PinPage } from './designModeHeaderPins.js';

const HeaderPinsPanel = React.lazy(() => import('./DesignModeHeaderPinsPanel.js'));

type ServedObject = { readonly name?: unknown; readonly _packageId?: unknown; readonly pinnedActions?: unknown };

/**
 * The object's pins as the page's header draws them: the change staged under
 * the design mode, else the object's `pinnedActions` as served. `undefined`
 * for an arm neither sets (the header's own choice).
 */
export function useObjectPins(objectDef: ServedObject | null | undefined): ObjectPins {
  const name = typeof objectDef?.name === 'string' ? objectDef.name : '';
  const staged = useDesignModeChange<ObjectPins>(pinsChangeKey(name)).value;
  return React.useMemo(() => staged ?? servedPins(objectDef), [staged, objectDef]);
}

export interface DesignModeHeaderPinsProps {
  /** The object as served: its name, package, actions and `pinnedActions`. */
  readonly objectDef: ServedObject & { readonly actions?: unknown };
  /** The page type the header is: the object's list page or its record page. */
  readonly page: PinPage;
  /** The page's actions as its header has them (labels localized), in any order. */
  readonly actions: readonly Record<string, unknown>[];
  /** The page's built-in buttons this reader is offered (`$import`, `$export`). */
  readonly builtins?: readonly PinCandidate[];
}

export function DesignModeHeaderPins(props: DesignModeHeaderPinsProps) {
  const active = useDesignModeActive();
  if (!active) return null;
  return (
    <React.Suspense fallback={null}>
      <HeaderPinsPanel {...props} />
    </React.Suspense>
  );
}
