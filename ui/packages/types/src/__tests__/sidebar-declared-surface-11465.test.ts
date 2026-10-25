/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11465 — the `sidebar` node's declared surface is what the node
 * draws: nine unread keys retire on both faces, `variant` takes the renderer's
 * enum, and the types README teaches the children-composition form.
 *
 * ## The ruling these pin
 *
 * Triage's key-by-key direction on objectui#11465: retire `title`, `nav`,
 * `content`, `footer`, `position`, `width`, `collapsedWidth`,
 * `defaultCollapsed` and `collapsed`; `variant` takes the registration's own
 * input (`sidebar` / `floating` / `inset`, shadcn's enum), and `default` and
 * `bordered` retire at once, with no alias window. `collapsible` was settled
 * by PR objectui#11463 and is only a live neighbour here.
 *
 * Each retired key is a `?: never` tombstone on the TypeScript face and a
 * `retirementTombstone` on the zod face, refused by name with the reason and
 * what to write instead. ⛔ Not a deletion: `BaseSchema` is `.passthrough()` on
 * the zod face (and carried an index signature on the TypeScript face until
 * objectui#8347), so a deleted key would parse green unexamined and, through a
 * widened value, still type-check.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` aliases and the `@ts-expect-error` directives are
 * TYPE-level: `tsc -p tsconfig.test.json` (the third leg of this package's
 * `type-check` script) reads them. The `safeParse` / `safeValidateSchema` rows
 * are RUNTIME, and vitest reads them. A green run of either alone says nothing
 * about the other.
 *
 * ## The README leg
 *
 * The types README's "4. Composable" example is EXTRACTED and evaluated, never
 * retyped here: a hand copy would be a second twin of the page. The literal is
 * judged on both faces. That it type-checks against the published types is
 * `pnpm check:doc-snippets`' answer, which compiles every `ts` fence of the
 * package READMEs against the built `dist/*.d.ts` — not this file's.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';

import { SidebarSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import type { SidebarSchema as Ts_SidebarSchema } from '../navigation';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

/* ── Type-level pins: the `tsc` channel ────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Shape = (typeof SidebarSchema)['shape'];
type InputOf<K extends keyof Shape> = Shape[K] extends z.ZodType ? z.input<Shape[K]> : never;

/**
 * Each retired key READS as `undefined` on the TypeScript face (`?: never`
 * without `exactOptionalPropertyTypes` collapses to `undefined`). `Equal`
 * separates that from the `string` / array / boolean types the keys carried,
 * and from the `any` a deletion would leave behind `BaseSchema`'s index
 * signature.
 */
export type assertionRetiredKeysReadAsTombstones = [
  Expect<Equal<Ts_SidebarSchema['title'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['nav'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['content'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['footer'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['position'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['defaultCollapsed'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['collapsed'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['width'], undefined>>,
  Expect<Equal<Ts_SidebarSchema['collapsedWidth'], undefined>>,
];

/** The zod face agrees: each retired key accepts nothing but absence. */
export type assertionZodFaceAcceptsOnlyAbsence = [
  Expect<Equal<InputOf<'title'>, undefined>>,
  Expect<Equal<InputOf<'nav'>, undefined>>,
  Expect<Equal<InputOf<'content'>, undefined>>,
  Expect<Equal<InputOf<'footer'>, undefined>>,
  Expect<Equal<InputOf<'position'>, undefined>>,
  Expect<Equal<InputOf<'defaultCollapsed'>, undefined>>,
  Expect<Equal<InputOf<'collapsed'>, undefined>>,
  Expect<Equal<InputOf<'width'>, undefined>>,
  Expect<Equal<InputOf<'collapsedWidth'>, undefined>>,
];

/**
 * `variant` is the registration's enum on BOTH faces — the two retired values
 * are not in it — and `collapsible`, the live neighbour, keeps its boolean, so
 * the rows above measure the retired keys and not a file that stopped
 * resolving.
 */
export type assertionVariantIsTheRenderersEnum = [
  Expect<Equal<Ts_SidebarSchema['variant'], 'sidebar' | 'floating' | 'inset' | undefined>>,
  Expect<Equal<InputOf<'variant'>, 'sidebar' | 'floating' | 'inset' | undefined>>,
  Expect<Equal<Ts_SidebarSchema['collapsible'], boolean | undefined>>,
  Expect<Equal<InputOf<'collapsible'>, boolean | undefined>>,
];

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const TEXT = { type: 'text', content: 'Menu' };
const NODE = { type: 'sidebar' as const, children: [TEXT] };
const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares11465';

/** Values the faces used to admit for each retired key, one per former arm. */
const FORMER_VALUES: Record<string, readonly unknown[]> = {
  title: ['Main menu'],
  nav: [[{ label: 'Home', href: '/' }], []],
  content: [TEXT, [TEXT]],
  footer: [TEXT, [TEXT]],
  position: ['left', 'right'],
  defaultCollapsed: [true, false],
  collapsed: [true, false],
  width: ['16rem', 256],
  collapsedWidth: ['4rem', 64],
};

/** What each refusal prescribes instead — the half a bare `z.never()` would drop. */
const PRESCRIBES: Record<string, string> = {
  title: '`children`',
  nav: '`navigation`',
  content: '`children`',
  footer: '`children`',
  position: 'delete the key',
  defaultCollapsed: 'delete the key',
  collapsed: 'delete the key',
  width: 'delete the key',
  collapsedWidth: 'delete the key',
};

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; error?: { issues: Issue[] } };

const strict = StrictAnyComponentSchema as unknown as { safeParse: (v: unknown) => Parse };
const issuesOf = (result: Parse): Issue[] => (result.success ? [] : (result.error?.issues ?? []));
const pathsOf = (result: Parse): string[] => issuesOf(result).map((i) => i.path.map(String).join('.'));

/* ── The `tsc` half on fresh literals ─────────────────────────────────────── */

describe('authoring a retired sidebar key is a `tsc` error (objectui#11465)', () => {
  it('refuses each of the nine — presence is the error, not the value', () => {
    // @ts-expect-error `title` is retired (objectui#11465) — compose a heading in `children`
    const a: Ts_SidebarSchema = { type: 'sidebar', title: 'Main menu' };
    // @ts-expect-error `nav` is retired (objectui#11465) — navigation lives in the app's metadata
    const b: Ts_SidebarSchema = { type: 'sidebar', nav: [{ label: 'Home', href: '/' }] };
    // @ts-expect-error `content` is retired (objectui#11465) — use `children`
    const c: Ts_SidebarSchema = { type: 'sidebar', content: TEXT };
    // @ts-expect-error `footer` is retired (objectui#11465) — the last entries of `children`
    const d: Ts_SidebarSchema = { type: 'sidebar', footer: [TEXT] };
    // @ts-expect-error `position` is retired (objectui#11465)
    const e: Ts_SidebarSchema = { type: 'sidebar', position: 'right' };
    // @ts-expect-error `defaultCollapsed` is retired (objectui#11465) — the provider owns the open state
    const f: Ts_SidebarSchema = { type: 'sidebar', defaultCollapsed: true };
    // @ts-expect-error `collapsed` is retired (objectui#11465) — the provider owns the open state
    const g: Ts_SidebarSchema = { type: 'sidebar', collapsed: false };
    // @ts-expect-error `width` is retired (objectui#11465)
    const h: Ts_SidebarSchema = { type: 'sidebar', width: '16rem' };
    // @ts-expect-error `collapsedWidth` is retired (objectui#11465)
    const i: Ts_SidebarSchema = { type: 'sidebar', collapsedWidth: 64 };
    expect([a, b, c, d, e, f, g, h, i].every((n) => n.type === 'sidebar')).toBe(true);
  });

  it('refuses the two retired `variant` values and admits the three the registration offers', () => {
    // @ts-expect-error `default` is retired (objectui#11465) — write `sidebar`
    const retiredDefault: Ts_SidebarSchema = { type: 'sidebar', variant: 'default' };
    // @ts-expect-error `bordered` is retired (objectui#11465) — write `sidebar`
    const retiredBordered: Ts_SidebarSchema = { type: 'sidebar', variant: 'bordered' };
    const live: Ts_SidebarSchema[] = [
      { type: 'sidebar', variant: 'sidebar' },
      { type: 'sidebar', variant: 'floating' },
      { type: 'sidebar', variant: 'inset' },
    ];
    expect([retiredDefault, retiredBordered, ...live]).toHaveLength(5);
  });
});

/* ── The runtime half: refused by name, with the prescription ─────────────── */

describe('the zod face refuses each retired sidebar key by name (objectui#11465)', () => {
  for (const [key, values] of Object.entries(FORMER_VALUES)) {
    it(`\`${key}\` is refused at its own path on the strict face and the tolerant face, for every former arm`, () => {
      for (const value of values) {
        const doc = { ...NODE, [key]: value };
        expect(pathsOf(strict.safeParse(doc)), `strict, ${key}: ${JSON.stringify(value)}`).toEqual([key]);
        expect(pathsOf(safeValidateSchema(doc) as Parse), `tolerant, ${key}: ${JSON.stringify(value)}`).toEqual([key]);
        expect(pathsOf(SidebarSchema.safeParse(doc) as Parse), `mirror, ${key}: ${JSON.stringify(value)}`).toEqual([key]);
      }
    });

    it(`\`${key}\`'s refusal names the key and the card, and says what to write instead`, () => {
      const [issue] = issuesOf(SidebarSchema.safeParse({ ...NODE, [key]: values[0] }) as Parse);
      expect(issue?.code).toBe('invalid_type');
      expect(issue?.message.startsWith(`RETIRED (objectui#11465, ADR-0049) — \`${key}\` on \`sidebar\``)).toBe(true);
      expect(issue?.message).toContain('Instead:');
      expect(issue?.message).toContain(PRESCRIBES[key]);
    });
  }

  it('lit control: the same document without the keys parses on every face, and an undeclared key stays green on the tolerant one', () => {
    expect(issuesOf(strict.safeParse(NODE))).toEqual([]);
    expect(issuesOf(safeValidateSchema(NODE) as Parse)).toEqual([]);
    expect(issuesOf(SidebarSchema.safeParse({ ...NODE, [UNKNOWN_KEY]: 'x' }) as Parse)).toEqual([]);
  });

  it('the keys the node DOES read still parse (what the refusals point at)', () => {
    const doc = { ...NODE, collapsible: false, variant: 'floating', className: 'border-r' };
    expect(issuesOf(strict.safeParse(doc))).toEqual([]);
    expect(issuesOf(safeValidateSchema(doc) as Parse)).toEqual([]);
  });
});

describe('`variant` takes the renderer\'s enum (objectui#11465)', () => {
  it.each(['sidebar', 'floating', 'inset'])('`%s` validates on the strict face and the tolerant face', (variant) => {
    const doc = { ...NODE, variant };
    expect(issuesOf(strict.safeParse(doc))).toEqual([]);
    expect(issuesOf(safeValidateSchema(doc) as Parse)).toEqual([]);
  });

  it.each(['default', 'bordered'])('`%s` is refused at `variant` on every face, pointed at `sidebar`', (variant) => {
    const doc = { ...NODE, variant };
    expect(pathsOf(strict.safeParse(doc))).toEqual(['variant']);
    expect(pathsOf(safeValidateSchema(doc) as Parse)).toEqual(['variant']);
    const [issue] = issuesOf(SidebarSchema.safeParse(doc) as Parse);
    expect(issue?.code).toBe('invalid_value');
    expect(issue?.message).toContain(`\`'${variant}'\``);
    expect(issue?.message).toContain('objectui#11465');
    expect(issue?.message).toContain("write `'sidebar'`");
  });
});

/* ── The README leg ───────────────────────────────────────────────────────── */

const README = join(uiRoot(), 'packages/types/README.md');
const HEADING = '### 4. Composable';
const OPENER = 'const sidebar: SidebarSchema = {';

/**
 * The `sidebar` literal of the README's "4. Composable" example, as source
 * text. Bounded to its own section, and scanned with brace-depth tracking so a
 * nested `children[]` cannot end the span early. A moved heading or a renamed
 * binding throws rather than passing on an empty fixture.
 */
function readmeSidebarLiteral(): string {
  const src = readFileSync(README, 'utf8');
  const heading = src.indexOf(`\n${HEADING}\n`);
  if (heading < 0) throw new Error(`no "${HEADING}" heading in ${README}`);
  const next = src.indexOf('\n### ', heading + HEADING.length + 1);
  const section = next < 0 ? src.slice(heading) : src.slice(heading, next);
  const start = section.indexOf(OPENER);
  if (start < 0) throw new Error(`no \`${OPENER}\` under "${HEADING}" in ${README}`);
  let depth = 0;
  for (let i = start + OPENER.length - 1; i < section.length; i += 1) {
    if (section[i] === '{') depth += 1;
    else if (section[i] === '}') {
      depth -= 1;
      if (depth === 0) return section.slice(start + OPENER.length - 1, i + 1);
    }
  }
  throw new Error(`unbalanced braces in the README's \`sidebar\` literal (${README})`);
}

/**
 * The literal evaluated as JavaScript — which reads its quoting and trailing
 * commas the way a reader's editor does. Not wrapped in a try/catch: the
 * evaluator's own error names what it could not read.
 */
const README_SIDEBAR = new Function(`return (${readmeSidebarLiteral()});`)() as Record<string, unknown>;

describe("the types README's sidebar example (objectui#11465)", () => {
  it('is a `sidebar` node that composes through `children`, and authors none of the nine retired keys', () => {
    expect(README_SIDEBAR.type).toBe('sidebar');
    expect(Array.isArray(README_SIDEBAR.children) && (README_SIDEBAR.children as unknown[]).length).toBeGreaterThan(0);
    expect(Object.keys(README_SIDEBAR).filter((k) => k in FORMER_VALUES)).toEqual([]);
  });

  it('validates on the strict face and the tolerant face', () => {
    expect(issuesOf(strict.safeParse(README_SIDEBAR))).toEqual([]);
    expect(issuesOf(safeValidateSchema(README_SIDEBAR) as Parse)).toEqual([]);
  });

  it('CONTROL: the example the README taught before is refused, so the leg above is a measurement', () => {
    const before = { type: 'sidebar', nav: [{ label: 'Home', href: '/' }] };
    expect(pathsOf(strict.safeParse(before))).toEqual(['nav']);
    expect(pathsOf(safeValidateSchema(before) as Parse)).toEqual(['nav']);
  });
});
