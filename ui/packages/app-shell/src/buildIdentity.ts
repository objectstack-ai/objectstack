// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's own build identity — which objectui commit this bundle was
 * compiled from (objectui#12970).
 *
 * ONE read, shared: the help menu's About dialog shows it, and Sentry tags its
 * events with it when no `VITE_SENTRY_RELEASE` is set. There is no second
 * spelling of the value anywhere in the shell.
 *
 * Where the value comes from — a property of the BUILD, never of the runtime
 * (a server cannot know which console bundle it is serving):
 *
 *  - `VITE_APP_VERSION` in the environment of the build that compiles the app.
 *    This package ships `tsc` output, so its `dist/` still reads
 *    `import.meta.env` and the APP's Vite build replaces it.
 *  - The console app's Vite config (`apps/console/vite.config.ts`) bakes the
 *    variable when it is set, and otherwise the short sha of `HEAD` read from
 *    git at build time, so a local build names its commit too.
 *  - Built with neither, the value is absent and this module answers `null`;
 *    the dialog then says so in words rather than showing an empty field.
 *
 * @module
 */

/** The slice of `import.meta.env` this module reads. */
export interface BuildIdentityEnv {
  readonly VITE_APP_VERSION?: unknown;
}

/**
 * The build identity carried by `env`, or `null` when the build named none.
 *
 * A pure function of its input, split out from {@link getConsoleBuild} for the
 * same reason `resolveSentryGate` is: this repo's Vitest setup cannot put a
 * `VITE_*` value on `import.meta.env`, so the reading is pinned through this.
 * Only a non-empty string counts; whitespace is trimmed.
 */
export function resolveConsoleBuild(env: BuildIdentityEnv | null | undefined): string | null {
  const raw = env?.VITE_APP_VERSION;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/** The build identity this bundle was compiled with, or `null`. */
export function getConsoleBuild(): string | null {
  return resolveConsoleBuild((import.meta as { env?: BuildIdentityEnv }).env);
}
