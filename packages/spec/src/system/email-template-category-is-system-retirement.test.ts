// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An email template's `category` and `isSystem` RETIRED (#22876) — ADR-0049
 * enforce-or-remove, the seed of the release's enforce-or-remove batch.
 *
 * Measured before removal, recorded on the tombstones in `email-template.zod.ts`
 * and on the ledger rows: both keys lost their only consumer when ADR-0131
 * D6/D10 retired the projection of declared templates into `sys_email_template`
 * rows (`category` fed a Setup column, `isSystem` the built-in seeder's
 * stand-down). Nothing in this repository read either afterwards, and the
 * Studio console read neither beyond a fallback form input.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Two `retiredKey()` tombstones on `EmailTemplateDefinitionSchema`, a
 *      `strictObject` — so each refusal carries its prescription instead of a
 *      bare unknown-key verdict, and each key's input type is the retired mark
 *      for `tsc`. The `category` enum left with its key.
 *   2. D2 conversion `email-template-category-is-system-removed` (step 18), a
 *      delete of both keys from every `emailTemplates[]` entry, retired from the
 *      load path: a live author is refused, a stored row or a built artifact
 *      replays clean. Both keys carried a DEFAULT, so every template a 17.x
 *      parse emitted carries them — the population this entry exists for.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries both keys, `RETIRED_DEFS_BY_MAJOR[18]`
 *      the enum, and the family's D3 entry is
 *      `email-template-category-is-system-retired`.
 *   4. The liveness rows STAY, `dead`, because a tombstone keeps the key in the
 *      walked shape (`check:liveness` is the judge of that half).
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — that envelope belongs to
 * the authoring door, `defineStack`, which is pinned with its `code` and
 * `status` below. Everywhere else: refusal, the issue `code`, the `path`
 * naming the key, and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyConversions, collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import * as system from './index';
import {
  EmailTemplateDefinitionSchema,
  defineEmailTemplateDefinition,
  type EmailTemplateDefinition,
} from './email-template.zod';

const CONVERSION_ID = 'email-template-category-is-system-removed';
const D3_ID = 'email-template-category-is-system-retired';

/** A well-formed template — the keys an author commonly writes, neither retired one. */
const TEMPLATE = {
  name: 'crm.welcome',
  label: 'Welcome',
  locale: 'en-US',
  subject: 'Welcome, {{user.name}}',
  bodyHtml: '<p>Welcome, {{user.name}}</p>',
} as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const CATEGORY_PRESCRIPTION =
  /`email_template\.category` was removed in @objectstack\/spec 17 \(ADR-0049 enforce-or-remove\) — nothing read it.*Delete the key\. A template is found by its `name`, so group templates with a dotted namespace prefix instead.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;
const IS_SYSTEM_PRESCRIPTION =
  /`email_template\.isSystem` was removed in @objectstack\/spec 17 \(ADR-0049 enforce-or-remove\) — nothing enforced it.*Delete the key\. A built-in template is a code package's declaration.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand\./s;

const RETIRED = [
  { key: 'category', prescription: CATEGORY_PRESCRIPTION, values: ['auth', 'notification', 'workflow', 'marketing', 'custom'] },
  { key: 'isSystem', prescription: IS_SYSTEM_PRESCRIPTION, values: [true, false] },
] as const;

/**
 * A template as a 17.x parse emitted it: both defaults materialized, whether or
 * not the author wrote them — the shape every built artifact and stored row of
 * that line carries.
 */
const emitted17x = () => ({ ...TEMPLATE, category: 'custom', isSystem: false, variables: [], active: true });
/** The built-in auth templates' authored shape before the retirement. */
const builtin17x = () => ({ ...TEMPLATE, name: 'auth.password_reset', category: 'auth', isSystem: true });

describe('email template category / isSystem retirement — the tombstones, at every door that carries a template', () => {
  for (const { key, prescription, values } of RETIRED) {
    it(`the schema refuses \`${key}\` at its path, with the prescription`, () => {
      const r = EmailTemplateDefinitionSchema.safeParse({ ...TEMPLATE, [key]: values[0] });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('invalid_type');
      expect(issue.path).toEqual([key]);
      expect(issue.message).toMatch(prescription);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issue.message.startsWith(`\`email_template.${key}\` was removed`)).toBe(true);
    });

    it(`refuses EVERY value of \`${key}\` — each it used to accept, its old DEFAULT included, and a value of another type`, () => {
      // The default is refused like any other value: the retired-default
      // residue stage is deliberately not adopted (see the retired-key entry),
      // so a materialized default is healed by the D2 conversion, never
      // tolerated at the parse.
      for (const value of [...values, 'x', 0, null, {}]) {
        const r = EmailTemplateDefinitionSchema.safeParse({ ...TEMPLATE, [key]: value });
        expect(r.success, `${key}: ${JSON.stringify(value)}`).toBe(false);
        if (r.success) continue;
        expect(r.error.issues).toHaveLength(1);
        expect(r.error.issues[0]!.path).toEqual([key]);
        expect(r.error.issues[0]!.message).toMatch(prescription);
      }
    });
  }

  it('a template carrying BOTH is refused at both paths — one issue per key, each with its own prescription', () => {
    const r = EmailTemplateDefinitionSchema.safeParse(builtin17x());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path)).toEqual([['category'], ['isSystem']]);
    expect(r.error.issues[0]!.message).toMatch(CATEGORY_PRESCRIPTION);
    expect(r.error.issues[1]!.message).toMatch(IS_SYSTEM_PRESCRIPTION);
  });

  it('the `email_template` write door (the registry binding) refuses both', () => {
    // `getMetadataTypeSchema('email_template')` is what `saveMetaItem` validates
    // a `PUT /api/v1/meta/email_template` body against; a rebinding to some
    // other shape would pass the pins above and still accept the keys.
    const door = getMetadataTypeSchema('email_template');
    expect(door, 'no schema bound for `email_template`').toBeDefined();
    expect(door).toBe(EmailTemplateDefinitionSchema);
    const r = door!.safeParse(emitted17x());
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path)).toEqual([['category'], ['isSystem']]);
  });

  it('`defineEmailTemplateDefinition()` refuses each with its prescription', () => {
    expect(() => defineEmailTemplateDefinition({ ...TEMPLATE, category: 'auth' } as never)).toThrow(CATEGORY_PRESCRIPTION);
    expect(() => defineEmailTemplateDefinition({ ...TEMPLATE, isSystem: true } as never)).toThrow(IS_SYSTEM_PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses them with the STACK_SCHEMA_INVALID envelope — never rewrites them', () => {
    const stack = (template: Record<string, unknown>) => ({
      manifest: { id: 'com.example.email-template-retired', name: 'email_template_retired', version: '1.0.0', type: 'app' },
      emailTemplates: [template],
    });
    let thrown: unknown;
    try {
      defineStack(stack(builtin17x()) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues?.map((i) => i.path)).toEqual([
      ['emailTemplates', 0, 'category'],
      ['emailTemplates', 0, 'isSystem'],
    ]);
    expect(refusal.issues?.[0]?.message).toMatch(CATEGORY_PRESCRIPTION);
    expect(refusal.issues?.[1]?.message).toMatch(IS_SYSTEM_PRESCRIPTION);
    // CONTROL: the same stack without the keys is accepted by the same door.
    expect(() => defineStack(stack({ ...TEMPLATE }) as never)).not.toThrow();
  });

  it('CONTROL: the same template without the keys passes, every live default intact, and grows neither key', () => {
    const r = EmailTemplateDefinitionSchema.safeParse(TEMPLATE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Absence stays absence: a tombstone materializes nothing — which is what
    // takes the dead-property advisory off every parsed template.
    expect(r.data).not.toHaveProperty('category');
    expect(r.data).not.toHaveProperty('isSystem');
    // The live defaults still apply, so the empty reading above is the
    // retirement and not a schema that stopped emitting.
    expect(r.data.active).toBe(true);
    expect(r.data.variables).toEqual([]);
  });

  it('the walked shape keeps both keys — the ledger rows and the authorable-surface rows stay reachable', () => {
    const shape = (EmailTemplateDefinitionSchema as unknown as { shape?: Record<string, unknown> }).shape;
    expect(shape, 'EmailTemplateDefinitionSchema must expose a read-through shape').toBeDefined();
    expect(Object.keys(shape!)).toEqual(expect.arrayContaining(['category', 'isSystem']));
    expect(Object.keys(shape!), 'CONTROL: a live neighbour').toContain('active');
  });

  it('the did-you-mean never offers a tombstone: a near-miss `categry` / `isSytem` is refused as unknown, not steered onto the retired key', () => {
    for (const [typo, retired] of [['categry', 'category'], ['isSytem', 'isSystem']] as const) {
      const r = EmailTemplateDefinitionSchema.safeParse({ ...TEMPLATE, [typo]: 'x' });
      expect(r.success, typo).toBe(false);
      if (r.success) continue;
      const issue = r.error.issues[0]!;
      expect(issue.code).toBe('unrecognized_keys');
      expect(issue.message).toContain(`\`${typo}\``);
      expect(issue.message).not.toContain(`\`${typo}\` → \`${retired}\``);
    }
  });

  it('fails tsc at the authoring site: the input type of each key is the retired mark', () => {
    const withCategory: EmailTemplateDefinition = {
      ...TEMPLATE,
      // @ts-expect-error — `category` is a retiredKey() tombstone: no value is assignable.
      category: 'auth',
    };
    const withIsSystem: EmailTemplateDefinition = {
      ...TEMPLATE,
      // @ts-expect-error — `isSystem` is a retiredKey() tombstone: no value is assignable.
      isSystem: true,
    };
    // The parse channel agrees with the type channel on the same literals.
    expect(() => EmailTemplateDefinitionSchema.parse(withCategory)).toThrow(CATEGORY_PRESCRIPTION);
    expect(() => EmailTemplateDefinitionSchema.parse(withIsSystem)).toThrow(IS_SYSTEM_PRESCRIPTION);
  });

  it('the `category` enum left with its key: `@objectstack/spec/system` exports neither the schema nor its name', () => {
    expect('EmailTemplateDefinitionCategorySchema' in system).toBe(false);
    // CONTROL: the barrel is the real one — its live neighbours are there.
    expect('EmailTemplateDefinitionSchema' in system).toBe(true);
    expect('EmailTemplateDefinitionVariableSchema' in system).toBe(true);
  });
});

describe('email template category / isSystem retirement — the D2 conversion', () => {
  it('a STORED `email_template` row carrying both keys replays clean through the rehydration seam', () => {
    // The seam wraps an `email_template` row as `{ emailTemplates: [row] }` and
    // replays the full chain, retired entries included.
    const notices: { conversionId?: string; path?: string; from?: string; to?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('email_template', emitted17x(), {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => [n.conversionId, n.path, n.from, n.to])).toEqual([
      [CONVERSION_ID, 'emailTemplates[0](crm.welcome).category', 'category', '(removed)'],
      [CONVERSION_ID, 'emailTemplates[0](crm.welcome).isSystem', 'isSystem', '(removed)'],
    ]);
    expect(rehydrated).not.toHaveProperty('category');
    expect(rehydrated).not.toHaveProperty('isSystem');
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual({ ...TEMPLATE, variables: [], active: true });
    // And the rehydrated row is exactly what the write door accepts now.
    expect(EmailTemplateDefinitionSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ emailTemplates: [emitted17x(), builtin17x()] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    const text = JSON.stringify(before.error?.issues ?? []);
    expect(text).toContain('`email_template.category` was removed');
    expect(text).toContain('`email_template.isSystem` was removed');

    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(
      after.success,
      `expected the converted artifact to parse; got ${JSON.stringify(after.error?.issues ?? [])}`,
    ).toBe(true);
  });

  it('LIT CONTROL — a template that was always wrong is refused on BOTH sides of the conversion', () => {
    // `categry` is not a retired key, so the strip leaves it and the door still
    // refuses — which is what makes the leg above a reading and not a tautology.
    const artifact = () => ({ emailTemplates: [{ ...emitted17x(), categry: 'auth' }] });
    expect(ObjectStackDefinitionSchema.safeParse(artifact()).success).toBe(false);
    const healed = applyConversions(artifact(), { includeRetired: true });
    expect(ObjectStackDefinitionSchema.safeParse(healed).success).toBe(false);
  });

  it('strips each key whatever it holds — one notice per KEY — and names each template', () => {
    const input = {
      emailTemplates: [
        { ...TEMPLATE, name: 'a.one', category: 'auth' },
        { ...TEMPLATE, name: 'b.two', isSystem: true },
        { ...TEMPLATE, name: 'c.three', category: 'custom', isSystem: false },
        { ...TEMPLATE, name: 'd.four', category: 7, isSystem: 'yes' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    const mine = notices.filter((n) => n.conversionId === CONVERSION_ID);
    expect(mine.map((n) => n.path)).toEqual([
      'emailTemplates[0](a.one).category',
      'emailTemplates[1](b.two).isSystem',
      'emailTemplates[2](c.three).category',
      'emailTemplates[2](c.three).isSystem',
      'emailTemplates[3](d.four).category',
      'emailTemplates[3](d.four).isSystem',
    ]);
    for (const template of stack.emailTemplates as Record<string, unknown>[]) {
      expect(template).not.toHaveProperty('category');
      expect(template).not.toHaveProperty('isSystem');
      expect(EmailTemplateDefinitionSchema.safeParse(template).success).toBe(true);
    }
  });

  it('strips only the templates that carry a key, and is idempotent by construction', () => {
    const input = {
      emailTemplates: [
        emitted17x(),
        // A template already canonical: no notice, and handed back by reference.
        { ...TEMPLATE, name: 'crm.follow_up' },
      ],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(2);
    const templates = stack.emailTemplates as unknown[];
    expect(templates[1]).toBe(input.emailTemplates[1]);

    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference.
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { emailTemplates: [builtin17x()] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('email template category / isSystem retirement — ADR-0087 registration', () => {
  it('declares both keys under major 18, and the enum as a retired def', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining([
      'system/EmailTemplateDefinition:category',
      'system/EmailTemplateDefinition:isSystem',
    ]));
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => k.startsWith('system/EmailTemplateDefinition:')).sort()).toEqual([
      'system/EmailTemplateDefinition:category',
      'system/EmailTemplateDefinition:isSystem',
    ]);
    expect(RETIRED_DEFS_BY_MAJOR[18]).toContain('system/EmailTemplateDefinitionCategory');
  });

  it('wires the D2 conversion into the step-18 chain as a retired, stamped, lossless strip', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toMatch(/^\d+\.\d+\.\d+$/);
    expect(conversion!.surface).toBe('emailTemplates[].category / emailTemplates[].isSystem');
  });

  it('carries ONE D3 entry for the family, naming its D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries, 'the family needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entry!.replacement).toContain('delete both keys');
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types both keys as the retired
// mark on `EmailTemplateDefinition`, so every TYPED authoring site fails to
// compile (the built-in auth templates and the showcase authored through it).
// The residue is what `tsc` never judges: JSON, YAML, MD/MDX code fences,
// untyped `.js`, and TS literals typed `any` / `unknown` / a record. This walk
// covers that residue across the five repo roots
// `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// The matcher judges the AUTHORING SHAPE, never a mention. `category` and
// `isSystem` are among the commonest keys in the tree (an object's `isSystem`,
// an execution context's `isSystem`, a dozen `category` enums), so a key alone
// proves nothing: an offence is either key at the TOP LEVEL of an object
// literal that also carries `bodyHtml` — the key no other metadata shape
// declares. In code, string and comment contents are masked first (a quoted
// key is kept, for JSON); in YAML, the sibling keys of a mapping that holds
// `bodyHtml`; in MD/MDX, each fenced block by its language. The bound, stated:
// a template assembled by spread, under computed keys, or with its `bodyHtml`
// in a different literal, and `docs/**`, `.claude/**`, `.github/**` and the
// repo-root files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors an email template category / isSystem', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** Either retired key in key position — never the tombstone declaration itself. */
  const RETIRED_KEY = /(^|[\s{,])["']?(category|isSystem)["']?\s*:(?!\s*retiredKey\()/g;
  const BODY_HTML_KEY = /(^|[\s{,])["']?bodyHtml["']?\s*:/g;

  /**
   * Code with string and comment CONTENTS blanked (same length, so offsets
   * hold). A quoted string followed by `:` is a key and is kept — that is how
   * JSON and quoted TS keys stay visible. A template literal is blanked whole,
   * its `${…}` interpolations included: a template is never authored inside one.
   */
  const maskCode = (src: string): string => {
    const out = src.split('');
    const blank = (from: number, to: number) => {
      for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
    };
    let i = 0;
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (c === '/' && next === '/') {
        const end = src.indexOf('\n', i);
        const stop = end === -1 ? src.length : end;
        blank(i, stop);
        i = stop;
      } else if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? src.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        const close = Math.min(j, src.length - 1);
        const isKey = /^\s*:/.test(src.slice(close + 1, close + 40));
        if (!isKey) blank(i + 1, close);
        i = close + 1;
      } else if (c === '`') {
        let j = i + 1;
        let depth = 0;
        while (j < src.length) {
          const d = src[j]!;
          if (d === '\\') { j += 2; continue; }
          if (depth === 0 && d === '`') break;
          if (d === '$' && src[j + 1] === '{') { depth += 1; j += 2; continue; }
          if (depth > 0 && d === '{') depth += 1;
          else if (depth > 0 && d === '}') depth -= 1;
          j += 1;
        }
        blank(i + 1, Math.min(j, src.length));
        i = j + 1;
      } else {
        i += 1;
      }
    }
    return out.join('');
  };

  /** The `{ … }` span enclosing `at` in masked code, or null. */
  const enclosingObject = (code: string, at: number): [number, number] | null => {
    let depth = 0;
    let start = -1;
    for (let k = at - 1; k >= 0; k -= 1) {
      const c = code[k];
      if (c === '}') depth += 1;
      else if (c === '{') {
        if (depth === 0) { start = k; break; }
        depth -= 1;
      }
    }
    if (start === -1) return null;
    depth = 0;
    for (let k = start; k < code.length; k += 1) {
      const c = code[k];
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) return [start, k];
      }
    }
    return null;
  };

  /** Nesting depth of `{[(` between `from` (exclusive) and `to`. */
  const depthBetween = (code: string, from: number, to: number): number => {
    let depth = 0;
    for (let k = from + 1; k < to; k += 1) {
      const c = code[k];
      if (c === '{' || c === '[' || c === '(') depth += 1;
      else if (c === '}' || c === ']' || c === ')') depth -= 1;
    }
    return depth;
  };

  const judgeCode = (src: string): string | null => {
    const code = maskCode(src);
    for (const m of code.matchAll(BODY_HTML_KEY)) {
      const span = enclosingObject(code, m.index! + m[1]!.length);
      if (!span) continue;
      const body = code.slice(span[0], span[1] + 1);
      for (const k of body.matchAll(RETIRED_KEY)) {
        const keyAt = span[0] + k.index! + k[1]!.length;
        if (depthBetween(code, span[0], keyAt) === 0) return `${k[2]} beside bodyHtml`;
      }
    }
    return null;
  };

  /** A YAML mapping that holds `bodyHtml:` and, at the same indentation, either retired key. */
  const judgeYaml = (src: string): string | null => {
    const lines = src.split(/\r?\n/);
    const keyOf = (line: string) => /^([ \t]*(?:-[ \t]+)?)([A-Za-z_][\w]*)[ \t]*:/.exec(line);
    for (let n = 0; n < lines.length; n += 1) {
      const m = keyOf(lines[n]!);
      if (!m || m[2] !== 'bodyHtml') continue;
      const indent = m[1]!.length;
      const sibling = (line: string): string | null => {
        const s = keyOf(line);
        return s && s[1]!.length === indent ? s[2]! : null;
      };
      const ownIndent = (line: string) => /^[ \t]*/.exec(line)![0].length;
      for (const step of [-1, 1]) {
        for (let k = n + step; k >= 0 && k < lines.length; k += step) {
          const line = lines[k]!;
          if (line.trim() === '') continue;
          const s = sibling(line);
          if (s === 'category' || s === 'isSystem') return `${s} beside bodyHtml`;
          // A list item opening this mapping (`- name: …` two columns left).
          const item = /^([ \t]*)-[ \t]+([A-Za-z_]\w*)[ \t]*:/.exec(line);
          if (item && item[1]!.length + 2 === indent) {
            if (item[2] === 'category' || item[2] === 'isSystem') return `${item[2]} beside bodyHtml`;
            if (step === -1) break;
          }
          if (ownIndent(line) < indent && !item) break;
          if (step === 1 && item && item[1]!.length + 2 === indent) break;
        }
      }
    }
    return null;
  };

  const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;
  const judgeMarkdown = (src: string): string | null => {
    for (const m of src.matchAll(FENCE)) {
      const lang = m[1]!.toLowerCase();
      const verdict = lang === 'yaml' || lang === 'yml' ? judgeYaml(m[2]!) : judgeCode(m[2]!);
      if (verdict) return verdict;
    }
    return null;
  };

  const judge = (text: string, ext: string): string | null => {
    if (ext === '.md' || ext === '.mdx') return judgeMarkdown(text);
    if (ext === '.yaml' || ext === '.yml') return judgeYaml(text);
    return judgeCode(text);
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell a retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors both keys to assert their refusal and their conversion.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement template on purpose.
    'packages/spec/src/conversions/',
    // The liveness ledgers key one row per schema PROPERTY: the two rows are a
    // classification of the shape, not an authoring, and the tombstone route
    // requires them to STAY.
    'packages/spec/liveness/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `email-template.zod.ts`.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a mention, another shape\'s key and the tombstone (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("defineEmailTemplateDefinition({ name: 'a.b', category: 'auth', bodyHtml: '<p>x</p>' })", '.ts')).not.toBeNull();
    expect(judge("const t = {\n  name: 'a.b',\n  bodyHtml: '<p>{{x}}</p>',\n  isSystem: true,\n};", '.js')).not.toBeNull();
    expect(judge('{ "emailTemplates": [{ "name": "a.b", "bodyHtml": "<p/>", "category": "custom" }] }', '.json')).not.toBeNull();
    expect(judge('emailTemplates:\n  - name: a.b\n    category: auth\n    bodyHtml: <p>x</p>\n', '.yaml')).not.toBeNull();
    expect(judge('name: a.b\nbodyHtml: <p>x</p>\nisSystem: false\n', '.yml')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefineEmailTemplateDefinition({ bodyHtml: '<p/>', category: 'auth' });\n```\n", '.mdx')).not.toBeNull();
    expect(judge('Prose.\n\n```yaml\nname: a.b\nisSystem: true\nbodyHtml: x\n```\n', '.md')).not.toBeNull();
    // A `{` or a quote inside the body does not hide the sibling key.
    expect(judge("({ bodyHtml: `<p style=\"a\">{{user.name}}'s ${wrap('{')}</p>`, category: 'auth' })", '.ts')).not.toBeNull();
    // Neighbours that must NOT match.
    // The tombstone declaration itself, beside the live `bodyHtml` declaration.
    expect(judge("({ bodyHtml: z.string(), category: retiredKey(EMAIL_TEMPLATE_CATEGORY_REMOVED) })", '.ts')).toBeNull();
    // A nested object's key is not the template's.
    expect(judge("({ bodyHtml: '<p/>', variables: [{ name: 'x', category: 'y' }] })", '.ts')).toBeNull();
    // Another shape's `isSystem` / `category`, with no `bodyHtml` beside it.
    expect(judge("const SYSTEM_CTX = { isSystem: true, positions: [] };", '.ts')).toBeNull();
    expect(judge("fields: { category: Field.select({ options: [] }) }", '.ts')).toBeNull();
    // Mentions: comments, strings, and prose outside a fence.
    expect(judge("// a template once wrote { bodyHtml: '', category: 'auth' }\nconst x = 1;", '.ts')).toBeNull();
    expect(judge("const s = \"{ bodyHtml: '', isSystem: true }\";", '.ts')).toBeNull();
    expect(judge('Delete `category` and `isSystem` from the template; `bodyHtml` stays.', '.mdx')).toBeNull();
    expect(judge('"system/EmailTemplateDefinition:category [RETIRED]",', '.json')).toBeNull();
    // A form section naming the inputs by value, not by key.
    expect(judge("fields: [{ field: 'bodyHtml', required: true }, { field: 'category' }]", '.ts')).toBeNull();
    // YAML: a nested mapping's key is not the template's.
    expect(judge('name: a.b\nbodyHtml: x\nvariables:\n  - name: y\n    category: z\n', '.yaml')).toBeNull();
  });

  it('no email template category / isSystem authoring survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    let bodyHtmlFiles = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined || !text.includes('bodyHtml')) continue;
        bodyHtmlFiles += 1;
        const verdict = judge(text, ext);
        if (verdict) offenders.push(`${rel}: ${verdict}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, the example apps'
    // sources were really read, and the templates the matcher judges were
    // really reached (the built-in auth templates, the showcase, the plugin
    // tests and docs all author `bodyHtml`).
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(bodyHtmlFiles).toBeGreaterThan(20);
    expect(offenders, 'an email template category / isSystem authoring means the retirement is being undone').toEqual([]);
  });
});
