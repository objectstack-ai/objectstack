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
    expect(PROTOCOL_MAJOR).toBe(pkgMajor);
  });
});
