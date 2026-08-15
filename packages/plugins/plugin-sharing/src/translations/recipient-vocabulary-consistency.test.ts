// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Recipient-vocabulary guard for the ADR-0090 P1 rename (sys_role → sys_position),
// the plugin-sharing half of #8735.
//
// `sys_record_share` and `sys_sharing_rule` describe the SAME recipient
// vocabulary — both carry a `recipient_type` picklist over the same principal
// kinds. The rename landed on `sys_sharing_rule` and was missed on
// `sys_record_share`, so for a month the es-ES bundle rendered one enum key two
// different ways in one file: `position` was "Puesto" in the rule object and
// "posición" in the share object, and `unit_and_subordinates` was "Unidad de
// negocio y subordinados" in one and "Rol y subordinados" — naming the
// pre-rename *role* concept — in the other. An admin switching between the two
// screens saw two different words for one thing.
//
// Nothing mechanical caught it: `check:i18n` compares bundle STRUCTURE against
// what the extractor emits and is green either way, and the generator's merge
// mode never rewrites an existing translated leaf (#8543), so a half-landed
// rename survives a green gate indefinitely.
//
// The invariant asserted here is the one that would have caught it, and it needs
// no per-string judgement: within one locale, an option key shared by more than
// one object must render identically everywhere it appears. That is a fact about
// self-consistency, not a translation-quality opinion, so it stays reviewable by
// someone who does not read the locale.

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';

const LOCALES: Array<[string, Record<string, unknown>]> = [
  ['en', enObjects as Record<string, unknown>],
  ['es-ES', esESObjects as Record<string, unknown>],
  ['zh-CN', zhCNObjects as Record<string, unknown>],
  ['ja-JP', jaJPObjects as Record<string, unknown>],
];

/**
 * `field.optionKey` → the distinct renderings seen for it, each tagged with the
 * object it came from. Walks `<object>.fields.<field>.options.<key>` only, which
 * is where the picklist vocabulary lives.
 */
function optionRenderings(objs: Record<string, unknown>): Map<string, Map<string, string[]>> {
  const seen = new Map<string, Map<string, string[]>>();
  for (const [objName, obj] of Object.entries(objs)) {
    const fields = (obj as { fields?: Record<string, unknown> })?.fields;
    if (!fields || typeof fields !== 'object') continue;
    for (const [fieldName, field] of Object.entries(fields)) {
      const options = (field as { options?: Record<string, unknown> })?.options;
      if (!options || typeof options !== 'object') continue;
      for (const [optKey, value] of Object.entries(options)) {
        if (typeof value !== 'string') continue;
        const id = `${fieldName}.${optKey}`;
        const byValue = seen.get(id) ?? new Map<string, string[]>();
        byValue.set(value, [...(byValue.get(value) ?? []), objName]);
        seen.set(id, byValue);
      }
    }
  }
  return seen;
}

describe('ADR-0090 — shared recipient vocabulary renders consistently (#8735)', () => {
  for (const [locale, objs] of LOCALES) {
    it(`${locale}: an option key shared by several objects has one rendering`, () => {
      const conflicts: string[] = [];
      for (const [id, byValue] of optionRenderings(objs)) {
        if (byValue.size < 2) continue;
        const shown = [...byValue]
          .map(([value, owners]) => `${owners.join('+')}=${JSON.stringify(value)}`)
          .join('  vs  ');
        conflicts.push(`${id}: ${shown}`);
      }
      expect(
        conflicts,
        `${locale}: the same picklist option key renders differently across objects. ` +
          'Both sharing objects describe one recipient vocabulary, so a key that disagrees ' +
          'with itself means a rename landed on one object and was missed on the other ' +
          '(ADR-0090 renamed sys_role to sys_position). Pick the rendering the renamed ' +
          'concept actually uses and make both objects say it.',
      ).toEqual([]);
    });
  }
});

// The en bundle contains no "role" at all — the concept is `position` throughout —
// so any surviving `rol` in the Spanish bundle is a missed rename, not a
// legitimate word. `\b` keeps this off `control` / `controlar`, which contain
// "rol" innocently.
describe('ADR-0090 — es-ES carries no pre-rename "rol" (#8735)', () => {
  it('no leaf in the es-ES bundle still names the role concept', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (/\brol(es)?\b/i.test(node)) offenders.push(`${path} = ${JSON.stringify(node)}`);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(esESObjects, '');
    expect(
      offenders,
      'es-ES leaves still naming the pre-rename concept — the en bundle for this package ' +
        'contains no "role" anywhere, so every one of these is a missed ADR-0090 rename.',
    ).toEqual([]);
  });
});
