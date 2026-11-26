// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app shell's reader of the arrival that enters the design mode
 * (objectstack#36907, `designModeAddDashboardArrival`): a Studio dashboard
 * list's 「New」 opens the app with it in the navigation state.
 *
 * Read once per history entry, where it lands. The entry is replaced without
 * it before anything else happens, so Back or a reload enters nothing: the
 * mode has no address, and a history entry is not one either. Then:
 *
 * - on a phone, nothing more: the mode is never on there, and Studio offers
 *   that 「New」 on no phone;
 * - elsewhere the mode is asked to enter with the 「Add menu item」 picker
 *   opened on its dashboards (`enterOpening`). Where `enter` refuses (a
 *   dashboard's or a report's own editor holds the mode out,
 *   objectstack#36692), the arrival does nothing more, and the mode says why,
 *   as it does for its own menu door.
 *
 * @module
 */

import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DesignModeValue } from './designMode.js';
import { readDesignModeAddDashboardArrival, withoutDesignModeAddDashboardArrival } from './designModeArrival.js';

export function useDesignModeArrival(mode: DesignModeValue, enabled: boolean): void {
  const location = useLocation();
  const navigate = useNavigate();
  const arrival = readDesignModeAddDashboardArrival(location.state);
  const readRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!arrival || readRef.current === location.key) return;
    readRef.current = location.key;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: withoutDesignModeAddDashboardArrival(location.state),
    });
    if (enabled) mode.enterOpening({ column: 'dashboard', studioReturn: arrival.studioReturn });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per history entry; `arrival` is a fresh object each render
  }, [location.key, !!arrival]);
}
