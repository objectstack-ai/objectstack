/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { matchAppBySegment, useMetadata, useServedAppLabel } from '@object-ui/app-shell';

/** Where a docs page inside an app returns to, and the app's name for it. */
export interface AppDocsBackTo {
  to: string;
  label: string;
}

/**
 * The app a docs page under `/apps/:appName/docs` returns to: the one the
 * route's segment addresses, by the label the app bar shows. `undefined`
 * outside an app (the portal).
 */
export function useAppDocsBackTo(): AppDocsBackTo | undefined {
  const { appName } = useParams<{ appName?: string }>();
  const { apps } = useMetadata();
  const { appLabel } = useServedAppLabel();
  return useMemo(() => {
    if (!appName) return undefined;
    const app = matchAppBySegment(
      apps as Array<{ name: string; _packageId?: string; label?: unknown } & Record<string, unknown>> | undefined,
      appName,
    );
    return { to: `/apps/${appName}`, label: app ? appLabel(app) : appName };
  }, [apps, appName, appLabel]);
}
