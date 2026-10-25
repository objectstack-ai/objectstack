/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * HostNavigationContext — the host's own in-app navigate, offered to renderers.
 *
 * A published renderer package cannot navigate correctly on its own. Its only
 * dependency-free option is a browser-level navigation
 * (`window.location.assign`), which resolves a rooted path such as `/thanks`
 * against the ORIGIN. Under a host mounted at a sub-path — the framework CLI
 * configures one for every embedded deployment — that leaves the application
 * entirely. This is objectui#4989 defect 4, and the same class as
 * objectui#4190 / #4181.
 *
 * The host is the only party that knows its mount, so the host supplies the
 * navigate. This context is that seam: **optional injection**, ruled by the
 * maintainer on 2026-08-17. Two mechanisms were rejected in that ruling and are
 * named here so they are not re-proposed:
 *
 *   - **router-presence sniffing** (a renderer reading React Router's context
 *     when it happens to be there) — implicit magic, and it forces every
 *     renderer that wants mount-awareness to import `react-router`;
 *   - **a `react-router` peer requirement** — it imposes module resolution on
 *     router-less consumers. Two real ones exist in this repo (`apps/site`,
 *     `packages/plugin-view`), and a published renderer's whole property is
 *     that it drops into ANY React application.
 *
 * Explicit injection keeps every renderer dependency-free and puts
 * mount-awareness on the type face where a host can see it is missing.
 *
 * ## Absent is a supported state, not a degraded one
 *
 * The default value is an empty object, so `useHostNavigation()` outside a
 * provider answers `{ navigate: undefined }` and never throws. A consumer reads
 * it as "no host navigate — fall back to whatever this renderer did before",
 * which for a router-less host is already the correct behaviour: with no
 * router there is no basename, so origin-rooted resolution is right. The seam
 * changes what a MOUNTED host gets, and changes nothing else.
 *
 * ## Relationship to the other navigation seams in this package
 *
 * `DrillNavigationContext.openRecordList` is a SEMANTIC navigation — "show me
 * the records behind this aggregate" — that only the console can turn into a
 * URL. `ActionProvider`'s `onNavigate` is the ActionRunner's handler for
 * `type: 'navigate'` actions, reachable only through an action dispatch. This
 * one is neither: it is the plain "go to this already-resolved in-app path"
 * that a renderer holds a destination for and cannot perform correctly itself.
 * All three are supplied by the same shell from the same router `navigate`.
 */

import React, { createContext, useContext } from 'react';

export interface HostNavigationValue {
  /**
   * Navigate to an in-app path, resolved by the HOST — so a mounted host's
   * basename is applied and the transition stays inside the application.
   *
   * `to` is an already-resolved, application-relative path (e.g. `/thanks`,
   * `/apps/crm/accounts/r1`), never an absolute URL: a renderer that holds an
   * external destination must not launder it through the host's router. It is
   * the CALLER's job to have judged the destination — this seam performs a
   * navigation, it does not authorize one.
   *
   * Absent when no host wired it; consumers fall back to their own default.
   */
  navigate?: (to: string, options?: { replace?: boolean }) => void;
}

export const HostNavigationContext = createContext<HostNavigationValue>({});

export const HostNavigationProvider: React.FC<{
  value: HostNavigationValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <HostNavigationContext.Provider value={value}>{children}</HostNavigationContext.Provider>
);

/**
 * Consume the host-provided in-app navigate. Answers `{}` (i.e. `navigate`
 * undefined) when no host wired one — that is a supported state, see the module
 * docblock.
 */
export function useHostNavigation(): HostNavigationValue {
  return useContext(HostNavigationContext);
}
