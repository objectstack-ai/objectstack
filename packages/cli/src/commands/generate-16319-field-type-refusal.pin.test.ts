// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16319 — no generator in this file guesses a field's column family any more.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2), verbatim:
 * 「16319 一个没写 type(或拼错)的字段 应该禁止加载。这个才是合理的吧?其他同意」
 * — item 3: 「下游默认值全部改拒绝: … 两个迁移生成器与 `os generate types` 的
 * `|| 'text'` 一律改为响亮拒绝 … ⛔ 不再猜族」.
 *
 * ## What the retired default cost
 *
 * All four loops read `String(fieldDef.type || 'text')`. That put a typeless
 * field in the TEXT family while `SqlDriver.createColumn`'s own `field.type ||
 * 'string'` put the SAME declaration in the STRING family. Measured on the card
 * against live PostgreSQL 16.13:
 *
 * ```
 *                                driver                  sql gen   ts gen
 *   { maxLength: 100 }           character varying(100)  text      text
 *   { type: 'this_is_not_a_
 *     field_type', maxLength:100} character varying(255)  text      text
 * ```
 *
 * Both directions of harm are in the first row: the platform refuses a
 * 101-character value that both generated tables accept.
 *
 * ## Why the generators refuse BOTH shapes and the driver refuses one
 *
 * A generator reads a config FILE and never touches the registry, so here the
 * refusal is the only door there is. `SqlDriver.createColumn` sits behind
 * `SchemaRegistry.registerObject`, which refuses a non-member for the whole
 * object — the ruling's single point of closure, and what its acceptance list
 * means by 「驱动永远到不了」.
 *
 * ⛔ The file, not the field: emitting a table one column short is the same
 * silent loss the ruling refuses at the registration door, one artifact left.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateTypesFromConfig,
  generateMigrationSql,
  generateMigrationTs,
} from './generate.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const configWith = (probe: Record<string, unknown>) => ({
  objects: {
    probe_object: {
      name: 'probe_object',
      label: 'Probe',
      fields: {
        title: { type: 'text', label: 'Title' },
        probe: { label: 'Probe', ...probe },
      },
    },
  },
});

const NO_TYPE = { maxLength: 100 };
const BAD_TYPE = { type: 'this_is_not_a_field_type', maxLength: 100 };
const CONTROL = { type: 'email', maxLength: 100 };

const GENERATORS: Array<[string, (c: Record<string, unknown>) => string]> = [
  ['os generate types', generateTypesFromConfig],
  ['os generate migration --format sql', generateMigrationSql],
  ['os generate migration --format ts', generateMigrationTs],
];

describe('#16319 — every exported generator refuses an undeclarable field `type`', () => {
  for (const [label, generate] of GENERATORS) {
    it(`${label} refuses a field with NO \`type\`, naming object + field + reason`, () => {
      let thrown: any;
      try { generate(configWith(NO_TYPE) as any); } catch (e) { thrown = e; }
      expect(thrown, `${label} must refuse`).toBeDefined();
      expect(thrown.message).toContain("object 'probe_object'");
      expect(thrown.message).toContain("field 'probe'");
      expect(thrown.message).toContain('declares no `type`');
      expect(thrown.message).toContain('Nothing is generated for this object');
    });

    it(`${label} refuses a NON-MEMBER \`type\` the same way`, () => {
      let thrown: any;
      try { generate(configWith(BAD_TYPE) as any); } catch (e) { thrown = e; }
      expect(thrown, `${label} must refuse`).toBeDefined();
      expect(thrown.message).toContain("'this_is_not_a_field_type'");
      expect(thrown.message).toContain('is not a member of `FieldType`');
    });

    it(`POSITIVE CONTROL — ${label} still emits for the same object with a \`FieldType\` member`, () => {
      const out = generate(configWith(CONTROL) as any);
      // ⛔ Not merely "did not throw": the probe column has to be IN the output,
      // or a generator that silently dropped the field would pass this control.
      expect(out).toContain('probe');
      expect(out).toContain('title');
    });
  }

  it('⛔ refuses the FILE, not the field — no partial artifact is produced', () => {
    // Every generator throws before returning, so there is no half-written
    // artifact to inspect: the assertion is that nothing comes back at all.
    for (const [, generate] of GENERATORS) {
      expect(() => generate(configWith(NO_TYPE) as any)).toThrow();
    }
  });

  it('SOURCE PIN — all FOUR loops read `declaredFieldType`, and no `|| \'text\'` default survives', () => {
    // The fourth loop (`generateClientFromConfig`) is not exported, so its call
    // site is pinned here rather than driven. Reading this package's OWN source
    // through an `import.meta.url` seed — the spelling
    // `pnpm check:cross-package-test-inputs` recognises.
    const src = readFileSync(resolve(HERE, 'generate.ts'), 'utf8');
    const callSites = src.match(/const fType = declaredFieldType\(/g) ?? [];
    expect(callSites.length).toBe(4);
    // The retired default, gone from every executable line. Occurrences that
    // remain are prose in comments — the control below proves the probe can see
    // a real one, so the zero is a reading and not an empty walk.
    const executable = src
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    expect(executable.filter((l) => l.includes("|| 'text'")).length).toBe(0);
    expect(executable.filter((l) => l.includes('declaredFieldType(')).length).toBeGreaterThan(0);
  });
});
