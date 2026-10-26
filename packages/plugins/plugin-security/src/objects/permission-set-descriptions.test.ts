// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { translateMetadataDocument } from '@objectstack/spec/system';
import { defaultPermissionSets } from './default-permission-sets.js';
import { SecurityTranslations } from '../translations/index.js';

/**
 * Every built-in permission set says who holds it, in every shipped locale.
 *
 * Setup → Permission Sets lists the platform's own sets beside every app's,
 * with each set's `description`. Five of them showed none and the no-bypass
 * and MCP agent sets showed text written for platform engineers, so an
 * administrator picking a set could not tell an administrator set from a
 * member set. This pins the business fact that every set in
 * `defaultPermissionSets` carries ONE plain sentence of at most 160
 * characters, and that every translated locale of this plugin's bundle
 * carries that sentence and the set's label for it, so no row of the list
 * reads half English. It is deliberately not a copy of the wording,
 * which `default-permission-sets.ts` and `../translations/permission-sets.ts`
 * own.
 *
 * A sentence: non-empty, no line break, at most 160 characters, ends with one
 * full stop (`.`, or `。` in Chinese and Japanese) and holds no other sentence
 * break. Engineering terms stay in the code comments beside each set, so the
 * copy names no permission-set id and no code span.
 *
 * A label: a short noun phrase (at most 60 characters, no line break, no
 * closing full stop) split by ` — ` exactly as often as the English label, so
 * a translation keeps the "who — what access" shape the list reads by.
 */
type AnyRec = Record<string, any>;

const MAX_LENGTH = 160;
const MAX_LABEL_LENGTH = 60;
const LABEL_SPLIT = ' — ';
const TRANSLATED_LOCALES = Object.keys(SecurityTranslations).filter((l) => l !== 'en');
const SET_NAMES = defaultPermissionSets.map((ps) => ps.name);

function expectOneSentence(text: unknown, where: string): void {
  expect(typeof text, `${where}: description missing`).toBe('string');
  const value = String(text);
  expect(value, `${where}: padded`).toBe(value.trim());
  expect(value.length, `${where}: empty`).toBeGreaterThan(0);
  expect([...value].length, `${where}: over ${MAX_LENGTH} characters`).toBeLessThanOrEqual(MAX_LENGTH);
  expect(value, `${where}: line break`).not.toMatch(/[\r\n]/);
  expect(value, `${where}: does not end with a full stop`).toMatch(/[.。]$/);
  // The only sentence break is the last character.
  expect(value.slice(0, -1), `${where}: more than one sentence`).not.toMatch(/[.!?](\s|$)|[。！？]/);
  // No engineer-facing spellings: code spans or a set's machine name.
  expect(value, `${where}: code span`).not.toMatch(/`/);
  for (const name of SET_NAMES) expect(value, `${where}: names ${name}`).not.toContain(name);
}

function expectLabel(text: unknown, english: string, where: string): void {
  expect(typeof text, `${where}: label missing`).toBe('string');
  const value = String(text);
  expect(value, `${where}: padded`).toBe(value.trim());
  expect(value.length, `${where}: empty`).toBeGreaterThan(0);
  expect([...value].length, `${where}: over ${MAX_LABEL_LENGTH} characters`).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
  expect(value, `${where}: line break`).not.toMatch(/[\r\n]/);
  expect(value, `${where}: ends with a full stop`).not.toMatch(/[.。]$/);
  expect(value, `${where}: code span`).not.toMatch(/`/);
  for (const name of SET_NAMES) expect(value, `${where}: names ${name}`).not.toContain(name);
  expect(value.split(LABEL_SPLIT).length, `${where}: not in the English label's shape`).toBe(
    english.split(LABEL_SPLIT).length,
  );
}

describe('built-in permission set descriptions', () => {
  it('ships the nine built-in sets', () => {
    expect(SET_NAMES).toEqual([
      'admin_full_access',
      'organization_admin',
      'organization_admin_no_bypass',
      'member_default',
      'viewer_readonly',
      'external_default',
      'mcp_agent_data_read',
      'mcp_agent_data_write',
      'mcp_agent_restricted',
    ]);
  });

  it.each(defaultPermissionSets.map((ps) => [ps.name, ps] as const))(
    '%s has a one-sentence business description',
    (name, set) => {
      expectOneSentence(set.description, name);
      // The schema keeps the key (a stripped key would read back undefined).
      expect(PermissionSetSchema.parse(set).description).toBe(set.description);
    },
  );

  it('gives no two sets the same description', () => {
    const texts = defaultPermissionSets.map((ps) => ps.description);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('the bundle carries translated locales', () => {
    expect(TRANSLATED_LOCALES).toEqual(expect.arrayContaining(['zh-CN', 'ja-JP', 'es-ES']));
  });

  describe.each(TRANSLATED_LOCALES)('%s', (locale) => {
    const group = ((SecurityTranslations[locale] as AnyRec | undefined)?.permissions ?? {}) as AnyRec;

    it('translates exactly the built-in sets', () => {
      expect(Object.keys(group).sort()).toEqual([...SET_NAMES].sort());
    });

    it.each(defaultPermissionSets.map((ps) => [ps.name, ps] as const))(
      '%s carries a translated one-sentence description',
      (name, set) => {
        const entry = group[name] as AnyRec | undefined;
        expectOneSentence(entry?.description, `${locale} ${name}`);
        expect(entry?.description, `${locale} ${name}: an English copy, not a translation`).not.toBe(set.description);
      },
    );

    it.each(defaultPermissionSets.map((ps) => [ps.name, ps] as const))(
      '%s carries a translated label',
      (name, set) => {
        const entry = group[name] as AnyRec | undefined;
        expectLabel(entry?.label, String(set.label), `${locale} ${name}`);
        expect(entry?.label, `${locale} ${name}: an English copy, not a translation`).not.toBe(set.label);
      },
    );

    it('gives no two sets the same label', () => {
      const labels = SET_NAMES.map((name) => (group[name] as AnyRec | undefined)?.label);
      expect(new Set(labels).size).toBe(labels.length);
    });

    // The overlay `GET /meta/permission` applies at the REST boundary, read
    // through the bundle this plugin loads: the served set's label and
    // description are this locale's, nothing else of the set changes.
    it.each(defaultPermissionSets.map((ps) => [ps.name, ps] as const))(
      '%s is served in this locale',
      (name, set) => {
        const served = translateMetadataDocument('permission', set, SecurityTranslations, { locale });
        const entry = group[name] as AnyRec;
        expect(served).toEqual({ ...set, label: entry.label, description: entry.description });
      },
    );
  });
});
