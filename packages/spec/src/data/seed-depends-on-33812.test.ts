import { describe, it, expect } from 'vitest';
import { SeedSchema, defineSeed } from './seed.zod';

/**
 * `Seed.dependsOn` — the objects a dataset loads after. The schema holds each
 * name to an object machine name; `defineSeed` refuses the one declaration it
 * can judge alone (the dataset's own object). The refusals that need the whole
 * load (a name the load does not seed, an edge that closes a cycle) are the
 * seed loader's, pinned in `@objectstack/metadata-protocol`
 * (`seed-loader-depends-on-33812.test.ts`).
 */
const Rating = {
  name: 'crm_customer_rating',
  fields: { name: { type: 'text' }, total_score: { type: 'number' } },
} as const;

describe('SeedSchema.dependsOn', () => {
  it('is an authorable key: a list of object names parses and is kept', () => {
    const parsed = SeedSchema.safeParse({ object: 'crm_customer_rating', records: [], dependsOn: ['crm_rating_band'] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.dependsOn).toEqual(['crm_rating_band']);
  });

  it('is optional, with no default: a seed without it parses to no key', () => {
    const parsed = SeedSchema.safeParse({ object: 'crm_customer_rating', records: [] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'dependsOn' in parsed.data).toBe(false);
  });

  it('refuses a name that is not an object machine name', () => {
    const parsed = SeedSchema.safeParse({ object: 'crm_customer_rating', records: [], dependsOn: ['CrmRatingBand'] });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.path).toEqual(['dependsOn', 0]);
  });

  it('refuses a single string where the list belongs', () => {
    const parsed = SeedSchema.safeParse({ object: 'crm_customer_rating', records: [], dependsOn: 'crm_rating_band' });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.path).toEqual(['dependsOn']);
  });
});

describe('defineSeed: dependsOn', () => {
  it('carries the declared objects onto the seed', () => {
    const seed = defineSeed(Rating, { dependsOn: ['crm_rating_band'], records: [{ name: 'Acme' }] });
    expect(seed.dependsOn).toEqual(['crm_rating_band']);
  });

  it('refuses a dataset that names its own object, naming it', () => {
    expect(() => defineSeed(Rating, { dependsOn: ['crm_customer_rating'], records: [{ name: 'Acme' }] }))
      .toThrow(/defineSeed\('crm_customer_rating'\).*dependsOn/);
  });
});
