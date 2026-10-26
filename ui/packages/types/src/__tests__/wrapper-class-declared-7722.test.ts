// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Five more renderers read `schema.wrapperClass` that their shipped types never
 * declared (objectui#7722), plus a SWEEP that turns red on the next one.
 *
 * ## The defect
 *
 * `switch.tsx`, `textarea.tsx`, `date-picker.tsx`, `select.tsx` and
 * `data-display/list.tsx` each read `schema.wrapperClass` onto a wrapper element,
 * and neither face of the shipped contract declared the key on `SwitchSchema`,
 * `TextareaSchema`, `DatePickerSchema`, `SelectSchema` or `ListSchema`: not the
 * TypeScript interface, not the zod mirror. Each read compiled through
 * `BaseSchema`'s index signature (objectui#5155) and each value parsed through
 * `.passthrough()`, admitted unexamined. The same key, on the same class of read,
 * IS declared on `CheckboxSchema` (objectui#6938), `FileUploadSchema` and
 * `FilterBuilderSchema` (objectui#6150).
 *
 * Re-derived on `951fa8e0d` before anything was edited: `git grep
 * schema\.wrapperClass -- packages/components/src` finds NINE readers; four of
 * them (`checkbox`, `file-upload`, `filter-builder`, `input`) sit on types that
 * declare the key on the TS face, and five do not, on either face. That is the
 * batch below — the card's five, measured, not inherited.
 *
 * ## The sixth asymmetry, deliberately NOT in the batch — and since CLOSED
 *
 * `InputSchema` declared `wrapperClass` on the TS face (`../form.ts`) and NOT on
 * its zod mirror. That was a recorded, reconciled row of the parity ledger —
 * `UnmirroredDeclared['form.zod.ts#InputSchema']` in `zod-mirror-parity.test.ts`
 * — whose entry and key counts are pinned by that file's own census. Mirroring
 * it moved those counts, so it was that ledger's remedy and not this card's. The
 * sweep carried it as a SELF-EXPIRING exemption: valid only while the mirror
 * still lacked the key AND the ledger row was still on disk.
 *
 * ⭐ objectui#8072 mirrored it, and the exemption expired exactly as built —
 * `LEDGERED_UNMIRRORED` is EMPTY now, and the sweep judges all nine readers
 * alike. ⛔ The carve-out was deleted, not weakened to stay green: that is the
 * whole return on writing an exemption that asserts its own precondition rather
 * than one that simply names a type.
 *
 * ## What this file pins, and the two shapes it borrows
 *
 * The batch is the table form of `undeclared-but-consumed-keys-6150.test.ts`,
 * unchanged: membership asserted on the mirror's OWN `.shape`, never on parse
 * acceptance (under `.passthrough()` acceptance cannot tell "declared" from
 * "admitted unexamined"); a CONTROL key the renderer does NOT read, derived from
 * the renderer source, that must stay undeclared on both faces — the half that
 * keeps this from being a widening beyond the one key; and the exact read text,
 * checked off disk, because a declaration is worth its docblock only while the
 * read exists.
 *
 * The sweep is new. It walks `packages/components/src/renderers/`, finds every
 * file reading `schema.wrapperClass`, resolves the renderer's schema type from
 * its own props annotation (`schema: XxxSchema`), and asserts BOTH faces declare
 * the key — the TS interface by its source text, the mirror by `.shape`. No key
 * list to maintain: the next renderer that grows a `wrapperClass` read on an
 * undeclared type fails here, on the day it is written, instead of waiting for
 * the next single-key grep (objectui#6938 → objectui#7722 was that wait).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import * as Mirrors from '../zod/index.zod';
import { safeValidateSchema } from '../zod/index.zod';
import { DatePickerSchema, SelectSchema, SwitchSchema, TextareaSchema } from '../zod/form.zod';
import { ListSchema } from '../zod/data-display.zod';

import type {
  DatePickerSchema as TsDatePickerSchema,
  SelectSchema as TsSelectSchema,
  SwitchSchema as TsSwitchSchema,
  TextareaSchema as TsTextareaSchema,
} from '../form';
import type { ListSchema as TsListSchema } from '../data-display';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const TYPES_SRC = join(REPO_ROOT, 'packages', 'types', 'src');
const RENDERERS = join(REPO_ROOT, 'packages', 'components', 'src', 'renderers');
const PARITY_LEDGER = join(HERE, 'zod-mirror-parity.test.ts');

const KEY = 'wrapperClass';
/**
 * A plausible-looking class key none of the five renderers reads (each hands
 * the label its own hard-coded classes, or has no label). It stays undeclared
 * on both faces; `rendererReads` below proves the non-read per renderer.
 */
const CONTROL_KEY = 'labelClass';
/** An undeclared key, carried by the control so the before-state stays visible. */
const SENTINEL = 'undeclaredControlKey7722';

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;

// Declared as `string` on each of the five. Were a member removed, the read
// fell back to the index signature and resolved to `any` until objectui#8347
// (it does not compile now); either way these go red — so these are guards,
// not restatements.
export type _SwitchWrapperClassIsString = Expect<Equal<NonNullable<TsSwitchSchema['wrapperClass']>, string>>;
export type _SwitchWrapperClassIsNotAny = Expect<Equal<IsAny<TsSwitchSchema['wrapperClass']>, false>>;
export type _TextareaWrapperClassIsString = Expect<Equal<NonNullable<TsTextareaSchema['wrapperClass']>, string>>;
export type _TextareaWrapperClassIsNotAny = Expect<Equal<IsAny<TsTextareaSchema['wrapperClass']>, false>>;
export type _DatePickerWrapperClassIsString = Expect<Equal<NonNullable<TsDatePickerSchema['wrapperClass']>, string>>;
export type _DatePickerWrapperClassIsNotAny = Expect<Equal<IsAny<TsDatePickerSchema['wrapperClass']>, false>>;
export type _SelectWrapperClassIsString = Expect<Equal<NonNullable<TsSelectSchema['wrapperClass']>, string>>;
export type _SelectWrapperClassIsNotAny = Expect<Equal<IsAny<TsSelectSchema['wrapperClass']>, false>>;
export type _ListWrapperClassIsString = Expect<Equal<NonNullable<TsListSchema['wrapperClass']>, string>>;
export type _ListWrapperClassIsNotAny = Expect<Equal<IsAny<TsListSchema['wrapperClass']>, false>>;

// The control key is NOT declared on any of the five: it resolved to `any`
// through the index signature, exactly as `wrapperClass` did before this card,
// until objectui#8347 removed the signature; it is no member now. Declaring it
// anywhere turns the matching line red — which is the point.
type NoMember<T, K extends PropertyKey> = Equal<K extends keyof T ? true : false, false>;
export type _SwitchControlIsNoMember = Expect<NoMember<TsSwitchSchema, 'labelClass'>>;
export type _TextareaControlIsNoMember = Expect<NoMember<TsTextareaSchema, 'labelClass'>>;
export type _DatePickerControlIsNoMember = Expect<NoMember<TsDatePickerSchema, 'labelClass'>>;
export type _SelectControlIsNoMember = Expect<NoMember<TsSelectSchema, 'labelClass'>>;
export type _ListControlIsNoMember = Expect<NoMember<TsListSchema, 'labelClass'>>;
// Lit control for the detector: `IsAny` does answer `true`, so the `IsNotAny` lines are readings.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;

// The TS face accepts the key on a literal. Since objectui#8347 this is no
// longer the weak half: without the index signature an undeclared key is
// refused on a fresh literal, so each acceptance reads the declaration.
const literals = {
  switch: { type: 'switch', label: 'Enabled', wrapperClass: 'gap-4' } satisfies TsSwitchSchema,
  textarea: { type: 'textarea', label: 'Notes', wrapperClass: 'gap-4' } satisfies TsTextareaSchema,
  datePicker: { type: 'date-picker', label: 'Due', wrapperClass: 'gap-4' } satisfies TsDatePickerSchema,
  select: { type: 'select', label: 'Pick', options: [], wrapperClass: 'gap-4' } satisfies TsSelectSchema,
  list: { type: 'list', items: [], wrapperClass: 'gap-4' } satisfies TsListSchema,
};

/* ── The five, as data ───────────────────────────────────────────────────── */

interface Mirror {
  shape: Record<string, unknown>;
  safeParse: (v: unknown) => {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { issues: { path: (string | number)[] }[] };
  };
}

interface Case {
  /** Mirror + TS type name — also the name the sweep resolves from the renderer. */
  type: string;
  mirror: Mirror;
  /** A minimal LEGAL document for this type, carrying neither the key nor the control. */
  control: Record<string, unknown>;
  /** Renderer file, relative to the repo root. */
  reader: string;
  /** Exact source text of the read, as it stands today. */
  readText: string;
}

const R = 'packages/components/src/renderers/';

const CASES: Case[] = [
  { type: 'SwitchSchema', mirror: SwitchSchema as unknown as Mirror,
    control: { type: 'switch', label: 'Enabled' },
    reader: R + 'form/switch.tsx', readText: "`flex items-center space-x-2 ${schema.wrapperClass || ''}`" },
  { type: 'TextareaSchema', mirror: TextareaSchema as unknown as Mirror,
    control: { type: 'textarea', label: 'Notes' },
    reader: R + 'form/textarea.tsx', readText: 'cn("grid w-full gap-1.5", schema.wrapperClass)' },
  { type: 'DatePickerSchema', mirror: DatePickerSchema as unknown as Mirror,
    control: { type: 'date-picker', label: 'Due' },
    reader: R + 'form/date-picker.tsx', readText: "`grid w-full max-w-sm items-center gap-1.5 ${schema.wrapperClass || ''}`" },
  { type: 'SelectSchema', mirror: SelectSchema as unknown as Mirror,
    control: { type: 'select', label: 'Pick', options: [] },
    reader: R + 'form/select.tsx', readText: 'cn("grid w-full items-center gap-1.5", schema.wrapperClass)' },
  { type: 'ListSchema', mirror: ListSchema as unknown as Mirror,
    control: { type: 'list', items: [] },
    reader: R + 'data-display/list.tsx', readText: 'cn("space-y-2", schema.wrapperClass)' },
];

/** Every `schema.KEY` read in one renderer, off disk. */
function rendererReads(reader: string): Set<string> {
  const src = readFileSync(join(REPO_ROOT, reader), 'utf8');
  return new Set([...src.matchAll(/\bschema\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

describe('objectui#7722 — the five renderers read `wrapperClass`, which is the fact the declarations record', () => {
  it('the batch is exactly five keys over five shipped types', () => {
    // Non-vacuity for every per-case assertion below, and the card's own bound:
    // nine readers were measured, four already declared, five not. A sixth
    // undeclared reader belongs to the sweep below and to its own card, not here.
    expect(CASES).toHaveLength(5);
    expect(new Set(CASES.map((c) => c.type)).size).toBe(5);
  });

  describe.each(CASES.map((c) => [c.type, c] as const))('%s', (_title, c) => {
    const { mirror, control, reader, readText } = c;

    it('the read is still there, as the exact text the docblocks cite', () => {
      const src = readFileSync(join(REPO_ROOT, reader), 'utf8');
      expect(src, `${reader} no longer reads \`schema.${KEY}\` as \`${readText}\``).toContain(readText);
    });

    it('the read set, derived from the renderer, contains the key and NOT the control key', () => {
      // Non-vacuity for the control: if the renderer ever starts reading
      // `labelClass`, this turns red and the control must be re-chosen, not
      // declared on the way past.
      const reads = rendererReads(reader);
      expect(reads.has(KEY)).toBe(true);
      expect(reads.has(CONTROL_KEY)).toBe(false);
    });

    it('is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', () => {
      expect(Object.keys(mirror.shape)).toContain(KEY);
    });

    it('accepts the declared value and the value SURVIVES the parse', () => {
      const r = mirror.safeParse({ ...control, [KEY]: 'gap-4' });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      if (r.success) expect(r.data![KEY]).toBe('gap-4');
    });

    it('…and through the published union entry point, so this type\'s arm is the one reached', () => {
      const r = safeValidateSchema({ ...control, [KEY]: 'gap-4' });
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
      if (r.success) expect((r.data as Record<string, unknown>)[KEY]).toBe('gap-4');
    });

    it('refuses a wrong-typed value AT the key — the enforcement mirroring adds', () => {
      // Before this card `wrapperClass: 42` parsed green under `.passthrough()`.
      // This is the only verdict that moves, and it moves toward refusal.
      const r = mirror.safeParse({ ...control, [KEY]: 42 });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error!.issues.map((i) => i.path.join('.'))).toContain(KEY);
    });

    it('control: the declared-keys-only document parses green, before and after', () => {
      expect(mirror.safeParse(control).success).toBe(true);
    });

    it('control: the control key is ABSENT from the mirror shape', () => {
      expect(Object.keys(mirror.shape)).not.toContain(CONTROL_KEY);
    });

    it('control: the SAME wrong-typed value under an UNDECLARED key is still admitted unexamined', () => {
      // The before-state of `wrapperClass`, kept on purpose on keys that are not
      // read: `.passthrough()` admits them, of any type, and they survive. This is
      // the proof the mirror's unknown-key policy is byte-for-byte what it was.
      for (const undeclared of [CONTROL_KEY, SENTINEL]) {
        const r = mirror.safeParse({ ...control, [undeclared]: 42 });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data![undeclared]).toBe(42);
      }
    });
  });

  it('the type-level bindings above are referenced, so lint keeps them', () => {
    for (const literal of Object.values(literals)) expect(literal.wrapperClass).toBe('gap-4');
  });
});

/* ── The sweep: every `schema.wrapperClass` reader, both faces, no key list ── */

/**
 * Readers whose mirror is a recorded, reconciled row of the parity ledger
 * (`UnmirroredDeclared` in `zod-mirror-parity.test.ts`). Each entry names the
 * exact ledger row text; the exemption holds only while that text is on disk
 * AND the mirror still lacks the key. Mirror the key and BOTH conditions flip —
 * the exemption must then be deleted, never left to cover nothing.
 *
 * ⭐ EMPTY since objectui#8072 mirrored `InputSchema.wrapperClass`, the one entry
 * this ever carried. An empty map makes the sweep below judge every reader alike,
 * which is the state it is meant to reach — ⛔ it is not an invitation to refill.
 * A new row belongs here only when the parity ledger really records the pair, and
 * it expires the same way this one did.
 */
const LEDGERED_UNMIRRORED: Record<string, string> = {};

interface Reader {
  /** Renderer file, relative to the repo root. */
  file: string;
  /** The schema type the renderer annotates its `schema` prop with. */
  type: string;
}

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsx(full));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(full);
  }
  return out.sort();
}

/** Every renderer reading `schema.wrapperClass`, with its annotated schema type — derived, not listed. */
function wrapperClassReaders(): Reader[] {
  const readers: Reader[] = [];
  for (const full of walkTsx(RENDERERS)) {
    const src = readFileSync(full, 'utf8');
    if (!/\bschema\.wrapperClass\b/.test(src)) continue;
    const file = relative(REPO_ROOT, full);
    const m = /\bschema:\s*([A-Z][A-Za-z0-9]*Schema)\b/.exec(src);
    if (!m) throw new Error(`${file} reads schema.wrapperClass but annotates no \`schema: XxxSchema\` prop — extend the resolver, do not exempt the reader`);
    readers.push({ file, type: m[1] });
  }
  return readers;
}

/** The TS interface block for one schema type, off the package source — exactly one hit required. */
function tsInterfaceBlock(type: string): { file: string; block: string } {
  const hits: { file: string; block: string }[] = [];
  for (const name of readdirSync(TYPES_SRC)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const src = readFileSync(join(TYPES_SRC, name), 'utf8');
    const re = new RegExp(`^export interface ${type} extends BaseSchema \\{\\n([\\s\\S]*?)^\\}`, 'm');
    const m = re.exec(src);
    if (m) hits.push({ file: `packages/types/src/${name}`, block: m[1] });
  }
  expect(hits, `expected exactly one \`export interface ${type} extends BaseSchema\` under packages/types/src`).toHaveLength(1);
  return hits[0];
}

function mirrorOf(type: string): Mirror | undefined {
  const candidate = (Mirrors as Record<string, unknown>)[type];
  return candidate && typeof candidate === 'object' && 'shape' in candidate ? (candidate as Mirror) : undefined;
}

describe('objectui#7722 — sweep: every renderer reading `schema.wrapperClass` sits on a type that declares it, on both faces', () => {
  const readers = wrapperClassReaders();

  it('finds the readers (non-vacuity: nine were measured on 951fa8e0d; a resolver that finds fewer is broken, not clean)', () => {
    expect(readers.length).toBeGreaterThanOrEqual(9);
    expect(new Set(readers.map((r) => r.type)).size).toBe(readers.length);
  });

  it('the batch above is a subset of the sweep — the five were found by the resolver, not only by hand', () => {
    const swept = new Set(readers.map((r) => r.type));
    for (const c of CASES) expect(swept, `${c.type} not found by the sweep`).toContain(c.type);
  });

  it('every ledgered exemption names a reader the sweep found, and its ledger row is on disk', () => {
    const ledger = readFileSync(PARITY_LEDGER, 'utf8');
    const swept = new Set(readers.map((r) => r.type));
    for (const [type, row] of Object.entries(LEDGERED_UNMIRRORED)) {
      expect(swept, `exemption for ${type} covers no reader — delete it`).toContain(type);
      expect(ledger, `ledger row ${row} is gone — the debt was paid, delete the exemption`).toContain(row);
    }
  });

  describe.each(readers.map((r) => [`${r.type} (${r.file})`, r] as const))('%s', (_title, r) => {
    it('declares `wrapperClass` on the TS face — a `wrapperClass?: string` member of the interface block', () => {
      const { file, block } = tsInterfaceBlock(r.type);
      expect(block, `${file}: ${r.type} does not declare \`${KEY}?: string\``).toMatch(/^\s*wrapperClass\?: string;/m);
    });

    it('declares `wrapperClass` on the zod face — a member of the mirror\'s own `.shape` — unless ledgered', () => {
      const mirror = mirrorOf(r.type);
      expect(mirror, `@object-ui/types/zod exports no mirror named ${r.type}`).toBeDefined();
      const declared = Object.keys(mirror!.shape).includes(KEY);
      if (r.type in LEDGERED_UNMIRRORED) {
        // Self-expiring: the day the mirror gains the key, this turns red and the
        // exemption (and the ledger row it cites) must go together.
        expect(declared, `${r.type} now mirrors \`${KEY}\` — delete its LEDGERED_UNMIRRORED entry`).toBe(false);
      } else {
        expect(declared, `${r.file} reads schema.${KEY} but the ${r.type} mirror does not declare it`).toBe(true);
      }
    });
  });
});
