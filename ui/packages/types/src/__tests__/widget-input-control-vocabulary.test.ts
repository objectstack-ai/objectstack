/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Convergence pin — `WidgetInput.type` USES the shared arm vocabulary
 * (`ComponentInputControlType`) instead of restating it (objectui#5675).
 *
 * ## Why the value assertions are not the pin
 *
 * This is the trap `spec-derived-unions.test.ts` records one file over, and it
 * decides the shape of everything below: **a TS type alias erases at runtime,
 * so a restated union that happens to match is indistinguishable from a derived
 * one.** Every assignability check in this file — and every runtime check of
 * the arm set — passes just as green against eleven literals spelled out inline
 * as it does against the shared declaration. They passed on the defect. They
 * are kept because they are the assertions that state what the type MEANS, and
 * because they are what proves the convergence changed no value; they are not
 * what detects a relapse.
 *
 * What detects a relapse is the SOURCE-TEXT identity pin: `WidgetInput.type` is
 * spelled `ComponentInputControlType`, the name is imported from `./base.js`,
 * and no arm literal is written anywhere in the module's own code. That is the
 * one assertion a member-identical restatement fails, and the ablation proving
 * the contrast is quoted in the PR body.
 *
 * ## Why source text and not `dist/`
 *
 * Same constraint `plugin-component-input-deprecation.test.ts` and
 * `package-exports-manifest.test.ts` record: this repo's per-PR `test` job runs
 * `pnpm test` with NO build of the package under test ahead of it (turbo's
 * `test` task `dependsOn: ["^build"]` — the DEPENDENCY closure, never the
 * package's own build). A test reaching into a fresh `dist/` would be vacuously
 * absent-or-red on a cold cache rather than a signal.
 *
 * ## The third thing pinned here
 *
 * The two divergences this card deliberately did NOT repair — `options` vs
 * `enum`, and the five keys `ComponentInput` carries that this face does not —
 * were recorded in `WidgetInput`'s doc block so the next reader meets a
 * decision instead of an accident. A doc block is the whole deliverable for
 * that half, and nothing else would notice it being deleted, so its load-
 * bearing sentences are pinned too.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ComponentInput, ComponentInputControlType } from '../base.js';
import type { WidgetInput } from '../widget.js';
import { ComponentInputControlTypeSchema } from '../zod/base.zod.js';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const WIDGET_SRC = readFileSync(
  fileURLToPath(new URL('../widget.ts', import.meta.url)),
  'utf8',
);

/** The arm vocabulary, read from the enforced half rather than re-spelled. */
const ARMS = ComponentInputControlTypeSchema.options;

/**
 * `src` with every comment removed, so a scan for "is an arm literal written
 * out in this module" reads the module's CODE and not its prose. The doc block
 * added by this change discusses the vocabulary at length and names keys in
 * backticks; a naive whole-file scan would fail on the documentation of the
 * very convergence it is meant to protect.
 */
function stripComments(src: string): string {
  return mask(src);
}

/** The body of `export interface <name> { … }`, comments removed. */
function interfaceBody(name: string): string {
  const decl = `export interface ${name} {`;
  const at = WIDGET_SRC.indexOf(decl);
  expect(at, `${name} is declared in widget.ts`).toBeGreaterThan(-1);
  const rest = WIDGET_SRC.slice(at + decl.length);
  const end = rest.indexOf('\n}');
  expect(end, `${name}'s declaration is closed`).toBeGreaterThan(-1);
  return stripComments(rest.slice(0, end));
}

/** The declared type of one member of an interface, as written. */
function memberType(iface: string, member: string): string | null {
  const body = interfaceBody(iface);
  const m = new RegExp(`(?:^|\\n)\\s*${member}\\??\\s*:([^;]*);`).exec(body);
  return m ? m[1].trim() : null;
}

describe('WidgetInput.type — identity: the shared declaration, not a copy of it', () => {
  it('is spelled exactly `ComponentInputControlType`', () => {
    // THE pin. A member-identical restatement of the eleven literals satisfies
    // every other assertion in this file and fails only here.
    expect(memberType('WidgetInput', 'type')).toBe('ComponentInputControlType');
  });

  it('imports that name from the module that declares it', () => {
    // Without this, the line above could be satisfied by a local alias in this
    // module restating the arms under the shared name — the same defect wearing
    // the right word.
    expect(WIDGET_SRC).toContain(
      "import type { ComponentInputControlType } from './base.js';",
    );
  });

  it('declares no local alias of the vocabulary', () => {
    expect(stripComments(WIDGET_SRC)).not.toMatch(
      /(?:type|interface)\s+\w*ControlType\w*\s*=/,
    );
  });

  it('writes no arm literal anywhere in the module code', () => {
    // Backstop for the two above: whatever spelling a relapse chose, it has to
    // put the words somewhere. `widget.ts` legitimately carries other string
    // literals (`'module'`, `'inline'`, `'registry'`, the registry event
    // names); none of them is an arm, so this scan is specific.
    const code = stripComments(WIDGET_SRC);
    const written = ARMS.filter((arm) => code.includes(`'${arm}'`));
    expect(written).toEqual([]);
  });
});

describe('WidgetInput.type — value: the convergence changed nothing a widget may declare', () => {
  // Compile-time, and real enforcement: `tsconfig.test.json` is chained from
  // this package's `type-check` script, so these are compiled. They are the
  // assertions that stay GREEN under a member-identical restatement — that is
  // the point of keeping them separate from the pins above, not a weakness.
  const _armsAreLegal = null as unknown as ComponentInputControlType satisfies WidgetInput['type'];
  const _nothingElseIsLegal = null as unknown as WidgetInput['type'] satisfies ComponentInputControlType;

  it('accepts every arm and nothing else (type level)', () => {
    const bothWays: [
      ComponentInputControlType extends WidgetInput['type'] ? true : false,
      WidgetInput['type'] extends ComponentInputControlType ? true : false,
    ] = [true, true];

    expect(bothWays).toEqual([true, true]);
    expect([_armsAreLegal, _nothingElseIsLegal]).toHaveLength(2);
  });

  it('accepts every arm the enforced half declares (runtime witness)', () => {
    // The type erases; the zod enum does not. This is the strongest statement
    // about VALUES that survives to runtime.
    for (const arm of ARMS) {
      const input: WidgetInput = { name: 'probe', type: arm };
      expect(ComponentInputControlTypeSchema.safeParse(input.type).success).toBe(true);
    }
  });

  it('carries the eleven arms, so the convergence neither widened nor narrowed', () => {
    expect([...ARMS].sort()).toEqual(
      [
        'array', 'boolean', 'code', 'color', 'date', 'enum',
        'file', 'number', 'object', 'slot', 'string',
      ],
    );
  });

  it('stays the SINGLE-kind form — the array capability was not granted here', () => {
    // `ComponentInput.type` takes one arm OR an array of arms (objectui#3832).
    // Converging the vocabulary deliberately did not import that capability;
    // this asserts the restraint, so granting it later is a decision someone
    // makes rather than a line that drifts in.
    const isArray: WidgetInput['type'] extends readonly unknown[] ? true : false = false;
    expect(isArray).toBe(false);
    expect(memberType('WidgetInput', 'type')).not.toContain('[]');
  });
});

describe('WidgetInput.type — the seam that made the two vocabularies load-bearing', () => {
  it('is assignable to ComponentInput.type', () => {
    // `WidgetRegistry.load()` in `@object-ui/core` translates a WidgetInput
    // into a ComponentInput and passes `type` straight through. Before the
    // convergence that assignment compiled only because two independently
    // maintained lists happened to agree; now it holds by construction.
    const passesThrough: WidgetInput['type'] extends ComponentInput['type'] ? true : false = true;
    expect(passesThrough).toBe(true);
  });
});

describe('WidgetInput — the divergences left unrepaired stay written down', () => {
  /** The doc block immediately preceding `export interface WidgetInput`. */
  const docBlock = (() => {
    const at = WIDGET_SRC.indexOf('export interface WidgetInput {');
    const before = WIDGET_SRC.slice(0, at);
    const close = before.lastIndexOf('*/');
    const open = before.lastIndexOf('/**', close);
    return before.slice(open, close + 2);
  })();

  it('records that the enum slot is spelled differently on the two faces', () => {
    expect(docBlock).toContain('`options`');
    expect(docBlock).toContain('`enum`');
    expect(docBlock).toContain('ComponentInput');
  });

  it('names each key ComponentInput carries that this face does not', () => {
    for (const key of ['inputType', 'min', 'max', 'step', 'placeholder']) {
      expect(docBlock, `divergence doc names \`${key}\``).toContain(`\`${key}\``);
    }
  });

  it('says the merge was ruled NOT NOW rather than settled', () => {
    // The failure mode this guards is a later reader deleting the block as
    // "resolved" — the question is open, and the block is where it is tracked.
    expect(docBlock).toContain('NOT NOW');
  });
});
