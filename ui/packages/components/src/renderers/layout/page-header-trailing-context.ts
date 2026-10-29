/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * Host chrome a `page:header` draws as the LAST segment of its action row,
 * after the `⋯` menu and set apart from the actions by a vertical hairline
 * (objectstack#27241).
 *
 * It is a host slot, never metadata: no `page:header` key says it, and an
 * authored page cannot put anything here. The console's record view provides
 * the reader's panel switches (`PanelToggles`) here on a page in a column
 * tier, so the switches sit in the header's action row instead of on a row of
 * their own. `null` (the default) draws nothing, and the action row is
 * exactly what it was.
 */
export const PageHeaderTrailingContext = React.createContext<React.ReactNode>(null);
