/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `/apps/setup/system/approvals` names no source app (objectstack#35505).
 *
 * It is the address the server's links reach: `/system/approvals?request=ID`
 * (the e-mail and the notification) forwards onto it (`SystemRedirect`), and
 * older links spell it directly. The `setup` there is the forwarder's alias,
 * not an app the reader chose, so the inbox, and a request it opens, move on
 * to the app `resolveApprovalsHostSegment` names: the current app, then the
 * last used one, then the first. The request page then prefers the app that
 * lists the request's record. Setup stays the answer only when it is the
 * current or the last used app.
 *
 * Only the `setup` NAME alias is read this way. Setup's own address (its
 * package id, `/apps/com.objectstack.setup/system/approvals`) is where a reader
 * in Setup opens the inbox, and it stays there.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { useLastApp } from '../context/LastAppProvider.js';
import { filterActiveApps, matchAppBySegment, resolveApprovalsHostSegment } from '../utils/appRoute.js';
import { SETUP_APP_NAME } from './setupApp.js';

/**
 * How long the move waits for the last used app to be read when the current
 * app does not answer: the person's row is one shared read, and past this the
 * first app is the answer.
 */
export const SETUP_ALIAS_APPROVALS_LAST_APP_WAIT_MS = 2000;

/** Whether `pathname` is the inbox under the `setup` alias. */
export function isSetupAliasApprovalsPath(pathname: string): boolean {
  return /^\/apps\/setup\/system\/approvals\/?$/.test(pathname);
}

/**
 * Where the inbox under the `setup` alias moves to: `'waiting'` while the last
 * used app is still being read, the target (search and hash kept) once known,
 * and `undefined` on any other route or when the answer is the alias itself.
 */
export function useSetupAliasApprovalsTarget(): string | 'waiting' | undefined {
  const location = useLocation();
  const { apps } = useMetadata();
  const { currentAppName } = useNavigationContext();
  const { lastApp, settled } = useLastApp();
  const alias = isSetupAliasApprovalsPath(location.pathname);
  const currentAnswers = !!matchAppBySegment(filterActiveApps(apps), currentAppName);
  const decided = !alias || currentAnswers || settled;
  const [waitOver, setWaitOver] = useState(false);
  useEffect(() => {
    if (decided) return;
    const id = setTimeout(() => setWaitOver(true), SETUP_ALIAS_APPROVALS_LAST_APP_WAIT_MS);
    return () => clearTimeout(id);
  }, [decided]);

  if (!alias) return undefined;
  if (!decided && !waitOver) return 'waiting';
  const host = resolveApprovalsHostSegment(apps, currentAppName, lastApp);
  if (host === SETUP_APP_NAME) return undefined;
  return `/apps/${host}/system/approvals${location.search}${location.hash}`;
}
