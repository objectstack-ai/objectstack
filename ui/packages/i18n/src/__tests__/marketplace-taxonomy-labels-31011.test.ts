/**
 * The marketplace taxonomy's labels are keyed by the spec's own vocabulary
 * (objectstack#31011).
 *
 * The console's facet filters and badges draw a label for each value of
 * `@objectstack/spec/marketplace`'s business-function, industry and
 * solution-type enums, built as `marketplace.<group>.<value>` from the value
 * itself. There is no list of those values in `ui/`: the console iterates the
 * schemas' `.options`, and so does this test. Its set is the spec's, read here
 * from the same `.options`:
 *
 * - every value the spec lists has a non-empty label in every marketplace
 *   catalogue, so a value the spec adds fails here until it is labelled in
 *   every language;
 * - no catalogue labels a value the spec does not list, so a value the spec
 *   retires fails here until its labels go;
 * - `marketplace.maturity` labels `beta` alone, the one maturity drawn as a
 *   badge (`stable` is the absence of one);
 * - the retired `marketplace.category` group, a copy of the retired category
 *   enum, is in no catalogue.
 */
import { describe, expect, it } from 'vitest';
import {
  MarketplaceBusinessFunctionSchema,
  MarketplaceIndustrySchema,
  MarketplaceSolutionTypeSchema,
  PackageMaturitySchema,
} from '@objectstack/spec/marketplace';

import enNs from '../namespaces/marketplace/en.js';
import zhHansNs from '../namespaces/marketplace/zh-Hans.js';
import zhHantNs from '../namespaces/marketplace/zh-Hant.js';
import jaNs from '../namespaces/marketplace/ja.js';
import koNs from '../namespaces/marketplace/ko.js';
import deNs from '../namespaces/marketplace/de.js';
import frNs from '../namespaces/marketplace/fr.js';
import esNs from '../namespaces/marketplace/es.js';
import ptBrNs from '../namespaces/marketplace/pt-BR.js';
import ruNs from '../namespaces/marketplace/ru.js';
import arNs from '../namespaces/marketplace/ar.js';
import { MARKETPLACE_LANGUAGE_CODES } from '../namespaces/marketplace/index.js';

type Group = Record<string, unknown>;

const CATALOGUES: Record<string, { marketplace: Record<string, unknown> }> = {
  en: enNs, 'zh-Hans': zhHansNs, 'zh-Hant': zhHantNs, ja: jaNs, ko: koNs, de: deNs,
  fr: frNs, es: esNs, 'pt-BR': ptBrNs, ru: ruNs, ar: arNs,
};

/** Each label group, and the spec enum whose `.options` are its keys. */
const FAMILIES: ReadonlyArray<{ group: string; values: readonly string[] }> = [
  { group: 'businessFunction', values: MarketplaceBusinessFunctionSchema.options },
  { group: 'industry', values: MarketplaceIndustrySchema.options },
  { group: 'solutionType', values: MarketplaceSolutionTypeSchema.options },
];

const groupOf = (tag: string, group: string): Group =>
  (CATALOGUES[tag].marketplace[group] ?? {}) as Group;

describe('marketplace taxonomy labels follow the spec vocabulary (objectstack#31011)', () => {
  it('reads every marketplace catalogue', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...MARKETPLACE_LANGUAGE_CODES].sort());
  });

  it('reads a non-empty vocabulary off each spec enum', () => {
    for (const { group, values } of FAMILIES) {
      expect({ group, size: values.length > 0 }).toEqual({ group, size: true });
    }
  });

  describe.each(Object.keys(CATALOGUES))('%s', (tag) => {
    it.each(FAMILIES.map((f) => [f.group, f.values] as const))(
      'labels every %s value the spec lists, and no other',
      (group, values) => {
        const labels = groupOf(tag, group);
        const unlabelled = values.filter((v) => typeof labels[v] !== 'string' || (labels[v] as string).trim() === '');
        const unknown = Object.keys(labels).filter((k) => !values.includes(k));
        expect({ tag, group, unlabelled, unknown }).toEqual({ tag, group, unlabelled: [], unknown: [] });
      },
    );

    it('labels the beta maturity, and only it', () => {
      expect(PackageMaturitySchema.options).toContain('beta');
      const labels = groupOf(tag, 'maturity');
      expect(Object.keys(labels)).toEqual(['beta']);
      expect(typeof labels.beta === 'string' && labels.beta.trim() !== '').toBe(true);
    });

    it('carries no retired category group', () => {
      expect(CATALOGUES[tag].marketplace).not.toHaveProperty('category');
    });
  });
});
