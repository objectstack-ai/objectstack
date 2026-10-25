// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DISPLAY text the Interfaces rail takes from the server's `/meta` answer
 * (objectui#12688).
 *
 * The rail draws the app's navigation from the buffer the nav editor edits:
 * the app's pending draft, else its `/layers` code layer. Neither is localized:
 * `/layers` is the authored document, and app-navigation localization is owned
 * by the server-side `/meta` boundary alone (`translateApp` rewrites each
 * node's `label` by its `id`; see the `navGroupLabel` docblock in
 * `@object-ui/i18n`'s `useObjectLabel`: one owner, not two). So on a zh-CN
 * session the rail read "Capability Map" while the runtime sidebar, drawn from
 * `/meta`, read 能力地图.
 *
 * The pillar already holds the server's localized app: its app load lists the
 * package's apps through `/meta/app?package=…`, which the server answers
 * translated for the request's language. This module pairs that answer with
 * the published layer the server translated, so the rail can show the served
 * text for exactly the entries it describes. ⛔ It is not a second translator:
 * no key is built and no bundle is read here.
 *
 * The rule, by entry `id`:
 *  - an entry whose authored `label` in the buffer equals its label in the
 *    published layer shows the served label: the server's answer for that same
 *    authored value;
 *  - an entry the author changed in the draft, or added there, has no served
 *    counterpart for its text yet, and shows its authored label as before;
 *  - an entry the served answer leaves without a label (no translation and no
 *    authored label) keeps inheriting, as before.
 *
 * DISPLAY only. The editors (the nav canvas, the nav-item inspector, a source
 * page's nav-entry list) keep reading the buffer, so an input never echoes a
 * served text and an edit never writes one into the source.
 */

import type { I18nLabel } from '@objectstack/spec/ui';
import type { NavNode } from './navSurface.js';

/** One translatable text: as the published layer authors it, and as the server serves it. */
interface ServedText {
  authored: I18nLabel | undefined;
  served: I18nLabel;
}

/**
 * The served display text of one app: its own label, and each navigation
 * entry's, keyed by the entry's `id`. Built by {@link servedNavTextOf}.
 */
export interface ServedNavText {
  /** The app's own label (the rail heading). Absent when the server serves none. */
  app?: ServedText;
  /** Navigation entries the published layer and the served answer both hold, by `id`. */
  nav: ReadonlyMap<string, ServedText>;
}

/**
 * Pair the server's localized app (`served`, a row of the `/meta/app` list)
 * with the published layer it was translated from (`published`, the
 * `/layers` effective document), entry by entry.
 *
 * `null` when either side is missing (an app never published has no served
 * text), or when the two documents are not the same app.
 */
export function servedNavTextOf(
  published: Record<string, unknown> | null | undefined,
  served: Record<string, unknown> | null | undefined,
): ServedNavText | null {
  if (!published || !served) return null;
  if (typeof published.name !== 'string' || published.name !== served.name) return null;

  const authoredById = new Map<string, I18nLabel | undefined>();
  walk(published.navigation, (node) => {
    if (!authoredById.has(node.id)) authoredById.set(node.id, node.label);
  });
  const nav = new Map<string, ServedText>();
  walk(served.navigation, (node) => {
    if (nav.has(node.id) || !authoredById.has(node.id) || !isLabel(node.label)) return;
    nav.set(node.id, { authored: authoredById.get(node.id), served: node.label });
  });

  // The rail heading reads the app's `label`, else its `name` (the app load's
  // own fallback), so the authored side is compared the same way.
  const appAuthored = (published.label ?? published.name) as I18nLabel | undefined;
  return {
    ...(isLabel(served.label) ? { app: { authored: appAuthored, served: served.label } } : {}),
    nav,
  };
}

/**
 * The tree the rail DRAWS: `tree` (the buffer) with each entry the served
 * answer still describes carrying its served label. Every other key of an
 * entry is kept as it is, so what a row opens, and the entry it is known by,
 * do not change. `tree` itself is never modified.
 */
export function displayNavTree(tree: NavNode[], served: ServedNavText | null): NavNode[] {
  if (!served || served.nav.size === 0) return tree;
  const relabel = (node: NavNode): NavNode => {
    if (!node || typeof node !== 'object') return node;
    const text = typeof node.id === 'string' ? served.nav.get(node.id) : undefined;
    const children = Array.isArray(node.children) ? node.children.map(relabel) : node.children;
    const label = text && sameLabel(node.label, text.authored) ? text.served : node.label;
    if (label === node.label && children === node.children) return node;
    return { ...node, label, ...(children !== undefined ? { children } : {}) };
  };
  return tree.map(relabel);
}

/** The app label the rail heading DRAWS: the served one while the buffer's equals the published layer's. */
export function displayAppLabel(label: I18nLabel, served: ServedNavText | null): I18nLabel {
  const app = served?.app;
  return app && sameLabel(label, app.authored) ? app.served : label;
}

/** Visit every navigation entry carrying a string `id`, at any depth. */
function walk(nodes: unknown, visit: (node: { id: string; label?: I18nLabel }) => void): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const entry = node as { id?: unknown; label?: I18nLabel; children?: unknown };
    if (typeof entry.id === 'string') visit({ id: entry.id, label: entry.label });
    walk(entry.children, visit);
  }
}

/**
 * A spec `I18nLabel`: a plain string or an inline locale map of strings.
 * Shared with `servedDashboardText.ts`, so the rail and the dashboard
 * component list read a served text by one rule.
 */
export function isLabel(value: unknown): value is I18nLabel {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

/**
 * Two `I18nLabel`s are the same authored text: equal strings, or maps with the
 * same entries. The one comparison the rail and the dashboard component list
 * share (`servedDashboardText.ts`).
 */
export function sameLabel(a: I18nLabel | undefined, b: I18nLabel | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] === a[k]);
}
