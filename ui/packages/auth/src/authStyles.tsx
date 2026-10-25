/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * Shared Tailwind utility classes for auth form primitives.
 * These mirror the look used across LoginForm / RegisterForm /
 * ForgotPasswordForm so the package presents a coherent feel.
 *
 * Consumers can override styling per-form by passing their own children
 * inside an AuthShell, but the defaults aim to look premium out of the box.
 *
 * Sizes follow the console login artboard (objectui#12600): 40 px (`h-10`)
 * fields and primary button, 13 px / 500 labels, one flat `--primary` fill on
 * the button. Radii are the theme's own `rounded-lg`, so a host theme that
 * re-scales `--radius` re-scales these with it.
 */
export const AUTH_INPUT_CLASS =
  'flex h-10 w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm shadow-sm ring-offset-background transition-colors placeholder:text-muted-foreground hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';

export const AUTH_PRIMARY_BUTTON_CLASS =
  'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm ring-offset-background transition-[box-shadow,background-color,transform] hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:transform-none';

export const AUTH_FIELD_LABEL_CLASS = 'text-[13px] font-medium leading-none text-foreground';

export const AUTH_LINK_CLASS =
  'font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline';

/** Decorative spinner shown while a submit is pending. */
export function AuthSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        d="M4 12a8 8 0 018-8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Inline alert icon for the error banner. */
export function AuthAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-4 w-4 shrink-0'}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Inline success check icon for confirmation states. */
export function AuthCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-6 w-6'}
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/** Inline mail icon for the forgot-password success state. */
export function AuthMailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-7 w-7'}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </svg>
  );
}

/**
 * Decorative wrapper that renders the form title block:
 * optional icon disc + title + description, centered.
 */
export function AuthFormHeader({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center space-y-3 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          {icon}
        </div>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.6rem]">
        {title}
      </h1>
      {description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** Inline error banner used by all auth forms. */
export function AuthErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
      role="alert"
    >
      <AuthAlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-snug">{message}</span>
    </div>
  );
}

/** "or" divider used when social sign-in buttons are present. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="relative my-1">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-xs uppercase tracking-wider">
        <span className="bg-background px-3 text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
