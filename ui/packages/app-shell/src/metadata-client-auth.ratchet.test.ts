/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Ratchet — MetadataClient must be constructed through the authenticated
 * console factory, never bare.
 *
 * The bug this guards: `MetadataClient` defaults its `fetch` to the bare
 * `globalThis.fetch`, which sends no `Authorization` header. The console
 * authenticates to `/api/v1/*` with a Bearer token in `localStorage`
 * (`auth-session-token`) — there is no session cookie — so a client built on
 * the raw global fetch is unauthenticated and every `/api/v1/meta/*` request
 * comes back `401`. That regressed twice (`useMetadataClient` +
 * `MetadataProvider`'s preview client) and stayed hidden because a same-origin
 * cookie deployment masks it. The fix funnels construction through
 * `createConsoleMetadataClient`, which bakes in `createAuthenticatedFetch`.
 *
 * If this fails: don't write `new MetadataClient(...)` in app-shell. Call
 * `createConsoleMetadataClient(...)` from `views/metadata-admin/
 * metadataClientFactory.ts` so the client carries the Bearer token. Do not
 * allowlist — add the fetch at the one sanctioned construction point.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src
const srcRoot = here;

/** The one file allowed to call `new MetadataClient(` in app-shell. */
const FACTORY = 'views/metadata-admin/metadataClientFactory.ts';
const BARE_CONSTRUCT = /\bnew\s+MetadataClient\s*\(/;

function collectSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(srcRoot);
  return out;
}

describe('MetadataClient authentication ratchet', () => {
  it('scans a plausible number of app-shell source files (guards a broken scan path)', () => {
    expect(collectSourceFiles().length).toBeGreaterThan(100);
  });

  it('constructs MetadataClient only through the authenticated console factory', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles()) {
      const rel = path.relative(srcRoot, file).split(path.sep).join('/');
      if (rel === FACTORY) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (BARE_CONSTRUCT.test(line)) offenders.push(`${rel}:${i + 1} :: ${line.trim()}`);
      });
    }
    // If this fails: route construction through createConsoleMetadataClient so
    // the Bearer token is attached. See metadataClientFactory.ts.
    expect(offenders).toEqual([]);
  });

  it('keeps the sanctioned factory authenticated (Bearer fetch wired in)', () => {
    const factory = readFileSync(path.join(srcRoot, FACTORY), 'utf8');
    // The factory must both construct the client and supply an authenticated
    // fetch — if either disappears the ratchet above would pass vacuously.
    expect(BARE_CONSTRUCT.test(factory)).toBe(true);
    expect(factory).toMatch(/createAuthenticatedFetch/);
    expect(factory).toMatch(/fetch:\s*consoleApiFetch/);
  });
});
