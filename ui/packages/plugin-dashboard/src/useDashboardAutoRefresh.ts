/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import type { DashboardComponentSchema } from '@object-ui/types';

/**
 * The dashboard auto-refresh timer: ONE implementation, two mount points
 * (objectui#8820).
 *
 * `DashboardGridLayout` and `DashboardRenderer` each used to carry their own
 * copy of the same three things: a `refreshing` flag, a `handleRefresh`
 * callback shared by the manual "Refresh All" button and the timer, and an
 * effect that read the authored period and drove `setInterval`. The copies were
 * identical in logic, and two copies of one rule is two places to change and
 * one place to forget: the `refreshInterval` to `refreshIntervalSeconds` rename
 * (objectui#7783) had to be made twice, and a copy that drifted would still
 * pass its own component's tests.
 *
 * This hook is that logic, moved here. Both surfaces call it, so the authored
 * period is read in exactly one place.
 *
 * - The period is `refreshIntervalSeconds`, in seconds, and nothing else. The
 *   retired `refreshInterval` spelling is refused by the spec's
 *   `DashboardSchema`, so no fallback reads it (AGENTS.md #0.1).
 * - The timer runs only when the host wired `onRefresh` AND the period is
 *   greater than zero: an absent period, `0` and a negative value all mean
 *   "off".
 * - The interval is armed on VALUES only: the period and whether a handler is
 *   wired. The handler itself is read through a ref when a run happens, so a
 *   new handler identity, from the host or from React discarding a memo, never
 *   re-arms the interval or moves its phase, and the run still calls the
 *   CURRENT handler (AGENTS.md #10, objectui#11004).
 * - The indicator clears itself 600ms after each run, manual or timed.
 *
 * `__tests__/dashboardAutoRefreshTimer.test.tsx` mounts both surfaces and
 * counts `onRefresh` calls under fake timers. It pins the first three points,
 * the third under a forced memo discard; nothing pins the 600ms indicator.
 */

/** What a dashboard surface needs to drive its refresh affordance. */
export interface DashboardAutoRefresh {
  /** True while a refresh is in flight; drives the spinner and disables the button. */
  refreshing: boolean;
  /** Run a refresh now. Wired to both the manual button and the timer. */
  handleRefresh: () => void;
}

/**
 * One refresh run, manual or timed: call the host handler and show the
 * indicator for 600ms. A no-op when no handler is wired.
 *
 * Module scope on purpose: the interval callback calls this rather than
 * `handleRefresh`, so no dependency list has to name a function identity.
 */
function runRefresh(
  onRefresh: (() => void) | undefined,
  setRefreshing: (value: boolean) => void,
): void {
  if (!onRefresh) return;
  setRefreshing(true);
  onRefresh();
  // Reset refreshing indicator after a short delay
  setTimeout(() => setRefreshing(false), 600);
}

/**
 * Owns the refresh indicator, the manual refresh handler, and the auto-refresh
 * interval for one dashboard surface.
 */
export function useDashboardAutoRefresh(
  schema: DashboardComponentSchema,
  onRefresh?: () => void,
): DashboardAutoRefresh {
  const [refreshing, setRefreshing] = React.useState(false);

  // The latest host handler, read when a run happens rather than captured
  // when the interval is armed (AGENTS.md #10). A host that passes a new
  // function identity is therefore called on the next run without the
  // interval being cleared and set again.
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  // Memoised for cost only: nothing below depends on this identity.
  const handleRefresh = React.useCallback(() => {
    runRefresh(onRefreshRef.current, setRefreshing);
  }, []);

  // The one read of the authored period, for both surfaces. Seconds; the
  // `* 1000` below converts to milliseconds.
  const seconds = schema.refreshIntervalSeconds;
  // Whether a handler is wired: a value, not the handler's identity.
  const wired = Boolean(onRefresh);

  // Keyed on the two values the timer reads. ⛔ Do not add `handleRefresh` or
  // `onRefresh` here: either identity can change while both values stay
  // equal (a host re-render, a memo React discards), and every such change
  // would clear the interval and restart its phase (AGENTS.md #10,
  // objectui#11004).
  React.useEffect(() => {
    if (!seconds || seconds <= 0 || !wired) return;
    const interval = setInterval(
      () => runRefresh(onRefreshRef.current, setRefreshing),
      seconds * 1000,
    );
    return () => clearInterval(interval);
  }, [seconds, wired]);

  return { refreshing, handleRefresh };
}
