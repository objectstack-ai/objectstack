// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `?surface=<type>:<name>` deep link's vocabulary, from the Studio pillars.
 *
 * Every pillar rail (Data / Interfaces / Automations / Access) opened ONE
 * surface at a time, captured the `?surface=` target once at mount, and
 * mirrored the open surface back to the URL. objectstack#36909 — every pillar
 * retired: an item opens its designer on its own metadata address, and the
 * pillar addresses only redirect (`studioPillarRedirectModel.ts`), so the capture
 * and mirror hooks had no reader left and went. What stays:
 *
 *  - the qualifier keys the redirects drop and the address table names
 *    (`?nav=`, `?view=`, `?action=`);
 *  - {@link SurfaceTarget}, the identity the live channel
 *    (`surfaceDeepLinkChannel.ts`) carries;
 *  - {@link useSurfaceActionDeepLink}, the object designer's mount-time
 *    `?action=`.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The nav-entry qualifier of a `?surface=` deep-link (objectui#11774): the
 * spec `id` of the Interfaces nav entry that is open, `?surface=…&nav=<id>`.
 *
 * `?surface=<type>:<name>` names a TARGET, and one app may hold several nav
 * entries that open one object (data slices, named views), so the Interfaces
 * pillar adds the entry beside it. A KEY OF ITS OWN, not a `nav:<id>` value of
 * `?surface=`: every reader of that param parses it as `<type>:<name>` (each
 * pillar's restore, the app→Studio bridge in `utils/appRoute.ts`, the
 * copilot's surface context in `StudioAiCopilot`), and a second value grammar
 * would hand each of them a `nav` "type". With a separate key, `?surface=`
 * keeps meaning what it meant to all of them, and a link without `nav` — every
 * link produced before this key existed — resolves exactly as it did.
 */
export const DESIGNER_SURFACE_NAV_PARAM = 'nav';

/**
 * objectstack#30046 — the list view an Interfaces `object` entry shows, when
 * the author switched it from the view the entry opens:
 * `?surface=object:<object>&nav=<id>&view=<object>.<key>`. A key of its own,
 * for the reason `nav` is one; absent while the entry's own view shows, so a
 * link without it opens the entry as it always did.
 */
export const DESIGNER_SURFACE_VIEW_PARAM = 'view';

/**
 * objectstack#34724 — the action a Data pillar link opens on its object:
 * `?surface=object:<object>&action=<name>` lands on the object's Actions view
 * with that action selected. Studio's landing links a switched-off action
 * that lives in its object's `actions[]` here, since such an action has no
 * item page of its own and its switch is on the object's Actions view. A key
 * of its own, for the reason `nav` is one.
 */
export const DESIGNER_SURFACE_ACTION_PARAM = 'action';

/**
 * The surface identity carried in the URL: `?surface=` plus, on an Interfaces
 * nav entry, its id from `?nav=` and the list view it shows from `?view=`
 * (each absent otherwise).
 */
export interface SurfaceTarget {
  type: string;
  name: string;
  navId?: string;
  viewId?: string;
}

/**
 * objectstack#34724 — the mount-time `?action=` beside a `?surface=object:`
 * deep link: once the deep-linked object is the open one, `open(name)` runs,
 * once (the pillar's own "Show me" path to an action). Read once at mount like
 * the surface itself, so the author's later picks are never overridden.
 */
export function useSurfaceActionDeepLink(
  initial: SurfaceTarget | null,
  current: SurfaceTarget | null | undefined,
  open: (name: string) => void,
): void {
  const [searchParams] = useSearchParams();
  const pendingRef = React.useRef<string | null>(searchParams.get(DESIGNER_SURFACE_ACTION_PARAM) || null);
  const currentName = current?.type === 'object' ? current.name : null;
  // `open` is a new function per render; the pending name, spent on first
  // use, keeps it to one call.
  React.useEffect(() => {
    const name = pendingRef.current;
    if (!name || initial?.type !== 'object' || currentName !== initial.name) return;
    pendingRef.current = null;
    open(name);
  }, [initial, currentName, open]);
}
