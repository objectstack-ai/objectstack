// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression guard for the ADR-0090 P1 rename (sys_role → sys_position). The
// rename half-landed in es-ES and shipped for a month: the object label said
// "Puesto" while the plural said "Puestoes", the description said "contpuesto"
// (the rename caught the unrelated word `control` — con+trol → con+tpuesto), and
// nine leaf values still said "rol" — including one string that says both, in the
// same sentence.
//
// Nothing mechanical caught it: `check:i18n` compares bundle STRUCTURE against
// what the extractor emits and is green either way, and the generator's merge
// mode never rewrites an existing translated leaf, so both drift and damage
// survive a green gate indefinitely. This test is the missing judgement, and it
// is deliberately modelled on `bu-rename-consistency.test.ts` (ADR-0057), which
// exists because that rename half-landed the same way.
//
// Two independent failure modes are asserted, because the damage produced both:
//
//   1. STALE TERM — a leaf still naming the pre-rename concept ("rol", "Role",
//      "角色", "ロール"). Scope is the three renamed objects, walked to every
//      string leaf (labels, descriptions, field help, action confirm text,
//      action-param help) — unlike the ADR-0057 guard this cannot be
//      labels-only, because the damage reached descriptions and help text.
//   2. MALFORMED COMPOUND — a Spanish word that merely CONTAINS "puesto"
//      without being one. `Puestoes` and `contpuesto` are both of this class and
//      neither is a word; a word-level allowlist catches them without tripping
//      on the legitimate Spanish words that do contain the substring
//      (`presupuesto`, `expuesto`, `compuesto`, …).

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';

/** The objects ADR-0090 P1 renamed — the exact surface the rename had to land on. */
const RENAMED_OBJECTS = ['sys_position', 'sys_position_permission_set', 'sys_user_position'];

const LOCALES = [
  // `\b` keeps this off `control` / `controlar`, which legitimately contain "rol".
  { name: 'en', objs: enObjects as Record<string, unknown>, stale: /\brole?s?\b/i },
  { name: 'es-ES', objs: esESObjects as Record<string, unknown>, stale: /\brol(es)?\b/i },
  { name: 'zh-CN', objs: zhCNObjects as Record<string, unknown>, stale: /角色/ },
  { name: 'ja-JP', objs: jaJPObjects as Record<string, unknown>, stale: /ロール/ },
];

/** Every string leaf under `node`, as `[dottedPath, value]`. */
function stringLeaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    stringLeaves(v, path ? `${path}.${k}` : k),
  );
}

describe('ADR-0090 position rename — no stale role term in the renamed objects', () => {
  for (const { name, objs, stale } of LOCALES) {
    for (const objName of RENAMED_OBJECTS) {
      it(`${name}: ${objName} carries no pre-rename term`, () => {
        const obj = objs[objName];
        expect(obj, `${objName} missing from the ${name} bundle`).toBeTruthy();
        const offenders = stringLeaves(obj)
          .filter(([, value]) => stale.test(value))
          .map(([leafPath, value]) => `${objName}.${leafPath} = ${JSON.stringify(value)}`);
        expect(
          offenders,
          `${name}: leaves below still name the pre-rename concept — ADR-0090 renamed ` +
            `sys_role to sys_position, so no translated leaf on these objects may say "role".`,
        ).toEqual([]);
      });
    }
  }
});

// Spanish words that legitimately contain the substring "puesto" but are not it.
// A word containing "puesto" and absent here is find-replace residue, not Spanish.
const LEGITIMATE_PUESTO_WORDS = new Set([
  'puesto',
  'puestos',
  'presupuesto',
  'presupuestos',
  'expuesto',
  'expuestos',
  'supuesto',
  'supuestos',
  'dispuesto',
  'dispuestos',
  'compuesto',
  'compuestos',
  'impuesto',
  'impuestos',
  'propuesto',
  'propuestos',
  'repuesto',
  'repuestos',
  'opuesto',
  'opuestos',
]);

describe('ADR-0090 position rename — es-ES carries no malformed "puesto" compound', () => {
  it('every word containing "puesto" is a real Spanish word', () => {
    const offenders: string[] = [];
    for (const [leafPath, value] of stringLeaves(esESObjects)) {
      // Split on anything that is not a Spanish letter, so punctuation and the
      // machine names embedded in help text do not masquerade as words.
      for (const word of value.split(/[^\p{L}]+/u)) {
        const lower = word.toLowerCase();
        if (lower.includes('puesto') && !LEGITIMATE_PUESTO_WORDS.has(lower)) {
          offenders.push(`${leafPath}: ${JSON.stringify(word)}`);
        }
      }
    }
    expect(
      offenders,
      'malformed "puesto" compounds — these are find-replace residue from the ADR-0090 ' +
        'rename (e.g. "Puestoes" for the plural, or "contpuesto" where the rename ate the ' +
        'unrelated word "control"), not Spanish words.',
    ).toEqual([]);
  });
});
