// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { UNIQUE_SCALAR_ITEMS, type JsonScalar } from '../shared/refinement-projection';
import type { InstallMode } from '../kernel/manifest.zod';

/**
 * Marketplace taxonomy — the ONE classification of a listed package.
 *
 * A package used to carry a single `category`, and that one value had to say
 * two different things at once: who the package is FOR (a business function)
 * and what it IS (a full app, a template, a connector). The platform declared
 * it as a closed enum on the listing (`MarketplaceCategorySchema`) and as an
 * open string on the package (`PackageCategorySchema`), the cloud catalog kept
 * a third list, and the scenario library copied the third — four lists that
 * agreed on five values. A connector filed under `integrations` lost the
 * business function it served; one `operations` value held three functions.
 *
 * The maintainer's ruling replaced it with three facets and one separate flag,
 * defined here once and read by every surface — the CLI publish path, the cloud
 * catalog and the console marketplace — so there is no second list to drift:
 *
 * | Facet | Key | Arity | Required |
 * |:--|:--|:--|:--|
 * | Business function | `businessFunctions` | 1–3, ordered, the first is primary | to submit to the marketplace |
 * | Industry | `industries` | 0–3 | never — absent means cross-industry |
 * | Solution type | `solutionType` | one | no — absent means `app` |
 * | Maturity (not a facet) | `maturity` | one | no — absent means `stable` |
 *
 * Filtering semantics the catalog applies: OR inside one facet, AND across
 * facets. Free-text `tags` stay for search only and generate no filter.
 *
 * ## Growing a facet
 *
 * Every value is a lowercase identifier (`SystemIdentifierSchema`, the grammar
 * of `SelectOptionSchema.value`): words joined by `_`, never `-`, so a select
 * field — the cloud catalog's facet columns, a console filter — can carry the
 * facet as its options unchanged.
 *
 * Released values are append-only. Renaming or removing a released value is
 * an ADR-0087 retirement with a data migration; a value no release has
 * shipped yet can still be respelled without one. Adding one needs a real
 * listed package, or a ruled scenario card, that needs it, and the console's
 * labels in the same change.
 * Keep each facet near a dozen values; merge before you grow.
 *
 * ## What is deliberately absent
 *
 * - No `general` / `cross-industry` industry: absence already means that, and a
 *   catch-all value is the one every author (an AI author first) would tick.
 * - No `theme` solution type: ADR-0019 lists only apps, and a theme ships
 *   inside one.
 * - No company-size facet: nothing in the catalog or the scenario library uses
 *   one.
 * - No `other` value anywhere: an unclassifiable package is a question for its
 *   author, never a bucket.
 */

// ---------------------------------------------------------------------------
// F1 — business function
// ---------------------------------------------------------------------------

/**
 * The business function a package serves — the primary way a buyer looks for a
 * template. `businessFunctions` (not `functions`) so it never reads as code.
 */
export const MarketplaceBusinessFunctionSchema = lazySchema(() => z.enum([
  'sales',             // Sales
  'marketing',         // Marketing
  'customer_service',  // Customer service and support
  'finance',           // Finance and accounting
  'hr',                // Human resources
  'supply_chain',      // Procurement and supply chain
  'administration',    // Administration and assets
  'project',           // Project management
  'legal',             // Legal and compliance
  'it',                // IT and development
  'collaboration',     // Collaboration and office work
]).describe('Business function a marketplace package serves'));

export type MarketplaceBusinessFunction = z.input<typeof MarketplaceBusinessFunctionSchema>;

/** The most business functions one package may claim. */
export const MAX_BUSINESS_FUNCTIONS = 3;

// ---------------------------------------------------------------------------
// F2 — industry
// ---------------------------------------------------------------------------

/**
 * The industry a package is built for. Optional on every package: a package
 * that declares none is cross-industry, and the catalog hides this facet's
 * filter while no listing carries a value.
 */
export const MarketplaceIndustrySchema = lazySchema(() => z.enum([
  'manufacturing',            // Manufacturing (chemicals included)
  'trade_distribution',       // Trade and distribution (export included)
  'retail',                   // Retail and consumer goods
  'logistics',                // Logistics and transport
  'professional_services',    // Professional services
  'financial_services',       // Financial services
  'healthcare',               // Healthcare
  'education',                // Education
  'public_sector',            // Government and public sector
  'real_estate_construction', // Real estate and construction
]).describe('Industry a marketplace package is built for'));

export type MarketplaceIndustry = z.input<typeof MarketplaceIndustrySchema>;

/** The most industries one package may claim. */
export const MAX_INDUSTRIES = 3;

// ---------------------------------------------------------------------------
// F3 — solution type
// ---------------------------------------------------------------------------

/**
 * What the package IS, declared by its author and cross-checked at publish
 * against what the package actually ships ({@link explainSolutionTypeContradiction}):
 *
 * - `app` — a complete application its publisher keeps upgrading (managed).
 * - `template` — installed into the customer's hands to change at will; needs
 *   the `unmanaged` install mode (ADR-0131 D6).
 * - `connector` — reaches one external system's API through a declared
 *   connector.
 *
 * Not `kind` or `type`, so it never collides with `packageType` (ADR-0019,
 * where the only listable package type is `app`) or a page's `kind`.
 */
export const MarketplaceSolutionTypeSchema = lazySchema(() => z.enum([
  'app',
  'template',
  'connector',
]).describe('What a marketplace package is: a managed app, an unmanaged template, or a connector'));

export type MarketplaceSolutionType = z.input<typeof MarketplaceSolutionTypeSchema>;

/** The solution type of a package that declares none. */
export const DEFAULT_SOLUTION_TYPE: MarketplaceSolutionType = 'app';

// ---------------------------------------------------------------------------
// Maturity — a flag beside the facets, not a facet
// ---------------------------------------------------------------------------

/**
 * How far along a package is. A facet says what a package is about and stays
 * fixed; maturity changes when the package graduates, so it is a separate flag
 * and a beta package keeps its real facets. Absent means `stable`. An enum
 * rather than a boolean so a later `preview` is one more value.
 */
export const PackageMaturitySchema = lazySchema(() => z.enum([
  'beta',
  'stable',
]).describe('Package maturity: beta shows a badge on the listing; absent means stable'));

export type PackageMaturity = z.input<typeof PackageMaturitySchema>;

// ---------------------------------------------------------------------------
// The keys, as every package and listing schema declares them
// ---------------------------------------------------------------------------

/** A list with no repeated value — a facet value counts once. */
function distinct<T extends z.ZodType<JsonScalar>>(item: T, key: string) {
  return z.array(item).refine(
    UNIQUE_SCALAR_ITEMS,
    { message: `\`${key}\` lists a value more than once; list each value once.` },
  );
}

/**
 * `businessFunctions` — 1 to {@link MAX_BUSINESS_FUNCTIONS} distinct business
 * functions, ordered: the first is the primary one, the one a listing card
 * shows. The key itself is optional on a package (a private package needs no
 * classification); submitting to the marketplace requires it.
 */
export const MarketplaceBusinessFunctionsSchema = lazySchema(() =>
  distinct(MarketplaceBusinessFunctionSchema, 'businessFunctions')
    .min(1, '`businessFunctions` lists at least one business function — omit the key on a package that is not listed.')
    .max(MAX_BUSINESS_FUNCTIONS, `\`businessFunctions\` lists at most ${MAX_BUSINESS_FUNCTIONS} business functions; keep the ones the package is really for, the primary one first.`)
    .describe(`Business functions the package serves: 1-${MAX_BUSINESS_FUNCTIONS} distinct values, the first is primary`),
);

export type MarketplaceBusinessFunctions = z.input<typeof MarketplaceBusinessFunctionsSchema>;

/**
 * `industries` — up to {@link MAX_INDUSTRIES} distinct industries. Absent, and
 * equally an empty list, means cross-industry.
 */
export const MarketplaceIndustriesSchema = lazySchema(() =>
  distinct(MarketplaceIndustrySchema, 'industries')
    .max(MAX_INDUSTRIES, `\`industries\` lists at most ${MAX_INDUSTRIES} industries; omit the key for a cross-industry package.`)
    .describe(`Industries the package is built for: up to ${MAX_INDUSTRIES} distinct values; absent means cross-industry`),
);

export type MarketplaceIndustries = z.input<typeof MarketplaceIndustriesSchema>;

// ---------------------------------------------------------------------------
// The publish-time cross-check of `solutionType`
// ---------------------------------------------------------------------------

/**
 * The facts about a built package that its declared {@link MarketplaceSolutionType}
 * must agree with — read off the compiled artifact, never off the listing.
 */
export interface SolutionTypeEvidence {
  /** The artifact manifest's install modes, resolved (`resolveInstallModes`). */
  readonly installModes: readonly InstallMode[];
  /** How many connectors the artifact declares (its `connectors` collection). */
  readonly connectorCount: number;
}

/**
 * The refusal for a declared solution type the package contradicts, or
 * `undefined` when they agree. A declaration rather than an inference, so a
 * mismatch is a loud refusal instead of a silent guess:
 *
 * - `template` needs `unmanaged` among the install modes — a template is
 *   handed to the customer to change, which is what `unmanaged` means.
 * - `connector` needs at least one declared connector.
 * - `app`, or no declaration, needs nothing.
 *
 * The CLI publish path asks this before any network call, and the cloud
 * publish gate asks it again, so both doors answer with one rule and one
 * sentence.
 */
export function explainSolutionTypeContradiction(
  solutionType: MarketplaceSolutionType | undefined,
  evidence: SolutionTypeEvidence,
): string | undefined {
  if (solutionType === 'template' && !evidence.installModes.includes('unmanaged')) {
    const modes = evidence.installModes.map((mode) => `'${mode}'`).join(', ');
    return '`solutionType: \'template\'` means the installed package is the customer\'s to change, which '
      + `needs the 'unmanaged' install mode, but the package permits only [${modes}]. Add 'unmanaged' to `
      + '`manifest.installModes` in objectstack.config.ts (ADR-0131 D6), or declare `solutionType: \'app\'`.';
  }
  if (solutionType === 'connector' && evidence.connectorCount === 0) {
    return '`solutionType: \'connector\'` means the package reaches an external system through a declared '
      + 'connector, but the package declares no connector. Declare one under `connectors` in '
      + 'objectstack.config.ts, or declare `solutionType: \'app\'`.';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The retired `category`, and what each old value becomes
// ---------------------------------------------------------------------------

/**
 * What one retired `category` value becomes.
 *
 * - `mapped` — a certain mapping. `review: true` marks one an operator should
 *   still look at (`operations` held three different functions).
 * - `manual` — no certain business function: the solution type is known, the
 *   functions are the author's call, and a migration lists the package for a
 *   person to complete. Never folded into a catch-all.
 * - `unlistable` — the value named something ADR-0019 never lists; there is
 *   nothing to map it to.
 *
 * `tag`, when present, is appended to the package's free-text `tags` so search
 * still finds what the old value said.
 */
export type LegacyCategoryMapping =
  | {
      readonly kind: 'mapped';
      readonly businessFunctions: readonly MarketplaceBusinessFunction[];
      readonly solutionType: MarketplaceSolutionType;
      readonly tag?: string;
      readonly review?: true;
    }
  | {
      readonly kind: 'manual';
      readonly solutionType: MarketplaceSolutionType;
      readonly tag?: string;
    }
  | {
      readonly kind: 'unlistable';
      readonly reason: string;
    };

/**
 * Every value the retired `category` was written with — the spec listing's
 * closed enum, the cloud catalog's list and the aliases its earlier migration
 * folded — mapped to the facets. Keys are lowercase and trimmed. The cloud
 * catalog's one-time migration and the CLI's refusal both read this table, so
 * the mapping is stated once.
 */
export const LEGACY_CATEGORY_MAPPING: Readonly<Record<string, LegacyCategoryMapping>> = Object.freeze({
  // The spec listing's enum.
  crm: { kind: 'mapped', businessFunctions: ['sales'], solutionType: 'app', tag: 'crm' },
  erp: { kind: 'mapped', businessFunctions: ['finance', 'supply_chain'], solutionType: 'app', tag: 'erp' },
  hr: { kind: 'mapped', businessFunctions: ['hr'], solutionType: 'app' },
  finance: { kind: 'mapped', businessFunctions: ['finance'], solutionType: 'app' },
  project: { kind: 'mapped', businessFunctions: ['project'], solutionType: 'app' },
  collaboration: { kind: 'mapped', businessFunctions: ['collaboration'], solutionType: 'app' },
  analytics: { kind: 'manual', solutionType: 'app', tag: 'analytics' },
  integration: { kind: 'manual', solutionType: 'connector' },
  automation: { kind: 'manual', solutionType: 'app', tag: 'automation' },
  ai: { kind: 'manual', solutionType: 'app', tag: 'ai' },
  security: { kind: 'mapped', businessFunctions: ['it'], solutionType: 'app', tag: 'security' },
  'developer-tools': { kind: 'mapped', businessFunctions: ['it'], solutionType: 'app', tag: 'devtools' },
  'ui-theme': { kind: 'unlistable', reason: 'a theme ships inside an app and is never listed on its own (ADR-0019)' },
  storage: { kind: 'unlistable', reason: 'a storage driver is operator-provisioned and never listed (ADR-0019)' },
  other: { kind: 'manual', solutionType: 'app' },
  // The cloud catalog's list (values the spec enum did not already carry).
  app: { kind: 'manual', solutionType: 'app' },
  sales: { kind: 'mapped', businessFunctions: ['sales'], solutionType: 'app' },
  marketing: { kind: 'mapped', businessFunctions: ['marketing'], solutionType: 'app' },
  operations: { kind: 'mapped', businessFunctions: ['administration'], solutionType: 'app', tag: 'operations', review: true },
  productivity: { kind: 'mapped', businessFunctions: ['collaboration'], solutionType: 'app' },
  data: { kind: 'manual', solutionType: 'app', tag: 'analytics' },
  integrations: { kind: 'manual', solutionType: 'connector' },
  devtools: { kind: 'mapped', businessFunctions: ['it'], solutionType: 'app', tag: 'devtools' },
  utility: { kind: 'manual', solutionType: 'app', tag: 'utility' },
  // Aliases the cloud catalog's earlier migration folded into its list.
  application: { kind: 'manual', solutionType: 'app' },
  apps: { kind: 'manual', solutionType: 'app' },
  business: { kind: 'mapped', businessFunctions: ['administration'], solutionType: 'app', tag: 'operations', review: true },
  ops: { kind: 'mapped', businessFunctions: ['administration'], solutionType: 'app', tag: 'operations', review: true },
  connector: { kind: 'manual', solutionType: 'connector' },
  connectors: { kind: 'manual', solutionType: 'connector' },
  tools: { kind: 'mapped', businessFunctions: ['it'], solutionType: 'app', tag: 'devtools' },
  developer: { kind: 'mapped', businessFunctions: ['it'], solutionType: 'app', tag: 'devtools' },
  travel: { kind: 'manual', solutionType: 'app', tag: 'travel' },
  // The old template marker. `isStarter` is a separate platform decision and
  // is not touched by this mapping.
  starter: { kind: 'manual', solutionType: 'template' },
} satisfies Record<string, LegacyCategoryMapping>);

/**
 * The prescription a `retiredKey()` tombstone carries for a retired `category`
 * key, opened by the fully qualified key it sits on.
 */
export function retiredCategoryGuidance(qualifiedKey: string): string {
  return `\`${qualifiedKey}\` was removed in @objectstack/spec 18 (ADR-0087) — one category had to say both who a `
    + 'package is for and what it is, and the platform and the cloud catalog spelled it from lists that disagreed. '
    + 'Delete the key. Declare `businessFunctions` (1-3 business functions, the primary one first), optionally '
    + '`industries` (up to 3; absent means cross-industry) and `solutionType` (`app`, `template` or `connector`; '
    + 'absent means `app`). `LEGACY_CATEGORY_MAPPING` in @objectstack/spec/marketplace gives the facets for every '
    + 'old category value.';
}
