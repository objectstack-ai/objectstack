// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { translateMetadataDocument } from '@objectstack/spec/system';
import { securityBuiltinPositions } from '../builtin-positions.js';
import { SecurityTranslations } from './index.js';

/**
 * Every built-in position reads in the administrator's language.
 *
 * Setup → Positions lists the platform's seven built-in positions beside the
 * app's own, each with its `label` and `description`, from
 * `GET /meta/position`, which overlays the bundle's `positions` group on every
 * served position. The app's positions came back translated and the
 * platform's stayed English, because this plugin's bundle carried no
 * `positions` group. This pins that every translated locale of the bundle
 * carries both strings for exactly the built-ins, and that the served
 * document is that locale's. It is deliberately not a copy of the wording,
 * which `./builtin-positions.ts` owns.
 */
type AnyRec = Record<string, any>;

const TRANSLATED_LOCALES = Object.keys(SecurityTranslations).filter((l) => l !== 'en');
const POSITION_NAMES = securityBuiltinPositions.map((p) => p.name);

describe('built-in position translations', () => {
  it('declares the seven built-in positions', () => {
    expect([...POSITION_NAMES].sort()).toEqual(
      ['everyone', 'guest', 'org_admin', 'org_external', 'org_member', 'org_owner', 'platform_admin'],
    );
  });

  it('the bundle carries translated locales', () => {
    expect(TRANSLATED_LOCALES).toEqual(expect.arrayContaining(['zh-CN', 'ja-JP', 'es-ES']));
  });

  describe.each(TRANSLATED_LOCALES)('%s', (locale) => {
    const group = ((SecurityTranslations[locale] as AnyRec | undefined)?.positions ?? {}) as AnyRec;

    it('translates exactly the built-in positions', () => {
      expect(Object.keys(group).sort()).toEqual([...POSITION_NAMES].sort());
    });

    it('gives no two positions the same label', () => {
      const labels = POSITION_NAMES.map((name) => (group[name] as AnyRec | undefined)?.label);
      expect(new Set(labels).size).toBe(labels.length);
    });

    // The overlay `GET /meta/position` applies at the REST boundary, read
    // through the bundle this plugin loads: the served position's label and
    // description are this locale's, nothing else of the position changes.
    it.each(securityBuiltinPositions.map((p) => [p.name, p] as const))(
      '%s is served in this locale',
      (name, position) => {
        const entry = group[name] as AnyRec | undefined;
        for (const attr of ['label', 'description'] as const) {
          const text = entry?.[attr];
          expect(typeof text, `${locale} ${name}.${attr} missing`).toBe('string');
          expect(text, `${locale} ${name}.${attr} padded`).toBe(String(text).trim());
          expect(text, `${locale} ${name}.${attr}: an English copy, not a translation`).not.toBe(position[attr]);
          expect(text, `${locale} ${name}.${attr}: names a position id`).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
        }
        const served = translateMetadataDocument('position', { ...position }, SecurityTranslations, { locale });
        expect(served).toEqual({ ...position, label: entry?.label, description: entry?.description });
      },
    );
  });
});
