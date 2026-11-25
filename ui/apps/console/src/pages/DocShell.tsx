/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  SidebarDocsNav,
  useShellPageActionsSlot,
  useShellSidebarExpandSlot,
  useSidebarDocsNavSlot,
} from '@object-ui/app-shell';
import { AppDocsBackLink } from './AppDocsBackLink';
import { AppDocsNav, DocsNavLandmark, PortalDocsNav } from './DocsNav';
import { useAppDocsBackTo } from './useAppDocsBackTo';

/**
 * The frame of the package-documentation pages (ADR-0046). It draws no bar of
 * its own (objectstack#35424):
 *
 * - Under an app (`/apps/:appName/docs/...`, ADR-0048), from 768 px up, the
 *   page is drawn in the app shell like every other app page
 *   (objectstack#37150, ruling 7142354097 on objectstack#36107): no top bar,
 *   the resident sidebar, and the page header's button group and expand
 *   button, which this frame draws at the page's top. The docs' one
 *   navigation column (the app's books, 「← Back to APP」 and all
 *   documentation) is the sidebar's body: the page hands it `nav`, the
 *   reader's own, else every book of the app (`AppDocsNav`).
 * - Under an app on a phone the console's app bar is above the page, and the
 *   page carries 「← Back to APP」 itself: at the top here, on every page but
 *   the reader, which carries it in its in-page column and passes
 *   `backLink={false}`.
 * - The portal (`/docs/...`), from 768 px up, is drawn in the app-less
 *   variant of the shell (`DocsPortalShell`, objectstack#37197): the same
 *   sidebar and page header, and the sidebar's body is the portal's column
 *   (`PortalDocsNav`, every app's books) unless the page hands its own.
 * - The portal on a phone is drawn in Home's frame, whose bar reads
 *   「PRODUCT / Documentation」 and links to the portal's index (`App.tsx`,
 *   the `docs` variant of `AppHeader`).
 */
export function DocShell({
  backLink = true,
  nav,
  children,
}: {
  /** Without the shell sidebar: draw 「← Back to APP」 above the page. The reader turns it off when its column has it. */
  backLink?: boolean;
  /** The page's own docs column, for the shell sidebar (the reader's); else every book of the app, or of the portal. */
  nav?: ReactNode;
  children: ReactNode;
}) {
  const { appName, slug } = useParams<{ appName?: string; slug?: string }>();
  const backTo = useAppDocsBackTo();
  const sidebarNav = useSidebarDocsNavSlot() !== null;
  const renderActions = useShellPageActionsSlot();
  const renderExpand = useShellSidebarExpandSlot();
  return (
    <div className="min-h-full">
      {sidebarNav ? (
        <SidebarDocsNav>
          <DocsNavLandmark>{nav ?? (appName ? <AppDocsNav /> : <PortalDocsNav currentSlug={slug} />)}</DocsNavLandmark>
        </SidebarDocsNav>
      ) : null}
      {renderActions || renderExpand ? (
        <div className="flex items-center gap-2 px-4 pt-3 sm:px-6" data-testid="docs-page-header">
          {renderExpand?.()}
          <div className="ml-auto">{renderActions?.({})}</div>
        </div>
      ) : null}
      {appName && backLink && backTo && !sidebarNav ? (
        <div className="mx-auto flex max-w-3xl px-4 pt-4 sm:px-6" data-testid="docs-back-bar">
          <AppDocsBackLink backTo={backTo} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
