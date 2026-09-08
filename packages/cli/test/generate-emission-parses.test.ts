// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#16541) — what `os generate <type> <name>` would write must PARSE, and
 * the check that decides it is the one the command actually runs.
 *
 * ## The defect
 *
 * `generate.ts` ran NO name validation at all — no `validateProjectName`, no
 * sanitiser — so its accepted set was strictly wider than `os create`'s, and
 * the name went into a binding position untouched:
 *
 *     os generate object foo.bar          exit 0
 *     src/objects/foo.bar.object.ts   ->  const foo.bar: Data.ServiceObject = {
 *     src/objects/index.ts            ->  export { default as foo.bar } from './foo.bar.object';
 *
 * One name, TWO broken files, and a command that reported success. The blast
 * radius is 14 emission sites across 7 generators plus the barrel the command
 * rewrites, which is why the refusal lives at the single point where the name
 * has finished being derived rather than at each site.
 *
 * ## ⛔ What this pin deliberately does NOT assert
 *
 * It does not assert any charset, and it does not assert a MAPPING from a name
 * to a repaired identifier. `os create`'s sibling pin
 * (`create-plugin-identifier-parses.test.ts`, #15892) does assert a mapping,
 * because a maintainer ruling gave it one. No such ruling exists for
 * `os generate`, whose starting point (no gate at all) differs from
 * `create`'s (an npm-charset gate) — so the only property pinned here is the
 * one that needs no adjudication: the command must not exit 0 having written
 * TypeScript the compiler cannot parse. A future ruling may ADD a sanitiser or
 * a gate on top; it must not turn this file green by making the refusal quiet.
 *
 * ## Why the roster is derived
 *
 * `GENERATOR_SCAFFOLD_TARGETS` is built from `GENERATORS` itself, so a
 * generator added tomorrow is measured by this file on the day it lands rather
 * than the day someone remembers to extend a list. The barrel line is rebuilt
 * from `metadataFileName` for the same reason.
 *
 * ## The controls, and why there are three
 *
 * A parse check that resolves nothing reports zero diagnostics and reads
 * exactly like a pass, so a green here is only worth something if the same
 * instrument can be made to fail:
 *
 *   - CONTROL — `order-line` must produce ZERO failures for every generator,
 *     and must still emit `orderLine`. This half is what a fix that narrowed
 *     acceptance too far would break, and a parse-only assertion would not
 *     notice.
 *   - CANARY — `foo.bar`, the card's measured name, must produce a failure for
 *     every generator AND for the barrel line. This is the reading that proves
 *     the harness is wired to real bytes.
 *   - DISCRIMINATOR — `class`. A rule written about identifier CHARACTERS
 *     passes it (every character is a letter) and a rule written about
 *     reserved words refuses it everywhere. Neither is right: what the emitted
 *     bytes do with it differs per generator and per emission position, and
 *     this row records the compiler's answer rather than an opinion.
 */

import { describe, expect, it } from 'vitest';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { metadataFileName } from '../src/utils/metadata-file-name.js';
import { findEmissionParseFailures } from '../src/utils/emitted-source-parses.js';

/**
 * `toSnakeCase` as `generate.ts` spells it. Restated rather than exported
 * because exporting it would widen the command module's public surface for a
 * test's convenience; it is three characters of regex and it is pinned by the
 * filename assertion below, which fails if the two ever disagree.
 */
function toSnakeCase(str: string): string {
  return str.replace(/[-]/g, '_').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, '');
}

/** `toCamelCase` as `generate.ts` spells it — hyphen AND underscore. */
function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The two emissions one `os generate <type> <name>` produces, built the way
 * the command builds them.
 */
function emissionsFor(type: string, generate: (name: string) => string, name: string) {
  const fileName = metadataFileName(type, toSnakeCase(name));
  if (fileName === null) throw new Error(`no file naming convention for type: ${type}`);
  const moduleSpecifier = `./${fileName.replace(/\.ts$/, '')}`;
  return {
    fileName,
    scaffold: { label: fileName, source: generate(name) },
    barrel: {
      label: 'index.ts',
      source: `export { default as ${toCamelCase(name)} } from '${moduleSpecifier}';`,
    },
  };
}

const ROSTER = GENERATOR_SCAFFOLD_TARGETS.map((t) => ({ type: t.type, generate: t.generate }));

describe('[#16541] the roster this pin runs over is derived from GENERATORS', () => {
  it('covers the seven scaffolding subcommands, and any added later', () => {
    // Not a frozen list: the assertion is that the derived roster is non-empty
    // and that today's known types are IN it, so a new generator arrives
    // measured rather than unmeasured.
    const types = ROSTER.map((t) => t.type);
    for (const known of ['object', 'view', 'action', 'flow', 'dashboard', 'app', 'skill']) {
      expect(types).toContain(known);
    }
    expect(types.length).toBeGreaterThanOrEqual(7);
  });
});

describe('[#16541] CONTROL — an ordinary name still emits, and still parses', () => {
  it.each(ROSTER)('$type emits parseable TypeScript for `order-line`', async ({ type, generate }) => {
    const { scaffold, barrel } = emissionsFor(type, generate, 'order-line');
    expect(await findEmissionParseFailures([scaffold, barrel])).toEqual([]);
  });

  it.each(ROSTER)('$type still derives `orderLine` — acceptance and output are unmoved', ({ type, generate }) => {
    const { scaffold, barrel } = emissionsFor(type, generate, 'order-line');
    expect(scaffold.source).toContain('orderLine');
    expect(barrel.source).toContain('export { default as orderLine }');
  });

  it.each(ROSTER)('$type leaves the written filename as the registry derives it', ({ type, generate }) => {
    const { fileName } = emissionsFor(type, generate, 'order-line');
    expect(fileName).toContain('order_line');
  });
});

describe('[#16541] CANARY — the card`s measured name is refused, at both emissions', () => {
  it.each(ROSTER)('$type refuses `foo.bar`', async ({ type, generate }) => {
    const { scaffold, barrel } = emissionsFor(type, generate, 'foo.bar');
    const failures = await findEmissionParseFailures([scaffold, barrel]);
    // Both files, not one: a barrel-only or scaffold-only reading would leave
    // half the defect standing.
    expect(failures.map((f) => f.label)).toEqual([scaffold.label, 'index.ts']);
    for (const failure of failures) {
      expect(failure.diagnostics.length, `${type} ${failure.label}`).toBeGreaterThan(0);
    }
  });

  it('reports the exact pre-fix bytes the card measured as broken', async () => {
    const object = ROSTER.find((t) => t.type === 'object');
    if (!object) throw new Error('the `object` generator is gone');
    const { scaffold } = emissionsFor('object', object.generate, 'foo.bar');
    expect(scaffold.source).toContain('const foo.bar: Data.ServiceObject = {');
    const failures = await findEmissionParseFailures([scaffold]);
    expect(failures).toHaveLength(1);
    expect(failures[0].diagnostics.length).toBeGreaterThan(0);
  });
});

describe('[#16541] DISCRIMINATOR — the verdict comes from the compiler, not from a charset', () => {
  /**
   * `class` is every-character-legal and reserved. What the emitted bytes do
   * with it is measured here rather than asserted from the grammar: the
   * verdicts below are the ones `ts` returned for these exact emissions, and a
   * refusal rule written as a character class or as a reserved-word list would
   * disagree with at least one of them.
   */
  it('`class` is refused where it lands in a `const` binding', async () => {
    const object = ROSTER.find((t) => t.type === 'object');
    if (!object) throw new Error('the `object` generator is gone');
    const { scaffold } = emissionsFor('object', object.generate, 'class');
    expect(scaffold.source).toContain('const class:');
    expect(await findEmissionParseFailures([scaffold])).not.toEqual([]);
  });

  it('`class` is accepted where the generator appends a suffix to it', async () => {
    const view = ROSTER.find((t) => t.type === 'view');
    if (!view) throw new Error('the `view` generator is gone');
    const { scaffold } = emissionsFor('view', view.generate, 'class');
    expect(scaffold.source).toContain('const classViews:');
    expect(await findEmissionParseFailures([scaffold])).toEqual([]);
  });
});

describe('[#16541] the check answers about BYTES, so it also sees breakage off the identifier', () => {
  /**
   * A rule about identifier characters would pass both of these: neither name
   * damages the identifier. They damage the string literal and the doc comment
   * the same name is ALSO interpolated into, and the result is the same defect
   * — `exit 0` on a file that is not TypeScript.
   */
  it.each([
    { name: "a'b", why: 'a quote closes the emitted string literal early' },
    { name: 'a*/b', why: 'a comment terminator closes the emitted doc comment early' },
  ])('refuses `$name` ($why)', async ({ name }) => {
    const object = ROSTER.find((t) => t.type === 'object');
    if (!object) throw new Error('the `object` generator is gone');
    const { scaffold } = emissionsFor('object', object.generate, name);
    expect(await findEmissionParseFailures([scaffold])).not.toEqual([]);
  });
});
