/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { usePageVariables } from './usePageVariables.js';
import { useAction } from '../context/index.js';

/**
 * PageVariableActionBridge — publishes the live page-variable snapshot into the
 * shared ActionRunner context as `pageVariables`, so a submit action (`api` /
 * `script` / `flow`, or an `onClick` expression) can pull page-local form state
 * into its request body via `{{page.<var>}}` token interpolation (resolved in
 * app-shell's `useConsoleActionRuntime`).
 *
 * This is the data-entry counterpart to ObjectGrid publishing `selectedRecords`
 * into the same context. Page variables live BELOW the ActionProvider — they're
 * mounted by `PageVariablesProvider` inside the page layout renderer, whereas
 * the action runtime is mounted above it — so the runtime can't read them
 * directly. The bridge carries them up via `updateContext`.
 *
 * Mount it once inside a `PageVariablesProvider`. Outside an `ActionProvider`,
 * `useAction()` falls back to a throwaway runner, so the bridge is a safe no-op
 * (never throws in standalone / test contexts). Renders nothing.
 */
export function PageVariableActionBridge(): null {
  const { variables } = usePageVariables();
  const { updateContext } = useAction();

  React.useEffect(() => {
    updateContext({ pageVariables: variables });
    return () => {
      updateContext({ pageVariables: {} });
    };
  }, [variables, updateContext]);

  return null;
}

PageVariableActionBridge.displayName = 'PageVariableActionBridge';
