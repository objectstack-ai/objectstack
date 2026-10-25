/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * Optional brand panel content for the AuthShell aside.
 * Renders to the right of the form on `md` and above.
 */
export interface AuthShellBrandPanel {
  /** Brand name or product name shown at the top of the panel. */
  brandName?: React.ReactNode;
  /** Optional icon/logo node shown beside the brand name. */
  brandIcon?: React.ReactNode;
  /** Large headline copy. */
  headline?: React.ReactNode;
  /** Short supporting copy below the headline. */
  subline?: React.ReactNode;
  /** Optional small caption shown at the bottom of the brand panel. */
  footer?: React.ReactNode;
}

export interface AuthShellProps {
  /** Slot for the auth form (LoginForm / RegisterForm / etc.) */
  children: React.ReactNode;
  /** Brand panel content shown on the right on `md+` screens. Omit to hide. */
  brand?: AuthShellBrandPanel;
  /**
   * Override the wrapper class for the form column.
   * Defaults to a centred flex column with comfortable padding.
   */
  formColumnClassName?: string;
  /** Override the wrapper class for the brand column. */
  brandColumnClassName?: string;
  /**
   * Optional class for the outermost root element.
   * Defaults to a full-viewport two-column grid.
   */
  className?: string;
}

const DEFAULT_BRAND_CLASSES =
  'relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground md:flex md:flex-col md:justify-between md:p-12 lg:p-16';

const DEFAULT_FORM_CLASSES =
  'flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 sm:px-6 md:min-h-0 md:h-screen md:overflow-y-auto';

const DEFAULT_ROOT_CLASSES = 'grid min-h-screen w-full md:grid-cols-2';

/**
 * Premium split-screen auth shell. Use as a wrapper around any of the auth
 * form components (LoginForm, RegisterForm, ForgotPasswordForm) to give the
 * sign-in experience a polished, branded look.
 *
 * The form column appears on the left, the brand panel on the right
 * (collapsing to form-only on mobile). The brand panel uses a gradient
 * built from the primary color, plus a soft mesh of radial highlights —
 * everything rendered with Tailwind utility classes so no extra deps are
 * needed in the consuming app.
 *
 * @example
 * ```tsx
 * <AuthShell
 *   brand={{
 *     brandName: 'Acme',
 *     headline: 'Welcome back.',
 *     subline: 'Sign in to continue building.',
 *   }}
 * >
 *   <LoginForm onSuccess={() => navigate('/dashboard')} />
 * </AuthShell>
 * ```
 */
export function AuthShell({
  children,
  brand,
  className,
  formColumnClassName,
  brandColumnClassName,
}: AuthShellProps) {
  return (
    <div className={className ?? DEFAULT_ROOT_CLASSES}>
      <div className={formColumnClassName ?? DEFAULT_FORM_CLASSES}>
        <div className="w-full max-w-md">{children}</div>
      </div>

      {brand && (
        <aside className={brandColumnClassName ?? DEFAULT_BRAND_CLASSES} aria-hidden="true">
          {/* Soft mesh of radial highlights */}
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                'radial-gradient(circle at 18% 22%, rgba(255,255,255,0.22), transparent 45%), radial-gradient(circle at 82% 78%, rgba(255,255,255,0.18), transparent 50%), radial-gradient(circle at 60% 20%, rgba(255,255,255,0.10), transparent 55%)',
            }}
          />
          {/* Subtle grid */}
          <div
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
              backgroundSize: '36px 36px',
              maskImage: 'radial-gradient(circle at center, black 30%, transparent 75%)',
            }}
          />
          {/* Glow */}
          <div className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 bottom-12 h-64 w-64 rounded-full bg-white/10 blur-3xl" />

          <div className="relative z-10 flex items-center gap-3 text-sm font-medium uppercase tracking-[0.18em] opacity-90">
            {brand.brandIcon && <span aria-hidden="true">{brand.brandIcon}</span>}
            {brand.brandName && <span>{brand.brandName}</span>}
          </div>

          <div className="relative z-10 max-w-md space-y-5">
            {brand.headline && (
              <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                {brand.headline}
              </h2>
            )}
            {brand.subline && (
              <p className="text-base leading-relaxed text-primary-foreground/85 md:text-lg">
                {brand.subline}
              </p>
            )}
          </div>

          {brand.footer && (
            <div className="relative z-10 text-xs text-primary-foreground/70">{brand.footer}</div>
          )}
        </aside>
      )}
    </div>
  );
}
