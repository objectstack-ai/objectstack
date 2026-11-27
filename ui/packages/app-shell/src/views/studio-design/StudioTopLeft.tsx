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
import { Blocks, GitBranch } from 'lucide-react';
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
  /**
   * The package-less scope's pending drafts and the door to review and publish
   * them, or `null`. Only `~org` passes one: a package's live on 概览's
   * Pending tab, and `~org` has no 概览 (see {@link StudioScopePendingRow}).
   */
  scopePending?: StudioScopePending | null;
}

export interface StudioScopePending {
  /** Drafts pending, above zero. */
  count: number;
  /** Opens the changes sheet, whose Publish publishes them. */
  onOpen: () => void;
}

/**
 * The package-less scope's Changes (objectstack#37456). The top bar's Changes
 * and Publish moved to 概览's Pending tab (ADR-0084, amended 2026-11-26), and
 * `~org` names no package, so it has no 概览: this row keeps its one door to
 * the changes sheet, with the count, drawn while something is pending.
 */
export function StudioScopePendingRow({
  pending,
  locale,
  compact = false,
}: {
  pending: StudioScopePending;
  locale: string;
  compact?: boolean;
}): React.ReactElement {
  const label = t('engine.studio.changes', locale);
  return (
    <button
      type="button"
      data-testid="studio-scope-changes"
      onClick={pending.onOpen}
      title={compact ? `${label} · ${pending.count}` : undefined}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md text-[13px] text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        compact ? 'w-8 justify-center' : 'w-full px-2',
      )}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={compact ? 'sr-only' : 'min-w-0 flex-1 truncate text-left'}>{label}</span>
      <span className="sr-only"> · </span>
      <span
        data-testid="studio-changes-count"
        className={cn(
          'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground',
          compact && 'sr-only',
        )}
      >
        {pending.count}
      </span>
    </button>
  );
}

/** Row 2: the way back, then the package switcher. */
export function StudioPackageRow({ apps, scopePending: _scopePending, ...switcher }: StudioPackageRowProps): React.ReactElement {
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

function switcherProps({ apps: _apps, scopePending: _pending, ...rest }: StudioPackageRowProps): StudioPackageSwitcherProps {
  return rest;
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
        <StudioPackageSwitcher {...switcherProps(props)} compact />
        {props.scopePending && <StudioScopePendingRow pending={props.scopePending} locale={props.locale} compact />}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="studio-top-left">
      <StudioBrandRow locale={props.locale} />
      <div aria-hidden="true" className="mx-1 h-px bg-sidebar-border" />
      <StudioPackageRow {...props} />
      {props.scopePending && <StudioScopePendingRow pending={props.scopePending} locale={props.locale} />}
    </div>
  );
}

/**
 * Under 768 px the left column is a drawer, and the rows above live inside it,
 * so the control that opens it needs a place of its own: a strip at the top
 * of the page with that control and Studio's name (ADR-0084, amended
 * 2026-11-26, `#amendment-2026-11-26-frame`). Nothing is drawn from 768 px up.
 */
export function StudioMobileStrip({ locale }: { locale: string }): React.ReactElement | null {
  const { isMobile } = useSidebar();
  if (!isMobile) return null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2" data-testid="studio-mobile-strip">
      <StudioMenuTrigger locale={locale} />
      <StudioBrandMark />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('engine.studio.mark', locale)}</span>
    </div>
  );
}

/**
 * A package id no package has draws no left column (there is nothing to list
 * or switch to), so its way back needs a place of its own: a strip at the top
 * of the page with the way back and Studio's name, where the top bar's
 * 「‹ Back to app」 was drawn before objectstack#37456. Drawn at every width.
 */
export function StudioMissingPackageStrip({
  locale,
  apps,
  beforeNavigate,
  navigate,
}: {
  locale: string;
  apps: readonly StudioAppTarget[];
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
}): React.ReactElement {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2" data-testid="studio-missing-package-strip">
      <StudioBackButton packageId={null} apps={apps} locale={locale} beforeNavigate={beforeNavigate} navigate={navigate} />
      <StudioBrandMark />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('engine.studio.mark', locale)}</span>
    </div>
  );
}
