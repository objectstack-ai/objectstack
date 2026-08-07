// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ownership of `packages/spec/json-schema/` — the one output directory two
 * generators write into — and the clearing rule that stops them deleting each
 * other's work (#5371).
 *
 * `gen:schema` (`scripts/build-schemas.ts`) emits `<category>/<Name>.json` plus
 * the bundled `objectstack.json`. `gen:openapi` (`scripts/build-openapi.ts`)
 * emits exactly one file into the same directory: `openapi.json`. Neither
 * generator has a gate — `check:generated` prints `Generated but ungated (2):
 * gen:openapi, gen:sbom` on every run — and the whole tree is gitignored, so
 * nothing in this repo notices when one of these files goes missing.
 *
 * Until #5371 `build-schemas.ts` opened by removing the directory ITSELF
 * (`fs.rmSync(OUT_DIR, { recursive: true })`), which took `openapi.json` with
 * it. `pnpm build` hides the damage because it runs `gen:schema && gen:openapi`
 * in that order, so the artifact is always rewritten last — but every OTHER
 * entry point stops halfway. `check:authorable-surface` runs
 * `build-schemas.ts --check` in place; `check:generated` runs that gate;
 * `check:docs` used to open with `gen:schema`. The result was an agent's
 * verification loop that starts with a green `@objectstack/rest` suite, runs a
 * command whose name says `check:`, and finds 5–12 tests red with `expected 503
 * to be 200` — because `loadOpenApiSpec()`, in a package three directories
 * away, can no longer find a file a *check* deleted. Reported four separate
 * times (#5371 itself, then in the middle of #5126, #5588 and #5672), each one
 * costing a full attribution lap against a diff that had nothing to do with it.
 *
 * So the rule is ownership: a generator clears its own outputs and leaves
 * whatever a SIBLING generator declares here alone.
 *
 * ## Why the exclusion is a deny-list, not an allow-list
 *
 * "Clear only the paths I emit" reads like the more literal spelling of
 * ownership, and it is the one shape that quietly breaks what the clean is
 * FOR. The category folders are derived from `build-schemas.ts`'s own
 * `Protocol` map, so the day a namespace leaves that map its folder also leaves
 * the allow-list — and the stale `json-schema/<gone>/` tree then survives every
 * future build and ships in the published package (`json-schema` is in spec's
 * `files` whitelist) indefinitely. A deny-list keeps the sweep total, which is
 * what "no stale files remain" has always meant here, and admits exactly the
 * artifacts another generator has DECLARED below — nothing implicit, nothing
 * inherited from a name pattern.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The single file `gen:openapi` writes into `json-schema/`.
 *
 * `build-openapi.ts` imports this name rather than spelling it again, so the
 * registry below cannot drift from the generator it protects: renaming the
 * artifact moves the declaration with it, instead of leaving a deny-list entry
 * that names a file nobody writes any more.
 */
export const OPENAPI_ARTIFACT_NAME = 'openapi.json';

/**
 * Artifacts living under `json-schema/` that belong to a generator OTHER than
 * `build-schemas.ts`, mapped to the command that owns each one.
 *
 * Matched by exact top-level entry name — a nested path is part of whatever
 * top-level entry contains it, and no entry here may be a directory another
 * generator merely writes *into* (that would hand it the whole subtree's
 * staleness). Adding an entry is a deliberate act: it exempts real bytes from
 * the clean, so the next reader must be able to see, from this line alone,
 * which command puts them back.
 */
export const FOREIGN_JSON_SCHEMA_ARTIFACTS: ReadonlyMap<string, string> = new Map([
  [OPENAPI_ARTIFACT_NAME, 'gen:openapi (packages/spec/scripts/build-openapi.ts)'],
]);

export interface ClearOwnedOutputsOptions {
  /** Attempts per entry before giving up on it and reporting. Default 1. */
  maxAttempts?: number;
  /** Back-off base in ms, multiplied by the attempt number. Default 100. */
  retryDelayBaseMs?: number;
  /**
   * Blocking sleep between attempts. Defaults to a no-op so unit tests cost no
   * wall-clock time; `build-schemas.ts` passes its own `sleepSync`.
   */
  sleep?: (ms: number) => void;
  /** Reporter for an entry that survived every attempt. Default: silent — the caller decides how loud a stuck file is. */
  onUnremovable?: (entry: string, error: unknown) => void;
}

export interface ClearOwnedOutputsResult {
  /** Top-level entries this generator removed, in directory order. */
  removed: string[];
  /** Top-level entries left in place because `FOREIGN_JSON_SCHEMA_ARTIFACTS` declares another owner. */
  preserved: string[];
  /** Top-level entries that survived every attempt — a real failure, not an exemption. */
  failed: string[];
}

/**
 * Remove everything under `outDir` except the artifacts
 * `FOREIGN_JSON_SCHEMA_ARTIFACTS` declares, leaving `outDir` itself in place.
 *
 * The retry shape is the one `build-schemas.ts` has carried since its CI
 * filesystem races: `rmSync` with its own `maxRetries`, then an outer
 * attempt loop with linear back-off, and a report rather than a throw when an
 * entry is still there — a build that cannot delete one stale file is better
 * off regenerating over it than refusing to run at all.
 */
export function clearOwnedOutputs(
  outDir: string,
  options: ClearOwnedOutputsOptions = {},
): ClearOwnedOutputsResult {
  const {
    maxAttempts = 1,
    retryDelayBaseMs = 100,
    sleep = () => {},
    onUnremovable,
  } = options;

  const result: ClearOwnedOutputsResult = { removed: [], preserved: [], failed: [] };
  if (!fs.existsSync(outDir)) return result;

  for (const entry of fs.readdirSync(outDir)) {
    if (FOREIGN_JSON_SCHEMA_ARTIFACTS.has(entry)) {
      result.preserved.push(entry);
      continue;
    }

    const target = path.join(outDir, entry);
    let lastError: unknown;
    for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt++) {
      try {
        fs.rmSync(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: retryDelayBaseMs * 2,
        });
        if (!fs.existsSync(target)) break;
      } catch (error) {
        lastError = error;
      }
      // Still there (or it threw). Back off before the next attempt; the last
      // iteration falls straight through to the verdict below.
      if (attempt < Math.max(1, maxAttempts) - 1) sleep(retryDelayBaseMs * (attempt + 1));
    }

    if (fs.existsSync(target)) {
      result.failed.push(entry);
      onUnremovable?.(entry, lastError);
    } else {
      result.removed.push(entry);
    }
  }

  return result;
}
