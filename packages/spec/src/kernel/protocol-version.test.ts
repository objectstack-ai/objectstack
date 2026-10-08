// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from './protocol-version';

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

    // ONE exception (ruling record 6049734955 on #22085, Q1 → B; its route,
    // ruling record 6056808625, letter E): in Changesets pre mode with a pending
    // `major` for this package, the protocol major may already equal the major
    // that release is about to publish, so the protocol move lands in an
    // ordinary pull request with full CI instead of inside the version pass.
    // Its evidence is the repository's `.changeset/` directory, which a `local`
    // test may not read (check:cross-package-test-inputs), and this file stays
    // `local` because release.yml's post-version check runs it by that project.
    // So this case recognises the exception's SHAPE only (a stable package
    // version exactly one major behind) and the evidence (pre mode AND a pending
    // `major` for @objectstack/spec) is judged by the repository gate
    // check-changeset-no-major.mjs, which the Check Changeset job runs on every
    // pull request and which refuses the shape without that evidence. Any other
    // drift is red here.
    const preModeShape = PROTOCOL_MAJOR === pkgMajor + 1 && !pkg.version.includes('-');
    if (preModeShape) return;
    expect(PROTOCOL_MAJOR).toBe(pkgMajor);
  });
});
