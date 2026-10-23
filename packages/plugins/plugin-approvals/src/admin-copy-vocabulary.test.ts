// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Admin-facing copy of the approval objects carries no design-record
 * vocabulary.
 *
 * Setup opens three of these objects from its Approvals group (Requests,
 * Action History and Delegations); the sentence under each page title is the
 * object's `description`, a field's help tooltip is the field's
 * `description`, and the generated bundles carry both into every locale. An
 * ADR number, a decision id ("D2"), a review-finding id ("finding F2"), an
 * API call ("emit()") or a runtime internal ("kernel") belongs in the
 * docblock next to the string, never in the string. Every object this package
 * ships is judged, not only the three Setup opens: a nav entry added later
 * inherits the rule with nothing to update.
 *
 * The same rule over the other Setup producers lives in each of them
 * (`@objectstack/platform-objects`' `src/apps/setup-copy-vocabulary.test.ts`,
 * `@objectstack/service-messaging`'s `src/objects/admin-copy-vocabulary.test.ts`);
 * the matcher is restated rather than imported, because a shared assertion
 * module would be one more export for a test to reach across a package for.
 */

import { describe, expect, it } from 'vitest';
import * as Approvals from './index.js';
// Registered by the plugin, not re-exported by the package entry.
import { SysApprovalToken } from './sys-approval-token.object.js';
import { enObjects } from './translations/en.objects.generated.js';
import { zhCNObjects } from './translations/zh-CN.objects.generated.js';
import { jaJPObjects } from './translations/ja-JP.objects.generated.js';
import { esESObjects } from './translations/es-ES.objects.generated.js';

/** The design-record vocabulary an admin-facing string must not carry. */
const DESIGN_RECORD_VOCABULARY: ReadonlyArray<readonly [string, RegExp]> = [
  ['an ADR number', /ADR-\d/],
  ['a decision id', /\bD\d+\b/],
  ['a review-finding id', /finding F/],
  ['an API call', /\bemit\(\)/],
  ['a runtime internal', /\bkernel\b/i],
  // The developer notes a Setup pass met in field help: a column reference,
  // a function name, an internal component, a storage-history note and an
  // inert-column notice. What the field means and what to do with it is the
  // help; where it is stored and which code reads it is the comment.
  ['a foreign-key note', /\bforeign key to\b/i],
  ['a function name', /\bisGrantActive\b/],
  ['an internal component', /\bmiddleware\b|\bbetter-auth is oblivious\b|\bReaper\b/i],
  ['a column-history note', /\bNULL only on\b/],
  ['an inert-column notice', /\bInert today\b/i],
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

describe('approval objects: admin-facing copy carries no design-record vocabulary', () => {
  it('the matcher recognises each kind of vocabulary it exists to keep out', () => {
    expect(vocabularyIn('Suspended run this request gates (ADR-0019).')).toEqual(['an ADR number']);
    expect(vocabularyIn('Enforced by the shared predicate, decision D2.')).toEqual(['a decision id']);
    expect(vocabularyIn('Bypass rule (finding F2).')).toEqual(['a review-finding id']);
    expect(vocabularyIn('One row per emit().')).toEqual(['an API call']);
    expect(vocabularyIn('Resumed by a rebuilt kernel.')).toEqual(['a runtime internal']);
    expect(vocabularyIn('Foreign key to sys_user.id')).toEqual(['a foreign-key note']);
    expect(vocabularyIn('Enforced at resolution time via isGrantActive.')).toEqual(['a function name']);
    expect(vocabularyIn('Batch cadence (P3 digest middleware).')).toEqual(['an internal component']);
    expect(vocabularyIn('NULL only on a grant written before the column existed.')).toEqual(['a column-history note']);
    expect(vocabularyIn('Inert today: nothing reads it.')).toEqual(['an inert-column notice']);
    expect(vocabularyIn('While someone is away, approvals go to their delegate.')).toEqual([]);
  });

  it('object, field and view copy of every object this package ships', () => {
    const objects: ObjectLike[] = [...(Object.values(Approvals) as unknown[]), SysApprovalToken]
      .filter(isObjectSchema);
    const names = objects.map((o) => o.name);
    for (const name of [
      'sys_approval_request', 'sys_approval_action', 'sys_approval_approver',
      'sys_approval_token', 'sys_approval_delegation',
    ]) {
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
