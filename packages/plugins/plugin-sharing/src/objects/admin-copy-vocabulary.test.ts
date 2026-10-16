// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Admin-facing copy of the sharing objects carries no design-record
 * vocabulary.
 *
 * Setup opens two of these objects from Access Control (Sharing Rules and
 * Record Shares); the sentence under each page title is the object's
 * `description`, a field's help tooltip is the field's `description`, and the
 * generated bundles carry both into every locale. An ADR number, a decision
 * id ("D2"), a review-finding id ("finding F2"), an API call ("emit()") or a
 * runtime internal ("kernel") belongs in the docblock next to the string,
 * never in the string. Every object this package ships is judged, not only
 * the two Setup opens: a nav entry added later inherits the rule with nothing
 * to update. (`sys_business_unit` and its member object, which this plugin
 * also registers, are `@objectstack/platform-objects`' and are judged there.)
 *
 * The same rule over the other Setup producers lives in each of them
 * (`@objectstack/platform-objects`' `src/apps/setup-copy-vocabulary.test.ts`,
 * `@objectstack/service-messaging`'s `src/objects/admin-copy-vocabulary.test.ts`);
 * the matcher is restated rather than imported, because a shared assertion
 * module would be one more export for a test to reach across a package for.
 */

import { describe, expect, it } from 'vitest';
import * as SharingObjects from './index.js';
import { enObjects } from '../translations/en.objects.generated.js';
import { zhCNObjects } from '../translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../translations/ja-JP.objects.generated.js';
import { esESObjects } from '../translations/es-ES.objects.generated.js';

/** The design-record vocabulary an admin-facing string must not carry. */
const DESIGN_RECORD_VOCABULARY: ReadonlyArray<readonly [string, RegExp]> = [
  ['an ADR number', /ADR-\d/],
  ['a decision id', /\bD\d+\b/],
  ['a review-finding id', /finding F/],
  ['an API call', /\bemit\(\)/],
  ['a runtime internal', /\bkernel\b/i],
];

function vocabularyIn(text: string): string[] {
  return DESIGN_RECORD_VOCABULARY.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const COPY_KEYS = new Set(['label', 'pluralLabel', 'description']);

function copyStrings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => copyStrings(v, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const at = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      if (COPY_KEYS.has(k)) out.push([at, v]);
    } else {
      copyStrings(v, at, out);
    }
  }
}

function leafStrings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === 'string') {
    out.push([path, node]);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) leafStrings(v, path ? `${path}.${k}` : k, out);
}

function offenders(strings: Array<[string, string]>): string[] {
  return strings
    .map(([at, text]) => [at, text, vocabularyIn(text)] as const)
    .filter(([, , hits]) => hits.length > 0)
    .map(([at, text, hits]) => `${at} (${hits.join(', ')}): ${text}`);
}

type ObjectLike = { name: string; fields: Record<string, unknown> };
function isObjectSchema(v: unknown): v is ObjectLike {
  return !!v && typeof v === 'object'
    && typeof (v as ObjectLike).name === 'string'
    && !!(v as ObjectLike).fields && typeof (v as ObjectLike).fields === 'object';
}

const OBJECT_BUNDLES = { en: enObjects, 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects } as const;

describe('sharing objects: admin-facing copy carries no design-record vocabulary', () => {
  it('the matcher recognises each kind of vocabulary it exists to keep out', () => {
    expect(vocabularyIn('Sharing grant (ADR-0052 §5).')).toEqual(['an ADR number']);
    expect(vocabularyIn('Placement intent, decision D12.')).toEqual(['a decision id']);
    expect(vocabularyIn('Bypass rule (finding F2).')).toEqual(['a review-finding id']);
    expect(vocabularyIn('One row per emit().')).toEqual(['an API call']);
    expect(vocabularyIn('The Kernel API is additive.')).toEqual(['a runtime internal']);
    expect(vocabularyIn('Records shared beyond their owner, one row per grant.')).toEqual([]);
  });

  it('object, field and view copy of every object this package exports', () => {
    const objects: ObjectLike[] = (Object.values(SharingObjects) as unknown[]).filter(isObjectSchema);
    const names = objects.map((o) => o.name);
    for (const name of ['sys_record_share', 'sys_sharing_rule', 'sys_share_link']) {
      expect(names, `${name} is in the population`).toContain(name);
    }
    const strings: Array<[string, string]> = [];
    for (const def of objects) copyStrings(def, def.name, strings);
    expect(offenders(strings)).toEqual([]);
  });

  it.each(Object.keys(OBJECT_BUNDLES))('every leaf of the %s objects bundle', (locale) => {
    const strings: Array<[string, string]> = [];
    leafStrings(OBJECT_BUNDLES[locale as keyof typeof OBJECT_BUNDLES], 'objects', strings);
    expect(strings.length).toBeGreaterThan(100);
    expect(offenders(strings)).toEqual([]);
  });
});
