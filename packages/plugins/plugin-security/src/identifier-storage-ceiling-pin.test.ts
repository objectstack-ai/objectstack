// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  SnakeCaseIdentifierSchema,
  SystemIdentifierSchema,
  MetadataItemNameSchema,
} from '@objectstack/spec/shared';
import { SysMetadataObject } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';

/**
 * #12144 — the shared identifier schemas ↔ the storage columns that bound them.
 *
 * `packages/spec/src/shared/identifiers.zod.ts` declares the platform's
 * identifier schemas with a floor and a grammar and **no `.max()`** — on
 * purpose: every enforced ceiling on an identifier is the `maxLength` of the
 * column that stores it (refused at the write seam by ObjectQL's
 * record-validator `max_length` check), and the storing columns DISAGREE —
 * 100 for the three config-object name columns this plugin registers
 * (`sys_permission_set.name`, `sys_position.name`, `sys_capability.name`),
 * 255 for `sys_metadata.name`. A single shared `.max()` therefore cannot
 * equal every consumer's enforced ceiling: `.max(100)` would newly refuse
 * `sys_metadata` names in (100, 255] that are legal stored rows today —
 * accept-set narrowing beyond enforced reality, fenced out of #12144's
 * dispatch by triage.
 *
 * This pin links the two surfaces so they cannot drift apart silently, the
 * PR #12143 idiom: the widths are READ off the registration surface
 * (`SecurityPlugin.init()` → the manifest `register({ objects })` call, and
 * the `SysMetadataObject` declaration), never restated inside the assertions
 * that use them. Only the one deliberate value pin restates them, so a width
 * change turns exactly one test red with re-derivation instructions.
 *
 * ## What a red on this file means
 *
 * - The **value pin** red: a storing column's width moved. Re-derive #12144's
 *   table before accepting: does the spec schema still accept everything the
 *   column stores? Do the columns now AGREE on one width? If they all agree,
 *   the long-fenced declared-=-enforced `.max()` may finally be derivable —
 *   that is a spec accept-set change; escalate it, never rider it.
 * - The **width-acceptance pin** red: a `.max()` landed on a shared identifier
 *   schema below the width of a column that stores identifier-class values —
 *   names that are legal stored rows today would now be refused at parse.
 *   That is the exact drift this file exists to catch; fix the spec, not this
 *   pin.
 * - The **storage-owned-ceiling pin** red: a `.max()` landed on a shared
 *   identifier schema at or above the widest storing column. Correct ONLY if
 *   every consuming surface's enforced ceiling equals it — which the value
 *   pin above will already be contradicting while the columns disagree. Prove
 *   the per-surface measurement (#12144's triage fence spells out the burden)
 *   before touching this pin.
 */

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
};

/**
 * The objects `SecurityPlugin` really contributes to a kernel, read off the
 * manifest registration it performs in `init()` — same harness as the
 * sibling `plugin-keyed-text-bounds.test.ts`.
 */
async function registeredObjects(): Promise<AnyObject[]> {
  const captured: AnyObject[] = [];
  const noop = () => {};
  await new SecurityPlugin().init({
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    registerService: noop,
    getService(name: string) {
      if (name === 'manifest') {
        return {
          register(m: { objects?: AnyObject[] }) {
            for (const o of m?.objects ?? []) captured.push(o);
          },
        };
      }
      return undefined;
    },
  } as never);
  return captured;
}

/** The three config-object name columns this plugin registers. */
const PLUGIN_NAME_COLUMNS = ['sys_permission_set', 'sys_position', 'sys_capability'] as const;

/** Read `<object>.name`'s declared width, refusing to answer from absence. */
function nameWidth(o: AnyObject | undefined, label: string): number {
  const w = o?.fields?.name?.maxLength;
  expect(
    typeof w === 'number' && Number.isInteger(w) && w > 0,
    `${label}.name must declare a positive integer maxLength (got ${String(w)}) — ` +
      `without it this pin has no width to link the spec schema against`,
  ).toBe(true);
  return w as number;
}

/** Every measured storing column, width read off its registration surface. */
async function measuredColumns(): Promise<Array<{ column: string; width: number }>> {
  const byName = new Map((await registeredObjects()).map((o) => [o.name, o]));
  const cols = PLUGIN_NAME_COLUMNS.map((n) => ({
    column: `${n}.name`,
    width: nameWidth(byName.get(n), n),
  }));
  cols.push({
    column: 'sys_metadata.name',
    width: nameWidth(SysMetadataObject as unknown as AnyObject, 'sys_metadata'),
  });
  return cols;
}

/**
 * A grammar-valid identifier of exactly `n` characters — a lowercase-letter
 * run satisfies all three schemas' regexes and floors (min 2 / min none).
 */
const validIdentifier = (n: number): string => 'a'.repeat(n);

const IDENTIFIER_SCHEMAS = {
  SnakeCaseIdentifierSchema,
  SystemIdentifierSchema,
  MetadataItemNameSchema,
} as const;

describe('shared identifier schemas ↔ the storage columns that bound them (#12144)', () => {
  it('enumerates a real surface and the probes really measure the schemas — the pin is not vacuous', async () => {
    const objects = await registeredObjects();
    expect(objects.map((o) => o.name)).toEqual(
      expect.arrayContaining([...PLUGIN_NAME_COLUMNS]),
    );

    // Instrument honesty: a string of the same width that VIOLATES the
    // grammar must be refused by every schema, so the acceptance probes
    // below are measuring the schema rather than passing vacuously.
    for (const [label, schema] of Object.entries(IDENTIFIER_SCHEMAS)) {
      expect(
        schema.safeParse('A'.repeat(100)).success,
        `${label} accepted an uppercase 100-char string — the probe instrument is broken`,
      ).toBe(false);
    }
  });

  it('the enforced ceilings, pinned by value — a width change is a #12144 re-derivation moment', async () => {
    // Pinned by VALUE, deliberately (the #12143 idiom's one restatement):
    // these widths are the ENFORCED ceilings on identifier-class values —
    // enforcement lives at the write seam (ObjectQL record-validator,
    // `max_length`), never in the spec schemas, which declare no `.max()`.
    // If one of these reds, a column width moved: re-derive #12144 before
    // accepting — and if the columns now all AGREE on one width, the
    // declared-=-enforced `.max()` that triage fenced may finally be
    // derivable; that is a spec accept-set change to escalate, not a value
    // to tidy here.
    const widths = new Map((await measuredColumns()).map((c) => [c.column, c.width]));
    expect(widths.get('sys_permission_set.name')).toBe(100);
    expect(widths.get('sys_position.name')).toBe(100);
    expect(widths.get('sys_capability.name')).toBe(100);
    expect(widths.get('sys_metadata.name')).toBe(255);
  });

  it('every spec identifier schema accepts a name exactly as wide as each storing column — the #12144 fence, mechanized', async () => {
    // Width read LIVE off the registration surface: a `.max()` on a shared
    // identifier schema below the width of a column that stores this value
    // class would newly refuse names that are legal stored rows today —
    // accept-set narrowing beyond enforced reality. `sys_metadata.name`
    // (255) is the widest and therefore the binding case: a blanket
    // `.max(100)` matching the config-object columns reds here by name.
    for (const { column, width } of await measuredColumns()) {
      for (const [label, schema] of Object.entries(IDENTIFIER_SCHEMAS)) {
        expect(
          schema.safeParse(validIdentifier(width)).success,
          `${label} refused a ${width}-char identifier, the declared width of ${column} — ` +
            `a legal stored row's name no longer parses (#12144: never narrow the spec ` +
            `below a storing column; fix the spec, not this pin)`,
        ).toBe(true);
      }
    }
  });

  it('the ceiling is storage-owned: the spec schemas declare no ceiling of their own', async () => {
    // One character above the WIDEST storing column, width read live. Red
    // here means a `.max()` landed on a shared identifier schema. That is
    // correct ONLY when every consuming surface's enforced ceiling equals
    // it (declared = enforced, per surface, measured) — while the storing
    // columns disagree (see the value pin) no shared `.max()` can be, and
    // the change is the narrowing #12144's triage explicitly fenced.
    // Escalate with the per-surface measurement; do not edit this pin to
    // absorb the red.
    const widest = Math.max(...(await measuredColumns()).map((c) => c.width));
    for (const [label, schema] of Object.entries(IDENTIFIER_SCHEMAS)) {
      expect(
        schema.safeParse(validIdentifier(widest + 1)).success,
        `${label} refused a ${widest + 1}-char identifier — it now declares its own ` +
          `ceiling. The identifier ceiling is storage-owned (#12144); a spec .max() ` +
          `is only correct when every consuming column's enforced width equals it.`,
      ).toBe(true);
    }
  });
});
