// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The lockstep's ONE exception, judged on its evidence (ruling record
 * 6049734955 on #22085, Q1 → B).
 *
 * `protocol-version.test.ts` holds `PROTOCOL_VERSION`'s major equal to
 * `@objectstack/spec`'s package major. The ruling moves the protocol major in
 * an ordinary pull request that runs the full CI, not in the version pass, and
 * gives the lockstep exactly one exception: **in Changesets pre mode with a
 * pending `major`, the protocol major may equal the major about to be
 * published.** That window is real: between the pull request that moves the
 * protocol and the first version pass of the new line, the package still reads
 * the old major while the constant already reads the new one.
 *
 * The evidence for that condition is the repository's `.changeset/` directory,
 * so this file lives in the `repo` project, whose turbo task hashes it.
 * `protocol-version.test.ts` stays in `local` (release.yml's post-version check
 * runs it by that project) and defers the one shape it cannot judge to here.
 *
 * Read with `@changesets/cli` v3 semantics, the version this repository pins:
 * `.changeset/pre.json` holds `{ mode, tag }`, and a version pass in pre mode
 * moves each consumed changeset to `.changeset/pre/`. So a pending changeset is
 * a top-level `.changeset/*.md` other than `README.md`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_MAJOR } from './protocol-version';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHANGESET_DIR = resolve(HERE, '../../../../.changeset');
const SPEC_PACKAGE = '@objectstack/spec';

/** What the exception reads from `.changeset/`. */
interface ReleaseState {
  /** `pre.json`'s `mode`, or `null` when the repository is not in pre mode at all. */
  preMode: string | null;
  /** The bump each PENDING changeset declares for `@objectstack/spec`. */
  pendingSpecBumps: readonly string[];
}

/** The bump a changeset's frontmatter declares for one package, or `null`. */
function declaredBump(changeset: string, pkg: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(changeset);
  if (!m) return null;
  for (const line of m[1]!.split(/\r?\n/)) {
    const entry = /^\s*(["']?)([^"':]+)\1\s*:\s*(major|minor|patch|none)\s*$/.exec(line);
    if (entry && entry[2] === pkg) return entry[3]!;
  }
  return null;
}

/** Semver's `major` increment, as Changesets applies it: a `N.0.0-pre` version stays on `N`. */
function majorAfterMajorBump(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!m) throw new Error(`not a semver version: '${version}'`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return m[4] && minor === 0 && patch === 0 ? major : major + 1;
}

/** The protocol major a tree at `packageVersion` in `state` may declare. */
function allowedProtocolMajor(packageVersion: string, state: ReleaseState): number {
  const pkgMajor = Number.parseInt(packageVersion.split('.')[0]!, 10);
  const preModeWithPendingMajor = state.preMode === 'pre' && state.pendingSpecBumps.includes('major');
  return preModeWithPendingMajor ? majorAfterMajorBump(packageVersion) : pkgMajor;
}

/** This repository's release state, read off `.changeset/`. */
function liveReleaseState(): ReleaseState {
  const prePath = join(CHANGESET_DIR, 'pre.json');
  const preMode = existsSync(prePath)
    ? ((JSON.parse(readFileSync(prePath, 'utf8')) as { mode?: string }).mode ?? null)
    : null;
  const pendingSpecBumps = readdirSync(CHANGESET_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name.toLowerCase() !== 'readme.md')
    .map((e) => declaredBump(readFileSync(join(CHANGESET_DIR, e.name), 'utf8'), SPEC_PACKAGE))
    .filter((b): b is string => b !== null);
  return { preMode, pendingSpecBumps };
}

const ABSENT: ReleaseState = { preMode: null, pendingSpecBumps: [] };

describe('PROTOCOL_VERSION lockstep — the pre-mode exception', () => {
  it('the failing case: protocol 18 against package 17 stays red when the condition is absent', () => {
    expect(allowedProtocolMajor('17.7.0', ABSENT)).toBe(17);
    expect(allowedProtocolMajor('17.7.0', ABSENT)).not.toBe(18);
  });

  it('opens only on BOTH halves: pre mode AND a pending major for this package', () => {
    // Pre mode alone (a minor prerelease line) does not move the major.
    expect(allowedProtocolMajor('17.7.0', { preMode: 'pre', pendingSpecBumps: ['minor', 'patch'] })).toBe(17);
    // A pending major outside pre mode is the version pass's own move (the
    // version script syncs the constant there), never this exception.
    expect(allowedProtocolMajor('17.7.0', { preMode: null, pendingSpecBumps: ['major'] })).toBe(17);
    // `pre exit` has left pre mode.
    expect(allowedProtocolMajor('17.7.0', { preMode: 'exit', pendingSpecBumps: ['major'] })).toBe(17);
    // Both halves: the major that release is about to publish.
    expect(allowedProtocolMajor('17.7.0', { preMode: 'pre', pendingSpecBumps: ['major'] })).toBe(18);
  });

  it('never reaches past the next major: once the line has opened, a further major stays on it', () => {
    // After the first version pass the package is already `18.0.0-next.0`;
    // Changesets keeps a further major on 18, so the exception widens nothing.
    expect(allowedProtocolMajor('18.0.0-next.0', { preMode: 'pre', pendingSpecBumps: ['major'] })).toBe(18);
    expect(allowedProtocolMajor('18.0.0-next.0', { preMode: 'pre', pendingSpecBumps: [] })).toBe(18);
  });

  it('reads a changeset frontmatter the way the marker is written', () => {
    const marker = '---\n"@objectstack/spec": major\n---\n\nThe v18 line opens.\n';
    expect(declaredBump(marker, SPEC_PACKAGE)).toBe('major');
    expect(declaredBump("---\n'@objectstack/spec': major\n---\n", SPEC_PACKAGE)).toBe('major');
    expect(declaredBump('---\n"@objectstack/cli": major\n---\n', SPEC_PACKAGE)).toBeNull();
    expect(declaredBump('no frontmatter\n"@objectstack/spec": major\n', SPEC_PACKAGE)).toBeNull();
  });

  it('this tree: PROTOCOL_MAJOR equals the major its release state allows', () => {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    const state = liveReleaseState();
    expect(
      PROTOCOL_MAJOR,
      `@objectstack/spec@${pkg.version}, pre mode: ${state.preMode ?? 'absent'}, pending ` +
        `@objectstack/spec bumps: [${state.pendingSpecBumps.join(', ')}]`,
    ).toBe(allowedProtocolMajor(pkg.version, state));
  });
});
