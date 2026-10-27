/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * HostMapStyleContext — the deployment's default map style, offered to the map
 * renderer by its host (objectstack#26163, the renderer half of #26001).
 *
 * A map view that declares no style of its own used to draw the public MapLibre
 * demo style, a host an intranet or proxied deployment cannot reach. The
 * operator names the deployment's own style in `OS_CONSOLE_MAP_STYLE_URL`, and
 * the runtime serves it as `mapStyleUrl` on `GET /api/v1/runtime/config`. Only
 * the host reads that payload, so the host hands the value down through this
 * context. The map renderer reads it AFTER the view's own style and BEFORE the
 * public demo default.
 *
 * ## Why a context, and why here
 *
 * The map renderer reaches the page through `ComponentRegistry`, so no host
 * prop reaches it; a context does, the same way `HostNavigationContext`
 * reaches every registered renderer. The context lives in this package rather
 * than in `@object-ui/plugin-map` because the Console loads that plugin lazily
 * (`registerLazy`, to keep maplibre-gl out of the first bundle). A provider the
 * Console imported from the plugin would load the plugin, and maplibre-gl
 * with it, on every page. Both the plugin and the Console already depend on
 * this package, so neither gains a dependency.
 *
 * ## Absent is a supported state
 *
 * Outside a provider, or under one given no style, `useHostMapStyle()` answers
 * `undefined` and the map draws what it drew before. Hosts that do not serve
 * the runtime payload (an embedded renderer, a test) change nothing.
 *
 * ⛔ Not a metadata key. A view's own style stays `mapStyle` / `map.style`, and
 * nothing here is authorable: the value is the operator's (ruling A on #26001).
 */

import React, { createContext, useContext } from 'react';

export const HostMapStyleContext = createContext<string | undefined>(undefined);

export const HostMapStyleProvider: React.FC<{
  /** The deployment's default MapLibre style URL; `undefined` when none is set. */
  styleUrl: string | undefined;
  children: React.ReactNode;
}> = ({ styleUrl, children }) => (
  <HostMapStyleContext.Provider value={styleUrl}>{children}</HostMapStyleContext.Provider>
);

/**
 * The deployment's default map style the host provided, or `undefined` when no
 * host provided one. See the module docblock.
 */
export function useHostMapStyle(): string | undefined {
  return useContext(HostMapStyleContext);
}
