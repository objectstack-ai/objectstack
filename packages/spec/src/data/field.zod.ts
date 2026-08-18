// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';
// Package-internal, like `strict-object` itself — the `shared/index.ts` barrel
// deliberately does not re-export it, so nothing about the public API surface
// moves. No cycle back into this file: that module's only runtime import is
// `shared/visibility.ts`, which imports nothing at runtime.
import { SELECT_OPTION_EDITABILITY_GUIDANCE } from '../shared/editability-boundary';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { SystemIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { FilterConditionSchema } from './filter.zod';
import { FIELD_KEY_GUIDANCE } from './authoring-key-lint';
import { DEFAULT_AUTONUMBER_FORMAT } from './autonumber-format';
// #7127 — the `defaultValue` authoring gate: shape discrimination (literal /
// runtime token / CEL envelope), the per-token × per-type table, and the
// shared literal-vs-stored-contract check. `default-value-shape` reaches
// `field-value.zod`, whose only import back into THIS file is the type-only
// `FieldType` (erased at runtime) — `AddressSchema` moved there (see its
// re-export below), so the edge is one-way and no runtime ESM cycle closes.
import {
  checkLiteralDefaultValue,
  defaultValueTokenIssue,
  discriminateDefaultValueShape,
  suggestDefaultValueToken,
} from './default-value-shape';
import { AddressSchema } from './field-value.zod';
// #7918 — the ISO 4217 / CLDR fraction-digit contradiction check (maintainer
// ruling 2026-08-12, Option A). One shared verdict for both anchors: the
// field-level `precision` key and `CurrencyConfigSchema.precision`.
import { currencyPrecisionContradiction } from './currency-fraction-digits';

/**
 * Field Type Enum
 */
import { lazySchema } from '../shared/lazy-schema';
export const FieldType = z.enum([
  // Core Text. 'password' on a generic (non-better-auth) object is plaintext at
  // rest but masked to SECRET_MASK on read — the auth subsystem's one-way
  // hashing applies only to its own identity tables, never to an authored
  // 'password' field. Prefer 'secret' for reversible machine credentials. See
  // ADR-0100.
  'text', 'textarea', 'email', 'url', 'phone', 'password',
  // Secret — reversible, encrypted-at-rest value (DB password, API key, token).
  // UNLIKE 'password' (masked-on-read but plaintext at rest, or one-way hashed
  // inside the auth subsystem), a 'secret' is round-tripped: the engine encrypts
  // it on write via the registered ICryptoProvider, stores the ciphertext handle
  // in `sys_secret`, persists only an opaque ref on the row, and masks it on
  // read. Fail-closed: no provider ⇒ writes throw rather than persist cleartext.
  // See ADR-0100.
  'secret',
  // Rich Content
  'markdown', 'html', 'richtext',
  // Numbers
  'number', 'currency', 'percent', 
  // Date & Time
  'date', 'datetime', 'time',
  // Logic
  'boolean', 'toggle', // Toggle is a distinct UI from checkbox
  // Selection
  'select',       // Single select dropdown
  'multiselect',  // Multi select (often tags)
  'radio',        // Radio group
  'checkboxes',   // Checkbox group
  // Relational
  'lookup', 'master_detail', // Dynamic reference
  'tree',         // Hierarchical reference
  // User reference — a lookup specialized to the `sys_user` system object (person
  // picker; single, or multiple for collaborators/watchers). Stored IDENTICALLY to
  // 'lookup' (FK string column → sys_user.id; `multiple` ⇒ JSON) and resolved via the
  // same $expand machinery. The distinct type exists for modelling discoverability
  // (Studio/AI field palette), the user-search picker, and `current_user` defaults —
  // NOT a separate storage primitive. Ownership stays the existing `owner_id`
  // convention (plugin-security); a declarative `owner` is a possible future flag.
  'user',
  // Media
  'image', 'file', 'avatar', 'video', 'audio',
  // Calculated / System
  'formula', 'summary', 'autonumber',
  // Embedded structured values (stored as JSON on the parent row — no separate table / FK)
  'composite',    // Single embedded sub-object with declared sub-fields  (≈ Strapi component / ACF group)
  'repeater',     // Repeating embedded sub-object array with declared sub-fields  (≈ Strapi repeatable component / ACF repeater)
  'record',       // Name-keyed map of embedded sub-objects (Record<string, SubObject>). Insertion order = display order. Used for collections where each item has a stable machine name (e.g. object.fields). See ADR-0007.
  // Enhanced Types
  'location',     // GPS coordinates
  'address',      // Structured address
  'code',         // Code editor (JSON/SQL/JS)
  'json',         // Structured JSON data (untyped escape hatch)
  'color',        // Color picker
  'rating',       // Star rating
  'slider',       // Numeric slider
  'signature',    // Digital signature
  'qrcode',       // QR code / Barcode
  'progress',     // Progress bar
  'tags',         // Simple tag list
  // AI/ML Types
  'vector',       // Vector embeddings for AI/ML (semantic search, RAG)
]);

export type FieldType = z.input<typeof FieldType>;

/**
 * Field types whose stored value the RUNTIME owns outright — issued by the
 * engine (or the driver's persistent sequence), never supplied by a caller on
 * either write path. Today exactly `autonumber` (#5503).
 *
 * This is the PROTOCOL's statement of that ownership, so the consumers that act
 * on it read one vocabulary instead of each carrying its own literal: objectql's
 * write-path strips (`isRuntimeOwnedField` / `stripRuntimeOwnedFields`, which
 * treat these types as implicitly read-only), and the DataProtocol create
 * ingress, which defers to those strips rather than pre-empting them with its
 * own narrower exemption set (`stripReadonlyForInsert`, #5628).
 *
 * Keep the set to types whose value is (a) persisted, (b) issued by the runtime,
 * and (c) never legitimately supplied by a caller. `formula` and `summary` are
 * deliberately NOT here: they are derived-on-read/roll-up, not stored values a
 * caller could forge into a sequence.
 */
export const RUNTIME_OWNED_FIELD_TYPES: ReadonlySet<string> = new Set<string>(['autonumber']);

/**
 * Select Option Schema
 * 
 * Defines option values for select/picklist fields.
 * 
 * **CRITICAL RULE**: The `value` field is a machine identifier that gets stored in the database.
 * It MUST be lowercase to avoid case-sensitivity issues in queries and comparisons.
 * 
 * @example Good
 * { label: 'New', value: 'new' }
 * { label: 'In Progress', value: 'in_progress' }
 * { label: 'Closed Won', value: 'closed_won' }
 * 
 * @example Bad (will be rejected)
 * { label: 'New', value: 'New' } // uppercase
 * { label: 'In Progress', value: 'In Progress' } // spaces and uppercase
 * { label: 'Closed Won', value: 'Closed_Won' } // mixed case
 */
/**
 * Shared history for the authorable shapes in this file (#4001).
 *
 * This object carries more silently-stripped keys than any other in the spec,
 * and it documented the fact about itself for two releases: the notes below on
 * `accept`/`maxSize` and on the five pruned governance keys both say a write
 * "parsed clean and the key was silently stripped", and both call it the
 * ADR-0104 failure class. `FieldSchema` was not `.strict()`, so the only
 * available fix each time was a comment. This is the fix those comments wanted.
 */
const FIELD_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the field was still created, '
  + 'minus whatever the key was meant to constrain, protect or compute.';

/**
 * ## An option is offered or withheld — it is never "shown but unselectable"
 * (#8201 — boundary, not gap)
 *
 * There is no `disabled`, `readonly` or `readonlyWhen` on a select option, and
 * that is a **deliberate boundary** rather than a slot nobody added. It is the
 * 2026-08-12 #7887 ruling reaching its third shape, on that ruling's own
 * premise re-measured for this one: nothing in the object-field pipeline these
 * options feed reads a per-option enabled/disabled flag — objectui's select and
 * radio widgets treat the FIELD-level state as the single authority — so
 * declaring one here would ship the ADR-0049 declared-but-unenforced shape.
 * (A shown-but-unselectable option does exist in objectui's SDUI component
 * family, but on that package's own option vocabulary, not this shape.)
 *
 * Writing one anyway stays a loud parse error — unchanged — and since #8201
 * that error carries {@link SELECT_OPTION_EDITABILITY_GUIDANCE}, which points
 * at the two things that are real: {@link SelectOptionSchema.visibleWhen} to
 * withdraw THIS option (per record or, uniquely on this surface, per
 * `current_user` — ADR-0068), and `readonly` / `readonlyWhen` on the FIELD to
 * freeze the whole picker.
 *
 * If a non-selectable field option ever earns a real reader, that is a spec
 * decision that widens the accepted set — this boundary records what the
 * platform honours today, not a claim that the answer can never change.
 */
export const SelectOptionSchema = lazySchema(() => strictObject({
  surface: 'this select option',
  history: FIELD_HISTORY,
  aliases: { text: 'label', name: 'label', title: 'label', key: 'value', id: 'value', isDefault: 'default', selected: 'default', colour: 'color', visible: 'visibleWhen', showWhen: 'visibleWhen' },
  // #8201. No alias row for the editability family, per the same red line the
  // mother ruling drew: an alias names a key the shape must then accept, and
  // this shape accepts none of them. The set consumes those spellings before
  // the rename channel runs, and none of the alias keys above is a member, so
  // no existing pointer is shadowed (`alias-integrity.test.ts`, #7889).
  guidanceSets: [SELECT_OPTION_EDITABILITY_GUIDANCE],
}, {
  label: z.string().describe('Display label (human-readable, any case allowed)'),
  value: SystemIdentifierSchema.describe('Stored value (lowercase machine identifier)'),
  color: z.string().optional().describe('Color code for badges/charts'),
  default: z.boolean().optional().describe('Is default option'),
  /**
   * Per-option visibility predicate (CEL) — the option is offered only when this
   * evaluates TRUE. Omit = always available. Evaluated against the live `record`
   * PLUS the host's global predicate scope, which carries `current_user` — so it
   * expresses BOTH cascading/dependent options (`record.country == 'cn'`) AND
   * role/context gating (`'admin' in current_user.positions`).
   *
   * This scope is WIDER than field-level `visibleWhen`, not the same (#6146):
   * options resolve through `resolveCascadingOptions` against the predicate
   * scope (ADR-0068 / objectui#2284), while field- and section-level rules go
   * through `evalFieldPredicate`, which binds `record` + `previous` + `parent`
   * and never `current_user` (objectui#1582). Per-option is the one `*When`
   * surface where a `current_user` test actually resolves. When it references
   * sibling fields, declare those on the field's `dependsOn` so the form can gate
   * and re-evaluate the option list as the parent changes.
   *
   * ⚠️ Client-side hiding is UX, not authorization. When an option is gated for
   * access-control reasons the server MUST also reject writes of its value (the
   * rule-validator evaluates the picked value's `visibleWhen`) — hiding it in the
   * dropdown alone is bypassable.
   */
  visibleWhen: ExpressionInputSchema.optional().describe("Per-option visibility predicate (CEL) — option is offered only when TRUE (else omitted). Env: the live `record` plus the host predicate scope, which binds `current_user` — wider than field-level visibleWhen, which has no `current_user`. e.g. P`record.country == 'cn'` or P`'admin' in current_user.positions`"),
}));

/**
 * Location Coordinates Schema
 * GPS coordinates for location field type
 *
 * @deprecated Never consumed by the runtime, and its key names contradict what
 * the platform actually stores: a `location` value is `{lat, lng}` (see the
 * field-zoo round-trip oracle), not `{latitude, longitude}`. Use
 * `LocationValueSchema` / `valueSchemaFor` from `field-value.zod.ts`
 * (ADR-0104 D1). Removal rides the next spec major.
 */
export const LocationCoordinatesSchema = lazySchema(() => z.object({
  latitude: z.number().min(-90).max(90).describe('Latitude coordinate'),
  longitude: z.number().min(-180).max(180).describe('Longitude coordinate'),
  altitude: z.number().optional().describe('Altitude in meters'),
  accuracy: z.number().optional().describe('Accuracy in meters'),
}));

/**
 * Currency Configuration Schema
 * Configuration for currency field type supporting multi-currency
 * 
 * Note: Currency codes are validated by length only (3 characters) to support:
 * - Standard ISO 4217 codes (USD, EUR, CNY, etc.)
 * - Cryptocurrency codes (BTC, ETH, etc.)
 * - Custom business-specific codes
 * Stricter validation can be implemented at the application layer based on business requirements.
 */
export const CurrencyConfigSchema = lazySchema(() => strictObject({
  surface: 'this currency configuration',
  history: FIELD_HISTORY,
  aliases: { decimals: 'precision', scale: 'precision', mode: 'currencyMode', currency: 'defaultCurrency', code: 'defaultCurrency', isoCode: 'defaultCurrency' },
}, {
  /**
   * #7918 — `.default(2)` moved off this property and into the `.overwrite()`
   * below, and this placement is load-bearing. A property-level default
   * materializes AT PARSE, so a refinement over the parsed object cannot tell
   * an authored `precision: 2` from an untouched one — and a rule firing on
   * the baked default would refuse every untouched JPY currencyConfig (the
   * permanently-noisy shape the ruling forbids). Declared `.optional()`, the
   * authored-vs-absent distinction survives to the `.superRefine` below;
   * the `.overwrite` then materializes the same `2` AFTER the check, so parse
   * OUTPUT is byte-identical to the `.default(2)` era. The `default: 2`
   * annotation states the contract default to schema consumers without
   * touching parse order — the `autonumberFormat` pattern below.
   */
  precision: z.number().int().min(0).max(10).optional().meta({
    description: 'Decimal precision (default: 2)',
    default: 2,
  }),
  currencyMode: z.enum(['dynamic', 'fixed']).default('dynamic').describe('Currency mode: dynamic (user selectable) or fixed (single currency)'),
  defaultCurrency: z.string().length(3).default('CNY').describe('Default or fixed currency code (ISO 4217, e.g., USD, CNY, EUR)'),
}).superRefine((config, ctx) => {
  // #7918 (maintainer ruling 2026-08-12, Option A): an AUTHORED `precision`
  // that contradicts the statically-known currency's ISO 4217 / CLDR fraction
  // digits is a publish-time error — `precision: 2` on a fixed-JPY config asks
  // for two digits of a minor unit the yen does not have; `precision: 2` on
  // fixed-KWD silently drops the third fils digit that exists.
  //
  // Deliberately partial, per the ruling: only `currencyMode: 'fixed'` pins a
  // single currency to check against — `dynamic` mode is out of reach BY
  // DESIGN (do not "improve" it), and codes outside CLDR `currencyData`
  // (crypto/custom) fail OPEN. `config.precision` here is pre-`.overwrite`,
  // so `undefined` means "not authored" — the defaulted 2 on an untouched
  // fixed-JPY config never fires. `defaultCurrency` and `currencyMode` keep
  // their property defaults: in authored-`fixed` mode the (possibly defaulted)
  // `defaultCurrency` IS the field's one currency, so an authored `precision`
  // contradicting it is judged even when the code itself was defaulted.
  if (config.precision === undefined || config.currencyMode !== 'fixed') return;
  const contradiction = currencyPrecisionContradiction(config.defaultCurrency, config.precision);
  if (contradiction !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['precision'], message: contradiction });
  }
}).overwrite((config) => ({
  // #7918 — the relocated `.default(2)`, applied AFTER the check above.
  // `.overwrite()` rather than `.transform()` per the measured #6926 precedent
  // (view.zod.ts `foldFormGroupsIntoSections`): it keeps this schema a
  // `ZodObject` (a pipe has no `.extend` and answers shape introspection with
  // an empty set), and checks run in attachment order, so the superRefine
  // above always sees the pre-materialized value. Rebuilt in shape order so
  // the output is byte-identical to the `.default(2)` era:
  // `{precision, currencyMode, defaultCurrency}`, `precision` always a number.
  // The one accepted cost, same as #6926's: the INFERRED output type still
  // declares `precision?` even though a parsed config always carries it
  // (ADR-0122 forbids hand-narrowing `CurrencyConfigParsed`); the runtime
  // contract is the enforced one.
  precision: config.precision ?? 2,
  currencyMode: config.currencyMode,
  defaultCurrency: config.defaultCurrency,
})));

/**
 * Currency Value Schema
 * Runtime value structure for currency fields
 *
 * Note: Currency codes are validated by length only (3 characters) to support flexibility.
 * See CurrencyConfigSchema for details on currency code validation strategy.
 *
 * @deprecated This shape was never consumed and contradicts the actual runtime
 * contract: a `currency` field's value is a BARE NUMBER everywhere (validator,
 * SQL driver `float` column, import coercion, field-zoo oracle); the currency
 * code lives in field config (`CurrencyConfigSchema`), not per value. Use
 * `valueSchemaFor` from `field-value.zod.ts` (ADR-0104 D1). Removal rides the
 * next spec major.
 */
export const CurrencyValueSchema = lazySchema(() => z.object({
  value: z.number().describe('Monetary amount'),
  currency: z.string().length(3).describe('Currency code (ISO 4217)'),
}));

/**
 * Address Schema — structured address for the `address` field type.
 *
 * DECLARED in `./field-value.zod` since #7127 (it IS the enforced address
 * VALUE contract, ADR-0104 D1) and re-exported here for compatibility. The
 * move is what lets THIS file import the value-contract module for its
 * `defaultValue` gate without closing a runtime ESM cycle: `field-value.zod`
 * dereferenced `AddressSchema` at module-eval time, and that top-level read
 * was the one runtime edge back into this file (its remaining `FieldType`
 * import is type-only, erased at runtime).
 */
export { AddressSchema };

/**
 * Field Schema - Best Practice Enterprise Pattern
 */
/**
 * Field Definition Schema
 * Defines the properties, type, and behavior of a single field (column) on an object.
 * 
 * @example Lookup Field
 * {
 *   name: "account_id",
 *   label: "Account",
 *   type: "lookup",
 *   reference: "accounts",
 *   required: true
 * }
 * 
 * @example Select Field
 * {
 *   name: "status",
 *   label: "Status",
 *   type: "select",
 *   options: [
 *     { label: "Open", value: "open" },
 *     { label: "Closed", value: "closed" }
 *   ],
 *   defaultValue: "open"
 * }
 */
/**
 * Prescriptive rejection for a mis-spelled `unique` scope (ADR-0120
 * §Terminology): the error must carry the vocabulary and, for the two
 * predictable near-misses (`'tenant'`, `'org'`), name `'organization'`
 * explicitly — a typo must be a loud, fixable parse error, never a silent
 * scope change. Declared before `UniqueScopeSchema` because
 * `OS_EAGER_SCHEMAS=1` evaluates the factory at module load (TDZ).
 *
 * ⚠️ **The last hand-written `$ZodErrorMap` in `packages/spec`, and it stays
 * one.** This docblock used to say "pattern of `strictCapabilitiesError`";
 * #6805 folded that sibling into the shared `strictObject` template and the
 * pointer would have gone stale, so it is replaced by the reason this map is
 * NOT following it. The fold's channel is `unrecognized_keys` — an unknown
 * KEY, answered from a per-key `guidance` table. This map answers
 * `invalid_union`, a VALUE-level verdict on a key the schema declares, which
 * `strictObject` does not address at any level. Folding it would be a category
 * error, and `alias-integrity.test.ts`'s class pin
 * (`NO module outside the shared helpers writes its own unrecognized_keys
 * map`) is scoped by `issue.code` precisely so this site is out of class by
 * measurement rather than by an exemption — that pin reads this file as a live
 * control.
 */
const uniqueScopeError: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== 'invalid_union') return undefined;
  const input = (issue as { input?: unknown }).input;
  const spelled = typeof input === 'string' ? `'${input}'` : String(input);
  const nearMiss =
    input === 'tenant' || input === 'org'
      ? ` ${spelled} is not accepted and is not an alias — the per-organization scope is spelled 'organization' (ADR-0120: "tenant" is overloaded across deployment topologies, and the platform spells the word out).`
      : '';
  return (
    `Invalid unique scope ${spelled}. Allowed: true/false, 'organization' ` +
    `(one holder per organization — the explicit spelling of true), or 'global' ` +
    `(one holder across the whole installation).${nearMiss}`
  );
};

/**
 * Uniqueness scope for a `unique` constraint (#3696, ADR-0120 D1).
 *
 * The vocabulary is `boolean | 'global' | 'organization'` — the scope of a
 * unique constraint is *said*, never inferred from where the declaration sits.
 *
 * `unique: true` on an organization-scoped object materializes as a COMPOSITE
 * unique index `(organization key part, field)` — "unique within the
 * organization" — matching how every other tenant-aware subsystem already
 * behaves (reads are RLS-filtered, writes stamp the tenant column, and the
 * autonumber sequence table is keyed by `(object, tenant_id, field, scope)` so
 * each organization counts from 1). A single-column global index contradicted
 * that: two organizations each issuing `PROD-00001` collided on an index
 * neither of them could see, and the resulting UNIQUE violation doubled as a
 * cross-tenant existence oracle (a rejected insert told org B that *somebody
 * else* holds the value).
 *
 * `unique: 'organization'` is the EXPLICIT spelling of that same
 * per-organization scope (ADR-0120 D1) — a synonym of `true` at field level,
 * with identical materialization. Non-normative guidance: official examples,
 * scaffolding, and generators emit `'organization'` in new code so intent is
 * legible without knowing the positional default; bare `true` stays valid
 * indefinitely (it has exactly one documented meaning here and no trap).
 *
 * `unique: 'global'` opts into installation-wide uniqueness for the genuinely
 * platform-wide identifiers where it is correct: an external provider id
 * (`stripe_customer_id`), a DNS hostname, a globally reserved slug, a device
 * identity. Global uniqueness is the special case and has to say so.
 *
 * NULL-safety of the per-organization scope (ADR-0120 D3, #5030): the kernel
 * injects `organization_id` unconditionally, so on single-organization stacks
 * the column exists and is NULL on every row — and SQL UNIQUE is
 * NULL-distinct, so a raw-column composite `(organization_id, field)` enforces
 * NOTHING there. The organization key part therefore materializes NULL-safe as
 * `COALESCE(organization_id, '__global__')` (driver-side, #5030): NULL-org
 * rows collapse into one platform bucket, unique among themselves; non-NULL
 * rows are untouched. On an object with no tenant column at all
 * (`tenancy.enabled: false`) both per-organization spellings degrade to the
 * listed column alone.
 *
 * Rejected words (ADR-0120 §Terminology): `'tenant'` and `'org'` are not
 * accepted and are NOT aliases — "tenant" is overloaded across deployment
 * topologies and the platform spells the noun out (`organization_id`). The
 * parse error names `'organization'` so the fix ships inside the rejection.
 */
export const UniqueScopeSchema = lazySchema(() =>
  z.union([z.boolean(), z.literal('global'), z.literal('organization')], {
    error: uniqueScopeError,
  }),
);

/** @see UniqueScopeSchema */
export type UniqueScope = boolean | 'global' | 'organization';

/**
 * Does this `unique` declaration ask for platform-wide (cross-tenant)
 * uniqueness? Single source of truth for every driver that materializes a
 * unique constraint (SQL DDL, Mongo index sync) so they cannot drift.
 */
export function isGlobalUnique(unique: unknown): boolean {
  return unique === 'global';
}

/**
 * Does this `unique` declaration ask for a unique constraint at all?
 * `true`, `'global'` and `'organization'` do; `false`/absent do not.
 * `'organization'` counts from the moment the word exists (ADR-0120 D1) —
 * a scope the vocabulary accepts but no driver reads would be
 * declarable-but-inert, the exact ADR-0078 class this vocabulary closes.
 */
export function isUniqueDeclared(unique: unknown): boolean {
  return unique === true || unique === 'global' || unique === 'organization';
}

/**
 * Is this the EXPLICIT `'organization'` spelling (ADR-0120 D1)?
 *
 * Deliberately narrow — it detects the word, not the scope. At field level,
 * bare `true` also means per-organization (the positional default;
 * `isUniqueDeclared(u) && !isGlobalUnique(u)` is that question), so field
 * consumers need no new predicate. This helper exists for the DECLARED-index
 * side, where the two spellings differ: `'organization'` asks the driver to
 * prepend the NULL-safe organization key part at registration, while bare
 * `true` stays verbatim (deprecated spelling of `'global'` — warned in 17.x,
 * rejected at protocol 18). Single source of truth so SQL and Mongo index
 * sync cannot drift on the distinction.
 */
export function isOrganizationUnique(unique: unknown): boolean {
  return unique === 'organization';
}

/**
 * Partial-masking presets (#8993, maintainer ruling 2026-08-16, Option A).
 *
 * A CLOSED enum, deliberately: free-form format strings are exactly where
 * AI-authored metadata errors hide (an unparseable format silently degrades or
 * silently over-reveals), so the vocabulary is named presets plus one
 * keep-head/keep-tail escape hatch — no per-role rule matrices, no template
 * strings. Each preset is a deterministic, length-preserving transform
 * implemented by `@objectstack/plugin-security`'s `maskFieldValue`
 * (`field-masker.ts` — the single enforcement channel):
 *
 * - `phone`        — keep first 3 + last 4 (`138****5678`)
 * - `id_card`      — keep first 6 + last 4 (`110101********1234`)
 * - `bank_account` — keep last 4 only (`************1234`)
 * - `email`        — keep the local part's first character + the full domain
 *                    (`j***@example.com`)
 * - `name`         — keep the first character (`张**`)
 */
export const FIELD_MASKING_PRESETS = ['phone', 'id_card', 'bank_account', 'email', 'name'] as const;

/** @see FIELD_MASKING_PRESETS */
export type FieldMaskingPreset = (typeof FIELD_MASKING_PRESETS)[number];

/**
 * The keep-head/keep-tail escape hatch for the long tail of business formats
 * the presets do not name (an employee id, a license plate, a policy number).
 * Keeps the first `keepHead` and last `keepTail` characters and masks
 * everything between with `*`; a value too short to keep both ends is masked
 * entirely (the safe direction — degrade toward MORE masking, never less).
 * `{ keepHead: 0, keepTail: 0 }` is legal and masks the whole value.
 */
export const FieldMaskingKeepSchema = lazySchema(() => strictObject({
  surface: 'this masking rule',
  history: FIELD_HISTORY,
  aliases: { head: 'keepHead', prefix: 'keepHead', keepStart: 'keepHead', tail: 'keepTail', suffix: 'keepTail', keepEnd: 'keepTail' },
}, {
  keepHead: z.number().int().min(0).describe('Number of leading characters to leave readable'),
  keepTail: z.number().int().min(0).describe('Number of trailing characters to leave readable'),
}));

/** @see FieldMaskingKeepSchema (ADR-0122: bare alias = the AUTHOR state; input and parsed coincide here — no transform, no defaults) */
export type FieldMaskingKeep = z.input<typeof FieldMaskingKeepSchema>;

/**
 * A field's declared partial-masking rule — a named preset or the
 * keep-head/keep-tail form. See the `maskingRule` key on {@link FieldSchema}
 * for the enforcement contract.
 */
export const FieldMaskingRuleSchema = lazySchema(() => z.union([
  z.enum(FIELD_MASKING_PRESETS),
  FieldMaskingKeepSchema,
]));

/** @see FieldMaskingRuleSchema */
export type FieldMaskingRule = FieldMaskingPreset | { keepHead: number; keepTail: number };

/**
 * `FIELD_KEY_GUIDANCE`, re-expressed as `strictObject` options.
 *
 * That table is the curated list of near-misses and retirements on this exact
 * surface — twenty-odd entries, every one found in the wild, and already held
 * honest by `authoring-key-lint.test.ts` (every `to` must name a key this schema
 * really declares; no entry may exist for a key that is still live). Copying it
 * here would have made a second copy of the truth, which is the thing this
 * campaign keeps finding rotted.
 *
 * It also carries knowledge the fallback cannot rederive, and the proof is in
 * that file: `pii` is three edits from `min`, so an edit-distance suggester
 * offers "did you mean `min`?" — confident, wrong, and about an unrelated
 * concept. The lint suppressed that years ago. Closing this shape without
 * reusing the table reintroduced it verbatim, which is how this wiring got
 * written.
 *
 * `to` becomes an alias (the concept survives under another key); `why` becomes
 * guidance (a retirement with no successor, which also suppresses the rename).
 * The table's consumer changes here — the lint no longer reaches `field` now
 * that the parse rejects first — but the table itself is unchanged and still
 * tested.
 */
function fieldKeyGuidanceAsStrictOptions() {
  const aliases: Record<string, string> = {};
  const guidance: Record<string, string> = {};
  for (const [key, hint] of Object.entries(FIELD_KEY_GUIDANCE)) {
    if (hint.to) aliases[key] = hint.to;
    else if (hint.why) guidance[key] = hint.why;
  }
  return { aliases, guidance };
}

/**
 * What `z.array(z.any())` cost on the two explicit column lists below (#9227):
 * every column object validated — right keys, wrong keys, misspelled keys,
 * empty objects — so a mis-keyed column published clean and surfaced only in
 * the browser, as a grid with the right row COUNT and every cell blank
 * (objectui#3951 measured exactly this failure one seam over, in the
 * renderer). A lenient producer schema is where AI-generated metadata errors
 * hide; these shapes close it at publish time.
 */
const INLINE_GRID_COLUMN_HISTORY =
  'Until #9227 closed this shape these parsed as `z.any()` — a mis-keyed column published '
  + 'clean and rendered as blank cells, with nothing naming the wrong key.';

/**
 * One explicit column of the inline master-detail grid (`inlineColumns`).
 *
 * STRICT mirror of the objectui inline-grid renderer's `GridColumn`
 * (`packages/fields/src/widgets/GridField.tsx`, hydration in
 * `packages/plugin-form/src/deriveMasterDetail.ts`) — the objectui#3951
 * `name`-keyed contract. Admits exactly the keys that renderer has a live
 * read for (measured against objectui main, 2026-08-17); an unknown key is a
 * named rejection at publish time, and the retired `field` spelling is
 * refused with a prescription naming `name`.
 *
 * The minimal — and recommended — authored entry is identity-only
 * (`{ name: 'quantity' }`): when a column declares no `type`, objectui's
 * `hydrateColumns` fills `label`, `type`, `options`, the lookup target and
 * conditional rules, and the computed expression from the child object's own
 * field definitions, so the columns cannot drift from the fields they show.
 * Declaring a `type` opts that column out of hydration entirely — supply the
 * extras it needs (options / reference / …) yourself.
 */
export const InlineGridColumnSchema = lazySchema(() => strictObject({
  surface: 'this inline grid column',
  history: INLINE_GRID_COLUMN_HISTORY,
  aliases: {
    // The retired grid spelling: objectui#3951 aligned the widget to `name`
    // (the FORM-layer identity key), with deliberately no tolerant alias in
    // the renderer — the refusal here is the producer-side half of that.
    field: 'name', fieldName: 'name', key: 'name',
    title: 'label', header: 'label',
    size: 'width',
    // The field-level formula key; a grid column's computed cell reads the
    // bare arithmetic `expr` (paired with `computed`), never a CEL envelope.
    expression: 'expr',
    hidden: 'defaultHidden',
  },
}, {
  name: z.string().min(1).describe('Child field this column shows — the key the grid reads and writes on each row object (objectui GridColumn.name, #3951). The retired `field` spelling is refused.'),
  label: z.string().optional().describe("Column header; defaults to the child field's label via hydration."),
  type: z.enum(['text', 'number', 'currency', 'date', 'datetime', 'time', 'select', 'lookup', 'file']).optional().describe("Cell control, derived from the child field's type when omitted. Declaring it opts the column out of schema hydration — supply the extras (options / reference / …) yourself."),
  width: z.number().positive().optional().describe('Fixed column width in px; omitted columns use type-based role sizing (text flexes, numeric/date/select stay fixed).'),
  required: z.boolean().optional().describe('Cell is flagged inline-invalid while empty. Computed columns are never required.'),
  options: z.array(strictObject({
    surface: 'this inline grid column option',
    history: INLINE_GRID_COLUMN_HISTORY,
    aliases: { text: 'label', name: 'label', title: 'label', key: 'value', id: 'value' },
  }, {
    label: z.string().describe('Option label shown in the select cell.'),
    value: z.string().min(1).describe("Stored option value; must match the child select field's option values."),
  })).optional().describe("Select-cell options for `type: 'select'`; derived from the child field's options when the column declares no `type`."),
  prefix: z.string().optional().describe("Currency symbol rendered inside a `currency` cell (default '¥')."),
  step: z.number().positive().optional().describe('Input step for numeric cells.'),
  reference: z.string().optional().describe("Referenced object for `type: 'lookup'` cells; derived from the child lookup field when the column declares no `type`."),
  displayField: z.string().optional().describe('Label field shown for a picked lookup record.'),
  idField: z.string().optional().describe('Id field stored for a picked lookup record.'),
  multiple: z.boolean().optional().describe('Multi-value column: multi-record lookup, or multi-file upload cell.'),
  accept: z.array(z.string()).optional().describe("Accepted MIME types / extensions for a `file` cell's picker (e.g. ['image/*', '.pdf']); omit to accept anything."),
  defaultHidden: z.boolean().optional().describe("Collapsed into the grid's column chooser by default (not dropped); required columns are never default-hidden."),
  computed: z.boolean().optional().describe('Read-only computed column, recomputed live from sibling cells via `expr` and written back into the row.'),
  expr: z.string().min(1).optional().describe("Arithmetic expression for a computed column — a BARE string over `+ - * / %`, parentheses, numeric literals and field refs (`record.qty` or `qty`), evaluated by the grid's own safe evaluator. Deliberately NOT a CEL Expression envelope; `{ dialect, source }` is refused here."),
  scale: z.number().int().nonnegative().optional().describe('Decimal places to round a computed numeric/currency result to.'),
  autofill: z.boolean().optional().describe("For `lookup` columns: picking a record copies its same-named fields into sibling columns (a product's unit_price/description). On by default; set false to disable."),
  readonlyWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — the cell is read-only when TRUE, evaluated per row against the row as `record` plus the header as `parent` (e.g. P`parent.status == 'paid'`)."),
  requiredWhen: ExpressionInputSchema.optional().describe('Predicate (CEL) — the cell is required when TRUE. Same `record` + `parent` scope as `readonlyWhen`.'),
}));

export const FieldSchema = lazySchema(() => strictObject({
  surface: 'this field',
  history: FIELD_HISTORY,
  aliases: {
    ...fieldKeyGuidanceAsStrictOptions().aliases,
    fieldName: 'name', key: 'name', column: 'name',
    dataType: 'type', fieldType: 'type',
    title: 'label', displayName: 'label',
    help: 'inlineHelpText', helpText: 'inlineHelpText', hint: 'inlineHelpText', tooltip: 'inlineHelpText',
    default: 'defaultValue', initialValue: 'defaultValue',
    isRequired: 'required', mandatory: 'required', notNull: 'required',
    isUnique: 'unique',
    values: 'options', choices: 'options', picklist: 'options', selectOptions: 'options',
    relatedTo: 'reference', referenceTo: 'reference', target: 'reference', targetObject: 'reference', lookupObject: 'reference',
    onDelete: 'deleteBehavior', deleteRule: 'deleteBehavior', cascade: 'deleteBehavior',
    formula: 'expression', calculation: 'expression', compute: 'expression',
    // `rollup` alone covers `rollUp` / `roll_up` / `Roll-Up` — `aliasProbe`
    // folds case and separators, so a second spelling was never reachable
    // (#5481).
    rollup: 'summaryOperations', summary: 'summaryOperations', aggregate: 'summaryOperations',
    length: 'maxLength', size: 'maxLength',
    decimals: 'scale', decimalPlaces: 'scale', digits: 'precision',
    isReadonly: 'readonly', disabled: 'readonly',
    isHidden: 'hidden', invisible: 'hidden',
    // `showWhen` has only one reading — a predicate — so it renames. Its
    // sibling `visible` has two on this surface and is answered in prose
    // below; `disabled` already renames onto `readonly` above, which is the
    // right target here because a field has `readonlyWhen`, not `disabledWhen`
    // (#7832).
    showWhen: 'visibleWhen',
    section: 'group', category: 'group', fieldset: 'group',
    component: 'widget', renderer: 'widget', control: 'widget',
    mimeTypes: 'accept', allowedTypes: 'accept', fileTypes: 'accept',
    maxFileSize: 'maxSize', maxBytes: 'maxSize',
    trackChanges: 'trackHistory', feedTracked: 'trackHistory',
    permissions: 'requiredPermissions', requiredCapabilities: 'requiredPermissions',
  },
  guidance: {
    ...fieldKeyGuidanceAsStrictOptions().guidance,
    // Entries the lint's table does not carry, because the lint never had to:
    // these are the removals recorded only as comments on this object, and a
    // comment is visible to everyone except the author who got it wrong.
    columnName:
      '`columnName` was removed in the 16.x line (#2377) — the SQL driver hardcodes the physical '
      + 'column to the field key, so a custom name was ignored. External/federated objects map '
      + 'physical columns with `external.columnMap` (ADR-0062 D7).',
    // `currency` is not, and has never been, a declared FieldSchema key — it is
    // not a retirement, just a natural spelling with no landing key of its own
    // (#8163). Prose rather than an `aliases` rename because the target is a
    // NESTED key: `currencyConfig.defaultCurrency` under `currencyMode: 'fixed'`,
    // which a flat rename cannot express. The spelling is not hypothetical —
    // objectui's `resolveFieldCurrency` reads `field.currency` first from looser
    // grid/column configs, so it circulates in configs an AI author will have
    // seen.
    currency:
      '`currency` is not a field key — a fixed currency is declared as `currencyConfig: '
      + '{ currencyMode: \'fixed\', defaultCurrency: \'JPY\' }`. A field without one uses '
      + 'the tenant default at runtime.',
    referenceFilters:
      '`referenceFilters` (string[]) was removed in the 16.x line (#2377) — the lookup picker only '
      + 'ever read the structured form. Use `lookupFilters: [{ field, operator, value }]`.',
    // `notNull` is aliased to `required` above for the common case, but ADR-0113
    // makes the two deliberately distinct and the distinction IS the point, so
    // the flattened spelling gets its own sentence rather than a rename.
    storageNotNull:
      'physical column constraints live under `storage` — write `storage: { notNull: true }` '
      + '(ADR-0113). `required` is the WRITE contract and deliberately does not imply the column '
      + 'constraint.',
    tracked: '`tracked` is not a field key — per-field timeline tracking is `trackHistory: true` (ADR-0052 §5b).',
    // Prose rather than a rename, because this surface declares BOTH forms and
    // the two answers have opposite polarity: renaming onto `visibleWhen` sends
    // `visible: false` to a slot that wants a CEL string, and renaming onto
    // `hidden` silently inverts the value the author already wrote. Naming both
    // is the only answer that cannot be acted on wrongly (#7832 / #7816).
    visible:
      '`visible` is not a field key, and which key you want depends on the form: a static '
      + 'boolean is `hidden` — INVERTED, so `visible: false` is `hidden: true` — while a '
      + 'per-record CEL predicate is `visibleWhen` (shown only when TRUE). Its siblings are '
      + '`readonlyWhen` and `requiredWhen`.',
  },
}, {
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name (snake_case)').optional(),
  label: z.string().optional().describe('Human readable label'),
  type: FieldType.describe('Field Data Type'),
  description: z.string().optional().describe('Tooltip/Help text'),
  format: z.string().optional().describe('Format string (e.g. email, phone)'),

  // `columnName` removed in the 16.x line (#2377, ADR-0049): the SQL driver
  // hardcodes the physical column = field key (createColumn never reads it), so
  // a custom column name was silently ignored. External/federated objects map
  // physical columns via `external.columnMap` (ADR-0062 D7 / ADR-0015).

  /**
   * Write contract (ADR-0113 — NOT a column constraint; see `storage.notNull`).
   *
   * On a multi-value lookup (`multiple: true`), `required` means NON-EMPTY
   * array: an emptied required set fails validation loudly — `[]` does not
   * satisfy `required` (#9447, maintainer ruling 2026-08-18). The empty set is
   * always representable (it reads back as `[]`, never `null` — see
   * `multiple`), so the required check judges emptiness, not absence.
   */
  required: z.boolean().default(false).describe('Write-time contract (ADR-0113): an insert must provide a non-null value, and an update may not null it out. On a multi-value lookup (`multiple: true`) required means NON-EMPTY array — an emptied required set fails validation loudly; `[]` does not satisfy it (#9447, maintainer ruling 2026-08-18). NOT a column constraint — the physical NOT NULL is a separate explicit opt-in (`storage.notNull`), so tightening this on a deployed object is safe: existing null rows stay readable, and editable as long as the write does not touch this field.'),

  /**
   * Physical storage constraints (ADR-0113). Deliberately separate from the
   * write contract above: `required` governs what a WRITE must provide;
   * `storage` governs what the COLUMN enforces. All four combinations are
   * legitimate — `required` alone is the criteria_json posture (legacy null
   * rows rest), `storage.notNull` alone is the engine-populated column
   * (audit fields, the tenant column). Declaring `notNull` over existing
   * null rows is a destructive migration gated by the schema-drift ceremony
   * (backfill first); a column STRICTER than its declaration is reported as
   * informational, never as actionable drift.
   */
  storage: z.object({
    notNull: z.boolean().optional().describe('Emit a physical NOT NULL on the column (ADR-0113). Absent = the column stays nullable even under `required: true` — the write contract is enforced at the engine, the only sanctioned write path, not by the database. Declaring this over existing null rows is a destructive migration gated by the schema-drift ceremony. Incompatible with `requiredWhen` (a conditional contract cannot be an unconditional column constraint).'),
  }).strict().optional().describe('Physical storage constraints (ADR-0113). Owns the DDL the write contract deliberately does not imply. Absent = no storage-level constraint requested.'),

  searchable: z.boolean().default(false).describe('Is searchable'),
  /**
   * Multi-value empty representation (#9447, maintainer ruling 2026-08-18):
   * an emptied multi-value lookup reads back as `[]`, never `null`. This
   * binds the field's empty representation for EVERY writer — cascade repair
   * (`set_null` member removal), form clears, API writes — not as a
   * cascade-only convention: an array field always reads as an array, so
   * readers (generated code, formula/filter predicates) never need a null
   * branch. Same ruling: `required` on a multi-value lookup means non-empty
   * array (see `required` above).
   */
  multiple: z.boolean().default(false).describe('Allow multiple values (Stores as Array/JSON). Applicable for select, lookup, file, image. An emptied multi-value lookup reads back as `[]`, never `null` — the rule binds every writer (cascade repair, form clears, API writes), not just cascade repair (#9447, maintainer ruling 2026-08-18).'),
  // `true` = unique WITHIN the tenant on a tenant-scoped object (composite
  // `(tenantField, field)` index); `'global'` = platform-wide single-column
  // unique. See {@link UniqueScopeSchema} for the scope vocabulary (ADR-0120).
  unique: UniqueScopeSchema.default(false).describe("Unique constraint and its scope (ADR-0120). 'organization' = one holder per organization (NULL-safe composite with the organization key part on organization-scoped objects) — prefer this explicit spelling in new code; true = same per-organization scope (positional synonym, stays valid); 'global' = one holder across the whole installation. 'tenant'/'org' are rejected — the word is 'organization'"),
  defaultValue: z.unknown().optional().describe('Default applied on INSERT when the field is omitted or null (`\'\'` is a real value, not absence). Three legal shapes (#7127), discriminated in the engine\'s own order: a CEL Expression envelope `{ dialect: \'cel\', source: \'today()\' }` (accepted structurally; result type is a runtime concern); a runtime TOKEN — `NOW()` on `datetime`/`date`/`time` only, `current_user` on `user` or `lookup` with `reference: \'sys_user\'` only, neither on a multi-value field; or a LITERAL, which must satisfy this field\'s own stored value contract (ADR-0104 D1 `valueSchemaFor`). Anything else is refused at parse time with a prescriptive message.'),
  
  /** Text/String Constraints */
  maxLength: z.number().optional().describe('Max character length'),
  minLength: z.number().optional().describe('Min character length'),
  
  /** Number Constraints */
  // #8321 — `precision`/`scale` are digit COUNTS, so a non-integer or negative
  // declaration has no defined meaning. #7501 made `scale` enforced at write
  // time with a deliberate `Number.isInteger(def.scale) && def.scale >= 0`
  // runtime guard that leaves a malformed declaration UNENFORCED (inventing
  // floor/round semantics in a consumer would be PD #12 guessing) — so
  // `scale: 2.5` silently got no enforcement at all: the declared-but-inert
  // shape that hides AI-authored metadata errors. Refuse it at the producer
  // instead (ADR-0078 declared=enforced; house pattern `z.number().int().min(0)`).
  // ⚠️ `CurrencyConfigSchema.precision` above is a DIFFERENT surface with its
  // own alias table (`scale → precision` there) — do not conflate.
  precision: z.number().int().min(0).optional().describe('Total digits (non-negative integer)'),
  scale: z.number().int().min(0).optional().describe('Decimal places (non-negative integer)'),
  min: z.number().optional().describe('Minimum value'),
  max: z.number().optional().describe('Maximum value'),
  /**
   * Presentation hint (#7768): whether a `number` field renders with digit
   * grouping (`Intl.NumberFormat`'s `useGrouping`, e.g. `2,026` vs `2026`).
   * `scale` was the ONLY presentation-adjacent property `number` had, and it
   * governs decimal places, not grouping — console renderers construct
   * `Intl.NumberFormat` with grouping unconditionally ON, so an
   * ordinal/identifier integer stored as `Field.number({ scale: 0, min: 1900
   * })` (a year) renders `2,026` everywhere it is shown. Downstream apps hit
   * this three times (hotcrm-heimao#35/#40/#59) and each time converted the
   * field to `Field.text` to escape the comma — trading away numeric
   * semantics (range validation, sort-as-number, arithmetic) for a display
   * detail that had nothing to do with the field's TYPE.
   *
   * Three-valued, and the absent case is deliberately NOT "grouping off":
   *   - **absent** (default state) — the author has not judged whether this
   *     number reads as a quantity or an identifier; the RENDERER decides.
   *     Today that is an interim heuristic (objectui#4033, e.g. `scale: 0`
   *     + no upper bound reads as a plain count and keeps grouping, a small
   *     bounded integer range reads as ordinal-shaped and drops it);
   *     eventually the locale's own default. Neither contract lives here —
   *     this key only carries the author's EXPLICIT override when they have
   *     one, exactly like `min`/`max`/`scale` carry constraints without
   *     asserting what an unconstrained field means.
   *   - **`false`** — the author's explicit opt-out: this integer is an
   *     identifier/ordinal (year, ID, zip code, quantity meant to scan
   *     un-grouped), never grouped regardless of what the renderer's
   *     heuristic would have guessed.
   *   - **`true`** — the author pins grouping ON, overriding the heuristic
   *     the other way (a large monetary-like count that should always read
   *     with separators even if it would otherwise be judged ordinal-shaped).
   *
   * Maps 1:1 onto `Intl.NumberFormat`'s `useGrouping` option; the console
   * number renderers are expected to pass it straight through. No default is
   * declared here on purpose — unlike `autonumberFormat`'s JSON-Schema
   * `default` annotation, there is no single grouping behavior every
   * `number` field should present until the renderer half of this contract
   * (objectui#4033) lands and retires the interim heuristic.
   */
  useGrouping: z.boolean().optional().describe('Digit-grouping presentation hint for `number` fields (#7768) — maps to `Intl.NumberFormat`\'s `useGrouping`. Absent = renderer decides (interim heuristic today, locale default eventually); `false` = author opts out of grouping (e.g. a year or other ordinal/identifier integer); `true` = author pins grouping on.'),

  /**
   * Media Constraints (ADR-0104 D3 wave 2)
   *
   * Apply to the media family — `file`, `image`, `avatar`, `video`, `audio`.
   * Declared here rather than only in the upload widget because the client's
   * check is a convenience, not a control: it can be bypassed by any caller
   * that talks to the API directly. Once the platform owns the file (`sys_file`
   * carries its MIME type and byte size), the server re-checks a record write
   * against these declarations authoritatively.
   *
   * Both were read by the upload widgets long before this — `field.accept`,
   * `field.maxSize` — while `FieldSchema` did not declare them, so an author
   * writing them had them silently stripped at parse and the constraint simply
   * never existed. That is the ADR-0104 failure class (a declaration accepted
   * in source, dropped in the contract, with no feedback); declaring them here
   * and enforcing them server-side is what closes it.
   */
  accept: z.array(z.string()).optional().describe(
    'Permitted upload types for media fields, as MIME types or extensions '
    + '(e.g. ["image/*", ".pdf"]). Offered to the file picker AND enforced on write.',
  ),
  maxSize: z.number().int().positive().optional().describe(
    'Maximum permitted file size in BYTES for media fields. Enforced on write against '
    + 'the stored file size, not just checked in the browser.',
  ),

  /** Selection Options */
  options: z.array(SelectOptionSchema).optional().describe('Static options for select/multiselect'),

  /**
   * Relationship Config
   * 
   * Used by `lookup` and `master_detail` field types to define cross-object references.
   * The `reference` property is **required** for these types — it identifies the target
   * object whose records this field links to. The engine uses `reference` during $expand
   * post-processing to resolve foreign key IDs into full related objects via batch queries.
   * 
   * For `master_detail` fields, the parent record controls the lifecycle of child records
   * (e.g., cascade delete). For `lookup` fields, the reference is a soft link.
   */
  reference: z.string().optional().describe(
    'Target object name (snake_case) for lookup/master_detail fields. '
    + 'Required for relationship types. Used by $expand to resolve foreign key IDs into full objects.'
  ),
  // `referenceFilters` (string[]) removed in the 16.x line (#2377, ADR-0049):
  // the lookup picker reads the structured `lookupFilters` ({field,operator,value}),
  // never this string[] form — as authored it filtered nothing. Use `lookupFilters`.
  deleteBehavior: z.enum(['set_null', 'cascade', 'restrict']).optional().default('set_null').describe('What happens if referenced record is deleted'),
  /**
   * Master-detail INLINE EDITING. On a child's `master_detail`/`lookup` field
   * (whose `reference` is the parent object), declare that "this child is
   * entered/edited inline within the parent's form". The parent's standard
   * create/edit form then renders the children and saves parent + children in
   * ONE atomic transaction — no form view config and no bespoke page. The intent
   * lives here in the data model; forms derive the UI.
   *
   * The value also selects the EDITING FORM FACTOR:
   *   - `true`   → auto: the UI picks `grid` or `form` from the child's shape
   *                (rich types / many fields → `form`, else `grid`).
   *   - `'grid'` → an editable line-item grid (fast bulk entry; thin children
   *                like invoice lines / order items).
   *   - `'form'` → a compact read-only list; "Add" / per-row edit opens the
   *                child's FULL form (fat children with rich types, e.g. long
   *                text, attachments, many fields).
   * Use for true line-item/composition children; leave off for associations
   * (comments, attachments) — surface those as detail-page related lists.
   */
  inlineEdit: z.union([z.boolean(), z.enum(['grid', 'form'])]).optional().describe('Edit these child records inline within the parent\'s form (atomic master-detail). true = auto-pick grid/form by child shape; \'grid\' = editable line-item grid; \'form\' = list + per-row full form.'),
  /** Optional section title for the inline grid (defaults to the child object label). */
  inlineTitle: z.string().optional().describe('Title for the inline master-detail grid'),
  /**
   * Optional explicit grid columns for the inline editor (derived from the
   * child object when omitted). Strict `name`-keyed element schema
   * ({@link InlineGridColumnSchema}, #9227) mirroring the objectui grid
   * renderer's measured reads — an unknown or retired key (`field`) is a
   * named rejection at publish time, never a blank cell at render time.
   */
  inlineColumns: z.array(InlineGridColumnSchema).optional().describe("Explicit columns for the inline grid (derived from the child object when omitted). Each entry is a strict, name-keyed column ({ name, label?, type?, … } — objectui GridColumn, #3951); identity-only entries ({ name }) hydrate everything else from the child object's fields. Unknown keys and the retired `field` spelling are refused at parse."),
  /** Optional numeric child field summed for the inline grid running total. */
  inlineAmountField: z.string().optional().describe('Numeric child field summed for the inline grid total'),

  /**
   * Detail-page RELATED LIST — the read-side mirror of `inlineEdit`. On a
   * child's `master_detail`/`lookup` field (whose `reference` is the parent),
   * this governs whether/how the child collection appears as a related list on
   * the parent's record DETAIL page. Owned children (`master_detail`) and
   * `lookup` children are shown by default (derived from the relationship);
   * set `relatedList: false` to suppress a child from the detail page (e.g.
   * noisy audit/association links you don't want surfaced). Where `inlineEdit`
   * pulls a child INTO the parent's entry form (write side), `relatedList`
   * controls its appearance on the parent's detail page (read side). The intent
   * lives here in the data model; the detail page derives the UI.
   *
   * Tri-state (ADR-0085 semantic-role style — this is a PROMINENCE hint, NOT a
   * layout switch):
   *   - `false`         → suppress this child from the parent's detail page.
   *   - `true` / absent  → shown; stacks with the other non-primary children
   *                       under a single shared "Related" tab. Only `'primary'`
   *                       earns its own tab — there is no count-based auto-split.
   *   - `'primary'`     → CORE relationship: always surfaced prominently. The
   *                       detail renderer promotes it to its own tab regardless
   *                       of child count. This states business intent (true
   *                       across every surface — detail tab, mobile card, AI
   *                       summary, search facet); "primary → own tab" is only
   *                       the DETAIL renderer's interpretation. Being prominence
   *                       (not a `relatedLayout` switch) is what admits it to the
   *                       object model under ADR-0085's admission test.
   */
  relatedList: z.union([z.boolean(), z.literal('primary')]).optional().describe('Show this child collection as a related list on the parent\'s detail page (read-side mirror of inlineEdit). false = suppress; true/absent = shown (stacked under the shared "Related" tab); \'primary\' = core relationship, promoted to its own tab. Prominence intent, not a layout switch (ADR-0085).'),
  /** Optional section title for the detail-page related list (defaults to the child object label). */
  relatedListTitle: z.string().optional().describe('Title for the detail-page related list'),
  /**
   * Optional explicit columns for the detail-page related list (derived from
   * the child object when omitted). Child FIELD-NAME STRINGS only (#9227) —
   * the read-side list derives labels, cell types and formatting from the
   * child object's field definitions, so the columns cannot drift from them.
   * Deliberately narrower than `inlineColumns`: the related list is not an
   * editable grid, and per-column display overrides are not part of its
   * measured renderer contract (objectui RelatedList hydrates string entries
   * fully; the page-block sibling `record:related_list.columns` is the same
   * strings-only shape). Column OBJECTS are refused with a prescription.
   */
  relatedListColumns: z.array(z.string({
    error: (issue) => issue.code === 'invalid_type'
      ? "Related-list columns are child FIELD-NAME strings (e.g. ['name', 'status', 'total']). "
        + 'Column objects are not authorable here: the related list derives labels, cell types and '
        + "formatting from the child object's field definitions, so declare display changes on the "
        + 'child fields themselves.'
      : undefined,
  }).min(1)).optional().describe("Explicit columns for the detail-page related list, as child field names (e.g. ['name', 'status']); derived from the child object (highlightFields → field walk) when omitted. Strings only — labels, cell types and formatting always derive from the child object's field definitions; column objects are refused at parse."),
  /**
   * Declarative default FILTER for the detail-page related list (#8704). The
   * auto-derived related list for this relationship queries the child object
   * with this constraint AND-composed with the parent-relationship condition
   * `{ [referenceField]: parentId }` — the effective predicate is the
   * conjunction, so a child row appears only when it points at the parent AND
   * matches this filter. Two clauses are CONTRACT, binding on every consumer
   * of the derived related-list descriptor (maintainer ruling 2026-08-15 on
   * #8704, 「接受全部建议。」 item 3):
   *
   *   - AUTHORED CONSTRAINT, never a user-editable suggestion — a viewer
   *     cannot remove or relax it from the rendered list.
   *   - BADGE-COUNT PARITY — the related-list tab badge count is computed
   *     over the SAME composed predicate, so the count always matches the
   *     visible rows. A count the filter does not reach ships a silent lie
   *     (rows hidden, count unchanged); parity is part of this key's
   *     semantics, not a consumer nicety.
   *
   * The canonical use is excluding soft-deleted child rows
   * (`{ status: { $ne: 'deleted' } }`) without abandoning the auto-derived
   * record page for a hand-written `record:related_list` page.
   *
   * REUSES the canonical Query-DSL {@link FilterConditionSchema} — the same
   * authoring face as a query `where`, dataset scope filters, and this file's
   * own `summaryOperations.filter` (which ANDs with the parent-FK match in
   * exactly the same way) — deliberately NOT a new dialect, so the FILTER-axis
   * doors apply here automatically: the schema door refuses bare date-range
   * preset comparands in ordering positions at parse (#8793), and the engine
   * doors judge the composed query at run time like any other `where` (a
   * virtual `formula` key is refused with `INVALID_FIELD`, #8296). Like its
   * three siblings above, it is meaningful on a child's
   * `master_detail`/`lookup` field (whose `reference` is the parent).
   */
  relatedListFilter: FilterConditionSchema.optional().describe("Declarative default filter for the detail-page related list: AND-composed with the parent-relationship condition { [referenceField]: parentId } — an authored constraint, never a user-editable suggestion. The related-list tab badge count honors the same composed filter, so counts match the visible rows. Canonical Query-DSL FilterCondition (the same dialect as a query `where`), e.g. { status: { $ne: 'deleted' } } to hide soft-deleted children."),

  /**
   * LOOKUP PICKER (forward) config — how THIS lookup/master_detail field's
   * record picker presents and scopes candidate records when the user selects a
   * related record. Read-side mirror is relatedList* (the PARENT's detail-page
   * list of children); these configure the CHILD-side picker that chooses the
   * parent. All optional: the renderer auto-derives a sensible multi-column
   * result from the referenced object's schema when omitted (objectui
   * packages/fields: LookupField / RecordPickerDialog / deriveLookupColumns,
   * which read both these camelCase keys and their snake_case aliases).
   */
  displayField: z.string().optional().describe("Field shown as each candidate's label in the picker/popover (defaults to the referenced object's name/title)."),
  descriptionField: z.string().optional().describe('Secondary field shown under the label in the quick-select popover.'),
  lookupColumns: z.array(z.union([z.string(), strictObject({
    surface: 'this lookup column',
    history: FIELD_HISTORY,
    aliases: { name: 'field', fieldName: 'field', key: 'field', title: 'label', header: 'label', size: 'width' },
  }, {
    field: z.string(),
    label: z.string().optional(),
    width: z.string().optional(),
    type: z.string().optional(),
  })])).optional().describe('Explicit columns for the record-picker table; auto-derived from the referenced object when omitted.'),
  lookupPageSize: z.number().int().positive().optional().describe('Rows per page in the record-picker dialog (default 10).'),
  lookupFilters: z.array(strictObject({
    surface: 'this lookup filter',
    history: FIELD_HISTORY,
    aliases: { name: 'field', fieldName: 'field', op: 'operator', comparator: 'operator', condition: 'operator' },
    guidance: {
      // A filter that silently does nothing on a PICKER is a filter that offers
      // records the author meant to exclude — worth naming the vocabulary.
      $in: "the operator vocabulary here is flat, not Mongo-style — write `{ field, operator: 'in', value: [...] }`",
      values: 'a multi-value filter puts the array in `value` with `operator: \'in\'`',
    },
  }, {
    field: z.string(),
    operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'in', 'notIn']),
    value: z.any(),
  })).optional().describe('Base filters restricting which records are selectable (e.g. only active). The structured, picker-honoured lookup filter.'),
  dependsOn: z.array(z.union([z.string(), strictObject({
    surface: 'this dependsOn entry',
    history: FIELD_HISTORY,
    aliases: { name: 'field', fieldName: 'field', local: 'field', remote: 'param', remoteField: 'param', key: 'param' },
  }, {
    field: z.string(),
    param: z.string().optional(),
  })])).optional().describe("Declares that this field's available values depend on the value of other field(s) on the same record — the form gates the field until they are set and re-evaluates as they change. For `lookup`/`master_detail` it scopes the candidate query (string = same local/remote key; {field,param} when the remote filter key differs — the {field,param} form is lookup-only). For `select`/`multiselect`/`radio` the actual per-option rule lives in each option's `visibleWhen`; list the referenced fields here (string form) so the option list gates and refreshes with the parent."),
  allowCreate: z.boolean().optional().describe('Allow inline quick-create from the record picker: when no match exists the user can create a record from the typed text (optimistic dataSource.create with the display field). Best for simple objects whose only required field is the display field.'),

  /** Calculation — CEL formula. Plain string accepted for back-compat; build emits canonical envelope. */
  expression: ExpressionInputSchema.optional().describe('Formula expression (CEL). e.g. F`record.amount * 0.1`'),
  /**
   * The value type a `formula` field computes, declared at authoring (the way
   * Salesforce/Airtable carry a formula's result type). Lets consumers — dataset
   * measures, display formatting, validation — read a declared type instead of
   * re-parsing the expression. Authoring stamps it from the inferred CEL type;
   * absent when the type can't be proven (an ambiguous/`dyn` expression).
   */
  returnType: z.enum(['number', 'text', 'boolean', 'date']).optional()
    .describe('Inferred value type of a formula field (number/text/boolean/date)'),
  summaryOperations: strictObject({
    surface: 'this roll-up summary',
    history: FIELD_HISTORY,
    aliases: {
      child: 'object', childObject: 'object', from: 'object', source: 'object',
      aggregate: 'function', operation: 'function', op: 'function', aggregation: 'function',
      summaryField: 'field', targetField: 'field',
      foreignKey: 'relationshipField', fk: 'relationshipField', via: 'relationshipField', parentField: 'relationshipField',
      where: 'filter', criteria: 'filter', condition: 'filter',
    },
  }, {
    object: z.string().describe('Source child object name for roll-up'),
    field: z.string().describe('Field on child object to aggregate (ignored for count)'),
    function: z.enum(['count', 'sum', 'min', 'max', 'avg']).describe('Aggregation function to apply'),
    relationshipField: z.string().optional().describe('FK field on the child pointing back to this parent. Auto-detected from the child\'s lookup/master_detail field referencing this object when omitted; set explicitly only when the child has more than one such reference.'),
    /**
     * Optional predicate that restricts WHICH child rows are aggregated — a
     * FilterCondition (the same object DSL as a query `where`), evaluated against
     * each child row. Omit to aggregate every child. This is what lets several
     * summaries roll up the SAME child object into different totals — e.g.
     * `content_publication.total_signups` = count of engagement rows where
     * `{ type: 'signup' }` vs `total_clicks` where `{ type: 'click' }`, or
     * `procurement_order.received_amount` = sum of receipt lines where
     * `{ status: 'received' }`. The engine ANDs it with the parent-FK match, so
     * a child moving in or out of the predicate (a status change) recomputes the
     * parent on its next write like any other child update.
     */
    filter: FilterConditionSchema.optional().describe("Predicate restricting which child rows are aggregated (a query `where` FilterCondition, e.g. { status: 'received' } or { type: { $in: ['signup','trial'] } }). Omit to aggregate all children. Lets one child object feed multiple filtered roll-ups."),
  }).optional().describe('Roll-up summary definition. The engine recomputes the value when child records are inserted/updated/deleted.'),

  /** Enhanced Field Type Configurations */
  // Pruned 2026-06 — per-type *display* knobs that were dead in both layers (no
  // runtime reader; renderers ignore them). See
  // docs/audits/2026-06-dead-surface-disposition-plan.md (P2 field prune): code
  // theme/lineNumbers, rating allowHalf, location displayMap/allowGeocoding, address
  // addressFormat, color colorFormat/allowAlpha/presetColors, slider showValue/marks,
  // barcode/qr barcodeFormat/qrErrorCorrection/displayValue/allowScanning.
  language: z.string().optional().describe('Programming language for syntax highlighting (e.g., javascript, python, sql)'),
  // `step` is the slider's **UI increment** and deliberately NOT a stored-value constraint —
  // ADR-0049's "ledger" half, ruled 2026-08-08 (#6514). Note it is renderer-LIVE, not dead,
  // which is why it is NOT in the pruned list above and never joins it: objectui's
  // `packages/fields/src/widgets/SliderField.tsx:14` reads it (`field.step ?? 1`) and hands it
  // to the Slider, and `packages/spec/liveness/field.json` ledgers it `live` on that evidence.
  // What it does not do is BIND the written value: the numeric branch of
  // `packages/objectql/src/validation/record-validator.ts` enforces `min`/`max` for `slider`
  // and reads `step` nowhere. The settings-side ruling (#6199 / PR #6501, which DID enforce a
  // grid) does not transfer: its hook was that schema's own "numeric bounds and step" comment
  // grouping `step` with `min`/`max`, which this declaration does not share — and enforcing a
  // grid here would make already-stored off-grid values start failing on their next edit,
  // because record-validator judges updates to existing rows. Should grid enforcement ever
  // gain real user pull it returns as a feature request in PR #6501's shape: anchor at
  // `min + k * step` (falling back to 0 when no `min` is declared), epsilon-tolerant
  // comparison. See docs/audits/2026-06-dead-surface-disposition-plan.md (P2 field prune).
  step: z.number().optional().describe('Step increment for slider (default: 1)'),

  // Currency field config
  currencyConfig: CurrencyConfigSchema.optional().describe('Configuration for currency field type'),

  // Vector field — flat dimensionality (the live authoring path).
  // The renderer reads this flat sibling (objectui VectorField.tsx:11).
  dimensions: z.number().int().min(1).max(10000).optional().describe('Vector dimensionality (e.g., 1536 for OpenAI embeddings)'),

  /**
   * Track this field's value changes on the record **activity timeline**. When
   * TRUE, the platform's activity writer renders each change as a human-readable
   * entry ("<label>: <old> → <new>") instead of a generic "Updated <object>"
   * row — no app code required. Opt-in per field (cf. Salesforce Feed Tracking,
   * ServiceNow field auditing, Dataverse column auditing). The writer already
   * captures the field diff; this flag controls whether it is surfaced legibly.
   *
   * Unlike the pruned `auditTrail` below, this flag HAS a runtime consumer
   * (`@objectstack/plugin-audit` audit-writers), satisfying enforce-or-remove
   * (ADR-0049). See ADR-0052 §5b.
   */
  trackHistory: z.boolean().optional().describe("Render this field's value changes as human-readable entries on the record activity timeline (ADR-0052 §5b). Opt-in per field."),

  // Pruned 2026-06 (dead in both layers — aspirational governance with no runtime
  // consumer; encryption/masking implied at-rest protection that never happened —
  // the real channel is type:'secret'). See
  // docs/audits/2026-06-dead-surface-disposition-plan.md (P0/P2 field prune):
  // encryptionConfig, maskingRule, auditTrail, cached, dataQuality.
  //
  // Two of the five have since RETURNED, each with a runtime consumer landing in
  // the same PR — the enforce side of ADR-0049, exactly as the paragraph below
  // prescribes: `auditTrail`'s concept as `trackHistory` (ADR-0052 §5b,
  // plugin-audit), and `maskingRule` itself (#8993, maintainer ruling
  // 2026-08-16: partial masking enforced by plugin-security's FieldMasker —
  // declared below, near `requiredPermissions`). The 2026-06 prune of the OLD
  // `maskingRule` remains correct history: that key promised protection nothing
  // delivered; the returned key is the runtime capability's authoring surface,
  // not a resurrection of the dead one.
  //
  // Two of the five value schemas outlived their keys by a release — `dataQuality`'s
  // (`DataQualityRulesSchema` + the `DataQualityRules` / `DataQualityRulesInput`
  // types, #3726) and `cached`'s (`ComputedFieldCacheSchema` + `ComputedFieldCache`,
  // #3733). Each key was gone from this object while its schema stayed on the
  // published API surface and in the generated reference docs, so an author could
  // still discover the shape and write it. This object is NOT `.strict()`, so that
  // write did not fail loudly: it parsed clean and the key was silently stripped —
  // the same ADR-0104 failure class as the pre-declaration `accept` / `maxSize`
  // above (accepted in source, dropped in the contract, no feedback). Both schemas
  // are removed as of #3733; all five keys are now dead in both layers, as the
  // tombstone above always claimed.
  //
  // If field-level data-quality governance or computed-field caching is ever built
  // for real, re-add the key and its schema TOGETHER, with a consumer — the enforce
  // side of ADR-0049. Do not restore a schema on its own; that middle state is what
  // both issues were filed about.

  /** Layout & Grouping */
  group: z.string().optional().describe('Field group name for organizing fields in forms and layouts (e.g., "contact_info", "billing", "system")'),

  /**
   * Conditional field rules (CEL predicates over `record`). Evaluated on BOTH
   * sides: the client form toggles the field's visibility / read-only / required
   * state live as the record changes (UX), and the server enforces
   * `requiredWhen` and ignores writes to a field whose `readonlyWhen` is TRUE
   * (so the rule can't be bypassed). e.g. `P\`record.status == 'paid'\``.
   */
  visibleWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — field is shown only when TRUE (else hidden). e.g. P`record.type == 'invoice'`"),
  readonlyWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — field is read-only when TRUE. e.g. P`record.status == 'paid'`"),
  requiredWhen: ExpressionInputSchema.optional().describe("Predicate (CEL) — field is required when TRUE. The only slot; the `conditionalRequired` alias was removed in protocol 17 (#3855)."),

  /**
   * [REMOVED in protocol 17 — #3855] The deprecated alias of `requiredWhen`.
   * Tombstoned rather than deleted: `FieldSchema` is deliberately not
   * `.strict()`, so a plain deletion would silently strip the key and the field
   * would never be required — the ADR-0104 / #3733 failure class this object
   * already carries a comment about.
   */
  conditionalRequired: retiredKey(
    '`conditionalRequired` was removed in @objectstack/spec 17 (#3855) — use `requiredWhen`. ' +
    'Rename the key; the value (a CEL predicate) is unchanged. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /**
   * Form widget override. Names a registered field/UI component to render this
   * field with, overriding the default widget derived from `type`. Honored by
   * the generic object form (objectui `ObjectForm`/`form.tsx` resolve
   * `widget || type`, looking the value up as `field:<widget>` in the component
   * registry). Use it when the raw `type` renderer would force a user to type
   * machine data that should be *picked* instead — e.g. an object-name field
   * (`widget: 'object-ref'`), a stored FilterCondition (`widget:
   * 'filter-condition'`), or a recipient reference whose target depends on a
   * sibling field (`widget: 'recipient-picker'`). Unknown/unregistered values
   * fall back to the `type` renderer, so it degrades safely.
   */
  widget: z.string().optional().describe('Form widget override — names a registered field component (resolved as `field:<widget>`) to render this field instead of the `type` default. Degrades to the `type` renderer when unregistered. e.g. "object-ref", "filter-condition", "recipient-picker".'),

  /** Security & Visibility */
  hidden: z.boolean().default(false).describe('Hidden from default UI'),

  /**
   * [#7728] "The declared value is never returned on the generic data path."
   *
   * Opt-in, and deliberately NOT a synonym for anything already here. `hidden`
   * is a UI contract ("Hidden from default UI") and has never governed
   * serialization; `readonly` governs the WRITE path; `requiredPermissions`
   * masks per CALLER, so it cannot express "nobody, ever". This flag is the
   * read-side complement: the engine OMITS the key from the rows it hands back
   * — on `find`, `findOne`, the 201 create body and the by-id update body, on
   * the default projection AND when a client names the field in `?select=`.
   *
   * OMIT, not mask (maintainer ruling 2026-08-12). The credential mask exists
   * to signal "a value is set" without leaking it; on a `required` column that
   * signal carries zero bits, while still shipping a value under a field whose
   * declaration promises none. So the property is dropped, not replaced.
   *
   * What it deliberately does NOT do — the flag would be unusable otherwise:
   *  - it does not touch STORAGE or encryption (that is `Field.secret`, which
   *    rewrites the column to a `sys_secret` ref);
   *  - it does not touch FILTERING or indexing, so a server-side verifier can
   *    still match on the column (`where: { key: <sha-256 hash> }`) — the strip
   *    runs on the RESULT ROWS, after the driver has evaluated the predicate;
   *  - it does not touch a purpose-built issue/mint route that returns the
   *    value once at creation off the generic path.
   *
   * This is the read protection for ADR-0100's third credential channel —
   * auth-subsystem one-way hashes on `text` columns, which `secret`/`password`
   * masking cannot reach because `collectMaskedReadFields` collects by TYPE and
   * a `text` column is never collected. ADR-0049: enforced from landing day, at
   * `Engine.maskSecretFields`.
   */
  internal: z.boolean().optional().describe("[#7728] Never return this field's value on the generic data path — the engine OMITS the key from `find`/`findOne` results, the 201 create body and the by-id update body, on the default projection AND when a client names the field in `?select=`. Storage, filtering and indexing are untouched, so a server-side verifier can still match on the column and a purpose-built mint route can still return the value once at creation. The read protection for ADR-0100's third credential channel (auth-subsystem one-way hashes on `text` columns). Omission, not masking: a mask signals 'a value is set', which carries no information on a `required` column."),

  readonly: z.boolean().default(false).describe('Read-only — never editable in forms, AND server-enforced on BOTH write paths: a non-system write to this field is silently dropped from the payload on UPDATE (#2948/#3003) and on INSERT (#3043; a create can no longer directly seed e.g. `approval_status: "approved"`), symmetric with `readonlyWhen`. A stripped INSERT field still falls back to its `defaultValue`. Exempt from the strip on BOTH paths: `isSystem` writes (seed replay, migration). Exempt on the UPDATE path ONLY: an opt-in "historical" import (`preserveAudit`, #3493) — which admits a whitelist (the audit/timestamp family plus author-declared business `readonly` fields). On INSERT the exemption does NOT apply (#6640): a non-system create that requests `preserveAudit` still has its readonly fields stripped, and is warned loudly that the exemption is UPDATE-only — replaying archival readonly facts on create requires a system context. A normal (non-system) import is NOT system-context and still strips.'),

  /**
   * [ADR-0066 D3] Capabilities required to READ/EDIT this field. A field
   * declaring `requiredPermissions` is masked on read and denied on write unless
   * the caller holds ALL listed capabilities — an AND-gate that is strictest-wins
   * over permission-set field grants. Enforced by plugin-security's FieldMasker.
   */
  requiredPermissions: z.array(z.string()).optional().describe('[ADR-0066 D3] Capabilities required to read/edit this field (mask on read, deny on write; AND-gate).'),

  /**
   * [#8993] PARTIAL masking — masked-but-recognisable values (phone last-4,
   * ID middle-8), the normal form of the control in PIPL practice: staff can
   * still verify identity over the phone without seeing the full number.
   *
   * Re-introduces the key pruned 2026-06 (see the prune note above), this time
   * WITH its runtime consumer landing in the same PR (ADR-0049 declare =
   * enforce; the `trackHistory` / `auditTrail` precedent). Enforced by
   * `@objectstack/plugin-security`'s `FieldMasker` — the ONE masking channel,
   * so an API caller and a browser user are masked identically, the CSV/XLSX
   * export path (which reads through the same engine middleware) serves the
   * same masked values as the screen, and the enterprise AI-context
   * interceptor inherits it for free. There is deliberately NO UI-side second
   * channel.
   *
   * The contract, as the maintainer ruled it (2026-08-16, Option A):
   *
   * - **Who sees masked.** A field declaring `maskingRule` is served MASKED to
   *   every non-system caller, UNLESS the field also declares
   *   `requiredPermissions` and the caller holds ALL of them (then the
   *   existing ADR-0066 D3 evaluation unmasks the full value — one permission
   *   evaluation, no parallel rule matrix). On an on-behalf-of read both the
   *   agent AND the delegator must hold them. A permission set that marks the
   *   field non-readable still wins entirely: those callers get the key
   *   DELETED, exactly as before — a masking rule never widens visibility a
   *   permission set explicitly closed.
   * - **Stable output.** Deterministic and length-preserving: the same stored
   *   value always masks to the same string, so list rendering and grouping
   *   stay stable.
   * - **No oracle.** For a caller who sees the field masked, the field is also
   *   non-filterable / non-sortable / non-groupable / non-aggregatable
   *   (rejected loudly, like FLS-hidden fields) — otherwise equality probes
   *   reconstruct the hidden span. And a write that round-trips a masked
   *   placeholder (a value that is a fixed point of its own rule and carries
   *   the mask character) is refused with `400 VALIDATION_ERROR` rather than
   *   silently destroying the stored value.
   */
  maskingRule: FieldMaskingRuleSchema.optional().describe("[#8993] Partial masking rule enforced by the runtime FieldMasker (single channel — API, UI, export and AI context all see the same masked value). A named preset ('phone' 138****5678, 'id_card' keep 6+4, 'bank_account' keep last 4, 'email' j***@example.com, 'name' keep first char) or { keepHead, keepTail }. Masked for every non-system caller unless the field's `requiredPermissions` are ALL held (that evaluation is the unmask gate); a permission set marking the field non-readable still deletes it entirely. Deterministic, length-preserving output; masked callers cannot filter/sort/group/aggregate on the field."),

  /**
   * [ADR-0100] Author's explicit acknowledgment that a generic (non-auth)
   * `password` field is stored PLAINTEXT at rest and masked to SECRET_MASK on
   * read — it is NOT one-way hashed (that lives only in the auth subsystem).
   * Set `true` to affirm the masking contract is intended; this is the
   * documented way to express "this is intended" and silences the non-fatal
   * `ObjectSchema.create()` author-time warning so a deliberate demo/design
   * starts clean (#3420). No runtime effect beyond the diagnostic; ignored on
   * non-`password` fields.
   */
  ackPlaintextMasking: z.boolean().optional().describe("[ADR-0100] Affirm a generic `password` field's plaintext-at-rest / masked-on-read contract is intended, silencing the author-time warning (#3420). No effect on non-password fields."),
  system: z.boolean().optional().describe('Auto-injected system/audit field (e.g. created_at, updated_by, organization_id). Tools that surface system fields separately from author-declared business fields should branch on this flag.'),
  sortable: z.boolean().optional().default(true).describe('Whether field is sortable in list views'),
  inlineHelpText: z.string().optional().describe('Help text displayed below the field in forms'),
  /**
   * In-input placeholder text — the HTML `placeholder` attribute on the empty
   * control, gone the moment a value is typed. Declared 2026-08-16 (#9019,
   * maintainer ruling Option C on objectui#4676): the consumer side shipped
   * first — objectui applies an object-field-level `placeholder` at render time
   * in four packages plus `apps/console` (plugin-form's auto-generated and
   * sectioned forms, plugin-detail's inline edit, app-shell's field-backed
   * action params — whose module header documents the inheritance as intended —
   * and console's FormPage, all feeding the `@object-ui/fields` widgets), while
   * this schema refused the key by name. That was the #7176 doctrine failed
   * from the producer side: measured pull, missing declaration — and the
   * classic preview-renders/save-422s trap for AI authors. The matching
   * translation surface (`FieldTranslation.placeholder`) was already declared.
   *
   * The three hint surfaces are distinct and the distinction is contract:
   * `placeholder` renders INSIDE the empty input; `inlineHelpText` renders
   * beside/under the input and stays visible; `description` is the
   * tooltip/developer documentation.
   */
  placeholder: z.string().optional().describe('Placeholder text rendered inside the empty input (the HTML placeholder attribute); disappears once a value is entered. Distinct from `inlineHelpText` (always-visible help rendered beside/under the input) and `description` (tooltip/developer documentation).'),
  /**
   * Auto-number display format. Literal text interleaved with `{...}` tokens:
   *
   *   - `{0000}` — the sequence counter, zero-padded to that many digits as a
   *     MINIMUM width (at most one slot; omit it and the bare number is
   *     appended). Past that width the number simply grows — it never wraps.
   *   - `{YYYY} {YY} {MM} {DD} {YYYYMMDD}` — generation date in the request's
   *     business timezone (`ExecutionContext.timezone`, ADR-0053; UTC fallback).
   *   - `{field_name}` — the value of another field on the SAME record
   *     (e.g. `{island_zone}`, `{plan_no}`), interpolated as text.
   *
   * The counter is scoped to whatever renders BEFORE the `{0000}` slot, so the
   * period/group resets fall out automatically — no separate reset config:
   *   - `AD{YYYYMMDD}{0000}`  → `AD202606170032`   (resets each day)
   *   - `{section}{island_zone}{000}` → `JYG1A001`  (per island)
   *   - `{plan_no}{000}`      → `…PROD20260617001001` (per parent record)
   * A fixed-prefix format with no date/field token (e.g. `CASE-{0000}`) keeps a
   * single global counter — fully backward compatible.
   *
   * A `{field}` token must name an EXISTING field that is SET before the record
   * is created (mark it `required: true`). An empty interpolated field would
   * collapse the number into the wrong counter scope, so generation throws
   * instead; `objectstack compile` lints this (unknown field → build error,
   * optional field → warning).
   *
   * ## Omitting it — the contract default (#6555)
   *
   * The key stays optional, and a field that omits it renders with
   * {@link DEFAULT_AUTONUMBER_FORMAT} — `{0000}`, i.e. `0001`, `0002`, … The
   * default belongs to the CONTRACT, not to whoever happens to be generating
   * the number: every consumer resolves it through
   * {@link resolveAutonumberFormat} rather than substituting its own. That is
   * the whole point of the maintainer's 2026-08-08 ruling — the two hand-written
   * fallbacks it replaces disagreed (the SQL driver substituted `{0000}` while
   * the engine's in-memory fallback emitted a bare `1`), so one metadata
   * document minted differently-shaped numbers depending on the driver behind it.
   *
   * Declared here as a JSON-Schema `default` annotation rather than a Zod
   * `.default()`: this key is flat on `FieldSchema`, shared by all ~49 field
   * types, so a parse-time default would materialize `autonumberFormat:
   * '{0000}'` on every `text`, `number` and `lookup` field ever parsed — a
   * format on a field that has no counter. The annotation states the default
   * to schema consumers and AI metadata authors without touching parse output.
   */
  autonumberFormat: z.string().optional().meta({
    description: 'Auto-number format: literal text + {0000} counter, {YYYY}/{MM}/{DD}/{YYYYMMDD} date tokens (business tz), and {field_name} interpolation. Counter resets per rendered prefix (e.g. AD{YYYYMMDD}{0000} resets daily). Omitted on an `autonumber` field ⇒ the contract default `{0000}` (#6555).',
    default: DEFAULT_AUTONUMBER_FORMAT,
  }),
  // `index` (field-level bool) removed in the 16.x line (#2377, ADR-0049): the
  // driver builds indexes from the object's `indexes[]` array; a field-level
  // `index: true` created no index. Declare the index in object `indexes[]`.
  externalId: z.boolean().default(false).describe('Is external ID for upsert operations'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `field` is a registered metadata type, so `MetadataPlugin`'s loader stamps
  // `_packageId` / `_provenance` on it. Undeclared, they were dropped on every
  // parse. This was the ONE type the original envelope probe actually checked
  // (see `metadata-type-schemas.test.ts` for how the other 24 took an early
  // return) — so it has been a known gap longer than any of its siblings.
  ...MetadataProtectionFields,
}).superRefine((field, ctx) => {
  // ADR-0113: `storage.notNull` × `requiredWhen` is a contradiction, rejected
  // at the authoring seam — when the condition is FALSE the write contract
  // permits null, but the column would refuse it, so the author has declared
  // two gates that cannot both be honest. An unconditional constraint needs
  // the unconditional contract.
  if (field.storage?.notNull === true && field.requiredWhen !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['storage', 'notNull'],
      message:
        '`storage.notNull` cannot be combined with `requiredWhen` (ADR-0113): when the ' +
        'condition is false the write contract permits null, but the column would refuse ' +
        'it. Use `required: true` + `storage.notNull` for an unconditional constraint, or ' +
        '`requiredWhen` alone for a conditional write contract (the column stays nullable).',
    });
  }

  // #7918 (maintainer ruling 2026-08-12, Option A): the FIELD-level
  // `precision` key doubles as the currency display width — objectui's
  // CurrencyField reads it, and objectui#4361 pinned authored-precision-wins
  // there — so an authored value contradicting the statically-known currency's
  // ISO 4217 / CLDR fraction digits is rejected at this seam too. The currency
  // is statically known only under `currencyConfig.currencyMode: 'fixed'`
  // (`dynamic` is out of reach BY DESIGN; a field with no `currencyConfig` has
  // only the runtime tenant default, which is not static). This key has NO
  // schema default, so `undefined` here IS "not authored" — the
  // authored-vs-defaulted trap lives entirely on the `currencyConfig` twin of
  // this check, which runs pre-default inside `CurrencyConfigSchema` itself.
  // Unknown currency codes fail OPEN (see currency-fraction-digits.ts).
  if (
    field.type === 'currency' &&
    field.precision !== undefined &&
    field.currencyConfig?.currencyMode === 'fixed'
  ) {
    const contradiction = currencyPrecisionContradiction(
      field.currencyConfig.defaultCurrency,
      field.precision,
    );
    if (contradiction !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['precision'], message: contradiction });
    }
  }

  // #7127: an authored `defaultValue` must be one of the key's three legal
  // shapes — CEL envelope / runtime token / literal — and legal for THIS
  // field. The shapes are told apart FIRST (`default-value-shape.ts`, the
  // engine's own discrimination order): running the value contract over the
  // whole key would judge a token's spelling as data, which is right only by
  // accident. Then each branch gets its own verdict:
  //   envelope → structural acceptance ONLY (a CEL result type is unknowable
  //              at parse time; a wrong one is an ADR-0032 runtime concern);
  //   token    → the per-token × per-type table (`defaultValueTokenIssue`);
  //   literal  → the field's own stored value contract, through the SAME
  //              shared core the #6970 action-param gate runs.
  //
  // Presence is the ENGINE's rule (`applyFieldDefaults`): `null`/`undefined`
  // mean "no default", while `''` is a real default — deliberately NOT the
  // action-param rule, whose dispatcher treats blank as absent.
  const dv = field.defaultValue;
  if (dv == null) return;
  const dvText = JSON.stringify(dv) ?? String(dv);
  const shape = discriminateDefaultValueShape(dv);
  if (shape === 'expression') return;
  if (shape === 'token') {
    const message = defaultValueTokenIssue(
      { type: field.type, multiple: field.multiple, options: field.options, name: field.name, reference: field.reference },
      dv,
    );
    if (message !== null) {
      ctx.addIssue({ code: 'custom', path: ['defaultValue'], message });
    }
    return;
  }
  const verdict = checkLiteralDefaultValue(
    { type: field.type, multiple: field.multiple, options: field.options },
    dv,
  );
  if (!verdict.ok) {
    const suggestion = suggestDefaultValueToken(dv);
    const suggestionText = suggestion === undefined
      ? ''
      : ` Did you mean the runtime token \`${suggestion}\`? Near-miss spellings are never accepted as tokens `
        + '(a genuinely-intended literal must stay storable) — write the exact token, or a valid literal.';
    ctx.addIssue({
      code: 'custom',
      path: ['defaultValue'],
      message:
        `Field "${field.name ?? '<unnamed>'}" (${field.type}): the default ${dvText} cannot satisfy this `
        + `field's own stored value contract — ${verdict.detail ?? 'invalid value'}. The engine stores a `
        + 'literal default VERBATIM at insert (applyFieldDefaults), so this would seed data the field type '
        + "cannot hold, surfacing far from the cause. Write the default in the field's stored value shape, "
        + 'or use one of the other legal shapes: a runtime token (`NOW()` on `datetime`/`date`/`time`; '
        + "`current_user` on `user` or `lookup` with `reference: 'sys_user'`) or a CEL Expression envelope "
        + `({ dialect: 'cel', source: '…' }).${suggestionText}`,
    });
  }
}));

/**
 * Author-facing shape of a field — what `FieldSchema.parse(...)` accepts. Since
 * protocol 17 (#3855) it no longer carries the removed `conditionalRequired`
 * alias — the key is tombstoned, so writing it is a `tsc` error at the authoring
 * site as well as a parse error. Distinct from the `FieldInput` factory-helper
 * type further down, which is `Omit<Partial<Field>, 'type'>`, and from
 * {@link FieldParsed}, which is what a parse returns.
 *
 * Spelled `FieldParseInput` until protocol 17; ADR-0122 phase 2 moved the author
 * state onto the bare name and retired that synonym.
 */
export type Field = z.input<typeof FieldSchema>;
/** Post-parse shape of {@link Field} — defaults applied, transforms run (ADR-0122). */
export type FieldParsed = z.infer<typeof FieldSchema>;
export type SelectOption = z.input<typeof SelectOptionSchema>;
/** Post-parse shape of {@link SelectOption} — defaults applied, transforms run (ADR-0122). */
export type SelectOptionParsed = z.infer<typeof SelectOptionSchema>;
/** One authored `inlineColumns` entry (#9227) — the strict, name-keyed inline grid column. */
export type InlineGridColumn = z.input<typeof InlineGridColumnSchema>;
/** Post-parse shape of {@link InlineGridColumn} — bare-string CEL predicates normalized to Expression envelopes (ADR-0122). */
export type InlineGridColumnParsed = z.infer<typeof InlineGridColumnSchema>;
export type LocationCoordinates = z.input<typeof LocationCoordinatesSchema>;
export type Address = z.input<typeof AddressSchema>;
export type CurrencyConfig = z.input<typeof CurrencyConfigSchema>;
/** Post-parse shape of {@link CurrencyConfig} — defaults applied, transforms run (ADR-0122). */
export type CurrencyConfigParsed = z.infer<typeof CurrencyConfigSchema>;
export type CurrencyValue = z.input<typeof CurrencyValueSchema>;

/**
 * Field Factory Helper
 */
export type FieldInput = Omit<Partial<Field>, 'type'>;

export const Field = {
  text: (config: FieldInput = {}) => ({ type: 'text', ...config } as const),
  textarea: (config: FieldInput = {}) => ({ type: 'textarea', ...config } as const),
  number: (config: FieldInput = {}) => ({ type: 'number', ...config } as const),
  boolean: (config: FieldInput = {}) => ({ type: 'boolean', ...config } as const),
  date: (config: FieldInput = {}) => ({ type: 'date', ...config } as const),
  datetime: (config: FieldInput = {}) => ({ type: 'datetime', ...config } as const),
  currency: (config: FieldInput = {}) => ({ type: 'currency', ...config } as const),
  percent: (config: FieldInput = {}) => ({ type: 'percent', ...config } as const),
  url: (config: FieldInput = {}) => ({ type: 'url', ...config } as const),
  email: (config: FieldInput = {}) => ({ type: 'email', ...config } as const),
  phone: (config: FieldInput = {}) => ({ type: 'phone', ...config } as const),
  image: (config: FieldInput = {}) => ({ type: 'image', ...config } as const),
  file: (config: FieldInput = {}) => ({ type: 'file', ...config } as const),
  avatar: (config: FieldInput = {}) => ({ type: 'avatar', ...config } as const),
  formula: (config: FieldInput = {}) => ({ type: 'formula', ...config } as const),
  summary: (config: FieldInput = {}) => ({ type: 'summary', ...config } as const),
  /**
   * Auto-number — a record number the RUNTIME issues from its sequence.
   *
   * The builder injects `readonly: true` (#5628). `readonly` is a TWO-part
   * contract (see `FieldSchema.readonly`): "never editable in forms" AND
   * server-enforced on both write paths. #5503 closed the server half for
   * `autonumber` by type ({@link RUNTIME_OWNED_FIELD_TYPES}), but the FORM half
   * is keyed on the flag — so without it a renderer drew an editable "record
   * number" box whose value the server was already guaranteed to discard: the
   * user types a number, the create succeeds, and the record comes back
   * carrying a different one. Declaring the flag the builder's output already
   * behaves like is the shortest "declared = enforced" path.
   *
   * The injection is UNCONDITIONAL — it is applied after `config`, so it cannot
   * be spread away — and `readonly: false` is a compile error at the authoring
   * site rather than a silent coercion: an autonumber field is runtime-owned by
   * construction, so "editable record number" is not a state the author can
   * ask for. Restating `readonly: true` is allowed (it is merely redundant).
   * A hand-written `{ type: 'autonumber' }` literal is unaffected — it is
   * covered by the by-TYPE server enforcement, which never depended on the flag.
   */
  autonumber: (config: FieldInput & { readonly?: true } = {}) =>
    ({ type: 'autonumber', ...config, readonly: true } as const),
  markdown: (config: FieldInput = {}) => ({ type: 'markdown', ...config } as const),
  html: (config: FieldInput = {}) => ({ type: 'html', ...config } as const),
  password: (config: FieldInput = {}) => ({ type: 'password', ...config } as const),
  /**
   * Secret field — reversible encrypted-at-rest value (DB password, API key,
   * token). Encrypted on write to `sys_secret` via the registered
   * ICryptoProvider; only an opaque ref is persisted on the row; masked on
   * read. Distinct from `password` (one-way hash, owned by the auth subsystem).
   */
  secret: (config: FieldInput = {}) => ({ type: 'secret', ...config } as const),
  
  /**
   * Select field helper with backward-compatible API
   * 
   * Automatically converts option values to lowercase to enforce naming conventions.
   * 
   * @example Old API (array first) - auto-converts to lowercase
   * Field.select(['High', 'Low'], { label: 'Priority' })
   * // Results in: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }]
   * 
   * @example New API (config object) - enforces lowercase
   * Field.select({ options: [{label: 'High', value: 'high'}], label: 'Priority' })
   * 
   * @example Multi-word values - converts to snake_case
   * Field.select(['In Progress', 'Closed Won'], { label: 'Status' })
   * // Results in: [{ label: 'In Progress', value: 'in_progress' }, { label: 'Closed Won', value: 'closed_won' }]
   */
  select: (optionsOrConfig: SelectOption[] | string[] | FieldInput & { options: SelectOption[] | string[] }, config?: FieldInput) => {
    // Helper function to convert string to lowercase snake_case
    const toSnakeCase = (str: string): string => {
      return str
        .toLowerCase()
        .replace(/\s+/g, '_')  // Replace spaces with underscores
        .replace(/[^a-z0-9_]/g, ''); // Remove invalid characters (keeping underscores only)
    };

    // Support both old and new signatures:
    // Old: Field.select(['a', 'b'], { label: 'X' })
    // New: Field.select({ options: [{label: 'A', value: 'a'}], label: 'X' })
    let options: SelectOption[];
    let finalConfig: FieldInput;
    
    if (Array.isArray(optionsOrConfig)) {
      // Old signature: array as first param
      options = optionsOrConfig.map(o => 
        typeof o === 'string' 
          ? { label: o, value: toSnakeCase(o) }  // Auto-convert string to snake_case
          : { ...o, value: o.value.toLowerCase() }  // Ensure value is lowercase
      );
      finalConfig = config || {};
    } else {
      // New signature: config object with options
      options = (optionsOrConfig.options || []).map(o => 
        typeof o === 'string' 
          ? { label: o, value: toSnakeCase(o) }  // Auto-convert string to snake_case
          : { ...o, value: o.value.toLowerCase() }  // Ensure value is lowercase
      );
      // Remove options from config to avoid confusion
      const { options: _, ...restConfig } = optionsOrConfig;
      finalConfig = restConfig;
    }
    
    return { type: 'select', options, ...finalConfig } as const;
  },

  
  /**
   * Lookup — a reference to another object's record.
   *
   * Generic over `config` (with a `const` type parameter) so literal values
   * SURVIVE into the returned field definition. A plain `config: FieldInput`
   * widens `multiple: true` to `boolean`, which erases exactly the fact
   * `defineSeed` needs to know: a `multiple: true` lookup is seeded from an
   * ARRAY of natural keys, a single-value one from a lone string
   * (framework#3911). Widening is purely a type-level change — the returned
   * object is identical at runtime.
   */
  lookup: <const C extends FieldInput>(
    reference: string,
    config: C = {} as C,
  ): FieldInput & C & { readonly type: 'lookup'; readonly reference: string } => ({
    type: 'lookup',
    reference,
    ...config,
  } as FieldInput & C & { readonly type: 'lookup'; readonly reference: string }),
  
  masterDetail: (reference: string, config: FieldInput = {}) => ({
    type: 'master_detail',
    reference,
    ...config
  } as const),

  /**
   * User field — a person picker. Semantic specialization of `lookup` with the
   * target fixed to the `sys_user` system object: stored identically (FK string
   * column → sys_user.id; `multiple: true` ⇒ JSON array) and resolved via the same
   * $expand machinery. The distinct `user` type drives the Studio/AI field palette,
   * the user-search picker, and `current_user` defaults — without re-implementing
   * lookup storage.
   *
   * @example Single assignee
   * Field.user({ label: 'Assignee' })
   * @example Collaborators / watchers (multi)
   * Field.user({ label: 'Watchers', multiple: true })
   * @example Auto-fill the acting user on create
   * Field.user({ label: 'Reporter', defaultValue: 'current_user' })
   */
  user: (config: FieldInput = {}) => ({
    type: 'user',
    reference: 'sys_user',
    ...config,
  } as const),

  // Enhanced Field Type Helpers
  location: (config: FieldInput = {}) => ({ 
    type: 'location', 
    ...config 
  } as const),
  
  address: (config: FieldInput = {}) => ({ 
    type: 'address', 
    ...config 
  } as const),
  
  richtext: (config: FieldInput = {}) => ({ 
    type: 'richtext', 
    ...config 
  } as const),
  
  code: (language?: string, config: FieldInput = {}) => ({ 
    type: 'code', 
    language,
    ...config 
  } as const),
  
  color: (config: FieldInput = {}) => ({ 
    type: 'color', 
    ...config 
  } as const),
  
  rating: (max: number = 5, config: FieldInput = {}) => ({
    type: 'rating',
    max,
    ...config
  } as const),
  
  signature: (config: FieldInput = {}) => ({ 
    type: 'signature', 
    ...config 
  } as const),
  
  slider: (config: FieldInput = {}) => ({ 
    type: 'slider', 
    ...config 
  } as const),
  
  qrcode: (config: FieldInput = {}) => ({ 
    type: 'qrcode', 
    ...config 
  } as const),
  
  json: (config: FieldInput = {}) => ({ 
    type: 'json', 
    ...config 
  } as const),
  
  vector: (dimensions: number, config: FieldInput = {}) => ({
    type: 'vector',
    dimensions,
    ...config
  } as const),
};
