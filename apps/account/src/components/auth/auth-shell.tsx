// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AuthShell — shared split-screen layout for every unauthenticated page
 * (login, register, forgot-password, reset-password, verify-email, …).
 *
 *   ┌─────────────────────────────┬─────────────────────────────┐
 *   │                             │                             │
 *   │       Form column           │       Brand panel           │
 *   │   (white, centred card)     │   (gradient mesh, glow)     │
 *   │                             │                             │
 *   └─────────────────────────────┴─────────────────────────────┘
 *
 * On < lg the brand panel is hidden and a compact brand tile sits above the
 * form so the page stays cohesive on mobile.
 */

import * as React from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import { GalleryVerticalEnd } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AuthShellProps {
  /** Form / interactive content rendered in the left column. */
  children: React.ReactNode;
  /** Override the right-panel headline. */
  headline?: React.ReactNode;
  /** Override the right-panel sub-line. */
  subline?: React.ReactNode;
  /** Optional max-width on the form container (default `sm`). */
  formWidth?: 'sm' | 'md';
}

export function AuthShell({
  children,
  headline,
  subline,
  formWidth = 'sm',
}: AuthShellProps) {
  const { t } = useObjectTranslation();
  const widthCls = formWidth === 'md' ? 'max-w-md' : 'max-w-sm';
  return (
    <div className="relative grid min-h-svh w-full lg:grid-cols-2">
      {/* Left: form column */}
      <div className="flex flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
        <div className={cn('flex w-full flex-col gap-6', widthCls)}>
          <a
            href="#"
            className="flex items-center gap-2 self-center font-semibold tracking-tight"
          >
            <div className="flex size-7 items-center justify-center rounded-md bg-brand-gradient text-primary-foreground shadow-sm shadow-primary/30">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <span>ObjectStack</span>
          </a>
          {children}
        </div>
      </div>

      {/* Right: brand panel (≥ lg) */}
      <aside
        aria-hidden
        className="relative hidden overflow-hidden bg-brand-mesh text-white lg:flex lg:flex-col lg:justify-between lg:p-12"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage:
              'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          }}
        />
        <div className="pointer-events-none absolute -left-24 top-1/3 size-[28rem] rounded-full bg-white/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-20 size-[24rem] rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex items-center gap-2 text-sm font-semibold tracking-tight">
          <div className="flex size-7 items-center justify-center rounded-md bg-white/15 ring-1 ring-white/30 backdrop-blur">
            <GalleryVerticalEnd className="size-4" />
          </div>
          ObjectStack
        </div>

        <div className="relative max-w-md space-y-5">
          <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            {headline ??
              t('auth.login.brandHeadline', {
                defaultValue: 'The AI-native backend for business software.',
              })}
          </h2>
          <p className="text-balance text-base/relaxed text-white/80">
            {subline ??
              t('auth.login.brandSubline', {
                defaultValue:
                  'One identity, every workspace. Sign in to manage your account, organizations and connected apps.',
              })}
          </p>
        </div>

        <div className="relative text-xs text-white/60">
          © {new Date().getFullYear()} ObjectStack
        </div>
      </aside>
    </div>
  );
}
