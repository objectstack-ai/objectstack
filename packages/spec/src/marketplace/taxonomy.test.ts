// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The marketplace taxonomy (`./taxonomy.zod.ts`) and the retirement of the
 * single `category` it replaces — the maintainer's ruling D1–D3.
 *
 * One `describe` per rule, so an ablation of a rule turns exactly its block
 * red:
 *
 *   F1  `businessFunctions` — 1 to 3 distinct values, ordered.
 *   F2  `industries` — 0 to 3 distinct values; no catch-all value.
 *   F3  `solutionType` — `app` | `template` | `connector`, no `theme`;
 *       defaulted on the row shapes, never on a request.
 *   D3  `maturity` — `beta` | `stable`, a flag beside the facets.
 *   ×   the publish cross-check: `template` needs `unmanaged`, `connector`
 *       needs a declared connector.
 *   D2  `category` refused by name on every schema that carried it, with the
 *       prescription; both category defs gone; ADR-0087 registration.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues
 * carry `code` and `path` but no ADR-0112 `status` — none of these shapes has
 * an HTTP door of its own here. Asserted: refusal, the issue `code`, the
 * `path` naming the key, and the prescription's opening.
 */

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import * as Marketplace from './index';
import {
  MarketplaceListingSchema,
  MarketplaceSearchRequestSchema,
  MarketplaceSearchResponseSchema,
} from './marketplace.zod';
import {
  CreatePackageRequestSchema,
  PackageSchema,
  UpdatePackageRequestSchema,
  type CreatePackageRequest,
} from './package.zod';
import { TemplateManifestSchema } from './template-manifest.zod';
import {
  explainSolutionTypeContradiction,
  LEGACY_CATEGORY_MAPPING,
  MarketplaceBusinessFunctionSchema,
  MarketplaceBusinessFunctionsSchema,
  MarketplaceIndustriesSchema,
  MarketplaceIndustrySchema,
  MarketplaceSolutionTypeSchema,
  PackageMaturitySchema,
} from './taxonomy.zod';

const D3_ID = 'marketplace-category-retired';

const PACKAGE_ROW = {
  id: '6a0f8b9e-1d2c-4e5f-8a7b-9c0d1e2f3a4b',
  manifestId: 'com.acme.crm',
  ownerOrgId: 'org_1',
  displayName: 'Acme CRM',
  createdAt: '2026-11-06T00:00:00Z',
  updatedAt: '2026-11-06T00:00:00Z',
  createdBy: 'usr_1',
};
const CREATE_REQUEST = { manifestId: 'com.acme.crm', ownerOrgId: 'org_1', displayName: 'Acme CRM', createdBy: 'usr_1' };
const TEMPLATE_MANIFEST = { name: 'acme-crm', specVersion: '^18.0.0', displayName: 'Acme CRM' };
const LISTING = {
  id: 'listing-001',
  packageId: 'com.acme.crm',
  publisherId: 'pub-001',
  name: 'Acme CRM',
  latestVersion: '1.0.0',
  businessFunctions: ['sales'],
};

/** The issues of a refused parse. */
function issuesOf(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) {
  expect(result.success).toBe(false);
  return result.error!.issues;
}

describe('F1 businessFunctions — 1 to 3 distinct business functions, the first is primary', () => {
  it('accepts one to three values and keeps their order', () => {
    expect(MarketplaceBusinessFunctionsSchema.parse(['sales'])).toEqual(['sales']);
    expect(MarketplaceBusinessFunctionsSchema.parse(['marketing', 'sales', 'customer-service']))
      .toEqual(['marketing', 'sales', 'customer-service']);
  });

  it('refuses an empty list', () => {
    const [issue] = issuesOf(MarketplaceBusinessFunctionsSchema.safeParse([]));
    expect(issue!.code).toBe('too_small');
    expect(issue!.message).toMatch(/at least one business function/);
  });

  it('refuses a fourth value', () => {
    const [issue] = issuesOf(MarketplaceBusinessFunctionsSchema.safeParse(['sales', 'finance', 'hr', 'legal']));
    expect(issue!.code).toBe('too_big');
    expect(issue!.message).toMatch(/at most 3 business functions/);
  });

  it('refuses a value listed twice', () => {
    const [issue] = issuesOf(MarketplaceBusinessFunctionsSchema.safeParse(['sales', 'sales']));
    expect(issue!.code).toBe('custom');
    expect(issue!.message).toMatch(/`businessFunctions` lists a value more than once/);
  });

  it('refuses a value outside the facet, and has no catch-all value', () => {
    const [issue] = issuesOf(MarketplaceBusinessFunctionsSchema.safeParse(['operations']));
    expect(issue!.code).toBe('invalid_value');
    expect(issue!.path).toEqual([0]);
    expect(MarketplaceBusinessFunctionSchema.options).not.toContain('other');
  });

  it('is optional on a package and a publish request, and required on a listing', () => {
    expect(PackageSchema.safeParse(PACKAGE_ROW).success).toBe(true);
    expect(CreatePackageRequestSchema.safeParse(CREATE_REQUEST).success).toBe(true);
    const { businessFunctions: _omitted, ...unclassified } = LISTING;
    const [issue] = issuesOf(MarketplaceListingSchema.safeParse(unclassified));
    expect(issue!.path).toEqual(['businessFunctions']);
  });
});

describe('F2 industries — up to 3 distinct industries; absent means cross-industry', () => {
  it('accepts zero to three values', () => {
    expect(MarketplaceIndustriesSchema.parse([])).toEqual([]);
    expect(MarketplaceIndustriesSchema.parse(['manufacturing', 'trade-distribution', 'retail']))
      .toEqual(['manufacturing', 'trade-distribution', 'retail']);
  });

  it('refuses a fourth value', () => {
    const [issue] = issuesOf(MarketplaceIndustriesSchema.safeParse(['manufacturing', 'retail', 'logistics', 'education']));
    expect(issue!.code).toBe('too_big');
    expect(issue!.message).toMatch(/at most 3 industries/);
  });

  it('refuses a value listed twice', () => {
    const [issue] = issuesOf(MarketplaceIndustriesSchema.safeParse(['retail', 'retail']));
    expect(issue!.message).toMatch(/`industries` lists a value more than once/);
  });

  it('has no general / cross-industry value: absence says that', () => {
    for (const catchAll of ['general', 'cross-industry', 'other']) {
      expect(MarketplaceIndustrySchema.safeParse(catchAll).success, catchAll).toBe(false);
    }
    expect(PackageSchema.parse(PACKAGE_ROW).industries).toBeUndefined();
  });
});

describe('F3 solutionType — app, template or connector', () => {
  it('has exactly the three ruled values, and no theme (ADR-0019)', () => {
    expect(MarketplaceSolutionTypeSchema.options).toEqual(['app', 'template', 'connector']);
    expect(MarketplaceSolutionTypeSchema.safeParse('theme').success).toBe(false);
  });

  it('defaults to `app` on the package row and the listing', () => {
    expect(PackageSchema.parse(PACKAGE_ROW).solutionType).toBe('app');
    expect(MarketplaceListingSchema.parse(LISTING).solutionType).toBe('app');
  });

  it('carries no default on a request or a manifest: absent stays absent, so a re-publish never rewrites it', () => {
    expect(CreatePackageRequestSchema.parse(CREATE_REQUEST)).not.toHaveProperty('solutionType');
    expect(UpdatePackageRequestSchema.parse({})).not.toHaveProperty('solutionType');
    expect(TemplateManifestSchema.parse(TEMPLATE_MANIFEST)).not.toHaveProperty('solutionType');
  });
});

describe('D3 maturity — beta or stable, a flag beside the facets', () => {
  it('accepts beta and stable only', () => {
    expect(PackageMaturitySchema.options).toEqual(['beta', 'stable']);
    expect(PackageMaturitySchema.safeParse('preview').success).toBe(false);
  });

  it('means stable when absent on the row shapes, and stays absent on a request', () => {
    expect(PackageSchema.parse(PACKAGE_ROW).maturity).toBe('stable');
    expect(MarketplaceListingSchema.parse(LISTING).maturity).toBe('stable');
    expect(CreatePackageRequestSchema.parse(CREATE_REQUEST)).not.toHaveProperty('maturity');
  });

  it('is a search filter but not a facet count', () => {
    expect(MarketplaceSearchRequestSchema.parse({ maturity: 'stable' }).maturity).toBe('stable');
    const facets = MarketplaceSearchResponseSchema.parse({
      items: [], total: 0, page: 1, pageSize: 20,
      facets: { maturity: [{ value: 'beta', count: 1 }] },
    }).facets as Record<string, unknown>;
    expect(facets).not.toHaveProperty('maturity');
  });
});

describe('the publish cross-check of solutionType', () => {
  it('refuses a template whose package permits no unmanaged install, naming the fix', () => {
    const refusal = explainSolutionTypeContradiction('template', { installModes: ['managed'], connectorCount: 0 });
    expect(refusal).toMatch(/^`solutionType: 'template'`.*permits only \['managed'\].*Add 'unmanaged' to `manifest\.installModes`/s);
  });

  it('accepts a template that permits an unmanaged install', () => {
    expect(explainSolutionTypeContradiction('template', { installModes: ['managed', 'unmanaged'], connectorCount: 0 })).toBeUndefined();
  });

  it('refuses a connector that declares no connector, naming the fix', () => {
    const refusal = explainSolutionTypeContradiction('connector', { installModes: ['managed'], connectorCount: 0 });
    expect(refusal).toMatch(/^`solutionType: 'connector'`.*declares no connector.*under `connectors`/s);
  });

  it('accepts a connector that declares one', () => {
    expect(explainSolutionTypeContradiction('connector', { installModes: ['managed'], connectorCount: 1 })).toBeUndefined();
  });

  it('asks nothing of an app, or of a package that declares no solution type', () => {
    expect(explainSolutionTypeContradiction('app', { installModes: ['managed'], connectorCount: 0 })).toBeUndefined();
    expect(explainSolutionTypeContradiction(undefined, { installModes: ['managed'], connectorCount: 0 })).toBeUndefined();
  });
});

describe('D2 category — refused by name on every schema that carried it', () => {
  const CASES: Array<[string, { safeParse: (v: unknown) => any }, Record<string, unknown>, string[]]> = [
    ['Package.category', PackageSchema, { ...PACKAGE_ROW, category: 'crm' }, ['category']],
    ['CreatePackageRequest.category', CreatePackageRequestSchema, { ...CREATE_REQUEST, category: 'crm' }, ['category']],
    ['UpdatePackageRequest.category', UpdatePackageRequestSchema, { category: 'crm' }, ['category']],
    ['TemplateManifest.category', TemplateManifestSchema, { ...TEMPLATE_MANIFEST, category: 'starter' }, ['category']],
    ['MarketplaceListing.category', MarketplaceListingSchema, { ...LISTING, category: 'crm' }, ['category']],
    ['MarketplaceSearchRequest.category', MarketplaceSearchRequestSchema, { category: 'crm' }, ['category']],
    ['MarketplaceSearchResponse.facets.categories', MarketplaceSearchResponseSchema,
      { items: [], total: 0, page: 1, pageSize: 20, facets: { categories: [{ category: 'crm', count: 1 }] } },
      ['facets', 'categories']],
  ];

  it.each(CASES)('%s carries the prescription', (key, schema, input, path) => {
    const [issue] = issuesOf(schema.safeParse(input));
    expect(issue!.path).toEqual(path);
    expect(issue!.message.startsWith(`\`${key}\` was removed in @objectstack/spec 18 (ADR-0087)`)).toBe(true);
    expect(issue!.message).toMatch(/Delete the key\. Declare `businessFunctions`.*`industries`.*`solutionType`.*LEGACY_CATEGORY_MAPPING/s);
  });

  it('types the key as the retired mark for a TypeScript author', () => {
    const request: CreatePackageRequest = {
      ...CREATE_REQUEST,
      // @ts-expect-error — `category` is a retiredKey() tombstone: no value is assignable.
      category: 'crm',
    };
    expect(CreatePackageRequestSchema.safeParse(request).success).toBe(false);
  });

  it('leaves no category def exported from @objectstack/spec/marketplace', () => {
    for (const gone of ['MarketplaceCategorySchema', 'PackageCategorySchema']) {
      expect(Object.keys(Marketplace), gone).not.toContain(gone);
    }
  });
});

describe('D2 category — ADR-0087 registration', () => {
  const KEYS = ['Package', 'CreatePackageRequest', 'UpdatePackageRequest', 'TemplateManifest', 'MarketplaceListing', 'MarketplaceSearchRequest']
    .map((def) => `marketplace/${def}:category`);

  it('declares every tombstoned key and both defs under major 18', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining(KEYS));
    expect(RETIRED_DEFS_BY_MAJOR[18]).toEqual(expect.arrayContaining(['marketplace/MarketplaceCategory', 'marketplace/PackageCategory']));
  });

  it('carries no D2 conversion — none of these shapes is a stack collection member', () => {
    const touching = ALL_CONVERSIONS.filter((c) => /category/i.test(c.surface) && /Package|Listing|Marketplace|TemplateManifest/.test(c.surface));
    expect(touching.map((c) => c.id)).toEqual([]);
  });

  it('carries ONE D3 entry for the family, naming the facets', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.replacement).toContain('`businessFunctions`');
    expect(entries[0]!.replacement).toContain('`LEGACY_CATEGORY_MAPPING`');
  });
});

describe('LEGACY_CATEGORY_MAPPING — what every old category value becomes', () => {
  // The two retired lists, as they stood when they were retired — a record of
  // the old values this table must answer for, not a live taxonomy.
  const RETIRED_SPEC_VALUES = [
    'crm', 'erp', 'hr', 'finance', 'project', 'collaboration', 'analytics', 'integration',
    'automation', 'ai', 'security', 'developer-tools', 'ui-theme', 'storage', 'other',
  ];
  const RETIRED_CLOUD_VALUES = [
    'app', 'crm', 'sales', 'marketing', 'finance', 'hr', 'operations', 'project', 'productivity',
    'data', 'integrations', 'devtools', 'utility', 'other', 'starter',
  ];

  it('answers for every value either retired list held', () => {
    for (const value of [...RETIRED_SPEC_VALUES, ...RETIRED_CLOUD_VALUES]) {
      expect(LEGACY_CATEGORY_MAPPING, value).toHaveProperty(value);
    }
  });

  it('maps only to values the facets accept, and keys are lowercase and trimmed', () => {
    for (const [value, mapping] of Object.entries(LEGACY_CATEGORY_MAPPING)) {
      expect(value).toBe(value.trim().toLowerCase());
      if (mapping.kind === 'unlistable') continue;
      expect(MarketplaceSolutionTypeSchema.safeParse(mapping.solutionType).success, value).toBe(true);
      if (mapping.kind === 'mapped') {
        expect(MarketplaceBusinessFunctionsSchema.safeParse(mapping.businessFunctions).success, value).toBe(true);
      }
    }
  });

  it('folds nothing into a catch-all: an uncertain value stays manual', () => {
    expect(LEGACY_CATEGORY_MAPPING.other).toEqual({ kind: 'manual', solutionType: 'app' });
    expect(LEGACY_CATEGORY_MAPPING.analytics!.kind).toBe('manual');
  });

  it('gives a connector its connector type and leaves its business function to the author', () => {
    for (const value of ['integration', 'integrations', 'connector', 'connectors']) {
      expect(LEGACY_CATEGORY_MAPPING[value], value).toEqual({ kind: 'manual', solutionType: 'connector' });
    }
  });

  it('maps the old starter marker to the template type, and the two values ADR-0019 never lists to nothing', () => {
    expect(LEGACY_CATEGORY_MAPPING.starter).toEqual({ kind: 'manual', solutionType: 'template' });
    expect(LEGACY_CATEGORY_MAPPING['ui-theme']!.kind).toBe('unlistable');
    expect(LEGACY_CATEGORY_MAPPING.storage!.kind).toBe('unlistable');
  });

  it('flags operations for review: one value held three functions', () => {
    expect(LEGACY_CATEGORY_MAPPING.operations).toMatchObject({ kind: 'mapped', businessFunctions: ['administration'], review: true });
  });
});
