// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22640] Every door that serves object rows OUTSIDE the data routes asks the
 * spec's one exposure decision: `apiExposureDenialReason` or its boolean face
 * `canServeApiOperation` (`@objectstack/spec/data`, ADR-0049).
 *
 * The data routes (REST, the runtime dispatcher, MCP) ask it per request. Two
 * other doors were each found reading an object's exposure by hand, or not at
 * all, after the data routes were settled: the analytics door (#22634) and
 * the cross-object search (#22640). Each was fixed in its own package and
 * pinned there by behaviour. This file is the ENUMERATION: it names the doors
 * of that family, holds each one to the decision, and goes red when a new
 * door of the same shape appears without being classified here.
 *
 * ## How a door of this family is found, mechanically
 *
 * A data route gets its read admission from the engine middleware, one object
 * per request. A door that sweeps or joins objects it chose itself (search,
 * analytics) has to decide per object which ones the caller may read, so it
 * asks the `security` service's `canReadObject` itself. That call is the
 * discriminator: every non-test `.ts` source under `packages/` that CALLS
 * `canReadObject` must be classified in {@link CALLERS} below, either as a
 * door (with the file where it asks the exposure decision, and the behaviour
 * pin that holds it) or as something that is not a door (with the reason).
 * An unclassified caller, or a classified file that no longer calls it, turns
 * this red.
 *
 * ⛔ What the discriminator does NOT see, stated rather than discovered later:
 * a door that reads rows without asking `canReadObject` at all, such as one
 * that relies on the engine middleware by passing the caller's context to
 * `find`, or one that reads as the system behind its own token. Read on
 * `origin/main` at cb3bb933, the doors of that kind are the share-link door
 * (`plugin-sharing`, gated by its own opt-in public-sharing policy) and
 * knowledge retrieval (`service-knowledge`, an admin-declared source with no
 * HTTP door in this repository). They are named here, not held.
 *
 * The scan surface and its prefilter follow
 * `operation-private-keys.pin.test.ts` in this directory: git's authored-file
 * list, never a directory crawl, and `.ts` only, the radius this package
 * declares in `scripts/cross-package-test-inputs.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/core/src/security → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');

/** The read-admission method, as data. */
const ADMISSION = 'canReadObject';

/** A CALL of the admission on some receiver: `svc.canReadObject(`, `svc.canReadObject!(`. */
const admissionCall = (): RegExp => new RegExp(`\\.${ADMISSION}!?\\s*\\(`);

/** A CALL of the spec's exposure decision, either face. */
const decisionCall = (): RegExp => /\b(?:apiExposureDenialReason|canServeApiOperation)\s*\(/;

type Classification =
  | {
      kind: 'door';
      /** The door, in words, with the operation it is judged as. */
      door: string;
      operation: 'search' | 'aggregate';
      /** Where the door asks the exposure decision. */
      decisionSite: string;
      /** The behaviour pin that holds the door to it. */
      pin: string;
    }
  | { kind: 'not-a-door'; reason: string };

/** Every non-test caller of the read admission, classified. */
const CALLERS: Record<string, Classification> = {
  'packages/metadata-protocol/src/protocol.ts': {
    kind: 'door',
    door: 'the cross-object search (`GET /search`, `searchAll`)',
    operation: 'search',
    decisionSite: 'packages/metadata-protocol/src/protocol.ts',
    pin: 'packages/metadata-protocol/src/protocol.search-api-exposure.test.ts',
  },
  'packages/services/service-analytics/src/plugin.ts': {
    kind: 'door',
    door: 'the analytics door (`AnalyticsService` query and registration)',
    operation: 'aggregate',
    decisionSite: 'packages/services/service-analytics/src/api-exposure-door.ts',
    pin: 'packages/services/service-analytics/src/__tests__/api-exposure-door.test.ts',
  },
  'packages/plugins/plugin-security/src/security-plugin.ts': {
    kind: 'not-a-door',
    reason: 'the provider: it implements the admission and binds it into the security service it registers; it serves no rows',
  },
};

const SCAN_TIMEOUT_MS = 60_000;

function git(args: string[]): string[] {
  let stdout: string;
  try {
    stdout = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    // `git grep` exits 1 for "found nothing", which is data. Anything else is a
    // broken scan and must not read as "no callers".
    if (failure.status === 1) return [];
    throw new Error(`git ${args.join(' ')} failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`);
  }
  return stdout.split('\0').filter((line) => line.length > 0);
}

const isScannedSource = (path: string) =>
  path.endsWith('.ts') && !path.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(path);

/** Code lines only: a docblock or line comment that names a call is not one. */
const codeLines = (file: string) =>
  readFileSync(join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));

const calls = (file: string, matcher: () => RegExp) => codeLines(file).some((line) => matcher().test(line));

/** Fixed-string prefilter over tracked plus untracked sources; the regex decides. */
function filesMentioningTheAdmission(): string[] {
  return git(['grep', '--files-with-matches', '-z', '--untracked', '--fixed-strings', '-e', ADMISSION, '--', 'packages'])
    .filter(isScannedSource);
}

function admissionCallers(): string[] {
  return filesMentioningTheAdmission().filter((file) => calls(file, admissionCall)).sort();
}

describe('[#22640] every row-serving door outside the data routes asks the exposure decision', () => {
  it(
    'every caller of the read admission is classified, and every classified file still calls it',
    () => {
      const found = admissionCallers();
      const unclassified = found.filter((file) => !(file in CALLERS));
      const stale = Object.keys(CALLERS).filter((file) => !found.includes(file));

      expect(
        unclassified,
        [
          'These sources ask the read admission themselves, which is how a door that serves rows outside',
          'the data routes looks, and this pin does not know them:',
          ...unclassified.map((f) => `  - ${f}`),
          '',
          'Classify each in CALLERS. A door must ask `canServeApiOperation` / `apiExposureDenialReason`',
          '(`@objectstack/spec/data`) for the operation it serves, before any row is read, and carry a',
          'behaviour pin in its own package.',
        ].join('\n'),
      ).toEqual([]);
      expect(stale, 'These classified files no longer call the read admission; re-classify or remove them.').toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'each door asks the decision at its decision site, and its behaviour pin exists',
    () => {
      const doors = Object.values(CALLERS).filter(
        (c): c is Extract<Classification, { kind: 'door' }> => c.kind === 'door',
      );
      expect(doors.map((d) => d.operation).sort()).toEqual(['aggregate', 'search']);

      for (const door of doors) {
        expect(calls(door.decisionSite, decisionCall), `${door.door} does not ask the exposure decision in ${door.decisionSite}`).toBe(true);
        expect(
          readFileSync(join(REPO_ROOT, door.decisionSite), 'utf8'),
          `${door.decisionSite} does not import the decision from the spec`,
        ).toMatch(/from '@objectstack\/spec\/data'/);
        expect(existsSync(join(REPO_ROOT, door.pin)), `the behaviour pin of ${door.door} is missing: ${door.pin}`).toBe(true);
      }
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'the scan cannot pass vacuously: the prefilter reaches every classified file and the matcher fires on each',
    () => {
      const mentioning = filesMentioningTheAdmission();
      for (const file of Object.keys(CALLERS)) {
        expect(mentioning, `the prefilter did not reach ${file}`).toContain(file);
        expect(calls(file, admissionCall), `the call matcher does not fire on ${file}`).toBe(true);
      }
      // The contract DECLARES the method and names it in prose; neither is a call.
      const contract = 'packages/spec/src/contracts/security-service.ts';
      expect(mentioning).toContain(contract);
      expect(calls(contract, admissionCall)).toBe(false);
    },
    SCAN_TIMEOUT_MS,
  );
});
