// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Five `objectstack.manifest.json` keys nothing read are RETIRED (#31035,
 * ADR-0049 enforce-or-remove): `name`, `specVersion`, `skills`, `scaffold` and
 * `visibility`.
 *
 * Measured before removal on objectstack 115a43ad: no reader of the file's
 * `name`, `specVersion`, `skills` or `scaffold` existed in `os package
 * publish`, create-objectstack or anywhere else (create-objectstack WROTE
 * `name` and never read it back; the protocol check reads the artifact's
 * `engines.protocol`; the skills install is the whole catalog), and `os
 * package publish` read `visibility` only to warn that it ignores it.
 * `publisher` and `isStarter` were retired afterwards as their own family
 * (maintainer ruling 6708417668, the second half of #31035): both are claims
 * only the platform makes — a trust tier and the starter flag — so a value in
 * an author's file never had an effect. Their pins are the second top-level
 * `describe` below; the tree-scoped scan covers all seven keys.
 *
 * The bookkeeping shape, pinned below: a `retiredKey()` tombstone per key (the
 * schema is not strict, so a bare delete would strip silently), five
 * `RETIRED_KEYS_BY_MAJOR[18]` rows, one D3 semantic entry, no D2 conversion
 * (this file is not a stack collection member — the `category` precedent on
 * the same schema), and a tree-scoped absence scan over every shipped
 * manifest, including the ones `check:template-manifests` does not walk.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status`. Asserted: refusal, the
 * issue `code`, the `path` naming the key, and the prescription's opening.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { TemplateManifestSchema, type TemplateManifest } from './template-manifest.zod';

const RETIRED = ['name', 'specVersion', 'skills', 'scaffold', 'visibility'] as const;
const D3_ID = 'marketplace-template-manifest-inert-keys-retired';
const PLATFORM_DECIDED = ['publisher', 'isStarter'] as const;
const PLATFORM_DECIDED_D3_ID = 'marketplace-template-manifest-platform-decided-keys-retired';

/** A value each key used to accept — the shape an old manifest still carries. */
const OLD_VALUES: Record<(typeof RETIRED)[number], unknown> = {
  name: 'blank',
  specVersion: '^18.0.0',
  skills: ['objectstack-platform'],
  scaffold: { variables: { appName: { type: 'string' } } },
  visibility: 'marketplace',
};

const BASE = { displayName: 'Blank Starter' } as const;

describe('TemplateManifestSchema — five inert keys are retired', () => {
  it.each(RETIRED)('REFUSES `%s` at its own path, carrying the prescription', (key) => {
    const result = TemplateManifestSchema.safeParse({ ...BASE, [key]: OLD_VALUES[key] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === key);
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(
      new RegExp(`^\`TemplateManifest\\.${key}\` was removed in @objectstack/spec 18 \\(ADR-0049\\) — `),
    );
  });

  it('names what to do instead for the two keys whose replacement lives elsewhere', () => {
    const message = (key: string, value: unknown) => {
      const result = TemplateManifestSchema.safeParse({ ...BASE, [key]: value });
      return result.success ? '' : result.error.issues.map((i) => i.message).join('\n');
    };
    expect(message('visibility', 'org')).toContain('--visibility');
    expect(message('specVersion', '^18.0.0')).toContain('engines.protocol');
  });

  it('control: a manifest without them parses', () => {
    expect(TemplateManifestSchema.safeParse({ ...BASE }).success).toBe(true);
    expect(TemplateManifestSchema.safeParse({ ...BASE, readmePath: 'README.md' }).success).toBe(true);
  });

  it('the tsc channel: no value is assignable to a retired key', () => {
    const ok: TemplateManifest = { ...BASE };
    // @ts-expect-error — `name` is a retiredKey() tombstone: no value is assignable.
    const a: TemplateManifest = { ...BASE, name: 'blank' };
    // @ts-expect-error — `specVersion` is a retiredKey() tombstone.
    const b: TemplateManifest = { ...BASE, specVersion: '^18.0.0' };
    // @ts-expect-error — `skills` is a retiredKey() tombstone.
    const c: TemplateManifest = { ...BASE, skills: ['objectstack-platform'] };
    // @ts-expect-error — `scaffold` is a retiredKey() tombstone.
    const d: TemplateManifest = { ...BASE, scaffold: {} };
    // @ts-expect-error — `visibility` is a retiredKey() tombstone on this file.
    const e: TemplateManifest = { ...BASE, visibility: 'org' };
    expect([ok, a, b, c, d, e]).toHaveLength(6);
  });
});

describe('TemplateManifestSchema — the two platform-decided keys are retired', () => {
  const OLD: Record<(typeof PLATFORM_DECIDED)[number], unknown> = { publisher: 'community', isStarter: true };

  it.each(PLATFORM_DECIDED)('REFUSES `%s` at its own path, carrying the prescription', (key) => {
    const result = TemplateManifestSchema.safeParse({ ...BASE, [key]: OLD[key] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === key);
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(
      new RegExp(`^\`TemplateManifest\\.${key}\` was removed in @objectstack/spec 18 \\(ADR-0049\\) — `),
    );
    expect(issue!.message).toContain('Delete the key.');
  });

  it('refuses `isStarter: false` too — no value is accepted, not even the default', () => {
    expect(TemplateManifestSchema.safeParse({ ...BASE, isStarter: false }).success).toBe(false);
  });

  it('the tsc channel: no value is assignable to either key', () => {
    // @ts-expect-error — `publisher` is a retiredKey() tombstone on this file.
    const a: TemplateManifest = { ...BASE, publisher: 'community' };
    // @ts-expect-error — `isStarter` is a retiredKey() tombstone on this file.
    const b: TemplateManifest = { ...BASE, isStarter: true };
    expect([a, b]).toHaveLength(2);
  });
});

describe('ADR-0087 registration', () => {
  it('declares every tombstoned key under major 18', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(
      expect.arrayContaining(RETIRED.map((key) => `marketplace/TemplateManifest:${key}`)),
    );
  });

  it('carries exactly one D3 semantic entry for the family, naming all five keys', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    for (const key of RETIRED) expect(entries[0]!.surface).toContain(`TemplateManifest.${key}`);
    expect(entries[0]!.reason.length).toBeGreaterThan(0);
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('declares the two platform-decided keys under major 18, with their own D3 entry', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(
      expect.arrayContaining(PLATFORM_DECIDED.map((key) => `marketplace/TemplateManifest:${key}`)),
    );
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === PLATFORM_DECIDED_D3_ID);
    expect(entries).toHaveLength(1);
    for (const key of PLATFORM_DECIDED) expect(entries[0]!.surface).toContain(`TemplateManifest.${key}`);
    expect(entries[0]!.reason.length).toBeGreaterThan(0);
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('carries no D2 conversion — this file is not a stack collection member', () => {
    expect(ALL_CONVERSIONS.filter((c) => /TemplateManifest/.test(c.surface)).map((c) => c.id)).toEqual([]);
  });
});

// Tree-scoped absence (the retirement playbook's rule: never file-scoped).
// `check:template-manifests` walks create-objectstack's templates and
// `packages/apps`; this walk covers every `objectstack.manifest.json` under
// `packages/` and `examples/`, so a manifest shipped anywhere else is held too.
//
// Radius, declared in `scripts/cross-package-test-inputs.mjs` under
// `@objectstack/spec`: the `packages/**/*.json` and `examples/**/*.json` rows,
// on which this file is a `heldBy` witness (the walk descends with
// `readdirSync` on a loop variable, so no literal path names the glob).
describe('tree-scoped absence: no shipped objectstack.manifest.json declares a retired key', () => {
  const ALL_RETIRED = [...RETIRED, ...PLATFORM_DECIDED];
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const WALK_ROOTS = ['packages', 'examples'];
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  it('every manifest in the radius omits the seven keys', () => {
    const found: string[] = [];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile() || entry.name !== 'objectstack.manifest.json') continue;
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        found.push(rel);
        const manifest = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        for (const key of ALL_RETIRED) if (key in manifest) offenders.push(`${rel} declares \`${key}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the blank template and the three connector apps at least.
    expect(found).toEqual(expect.arrayContaining(['packages/create-objectstack/src/templates/blank/objectstack.manifest.json']));
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(offenders, 'a retired key in a shipped manifest means the retirement is being undone').toEqual([]);
  });
});
