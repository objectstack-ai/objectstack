/**
 * PhoneAppList
 *
 * The phone's list of apps (objectstack#35881): 「Current app」 with a check,
 * then 「Other apps」, and a search box at the bottom that narrows both. One
 * list, two containers: the bottom sheet the app pill opens inside an app
 * (`AppSwitcher` on a phone), and the whole page a phone shows at `/home`, the
 * list a first sign-in with several apps lands on.
 *
 * The apps are the launcher's (`useLauncherApps`: active, not hidden, and not
 * withheld by `/me/apps`), the same set the desktop switcher and the Home
 * tiles offer. Setup is in the list like any other app, last.
 *
 * @module
 */

import * as React from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useLauncherApps } from '../hooks/useLauncherApps.js';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import { matchAppBySegment } from '../utils/index.js';
import { SETUP_APP_NAME, SETUP_APP_PACKAGE_ID } from '../console/ConsoleShell.js';
import { AppMark } from './AppMark.js';

export interface PhoneAppListProps {
  /** The app open now (its route segment or name), checked under 「Current app」. */
  activeAppName?: string;
  /** Called with the picked app. */
  onPick: (app: any) => void;
  /** `sheet` inside the switcher, `page` for `/home`. */
  variant: 'sheet' | 'page';
}

const ROW_CLASS =
  'flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-3 text-left text-[15px] font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

function isSetupApp(app: any): boolean {
  return app?._packageId === SETUP_APP_PACKAGE_ID || app?.name === SETUP_APP_NAME;
}

export function PhoneAppList({ activeAppName, onPick, variant }: PhoneAppListProps) {
  const { t } = useObjectTranslation();
  const { apps: metadataApps } = useMetadata();
  const { apps: launcherApps } = useLauncherApps(metadataApps || []);
  const { appLabel } = useServedAppLabel();
  const [query, setQuery] = React.useState('');

  const current = activeAppName ? matchAppBySegment(launcherApps, activeAppName) : undefined;
  const ordered = [
    ...launcherApps.filter((app: any) => !isSetupApp(app)),
    ...launcherApps.filter((app: any) => isSetupApp(app)),
  ];
  const needle = query.trim().toLocaleLowerCase();
  const matches = (app: any) => !needle || String(appLabel(app) ?? '').toLocaleLowerCase().includes(needle);
  const showCurrent = !!current && matches(current);
  const others = ordered.filter((app: any) => app !== current && matches(app));

  const row = (app: any, isCurrent: boolean) => (
    <li key={app.name}>
      <button
        type="button"
        onClick={() => onPick(app)}
        aria-current={isCurrent ? 'true' : undefined}
        data-testid={`phone-app-row-${app.name}`}
        className={ROW_CLASS}
      >
        <AppMark app={app} size="md" />
        <span className="min-w-0 flex-1 truncate">{appLabel(app)}</span>
        {isCurrent && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
      </button>
    </li>
  );

  const searchLabel = t('layout.appSwitcher.searchApps', { defaultValue: 'Search apps…' });

  return (
    <div
      data-testid={`phone-app-list-${variant}`}
      className={cn('flex min-h-0 flex-col', variant === 'page' ? 'min-h-full' : 'max-h-[80vh]')}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
        {showCurrent && (
          <section>
            <h3 className="mb-1.5 px-1 text-xs text-muted-foreground">
              {t('layout.appSwitcher.currentApp', { defaultValue: 'Current app' })}
            </h3>
            <ul className="space-y-2">{row(current, true)}</ul>
          </section>
        )}
        {others.length > 0 && (
          <section>
            <h3 className="mb-1.5 px-1 text-xs text-muted-foreground">
              {current
                ? t('layout.appSwitcher.otherApps', { defaultValue: 'Other apps' })
                : t('layout.appSwitcher.yourApps', { defaultValue: 'Your apps' })}
            </h3>
            <ul className="space-y-2">{others.map((app: any) => row(app, false))}</ul>
          </section>
        )}
        {!showCurrent && others.length === 0 && (
          <p data-testid="phone-app-list-empty" className="px-1 py-6 text-center text-sm text-muted-foreground">
            {t('layout.appSwitcher.noAppsMatch', { defaultValue: 'No apps match' })}
          </p>
        )}
      </div>
      <div
        className={cn(
          'shrink-0 border-t bg-background px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
          variant === 'page' && 'sticky bottom-0',
        )}
      >
        <label className="flex h-11 items-center gap-2 rounded-full border bg-muted/50 px-4 text-muted-foreground">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            data-testid="phone-app-list-search"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
    </div>
  );
}
