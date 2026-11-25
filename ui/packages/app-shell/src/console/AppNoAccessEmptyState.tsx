// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app root's answer when the app serves this caller NO navigation
 * (objectui#12079).
 *
 * The server filters an app's navigation per caller before it reaches the
 * console (`requiredPermissions`, `requiresService` and the doc audience, with
 * emptied groups dropped). An app whose every group is capability-gated
 * therefore arrives as `navigation: []` for a caller who holds none of those
 * capabilities. The sidebar is empty, and the app index route has no landing
 * to resolve. Until objectui#12079 that route fell back to `StudioHomePage`,
 * the Studio app's overview (retired by objectui#12113), so the caller saw
 * metadata counters and "New Object" quick actions inside an app that had
 * nothing to do with Studio, and nothing told them what to do next.
 *
 * This is an app-level empty state instead. It names the app and says the
 * caller has no access in it yet. A caller who can grant access gets a link to
 * Setup; everyone else is told to ask an administrator.
 *
 * objectstack#25338 — the same screen answers a second case: an app that names
 * objects in its navigation, none of which the caller may read. The sidebar
 * still draws its dashboards and pages, but every tile on them would refuse,
 * so the description says the caller can read nothing here yet and asks for a
 * permission set, instead of claiming the app has no pages.
 *
 * objectstack-ai/objectstack#29771 — and a third: an app that shows the caller
 * entries, none of which opens a page inside the app (every one is a `url` or
 * `action` link, in `navigation` and in every area). The caller has access;
 * the app simply has no page of its own. So this reason has its own title and
 * description, which point at the menu, a menu icon instead of the lock, and
 * no Setup link: there is nothing to grant.
 *
 * objectstack#36748 — and a fourth: an app whose menu is empty as STORED, not
 * as filtered for this caller. Studio's 「新建应用」 makes the app before its
 * objects, so a new app opens with nothing in its menu, and blaming access for
 * that sent its author to Setup for nothing. For a caller who can grant access
 * (the only one who can also fill the menu), the no-navigation answer first
 * reads the app's stored menu (`/layers`, the read the design mode's menu
 * editor makes); when it is empty too, the screen says the menu is empty and
 * opens the app's package in Studio. Everyone else, and a stored menu that
 * holds entries this caller is not shown, keep the access answer.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Lock, PanelLeft } from 'lucide-react';
// The shared empty state (objectstack#25915): it draws the muted icon square
// this screen used to hand-copy, and it is `role="status"`, so "nothing here
// for you" is announced instead of being an unlabelled block. `AppContent.tsx`
// already reaches it through `PreviewDraftEmptyState`, so the eager graph
// gains no new module.
import { Button, DataEmptyState } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import { useCanAuthorMetadata } from '../hooks/useCanAuthorMetadata.js';
import { studioHomePath } from '../views/studio-design/studioAddress.js';

export interface AppNoAccessEmptyStateProps {
  /** The active app, as the console's metadata list carries it (`_packageId` as served). */
  app: { name: string; label?: string | { key: string; defaultValue?: string }; _packageId?: unknown };
  /**
   * Where Setup lives, for a caller who can grant access. `null` for everyone
   * else, which hides the link and asks them to contact an administrator.
   */
  setupPath: string | null;
  /**
   * Why the app has nothing for this caller: it shows them no navigation
   * (`'no-navigation'`, the default), or it names only objects they may not
   * read (`'no-readable-object'`, objectstack#25338), or every entry it
   * shows them is a `url` or `action` link, so the app opens from its menu
   * and has no page of its own (`'menu-only'`,
   * objectstack-ai/objectstack#29771). `setupPath` is not read for
   * `'menu-only'`: the caller has access, so there is nothing to grant.
   */
  reason?: 'no-navigation' | 'no-readable-object' | 'menu-only';
}

/** Whether a `/layers` read of an app holds no menu entry, in `navigation` or in any area. */
export function storedMenuIsEmpty(layers: unknown): boolean {
  const read = (layers ?? {}) as { effective?: unknown; code?: unknown };
  const app = (read.effective ?? read.code ?? {}) as { navigation?: unknown; areas?: unknown };
  const empty = (nav: unknown) => !Array.isArray(nav) || nav.length === 0;
  const areas = Array.isArray(app.areas) ? (app.areas as Array<{ navigation?: unknown } | null>) : [];
  return empty(app.navigation) && areas.every((area) => empty(area?.navigation));
}

/**
 * objectstack#36748 — is the app's STORED menu empty? `null` while the read is
 * out; `false` when it fails or `ask` is false, so the access answer stands.
 */
function useStoredMenuEmpty(appName: string, packageId: string | null, ask: boolean): boolean | null {
  const [answer, setAnswer] = React.useState<{ key: string; empty: boolean } | null>(null);
  const key = `${packageId ?? ''}/${appName}`;
  React.useEffect(() => {
    if (!ask || !packageId) return;
    let cancelled = false;
    fetch(`/api/v1/meta/app/${encodeURIComponent(appName)}/layers?package=${encodeURIComponent(packageId)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (res) => (res.ok ? storedMenuIsEmpty(await res.json()) : false))
      .catch(() => false)
      .then((empty) => {
        if (!cancelled) setAnswer({ key, empty });
      });
    return () => {
      cancelled = true;
    };
  }, [ask, packageId, appName, key]);
  if (!ask || !packageId) return false;
  return answer?.key === key ? answer.empty : null;
}

export function AppNoAccessEmptyState({ app, setupPath, reason = 'no-navigation' }: AppNoAccessEmptyStateProps) {
  const { t } = useObjectTranslation();
  const { appLabel } = useServedAppLabel();
  // The same label the header's app switcher shows for this app.
  const label = appLabel(app);
  const packageId = typeof app._packageId === 'string' && app._packageId ? app._packageId : null;
  // Only an AUTHOR is asked for: `/layers` serves the stored, unpruned app only
  // to a caller who may write it (`manage_metadata`); anyone else gets the app
  // pruned to what they may see, whose emptiness is the access case, and could
  // not open the Studio the empty-menu answer links to. An organization admin
  // without `manage_metadata` (the hosted posture, objectstack#8270) keeps the
  // access answer.
  const canAuthor = useCanAuthorMetadata();
  const menuEmpty = useStoredMenuEmpty(app.name, packageId, reason === 'no-navigation' && setupPath !== null && canAuthor);

  if (menuEmpty === null) {
    // The stored menu is being read: no answer is drawn until it decides which.
    return <div className="h-full w-full" data-testid="app-no-access-pending" />;
  }

  if (menuEmpty && packageId) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8" data-testid="app-no-access-empty-state">
        <DataEmptyState
          data-reason="empty-menu"
          icon={<PanelLeft className="size-5 text-muted-foreground" aria-hidden="true" />}
          title={t('empty.appMenuEmpty', {
            app: label,
            defaultValue: '{{app}} has nothing in its menu yet',
          })}
          description={t('empty.appMenuEmptyDescription', {
            defaultValue: 'Create objects for this app in Studio and they join its menu, or add entries in Design layout.',
          })}
          action={
            <Button asChild variant="outline">
              <Link to={studioHomePath(packageId)} data-testid="app-empty-menu-open-studio">
                {t('empty.openInStudio', { defaultValue: 'Open in Studio' })}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (reason === 'menu-only') {
    return (
      <div className="flex h-full w-full items-center justify-center p-8" data-testid="app-no-access-empty-state">
        <DataEmptyState
          data-reason={reason}
          icon={<PanelLeft className="size-5 text-muted-foreground" aria-hidden="true" />}
          title={t('empty.appOpensFromMenu', {
            app: label,
            defaultValue: '{{app}} opens from its menu',
          })}
          description={t('empty.appOpensFromMenuDescription', {
            defaultValue: 'This app has no page of its own. Choose an entry in its menu to open a link or run an action.',
          })}
        />
      </div>
    );
  }

  const description =
    reason === 'no-readable-object'
      ? setupPath
        ? t('empty.appNoReadableObjectGrantDescription', {
            defaultValue: 'Your account cannot read any of the records in this app yet. You can grant access in Setup.',
          })
        : t('empty.appNoReadableObjectDescription', {
            defaultValue:
              'Your account cannot read any of the records in this app yet. Ask an administrator to assign you a permission set.',
          })
      : setupPath
        ? t('empty.appNothingAvailableGrantDescription', {
            defaultValue: 'This app has no pages your account can open. You can grant access in Setup.',
          })
        : t('empty.appNothingAvailableDescription', {
            defaultValue: 'This app has no pages your account can open. Ask an administrator to grant you access.',
          });

  return (
    <div className="flex h-full w-full items-center justify-center p-8" data-testid="app-no-access-empty-state">
      <DataEmptyState
        data-reason={reason}
        icon={<Lock className="size-5 text-muted-foreground" aria-hidden="true" />}
        title={t('empty.appNothingAvailable', {
          app: label,
          defaultValue: 'Nothing in {{app}} is available to you yet',
        })}
        description={description}
        action={
          setupPath ? (
            <Button asChild variant="outline">
              <Link to={setupPath} data-testid="app-no-access-open-setup">
                {t('empty.openSetup', { defaultValue: 'Open Setup' })}
              </Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
