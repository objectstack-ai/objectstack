// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The maintainer's marketplace-taxonomy ruling (D1–D3): one family, one entry.
// Six `category` keys are in `RETIRED_KEYS_BY_MAJOR[18]` and both category defs
// in `RETIRED_DEFS_BY_MAJOR[18]`.
export const entry: SemanticMigration = {
  id: 'marketplace-category-retired',
  surface:
    'Package.category / CreatePackageRequest.category / UpdatePackageRequest.category / '
    + 'TemplateManifest.category (objectstack.manifest.json) / MarketplaceListing.category / '
    + 'MarketplaceSearchRequest.category / MarketplaceSearchResponse.facets.categories',
  replacement:
    'delete `category`. Declare `businessFunctions` (1-3 business functions, the primary one first; '
    + 'required to submit to the marketplace), optionally `industries` (up to 3; absent means '
    + 'cross-industry) and `solutionType` (`app`, `template` or `connector`; absent means `app`), all '
    + 'from `marketplace/taxonomy.zod.ts`. `LEGACY_CATEGORY_MAPPING` there gives the facets for every old '
    + 'category value; a value it marks `manual` needs the author to choose the business functions, and '
    + 'one it marks `unlistable` named something ADR-0019 never lists. A search filters by '
    + '`businessFunctions` / `industries` / `solutionTypes` and reads one facet count list per facet. '
    + '`maturity` (`beta` | `stable`) is a separate new flag, not a facet',
  reason:
    'One `category` had to say both who a package is for and what it is: a connector filed under the '
    + 'integrations value lost the business function it served, and one operations value held three '
    + 'functions. The platform declared it twice — a closed enum on the listing and an open string on the '
    + 'package — and the cloud catalog and the scenario library kept two more lists that agreed with the '
    + 'listing on five values. The ruling defines the taxonomy once, here, for the CLI, the cloud catalog '
    + 'and the console. Why D3 semantic and not a D2 conversion: none of these shapes is a stack '
    + 'collection member, so a conversion would be a transform with no seam that ever runs; the stored '
    + 'catalog rows are migrated once by the cloud catalog, reading `LEGACY_CATEGORY_MAPPING`. Choosing '
    + 'business functions for a `manual` value is a judgement no mechanical edit can make.',
  acceptanceCriteria:
    'No package source, publish request or listing writes `category`: a TypeScript author fails `tsc` '
    + '(each key is typed as the retired mark), a parse of PackageSchema, CreatePackageRequestSchema, '
    + 'UpdatePackageRequestSchema, TemplateManifestSchema, MarketplaceListingSchema or '
    + 'MarketplaceSearchRequestSchema refuses it with its prescription, and `os package publish` refuses a '
    + 'manifest or a flag carrying it before any network call, naming the facets for the value it held. '
    + 'Every shipped objectstack.manifest.json declares `businessFunctions` and `solutionType` instead and '
    + 'passes `check:template-manifests`. A `template` declares the unmanaged install mode and a '
    + '`connector` declares a connector, or publish refuses it.',
};
