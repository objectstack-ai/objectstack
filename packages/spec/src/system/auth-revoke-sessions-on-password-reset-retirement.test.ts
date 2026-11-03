// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `EmailAndPasswordConfig.revokeSessionsOnPasswordReset` RETIRED (#29909) —
 * ADR-0049 enforce-or-remove, by the maintainer's ruling on that card: a
 * completed self-service password reset always ends every session the account
 * holds, and there is no setting. plugin-auth made the behaviour unconditional
 * first (it sets better-auth's own option itself and refused an explicit
 * `false`), which left the key able to hold one value only.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `EmailAndPasswordConfigSchema`, so the
 *      refusal carries its prescription and a typed configuration fails `tsc`.
 *      The prescription is exported (`REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED`)
 *      because plugin-auth, which takes its configuration unparsed, answers a
 *      host's object with the same text.
 *   2. `RETIRED_KEYS_BY_MAJOR[18]` carries the key and the D3 record is
 *      `email-and-password-revoke-sessions-on-reset-retired`. No D2 conversion:
 *      host plugin configuration, not a stack collection member or a stored row.
 *   3. A tree-scoped absence scan over the authored spelling.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (this schema has no authoring
 * door of its own), so these pins assert refusal, the issue `code`, the `path`
 * and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import {
  AuthConfigSchema,
  EmailAndPasswordConfigSchema,
  REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED,
  type EmailAndPasswordConfig,
} from './auth-config.zod';

const KEY = 'revokeSessionsOnPasswordReset';
const D3_ID = 'email-and-password-revoke-sessions-on-reset-retired';

const PRESCRIPTION =
  /^`emailAndPassword\.revokeSessionsOnPasswordReset` was removed in @objectstack\/spec 18 \(ADR-0049 enforce-or-remove\) — it could hold only one value: a completed password reset always ends every session the account holds, on every reset door, and no setting turns that off\. Delete the key; nothing replaces it\.$/;

/** A well-formed block — the keys a host commonly writes, not the retired one. */
const BLOCK = { enabled: true, minPasswordLength: 12, autoSignIn: false } as const;

describe('revokeSessionsOnPasswordReset retirement — the tombstone', () => {
  it('the exported prescription is the house sentence, and carries no tracker number or migrate-tool promise', () => {
    expect(REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED).toMatch(PRESCRIPTION);
    expect(REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED).not.toMatch(/#\d{3,}/);
    // No conversion covers host configuration, so the text must not promise one.
    expect(REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED).not.toMatch(/os migrate meta/);
  });

  for (const value of [true, false, 'false', 0, null, {}]) {
    it(`the schema refuses ${JSON.stringify(value)} at the key, with the prescription`, () => {
      const r = EmailAndPasswordConfigSchema.safeParse({ ...BLOCK, [KEY]: value });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual([KEY]);
      expect(issue.message).toBe(REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED);
    });
  }

  it('the whole auth configuration refuses it at the nested path', () => {
    const r = AuthConfigSchema.safeParse({ emailAndPassword: { ...BLOCK, [KEY]: true } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === `emailAndPassword.${KEY}`);
    expect(issue, JSON.stringify(r.error.issues)).toBeDefined();
    expect(issue!.message).toMatch(PRESCRIPTION);
    // CONTROL: the same configuration without the key is accepted.
    expect(AuthConfigSchema.safeParse({ emailAndPassword: { ...BLOCK } }).success).toBe(true);
  });

  it('CONTROL: the block without the key passes, live keys intact, and grows no key', () => {
    const r = EmailAndPasswordConfigSchema.safeParse(BLOCK);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty(KEY);
    expect(r.data).toEqual(BLOCK);
    // An explicit `undefined` is absence, as on every tombstone.
    expect(EmailAndPasswordConfigSchema.safeParse({ ...BLOCK, [KEY]: undefined }).success).toBe(true);
  });

  it('fails tsc at the authoring site: the input type of the key is the retired mark', () => {
    const withTrue: EmailAndPasswordConfig = {
      ...BLOCK,
      // @ts-expect-error — `revokeSessionsOnPasswordReset` is a retiredKey() tombstone: no value is assignable.
      revokeSessionsOnPasswordReset: true,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => EmailAndPasswordConfigSchema.parse(withTrue)).toThrow(/`emailAndPassword\.revokeSessionsOnPasswordReset` was removed in @objectstack\/spec 18/);
  });

  it('the walked shape keeps the key — the authorable-surface row stays reachable as [RETIRED]', () => {
    const shape = (EmailAndPasswordConfigSchema as unknown as { unwrap?: () => { shape?: Record<string, unknown> } })
      .unwrap?.()?.shape;
    expect(shape, 'EmailAndPasswordConfigSchema must unwrap to a read-through shape').toBeDefined();
    expect(Object.keys(shape!)).toContain(KEY);
    expect(Object.keys(shape!), 'CONTROL: a live neighbour').toContain('minPasswordLength');
  });
});

describe('revokeSessionsOnPasswordReset retirement — ADR-0087 registration', () => {
  it('declares the key under major 18', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain(`system/EmailAndPasswordConfig:${KEY}`);
  });

  it('carries one D3 entry, which judges no conversion, and no D2 conversion names the key', () => {
    const entry = MIGRATIONS_BY_MAJOR[18].semantic.find((m) => m.id === D3_ID);
    expect(entry, `D3 entry ${D3_ID} is not registered in step 18`).toBeDefined();
    expect(entry!.surface).toMatch(/emailAndPassword\.revokeSessionsOnPasswordReset/);
    expect(entry!.replacement).toMatch(/delete the key/i);
    expect(entry!.reason.length).toBeGreaterThan(0);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(entry!.conversionIds).toBeUndefined();
    // No D2 by design: nothing in a stack or a stored row carries the key.
    expect(ALL_CONVERSIONS.length).toBeGreaterThan(50); // anti-vacuity: the table is populated
    expect(ALL_CONVERSIONS.filter((c) => JSON.stringify(c).includes(KEY))).toEqual([]);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — the tombstone types the key as the retired
// mark on `EmailAndPasswordConfig`, so every TYPED authoring site fails to
// compile. The residue is what `tsc` never judges: JSON, YAML, MD/MDX, untyped
// `.js`, and TS literals typed `any` / `unknown` / a record — the shape a host
// configuration handed to the auth plugin usually has. This walk covers that
// residue across the roots `scripts/cross-package-test-inputs.mjs` already
// declares for `@objectstack/spec` (the #15513 pin's rows, mirrored in
// `turbo.json`): `packages/` per extension, `examples/` for the non-code
// extensions plus each app's `src/` tree, and `skills/`, `content/`, `scripts/`.
//
// The key name is unique to this setting (better-auth's option of the same
// name aside — see the exclusions), so the matcher is the key in KEY POSITION
// (`revokeSessionsOnPasswordReset:` or its quoted JSON form), with comment
// contents masked in code; the tombstone declaration itself
// (`: retiredKey(`) is never an offence. Excluded, each for its reason:
//   - this file, which writes the key to prove the refusal;
//   - plugin-auth's `password-reset-ends-sessions.test.ts`, which writes it as
//     a host's input to prove the plugin's refusal;
//   - plugin-auth's `auth-manager-auth-instance.ts`, which writes
//     better-auth's OWN option of that name into better-auth's configuration —
//     the mechanism of the rule, never read from a host;
//   - `**/CHANGELOG.md`, release-owned history of what shipped.
// The bound, stated: a key assembled under a computed name, and `docs/**`,
// `.claude/**`, `.github/**` and the repo-root files are outside this walk.
describe('tree-scoped absence: nothing inside the declared radius still writes emailAndPassword.revokeSessionsOnPasswordReset', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const CODE_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const EXCLUDED = new Set([
    THIS_FILE,
    'packages/plugins/plugin-auth/src/password-reset-ends-sessions.test.ts',
    'packages/plugins/plugin-auth/src/auth-manager-auth-instance.ts',
  ]);

  const IN_KEY_POSITION = /(^|[\s{,(])["']?revokeSessionsOnPasswordReset["']?\s*:(?!\s*retiredKey\()/g;

  /** Code with `//` and block-comment CONTENTS blanked, offsets kept. */
  const maskComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead: string) => lead + ' '.repeat(m.length - lead.length));

  const walk = (dir: string, out: string[]) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (!SKIPPED_DIRS.has(ent.name)) walk(path.join(dir, ent.name), out);
      } else if (ent.isFile()) {
        out.push(path.join(dir, ent.name));
      }
    }
  };

  const files = (): string[] => {
    const all: string[] = [];
    for (const root of WALK_ROOTS) {
      const abs = path.join(REPO_ROOT, root);
      if (fs.existsSync(abs)) walk(abs, all);
    }
    return all
      .map((abs) => path.relative(REPO_ROOT, abs).split(path.sep).join('/'))
      .filter((rel) => {
        const ext = path.extname(rel);
        if (!SCANNED_EXT.has(ext)) return false;
        if (rel.startsWith('examples/')) return EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel);
        return true;
      });
  };

  it('no file writes the retired key', () => {
    const scanned = files();
    // Anti-vacuity: the walk reached the trees it claims, including the file
    // that declares the tombstone and the plugin that refuses the key.
    expect(scanned.length).toBeGreaterThan(1000);
    expect(scanned).toContain('packages/spec/src/system/auth-config.zod.ts');
    expect(scanned).toContain('packages/plugins/plugin-auth/src/password-reset-ends-sessions.ts');

    const offences: string[] = [];
    for (const rel of scanned) {
      if (EXCLUDED.has(rel) || rel.endsWith('/CHANGELOG.md')) continue;
      const raw = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      if (!raw.includes('revokeSessionsOnPasswordReset')) continue;
      const text = CODE_EXT.has(path.extname(rel)) ? maskComments(raw) : raw;
      for (const m of text.matchAll(IN_KEY_POSITION)) {
        const line = text.slice(0, m.index).split('\n').length;
        offences.push(`${rel}:${line}`);
      }
    }
    expect(offences, 'delete the key at each site: a completed password reset always ends every session').toEqual([]);
  });

  it('LIT CONTROL: the matcher finds the authored spellings and passes the tombstone and prose', () => {
    const hits = (s: string) => [...s.matchAll(IN_KEY_POSITION)].length;
    expect(hits('emailAndPassword: { revokeSessionsOnPasswordReset: true }')).toBe(1);
    expect(hits('{ "revokeSessionsOnPasswordReset": false }')).toBe(1);
    expect(hits('emailAndPassword:\n  revokeSessionsOnPasswordReset: false')).toBe(1);
    expect(hits('  revokeSessionsOnPasswordReset: retiredKey(X),')).toBe(0);
    expect(hits('the `emailAndPassword.revokeSessionsOnPasswordReset` key')).toBe(0);
    expect(hits(maskComments('// revokeSessionsOnPasswordReset: true'))).toBe(0);
    // Each excluded file still exists, so an exclusion cannot outlive its reason.
    for (const rel of EXCLUDED) expect(fs.existsSync(path.join(REPO_ROOT, rel)), rel).toBe(true);
  });
});
