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
 */

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

export interface AppNoAccessEmptyStateProps {
  /** The active app, as the console's metadata list carries it. */
  app: { name: string; label?: string | { key: string; defaultValue?: string } };
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

export function AppNoAccessEmptyState({ app, setupPath, reason = 'no-navigation' }: AppNoAccessEmptyStateProps) {
  const { t } = useObjectTranslation();
  const { appLabel } = useServedAppLabel();
  // The same label the header's app switcher shows for this app.
  const label = appLabel(app);

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
