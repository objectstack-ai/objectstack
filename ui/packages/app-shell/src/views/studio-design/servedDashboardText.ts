// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DISPLAY text the dashboard component list takes from the server's
 * `/meta` answer (objectui#12688). It is the rail's rule (`servedNavText.ts`),
 * applied to widgets, and it shares the rail's comparison.
 *
 * The Studio edits a dashboard through a buffer: its pending draft, else its
 * `/layers` code layer. The server localizes neither. It localizes the
 * dashboard where it serves it, at `/meta` (`translateDashboard`, matched by
 * widget `id`). The console's metadata store already holds that list for this
 * session's language. So on a zh-CN session the component list read
 * "Task Count vs Avg Progress" while the same dashboard, as served, read
 * 任务数与平均进度.
 *
 * The rule, by widget `id`:
 *  - a widget whose authored `title` in the buffer equals its title in the
 *    published layer draws the served title, which is the server's answer for
 *    that same authored value;
 *  - a widget changed or added in the draft has no served counterpart for its
 *    text yet, and draws its authored title as before.
 *
 * ⛔ Not a second translator: no bundle key is built and no client bundle is
 * read here. DISPLAY only: every editor (the widget inspector's Title field,
 * the canvas's rename strip) keeps reading the buffer, so an input never
 * echoes a served text and an edit never writes one into the source.
 *
 * The text reaches the component list through {@link ServedWidgetTextContext},
 * which the Interfaces pillar provides around the dashboard's default
 * inspector. Outside that provider the list reads as it always has. Internal
 * to app-shell: not exported from the package root.
 */

import * as React from 'react';
import type { I18nLabel } from '@objectstack/spec/ui';
import { isLabel, sameLabel } from './servedNavText.js';

/** One widget title: as the published layer authors it, and as the server serves it. */
interface ServedTitle {
  authored: I18nLabel | undefined;
  served: I18nLabel;
}

/** The served display titles of one dashboard's widgets, by widget `id`. Built by {@link servedWidgetTextOf}. */
export interface ServedWidgetText {
  widgets: ReadonlyMap<string, ServedTitle>;
}

/**
 * Pair the server's localized dashboard (`served`, a row of the `/meta`
 * dashboard list) with the published layer it was translated from
 * (`published`, the `/layers` effective document), widget by widget.
 *
 * `null` when either side is missing (a dashboard never published has no
 * served text) or when the two documents are not the same dashboard.
 */
export function servedWidgetTextOf(
  published: Record<string, unknown> | null | undefined,
  served: Record<string, unknown> | null | undefined,
): ServedWidgetText | null {
  if (!published || !served) return null;
  if (typeof published.name !== 'string' || published.name !== served.name) return null;

  const authoredById = new Map<string, I18nLabel | undefined>();
  for (const w of widgetsOf(published)) {
    if (!authoredById.has(w.id)) authoredById.set(w.id, w.title);
  }
  const widgets = new Map<string, ServedTitle>();
  for (const w of widgetsOf(served)) {
    if (widgets.has(w.id) || !authoredById.has(w.id) || !isLabel(w.title)) continue;
    widgets.set(w.id, { authored: authoredById.get(w.id), served: w.title });
  }
  return { widgets };
}

/**
 * The title a widget DRAWS in the component list: its served title while its
 * authored title in the buffer equals the published one, else its authored
 * title. The widget itself is never modified.
 */
export function displayWidgetTitle(
  widget: { id?: unknown; title?: I18nLabel } | null | undefined,
  served: ServedWidgetText | null,
): I18nLabel | undefined {
  if (!widget) return undefined;
  const text = served && typeof widget.id === 'string' ? served.widgets.get(widget.id) : undefined;
  return text && sameLabel(widget.title, text.authored) ? text.served : widget.title;
}

/**
 * The one channel the served widget titles reach the dashboard's default
 * inspector through. `null` (the default) is "no served text": the list draws
 * every authored title, as it does outside the Studio.
 */
export const ServedWidgetTextContext = React.createContext<ServedWidgetText | null>(null);

/** The served widget titles the nearest Interfaces pillar provides, or `null`. */
export function useServedWidgetText(): ServedWidgetText | null {
  return React.useContext(ServedWidgetTextContext);
}

/** Every widget of a dashboard document carrying a string `id`. */
function widgetsOf(doc: Record<string, unknown>): Array<{ id: string; title?: I18nLabel }> {
  if (!Array.isArray(doc.widgets)) return [];
  const out: Array<{ id: string; title?: I18nLabel }> = [];
  for (const w of doc.widgets) {
    if (!w || typeof w !== 'object') continue;
    const widget = w as { id?: unknown; title?: I18nLabel };
    if (typeof widget.id === 'string') out.push({ id: widget.id, title: widget.title });
  }
  return out;
}
