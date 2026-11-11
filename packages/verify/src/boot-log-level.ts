// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How loud a `bootStack` boot is: the kernel logger's level, and the level of
 * the ObjectQL registry's own `[Registry] …` lines.
 *
 * ## Why `warn` by default
 *
 * `bootStack` is what a project's `pnpm test` and `os verify` boot. Both are
 * commands a person runs after every edit and reads for one answer: did it
 * pass. At the kernel logger's own default (`info`) a passing boot of the
 * blank starter printed 346 INFO lines, and `os verify` added 263
 * `[Registry] …` lines on top. A green run that scrolls like a red one teaches
 * people to stop reading the output, which is the opposite of what a verifier
 * is for.
 *
 * So the boot runs at `warn`, the level `objectstack serve` defaults to
 * (`DEFAULT_LOG_LEVEL` in the CLI's `utils/log-level.ts`): warnings and errors
 * still print, every one of them, and a failing run still prints its failure,
 * because a test's failure and verify's report are not log lines. What goes is
 * the per-plugin, per-service and per-item chatter.
 *
 * ## How to get the whole boot log back
 *
 * `OS_LOG_LEVEL` (and its legacy name `LOG_LEVEL`), the variable `serve`,
 * `dev` and `start` read: `OS_LOG_LEVEL=info` or `OS_LOG_LEVEL=debug`. An
 * unrecognised value falls back to `warn`, as it does for `serve`, so a typo
 * never stops a boot. The registry follows the same level unless
 * `OS_REGISTRY_LOG`, its own variable, says otherwise.
 */

import { readEnvWithDeprecation } from '@objectstack/types';

/** The kernel logger's levels, quietest last. */
export const BOOT_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type BootLogLevel = (typeof BOOT_LOG_LEVELS)[number];

/** The level a boot runs at when nothing is configured. */
export const DEFAULT_BOOT_LOG_LEVEL: BootLogLevel = 'warn';

/** The ObjectQL registry's levels (`RegistryLogLevel`): the kernel's, without `fatal`. */
export type RegistryBootLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * The level this boot's kernel logger runs at: `OS_LOG_LEVEL` (or the legacy
 * `LOG_LEVEL`) when it names a level, otherwise {@link DEFAULT_BOOT_LOG_LEVEL}.
 */
export function resolveBootLogLevel(): BootLogLevel {
  const raw = (readEnvWithDeprecation('OS_LOG_LEVEL', 'LOG_LEVEL', { silent: true }) ?? '').toLowerCase().trim();
  return (BOOT_LOG_LEVELS as readonly string[]).includes(raw) ? (raw as BootLogLevel) : DEFAULT_BOOT_LOG_LEVEL;
}

/**
 * The registry level matching a kernel level. The registry has no `fatal`;
 * its nearest quieter level that still prints a fatal-class line is `error`.
 */
export function registryLevelFor(level: BootLogLevel): RegistryBootLogLevel {
  return level === 'fatal' ? 'error' : level;
}

/**
 * Hold `OS_REGISTRY_LOG` at `level` while the kernel boots, and hand back the
 * function that puts it back.
 *
 * The registry has a level setter, but no seam reaches it before it speaks: it
 * is built inside `ObjectQLPlugin.init()` and reads `OS_REGISTRY_LOG` in its
 * constructor, and its first lines come from the same boot phase. So the
 * variable is set for exactly the boot (the same scoped-override shape this
 * harness uses for `OS_TENANCY_POSTURE`), and a value the caller exported is
 * never touched.
 */
export function scopeRegistryLogLevel(level: RegistryBootLogLevel): () => void {
  if (process.env.OS_REGISTRY_LOG !== undefined) return () => {};
  process.env.OS_REGISTRY_LOG = level;
  return () => {
    if (process.env.OS_REGISTRY_LOG === level) delete process.env.OS_REGISTRY_LOG;
  };
}
