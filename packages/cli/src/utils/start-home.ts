// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import os from 'os';
import path from 'path';

/**
 * The home directory `os start` keeps its state in.
 *
 * Priority: `--home` > `$OS_HOME` > `<cwd>/.objectstack` (project mode)
 *         > `~/.objectstack` (global mode)
 *
 * Project mode keeps state next to the source so each project is
 * self-contained and `os start` from another cwd doesn't reuse it.
 *
 * Moved here from `commands/start.ts` unchanged (#29934) so `os dev` can read
 * where an earlier `os start` kept the data key of the same project — see
 * `internal-crypto-key-file-channel.ts`. `env` defaults to `process.env`.
 */
export function resolveStartHome(
  flagValue: string | undefined,
  opts: { hasProjectConfig: boolean; cwd: string; env?: NodeJS.ProcessEnv },
): string {
  const raw = flagValue ?? (opts.env ?? process.env).OS_HOME;
  if (raw && raw.trim().length > 0) {
    const v = raw.trim();
    if (v.startsWith('~')) return path.resolve(os.homedir(), v.slice(1).replace(/^[/\\]/, ''));
    return path.resolve(v);
  }
  if (opts.hasProjectConfig) {
    return path.resolve(opts.cwd, '.objectstack');
  }
  return path.resolve(os.homedir(), '.objectstack');
}
