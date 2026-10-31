/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isServedView, type useServedViewItems } from '../hooks/useServedViewItems.js';
import { metadataText } from '../hooks/useNavTargetLabel.js';

/** `useObjectLabel().viewLabel` — the client bundle's view-label lookup. */
export type ViewLabelLookup = (objectName: string, viewName: string, fallback: string) => string;

/**
 * A view's name wherever the console names it — the object page's view
 * switcher draws the same string on every width (objectui#11295, objectstack#27058), the record
 * page's way back (`location.state.from`) names the open view the same way, so
 * the link and the tab agree (objectui#11733), and the app header's title on a
 * `/view/NAME` route reads it too, so the header and the tab agree
 * (objectui#12805).
 *
 * A view a server read served — a `/meta/view` document, or an entry the served
 * object document embeds in its own `listViews` (objectui#11336) — arrives
 * translated by the server, a published edit kept over the packaged catalog, so
 * its text is drawn as given. Offering it to `viewLabel` as the fallback was a
 * second translation pass in which the bundle won the edit back. Any other view
 * — derived client-side — still goes through `viewLabel`, its only
 * translation. `useServedViewItems` says which is which, and why.
 *
 * A view with no `label` is named `unlabelled`, which every caller passes as
 * the object's PLURAL label: the spec gives a view's `label` no default and the
 * server no longer invents one from the `name` (objectstack PR #24013), so the
 * view is called what a list of the object's records is called — never its
 * qualified name, which is what a label-less view's tab drew before
 * (objectui#12774), nor a string humanized from it, which is what the header
 * drew before (objectui#12805).
 *
 * The `label` is an `I18nLabel` — a string or an inline locale map — and is
 * resolved in the viewer's `language` before either branch reads it (#25901).
 * The server overlays only catalog text, so a map with no catalog entry is
 * served as authored; handed on raw, it reached every caller as an object, and
 * the app header — mounted outside the route's error boundary — threw on it and
 * took the whole console down. A map that resolves to no text counts as no
 * `label`, so `unlabelled` is drawn only when nothing resolves.
 */
export function viewTabLabel(
  view: { id?: string; name?: string; label?: unknown },
  objectName: string,
  servedViews: ReturnType<typeof useServedViewItems>,
  viewLabel: ViewLabelLookup,
  unlabelled: string,
  language: string | undefined,
): string {
  const text = metadataText(view.label, language) ?? unlabelled;
  return isServedView(servedViews, objectName, view.id) ? text : viewLabel(objectName, view.name || view.id || '', text);
}
