// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The form field's `publicPicker` RETIRED (#21180) — ADR-0087 D2, immediate
 * retirement, by the maintainer's ruling E on #21079 (comment 5933054144),
 * which reverses the #7467 ruling that had declared the key.
 *
 * The block opted a lookup / `master_detail` / `user` field on an ANONYMOUS
 * public form into a record-search picker served by an unauthenticated route.
 * The ruling retired the capability: anonymous public forms no longer take
 * those three field types, `GET /forms/:slug/lookup/:field` is deleted, and the
 * resolve route strips them from the anonymous rendering unconditionally (the
 * REST half is pinned in `packages/rest/src/public-form-routes.test.ts`).
 *
 * Measured before removal (the card's readings, re-taken on this branch's
 * base): no producer outside spec, tests, docs and the route — no example,
 * template, plugin or first-party UI caller — and objectui at its pin imports
 * neither the key nor the schema.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on `FormFieldBaseSchema` (strict through
 *      `FormFieldSchema`), so the parse carries the prescription instead of a
 *      bare unknown-key verdict and `tsc` types the key `never`.
 *      `FormFieldPublicPickerSchema` and its two types are deleted outright —
 *      nothing else referenced them.
 *   2. D2 conversion `form-field-public-picker-removed` (step 18), a lossless
 *      delete over every form payload's field entries, retired from the load
 *      path: a live author is refused, a stored row replays clean.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/FormField:publicPicker`, and the
 *      family's D3 entry is `form-field-public-picker-retired`.
 *   4. No liveness row moves: the key sat in the undrilled `view/form.sections`
 *      subtree, whose blanket row carries a note recording the removal.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — that envelope belongs to
 * the authoring door, `defineStack`, pinned with its `code` and `status` below.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { FormFieldSchema, FormViewSchema, ViewMetadataSchema, type FormFieldInput } from './view.zod';

/** The block as an author wrote it before the retirement — every key it declared. */
const PICKER = { displayFields: ['name'], maxResults: 10, object: 'crm_contact' };

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const PRESCRIPTION =
  /`view\.form\.sections\[\]\.fields\[\]\.publicPicker` was removed in @objectstack\/spec 17\.6\.0 \(ADR-0087 D2\).*no longer offers record search.*Delete the key.*`select` field with static `options`.*behind sign-in.*Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand\./s;

/** A ViewItem-branch form carrying the given field entries (the `saveMetaItem` door). */
const viewItem = (fields: unknown[]) => ({
  name: 'crm_inquiry.contact',
  object: 'crm_inquiry',
  viewKind: 'form',
  label: 'Contact us',
  config: {
    type: 'simple',
    data: { provider: 'object', object: 'crm_inquiry' },
    sections: [{ label: 'About you', fields }],
    sharing: { allowAnonymous: true, publicLink: '/forms/contact' },
  },
});

describe('form field publicPicker retirement — the tombstone, at every door that carries a form field', () => {
  it('the form field schema refuses `publicPicker` at its path, with the prescription', () => {
    const r = FormFieldSchema.safeParse({ field: 'contact', publicPicker: PICKER });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual(['publicPicker']);
    expect(issue.message).toMatch(PRESCRIPTION);
    // House convention 1: the fully-qualified key, in backticks, opens it.
    expect(issue.message.startsWith('`view.form.sections[].fields[].publicPicker` was removed')).toBe(true);
  });

  it('refuses every value shape, the empty block included — the tombstone accepts only absence', () => {
    for (const value of [{}, PICKER, true, null, 'yes']) {
      const r = FormFieldSchema.safeParse({ field: 'contact', publicPicker: value });
      expect(r.success, `publicPicker: ${JSON.stringify(value)}`).toBe(false);
      if (r.success) continue;
      expect(r.error.issues[0]!.path).toEqual(['publicPicker']);
      expect(r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    }
  });

  it('the code-authored form door (FormViewSchema) refuses it at sections[N].fields[N].publicPicker', () => {
    const r = FormViewSchema.safeParse({
      type: 'simple',
      sections: [{ label: 'About you', fields: ['subject', { field: 'contact', publicPicker: PICKER }] }],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const flat = JSON.stringify(r.error.issues);
    expect(flat).toMatch(PRESCRIPTION);
    expect(flat).toContain('"publicPicker"');
  });

  it('the stored-view write door (ViewMetadataSchema, ViewItem branch) refuses it with the prescription', () => {
    const r = ViewMetadataSchema.safeParse(viewItem(['subject', { field: 'contact', publicPicker: PICKER }]));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toMatch(PRESCRIPTION);
    // CONTROL: the same item without the key is accepted by the same door.
    expect(ViewMetadataSchema.safeParse(viewItem(['subject', { field: 'contact' }])).success).toBe(true);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never rewrites it', () => {
    const stack = (field: Record<string, unknown>) => ({
      manifest: { id: 'com.example.public-picker', name: 'public_picker', version: '1.0.0', type: 'app' },
      objects: [{
        name: 'crm_inquiry',
        label: 'Inquiry',
        fields: {
          subject: { type: 'text', label: 'Subject' },
          contact: { type: 'lookup', label: 'Contact', reference: 'crm_contact' },
        },
      }],
      views: [{
        formViews: {
          contact: {
            type: 'simple',
            data: { provider: 'object', object: 'crm_inquiry' },
            sections: [{ label: 'About you', fields: ['subject', field] }],
            sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/contact' },
          },
        },
      }],
    });
    let thrown: unknown;
    try {
      defineStack(stack({ field: 'contact', publicPicker: PICKER }) as never);
    } catch (e) {
      thrown = e;
    }
    const refusal = thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(JSON.stringify(refusal.issues)).toMatch(PRESCRIPTION);
    // CONTROL: the same stack without the key is accepted by the same door.
    expect(() => defineStack(stack({ field: 'contact' }) as never)).not.toThrow();
  });

  it('CONTROL: the same field without the key parses, and absence stays absence', () => {
    const r = FormFieldSchema.safeParse({ field: 'contact', required: true });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty('publicPicker');
  });

  it('fails tsc at the authoring site: the input type of `publicPicker` is `never`', () => {
    const field: FormFieldInput = {
      field: 'contact',
      // @ts-expect-error — `publicPicker` is a retiredKey() tombstone: its input type is `never`.
      publicPicker: PICKER,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => FormFieldSchema.parse(field)).toThrow(PRESCRIPTION);
  });
});

describe('form field publicPicker retirement — the D2 conversion', () => {
  it('is registered for protocol 18, retired from the load path, stamped with the label it lands on', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === 'form-field-public-picker-removed');
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(entry!.retiredAfter).toBe('17.5.0');
  });

  it('fires on every form payload spelling and every field position, one notice per stripped entry', () => {
    const { stack, notices } = collectConversionNotices(
      {
        views: [
          // Container: the default `form` slot and a named `formViews` entry, with
          // `sections[]`, `groups[]`, top-level `fields[]` and a nested row.
          {
            object: 'crm_inquiry',
            form: { sections: [{ fields: ['subject', { field: 'contact', publicPicker: PICKER }] }] },
            formViews: {
              intake: {
                groups: [{ fields: [{ field: 'account', publicPicker: {} }] }],
                fields: [{ field: 'details', type: 'composite', fields: [{ field: 'owner', publicPicker: PICKER }] }],
              },
            },
          },
          // A ViewItem record — the payload hangs off `config`.
          viewItem([{ field: 'contact', publicPicker: PICKER }]),
        ],
      },
      { includeRetired: true },
    );
    const mine = notices.filter((n) => n.conversionId === 'form-field-public-picker-removed');
    expect(mine.map((n) => n.path).sort()).toEqual([
      'views[0].form.sections[0].fields[1].publicPicker',
      'views[0].formViews.intake.fields[0].fields[0].publicPicker',
      'views[0].formViews.intake.groups[0].fields[0].publicPicker',
      'views[1].config.sections[0].fields[0].publicPicker',
    ]);
    for (const n of mine) {
      expect(n.from).toBe('publicPicker');
      expect(n.to).toBe('(removed)');
    }
    expect(JSON.stringify(stack)).not.toContain('publicPicker');
  });

  it('control: a form without the key is handed back by reference, with no notice — and a list payload is never walked', () => {
    const clean = {
      views: [{
        object: 'crm_inquiry',
        // A LIST payload whose column happens to spell the key is not a form field.
        list: { type: 'grid', columns: [{ field: 'subject', publicPicker: {} }] },
        form: { sections: [{ fields: ['subject', { field: 'contact', required: true }] }] },
      }],
    };
    const { stack, notices } = collectConversionNotices(clean, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === 'form-field-public-picker-removed')).toEqual([]);
    expect(stack).toBe(clean);
  });

  it('is idempotent — the converted result replays to itself with no second notice', () => {
    const once = collectConversionNotices(
      { views: [viewItem([{ field: 'contact', publicPicker: PICKER }])] },
      { includeRetired: true },
    );
    const twice = collectConversionNotices(once.stack, { includeRetired: true });
    expect(twice.notices).toHaveLength(0);
    expect(twice.stack).toBe(once.stack);
  });

  it('a STORED view row carrying the key replays clean through the rehydration seam, and the write door accepts the result', () => {
    const stored = viewItem(['subject', { field: 'contact', publicPicker: PICKER }]);
    // Before: the retired key is refused at parse — the row a pre-retirement
    // author left behind would be badged invalid without the replay.
    expect(ViewMetadataSchema.safeParse(stored).success).toBe(false);
    const converted = applyConversionsToStoredItem('view', stored) as ReturnType<typeof viewItem>;
    expect(converted.config.sections[0]!.fields).toEqual(['subject', { field: 'contact' }]);
    expect(ViewMetadataSchema.safeParse(converted).success).toBe(true);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { views: [viewItem([{ field: 'contact', publicPicker: PICKER }])] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === 'form-field-public-picker-removed')).toHaveLength(0);
    expect(stack).toEqual(input);
  });
});

describe('form field publicPicker retirement — ADR-0087 registration', () => {
  it('declares the key under major 18, wires the D2 into the step-18 chain and carries the family D3 entry', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ui/FormField:publicPicker');
    const step = MIGRATIONS_BY_MAJOR[18]!;
    expect(step.conversionIds).toContain('form-field-public-picker-removed');
    const d3 = step.semantic.find((s) => s.id === 'form-field-public-picker-retired');
    expect(d3, 'the family D3 entry').toBeDefined();
    // The D3 entry names its D2 by its whole id.
    expect(d3!.reason).toContain('`form-field-public-picker-removed`');
    expect(d3!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types the key `never` on
// `FormFieldInput`, so every typed authoring site fails to compile. The residue
// is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`,
// and TS literals typed `unknown` (a test body handed to a write door). This
// walk covers that residue across five roots, each already declared for
// `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs` and mirrored
// in `turbo.json` — the same roots and extensions the RLS `tags` pin walks.
//
// The key name is unique in this tree, so the matcher is textual and needs no
// structure: an offender is `publicPicker` in KEY position — an object or
// mapping key followed by `:` (optionally quoted, optionally `?`). Prose that
// merely names the key (a comment, a docblock, a Markdown paragraph) is not an
// authoring; in MD/MDX only fenced code is judged.
//
// The bound, stated: a key built by spread or computed name is invisible to a
// text walk; `docs/**`, `.claude/**`, `.github/**`, `.changeset/**` and the
// repo-root files are outside the radius.
describe('tree-scoped absence: no form field inside the declared radius still authors publicPicker', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` only the non-code extensions are scanned AND declared. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /**
   * Structural exclusions — the retirement kit and the pins that author the
   * retired key on purpose, each with its reason. ⛔ NOT an allowlist file
   * (`spec-property-retirement` §4): every entry's JOB is to spell the key.
   */
  const EXCLUDED = new Set([
    // The tombstone itself: `publicPicker: retiredKey(…)` on the form field shape.
    'packages/spec/src/ui/view.zod.ts',
    // The union-door pin authors the retired key to prove its prescription
    // reaches the author through `ViewMetadataSchema`, not the container text.
    'packages/spec/src/ui/view-union-branch-focus.test.ts',
    // The REST strip pin authors it on a STORED pre-retirement row, the exact
    // row the old opt-in would have kept, to prove the strip is unconditional.
    'packages/rest/src/public-form-routes.test.ts',
    // This pin names the key to assert its absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement field on purpose.
    'packages/spec/src/conversions/',
    // GITIGNORED build output reached only because this is a FILESYSTEM walk:
    // `retiredKey()` emits the tombstone into the generated JSON Schema's
    // `properties`. Its source, `view.zod.ts`, is excluded above for the same reason.
    'packages/spec/json-schema/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** `publicPicker` in key position: optionally quoted, optionally `?`, then `:`. */
  const KEY_POSITION = /(?:^|[^\w$`.])["']?publicPicker["']?\s*\??\s*:/;

  const lineOffenders = (text: string): number[] =>
    text.split('\n').flatMap((line, idx) => (KEY_POSITION.test(line) ? [idx + 1] : []));

  /** MD/MDX: only fenced code is judged — prose mentions are not authorings. */
  const markdownOffenders = (text: string): number[] => {
    const out: number[] = [];
    const fence = /^```[^\n]*\n([\s\S]*?)^```/gm;
    for (let m = fence.exec(text); m; m = fence.exec(text)) {
      const offset = text.slice(0, m.index).split('\n').length;
      for (const h of lineOffenders(m[1]!)) out.push(offset + h);
    }
    return out;
  };

  const offendersIn = (ext: string, text: string): number[] => {
    if (!text.includes('publicPicker')) return [];
    if (ext === '.md' || ext === '.mdx') return markdownOffenders(text);
    return lineOffenders(text);
  };

  const vanished: string[] = [];
  /** Tolerates ONLY a path's disappearance mid-walk; every other fault is re-raised. */
  const readIfPresent = (full: string, rel: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      vanished.push(rel);
      return undefined;
    }
  };

  it('the matcher finds an authoring and ignores every neighbouring shape (anti-vacuity)', () => {
    // Offenders — the key in each syntax the walk reads.
    expect(offendersIn('.ts', "fields: [{ field: 'owner', publicPicker: { displayFields: ['name'] } }]")).toEqual([1]);
    expect(offendersIn('.ts', "const f = {\n  field: 'owner',\n  publicPicker: {},\n};")).toEqual([3]);
    expect(offendersIn('.ts', 'type T = { publicPicker?: unknown };')).toEqual([1]);
    expect(offendersIn('.json', '{ "field": "owner", "publicPicker": { "maxResults": 5 } }')).toEqual([1]);
    expect(offendersIn('.yaml', 'fields:\n  - field: owner\n    publicPicker:\n      maxResults: 5\n')).toEqual([3]);
    expect(offendersIn('.md', "Prose.\n\n```ts\n{ field: 'owner', publicPicker: {} }\n```\n")).toEqual([4]);
    // Neighbours that must NOT match.
    // Prose and comments that NAME the key.
    expect(offendersIn('.md', 'The `publicPicker` block was removed.')).toEqual([]);
    expect(offendersIn('.ts', '// the retired `publicPicker` block is refused')).toEqual([]);
    // A dotted path, a registry id and a backticked mention are not keys.
    expect(offendersIn('.ts', "surface: 'view.form.sections[].fields[].publicPicker — the picker'")).toEqual([]);
    expect(offendersIn('.json', '"ui/FormField:publicPicker [RETIRED]"')).toEqual([]);
    expect(offendersIn('.ts', "'`view.form.sections[].fields[].publicPicker` was removed'")).toEqual([]);
    // A longer identifier that merely contains the name.
    expect(offendersIn('.ts', 'const formFieldPublicPickerRemoved: X = {};')).toEqual([]);
  });

  it('a path that VANISHES mid-walk is not a finding, and every other read fault still is', () => {
    const before = vanished.length;
    const gone = path.join(REPO_ROOT, 'packages/spec/does-not-exist.bundled_probe.mjs');
    expect(fs.existsSync(gone)).toBe(false);
    expect(readIfPresent(gone, 'probe/gone')).toBeUndefined();
    expect(vanished.slice(before)).toEqual(['probe/gone']);
    expect(readIfPresent(fileURLToPath(import.meta.url), THIS_FILE)).toContain('tree-scoped absence');
    expect(() => readIfPresent(path.join(REPO_ROOT, 'packages/spec'), 'probe/dir')).toThrow();
    expect(vanished.length).toBe(before + 1);
  });

  it('no form field authoring publicPicker survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let formBearing = 0;
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
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full, rel);
        if (text === undefined) continue;
        if (text.includes('allowAnonymous')) formBearing += 1;
        for (const lineNo of offendersIn(ext, text)) offenders.push(`${rel}:${lineNo}`);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk covered the tree, and the files that CAN hold a
    // public form were really read.
    expect(visited).toBeGreaterThan(1000);
    expect(formBearing).toBeGreaterThan(10);
    expect(offenders, 'a form field authoring `publicPicker` means the retirement is being undone').toEqual([]);
  });
});
