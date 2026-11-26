// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The top of Studio's left column (objectstack#37456; ADR-0084, amended
 * 2026-11-26, `#amendment-2026-11-26-frame`). Studio has no top bar: the two
 * rows that open its left column are where a person reads what they are in and
 * where they go back from.
 *
 *  1. **Studio's row** ({@link StudioBrandRow}): Studio's mark and name (its
 *     display name, `engine.studio.mark`), then the control that collapses
 *     the left column.
 *  2. **The package row** ({@link StudioPackageRow}): the way back
 *     (`StudioBackButton`, where `studioBackTarget` says), then the open
 *     package as the package switcher (`StudioPackageSwitcher`), with its lock
 *     when it is read-only.
 *
 * **Collapsed**, the left column is a rail that keeps the app's logo and the
 * way back: the rows stack into one column of icon buttons, the control that
 * expands the column first.
 *
 * Both rows sit under the menu's provider (`StudioMenuProvider`), which owns
 * the collapse state they read and toggle.
 */

import * as React from 'react';
import { cn, useSidebar } from '@object-ui/components';
import { Blocks } from 'lucide-react';
import { t } from '../metadata-admin/i18n.js';
import { StudioMenuTrigger } from './StudioMenu.js';
import { StudioBackButton, type StudioAppTarget } from './StudioBackToApp.js';
import { StudioPackageSwitcher, type StudioPackageSwitcherProps } from './StudioPackageSwitcher.js';

/** Studio's mark: its own graphite tile, never the app's colour (decision 4). */
export function StudioBrandMark({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      data-testid="studio-brand-mark"
      className={cn('flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background', className)}
    >
      <Blocks className="size-3.5" />
    </span>
  );
}

/** Row 1: Studio's mark and name, and the collapse control. */
export function StudioBrandRow({ locale }: { locale: string }): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2 px-1" data-testid="studio-brand-row">
      <StudioBrandMark />
      <span data-testid="studio-brand-name" className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
        {t('engine.studio.mark', locale)}
      </span>
      <StudioMenuTrigger locale={locale} />
    </div>
  );
}

export interface StudioPackageRowProps
  extends Omit<StudioPackageSwitcherProps, 'compact'> {
  /** The open package's published apps, where the way back may lead. */
  apps: readonly StudioAppTarget[];
}

/** Row 2: the way back, then the package switcher. */
export function StudioPackageRow({ apps, ...switcher }: StudioPackageRowProps): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-0.5" data-testid="studio-package-row">
      <StudioBackButton
        packageId={switcher.packageId}
        apps={apps}
        locale={switcher.locale}
        beforeNavigate={switcher.beforeNavigate}
        navigate={switcher.navigate}
      />
      <StudioPackageSwitcher {...switcher} />
    </div>
  );
}

/**
 * The two rows, or, while the docked column is collapsed to its rail, the
 * rail's head: the expand control, the way back and the app's logo, stacked.
 * A phone's drawer always draws the two rows.
 */
export function StudioTopLeft(props: StudioPackageRowProps): React.ReactElement {
  const { state, isMobile } = useSidebar();
  if (state === 'collapsed' && !isMobile) {
    return (
      <div className="flex flex-col items-center gap-1" data-testid="studio-rail-head">
        <StudioMenuTrigger locale={props.locale} />
        <StudioBackButton
          packageId={props.packageId}
          apps={props.apps}
          locale={props.locale}
          beforeNavigate={props.beforeNavigate}
          navigate={props.navigate}
        />
        <StudioPackageSwitcher {...props} compact />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="studio-top-left">
      <StudioBrandRow locale={props.locale} />
      <div aria-hidden="true" className="mx-1 h-px bg-sidebar-border" />
      <StudioPackageRow {...props} />
    </div>
  );
}
