/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * pageTabsUrlSync — make a record page's `page:tabs` node URL-aware
 * (objectui#2257, ADR-0054 C3 "URL-addressable state").
 *
 * The active detail tab is user state that must SURVIVE the page subtree
 * remounting — which happens for real on every `refreshKey`-style save
 * refresh (and, in dev StrictMode, on any URL search change). An
 * uncontrolled Radix `defaultValue` loses it; the URL keeps it.
 *
 * This helper walks a page schema tree and returns a NEW tree in which every
 * `page:tabs` node carries the host-provided `defaultTab` (the value read
 * from `?tab=`) and `onTabChange` (writes `?tab=` back, with `replace`). It
 * never mutates the input — authored/assigned page schemas may be shared or
 * memoized objects.
 *
 * Only container keys are traversed (`regions` / `components` / `children`);
 * `page:tabs`' own `items` are its content, not a container to recurse into.
 */

export interface PageTabsUrlSyncInject {
  /** Initial active tab (from `?tab=`); ignored by the renderer if it names no tab. */
  defaultTab?: string;
  /** Called by the renderer on every tab switch (host writes `?tab=`). */
  onTabChange?: (value: string) => void;
}

const CONTAINER_KEYS = ['regions', 'components', 'children'] as const;

export function withPageTabsUrlSync<T>(node: T, inject: PageTabsUrlSyncInject): T {
  if (Array.isArray(node)) {
    let outArr: unknown[] | null = null;
    (node as unknown[]).forEach((n, i) => {
      const next = withPageTabsUrlSync(n, inject);
      if (next !== n) {
        outArr = outArr ?? (node as unknown[]).slice();
        outArr[i] = next;
      }
    });
    return (outArr ?? node) as unknown as T;
  }
  if (!node || typeof node !== 'object') return node;

  const rec = node as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;

  if (rec.type === 'page:tabs') {
    out = { ...rec };
    if (inject.defaultTab !== undefined) out.defaultTab = inject.defaultTab;
    if (inject.onTabChange) out.onTabChange = inject.onTabChange;
  }

  for (const key of CONTAINER_KEYS) {
    const child = (out ?? rec)[key];
    if (child === undefined || child === null) continue;
    const next = withPageTabsUrlSync(child, inject);
    if (next !== child) {
      out = out ?? { ...rec };
      out[key] = next;
    }
  }

  return (out ?? node) as T;
}
