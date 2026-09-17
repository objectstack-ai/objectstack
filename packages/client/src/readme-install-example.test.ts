// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18058] The published README's install example, parsed against the contract
 * the door it is copied into actually enforces.
 *
 * ## Why this file exists — the fixture that could not fail
 *
 * #18058 fixed `packages/client/README.md`: its `client.packages.install(…)`
 * example was a body the live door answers `400 Package id is required` to —
 * no `id`, no `type`, and a `label` key the closed manifest surface refuses by
 * name. The fix was pinned in `packages/spec/src/api/package-api.test.ts`, but
 * pinned as a HAND-TRANSCRIBED literal: reverting the README to its old text
 * left that suite 56/56 green, because nothing in the repository read the
 * README at all. An acceptance fixture that can drift back to the refused text
 * with nothing turning red is not an acceptance fixture — it is a copy of one.
 *
 * So this test reads the README itself, extracts the object literal a reader
 * would copy, wraps it exactly as `index.ts`'s `packages.install` wraps it on
 * the wire, and parses that. Revert the README and this file goes red; edit
 * the example into something the door refuses and it goes red; and the
 * pre-#18058 literal is pinned as REFUSED beside it so a schema relaxation
 * cannot make the whole thing vacuous.
 *
 * ⛔ The extraction is deliberately loud: a README that no longer contains an
 * `install(` call with an object literal FAILS here rather than silently
 * testing nothing. "Could not run" is a failure, not a skip.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PackageInstallBodySchema } from '@objectstack/spec/api';

/** This package's own published README — `packages/client/README.md`. */
const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

/**
 * The `// Package Management` block, bounded by the next top-level comment
 * group in the same fence. Scoping matters: `install(` also appears in the
 * overwrite line right below the example, and that one passes an identifier.
 */
function packageManagementBlock(source: string): string {
  const start = source.indexOf('// Package Management');
  if (start < 0) throw new Error('packages/client/README.md no longer has a `// Package Management` block');
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\n\n');
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * The first object literal passed to `client.packages.install(` — brace-matched
 * rather than regex-matched, so a nested object in the example cannot truncate
 * it. Throws when the call or the literal is gone.
 */
function firstInstallObjectLiteral(block: string): string {
  const call = block.indexOf('client.packages.install({');
  if (call < 0) {
    throw new Error('the README\'s Package Management block no longer calls `client.packages.install({ … })` with an object literal');
  }
  const open = block.indexOf('{', call);
  let depth = 0;
  for (let i = open; i < block.length; i += 1) {
    if (block[i] === '{') depth += 1;
    else if (block[i] === '}') {
      depth -= 1;
      if (depth === 0) return block.slice(open, i + 1);
    }
  }
  throw new Error('the README\'s install example has an unbalanced object literal');
}

const LITERAL = firstInstallObjectLiteral(packageManagementBlock(README));

/** The literal as a value. It is ordinary JS — single quotes, bare keys. */
const README_MANIFEST = new Function(`return (${LITERAL});`)() as Record<string, unknown>;

/**
 * `index.ts`'s `packages.install` body, spelled out: `manifest`, `settings`,
 * `enableOnInstall`, and `overwrite` only when the caller passed one. This is
 * the body that leaves the process, which is what the door parses.
 */
const asTheSdkSends = (
  manifest: unknown,
  options?: { settings?: Record<string, unknown>; enableOnInstall?: boolean; overwrite?: boolean },
) => ({
  manifest,
  settings: options?.settings,
  enableOnInstall: options?.enableOnInstall,
  ...(options?.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
});

describe('#18058 — the README install example is parsed, not transcribed', () => {
  it('the extraction really found a manifest — this file is not testing an empty object', () => {
    // The non-vacuity guard for the extractor itself: the three keys the
    // pre-#18058 text was missing are exactly the ones a reader needs.
    expect(Object.keys(README_MANIFEST).length).toBeGreaterThanOrEqual(3);
    expect(README_MANIFEST).toHaveProperty('id');
    expect(LITERAL.startsWith('{')).toBe(true);
  });

  it('parses green, wrapped exactly as `packages.install` wraps it on the wire', () => {
    const verdict = PackageInstallBodySchema.safeParse(asTheSdkSends(README_MANIFEST));
    expect(verdict.error?.issues ?? []).toEqual([]);
    expect(verdict.success).toBe(true);
  });

  it('parses green BARE too — `body.manifest || body` is how the door reads it', () => {
    expect(PackageInstallBodySchema.safeParse(README_MANIFEST).success).toBe(true);
  });

  it('the overwrite opt-in beside it parses too', () => {
    expect(PackageInstallBodySchema.safeParse(asTheSdkSends(README_MANIFEST, { overwrite: true })).success).toBe(true);
  });

  it('⛔ the pre-#18058 text is still REFUSED — a schema relaxation cannot make this vacuous', () => {
    // No `id`, no `type`, and `label` is not a manifest key. If this ever turns
    // green the manifest contract was relaxed, not the example fixed.
    const asShipped = { name: 'vendor_plugin', label: 'Vendor Plugin', version: '1.0.0' };
    expect(PackageInstallBodySchema.safeParse(asTheSdkSends(asShipped)).success).toBe(false);
    expect(PackageInstallBodySchema.safeParse(asShipped).success).toBe(false);
  });
});
