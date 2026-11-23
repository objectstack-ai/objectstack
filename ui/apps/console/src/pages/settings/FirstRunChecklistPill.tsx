// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * <FirstRunChecklistPill> — 「Get started n/m」 at the bottom of the sidebar
 * (objectstack#36739, after Attio's 「Getting started 2/6」), drawn into
 * app-shell's `SidebarFooterSlotProvider` by the console's permissions scope,
 * so it is in every app.
 *
 * - Only for the administrator the checklist is for (`useFirstRunChecklist`
 *   answers `null` for anyone else, a member included).
 * - It reads the rows done of the rows drawn, optional ones included, and
 *   stands aside once the REQUIRED rows are done (`completion.complete`), or
 *   once this administrator hid the checklist on this device.
 * - A press opens the checklist in place, in a popover beside the pill; a row's
 *   link closes it as the page it opens loads.
 * - From 768 px up it sits in the sidebar's footer; while the sidebar is folded
 *   to its icon rail it keeps its icon and its count. On a phone, which has no
 *   resident sidebar, it sits after the app's menu on the app's home page.
 *
 * @module
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@object-ui/components';
import type { SidebarFooterSlotPlace } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';
import { FirstRunChecklist } from './FirstRunChecklist';
import { useFirstRunChecklist } from './firstRunChecklistState';

export function FirstRunChecklistPill({ where }: { where: SidebarFooterSlotPlace }) {
  const { t } = useObjectTranslation();
  const data = useFirstRunChecklist();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // A row's link opened another page: the popover goes with the page it was on.
  const here = `${location.pathname}${location.search}`;
  useEffect(() => {
    setOpen(false);
  }, [here]);

  if (!data || data.dismissed || data.completion.complete) return null;
  const { done, total } = data.completion;
  const label = t('console.firstRunChecklist.pill.label');
  const count = t('console.firstRunChecklist.pill.count', { done, total });
  const phone = where === 'phoneAppHome';

  return (
    <div className={cn(phone && 'px-4 pb-4 pt-2')} data-testid="first-run-checklist-pill-slot">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full min-w-0 items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2 py-1.5 text-left text-sm',
              'transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              'group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
              phone && 'min-h-11 rounded-xl bg-card px-3',
            )}
            aria-label={t('console.firstRunChecklist.pill.aria', { done, total })}
            title={t('console.firstRunChecklist.pill.aria', { done, total })}
            data-testid="first-run-checklist-pill"
            data-done={done}
            data-total={total}
          >
            <ListChecks className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">{label}</span>
            <span
              className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-xs font-medium tabular-nums text-primary group-data-[collapsible=icon]:hidden"
              data-testid="first-run-checklist-pill-count"
            >
              {count}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={phone ? 'top' : 'right'}
          align={phone ? 'center' : 'end'}
          sideOffset={8}
          collisionPadding={8}
          className="max-h-[min(36rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-1rem))] overflow-y-auto p-0"
          data-testid="first-run-checklist-popover"
        >
          <FirstRunChecklist placement="popover" onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
