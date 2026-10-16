// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Admin-facing copy of the automation objects carries no design-record
 * vocabulary.
 *
 * The sentence under an object page's title is the object's `description`,
 * and a field's help tooltip is the field's `description`. An ADR number, a
 * decision id ("D2"), a review-finding id ("finding F2"), an API call
 * ("emit()") or a runtime internal ("kernel") belongs in the docblock next to
 * the string, never in the string. Setup has no nav entry for these objects
 * today; every object this package ships is judged anyway, so a page or nav
 * entry added later inherits the rule with nothing to update. This package
 * generates no translation bundle, so there is no bundle leg here.
 *
 * The same rule over the other Setup producers lives in each of them
 * (`@objectstack/platform-objects`' `src/apps/setup-copy-vocabulary.test.ts`,
 * `@objectstack/service-messaging`'s `src/objects/admin-copy-vocabulary.test.ts`);
 * the matcher is restated rather than imported, because a shared assertion
 * module would be one more export for a test to reach across a package for.
 */

import { describe, expect, it } from 'vitest';
import * as Automation from './index.js';

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

describe('automation objects: admin-facing copy carries no design-record vocabulary', () => {
  it('the matcher recognises each kind of vocabulary it exists to keep out', () => {
    expect(vocabularyIn('Live suspended runs (resumable, ADR-0019).')).toEqual(['an ADR number']);
    expect(vocabularyIn('Placement intent, decision D12.')).toEqual(['a decision id']);
    expect(vocabularyIn('Bypass rule (finding F2).')).toEqual(['a review-finding id']);
    expect(vocabularyIn('One row per emit().')).toEqual(['an API call']);
    expect(vocabularyIn('Never re-launched by a rebuilt kernel.')).toEqual(['a runtime internal']);
    expect(vocabularyIn('Paused automation runs waiting to resume.')).toEqual([]);
  });

  it('object, field and view copy of every object this package exports', () => {
    const objects: ObjectLike[] = (Object.values(Automation) as unknown[]).filter(isObjectSchema);
    const names = objects.map((o) => o.name);
    for (const name of ['sys_automation_run', 'sys_flow_dispatch', 'sys_flow_credential']) {
      expect(names, `${name} is in the population`).toContain(name);
    }
    const strings: Array<[string, string]> = [];
    for (const def of objects) copyStrings(def, def.name, strings);
    expect(offenders(strings)).toEqual([]);
  });
});
