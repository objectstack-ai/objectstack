// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared chrome for Preview-tab renderers — gives every preview the
 * same border, padding, header strip, and empty/error states so they
 * feel like one feature instead of seven one-offs.
 */

import * as React from 'react';
import { AlertCircle, Inbox } from 'lucide-react';
import { t, useMetadataLocale } from '../i18n.js';

export interface PreviewShellProps {
  /**
   * Right-hand badge/label, e.g. the resolved view type or row count.
   * Kept in the type signature for backward-compat with existing call
   * sites, but no longer rendered — the breadcrumb + canvas toolbar
   * already identify the resource, and the design/preview toggle says
   * which mode we're in. Showing it again here was just chrome.
   */
  hint?: React.ReactNode;
  /** Optional title override. No longer rendered (see `hint`). */
  title?: React.ReactNode;
  /**
   * Optional toolbar rendered on the right of a slim 32px header. When
   * omitted the header is fully suppressed so the preview body extends
   * edge-to-edge inside the canvas border.
   */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

export function PreviewShell({ toolbar, children }: PreviewShellProps) {
  return (
    <div className="rounded-lg border bg-background overflow-hidden flex flex-col h-full">
      {toolbar != null && (
        <div className="flex items-center justify-end border-b bg-muted/20 px-2 py-1 min-h-[32px]">
          {toolbar}
        </div>
      )}
      <div className="bg-background flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

export function PreviewMessage({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: React.ReactNode;
}) {
  const styles =
    tone === 'warn'
      ? 'text-amber-800 bg-amber-50 border-amber-200'
      : tone === 'error'
        ? 'text-destructive bg-destructive/5 border-destructive/30'
        : 'text-muted-foreground border-muted';
  return (
    <div className={`m-4 rounded border p-3 text-sm flex items-start gap-2 ${styles}`}>
      {tone !== 'info' && <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
      <div className="flex-1">{children}</div>
    </div>
  );
}

/**
 * Centered placeholder for empty/onboarding preview states (e.g. "no
 * source object yet", "no columns defined"). Fills the canvas
 * vertically so the empty-state feels intentional instead of looking
 * like a tiny banner stranded above a vast blank canvas.
 */
export function PreviewEmptyState({
  icon,
  title,
  description,
  action,
  tone = 'info',
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'info' | 'warn';
}) {
  const toneStyles =
    tone === 'warn'
      ? 'text-amber-700 bg-amber-50/40 border-amber-200/60'
      : 'text-muted-foreground border-dashed border-muted-foreground/25 bg-muted/10';
  const iconNode = icon ?? <Inbox className="h-8 w-8 opacity-50" />;
  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <div
        className={`max-w-md w-full rounded-lg border ${toneStyles} px-6 py-10 flex flex-col items-center gap-3 text-center`}
      >
        <div className="text-foreground/60">{iconNode}</div>
        <div className="text-sm font-medium text-foreground/90">{title}</div>
        {description && <div className="text-xs leading-relaxed">{description}</div>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

/**
 * The boundary's own heading, in the designer locale (objectui#10848).
 *
 * Read through `useMetadataLocale()`, the hook every designer host already
 * takes its `locale` from (`ResourceEditPage`, `EmbeddedItemEditor`,
 * `StudioDesignSurface`), so the heading follows the same language as the
 * preview it sits in without each of the boundary's callers threading one.
 * A class component cannot call the hook, so the heading is its own component.
 */
function PreviewErrorHeading() {
  const locale = useMetadataLocale();
  return <div className="font-medium">{t('engine.previewShell.renderFailed', locale)}</div>;
}

/**
 * Catch render errors from third-party preview renderers so a buggy
 * widget can't blank the whole edit page. Keeps the rest of the tabs
 * (Form / Layers / References) usable. The error's own message is shown
 * as the thrower wrote it; `fallbackHint` is the caller's sentence.
 */
export class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackHint?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[MetadataPreview] render failed', error);
  }
  render() {
    if (this.state.error) {
      return (
        <PreviewMessage tone="error">
          <PreviewErrorHeading />
          <div className="text-xs mt-1 font-mono opacity-80">{this.state.error.message}</div>
          {this.props.fallbackHint && (
            <div className="text-xs mt-2 opacity-70">{this.props.fallbackHint}</div>
          )}
        </PreviewMessage>
      );
    }
    return this.props.children as React.ReactElement;
  }
}
