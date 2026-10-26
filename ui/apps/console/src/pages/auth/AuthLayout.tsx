/**
 * AuthLayout — shared shell for every unauthenticated Console surface
 * (login, register, forgot-password, reset-password, verify-email, setup,
 * oauth/consent, auth/device, accept-invitation).
 *
 *   ┌─────────────────────────────────────────┐
 *   │               ◇ ObjectOS                 │
 *   │          ┌─────────────────┐             │
 *   │          │  centred form   │             │
 *   │          └─────────────────┘             │
 *   │     (faint dot-grid + soft brand glow)    │
 *   └─────────────────────────────────────────┘
 *
 * Content-first, refined-centred layout: a near-neutral canvas with a faint
 * dot-grid and a single soft brand glow for depth, a restrained product
 * wordmark above the card (server-driven product name, default "ObjectOS",
 * so operators can rebrand), and the form itself rendered by each page.
 *
 * One accent (objectui#12600): the brand tile and the glow take the theme's
 * `--primary`, the same token the form's button and links use, so the page
 * never shows a second hue beside the console's own. Tailwind utilities and
 * theme tokens only — no palette colour is named here.
 *
 * A small host pill is still shown when the page renders on what looks like a
 * tenant subdomain so a user bouncing through an SSO redirect can tell which
 * workspace they're signing in to. It is suppressed on local/loopback hosts,
 * which carry no tenant meaning.
 *
 * Mirrors `framework/apps/account/src/components/auth/auth-shell.tsx` so the
 * Console-hosted auth pages stay visually aligned with the legacy Account SPA.
 */

import { useEffect, type ReactNode } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import { cn } from '@object-ui/components';
import { getProductName, getLogoUrl } from '@object-ui/app-shell';

export interface AuthLayoutProps {
  children: ReactNode;
  /**
   * Optional max-width on the form column (default `sm`, 384 px): `base` is
   * the 400 px column the login page draws, `md` is 448 px.
   */
  formWidth?: 'sm' | 'base' | 'md';
}

const FORM_WIDTH_CLASS: Record<NonNullable<AuthLayoutProps['formWidth']>, string> = {
  sm: 'max-w-sm',
  base: 'max-w-[400px]',
  md: 'max-w-md',
};

function isCanonicalCloudHost(host: string): boolean {
  const bare = host.split(':')[0]!.toLowerCase();
  return /^cloud\./.test(bare);
}

/**
 * Local dev / loopback hosts carry no tenant meaning, so the host pill
 * (which exists to disambiguate the SSO workspace) is just noise there.
 */
function isLocalHost(host: string): boolean {
  const bare = host.split(':')[0]!.toLowerCase();
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '[::1]' || bare.endsWith('.local');
}

function currentHost(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location.host || null;
}

/**
 * Restrained brand mark shown above the auth card — a layered "stack" glyph
 * on a 36 px `--primary` tile plus the product wordmark (18 px / 600).
 *
 * The product name is server-driven (runtime-config `branding.productName`,
 * default "ObjectOS") so downstream operators can rebrand the auth surface
 * without code changes. We never hard-code a vendor name here.
 */
function BrandMark() {
  const productName = getProductName();
  const logoUrl = getLogoUrl();
  return (
    <div className="flex items-center justify-center gap-2.5 select-none">
      <span
        data-testid="auth-brand-tile"
        className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30"
      >
        {logoUrl ? (
          <img src={logoUrl} alt={productName} className="h-full w-full object-contain" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2 2 7l10 5 10-5-10-5Z" />
            <path d="m2 17 10 5 10-5" />
            <path d="m2 12 10 5 10-5" />
          </svg>
        )}
      </span>
      <span data-testid="auth-brand-name" className="text-lg font-semibold tracking-tight text-foreground">
        {productName}
      </span>
    </div>
  );
}

export function AuthLayout({ children, formWidth = 'sm' }: AuthLayoutProps) {
  const { t } = useObjectTranslation();
  const widthCls = FORM_WIDTH_CLASS[formWidth];

  const host = currentHost();
  const showHostPill = !!host && !isCanonicalCloudHost(host) && !isLocalHost(host);

  useEffect(() => {
    if (typeof document === 'undefined' || !host) return;
    const original = document.title;
    if (showHostPill) document.title = host;
    return () => {
      document.title = original;
    };
  }, [host, showHostPill]);

  return (
    // `isolate` makes this root a stacking context, so the `-z-10` depth layer
    // below paints above the root's own `bg-background` and under the form.
    // Without it the layer sank beneath that background and neither the dot
    // grid nor the glow ever showed (objectui#12600).
    <div className="relative isolate flex min-h-svh w-full items-center justify-center overflow-hidden bg-background p-6">
      {/* Refined depth: a faint dot-grid fading toward the edges, plus a single
          soft glow behind the card, tinted from `--primary` at 10 % in both
          themes. Kept very low-opacity so the canvas reads as calm and
          neutral, not a marketing wash. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] bg-[length:22px_22px] opacity-[0.35] dark:opacity-[0.25] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
        <div
          data-testid="auth-glow"
          className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
        />
      </div>

      <div className={cn('flex w-full flex-col gap-5', widthCls)}>
        <BrandMark />
        {showHostPill ? (
          <div className="flex justify-center">
            <span
              className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
              title={t('auth.shell.tenantHostHint', {
                defaultValue: 'You are signing in to this system',
              })}
            >
              {host}
            </span>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
