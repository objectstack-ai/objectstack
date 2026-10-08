// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from './protocol-version';

/** The `repo`-project file that judges the pre-mode exception (see the lockstep case). */
const PRE_MODE_CHECK = 'src/kernel/protocol-version-pre-mode.test.ts';

describe('PROTOCOL_VERSION', () => {
  it('is a valid semver string', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes the parsed major', () => {
    expect(PROTOCOL_MAJOR).toBe(Number.parseInt(PROTOCOL_VERSION.split('.')[0]!, 10));
    expect(Number.isInteger(PROTOCOL_MAJOR)).toBe(true);
  });

  it('stays in lockstep with the package major (no drift)', () => {
    // The protocol major MUST equal the published @objectstack/spec major, so
    // the handshake a package declares (`engines.protocol: '^N'`) matches the
    // version it actually installed. If this fails, bump PROTOCOL_VERSION in
    // the same change as the package version.
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    const pkgMajor = Number.parseInt(pkg.version.split('.')[0]!, 10);
    if (PROTOCOL_MAJOR === pkgMajor) return;

    // ONE exception (ruling record 6049734955 on #22085, Q1 → B): in Changesets
    // pre mode with a pending `major` for this package, the protocol major may
    // already equal the major that release is about to publish, so the protocol
    // move lands in an ordinary pull request with full CI instead of inside the
    // version pass. Its evidence is the repository's `.changeset/` directory,
    // which this `local` task does not hash (the #16466 split), and this file
    // stays `local` because release.yml's post-version check runs it there by
    // that project. So the exception is JUDGED in `PRE_MODE_CHECK`, in the
    // `repo` project, and this case only recognises its shape: a stable package
    // version exactly one major behind. Any other drift is red here.
    const preModeShape = PROTOCOL_MAJOR === pkgMajor + 1 && !pkg.version.includes('-');
    if (preModeShape) {
      // The hand-off must point at a check that runs: the `repo` project's
      // include list is this package's own `vitest.repo-tests.json`.
      const listPath = fileURLToPath(new URL('../../vitest.repo-tests.json', import.meta.url));
      const repoTests = JSON.parse(readFileSync(listPath, 'utf8')) as string[];
      expect(
        repoTests,
        `PROTOCOL_VERSION ${PROTOCOL_VERSION} is one major ahead of @objectstack/spec@${pkg.version}; ` +
          `only ${PRE_MODE_CHECK} (repo project) can confirm the pre-mode exception, and it is not listed`,
      ).toContain(PRE_MODE_CHECK);
      return;
    }
    expect(PROTOCOL_MAJOR).toBe(pkgMajor);
  });
});
