/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ComponentInput.label` / `defaultValue` / `advanced` are ADR-0049 RETIREMENT
 * TOMBSTONES on both faces, the refusal is LOUD and BY NAME, and no registration
 * in the tree authors them any more (objectui#7493 item ①, objectui#7781;
 * maintainer ruling A of 2026-09-06).
 *
 * ## What was measured
 *
 * The three are the keys the manifest serializer does not forward. Every
 * non-test consumer of `ComponentMeta.inputs` was enumerated and none reads
 * any of them: `sdui-parser`'s serializer forwarded exactly six keys per input
 * at the time of the retirement (`name`, `type`, `required`, `enum`, `binding`,
 * `description`) and its boundary type had no slot for these — objectui#8067
 * has since added a SEVENTH, `of`, which is why the pins below read the
 * serializer's CURRENT list against a named expectation rather than a count; the registry's data-source seam reads
 * `name` only; neither the designer nor the app-shell inspectors consult
 * registry `inputs` at all. The one non-test touch was a WRITE — the
 * `WidgetRegistry` seam copying widget-manifest values across — and it fed
 * nothing. A depth-1 bracket-balanced census over every `inputs:` array
 * counted the authorship: `label` 908, `defaultValue` 245, `advanced` 9,
 * against `name` 951 and `type` 951 in the same pass over the same regions.
 * Written on nearly every registration, read by nothing.
 *
 * ## Why tombstones and not deletions — MEASURED, not assumed
 *
 * `ComponentInputSchema` is a plain `z.object`, not an extension of the
 * passthrough `BaseSchema`, so the route had to be measured on the built face
 * rather than inherited from the `crud.zod.ts` precedent: an undeclared key
 * parses GREEN and is silently STRIPPED. Deleting the members would therefore
 * have swallowed 1,162 authored values in silence — one silent no-op traded for
 * another. The tombstone keeps each key declared and unwritable: `?: never` on
 * the interface (a `tsc` error at the authoring site) and `retirementTombstone()`
 * on the mirror (a parse refusal whose message IS the migration note). The
 * contrast is pinned below so nobody "simplifies" a tombstone into a deletion.
 *
 * ## Radius of the absence census
 *
 * Tree-scoped, never file-scoped: the walk below reads every `.ts` / `.tsx`
 * under `packages/STAR/src` and `apps/STAR/src` off disk (STAR spelled out
 * because a glob inside a docblock reads as a comment terminator), tests
 * included, and scores the three keys at depth 1 of every object literal in
 * every `inputs: [` array and every `ComponentInput[] = [` array. Its own
 * controls (`name`, `type`) prove the walk found the corpus. The files it skips
 * are the tombstone PINS — this one, the constraint-key sibling, and the
 * widget-face one (objectui#7911) — because each AUTHORS the keys on purpose
 * under `@ts-expect-error`; a reason stated here, not an allow-list. `SKIPPED`
 * below is the enumeration, and it is the only place the list lives.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening a
 * declaration fails the build on the unused directive.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ComponentInput, ComponentMeta } from '../base';
import { ComponentInputSchema, ComponentMetaSchema } from '../zod/base.zod';

const ROOT = resolve(__dirname, '../../../..');

/** The three retired keys, each with the value the registrations used to write. */
const RETIRED = {
  label: 'Title',
  defaultValue: 'drawer',
  advanced: true,
} as const;

type RetiredKey = keyof typeof RETIRED;

/** The remedy each guidance string must carry — what an author writes instead. */
const REMEDY: Record<RetiredKey, RegExp> = {
  label: /identified by its `name`/,
  defaultValue: /renderer's own fallback read/,
  advanced: /nothing to write instead/,
};

/**
 * The five FORWARDED keys this face declares, all live. (`binding`, the sixth
 * key the serializer forwards, is read off `sdui-parser`'s own boundary type
 * and is not declared on `ComponentInput` — objectui#6950's open question, not
 * this file's.)
 */
const LIVE_INPUT = {
  name: 'mobileNavMode',
  type: 'enum',
  required: false,
  enum: ['drawer', 'bottom_nav'],
  description: 'Mobile navigation mode. "drawer" (default) puts the sidebar in the mobile sheet overlay.',
} as const;

/** The eight tombstones the interface carries after this retirement. */
const ALL_TOMBSTONES = ['inputType', 'min', 'max', 'step', 'placeholder', 'label', 'defaultValue', 'advanced'] as const;

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const describeOf = (schema: unknown, key: string): string | undefined =>
  (shapeOf(schema)[key] as { description?: string } | undefined)?.description;

/* ── type-level pins: the `tsc` channel ──────────────────────────────────── */

describe('the interface tombstones make authoring a `tsc` error (objectui#7493)', () => {
  it('refuses each retired key at a real registration shape', () => {
    const input: ComponentInput = {
      name: 'title',
      type: 'string',
      // @ts-expect-error `label` is a retirement tombstone (objectui#7493 / objectui#7781)
      label: 'Title',
      // @ts-expect-error `defaultValue` is a retirement tombstone (objectui#7493)
      defaultValue: 'Untitled',
      // @ts-expect-error `advanced` is a retirement tombstone (objectui#7493 / objectui#7781)
      advanced: true,
    };
    expect(input.name).toBe('title');
  });

  it('refuses them through the registration door too — and the registration\'s OWN `label` stays live', () => {
    // `ComponentMeta.label` is the palette display name of the REGISTRATION, a
    // different key on a different type; only the per-input `label` retired.
    const meta: ComponentMeta = {
      label: 'Mobile Nav',
      inputs: [
        {
          name: 'mobileNavMode',
          type: 'enum',
          enum: ['drawer', 'bottom_nav'],
          // @ts-expect-error `defaultValue` is a retirement tombstone (objectui#7493)
          defaultValue: 'drawer',
        },
      ],
    };
    expect(meta.label).toBe('Mobile Nav');
  });

  it('the five forwarded keys stay writable — the non-vacuity control for the directives above', () => {
    const input: ComponentInput = { ...LIVE_INPUT, enum: [...LIVE_INPUT.enum] };
    expect(input.required).toBe(false);
  });
});

/* ── the mirror refuses, and the refusal carries its remedy ──────────────── */

describe('the zod tombstones REFUSE, loudly and by name (objectui#7493)', () => {
  it('a fully live input parses GREEN and keeps every forwarded key — the non-vacuity control', () => {
    const control = ComponentInputSchema.safeParse(LIVE_INPUT);
    expect(control.success).toBe(true);
    if (control.success) {
      expect(control.data).toEqual(LIVE_INPUT);
    }
  });

  for (const key of Object.keys(RETIRED) as RetiredKey[]) {
    it(`refuses \`${key}\`, names it in the path, and answers with its own guidance`, () => {
      const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, [key]: RETIRED[key] });
      expect(result.success, key).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => String(i.path[0]) === key);
      expect(issue, `no issue addressed to \`${key}\``).toBeDefined();

      // The accept-set contract: same address, same code a bare `z.never()`
      // reports. A `refine`-based spelling would report `custom` and was
      // rejected for exactly that reason (objectui#6105).
      expect(issue!.code, key).toBe('invalid_type');
      expect(issue!.path, key).toEqual([key]);

      // The message is the migration note, not zod's generic string.
      expect(issue!.message, key).not.toContain('Invalid input: expected never, received ');
      expect(issue!.message, key).toContain('RETIRED (objectui#7493)');
      expect(issue!.message, key).toContain(`\`ComponentInput.${key}\``);
      expect(issue!.message, key).toContain('Delete the key');
      expect(issue!.message, key).toMatch(REMEDY[key]);

      // ONE string, BOTH channels — the invariant `retirementTombstone()`
      // exists to make unbreakable. Derived, so nothing hand-copied can rot;
      // the literal anchors above are what keep two empty strings from
      // passing this line.
      expect(issue!.message, key).toBe(describeOf(ComponentInputSchema, key));
    });
  }

  it('refuses through the registration door at the nested path', () => {
    const result = ComponentMetaSchema.safeParse({
      label: 'Mobile Nav',
      inputs: [{ ...LIVE_INPUT, label: 'Mobile Nav Mode' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'inputs.0.label');
      expect(issue?.code).toBe('invalid_type');
      expect(issue?.message).toContain('RETIRED (objectui#7493)');
    }
  });

  it('`defaultValue` answers with the full string — one member pinned as a LITERAL', () => {
    // So the derived assertions above cannot all drift together.
    const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, defaultValue: 'drawer' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'RETIRED (objectui#7493) — `ComponentInput.defaultValue` was never read, and never published: the manifest '
        + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
        + 'so an authored value was silently dropped. Delete the key; the renderer\'s own fallback read is the '
        + 'default, and `description`, which IS published, is where to state it.',
      );
    }
  });
});

/* ── the forwarded keys are still VALUE-enforced, not merely admitted ────── */

describe('the forwarded keys keep their own enforcement (control)', () => {
  const WRONG: Array<[string, unknown]> = [
    ['name', 42],
    ['type', 'textarea'],
    ['required', 'yes'],
    ['enum', 'drawer'],
    ['description', 7],
  ];
  for (const [key, value] of WRONG) {
    it(`refuses a wrong-typed \`${key}\` at its own path`, () => {
      const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, [key]: value });
      expect(result.success, key).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => String(i.path[0]) === key), key).toBe(true);
      }
    });
  }
});

/* ── the contrast a deletion would have produced ─────────────────────────── */

describe('a tombstone is not a deletion — the route measurement, restated in one run', () => {
  it('an UNDECLARED key is silently stripped, which is what deleting these three would have bought', () => {
    const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('notAKeyAtAll');
  });

  it('the three stay in the mirror\'s shape — DECLARED, just unwritable', () => {
    for (const key of Object.keys(RETIRED)) {
      expect(shapeOf(ComponentInputSchema)).toHaveProperty(key);
      expect(describeOf(ComponentInputSchema, key)).toContain('RETIRED (objectui#7493)');
    }
  });
});

/* ── the interface census: eight tombstones, five live keys, on both faces ─ */

describe('the `ComponentInput` census after the retirement', () => {
  const base = readFileSync(resolve(ROOT, 'packages/types/src/base.ts'), 'utf8');
  const block = /export interface ComponentInput \{([\s\S]*?)\n\}/.exec(base)?.[1] ?? '';

  it('found the interface block — the precondition', () => {
    expect(block.length).toBeGreaterThan(0);
  });

  it('declares exactly eight `?: never` tombstones on the TypeScript face', () => {
    const tombstones = [...block.matchAll(/^\s{2}(\w+)\?: never;/gm)].map((m) => m[1]).sort();
    expect(tombstones).toEqual([...ALL_TOMBSTONES].sort());
  });

  it('declares exactly the six live keys as writable on the TypeScript face', () => {
    // `of` is the sixth, added by objectui#8067 — the member KIND of an
    // `array`/`object` input. It is here rather than among the tombstones for
    // the one reason this pin exists to enforce: it SHIPPED WITH READERS. The
    // repo-wide parity gate compares every declared `of` against the contract's
    // member position, `validateTree` reports a member no declared arm accepts,
    // and the codegen types the generated `.d.ts` surface from it. A key added
    // here with no reader is the objectui#5905 defect this whole file records.
    const writable = [...block.matchAll(/^\s{2}(\w+)\??: (?!never;)/gm)].map((m) => m[1]).sort();
    expect(writable).toEqual(['description', 'enum', 'name', 'of', 'required', 'type']);
  });

  it('the mirror agrees member for member: eight RETIRED describes, six live keys', () => {
    const shape = shapeOf(ComponentInputSchema);
    const retired = Object.keys(shape).filter((k) => describeOf(ComponentInputSchema, k)?.startsWith('RETIRED (')).sort();
    const live = Object.keys(shape).filter((k) => !describeOf(ComponentInputSchema, k)?.startsWith('RETIRED (')).sort();
    expect(retired).toEqual([...ALL_TOMBSTONES].sort());
    expect(live).toEqual(['description', 'enum', 'name', 'of', 'required', 'type']);
  });
});

/* ── the serializer forwards the live keys, and none of the retired ──────── */

describe('the publication path: `manifestFromConfigs` forwards every live key', () => {
  it('reads the serializer source and finds the seven, and none of the three', () => {
    const src = readFileSync(resolve(ROOT, 'packages/sdui-parser/src/index.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function manifestFromConfigs('));
    const forwarded = /inputs: \(c\.inputs \?\? \[\]\)\.map\(\(i\) => \(\{([\s\S]*?)\}\)\)/.exec(fn)?.[1] ?? '';
    expect(forwarded.length, 'the serializer no longer maps inputs where this pin reads it').toBeGreaterThan(0);
    // Seven since objectui#8067 added `of`. The load-bearing half of this pin
    // is unchanged and is the reason it is an EQUALITY: the three retired keys
    // must not reappear here, and a serializer that quietly started forwarding
    // one would be caught by the same assertion that lets a genuinely-read new
    // key through in a diff someone reviews.
    const keys = [...forwarded.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(keys).toEqual(['binding', 'description', 'enum', 'name', 'of', 'required', 'type']);
  });
});

/* ── tree-scoped absence: no registration authors the three keys ─────────── */

/** Skipped by path, with the reason: each file authors the keys on purpose under `@ts-expect-error`. */
const SKIPPED = new Set([
  resolve(ROOT, 'packages/types/src/__tests__/component-input-retired-keys-7493.test.ts'),
  resolve(ROOT, 'packages/types/src/__tests__/component-input-retired-constraint-keys.test.ts'),
  // The widget-face twin of this pin (objectui#7911): it authors `defaultValue`
  // inside a `RuntimeWidgetManifest.inputs` literal under `@ts-expect-error`,
  // which this walk's `inputs: [` regex cannot tell apart from a registration.
  resolve(ROOT, 'packages/types/src/__tests__/widget-input-retired-keys-7911.test.ts'),
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry) && !SKIPPED.has(full)) yield full;
  }
}

function* sourceRoots(): Generator<string> {
  for (const parent of ['packages', 'apps']) {
    const parentDir = resolve(ROOT, parent);
    for (const pkg of readdirSync(parentDir)) {
      const src = join(parentDir, pkg, 'src');
      try { if (statSync(src).isDirectory()) yield src; } catch { /* no src dir */ }
    }
  }
}

/** Skip a string literal starting at `i` (quote at `src[i]`); returns the index after it. */
function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      let d = 1; j += 2;
      while (j < src.length && d > 0) {
        if (src[j] === '{') d++;
        else if (src[j] === '}') d--;
        else if (src[j] === "'" || src[j] === '"' || src[j] === '`') { j = skipString(src, j); continue; }
        j++;
      }
      continue;
    }
    if (c === q) return j + 1;
    if (c === '\n' && q !== '`') return j;
    j++;
  }
  return j;
}

/**
 * Depth-1 keys of every object literal directly inside the array opening at
 * `open`; the same instrument the census used. Returns null on an unbalanced
 * array so a broken walk reads as a failure, not as a clean corpus.
 */
function depthOneKeys(src: string, open: number): { end: number; keys: string[] } | null {
  const keyRe = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:/;
  let i = open + 1;
  let depth = 1;
  let inObject = false;
  const keys: string[] = [];
  while (i < src.length && depth > 0) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && c2 === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
    if (c === '[' || c === '{' || c === '(') { depth++; if (depth === 2 && c === '{') inObject = true; i++; continue; }
    if (c === ']' || c === '}' || c === ')') { if (depth === 2) inObject = false; depth--; i++; continue; }
    if (depth === 2 && inObject && /[\s{,]/.test(src[i - 1]) && /[A-Za-z_$'"]/.test(c)) {
      const m = keyRe.exec(src.slice(i, i + 80));
      if (m) { keys.push(m[1].replace(/^['"]|['"]$/g, '')); i += m[0].length; continue; }
    }
    i++;
  }
  return depth === 0 ? { end: i, keys } : null;
}

describe('no registration in the tree authors a retired key (tree-scoped census)', () => {
  const counts: Record<string, number> = {};
  const offenders: string[] = [];
  let files = 0;
  let arrays = 0;
  for (const root of sourceRoots()) {
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      if (!/\binputs\s*:\s*\[|ComponentInput\[\]\s*=\s*\[/.test(src)) continue;
      files++;
      const re = /(\binputs\s*:\s*\[|ComponentInput\[\]\s*=\s*\[)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const scan = depthOneKeys(src, m.index + m[0].length - 1);
        if (!scan) continue;
        arrays++;
        for (const k of scan.keys) {
          counts[k] = (counts[k] ?? 0) + 1;
          if (k in RETIRED) offenders.push(`${file.slice(ROOT.length + 1)}: ${k}`);
        }
        re.lastIndex = scan.end;
      }
    }
  }

  it('walked a real corpus — the controls', () => {
    // A walk that finds nothing is a broken walk, not a clean corpus. The
    // floors are well under the measured 984 / 984 so registrations can come
    // and go without this pin caring; they are far above zero so a walk that
    // lost the corpus cannot pass.
    expect(files).toBeGreaterThan(50);
    expect(arrays).toBeGreaterThan(100);
    expect(counts.name ?? 0).toBeGreaterThan(500);
    expect(counts.type ?? 0).toBeGreaterThan(500);
  });

  it('scores `label`, `defaultValue` and `advanced` at ZERO', () => {
    expect(offenders, 'a registration authors a retired key — delete it; the `tsc` face refuses it too').toEqual([]);
    for (const key of Object.keys(RETIRED)) expect(counts[key] ?? 0, key).toBe(0);
  });
});
