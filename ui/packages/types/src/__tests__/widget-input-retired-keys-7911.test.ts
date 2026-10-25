/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `WidgetInput.label` / `defaultValue` / `advanced` are ADR-0049 RETIREMENT
 * TOMBSTONES on the widget-manifest face too (objectui#7911, maintainer ruling
 * A of 2026-09-15), so the two input faces in this package now AGREE.
 *
 * ## What was ruled, and what it carried
 *
 * The same three keys were retired on `ComponentInput` first (objectui#7493 /
 * objectui#7781, ruling A of 2026-09-06), and the seam copy that used to carry
 * widget-manifest values onto them went with that retirement. This face held
 * them for one more ruling because a widget manifest is authored OUTSIDE this
 * repository, which makes the in-repo zero only half the question. Ruling A of
 * 2026-09-15 carried the retirement here anyway; option B (keep and document as
 * inert) was refused and option C (give the manifest face a runtime mirror) was
 * not opened.
 *
 * ## ⚠️ What this tombstone does NOT buy — the limit is pinned, not assumed
 *
 * `WidgetInput` has NO zod mirror (pinned below, against a live `ComponentInput`
 * control), so unlike the `ComponentInput` retirement — which pairs `?: never`
 * with a `retirementTombstone()` parse refusal — this one is a `tsc` error at a
 * TypeScript authoring site and NOTHING ELSE. Nothing in this repository parses
 * or validates a widget manifest: `WidgetRegistry` deserializes nothing and
 * validates nothing, it just reads five keys off whatever object it was handed.
 * ⇒ an out-of-repo author who writes `label` in JSON gets exactly what they got
 * before the retirement — the key is ignored, silently. That is the stated cost
 * of ruling A, and the reason option C exists as a separate, unopened card.
 *
 * ⇒ ⛔ Do not read a green run of this file as "nobody writes these keys".
 * It asserts that nothing in THIS REPOSITORY reads or may author them. The
 * out-of-repo population is not measurable from here and was never measured.
 *
 * ## The instruments, and why each carries a control
 *
 * Every absence below is paired with a reading on the SAME instrument that
 * fires, because a bare zero is indistinguishable from a broken scan: the
 * interface-body reads check the five live members, the zod-mirror scan checks
 * `ComponentInput`, and the tree walk checks `manifest.type`.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening a
 * declaration fails the build on the now-unused directive.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { RuntimeWidgetManifest, WidgetInput } from '../widget.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const WIDGET_SRC = readFileSync(resolve(HERE, '../widget.ts'), 'utf8');

/** The three keys ruling A retired on this face. */
const RETIRED = ['label', 'defaultValue', 'advanced'] as const;

/** The five members that stay live, and that `WidgetRegistry.load()` forwards. */
const LIVE = ['name', 'type', 'required', 'options', 'description'] as const;

/** The body of `export interface WidgetInput { … }`, as written. */
const WIDGET_INPUT_BODY = (() => {
  const decl = 'export interface WidgetInput {';
  const at = WIDGET_SRC.indexOf(decl);
  expect(at, '`WidgetInput` is declared in widget.ts').toBeGreaterThan(-1);
  const rest = WIDGET_SRC.slice(at + decl.length);
  const end = rest.indexOf('\n}');
  expect(end, "`WidgetInput`'s declaration is closed").toBeGreaterThan(-1);
  return rest.slice(0, end);
})();

/** The declared type of one member, as written (`null` when absent). */
function memberType(member: string): string | null {
  const m = new RegExp(`\\n\\s{2}${member}\\??\\s*:([^;]*);`).exec(WIDGET_INPUT_BODY);
  return m ? m[1].trim() : null;
}

/* ── direction 1: authoring a retired key is a `tsc` error ───────────────── */

describe('the tombstones make authoring a `tsc` error (objectui#7911)', () => {
  it('refuses each retired key on a bare widget input', () => {
    const input: WidgetInput = {
      name: 'title',
      type: 'string',
      // @ts-expect-error `label` is a retirement tombstone (objectui#7911)
      label: 'Title',
      // @ts-expect-error `defaultValue` is a retirement tombstone (objectui#7911)
      defaultValue: 'Untitled',
      // @ts-expect-error `advanced` is a retirement tombstone (objectui#7911)
      advanced: true,
    };
    expect(input.name).toBe('title');
  });

  it("refuses them through the manifest door too — and the MANIFEST's own `label` stays live", () => {
    // `RuntimeWidgetManifest.label` is a different key on a different type: it
    // is read by `WidgetRegistry.load()` and forwarded to the component
    // registry. Retiring the INPUT-level `label` must not touch it, and this
    // assertion is what says so.
    const manifest: RuntimeWidgetManifest = {
      name: 'custom-chart',
      version: '1.0.0',
      type: 'chart',
      label: 'Custom Chart',
      source: { type: 'inline', component: () => null },
      inputs: [
        {
          name: 'mode',
          type: 'enum',
          options: ['bar', 'line'],
          // @ts-expect-error `defaultValue` is a retirement tombstone (objectui#7911)
          defaultValue: 'bar',
        },
      ],
    };
    expect(manifest.label).toBe('Custom Chart');
  });
});

/* ── direction 2: the five live keys are untouched (the control) ─────────── */

describe('the retirement is key-specific, not a narrowing of the face', () => {
  it('still admits every forwarded key at once', () => {
    const input: WidgetInput = {
      name: 'mode',
      type: 'enum',
      required: true,
      options: [{ label: 'Bar', value: 'bar' }],
      description: 'How to draw the series',
    };
    expect(Object.keys(input).sort()).toEqual([...LIVE].sort());
  });

  it.each(LIVE)('`%s` is declared with a real type, not `never`', (key) => {
    const declared = memberType(key);
    expect(declared, `\`${key}\` is declared on WidgetInput`).not.toBeNull();
    expect(declared).not.toBe('never');
  });
});

/* ── direction 3: the declaration is a TOMBSTONE, not a deletion ─────────── */

describe('each retired key stays DECLARED and unwritable', () => {
  it.each(RETIRED)('`%s` is spelled `?: never`', (key) => {
    // Deleting the member instead would leave the key undeclared, and an
    // undeclared key on an interface is not an error an author ever sees —
    // excess-property checking only fires on a fresh object literal, and the
    // manifest that matters arrives as JSON from outside anyway. The tombstone
    // is what makes the refusal loud AND named at the one authoring site this
    // repository controls.
    expect(WIDGET_INPUT_BODY).toContain(`${key}?: never;`);
    expect(memberType(key)).toBe('never');
  });

  it.each(RETIRED)('`%s` carries a named migration note, not a bare `never`', (key) => {
    const at = WIDGET_INPUT_BODY.indexOf(`${key}?: never;`);
    const doc = WIDGET_INPUT_BODY.slice(Math.max(0, at - 1400), at);
    const block = doc.slice(doc.lastIndexOf('/**'));
    expect(block, `\`${key}\` names the ruling that retired it`).toContain('objectui#7911');
    expect(block, `\`${key}\` names the ADR`).toContain('ADR-0049');
    expect(block, `\`${key}\` is marked deprecated for editor surfacing`).toContain('@deprecated');
  });
});

/* ── direction 4: WHY they are dead — the seam forwards five keys ─────────── */

describe('the seam that made them dead, re-derived rather than remembered', () => {
  const SEAM = readFileSync(
    resolve(ROOT, 'packages/core/src/registry/WidgetRegistry.ts'),
    'utf8',
  );

  it('`WidgetRegistry.load()` forwards exactly the five live keys', () => {
    const at = SEAM.indexOf('inputs: manifest.inputs?.map((input) => ({');
    expect(at, 'the widget → component input seam is where it was').toBeGreaterThan(-1);
    const body = SEAM.slice(at, SEAM.indexOf('})),', at));
    const read = [...body.matchAll(/\binput\.(\w+)\b/g)].map((m) => m[1]).sort();
    // An EQUALITY, not a subset: a seam that quietly started forwarding a
    // retired key would make this red, and so would one that dropped a live one.
    expect(read).toEqual([...LIVE].sort());
  });

  it('is the only consumer of a manifest `inputs` array in the tree', () => {
    // This pin is skipped by path, with the reason: it NAMES the receiver in
    // its own assertion text above, so it matches its own scan.
    const SELF = resolve(
      ROOT,
      'packages/types/src/__tests__/widget-input-retired-keys-7911.test.ts',
    );
    const files = [...sourceFiles()].filter((f) => f !== SELF);
    expect(files.length, 'the walk found a corpus').toBeGreaterThan(500);

    const readers = files.filter((f) => /\bmanifest\.inputs\b/.test(readFileSync(f, 'utf8')));
    // Control on the SAME walk: a manifest member that IS read in more than one
    // place. A zero here would mean the walk missed the corpus, not that the
    // tree is clean.
    const control = files.filter((f) => /\bmanifest\.type\b/.test(readFileSync(f, 'utf8')));
    expect(control.length, 'control `manifest.type` fires').toBeGreaterThan(0);

    expect(readers.map((f) => relative(ROOT, f))).toEqual([
      'packages/core/src/registry/WidgetRegistry.ts',
    ]);
  });
});

/* ── direction 5: the LIMIT — this face has no runtime mirror ─────────────── */

describe('the retirement has ONE face, and that is pinned so nobody assumes two', () => {
  const ZOD_DIR = resolve(ROOT, 'packages/types/src/zod');
  const ZOD_SRC = readdirSync(ZOD_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(ZOD_DIR, f), 'utf8'))
    .join('\n');

  it('no zod mirror restates `WidgetInput`, while `ComponentInput` has one', () => {
    // This is the reading ruling A relied on: there is no runtime face to move,
    // so the retirement could not be given a `retirementTombstone()` refusal the
    // way objectui#7493's was. If a mirror ever appears, this goes red and the
    // retirement acquires a second face that has to be dealt with.
    expect(ZOD_SRC).not.toContain('WidgetInput');
    expect(ZOD_SRC, 'control: the sibling face IS mirrored').toContain('ComponentInput');
  });

  it('`WidgetRegistry` neither parses nor validates what it is handed', () => {
    const SEAM = readFileSync(
      resolve(ROOT, 'packages/core/src/registry/WidgetRegistry.ts'),
      'utf8',
    );
    // The consequence stated in the header: a JSON manifest never meets this
    // type at runtime, so `?: never` cannot change what a manifest is allowed
    // to carry — only what a TypeScript author may write.
    for (const sink of ['JSON.parse', 'safeParse', 'zod']) {
      expect(SEAM, `\`${sink}\` is absent from the widget loader`).not.toContain(sink);
    }
    expect(SEAM, 'control: the loader is the file we think it is').toContain(
      'class WidgetRegistry',
    );
  });
});

/* ── direction 6: the docblock records the agreement, and the limit ──────── */

describe("the divergence docblock says the two faces now AGREE", () => {
  const docBlock = (() => {
    const at = WIDGET_SRC.indexOf('export interface WidgetInput {');
    const before = WIDGET_SRC.slice(0, at);
    const close = before.lastIndexOf('*/');
    return before.slice(before.lastIndexOf('/**', close), close + 2);
  })();

  it('no longer claims the three keys stay writable here', () => {
    expect(docBlock).not.toContain('stay declared and WRITABLE here');
  });

  it('records the agreement and names the ruling that produced it', () => {
    expect(docBlock).toContain('BOTH FACES AGREE');
    expect(docBlock).toContain('objectui#7911');
  });

  it('keeps the limit visible: no runtime face, so an out-of-repo author sees nothing', () => {
    // The failure mode this guards is a later reader concluding from the
    // tombstones that the manifest face now refuses these keys at runtime.
    expect(docBlock).toContain('no zod mirror');
    expect(docBlock).toContain('silently');
  });
});

/* ── the walk ────────────────────────────────────────────────────────────── */

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

/** Every `.ts`/`.tsx` under `packages/STAR/src` and `apps/STAR/src` (STAR spelled
 * out because a glob inside a doc comment reads as a comment terminator). */
function* sourceFiles(): Generator<string> {
  for (const parent of ['packages', 'apps']) {
    const parentDir = resolve(ROOT, parent);
    for (const pkg of readdirSync(parentDir)) {
      const src = join(parentDir, pkg, 'src');
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      yield* walk(src);
    }
  }
}
