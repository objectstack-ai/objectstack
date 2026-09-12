// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ── [#17147] The granted permission set is REGISTERED and refuses nothing ──
 *
 * #13457 / PR #17137 gave `PluginPermissionEnforcer.registerGrantedPermissions`
 * its first production caller: `AppPlugin.init()` binds an artifact's
 * install-time `grantedPermissions` to the packages that artifact carries. What
 * it did NOT do — deliberately, and fenced by maintainer ruling `5486840233`,
 * which assigns the per-plugin context to the ADR-0025 install-flow design
 * effort — is make anything QUERY that registry.
 *
 * Maintainer ruling 2026-09-12, option B (the same option ruled for the sibling
 * half of this very sentence in #11330): **say it truthfully now.** Enforcing is
 * a later, separately designed direction. This file is the mechanical half of
 * that ruling — without it, "registered, not enforced" is prose that rots the
 * moment someone edits around it, which is exactly how the retracted sentence
 * ("so `SecurePluginContext` enforces exactly the consented surface") shipped.
 *
 * ## Why the pin asserts the MEASUREMENT as well as the CLAIM
 *
 * A text-only pin can only go red when the text changes, i.e. never on the day
 * the fact changes. So the measurement is pinned too, and it is pinned in the
 * direction that is true TODAY:
 *
 *   • zero production `new SecurePluginContext(` — the construction site that
 *     would turn `enforceServiceAccess` / `enforceHookTrigger` into reachable
 *     gates;
 *   • zero callers of `enforceFileRead` / `enforceFileWrite` /
 *     `enforceNetworkRequest` — the fs and network classes have no enforcement
 *     surface at all, `SecurePluginContext` included, so wiring the context
 *     alone would still leave two of the four grant classes inert.
 *
 * ⇒ The day the materialize seam lands, THIS FILE GOES RED, and its failure
 * message is the handoff: the enforcer docblock, the `manifest.zod.ts`
 * `PluginPermissions` docblock, the `manifest.loading` tombstone, the ADR-0087
 * D3 entry, the hand-written plugin development guide under content/docs/plugins/
 * and objectui's `PluginDisclosure` panel all claim "registered, not enforced"
 * and become the lie in the other direction. ⛔ Do not delete this file to get
 * green — rewrite the texts it names and re-point the assertions.
 *
 * ⚠️ Every repo path in this file is written UNQUOTED, here and below, and that
 * is load-bearing rather than sloppy: check-cross-package-test-inputs reads a
 * QUOTED repo path as an input this package must declare a glob for, and the
 * paths named in this prose are cited, not read. The same note sits on
 * check-partof-closing-keyword.mjs, for the same reason.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/core/src/security → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');

const toRepoPath = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

/** The file that declares the enforcer, the secure context and every gate. */
const HOME = toRepoPath(join(HERE, 'plugin-permission-enforcer.ts'));

/**
 * Generous on purpose: the scan costs tens of milliseconds, but a merge-queue
 * runner doing a full monorepo build at the same time can starve it, and a pin
 * that times out before its assertion reports nothing — indistinguishable from
 * a pin that found nothing.
 */
const SCAN_TIMEOUT_MS = 60_000;

/**
 * ⛔ `.ts` / `.mts` and NOT `.tsx`. The population this pin JUDGES must equal
 * the population turbo RE-RUNS it for, and the second is declared elsewhere:
 * the `@objectstack/core` roster entry in the declaration table at
 * scripts/cross-package-test-inputs.mjs carries exactly `packages/**\/*.ts` and
 * `packages/**\/*.mts`. A scanner wider than that glob judges files neither
 * scoping layer can see. Narrow the SCANNER, never widen the GLOB.
 *
 * This file is also listed in packages/core/vitest.repo-tests.json, which is the
 * `repo` project's include: an escaping test run under the ordinary package task
 * has a cache hash that never moves with what it actually reads.
 */
const PATHSPECS = [':(glob)packages/**/*.ts', ':(glob)packages/**/*.mts'];

function gitGrep(needle: string): string[] {
  let stdout: string;
  try {
    stdout = execFileSync('git', ['grep', '-l', '--fixed-strings', '-z', needle, '--', ...PATHSPECS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    // Exit 1 is "found nothing", which is data. Anything else is a BROKEN scan
    // and must never read as "no offenders" — hence the throw, and hence the
    // positive control below.
    if (failure.status === 1) return [];
    throw new Error(
      `git grep '${needle}' failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`,
    );
  }
  return stdout.split('\0').filter((line) => line.length > 0);
}

const isTest = (path: string) => /\.(test|spec)\.[cm]?tsx?$/.test(path);

describe('[#17147] the install-time granted permission set is registered, not enforced', () => {
  it('the scan can see production source at all (positive control)', () => {
    // Without this, every assertion below is satisfiable by a scan that found
    // nothing because it was pointed at nothing.
    //
    // The needle is CONCATENATED rather than written whole: a literal copy in
    // this file would be a tracked hit of its own, and the control would then
    // be asserting that the scan can see ITSELF — true even if `packages/` were
    // empty. Every other needle below is exempt because `isTest` drops this
    // file from those results; this one compares the raw list.
    expect(gitGrep(`export class ${'Secure'}PluginContext`)).toEqual([HOME]);
  }, SCAN_TIMEOUT_MS);

  it('has ZERO production `SecurePluginContext` construction sites', () => {
    const hits = gitGrep('new SecurePluginContext(');
    const production = hits.filter((p) => !isTest(p));

    expect(
      production,
      'A production construction site now exists ⇒ the per-plugin context (ADR-0025 '
      + 'materialize seam, #17147) has landed and every "registered, not enforced" text '
      + 'is now false. Rewrite them TOGETHER with this pin: '
      + `${HOME} (registerGrantedPermissions docblock), `
      + 'packages/spec/src/kernel/manifest.zod.ts (PluginPermissions docblock AND the '
      + '`manifest.loading` tombstone), '
      + 'packages/spec/src/migrations/entries/semantic/17.plugin-manifest-loading-retired.ts, '
      + 'the hand-written plugin development guide, and the objectui console '
      + 'consent panel (PluginDisclosure).',
    ).toEqual([]);

    // Anti-vacuity: the needle must still match SOMETHING, or a rename has
    // turned this assertion into a scan for a string that no longer exists.
    expect(hits.length, 'the needle matched nothing at all — has the class been renamed?')
      .toBeGreaterThan(0);
  }, SCAN_TIMEOUT_MS);

  it('leaves the fs and network grant classes with no enforcement surface at all', () => {
    // `(`-anchored, so the `{@link enforceFileRead}` references in docblocks do
    // not count as callers. The only non-test hit for each is its own
    // declaration, in the file that declares it — i.e. nobody calls them, not
    // even `SecurePluginContext`, which wires only the service and trigger gates.
    for (const gate of ['enforceFileRead(', 'enforceFileWrite(', 'enforceNetworkRequest(']) {
      const production = gitGrep(gate).filter((p) => !isTest(p));
      expect(
        production,
        `${gate}) acquired a caller ⇒ the fs/network classes are no longer inert and the `
        + 'texts naming them as having "no enforcement surface" must be rewritten.',
      ).toEqual([HOME]);
    }
  }, SCAN_TIMEOUT_MS);

  it('states BOTH halves on `registerGrantedPermissions`, and not the retracted claim', () => {
    const text = readFileSync(join(HERE, 'plugin-permission-enforcer.ts'), 'utf8');

    expect(text).toContain('REGISTERED, NOT ENFORCED');
    expect(text).toMatch(/ZERO production construction\s+\*?\s*sites/);
    // The negative pin. Without it a future edit could re-add the retracted
    // sentence beside the truthful one and every positive assertion above
    // would stay green — the same failure mode #11330 closed on the tier half.
    expect(
      text,
      'the retracted sentence must not come back beside the truthful one',
    ).not.toContain('enforces exactly the consented surface');
  });

  it('registers a grant without gating anything — the behaviour the text describes', async () => {
    // Anti-vacuity for the prose above: assert the FACT, not only the sentence.
    const { createPluginPermissionEnforcer } = await import('./plugin-permission-enforcer.js');
    const logs: string[] = [];
    const logger = {
      info: (m: string) => logs.push(m), warn: () => {}, error: () => {}, debug: () => {},
    } as never;

    const enforcer = createPluginPermissionEnforcer(logger);
    enforcer.registerGrantedPermissions('com.acme.crm', { services: ['object'] });

    // Registered — the registry answers.
    const perms = enforcer.getPluginPermissions('com.acme.crm');
    expect(perms?.canAccessService('object')).toBe(true);
    expect(perms?.canAccessService('http')).toBe(false);

    // …and refusing still requires someone to ASK. The gate exists and works;
    // what does not exist is a production caller — pinned above.
    expect(() => enforcer.enforceServiceAccess('com.acme.crm', 'http')).toThrow(/Permission denied/);
  });
});
