// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IFieldFileService, IMetadataService, ISeedLoaderService } from '@objectstack/spec/contracts';
import type {
  SeedLoaderRequest,
  SeedLoaderRequestParsed,
  SeedLoaderResultParsed,
  SeedLoaderConfig,
  SeedLoaderConfigParsed,
  ObjectDependencyGraphParsed,
  ObjectDependencyNodeParsed,
  ReferenceResolutionParsed,
  ReferenceResolutionError,
  SeedLoadResultParsed,
  Seed,
  EngineQueryOptions,
} from '@objectstack/spec/data';
import {
  SeedLoaderConfigSchema,
  SeedLoaderRequestSchema,
  SeedMode,
  RETIRED_SEED_MODE_VALUES,
  isMultiValueField,
  isTenancyDisabled,
  referenceTargetOf,
  resolveInjectedSystemColumns,
  // [#33791] The injected `owner_id`'s own definition, the one the registry adds.
  OWNER_FIELD_DEF,
  // [#24624] The ONE declaration of which field types the engine masks on read
  // (and which `managedBy` buckets exempt them), and the mask itself (ADR-0100).
  isMaskedOnReadFieldType,
  SECRET_MASK,
  // [#25779] A replay reads a matched row's file fields in their STORED form
  // (the bare `sys_file` id), the value a seed file is compared and kept by.
  RAW_FILE_VALUES_CONTEXT_KEY,
} from '@objectstack/spec/data';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';
import { SystemFieldName, SystemObjectName } from '@objectstack/spec/system';
import { resolveSeedRecord } from '@objectstack/formula';
import {
  bulkWrite, withTransientRetry, defaultIsTransientError, type BulkWriteRowResult, runWithAdvisoryAggregation, type AdvisoryGroup,
  temporalComparandKind, temporalStorageForm, type TemporalComparandKind, isMissing,
  blankAsNullColumns, blankStorageForm, type BlankAsNullReach, resolveTenantFieldName, DEFAULT_TENANT_FIELD,
} from '@objectstack/core';
// [#8442] The repo's ONE recogniser for "this throw is a record-validation
// failure" — duck-typed on `code`/`name`, the same predicate `mapDataError` and
// both dispatcher error exits use. Imported rather than re-spelled so the seed
// channel and the HTTP boundaries cannot drift about what counts as one.
import { validationFailureDetails } from '@objectstack/types';
// [#8896] The platform's ONE answer to "did this READ fail because the table
// has not been provisioned yet?" — the same predicate `DatabaseLoader` (#5108),
// `SysMetadataRepository` (#4867) and `cascadeDeleteRelations` (#8895) ask, so
// a driver quirk is taught to the platform once instead of per seam.
import { isMissingTableError } from '@objectstack/metadata/errors';
import { createHash } from 'node:crypto';
// [#25779] `seedFile(path)` values: stored, kept across replays, and owned by
// the row that holds them; an id-shaped file value that names no file refused.
import { SeedDatasetFiles, type SeedFileClaims } from './seed-files.js';
import type { SeedLandingResult } from './seed-applied-landed.js';

interface Logger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, error?: Error, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
}

/** Default field used for externalId matching on target objects */
const DEFAULT_EXTERNAL_ID_FIELD = 'name';

/**
 * [#17177] The scope every pass-2 "this column is NULL" line must carry.
 *
 * Those lines are emitted while the load is still running — inside
 * `AppPlugin.start()`, which the kernel completes for EVERY plugin before it
 * fires `kernel:ready`. Plenty of boot happens after that point, and some of
 * it writes the very columns these lines report on: the first-admin handoff
 * (`claimSeedOwnership`, `@objectstack/plugin-security`) re-owns every
 * `owner_id IS NULL` row of every user-authored object the moment the first
 * human is promoted to platform admin. That handoff is not an accident — this
 * file's own seed-identity comment names it as the designed completion of a
 * NULL owner column — so a line reading "`x.owner_id` stays NULL" is TRUE when
 * it is printed and FALSE by the time the app is serving, with nothing in
 * either reading to tell an operator that the other exists.
 *
 * ⛔ The loader cannot repair that by re-reading the table before it returns:
 * the handoff runs strictly after the loader is done, and an inline seed that
 * overruns `OS_INLINE_SEED_BUDGET_MS` finishes on the far side of
 * `kernel:ready` entirely — so the two writes are not even in a fixed order to
 * read after. What the loader CAN do is say which moment it is describing.
 * That is this sentence, and it is why the two branches below now say "is NULL
 * at the end of pass 2" instead of "stays NULL".
 *
 * Deliberately NOT carried by the two DROPPED branches: those report a row
 * that never landed, and no later boot step can write a column of a row that
 * does not exist, so their claim survives to the end of boot unchanged.
 */
const PASS_2_SCOPE_NOTE =
  'SCOPE: this describes the column as of the END OF PASS 2, not as of the end of boot — a later boot ' +
  'step can still write it (the first-admin handoff claims every NULL-owned `owner_id` row once that ' +
  'account is promoted), so finding a non-NULL value in the table later is not evidence that this ' +
  'reference resolved.';

/**
 * [#8442] What a seed `errors[].message` says when the caught sentence may NOT
 * be quoted. Names the operation and points at the log; quotes nothing.
 */
const WITHHELD_WRITE_REASON =
  'the data engine rejected the write; the reason is in the server log';

/**
 * [#8442] Whether a caught error DECLARED itself a client-facing refusal, and
 * may therefore have its sentence quoted back into `errors[].message`.
 *
 * ## Which question this sink asks
 *
 * `errors[].message` is free text — no catalog bounds it — so this is #8333's
 * question ("did the producer AUTHOR this sentence for a caller?"), NOT #8441's
 * membership question, which belongs to `code` because that field writes a
 * closed union (ADR-0112 D4). Same question, one file over.
 *
 * ## …and why the ANSWER needs a second declaration shape
 *
 * `protocol.ts`'s {@link declaresClientRefusal} answers it with a numeric 4xx
 * `status` alone, because every refusal reaching ITS collectors declares one
 * (the repository's `ITEM_LOCKED` 403, `VERSION_NOT_FOUND` 404, …). This sink
 * receives a population those collectors never see: the **data engine's
 * validation layer**. Measured on `main`, an `@objectstack/objectql`
 * `ValidationError` carries own properties `[stack, message, code, name,
 * fields]` — `code = 'VALIDATION_FAILED'` and deliberately **no `status`**,
 * because (per `@objectstack/types`' `validation-failure.ts`) "deciding it
 * means 400 is the job of whichever boundary serves it". For the seed channel,
 * THIS is that boundary.
 *
 * So the 4xx test alone would withhold exactly the sentence a seed author
 * needs. That is not a hypothetical loss of nuance: on this producer the
 * structured keys do NOT carry the offending field. `buildWriteError` reports
 * `field: '(write)'` and `targetField`/`attemptedValue` = the record's
 * EXTERNAL key ("which row"), so "which key was rejected and why" — `plan`,
 * `max_length` — survives only inside the validation sentence. Blanking it
 * would trade the authoring surface for the disclosure, the trade #8441
 * explicitly refused and this card's own warning names.
 *
 * `VALIDATION_FAILED_STATUS = 400` is the repo already stating that a
 * validation failure IS a 4xx client refusal that merely omits the property, so
 * admitting it here widens no boundary — it reads the declaration the error
 * actually makes. A driver fault (`SQLITE_ERROR`, `errno`) matches neither
 * shape and is withheld.
 */
function declaresSeedClientRefusal(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return true;
  // A record-validation failure declares itself by SHAPE rather than status.
  return validationFailureDetails(err) !== undefined;
}

/**
 * [#8442] The client-facing tail of a seed failure message — the caught
 * sentence when {@link declaresSeedClientRefusal} admits it, otherwise
 * `undefined` so the caller gets {@link WITHHELD_WRITE_REASON} instead.
 */
function quotableSeedFailureDetail(err: unknown): string | undefined {
  if (!declaresSeedClientRefusal(err)) return undefined;
  const declared = (err as { message?: unknown } | null | undefined)?.message;
  return typeof declared === 'string' && declared.length > 0 ? declared : undefined;
}

/**
 * How far to follow an `error.cause` chain. Producers wrap, but not deeply —
 * the same bound `@objectstack/types`' unique-violation predicate walks, chosen
 * for the same reason rather than copied: a chain longer than this is a bug in
 * the producer, not a diagnostic worth mining.
 */
const MAX_CAUSE_DEPTH = 4;

/**
 * The caught sentence, whole — for the LOG, which never withholds.
 *
 * ## [#14095] It reaches through `cause`, and that is the whole point
 *
 * A producer that ENVELOPES a lower-level failure keeps its own diagnosis on
 * `cause` and puts a platform sentence on `message` — which is exactly what
 * `engine.insert` now does for a driver's unique violation (`DUPLICATE_RECORD`,
 * `status: 409`, the driver error whole on `cause`). Read off `message` alone,
 * this function would hand the operator the platform sentence and the driver's
 * own words — `UNIQUE constraint failed: dt_acct.email`, MySQL's index name,
 * Postgres' DETAIL line — would reach NEITHER the response nor the log.
 *
 * That is the failure this file's own header calls the one that makes a
 * disclosure fix "a net loss for whoever has to fix the database": withholding
 * text becomes indistinguishable from DELETING the diagnostic. The envelope
 * moved the diagnostic one hop rather than deleting it, so the log follows the
 * hop. The insert door met the identical problem at its own logging seam and
 * took the identical remedy (it logs the envelope's `cause`); this is that
 * remedy at the seam a seed write reaches instead.
 *
 * The DEEPEST non-empty sentence wins, because that is the one nothing else
 * restates: every wrapper above it has already put its own summary on the
 * payload. Structural, never a type check — this package must not import
 * `@objectstack/objectql` (that is the dependency direction, backwards), and
 * an envelope from any producer deserves the same treatment as one from that
 * one.
 */
function seedFailureCause(err: unknown): string {
  const own = (err as { message?: unknown } | null | undefined)?.message;
  let deepest = typeof own === 'string' && own.length > 0 ? own : undefined;

  let node: unknown = (err as { cause?: unknown } | null | undefined)?.cause;
  for (let depth = 0; node !== null && node !== undefined && depth < MAX_CAUSE_DEPTH; depth += 1) {
    const message = (node as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) deepest = message;
    node = (node as { cause?: unknown }).cause;
  }

  return deepest ?? String(err);
}

/**
 * [#8442] How a log line labels the cause it is about to print: marked when the
 * payload half withheld that sentence, plain when the caller received it too.
 *
 * The marker is the half of the operator story that is not about the text. An
 * operator reading `Cause: …` and an operator reading
 * `Cause (withheld from the seed response): …` are looking at the same
 * sentence and a DIFFERENT support situation — in the second the reporter never
 * saw it, so "what did the response say?" has a different answer than the log
 * suggests. Both passes share this one vocabulary so the two halves of the file
 * cannot drift into answering that question differently.
 *
 * ## [#14095] The question is asked about the SENTENCE, not about the error
 *
 * It used to ask "was this ERROR's text withheld?" — fine while the printed
 * sentence was always `err.message`. Now that {@link seedFailureCause} reaches
 * through `cause`, the two can differ: an enveloped driver fault has its
 * PLATFORM sentence quoted to the caller and its DRIVER sentence printed here,
 * and the old question answers `Cause` — telling an operator the reporter saw
 * a sentence the reporter never saw. So the label compares the sentence about
 * to be printed against the one the payload actually quoted; `Cause` means
 * "these are the same words", which is the only reading that stays true for
 * all three populations (withheld outright, enveloped, plainly declared).
 */
function seedCauseLabel(err: unknown, printed: string): string {
  return quotableSeedFailureDetail(err) === printed
    ? 'Cause'
    : 'Cause (withheld from the seed response)';
}

/**
 * [#8442] The operator half. The log line always carries the caught sentence,
 * even when the payload may not quote it — without this, withholding the text
 * would be indistinguishable from DELETING the diagnostic, which is what makes
 * a disclosure fix a net loss for whoever has to fix the database.
 */
function seedFailureLogLine(payloadMessage: string, err: unknown): string {
  const cause = seedFailureCause(err);
  return payloadMessage.includes(cause)
    ? `[SeedLoader] ${payloadMessage}`
    : `[SeedLoader] ${payloadMessage} ${seedCauseLabel(err, cause)}: ${cause}`;
}

/** The environments a seed dataset can be scoped to — mirrors `SeedSchema.env`. */
type SeedEnv = 'prod' | 'dev' | 'test';

/** Every environment a dataset can declare — i.e. `SeedSchema.env`'s default. */
const ALL_SEED_ENVS: readonly SeedEnv[] = ['prod', 'dev', 'test'];

/**
 * `NODE_ENV` spellings accepted for each seed environment.
 *
 * `NODE_ENV` is this repo's ONE established environment source — `os start`
 * defaults it to `production`, `os dev` / `serve --dev` set `development`,
 * vitest sets `test`, and every other environment-sensitive behaviour here
 * (auto-DDL, the sqlite step-down, the hot-reload seeder) already branches on
 * it — the api-registry production guard this list used to cite went with the
 * ApiRegistry retirement (#4939). Seeds reuse it rather than
 * minting an `OS_SEED_ENV`, which would only trade one declared-but-unset key
 * for another.
 *
 * The seed-enum spellings (`prod`/`dev`) are accepted alongside Node's
 * canonical ones so an operator who read the `Seed.env` docs and exported
 * `NODE_ENV=prod` gets what they meant instead of an indeterminate answer.
 * This is normalization of an OPERATOR-supplied variable at a third-party
 * boundary (Prime Directive #9 lists `NODE_ENV` as exactly that), not
 * consumer-side tolerance of our own metadata contract.
 */
const NODE_ENV_TO_SEED_ENV: Readonly<Record<string, SeedEnv>> = {
  production: 'prod',
  prod: 'prod',
  development: 'dev',
  dev: 'dev',
  test: 'test',
};

/**
 * Resolve the environment `Seed.env` is gated on from `NODE_ENV`.
 *
 * Returns `undefined` when `NODE_ENV` is unset or names no seed environment
 * (`staging`, `qa`, …) — i.e. the host never said where it is running. What
 * that means for scoped datasets is decided in {@link SeedLoaderService.load}.
 */
function resolveSeedEnvFromNodeEnv(): SeedEnv | undefined {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.NODE_ENV;
  if (typeof raw !== 'string') return undefined;
  return NODE_ENV_TO_SEED_ENV[raw.trim().toLowerCase()];
}

/**
 * Does this dataset apply to `env`?
 *
 * A dataset carrying no `env` at all is unrestricted — which is precisely what
 * `SeedSchema.env`'s default (`['prod','dev','test']`) parses to. Every
 * production call site parses its request through `SeedLoaderRequestSchema`
 * first, so this only covers an in-process caller handing the loader an
 * unparsed literal: it gets the schema's own answer rather than a second
 * dialect of it.
 */
function datasetAllowsEnv(dataset: Seed, env: SeedEnv): boolean {
  const declared = dataset.env as string[] | undefined;
  if (!Array.isArray(declared)) return true;
  return declared.includes(env);
}

/**
 * True when a dataset NARROWED its scope below the schema default — the only
 * datasets for which a resolvable environment changes anything, and therefore
 * the only ones worth warning about when it cannot be resolved.
 */
function isEnvScopedDataset(dataset: Seed): boolean {
  const declared = dataset.env as string[] | undefined;
  if (!Array.isArray(declared)) return false;
  return ALL_SEED_ENVS.some(e => !declared.includes(e));
}

/**
 * Fold a BCP-47 tag for comparison.
 *
 * Tags are case-INSENSITIVE by definition (RFC 5646 §2.1.1: the recommended
 * casing is a convention, not part of the identity), so `zh-cn` and `zh-CN` are
 * the same locale and must compare equal. That is normalization of a
 * case-insensitive identifier, not consumer-side tolerance of a second dialect
 * of our own contract — nothing else about the tag is rewritten, so `zh` still
 * does NOT match `zh-CN`.
 */
function normalizeLocaleTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Does this dataset apply to `locale`?
 *
 * A dataset carrying no `locale` at all is unrestricted — and unlike `env`,
 * that is the SCHEMA's own answer rather than a default array: locales are
 * open-ended BCP-47 tags with no enumerable universe to default to, so
 * `SeedSchema.locale` is optional and absence is what carries "every locale".
 */
function datasetAllowsLocale(dataset: Seed, locale: string): boolean {
  const declared = dataset.locale as string[] | undefined;
  if (!Array.isArray(declared)) return true;
  const wanted = normalizeLocaleTag(locale);
  return declared.some(tag => normalizeLocaleTag(tag) === wanted);
}

/**
 * True when a dataset declared a locale scope at all — i.e. the only datasets
 * for which a resolvable locale changes anything, and therefore the only ones
 * worth warning about when none was supplied. The mirror of
 * {@link isEnvScopedDataset}, simpler only because absence IS the unrestricted
 * spelling here.
 */
function isLocaleScopedDataset(dataset: Seed): boolean {
  return Array.isArray(dataset.locale as string[] | undefined);
}

/** Render a dataset's declared locale scope for a log line. */
function localeScopeLabel(dataset: Seed): string {
  return `${dataset.object} (locale: ${(dataset.locale as string[]).join(', ')}${isFallbackDataset(dataset) ? '; fallback' : ''})`;
}

/**
 * [Seed.fallback] True when the dataset is marked its object's fallback set.
 * The schema refuses the marker on a dataset with no `locale`, so a marked
 * dataset is always locale-scoped.
 */
function isFallbackDataset(dataset: Seed): boolean {
  return (dataset as { fallback?: unknown }).fallback === true;
}

/**
 * [Seed.fallback] The objects for which a locale-scoped dataset of `datasets`
 * lists `locale`. A dataset with no `locale` is locale-neutral and is not a
 * match: it loads beside whichever set is chosen, and does not keep the
 * object's fallback set from filling in.
 */
function objectsWithLocaleMatch(datasets: readonly Seed[], locale: string): Set<string> {
  const matched = new Set<string>();
  for (const dataset of datasets) {
    if (isLocaleScopedDataset(dataset) && datasetAllowsLocale(dataset, locale)) matched.add(dataset.object);
  }
  return matched;
}

/**
 * [#21665] The id a seed row authored as `authoredId` holds in `organizationId`
 * when a per-organization replay cannot give it the authored id itself.
 *
 * A primary key is global, so an authored `id` names exactly ONE row in the
 * whole database. A per-organization replay writes every seed row once per
 * organization, so from the second organization on, the authored id is
 * already taken. The replay then gives the row this id instead.
 *
 * It is DERIVED, not minted, and that is load-bearing. The replay keys each
 * row by its `externalId` within the organization, and a dataset whose
 * `externalId` is `id` (the showcase's `sys_business_unit` tree) has no
 * other column to find its own row by. A random id would make every replay
 * into the same organization insert the set again; a derived one is found
 * again by the same lookup, so the replay stays idempotent. Deriving from the
 * organization id itself rather than from a hash of it means two
 * organizations can never be given the same id.
 */
function perOrganizationSeedRowId(authoredId: string, organizationId: string): string {
  return `${authoredId}__${organizationId}`;
}

/**
 * [#31021] The platform object that records which seed rows landed in an
 * organization (`@objectstack/platform-objects`' `SysSeedLandedKey`). Spelled
 * here rather than imported: this package does not depend on that one.
 */
const SEED_LANDED_KEY_OBJECT = 'sys_seed_landed_key';

/**
 * [#34613] The `SeedMode` values retired by ruling 6942780880 that a stored
 * seed can still carry. Only membership is read here: the prescription a
 * refused dataset reports is `SeedMode`'s own refusal.
 */
const RETIRED_SEED_MODES: ReadonlySet<string> = new Set(RETIRED_SEED_MODE_VALUES);

/**
 * [#31021] The key a landed seed row is recorded under in
 * {@link SEED_LANDED_KEY_OBJECT}: the dataset's `externalId` field names, each
 * with the value the row is matched by, JSON-encoded (`[["name","Acme"]]`).
 *
 * The parts are exactly {@link SeedLoaderService.externalIdKey}'s, so the two
 * agree on which records have a key at all: `''` when any component is
 * missing. The FIELD NAMES travel with the values so two datasets keyed on
 * different fields of one object never share a key, and JSON rather than the
 * in-memory `\u0000` joiner because the key is STORED, and a NUL byte is a
 * value Postgres refuses in a text column.
 */
function seedLandedKey(record: Record<string, unknown>, externalId: string | string[]): string {
  const fields = Array.isArray(externalId) ? externalId : [externalId];
  const pairs: Array<[string, string]> = [];
  for (const field of fields) {
    const value = record[field];
    if (isBlankSeedKeyValue(value)) return '';
    pairs.push([field, String(value)]);
  }
  return JSON.stringify(pairs);
}

/**
 * [#34857] Whether a seed record's value for one `externalId` field leaves
 * that key field blank: no value, `null` or `''`. The one blank rule
 * {@link seedLandedKey} and {@link SeedLoaderService.externalIdKey} key `''`
 * by, and the keyed modes refuse a record by. A whitespace-only value is a
 * value here (no trim).
 */
function isBlankSeedKeyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * [#34857, #35336] The refusal of a keyed seed record that leaves a key field
 * blank — reported in the load result, the record not written. It names the
 * object, the record, the blank field(s) and the fix; the fix covers both
 * shapes it arises from: one record missing a value its siblings carry, and a
 * dataset whose `externalId` names a field no record carries.
 *
 * A key of `name` alone says it is also the key a dataset gets when it names
 * none: the parse defaults `externalId` to `name` before any load sees it, so
 * whether the author wrote it cannot be told here, and an author who never
 * wrote one is the commonest reader of this refusal.
 */
function blankSeedKeyRefusal(
  objectName: string,
  recordIndex: number,
  externalId: string | string[],
  blankFields: readonly string[],
  mode: string | undefined,
): ReferenceResolutionError {
  const fields = Array.isArray(externalId) ? externalId : [externalId];
  const defaultKey = fields.length === 1 && fields[0] === DEFAULT_EXTERNAL_ID_FIELD;
  const keyLabel = `externalId '${fields.join('+')}'${defaultKey ? ' (also the key a dataset gets when it names none)' : ''}`;
  const blank = blankFields.map((field) => `'${field}'`).join(', ');
  const consequence = mode === 'update'
    ? 'so an update load can never find the row it names'
    : 'so no load can ever match it to a row it wrote: written, it would be inserted again on every load';
  return {
    sourceObject: objectName,
    field: blankFields.join(', '),
    targetObject: objectName,
    targetField: '(externalId)',
    attemptedValue: null,
    recordIndex,
    message:
      `Seed record #${recordIndex} of '${objectName}' was NOT loaded: it is keyed on ${keyLabel} and leaves ` +
      `${blank} blank (no value, null or an empty string), ${consequence}. Give the record a value for ` +
      `${blank}, or key the dataset on fields every record carries: a field the object declares, a list of ` +
      `fields when no single field names a row, or 'id' when the records carry their own ids.`,
  };
}

/**
 * [#34800] The id a seed row lands with when a reference in its `externalId`
 * is still empty on the load that inserts it — a person not signed up yet,
 * deferred to pass 2 and held past it.
 *
 * Such a row is stored with that key column NULL, so the natural key the load
 * matches existing rows by can never find it again: while the reference stays
 * unresolvable the record keys empty, and once it resolves the record carries
 * an id the stored row does not. Each load then inserted another copy. The
 * row's identity has to come from what does not move between loads: the key
 * as AUTHORED (`authoredKey`, {@link seedLandedKey} over the record before
 * its references resolve — the natural key the author wrote, never the id it
 * resolves to), in the object and organization the row belongs to.
 *
 * DERIVED, never minted, for {@link perOrganizationSeedRowId}'s reason: a
 * replay finds its row again by recomputing the id. A digest rather than the
 * key itself, because the key is any text the author wrote and an id is not.
 * A row a person created never carries one, so a lookup by this id can only
 * find the seed's own row, and two records whose keys differ only in that
 * reference derive two ids.
 */
function seedDeferredKeyRowId(objectName: string, rowOrganization: string, authoredKey: string): string {
  const digest = createHash('sha256').update(JSON.stringify([objectName, rowOrganization, authoredKey])).digest('hex');
  return `seed_${digest.slice(0, 32)}`;
}

/**
 * [#31021] What a load does with the record of landed seed rows — see
 * {@link SeedLoaderServiceOptions.landedKeys}. Set once per load.
 */
interface LandedKeyLedger {
  /** The organization the load seeds, which the record is kept under. */
  readonly organizationId: string;
  /** `false` on a deliberate re-seed: record, but insert every missing row. */
  readonly honour: boolean;
  /** Per object, the keys recorded so far: read once, grown as this load records. */
  readonly recorded: Map<string, Set<string>>;
  /** Per object, the rows this load did not insert again because the record names them. */
  readonly withdrawnRows: Map<string, number>;
  /** References to such rows this load left as they are. */
  withdrawnReferences: number;
  /** Whether a failed record write has been reported yet (once per load). */
  writeFailureReported: boolean;
}

/**
 * SeedLoaderService — Runtime implementation of ISeedLoaderService
 *
 * Provides metadata-driven seed data loading with:
 * - Automatic lookup/master_detail reference resolution via externalId
 *   (in-memory for records seeded this load, DB probe by the target
 *   dataset's declared externalId otherwise)
 * - Declared pointer-pair resolution (#11339, ADR-0052 §5 ActivityPointer):
 *   a `text` field carrying `referenceVia` resolves per ROW against the
 *   object its sibling column names (`sys_activity.record_id` through
 *   `object_name`), by the same externalId rules — and an unresolvable or
 *   un-addressable pointer is refused loudly, never stored verbatim
 * - Topological dependency ordering (parents before children)
 * - Multi-pass loading for circular references — pass 2 writes a deferred
 *   reference back through the source row's INTERNAL id captured at insert
 *   time (commit 9a884c6e4), so it heals a row whose key evaluates empty the
 *   same as a keyed one
 * - Dry-run validation mode
 * - Upsert support honoring SeedSchema mode
 * - Idempotent replay: an upsert/update whose declared fields already match
 *   the existing row is skipped (no update_at churn, no re-validation) —
 *   seeds replay on every dev-server boot and package re-publish
 * - Per-organization row identity (#21665): on a per-organization replay
 *   (`config.organizationId`), a row whose authored `id` another organization
 *   already holds gets an id of its own for this organization, and every
 *   reference in the same replay that names the authored id follows it — see
 *   {@link assignReplayRowIds}
 * - Actionable error reporting
 *
 * Replay safety invariant: a reference that cannot be resolved is NEVER
 * written as NULL (or as its raw natural-key string) over an existing row —
 * resolution failures either leave the column untouched (deferred to pass 2)
 * or drop the record loudly. See the 15.1.x replay corruption incident:
 * every restart used to sever one lookup per replayed child record.
 */
/**
 * What the sole-organization read found ({@link SeedLoaderService} — see
 * `resolveSoleOrganizationId` for each answer's meaning).
 */
type SoleOrganizationReading =
  | { kind: 'sole'; organizationId: string }
  | { kind: 'unowned'; organizationCount: number }
  | { kind: 'no-organization-object' };

/**
 * [ADR-0131 D9] The column a seed row of this object carries its organization
 * in, or `null` when a row of it carries none.
 *
 * The object is tenant-scoped on its REGISTERED schema and has not opted out
 * of tenancy. The column is the one the tenant wall scopes it by: a declared
 * `tenancy.tenantField` the object really has, else `organization_id` —
 * authored, or injected by the system-column pass. Both halves are the shared
 * readings, never a third: `resolveTenantFieldName` (`@objectstack/core`) is
 * the predicate the engine and the driver wall by, and
 * `resolveInjectedSystemColumns` is the single source `applySystemFields`
 * itself consumes, so this answers what the engine will register, not what
 * the author happened to type. It is the column this loader stamps with the
 * load's organization, the one a per-organization replay matches existing
 * rows on, and the one a row's own organization is read from.
 */
function seedRowTenantColumn(definition: unknown): string | null {
  if (!definition || typeof definition !== 'object') return null;
  if (isTenancyDisabled(definition)) return null;
  const resolved = resolveTenantFieldName(definition);
  if (resolved !== null) return resolved;
  return resolveInjectedSystemColumns(definition).tenant ? DEFAULT_TENANT_FIELD : null;
}

/**
 * [#33791] The fields the seed reference graph reads for one object: the ones
 * its definition declares, plus `owner_id` when the system-column pass injects
 * it and the object does not declare it.
 *
 * The definition the loader resolves is the metadata service's, which is what
 * the author wrote. An object that relies on the platform's owner has no
 * `owner_id` there: objectql adds it at registration, from the same
 * `resolveInjectedSystemColumns` plan read here, as {@link OWNER_FIELD_DEF} (a
 * `sys_user` lookup). Read from the declared fields alone, a seed value naming
 * a person in that column was written as the name itself, while a declared
 * person field on the same row resolved. With it, the injected owner is a
 * reference exactly as a declared `sys_user` lookup named `owner_id` is: the
 * same resolution, the same organization-scoped membership probe, and NULL with
 * the same "not a member" error for a person outside the load's organization.
 *
 * A declared `owner_id` is the author's and wins, whatever its type (the
 * registry lets it win too). An object the pass gives no owner (`ownership:
 * 'org' | 'none' | 'business_unit'`, `managedBy`, a `sys_*` name,
 * `systemFields: false`) gets nothing added.
 */
function seedReferenceGraphFields(definition: { fields: Record<string, unknown> }): Record<string, unknown> {
  const fields = definition.fields;
  if (Object.prototype.hasOwnProperty.call(fields, SystemFieldName.OWNER_ID)) return fields;
  if (!resolveInjectedSystemColumns(definition).owner) return fields;
  return { ...fields, [SystemFieldName.OWNER_ID]: OWNER_FIELD_DEF };
}

/** [ADR-0131 D9] Does a seed row of this object need an organization? See {@link seedRowTenantColumn}. */
function seedRowNeedsOrganization(definition: unknown): boolean {
  return seedRowTenantColumn(definition) !== null;
}

/**
 * [#33207] Does the target's schema carry an `organization_id` column at all —
 * declared, or injected by the system-column pass? Narrower than
 * {@link seedRowNeedsOrganization} on purpose: an object that declares the
 * column but disables tenancy still HAS it, so a reference probe may still
 * filter on it, as it always did. Only a target with no such column is one
 * the organization filter can never run against.
 */
function carriesOrganizationColumn(definition: unknown): boolean {
  if (!definition || typeof definition !== 'object') return true;
  const fields = (definition as { fields?: unknown }).fields;
  if (fields && typeof fields === 'object' && Object.prototype.hasOwnProperty.call(fields, 'organization_id')) {
    return true;
  }
  return resolveInjectedSystemColumns(definition).tenant;
}

/**
 * Is `objectName` a global object: one no organization walls, so a
 * per-organization load reads its rows unscoped? An author's object (no
 * `managedBy`) with no organization column, declared or injected, that
 * resolves no tenant field (`resolveTenantFieldName`, the reading the wall
 * scopes by), e.g. `tenancy: { enabled: false }`. The one reading both the
 * reference probe ({@link SeedLoaderService.probeScopeOf}) and the replay's
 * existing-row match (`organizationColumnOf`) take. `sys_user` and
 * `sys_organization` carry no organization column either and are scoped by
 * their own rules, never as global. A definition the registry cannot describe
 * is not global.
 *
 * Such an object's seed rows carry no organization: {@link seedRowTenantColumn}
 * answers `null` for it, so a row is neither stamped nor refused for a column
 * it does not have.
 */
function isGlobalSeedObject(objectName: string, definition: unknown): boolean {
  if (!definition || typeof definition !== 'object') return false;
  if (objectName === SystemObjectName.USER || objectName === SystemObjectName.ORGANIZATION) return false;
  if (carriesOrganizationColumn(definition)) return false;
  return !(definition as { managedBy?: unknown }).managedBy && resolveTenantFieldName(definition) === null;
}

/**
 * [#33207] How an organization-scoped load probes one reference target
 * (`SeedLoaderService.probeScopeOf`). The `organization` scope names the
 * column the probe filters on: the target's resolved tenant column, the one
 * its rows are walled by.
 */
type ProbeScope =
  | { readonly kind: 'organization'; readonly tenantColumn: string }
  | { readonly kind: 'members' }
  | { readonly kind: 'own-organization' }
  | { readonly kind: 'global' };

/** [#33207] A reference probe the engine refused: it never ran. */
interface ProbeRefusal {
  readonly object: string;
  readonly field: string;
  readonly code: string;
}

/**
 * [#33207] What the database probes answered for one reference value: the id
 * that resolved it, or a miss — with the refusal that made the miss
 * uninformative, and the organization a same-named person matched outside of.
 */
interface DatabaseProbeOutcome {
  readonly id: string | null;
  readonly refusal?: ProbeRefusal;
  readonly nonMemberOf?: string;
}

/**
 * [#22301] Put every `Date` a seed row resolved to into the STORED form of its
 * temporal field, before the row reaches the engine.
 *
 * `resolveSeedRecord` evaluates an Expression envelope to whatever the CEL
 * stdlib returns, and `today()` / `daysFromNow(n)` / `daysAgo(n)` / `now()`
 * return a JS `Date` (ADR-0053 D1). Handed on as a `Date`, what a hook saw
 * depended on HOW the hook ran, not on the value: a hook lowered to a body runs
 * in the sandbox, whose JSON bridge turned it into a full ISO instant
 * (`2026-10-09T00:00:00.000Z`, even on a `date` field), and the same hook as an
 * in-process `handler` (a source config, as `@objectstack/verify`'s `bootStack`
 * boots it) received the `Date` object itself. A hook reading the field as a
 * string accepted the row under `os dev` and refused it under `bootStack`.
 * Neither is the value the column stores — the driver writes the ADR-0053 form
 * (`YYYY-MM-DD` for a `date`) — nor the value a REST write of the same row
 * hands the hook.
 *
 * So the row leaves the loader in that stored form, by the ONE rule the drivers
 * apply on write (`temporalStorageForm`, `@objectstack/core`): every hook sees
 * what is stored, however it runs. A non-temporal field, a field the definition
 * does not declare, and an Invalid Date are left exactly as resolved — the rule
 * normalizes temporal FORM and never invents a value (its own totality).
 */
function seedValuesInStoredForm(record: Record<string, unknown>, definition: unknown): void {
  const fields = (definition as { fields?: Record<string, { type?: unknown } | undefined> } | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return;
  for (const [key, value] of Object.entries(record)) {
    if (!(value instanceof Date)) continue;
    const kind = temporalComparandKind(fields[key]?.type);
    if (kind) record[key] = temporalStorageForm(value, kind);
  }
}

/**
 * [#25761] The columns a dataset writes only when it CREATES the row — those
 * its `columns` map declares `applyOn: 'create'` — minus the fields of its
 * `externalId`. A key field is what a matched row was found by, so it stays in
 * that row's write whatever it declares, as an import's match key stays
 * (`FieldMappingEntry.applyOn`, the same policy at the import door).
 */
function createOnlySeedColumns(dataset: Seed, externalId: string | string[]): ReadonlySet<string> {
  const keyFields = new Set(Array.isArray(externalId) ? externalId : [externalId]);
  const createOnly = new Set<string>();
  for (const [column, policy] of Object.entries(dataset.columns ?? {})) {
    if (policy?.applyOn === 'create' && !keyFields.has(column)) createOnly.add(column);
  }
  return createOnly;
}

/**
 * [#35655] The roll-up `summary` fields the definition declares — every one,
 * whatever its aggregate (`count`, `sum`, `min`, `max`, `avg`) and whether or
 * not it is declared `readonly`. A seed never stores a value for one (maintainer
 * ruling D, record 7063117450): the engine computes it from the child rows, so
 * {@link SeedLoaderService} takes a seed record's value for it out before the
 * replay compare and before the write, and says so in one `warn` per dataset.
 *
 * Keyed on `type === 'summary'` literally, as the engine's roll-up readers
 * are (`summaryFieldsLockedOnWrite`, `getSummaryDescriptors`). A definition
 * the loader cannot resolve declares none, and its records are written as
 * authored: the engine is then the one to judge the columns.
 */
function summaryFieldNames(definition: unknown): readonly string[] {
  const fields = (definition as { fields?: unknown } | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const names: string[] = [];
  for (const [name, field] of Object.entries(fields as Record<string, unknown>)) {
    if (field && typeof field === 'object' && (field as { type?: unknown }).type === 'summary') names.push(name);
  }
  return names;
}

/**
 * [#24562] Field name → storage kind, for every field the definition declares
 * `datetime`, `date` or `time` — the fields a replay compares in their STORED
 * form (see {@link SeedLoaderService.isNoOpReplay}). Same field-type reading
 * as {@link seedValuesInStoredForm}; a definition the loader cannot resolve
 * declares none, and its fields keep the type-blind comparison.
 */
function temporalFieldKinds(definition: unknown): ReadonlyMap<string, TemporalComparandKind> {
  const kinds = new Map<string, TemporalComparandKind>();
  const fields = (definition as { fields?: Record<string, { type?: unknown } | undefined> } | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return kinds;
  for (const [name, field] of Object.entries(fields)) {
    const kind = temporalComparandKind(field?.type);
    if (kind) kinds.set(name, kind);
  }
  return kinds;
}

/**
 * [#24624] Every field whose stored value the engine's read path never hands
 * back — the fields a replay cannot compare by value (see
 * {@link SeedLoaderService.isNoOpReplay}).
 *
 * Asked of the ONE declaration of which field types are masked on read and
 * which `managedBy` buckets exempt them (`isMaskedOnReadFieldType`,
 * `@objectstack/spec/data`, ADR-0100), the predicate the engine's own
 * `collectMaskedReadFields` asks, so the loader and the mask cannot disagree
 * about a type or an exemption. That collector itself is out of reach here:
 * `@objectstack/objectql` depends on this package. A definition the loader
 * cannot resolve declares none, and its fields keep the ordinary comparison.
 */
function maskedOnReadFields(definition: unknown): ReadonlySet<string> {
  const masked = new Set<string>();
  const object = definition as
    | { fields?: Record<string, { type?: unknown } | undefined>; managedBy?: unknown }
    | null
    | undefined;
  const fields = object?.fields;
  if (!fields || typeof fields !== 'object') return masked;
  for (const [name, field] of Object.entries(fields)) {
    if (isMaskedOnReadFieldType(field?.type, object.managedBy)) masked.add(name);
  }
  return masked;
}

/**
 * How a replay compares the fields of ONE object, read once per dataset from
 * its definition (see {@link SeedLoaderService.isNoOpReplay}).
 */
interface ReplayComparands {
  /** [#24562] Fields compared in their STORED temporal form. */
  readonly temporal: ReadonlyMap<string, TemporalComparandKind>;
  /** [#24624] Fields the read path masks: a set value is never compared. */
  readonly masked: ReadonlySet<string>;
  /**
   * [#29277] Fields whose blank the write door stores as `null`, with which
   * blanks (`blankAsNullColumns`, `@objectstack/core` — the rule the door
   * itself applies): a seed value is compared in that stored form.
   */
  readonly blankAsNull: ReadonlyMap<string, BlankAsNullReach>;
}

/**
 * What a {@link SeedLoaderService.load} that THREW had already written.
 *
 * A load writes dataset by dataset and nothing undoes a dataset's rows when a
 * later one throws, so a caller that reports the failure must still be able to
 * say what landed: a receipt answering `inserted: 0` while the table holds the
 * earlier datasets' rows is a receipt that lies. Read with
 * {@link seedLoadPartialWrites} on the error the load threw.
 */
export interface SeedLoadPartialWrites {
  /** Rows inserted before the load threw — finished datasets plus the one that threw. */
  readonly inserted: number;
  /** Rows updated before the load threw, counted the same way. */
  readonly updated: number;
  /** The object of the dataset that was loading when the load threw; absent when it threw outside any dataset. */
  readonly failedObject?: string;
  /**
   * [#30429] The datasets that FINISHED before the throw, in load order, each
   * with the row ids it landed on (`landedIds` / `insertedIds`, exactly as its
   * returned result carries them) — what the publish receipt projects into
   * `seedApplied.landed` with the same `seedAppliedLanded` a returned load
   * uses. Empty when the throw came before any dataset finished.
   *
   * The dataset that threw is NOT here, although its rows are in the counts
   * above: its ids are only partly known when it throws. A batched insert
   * whose response was lost may have committed rows whose ids never came back
   * (the loader re-reads by key on its retry for exactly that reason), so a
   * list of the ids it did see would read as complete while missing rows. A
   * finished dataset's list is complete; that is the line this field draws.
   */
  readonly finished: readonly SeedLandingResult[];
}

/** The writes a thrown load had made, keyed by the error it threw. */
const partialWritesByError = new WeakMap<object, SeedLoadPartialWrites>();

/**
 * What the {@link SeedLoaderService.load} that threw `err` had written, or
 * `undefined` when `err` did not come out of a load.
 */
export function seedLoadPartialWrites(err: unknown): SeedLoadPartialWrites | undefined {
  return err !== null && typeof err === 'object' ? partialWritesByError.get(err) : undefined;
}

/** What a {@link SeedLoaderService} is built with beyond its engine, metadata and logger. */
export interface SeedLoaderServiceOptions {
  /**
   * [#25779] The `field-files` service (`FIELD_FILE_SERVICE`,
   * `@objectstack/spec/contracts`) seed files are stored through, resolved
   * when a dataset loads. A caller with a kernel passes
   * `() => ctx.getService(FIELD_FILE_SERVICE)`.
   */
  getFieldFiles?: () => IFieldFileService | null | undefined;
  /**
   * [#31021] Keep, and honour, the record of which seed rows landed in the
   * organization a load seeds (`sys_seed_landed_key`).
   *
   * - `'honour'` — every keyed row an `upsert` or `ignore` dataset lands
   *   (inserted, updated, or matched and left alone) is recorded, and a
   *   recorded key whose row is now gone is NOT inserted again: a person
   *   removed it. A reference to such a row is left as it is instead of being
   *   reported unresolved. A key never recorded still lands, so a row an
   *   upgrade adds to the seed is inserted as before.
   * - `'reseed'` — the deliberate re-seed: records the same, and inserts every
   *   missing row whatever the record says.
   * - absent — the record is neither read nor written.
   *
   * Kept only on a load that seeds an organization (`config.organizationId`,
   * or the install's sole organization) and only where the composition
   * registers `sys_seed_landed_key` (`@objectstack/platform-objects`); a load
   * without one keeps no record and says so once.
   */
  landedKeys?: 'honour' | 'reseed';
}

export class SeedLoaderService implements ISeedLoaderService {
  private engine: IDataEngine;
  private metadata: IMetadataService;
  private logger: Logger;
  /**
   * Organization to stamp EVERY seed row with when the caller pinned no
   * explicit `config.organizationId` (resolved per {@link resolveSoleOrganizationId}).
   * Set once per {@link load}.
   *
   * [ADR-0131 D3] `sys_` / `cloud_` / `ai_` seeds take it too. They used to be
   * exempt as "intentionally global/cross-tenant"; there are no platform-global
   * seeds left, and a seeded `sys_business_unit` is the organization's own.
   */
  private fallbackOrgId?: string;
  /**
   * [ADR-0131 D9] Why {@link fallbackOrgId} is unset, when it is: the install
   * registers the organization object and holds no organization, or several
   * (`unowned`), versus a composition with no organization object at all
   * (`undefined` here — today's branch, unchanged). Only `unowned` refuses the
   * rows of an organization-owned object. Set once per {@link load}.
   */
  private unownedOrganizationCount?: number;
  /**
   * Roll-up summary values left stale so far in the CURRENT {@link load} —
   * bumped by {@link reportStaleSummaries}, sampled by {@link loadDataset}
   * around each dataset so every result entry reports only its own share
   * (two datasets may target the same object, so keying by object name would
   * double-count).
   *
   * An instance field for the same reason {@link fallbackOrgId} is one: the
   * write path that discovers this is several private methods below the point
   * the per-dataset counters live, and threading a callback through
   * `writeRecord` would put plumbing in five call sites to carry one number.
   * Reset per `load`; datasets are loaded strictly sequentially (`for … await`),
   * so the sampling is exact.
   */
  private summariesStale = 0;
  /**
   * [#9071] Per-{@link load} memo of "does this object declare a `name`
   * column?", keyed by object name — the question {@link resolveFromDatabase}
   * must answer before it may spell `where: { name }`.
   *
   * Memoised because the question is asked once per unresolved reference VALUE
   * (hundreds per seeded boot) while its answer is a property of the object,
   * and `resolveObjectDefinition` reaches the metadata store. Cleared at the
   * top of every `load` for the same reason {@link summariesStale} is: a
   * service instance outlives a load, and a publish between two loads can add
   * the very column this answer is about.
   */
  private declaresNameColumnCache = new Map<string, boolean>();
  /**
   * [#33207] Per-{@link load} memo of how an organization-scoped load probes a
   * reference target ({@link probeScopeOf}). Cleared per load for the reason
   * {@link declaresNameColumnCache} is.
   */
  private probeScopeCache = new Map<string, ProbeScope>();
  /** [#33207] The refused probes this {@link load} has already said, one line each. */
  private refusedProbes = new Set<string>();
  /**
   * [#11339] Declared pointer pairs per seeded object — every `text` field
   * whose definition carries `referenceVia` (ADR-0052 §5 ActivityPointer:
   * `sys_activity.record_id` + `object_name`), mapped to the sibling field
   * that names the target object PER ROW. Built once per {@link load} (step
   * 4.5) from the same definition resolver the reference graph uses.
   *
   * An instance field for the same reason {@link fallbackOrgId} is one: the
   * consumer ({@link loadDataset}'s per-record resolution loop) sits several
   * parameters deep, and the map is a per-load constant. Reset per `load`.
   */
  private pointerRefsByObject = new Map<string, Array<{ field: string; objectField: string }>>();
  /**
   * [#11339] The per-load `dataset.object → declared externalId` map — the
   * SAME map step 4 threads into {@link buildReferenceMap} for static
   * references. A pointer pair's target object is only known per ROW, so its
   * `targetField` cannot be pre-resolved into a refMap entry; the resolution
   * loop reads this instead, at the moment the sibling column names the
   * target. Reset per `load`.
   */
  private seedExternalIdByObject = new Map<string, string | string[]>();
  /**
   * [commit 1cba33f16] Per seeded object, the fields the WRITE CONTRACT requires a value
   * for **on insert** — the subset a pass-1 deferral cannot survive.
   *
   * Pass 1 defers an unresolvable reference by DELETING the column from the
   * row (see the deferral branch in {@link loadDataset}). On a `required: true`
   * column that turns the insert into one ADR-0113 rejects, so the row never
   * lands and pass 2 has nothing to write back onto — a second, independent
   * road to the same loud failure that pass-2 write-back cannot clear. This
   * map is what lets the loader say so BEFORE the engine does, at the moment
   * the deferral is taken (the early signal, this card's B half).
   *
   * The set MIRRORS the write contract's own insert-time predicate rather than
   * approximating it: `required && !readonly && !system`. A `readonly`/`system`
   * field is skipped by required-validation on insert, so a deferral on one is
   * accepted today — signalling there would be a false alarm, and a warning
   * that fires where nothing fails is how readers are trained to skim `warn`
   * (AGENTS.md → "Degradation log levels", "Do not over-apply it").
   *
   * An instance field for the same reason {@link pointerRefsByObject} is one:
   * the consumer sits several parameters deep and the map is a per-load
   * constant. Built in {@link load} step 4.5; reset per `load`. An object whose
   * definition cannot be resolved gets NO entry — the loader then knows
   * nothing about `required` there and stays silent rather than guessing.
   */
  private requiredOnInsertByObject = new Map<string, Set<string>>();
  /**
   * [#21665] Per seeded object, authored seed `id` → the id that row LANDED
   * with in this load, for every row a per-organization replay could not give
   * its authored id (see {@link assignReplayRowIds}).
   *
   * This is what re-points the replay's own references. A sibling row that
   * names `parent_business_unit_id: 'bu_acme'` means "the row this seed
   * authored as `bu_acme`", and in the second organization that row is not
   * called `bu_acme`. {@link resolveReferenceItem} reads this map first, so
   * such a reference resolves to this organization's row, in pass 1 and in
   * pass 2 alike, whatever shape the authored id has.
   *
   * Only rows the replay actually re-identified are entered, and only once
   * they have landed. A replay that keeps every authored id (the first
   * organization's) enters nothing and resolves exactly as it did before; a
   * row whose write failed is never entered, so a reference to it is reported
   * unresolved instead of pointing at a row that does not exist.
   *
   * An instance field for the same reason {@link pointerRefsByObject} is one:
   * pass 2 reads it several parameters away from where pass 1 fills it.
   * Reset per `load`.
   */
  private replayIdByAuthoredId = new Map<string, Map<string, string>>();
  /**
   * [#24624] Per seeded object, the credential fields the CURRENT {@link load}
   * skipped a row without comparing (see {@link SeedLoaderService.isNoOpReplay}),
   * and how many rows it skipped that way. Reported once, at the end of the
   * load, by {@link reportUncomparedCredentials}.
   *
   * An instance field for the same reason {@link summariesStale} is one: the
   * skip is counted several parameters below the point the load ends. Filled
   * only where a skip is COUNTED, never by the comparison itself, which
   * {@link decideWriteAction} runs up to three times per record. Reset per
   * `load`.
   */
  private uncomparedCredentials = new Map<string, { fields: Set<string>; rows: number }>();

  /**
   * The CURRENT {@link load}'s writes so far, for {@link SeedLoadPartialWrites}:
   * the finished datasets' results, and the counters of the dataset loading
   * now. Reset per `load`; an instance field for {@link summariesStale}'s
   * reason (datasets load strictly sequentially).
   */
  private loadProgress?: {
    finished: readonly SeedLoadResultParsed[];
    loading?: { object: string; written: { inserted: number; updated: number } };
  };

  /**
   * [#25779] The `field-files` service (`FIELD_FILE_SERVICE`) a seed file is
   * stored through, read per dataset. Absent — a loader built without one, or
   * a composition without `@objectstack/service-storage` — a row naming a seed
   * file is refused, and an id-shaped file value is written unchecked, as the
   * platform keeps one where it manages no files.
   */
  private readonly getFieldFiles: () => IFieldFileService | null | undefined;

  /** [#31021] {@link SeedLoaderServiceOptions.landedKeys}, as constructed. */
  private readonly landedKeysMode?: 'honour' | 'reseed';
  /**
   * [#31021] The CURRENT {@link load}'s record of landed seed rows, or
   * `undefined` when the load keeps none. An instance field for
   * {@link replayIdByAuthoredId}'s reason: reference resolution reads it
   * several parameters away from where the load opens it. Reset per `load`.
   */
  private landedKeyLedger?: LandedKeyLedger;
  /**
   * [#34458] The person references the last {@link load} left NULL because no
   * `sys_user` row answered yet, each on a row it landed on. Reset per `load`;
   * read and shrunk by {@link resolveHeldPersonReferences}.
   */
  private heldPersonReferences: HeldPersonReference[] = [];
  /** [#34458] The retry in flight: a second one waits for it, so two never interleave. */
  private heldPersonRetry: Promise<unknown> = Promise.resolve();

  constructor(engine: IDataEngine, metadata: IMetadataService, logger: Logger, options: SeedLoaderServiceOptions = {}) {
    this.engine = engine;
    this.metadata = metadata;
    this.logger = logger;
    this.getFieldFiles = options.getFieldFiles ?? (() => undefined);
    this.landedKeysMode = options.landedKeys;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Load every dataset in the request.
   *
   * [#13889] The whole load runs inside an ADVISORY AGGREGATION SCOPE. A
   * `severity: 'warning'` validation rule is a hint written for a human in a
   * form; evaluated across a seed load it produces one `WARN` line per row, and
   * a clean-database first boot then opens with a wall of them that reads like a
   * failed boot. Inside the scope those hits are folded by rule and reported by
   * {@link reportAdvisorySummary} as ONE line each — maintainer ruling
   * 2026-09-01, 「⛔ 不改规则语义,只改日志形状」.
   *
   * The scope is opened HERE rather than at the callers because this method is
   * the one funnel every seeding path goes through — boot inline seed, per-org
   * replay, hot reload, package apply, draft publish, marketplace install — the
   * same reason `resolveEnvConfig` is resolved here rather than at the six call
   * sites that build a request (#4704). A caller that writes seed rows through
   * the engine directly, bypassing this loader (app-plugin's metadata-service
   * fallback), keeps the per-row lines: no scope is open, so nothing changes for
   * it.
   */
  async load(request: SeedLoaderRequestParsed): Promise<SeedLoaderResultParsed> {
    this.loadProgress = undefined;
    this.heldPersonReferences = [];
    try {
      return await runWithAdvisoryAggregation(
        () => this.loadDatasets(request),
        (groups) => this.reportAdvisorySummary(groups),
      );
    } catch (err) {
      throw this.notePartialWrites(err);
    }
  }

  /** [#34458] How many person references {@link resolveHeldPersonReferences} still holds. */
  heldPersonReferenceCount(): number {
    return this.heldPersonReferences.length;
  }

  /**
   * [#34458] Retry the person references the last {@link load} left NULL
   * because no `sys_user` row answered yet — the seed that runs before the
   * first admin exists names that admin, and pass 2 is otherwise its last word.
   *
   * Each reference is resolved by the rule pass 2 used ({@link
   * resolveReferenceItem}, the same organization), and a reference that now
   * resolves is written onto the row the load landed on, and only while that
   * column is still NULL: the write is a compare-and-set by the row's id, so a
   * row the seed did not write is never reached (ADR-0138 D1), and a value
   * someone set since is kept. A reference that resolves is released whatever
   * the write matched; one that still misses stays held for the next call.
   * Calls run one after another, never interleaved.
   */
  resolveHeldPersonReferences(): Promise<{ resolved: number; held: number }> {
    const run = this.heldPersonRetry.then(() => this.retryHeldPersonReferences());
    this.heldPersonRetry = run.catch(() => undefined);
    return run;
  }

  /** The body of {@link resolveHeldPersonReferences}, one call at a time. */
  private async retryHeldPersonReferences(): Promise<{ resolved: number; held: number }> {
    const pending = this.heldPersonReferences;
    if (pending.length === 0) return { resolved: 0, held: 0 };
    const stillHeld: HeldPersonReference[] = [];
    let resolved = 0;
    for (const held of pending) {
      const items = Array.isArray(held.attemptedValue) ? held.attemptedValue : [held.attemptedValue];
      const values: unknown[] = [];
      let missed = false;
      for (const item of items) {
        if (isMissing(item)) continue;
        const outcome = await this.resolveReferenceItem(held, item, new Map(), { organizationId: held.organizationId });
        if (outcome.status === 'resolved' || outcome.status === 'kept') {
          values.push(outcome.value);
          continue;
        }
        // [#31021] Gone on purpose: no link to write for this element.
        if (outcome.status === 'withdrawn') continue;
        missed = true;
        break;
      }
      if (missed) {
        stillHeld.push(held);
        continue;
      }
      if (values.length === 0) continue;
      try {
        const written = await this.engine.update(
          held.objectName,
          { [held.field]: held.multiple ? values : values[0] },
          {
            ...this.writeOptionsFor(held.rowOrganization),
            where: { id: held.recordId, [held.field]: null },
            multi: true,
          } as any,
        );
        if (typeof written === 'number' && written > 0) resolved += 1;
      } catch (err) {
        stillHeld.push(held);
        const causeSentence = seedFailureCause(err);
        this.logger.error(
          `[SeedLoader] Held person reference back-fill FAILED — ${held.objectName}.${held.field} stays NULL on ` +
            `row '${held.recordId}' although ${held.targetObject}.${held.targetField} = ` +
            `'${this.formatAttempted(held.attemptedValue)}' now resolves. The row itself looks healthy while the ` +
            'person the seed named is missing from it. The write is tried again at the next person insert of ' +
            `this process; fix the error below, or set ${held.field} on that row by hand. ` +
            `${seedCauseLabel(err, causeSentence)}: ${causeSentence}.`,
          err instanceof Error ? err : undefined,
          { object: held.objectName, field: held.field, recordId: held.recordId },
        );
      }
    }
    this.heldPersonReferences = stillHeld;
    if (resolved > 0) {
      this.logger.info(
        `[SeedLoader] ${resolved} seed person reference(s) left NULL before their person existed now resolve, ` +
          `on rows the seed landed on; ${stillHeld.length} still wait for their person`,
      );
    }
    return { resolved, held: stillHeld.length };
  }

  /**
   * Record on `err` what this load wrote before it threw (see
   * {@link SeedLoadPartialWrites}) and hand back the error to rethrow — the
   * same error, so its declared status and message reach the caller as they
   * did; a thrown non-object is wrapped, since only an object can carry it.
   */
  private notePartialWrites(err: unknown): unknown {
    const finished = this.loadProgress?.finished ?? [];
    const loading = this.loadProgress?.loading;
    const partial: SeedLoadPartialWrites = {
      inserted: finished.reduce((sum, r) => sum + r.inserted, 0) + (loading?.written.inserted ?? 0),
      updated: finished.reduce((sum, r) => sum + r.updated, 0) + (loading?.written.updated ?? 0),
      ...(loading ? { failedObject: loading.object } : {}),
      // A snapshot of the ids alone: the results array is the live one pass 2
      // writes its counters into.
      finished: finished.map((r) => ({ object: r.object, landedIds: r.landedIds, insertedIds: r.insertedIds })),
    };
    const carrier = err !== null && typeof err === 'object' ? err : new Error(String(err));
    partialWritesByError.set(carrier, partial);
    return carrier;
  }

  /**
   * One summary line per advisory rule tripped during a load.
   *
   * Shape, from the ruling: 「N 行触发 advisory 规则 X,详见…」 — the count is
   * of ROWS, the rule is named, and the 「详见…」 half is the structured meta:
   * the rule's own message plus example row ids, which is what turns a summary
   * back into something actionable.
   *
   * Emitted at `warn`, the level the per-row lines used: the defect is N lines
   * where one belongs, NOT that the report exists. Dropping it to `info` would
   * hide it under the default log level entirely — deleting the report rather
   * than aggregating it, which is option C the ruling excluded.
   */
  private reportAdvisorySummary(groups: AdvisoryGroup[]): void {
    for (const group of groups) {
      const examples = group.sampleRows.length > 0
        ? ` Example row(s): ${group.sampleRows.join(', ')}${group.rows > group.sampleRows.length ? ', …' : ''}.`
        : '';
      this.logger.warn(
        `[SeedLoader] ${group.rows} row(s) triggered advisory rule '${group.rule}' (${group.severity}) on '${group.object}': ` +
          `${group.message} — advisory rules are authoring guidance for interactive writes; they never block a seed load ` +
          `and nothing here failed.${examples}`,
        {
          object: group.object,
          rule: group.rule,
          severity: group.severity,
          rows: group.rows,
          message: group.message,
          sampleRows: group.sampleRows,
        },
      );
    }
  }

  /**
   * [#24624] Record a skipped row whose credential fields the replay did not
   * compare. Called only where the skip is counted.
   */
  private noteUncomparedCredentials(objectName: string, fields: readonly string[]): void {
    if (fields.length === 0) return;
    let entry = this.uncomparedCredentials.get(objectName);
    if (!entry) {
      entry = { fields: new Set(), rows: 0 };
      this.uncomparedCredentials.set(objectName, entry);
    }
    entry.rows++;
    for (const field of fields) entry.fields.add(field);
  }

  /**
   * [#24624] ONE line per load when a replay skipped a row without comparing a
   * credential field: the rule, the fields it applied to, and the two ways a
   * credential-only seed change takes effect (ruled letter B: a masked field
   * never blocks the skip).
   *
   * Logged at `info`, like {@link filterByEnv}'s line: the skip is the
   * declared, intended outcome, and it happens on every healthy replay of a
   * seed that carries a credential (the stock showcase, every boot), where a
   * `warn` would cry wolf — and the official examples boot with zero warnings
   * (`examples/app-showcase/test/no-startup-warnings.test.ts`). Nothing is
   * lost that the system claims to hold: the row keeps the credential it had,
   * so this is not the durability class AGENTS.md reserves `error` for.
   */
  private reportUncomparedCredentials(): void {
    if (this.uncomparedCredentials.size === 0) return;
    const fields: string[] = [];
    let rows = 0;
    for (const [objectName, entry] of this.uncomparedCredentials) {
      rows += entry.rows;
      for (const field of entry.fields) fields.push(`${objectName}.${field}`);
    }
    this.logger.info(
      `[SeedLoader] ${rows} seeded row(s) were left unchanged without comparing their credential field(s) ` +
        `${fields.join(', ')}: a secret field, and a password field on an object not managed by better-auth, ` +
        `is masked on read, so a replay cannot see whether the seed changed a value that is already set and ` +
        `never rewrites a row for that alone. A seed change to only such a field is not applied on replay: ` +
        `change another field of the same row too (the rewrite then writes the seed's value), or rebuild the ` +
        `database.`,
      { rows, fields },
    );
  }

  private async loadDatasets(request: SeedLoaderRequestParsed): Promise<SeedLoaderResultParsed> {
    const startTime = Date.now();
    // Pin the environment `Seed.env` is gated on BEFORE anything reads config.
    // Resolving it here — the one funnel every seeding path goes through — is
    // deliberate. `env` stayed authorable, defaulted and type-checked while
    // being completely inert purely because none of the six call sites that
    // build a SeedLoaderRequest (app boot, per-org replay, hot reload, package
    // apply, draft publish, marketplace install) ever passed it, so
    // `filterByEnv` short-circuited on `undefined` and `dataset.env` was never
    // read at all. Gating at those call sites instead would leave call site
    // seven free to re-open the same hole (framework#4704).
    const config = this.resolveEnvConfig(request.config, request.seeds);
    // The locale axis has nothing to resolve FROM — there is no `NODE_ENV` of
    // locales, and minting one would trade a declared-and-unset key for another
    // — so it is inert unless the host supplies `config.locale`. That is
    // exactly the shape `Seed.env` was in before framework#4704, which is why
    // it is signposted here rather than left silent.
    this.warnOnUnresolvedLocaleScope(config, request.seeds);
    const allErrors: ReferenceResolutionError[] = [];
    const allResults: SeedLoadResultParsed[] = [];
    this.loadProgress = { finished: allResults };
    // Per-load counter — a service instance can be reused across loads.
    this.summariesStale = 0;
    // [#9071] Same per-load lifetime, same reason: a publish between two loads
    // can add (or drop) the `name` column this memo answers about.
    this.declaresNameColumnCache.clear();
    // [#33207] Same per-load lifetime: a target's columns and the refusals said.
    this.probeScopeCache.clear();
    this.refusedProbes.clear();
    this.rowWriteOptions.clear();
    // [#21665] One replay's ids belong to one organization: a reused service
    // instance must never re-point the next load's references with them.
    this.replayIdByAuthoredId.clear();
    // [#24624] One notice per load, about this load's skips only.
    this.uncomparedCredentials.clear();
    // [#31021] One load's record belongs to one organization (opened below).
    this.landedKeyLedger = undefined;

    // When the caller pinned no target org (an in-process publish has no active
    // user session — the AI build agent's publish path; the `single`-posture
    // boot seed), seed rows would land `organization_id = NULL`. If the install
    // has exactly ONE organization, adopt it so every seed row carries the
    // tenant key like a normal write.
    //
    // [ADR-0131 D9] Zero or several organizations no longer mean "keep the
    // historical NULL": in a composition that registers the organization object
    // there is no owner to derive, and the rows of an organization-owned object
    // are REFUSED (see `loadDataset`). Under `single` the Default Organization
    // is created at boot before seeds load (D3), so a boot seed never meets the
    // zero case. A composition with no organization object keeps today's branch.
    this.fallbackOrgId = undefined;
    this.unownedOrganizationCount = undefined;
    if (config.organizationId == null) {
      const reading = await this.resolveSoleOrganizationId();
      if (reading.kind === 'sole') this.fallbackOrgId = reading.organizationId;
      else if (reading.kind === 'unowned') this.unownedOrganizationCount = reading.organizationCount;
    }
    // [#33206] Every write of this load carries the organization its rows are
    // stamped with — the pinned one, or the install's sole organization under
    // `single` — as `tenantId`, the key a hook's `session.organizationId` and
    // its `ctx.api` scope are built from. Composed here, at the call site: the
    // shared posture is not changed. No organization ⇒ today's bag, untouched.
    const writeOrganization = config.organizationId ?? this.fallbackOrgId;
    this.writeOrganization = writeOrganization;
    this.seedOptions = writeOrganization
      ? { context: { ...SEED_WRITE_EXECUTION_CONTEXT, tenantId: writeOrganization } }
      : SeedLoaderService.SEED_OPTIONS;

    // 1. Filter datasets by the scope axes (environment AND locale). An object
    // whose env-scoped datasets mark two DISTINCT fallback sets has no single
    // set to fall back to (`Seed.fallback`): only its fallback CHOICE is
    // refused. Every marked set still goes through the locale filter and loads
    // for the locales it lists, exactly as an unmarked set would; none fills in
    // for a locale no set lists. Identical copies of one declaration count
    // once — the shared per-organization replay list holds a package's
    // datasets once per merge.
    const envScoped = this.filterByEnv(request.seeds, config.env);
    const fallbackRefusals = findDuplicateFallbackSets(envScoped);
    const refusedFallbackObjects = new Set(fallbackRefusals.map(refusal => refusal.object));
    const datasets = this.filterByLocale(envScoped, config.locale, refusedFallbackObjects);
    allErrors.push(...this.reportDuplicateFallbackSets(fallbackRefusals));

    // [#31021] The record of landed seed rows, once the organization this load
    // seeds is known. A load with nothing to seed reads and writes none.
    this.landedKeyLedger = datasets.length > 0 ? await this.openLandedKeyLedger(config) : undefined;

    if (datasets.length === 0) {
      return allErrors.length > 0
        ? this.buildResult(config, { nodes: [], insertOrder: [], circularDependencies: [] }, [], allErrors, Date.now() - startTime)
        : this.buildEmptyResult(config, Date.now() - startTime);
    }

    // 2. Build dependency graph. `Seed.dependsOn` adds its declared edges to
    // the ones the lookup fields give; a declaration this load cannot honour
    // (a name it does not seed, an edge that closes a cycle) refuses the
    // whole load before any row is written.
    const objectNames = datasets.map(d => d.object);
    const declared = this.collectDeclaredDependencies(datasets, request.seeds);
    const graph = await this.buildDependencyGraph(objectNames, declared.edges);
    const dependsOnRefusals = [...declared.refusals, ...this.findDeclaredEdgeCycles(graph.nodes, declared.edges)];
    if (dependsOnRefusals.length > 0) {
      const refused = this.refuseDeclaredDependencies(config, graph, dependsOnRefusals, Date.now() - startTime);
      // [Seed.fallback] An object's refused fallback choice stays reported on a load refused for its declarations.
      refused.errors.unshift(...allErrors);
      return refused;
    }

    this.logger.info('[SeedLoader] Dependency graph built', {
      objects: objectNames.length,
      insertOrder: graph.insertOrder,
      circularDeps: graph.circularDependencies.length,
    });

    // 3. Order datasets by topological insert order
    const orderedDatasets = this.orderDatasets(datasets, graph.insertOrder);

    // 4. Build reference lookup map from metadata (field → target object).
    // Reference values are authored against the TARGET dataset's externalId
    // (e.g. `interview.candidate: 'alice@example.com'` with the candidate
    // dataset declaring `externalId: 'email'`), so DB-side resolution must
    // query that same field — not a hardcoded 'name'. First boot masked this:
    // the in-memory insertedRecords map (keyed by the dataset's externalId)
    // resolved everything, but on replay any per-record miss fell through to
    // the DB probe and silently failed. See the replay corruption fix below.
    const externalIdByObject = new Map<string, string | string[]>(
      request.seeds.map(d => [d.object, d.externalId || DEFAULT_EXTERNAL_ID_FIELD]),
    );
    const refMap = this.buildReferenceMap(graph, externalIdByObject);

    // 4.5 [#11339] Collect declared pointer pairs (`referenceVia`) per seeded
    // object. These are deliberately NOT part of the dependency graph or the
    // refMap: the target object is named per ROW by the sibling column, so a
    // pointer contributes no static ordering edge — same-load targets that
    // happen to load later are healed by the ordinary pass-2 deferral, which
    // is per record anyway. Only `text` fields participate: the spec refuses
    // `referenceVia` on other types at authoring, and metadata at rest that
    // predates that check must not have non-text columns resolved as ids.
    //
    // [commit 1cba33f16] The same pass also records which fields the write contract
    // requires on insert — the subset a deferral cannot survive. One
    // definition read answers both questions, so the early signal costs no
    // extra metadata round-trip. See {@link requiredOnInsertByObject}.
    this.pointerRefsByObject.clear();
    this.requiredOnInsertByObject.clear();
    this.seedExternalIdByObject = externalIdByObject;
    const definitionScanned = new Set<string>();
    for (const dataset of orderedDatasets) {
      if (definitionScanned.has(dataset.object)) continue;
      definitionScanned.add(dataset.object);
      const objDef = await this.resolveObjectDefinition(dataset.object);
      const fields = objDef?.fields as
        | Record<string, { type?: string; referenceVia?: unknown; required?: unknown; readonly?: unknown; system?: unknown }>
        | undefined;
      if (!fields) continue;
      const pairs: Array<{ field: string; objectField: string }> = [];
      const requiredOnInsert = new Set<string>();
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        if (fieldDef?.type === 'text' && typeof fieldDef.referenceVia === 'string' && fieldDef.referenceVia.length > 0) {
          pairs.push({ field: fieldName, objectField: fieldDef.referenceVia });
        }
        // Mirror of the write contract's insert-time predicate, not an
        // approximation of it — see `requiredOnInsertByObject`.
        if (fieldDef?.required === true && fieldDef.readonly !== true && fieldDef.system !== true) {
          requiredOnInsert.add(fieldName);
        }
      }
      if (pairs.length > 0) this.pointerRefsByObject.set(dataset.object, pairs);
      // Set unconditionally (even empty): "this object declares no required
      // field" and "this object's definition never resolved" are different
      // facts, and only the second may make the loader stay silent.
      this.requiredOnInsertByObject.set(dataset.object, requiredOnInsert);
    }

    // 5. Pass 1: Insert/upsert records, resolving references
    const insertedRecords = new Map<string, Map<string, string>>(); // object → externalIdValue → internalId
    const deferredUpdates: DeferredUpdate[] = [];

    for (const dataset of orderedDatasets) {
      const result = await this.loadDataset(
        dataset, config, refMap, insertedRecords, deferredUpdates, allErrors
      );
      allResults.push(result);

      if (config.haltOnError && result.errored > 0) {
        // Deliberately `warn`, and audited as such in #4729: this line reports
        // a CONTROL-FLOW decision, not a loss. Every error it halts on was
        // already reported at `error` by the site that counted it, and the
        // datasets skipped after it were never written — the load reports
        // `success: false` and says which object stopped it. Escalating a
        // second line about the same failures is the over-application AGENTS.md
        // warns about (it trains readers to skim `error`).
        this.logger.warn('[SeedLoader] Halting on first error', { object: dataset.object });
        break;
      }
    }

    // 6. Pass 2: Resolve deferred references (circular dependencies)
    if (config.multiPass && deferredUpdates.length > 0 && !config.dryRun) {
      this.logger.info('[SeedLoader] Pass 2: resolving deferred references', {
        count: deferredUpdates.length,
      });
      await this.resolveDeferredUpdates(deferredUpdates, insertedRecords, allResults, allErrors, config.organizationId);
    }

    // [#24624] The rule the replay applied to credential fields, said once.
    this.reportUncomparedCredentials();
    // [#31021] The seed rows this load did not insert again, said once.
    this.reportWithdrawnSeedRows();

    // 7. Build final result
    const durationMs = Date.now() - startTime;
    return this.buildResult(config, graph, allResults, allErrors, durationMs);
  }

  /**
   * Object dependency graph of a load: one node per object, an edge per
   * `lookup` / `master_detail` / `user` field that points at another object of
   * the load, plus — when `declared` is given — an edge per `Seed.dependsOn`
   * name (object → the objects it loads after). The declared names are
   * expected to be objects of the load: {@link collectDeclaredDependencies}
   * holds them to it before this runs.
   */
  async buildDependencyGraph(
    objectNames: string[],
    declared?: ReadonlyMap<string, ReadonlySet<string>>,
  ): Promise<ObjectDependencyGraphParsed> {
    const nodes: ObjectDependencyNodeParsed[] = [];
    const objectSet = new Set(objectNames);

    for (const objectName of objectNames) {
      const objDef = await this.resolveObjectDefinition(objectName);
      const dependsOn: string[] = [];
      const references: ReferenceResolutionParsed[] = [];

      if (objDef && objDef.fields) {
        // [#33791] The declared fields plus the injected `owner_id`.
        const fields = seedReferenceGraphFields(objDef) as Record<string, any>;
        for (const [fieldName, fieldDef] of Object.entries(fields)) {
          if (fieldDef.type === 'lookup' || fieldDef.type === 'master_detail' || fieldDef.type === 'user') {
            // [#18550] The read goes through the ONE arbiter, which also
            // retires the `as string` cast this read used to carry — the cast
            // asserted exactly what the truthiness test had not checked, so an
            // object-valued carrier became a `targetObject` that matched no
            // name in `objectSet`, contributed no `dependsOn` edge, and was
            // then pushed onto `references` for resolution to make of what it
            // could. An unreadable carrier still REFUSES here: `referenceTargetOf`
            // reads the carrier through `referenceCarrierOf` before it judges
            // anything, so that throw is unchanged.
            //
            // [#19289] The arbiter is `referenceTargetOf`, ⛔ not
            // `referenceCarrierOf`. This gate admits `user`, and for a `user`
            // field the carrier is NOT the target: `IMPLICIT_REFERENCE_TARGETS`
            // declares the target a CONSTANT OF THE TYPE (`sys_user`) and such
            // metadata "fully specified, not under-specified". Reading the
            // carrier made a spec-complete `{ type: 'user' }` field contribute no
            // `dependsOn` edge and never reach `references`, so its natural key
            // was written VERBATIM instead of resolved to a record id — the
            // dangling reference this function's own docblock below names as the
            // cause of broken parent joins, arrived at silently.
            //
            // ABSENCE keeps its meaning for the types that have no constant:
            // a `lookup` / `master_detail` with no carrier still answers
            // `undefined` and is still skipped, which is what a relational field
            // naming no target means. The type gate stays FIRST, so a `text`
            // field carrying a stray `reference` is still never read.
            const targetObject = referenceTargetOf(fieldDef);
            if (!targetObject) continue;

            // Track dependency ordering only for objects within the graph
            if (objectSet.has(targetObject) && !dependsOn.includes(targetObject)) {
              dependsOn.push(targetObject);
            }

            // Track ALL references for resolution (target may exist in database)
            references.push({
              field: fieldName,
              targetObject,
              targetField: DEFAULT_EXTERNAL_ID_FIELD,
              fieldType: fieldDef.type as 'lookup' | 'master_detail' | 'user',
              // `multiple: true` (lookup/user) stores an ARRAY of ids, so the
              // seed value is an array of natural keys — carried here so
              // resolution knows to map over it instead of rejecting the array
              // as a non-string reference value (framework#3911).
              multiple: isMultiValueField(fieldDef as { type: string; multiple?: boolean }) || undefined,
            });
          }
        }
      }

      // [Seed.dependsOn] The declared edges join the same node, after the
      // ones the fields gave.
      for (const target of declared?.get(objectName) ?? []) {
        if (objectSet.has(target) && !dependsOn.includes(target)) dependsOn.push(target);
      }

      nodes.push({ object: objectName, dependsOn, references });
    }

    // Topological sort
    const { insertOrder, circularDependencies } = this.topologicalSort(nodes, declared);

    return { nodes, insertOrder, circularDependencies };
  }

  /**
   * Object definition for reference-graph construction: the metadata service
   * first, then the engine's own schema registry.
   *
   * The engine fallback matters for marketplace-installed packages: their
   * objects are registered through the `manifest` service straight into the
   * ObjectQL registry AFTER `bridgeObjectsToMetadataService` ran at boot, so
   * the metadata service has never heard of them. Resolving only via metadata
   * left the reference graph empty for those objects — every lookup /
   * master_detail seed value was written verbatim (the raw externalId string,
   * e.g. `crm_contact.crm_account = 'Acme Corporation'`) instead of the target
   * record's id. Dangling references break parent joins, and under
   * `sharingModel: controlled_by_parent` RLS that makes the whole object
   * invisible to everyone, admins included.
   */
  private async resolveObjectDefinition(objectName: string): Promise<any> {
    const fromMetadata = (await this.metadata.getObject(objectName)) as any;
    if (fromMetadata?.fields) return fromMetadata;
    try {
      const engineSchema = (this.engine as { getSchema?(name: string): unknown }).getSchema?.(objectName) as any;
      if (engineSchema?.fields) return engineSchema;
    } catch {
      // Engine may not expose a schema registry — the metadata result stands.
    }
    return fromMetadata;
  }

  /**
   * [#34613] Load a request built from STORED seeds: the loads that replay a
   * seed the author is not there to fix — the single-tenant boot seed, the
   * per-organization replay, the dev hot reload, a package install, upgrade
   * or sample-data reseed.
   *
   * `SeedMode` retired `insert` and `replace` (ruling 6942780880, ADR-0049):
   * neither matched a row, so every replay inserted each record again. A
   * package built or a seed stored before the retirement can still carry one,
   * and the request parse would refuse the WHOLE load over it. Here that
   * dataset alone is refused: it writes nothing, its prescription (the
   * `SeedMode` refusal, read from the schema, never restated) becomes one
   * error of the result with `success: false`, and every other dataset loads.
   * No log line of its own: the refusal is handed to the caller, which
   * reports a failed load's errors as it reports any other. (A compiled
   * artifact reaches here too: the artifact door parses the rest of the
   * artifact without such a dataset, see `@objectstack/metadata`'s
   * `artifact-retired-seed-modes.ts`; and `loadDataset` refuses the mode again
   * for a caller that skips this funnel.)
   *
   * The publish doors do not come here. A publish has its author present, so
   * it parses the request itself and refuses the whole publish with the same
   * prescription.
   *
   * Every other problem of the request is the parse's, as before: it throws.
   */
  async loadStored(request: {
    seeds: ReadonlyArray<unknown>;
    config?: SeedLoaderRequest['config'];
  }): Promise<SeedLoaderResultParsed> {
    const admitted: unknown[] = [];
    const refusals: ReferenceResolutionError[] = [];
    for (const seed of request.seeds) {
      const mode = (seed as { mode?: unknown } | null)?.mode;
      const verdict = typeof mode === 'string' && RETIRED_SEED_MODES.has(mode) ? SeedMode.safeParse(mode) : undefined;
      if (!verdict || verdict.success) {
        admitted.push(seed);
        continue;
      }
      const objectName = String((seed as { object?: unknown }).object ?? '(unnamed)');
      refusals.push({
        sourceObject: objectName,
        field: 'mode',
        targetObject: objectName,
        targetField: '(dataset)',
        attemptedValue: mode,
        // The mode is the dataset's, not a row's; no row was attempted.
        recordIndex: 0,
        message: `Seed dataset for '${objectName}' was not loaded: ${verdict.error.issues[0]?.message ?? `mode '${mode}' is retired`}`,
      });
    }
    if (refusals.length === 0) return this.load(SeedLoaderRequestSchema.parse({ config: {}, ...request }));
    // Every dataset refused: there is nothing to load (and the request schema
    // asks for at least one dataset), so the answer is the empty load, failed.
    const result = admitted.length === 0
      ? this.buildEmptyResult(SeedLoaderConfigSchema.parse(request.config ?? {}), 0)
      : await this.load(SeedLoaderRequestSchema.parse({ config: {}, ...request, seeds: admitted }));
    return { ...result, success: false, errors: [...refusals, ...result.errors] };
  }

  async validate(datasets: Seed[], config?: SeedLoaderConfig): Promise<SeedLoaderResultParsed> {
    const parsedConfig = SeedLoaderConfigSchema.parse({ ...config, dryRun: true });
    // `datasets` is the AUTHOR state (that is what `validate` takes); `load`
    // takes the parsed request, and `SeedLoaderSchema` fills the per-seed defaults
    // this cast stands in for. Parsing each dataset here would be a second
    // validation pass with its own failure mode — `load` already reports every
    // seed problem it finds, which is the whole point of `dryRun`.
    return this.load({ seeds: datasets, config: parsedConfig } as SeedLoaderRequestParsed);
  }

  // ==========================================================================
  // Internal: Seed Loading
  // ==========================================================================

  private async loadDataset(
    dataset: Seed,
    config: SeedLoaderConfigParsed,
    refMap: Map<string, ReferenceResolutionParsed[]>,
    insertedRecords: Map<string, Map<string, string>>,
    deferredUpdates: DeferredUpdate[],
    allErrors: ReferenceResolutionError[],
  ): Promise<SeedLoadResultParsed> {
    const objectName = dataset.object;
    const mode = dataset.mode || config.defaultMode;
    // [#34613] A mode outside the live `SeedMode` set refuses the dataset HERE,
    // whatever the caller parsed: `load()` and `validate()` take requests they
    // do not parse, and the retired `insert` / `replace` would otherwise fall to
    // the default arm below and insert every record again on each replay. The
    // refusal writes nothing, counts every record errored, and carries the
    // schema's own prescription. (No mode at all, a request built without the
    // parse's defaults, keeps its old path below.)
    const modeVerdict = mode === undefined ? undefined : SeedMode.safeParse(mode);
    if (modeVerdict && !modeVerdict.success) {
      const error: ReferenceResolutionError = {
        sourceObject: objectName,
        field: 'mode',
        targetObject: objectName,
        targetField: '(dataset)',
        attemptedValue: mode,
        // The mode is the dataset's, not a row's; no row was attempted.
        recordIndex: 0,
        message: `Seed dataset for '${objectName}' was not loaded: ${modeVerdict.error.issues[0]?.message ?? `mode '${String(mode)}' is not a seed mode`}`,
      };
      allErrors.push(error);
      this.logger.error(`[SeedLoader] ${error.message}`, undefined, { object: objectName, mode });
      return {
        object: objectName,
        mode,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errored: dataset.records.length,
        total: dataset.records.length,
        referencesResolved: 0,
        referencesDeferred: 0,
        referencesDropped: 0,
        summariesStale: 0,
        landedIds: [],
        insertedIds: [],
        errors: [error],
      };
    }
    const externalId = dataset.externalId || 'name';
    // [#25761] Left out of every write to a row this dataset MATCHED — see
    // `matchesExistingRow` in the record loop below.
    const createOnlyColumns = createOnlySeedColumns(dataset, externalId);

    // Read by `notePartialWrites` should this dataset throw part-way.
    const written = { inserted: 0, updated: 0 };
    if (this.loadProgress) this.loadProgress.loading = { object: objectName, written };
    let skipped = 0;
    let errored = 0;
    let referencesResolved = 0;
    let referencesDeferred = 0;
    /**
     * Reference FIELDS dropped from records that were still written — the
     * "wrote the row, lost the link" outcome. Kept apart from `errored` (which
     * counts dropped RECORDS) so `inserted + updated + skipped + errored`
     * still reconciles against `total`. See framework#3932.
     */
    let referencesDropped = 0;
    /**
     * Roll-up summaries this dataset leaves stale — sampled as a delta on the
     * per-load counter (see {@link SeedLoaderService.summariesStale}) rather
     * than tracked locally, because the write that discovers it is several
     * methods down. Datasets load sequentially, so the delta is exactly this
     * dataset's share even when two datasets target the same object.
     */
    const summariesStaleAtStart = this.summariesStale;
    const errors: ReferenceResolutionError[] = [];
    /**
     * [commit 1cba33f16] The early signal's state, for this dataset only.
     *
     * `requiredOnInsert` is what the write contract requires a value for on
     * insert (see {@link SeedLoaderService.requiredOnInsertByObject}); an
     * object whose definition never resolved has NO entry, and an absent entry
     * means "unknown", which stays silent. `earlySignalledFields` keeps the
     * warning to ONE line per dataset+field: a 500-row dataset deferring the
     * same column defers it for the same reason 500 times, and the author's
     * fix is the same single ordering change — repeating it per row is the
     * noise AGENTS.md → "Degradation log levels" says to say once, at the
     * first degradation.
     */
    const requiredOnInsert = this.requiredOnInsertByObject.get(objectName);
    const earlySignalledFields = new Set<string>();

    // Ensure the object's record map exists
    if (!insertedRecords.has(objectName)) {
      insertedRecords.set(objectName, new Map());
    }

    // Pre-load existing records for upsert matching. When a target
    // organization is set, scope the lookup so each tenant gets its
    // own copy (otherwise upsert would clobber other tenants' rows
    // that share the same natural key — e.g. `name: 'Acme Corp'`).
    let existingRecords: Map<string, any> | undefined;
    const keyedMode = mode === 'upsert' || mode === 'update' || mode === 'ignore';
    // [#34800] The externalId fields that are references. A row can land with
    // one of them still empty, and a replay finds that row by its id (see
    // `seedDeferredKeyRowId`), so the same read also indexes every row by id.
    const referenceKeyFields: ReadonlySet<string> = new Set(
      (refMap.get(objectName) ?? [])
        .map((ref) => ref.field)
        .filter((field) => (Array.isArray(externalId) ? externalId : [externalId]).includes(field)),
    );
    const existingRowsById = referenceKeyFields.size > 0 ? new Map<string, any>() : undefined;
    /** [#34800] Ids of rows a record of this dataset found by id (or will insert with), so no two claim one. */
    const claimedKeyRowIds = new Set<string>();
    if (keyedMode && !config.dryRun) {
      existingRecords = await this.loadExistingRecords(objectName, externalId, config.organizationId, existingRowsById);
    }
    // [#28952] A keyed dataset whose every record keys EMPTY — its
    // `externalId` names a field no record carries, most often a field the
    // object does not have — can never match a row. Each such record is
    // refused in the record loop below with the fix for both shapes (give the
    // record the value, or key the dataset on fields every record carries), the
    // way any record with a blank key field is (#34857); a dataset-level
    // notice on top would report the same records twice.

    // [#21665] Per-organization row identity. On a per-organization replay,
    // decide which id each row authored with an `id` holds in THIS
    // organization before anything is written: the authored id while no other
    // row holds it, else this organization's own derived id. Dry runs write
    // nothing and never probe the database, so they keep the authored ids.
    const replayIds = config.organizationId && !config.dryRun
      ? await this.assignReplayRowIds(objectName, dataset.records, config.organizationId)
      : undefined;
    /** Record index → the authored id that row was re-identified FROM. */
    const authoredIdByRecordIndex = new Map<number, string>();
    if (replayIds) {
      const reidentified = [...replayIds].filter(([authored, assigned]) => authored !== assigned).length;
      if (reidentified > 0) {
        this.logger.info(
          `[SeedLoader] ${reidentified} ${objectName} seed row(s) carry an authored id a row outside organization ` +
            `${config.organizationId} already holds; this organization gets ids of its own for them, and references ` +
            `in this replay that name the authored ids follow them.`,
          { object: objectName, organizationId: config.organizationId, reidentified },
        );
      }
    }

    // [#31021] The record of landed seed rows, for the datasets that insert a
    // keyed row they do not find (`upsert`, `ignore`): the modes the
    // create-only rule reaches. `update` never inserts. (The unkeyed
    // `insert` / `replace` modes are retired, #34613.)
    const recordedKeys = this.landedKeyLedger && (mode === 'upsert' || mode === 'ignore')
      ? await this.landedKeysOf(objectName)
      : undefined;
    const keyFields: ReadonlySet<string> = new Set(Array.isArray(externalId) ? externalId : [externalId]);
    /** [#31021] Record index → the key its row is recorded under once it lands. */
    const landedKeyByRecordIndex = new Map<number, string>();
    /**
     * [#31021] The key row `recordIndex` is recorded under: its authored id,
     * not the id a per-organization replay gave it (#21665), so an `id`-keyed
     * row reads the same in every organization and on every replay, whichever
     * id the replay assigns it this time.
     */
    const landedKeyOf = (rec: Record<string, unknown>, recordIndex: number): string => {
      const authored = authoredIdByRecordIndex.get(recordIndex);
      return seedLandedKey(authored === undefined ? rec : { ...rec, id: authored }, externalId);
    };

    // Get reference resolutions for this object
    const objectRefs = refMap.get(objectName) || [];

    // Self-referencing objects (e.g. `employee.manager_id -> employee`) can
    // have record i reference record j<i from the SAME dataset by natural
    // key; that only resolves via `insertedRecords` once record j has
    // actually been written (see the reference-resolution loop below). Batch
    // writes defer the write past the point the record was resolved, which
    // would break that same-batch ordering — so self-referencing datasets
    // keep the historical strictly-sequential per-record write path
    // (`writeRecord`, unchanged) and opt out of batching entirely. Every
    // other dataset (the overwhelming majority — contact/lead/opportunity/…
    // reference OTHER objects, already fully loaded via topological order)
    // gets the batched path below. See framework#2678.
    const hasSelfRef = objectRefs.some(ref => ref.targetObject === objectName);

    // Records resolved as inserts (an unmatched upsert/ignore) are buffered here and flushed in batches through the
    // engine's array-form insert() — one round-trip per batch instead of one
    // per record, with transient-error retry and per-row degradation on a
    // logical/validation failure. See framework#2678.
    const pendingInserts: Array<{ recordIndex: number; externalIdValue: string; record: Record<string, unknown> }> = [];
    // [#33206] The options the buffered rows are written with. A batch holds
    // rows of ONE write organization: a row whose own organization differs
    // flushes the batch before it joins (see `writeOptionsFor`).
    let batchOpts: any = this.seedOptions;
    // [#33206] The organization each row was written as, for its pass-2 back-fill.
    const rowOrganizationByRecordIndex = new Map<number, unknown>();
    // [commit 9a884c6e4] Internal ids captured at write time, keyed by record index.
    // Every write site below records the id it learned here — unconditionally,
    // unlike the `insertedRecords` registrations, which need a non-empty
    // natural key. Once the dataset has fully written, the deferred updates it
    // pushed are annotated from this map (see the loop after the final flush),
    // so pass 2 back-fills BY INTERNAL ID and a row whose key evaluates empty
    // heals exactly like a keyed one (the keyless `insert` mode this was first
    // written for is retired, #34613). Before this,
    // pass 2 re-resolved the source row through its externalId and a keyless
    // deferral was structurally unreachable: it resolved the target, then
    // dropped the link ("empty externalId, so no internal id").
    const deferredStart = deferredUpdates.length;
    const internalIdByRecordIndex = new Map<number, string>();
    /**
     * [#30348] The record indexes whose row THIS load created — the insert
     * sites mark them beside {@link noteLanded}; every other landed index is a
     * pre-existing row a record's key matched. Published as `insertedIds`.
     */
    const insertedRecordIndexes = new Set<number>();
    /**
     * Record the id row `recordIndex` landed with. Every write site below goes
     * through here, so a re-identified row (#21665) enters
     * {@link SeedLoaderService.replayIdByAuthoredId} exactly when it lands and
     * never before: a later row of this dataset, a later dataset and pass 2
     * then resolve its authored id to the row that is really there.
     */
    const noteLanded = (recordIndex: number, landedId: string): void => {
      internalIdByRecordIndex.set(recordIndex, landedId); // [commit 9a884c6e4]
      const authored = authoredIdByRecordIndex.get(recordIndex);
      if (authored === undefined) return;
      let byAuthored = this.replayIdByAuthoredId.get(objectName);
      if (!byAuthored) {
        byAuthored = new Map();
        this.replayIdByAuthoredId.set(objectName, byAuthored);
      }
      byAuthored.set(authored, landedId);
    };
    const extIdOf = (rec: Record<string, unknown>) => this.externalIdKey(rec, externalId);
    // bulkWrite is at-least-once: a retry (or a mismatch-driven degradation)
    // may re-run a write whose prior attempt already committed. Guard against
    // duplicate seed rows by rechecking natural keys before re-inserting
    // (framework#3149). `lastBatchUncertain` carries the "prior batch outcome
    // unknown" signal into the per-row degradation writeOne calls.
    let lastBatchUncertain = false;
    const isUncertainOutcome = (e: unknown) =>
      defaultIsTransientError(e) || (e as { code?: unknown } | null)?.code === 'ERR_BULK_RESULT_MISMATCH';
    // Partial-success entry (framework#3172): when the engine offers
    // insertMany, a row that fails validation is a final per-row verdict from
    // ONE batch call — bulkWrite never degrades, so beforeInsert hooks run
    // exactly once per row. Feature-detected so a legacy engine (tests, other
    // IDataEngine impls) falls back to the whole-array insert + degradation.
    const engineInsertMany: ((o: string, rows: any[], op: any) => Promise<Array<{ ok: boolean; record?: any; error?: unknown }>>) | undefined =
      typeof (this.engine as any).insertMany === 'function'
        ? (o, rows, op) => (this.engine as any).insertMany(o, rows, op)
        : undefined;
    const flushPendingInserts = async (): Promise<void> => {
      if (pendingInserts.length === 0) return;
      const batch = pendingInserts.splice(0, pendingInserts.length);
      const opts = batchOpts;
      const writeResults: BulkWriteRowResult[] = await bulkWrite(
        batch.map(b => b.record),
        {
          batchSize: insertBatchSize,
          writeBatchPartial: async (rows, { attempt }) => {
            let toInsert = rows;
            let existing = new Map<string, any>();
            if (attempt > 1) {
              // Prior attempt may have committed before its response was lost:
              // insert only rows not already present so a retry can't duplicate.
              existing = await this.loadExistingRecords(objectName, externalId, config.organizationId);
              toInsert = rows.filter((r) => { const k = extIdOf(r); return !(k && existing.has(k)); });
            }
            try {
              let freshOutcomes: Array<{ ok: boolean; record?: any; error?: unknown }>;
              if (toInsert.length === 0) {
                freshOutcomes = [];
              } else if (engineInsertMany) {
                // Partial-success batch: per-row verdicts, hooks fire once.
                // On ERR_SUMMARY_RECOMPUTE, writeRecoveringSummary hands back
                // e.written — which for insertMany IS the outcome array.
                freshOutcomes = await this.writeRecoveringSummary(objectName, () => engineInsertMany(objectName, toInsert, opts));
              } else {
                // Legacy whole-array insert: any bad row throws the batch, and
                // bulkWrite's per-row degradation (writeOne) sorts it out. A
                // lone row keeps the historical bare-record insert() shape.
                const recs = toInsert.length === 1
                  ? [await this.writeRecoveringSummary(objectName, () => this.engine.insert(objectName, toInsert[0], opts))]
                  : await this.writeRecoveringSummary(objectName, () => this.engine.insert(objectName, toInsert, opts));
                freshOutcomes = (recs as any[]).map((r) => ({ ok: true, record: r }));
              }
              lastBatchUncertain = false;
              // Reassemble one outcome per input row in order: recheck hits use
              // the existing record; the rest consume freshOutcomes in order.
              let k = 0;
              return rows.map((r) => {
                const key = extIdOf(r);
                if (key && existing.has(key)) return { ok: true, record: existing.get(key) };
                return freshOutcomes[k++];
              });
            } catch (e) {
              lastBatchUncertain = isUncertainOutcome(e);
              throw e;
            }
          },
          writeBatch: async () => {
            // Unreachable — writeBatchPartial above takes precedence — but the
            // BulkWriteOptions contract requires it.
            throw new Error('seed-loader uses writeBatchPartial');
          },
          writeOne: async (row, { attempt }) => {
            if (attempt > 1 || lastBatchUncertain) {
              const key = extIdOf(row);
              if (key) {
                const existing = await this.loadExistingRecords(objectName, externalId, config.organizationId);
                const hit = existing.get(key);
                if (hit) return hit; // already committed by a prior attempt
              }
            }
            return this.writeRecoveringSummary(objectName, () => this.engine.insert(objectName, row, opts));
          },
        },
      );
      for (const res of writeResults) {
        const { recordIndex, externalIdValue, record } = batch[res.index];
        if (res.ok) {
          written.inserted++;
          const internalId = this.extractId(res.record);
          if (internalId) noteLanded(recordIndex, internalId); // [commit 9a884c6e4]
          if (internalId) insertedRecordIndexes.add(recordIndex); // [#30348]
          if (externalIdValue && internalId) {
            insertedRecords.get(objectName)!.set(externalIdValue, internalId);
          }
          await settleSeedFiles(recordIndex, internalId); // [#25779]
        } else {
          errored++;
          const error = this.buildWriteError(objectName, record, externalId, recordIndex, res.error);
          errors.push(error);
          allErrors.push(error);
          // `error`, not `warn` (#4729 / #4632): this row is counted in
          // `allErrors` — the load already reports `success: false` — and the
          // consequence is that the record did NOT land. Count and log level
          // must agree; the message names the row and the cause — [#8442] the
          // cause EXPLICITLY, since the payload half may now withhold it.
          this.logger.error(
            seedFailureLogLine(error.message, res.error),
            res.error instanceof Error ? res.error : undefined,
            { recordIndex },
          );
        }
      }
    };

    // [ADR-0131 D3 / D9] Does a row of this object carry an organization at
    // all? Read once per dataset, from the object definition the loader
    // resolves every dataset through. Since the namespace exemption is gone,
    // this is the ONLY thing that keeps the stamp off an object with no
    // `organization_id` column — `tenancy: { enabled: false }` (ADR-0066), or a
    // platform object whose injected column was dropped (ADR-0131 D7) — where
    // the engine refuses the stamped row as an unknown field and the seed row
    // is lost. A definition the loader cannot resolve keeps the stamp (the
    // behaviour before this read existed): the column is then the engine's to
    // judge, and nothing here refuses a row for an owner it cannot prove.
    const objectDefinition = await this.resolveObjectDefinition(objectName);
    const rowsCarryOrganization = objectDefinition == null || seedRowNeedsOrganization(objectDefinition);
    // The column a row of this dataset holds its organization in: the one the
    // stamp below writes, a refusal names, and a row's own organization is
    // read from (`seedRowTenantColumn`). A declared `tenancy.tenantField` is
    // that column for an object walled by it; an unresolved definition keeps
    // `organization_id`, as it keeps the stamp.
    const organizationColumn = seedRowTenantColumn(objectDefinition) ?? DEFAULT_TENANT_FIELD;
    this.warnOnUndeclaredSeedColumns(dataset, objectDefinition);
    // [#35655] The roll-up columns a seed never writes (`summaryFieldNames`),
    // the values this dataset's records supplied for them, and which of them
    // did — reported once, after the record loop.
    const summaryFields = summaryFieldNames(objectDefinition);
    let summaryValuesDropped = 0;
    const summaryFieldsDropped = new Set<string>();
    // How a replay compares each field (`isNoOpReplay`): [#24562] a temporal
    // field in its stored form, [#24624] a field the read path masks never by
    // its set value, [#29277] a seed blank the write door stores as `null` as
    // that `null`.
    const comparands: ReplayComparands = {
      temporal: temporalFieldKinds(objectDefinition),
      masked: maskedOnReadFields(objectDefinition),
      blankAsNull: blankAsNullColumns(objectDefinition),
    };
    // [#25779] The dataset's file fields: seed files stored and kept, and an
    // id-shaped file value that names no file refused (`seed-files.ts`).
    // `null` for an object with no file-class field — the common case.
    const datasetFiles = await SeedDatasetFiles.open({
      dataset,
      objectDefinition,
      service: this.getFieldFiles() ?? null,
      existingRecords,
      organizationId: config.organizationId ?? this.fallbackOrgId ?? null,
      dryRun: config.dryRun === true,
    });
    /**
     * [#26670] Rows per buffered-insert batch. A row holding seed files costs
     * its insert the file-reference hooks, about 7 ms a row on sqlite against
     * well under 1 ms for a plain row, and one `insertMany` is one unbroken
     * run on a synchronous driver: 200 such rows held the event loop for about
     * 1.5 s, and a sign-in waited behind it. A dataset that carries seed files
     * is written in small batches instead, so a request waits behind a few
     * rows; every other dataset keeps the full batch.
     */
    const insertBatchSize = datasetFiles?.carriesFiles
      ? SeedLoaderService.SEED_FILE_BATCH_SIZE
      : SeedLoaderService.BULK_BATCH_SIZE;
    /** Record index → the files that row's slots must own once it lands. */
    const fileClaimsByRecordIndex = new Map<number, { claims: SeedFileClaims; organizationId: string | null }>();
    /**
     * [#25779] Make row `recordIndex`, landed as `recordId`, the owner of the
     * seed files it holds. Every write site below calls it once the row is
     * there — an insert, an update, a skipped replay — and a skipped replay
     * whose files are already its own costs a cached read.
     */
    const settleSeedFiles = async (recordIndex: number, recordId: string | undefined): Promise<void> => {
      const pending = fileClaimsByRecordIndex.get(recordIndex);
      if (!datasetFiles || !pending || !recordId) return;
      const failure = await datasetFiles.settleRow(recordId, pending.claims, pending.organizationId);
      if (failure === null) return;
      const error: ReferenceResolutionError = {
        sourceObject: objectName,
        field: pending.claims.map((c) => c.field).join(', '),
        targetObject: 'sys_file',
        targetField: 'id',
        attemptedValue: pending.claims.flatMap((c) => c.fileIds),
        recordIndex,
        message: failure,
      };
      errors.push(error);
      allErrors.push(error);
      // `error`: counted in `allErrors`, and the row looks seeded while the
      // file its field names is on its way to being reclaimed.
      this.logger.error(`[SeedLoader] ${failure}`, undefined, { object: objectName, recordIndex });
    };
    // [ADR-0131 D9] With no organization pinned and none derivable on an install
    // that registers the organization object, a row of an organization-owned
    // object has no owner: it is REFUSED below, never written NULL.
    const refuseUnownedRows =
      config.organizationId == null &&
      this.fallbackOrgId === undefined &&
      this.unownedOrganizationCount !== undefined &&
      seedRowNeedsOrganization(objectDefinition);
    let unownedRefusalLogged = false;
    /** [#34857] The blank-key refusal is logged once per dataset (every refused record is still reported). */
    let blankKeyRefusalLogged = false;

    // Pin a single `now()` snapshot for the entire dataset so multi-pass
    // loads see one logical clock — the M9 determinism guarantee for seeds.
    const seedNow = new Date();

    // Identity/context bound to seed CEL expressions. `os.user` / `os.org`
    // resolve from here, so `owner_id: cel\`os.user.id\`` works.
    //
    // When no real user identity is supplied (the normal case — seeds run
    // before the first human sign-up), `os.user` is bound to a NULL identity
    // (`{ id: null }`) rather than left undefined. This makes `os.user.id`
    // resolve to `null` instead of crashing the expression, so a seed's
    // `owner_id: cel\`os.user.id\`` simply lands NULL — semantically "owned by
    // whoever becomes the first admin", which the first-admin handoff
    // (`claimSeedOwnership`) then fills in. The platform therefore never has to
    // mint a placeholder `usr_system` row just to satisfy this expression.
    const seedIdentity = config.identity;
    const baseEvalCtx = {
      now: seedNow,
      // `id: null` is a legitimate seed-time state (the owning admin does not
      // exist yet) that the formula EvalContext's `user.id: string` type does
      // not yet model — cast the fallback so `os.user.id` evaluates to null.
      user: seedIdentity?.user ?? ({ id: null } as unknown as NonNullable<typeof seedIdentity>['user']),
      // Fall back to the per-tenant organizationId so `os.org.id` resolves
      // during per-org replay even without an explicit identity.org.
      org: seedIdentity?.org ?? (config.organizationId ? { id: config.organizationId } : undefined),
      env: config.env,
    };

    for (let i = 0; i < dataset.records.length; i++) {
      // Resolve any embedded Expression envelopes (e.g. `cel\`daysFromNow(30)\``,
      // `cel\`os.user.id\``) BEFORE reference resolution so downstream lookups
      // see resolved values.
      const seedResult = resolveSeedRecord(
        dataset.records[i] as Record<string, never>,
        baseEvalCtx,
      );
      if (!seedResult.ok) {
        // LOUD FAILURE: a record whose dynamic values cannot be resolved is
        // dropped — but never silently. Record an actionable error (so it
        // surfaces in result.errors and flips success=false) instead of
        // writing the unresolved Expression envelope into the database.
        errored++;
        const error: ReferenceResolutionError = {
          sourceObject: objectName,
          field: '(expression)',
          targetObject: objectName,
          targetField: '(expression)',
          attemptedValue: dataset.records[i],
          recordIndex: i,
          message:
            `Cannot resolve dynamic seed values for ${objectName} record #${i}: ${seedResult.error.message}. ` +
            '`os.user.id` resolves to null at seed time (the owning admin does not exist yet) and ' +
            'owner-style fields are assigned by the first-admin handoff — so a required, non-owner ' +
            'field must not depend on it. Provide a literal value or make the field optional.',
        };
        errors.push(error);
        allErrors.push(error);
        // `error`, not `warn` (#4729 / #4632): counted in `allErrors` and the
        // record is dropped — nothing of it is persisted.
        this.logger.error(`[SeedLoader] ${error.message}`, undefined, { recordIndex: i });
        continue;
      }
      const record = { ...(seedResult.value as Record<string, unknown>) };
      // [#35655] A seed never stores a roll-up (ruling D, record 7063117450).
      // Taken out here, before anything reads the record, so every path below
      // sees it gone: the no-op replay compare (a stored total that differs
      // from the seed's is no difference to undo), the insert (the engine
      // starts the column at its empty-child-list value and the child rows
      // compute it) and the update (the row keeps the value it holds).
      for (const field of summaryFields) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
        if (record[field] !== undefined) {
          summaryValuesDropped++;
          summaryFieldsDropped.add(field);
        }
        delete record[field];
      }
      // [#22301] The stored form, not a `Date`, before any hook can see it.
      seedValuesInStoredForm(record, objectDefinition);
      /**
       * [commit 1cba33f16] Deferrals this row took on a column the write contract
       * requires on insert. Collected during resolution, reported once the
       * write ACTION for this row is known (below) — the deferral itself is
       * harmless on an update, where the deleted column is simply an omitted
       * field the contract never checks.
       */
      const requiredDeferrals: Array<{ field: string; targetObject: string; attemptedValue: unknown }> = [];

      // Per-tenant tagging: stamp every seeded row of an object that carries an
      // organization with the target org — the caller's explicit
      // `config.organizationId`, or (when none was pinned) the install's sole
      // organization. [ADR-0131 D3] `sys_` / `cloud_` / `ai_` seeds take it
      // too: their exemption ("intentionally global") is withdrawn, since no
      // platform-global seeds remain. The stamp lands in `organizationColumn`:
      // `organization_id`, or the declared `tenancy.tenantField` of an object
      // walled by another column, which the wall reads as the organization
      // the same way. A record that supplies its own value there always wins.
      // An object with no organization column gets no stamp
      // (`rowsCarryOrganization` above): the engine refuses an undeclared
      // field, so a stamp there would drop the row.
      const tenantOrg = rowsCarryOrganization ? (config.organizationId ?? this.fallbackOrgId) : undefined;
      if (refuseUnownedRows && tenantOrg === undefined && record[organizationColumn] == null) {
        // [ADR-0131 D9] No owner to stamp — refuse the row, loudly, by name.
        errored++;
        const count = this.unownedOrganizationCount ?? 0;
        const error: ReferenceResolutionError = {
          sourceObject: objectName,
          field: organizationColumn,
          targetObject: 'sys_organization',
          targetField: 'id',
          attemptedValue: null,
          recordIndex: i,
          message:
            `Seed record #${i} of '${objectName}' was REFUSED: '${objectName}' carries its organization in ` +
            `${organizationColumn}, this seed load names no organization (config.organizationId) and none can be derived — ` +
            `the install holds ${count === 0 ? 'no organization at all' : 'several organizations'}. Every seed ` +
            `row of an organization-owned object is stamped with its organization or refused; writing it would ` +
            `store a row no organization owns. Fix it by setting ${organizationColumn} on the record — a seed ` +
            `published through a package carries no caller organization (ADR-0131 D12), so the record is ` +
            `where its owner is named; a direct SeedLoader caller may instead pass config.organizationId. ` +
            `Under the 'single' tenancy ` +
            `posture the Default Organization is created at boot, before seeds load, so a single-tenant ` +
            `deployment that reaches this has lost that organization.`,
        };
        errors.push(error);
        allErrors.push(error);
        // `error`, not `warn` (#4632): the record is dropped. Said once per
        // dataset; every refused row is still counted in `allErrors`.
        if (!unownedRefusalLogged) {
          unownedRefusalLogged = true;
          this.logger.error(`[SeedLoader] ${error.message}`, undefined, { object: objectName, recordIndex: i });
        }
        continue;
      }
      // Remember that WE wrote this value, so the reference pass below leaves it
      // alone. `tenantOrg` is an ID by construction — the caller's target org,
      // or a resolved `sys_organization.id` — never a natural key. But
      // `organization_id` is declared as a lookup → `sys_organization`, so the
      // pass would treat the id as a natural key, probe `sys_organization.name`
      // for it, miss, and DROP the column: the row lands org-less and is then
      // invisible to every member behind the tenant wall.
      //
      // Skipping the pass is still the rule, not a fallback onto the probe:
      // the stamp is an id this loader wrote, never a natural key an author
      // spelled, so it is not a reference for the pass to judge at all. (Under
      // per-tenant replay the probe answers `sys_organization` only for the
      // load's own organization, #33207 — `probeScopeOf`.)
      //
      // Only better-auth-shaped ids (`org_msbubm8g3j35rgx0`) actually hit this:
      // `looksLikeInternalId` recognises UUID/ObjectId and short-circuits those.
      // Every organization better-auth creates — including the default org
      // `ensureDefaultOrganization` bootstraps — carries the `org_` shape, so in
      // a real multi-org deployment EVERY replayed row landed org-less, while
      // fixtures that mint UUID org ids passed. That asymmetry is why this
      // survived: see `apps/ee-tenant-crm-showcase` in the cloud repo, which
      // reproduces it end-to-end.
      let stampedTenantOrg = false;
      if (tenantOrg && record[organizationColumn] == null) {
        record[organizationColumn] = tenantOrg;
        stampedTenantOrg = true;
      }

      // [#21665] Give the row the id it holds in THIS organization (decided
      // above, before the loop). Written onto the record before the write
      // decision, so a dataset keyed on `id` looks its own row up under that
      // id: the next replay into this organization finds and skips it.
      const authoredId = typeof record['id'] === 'string' ? (record['id'] as string) : undefined;
      const replayId = authoredId !== undefined ? replayIds?.get(authoredId) : undefined;
      if (authoredId !== undefined && replayId !== undefined && replayId !== authoredId) {
        record['id'] = replayId;
        authoredIdByRecordIndex.set(i, authoredId);
      }

      // [#34857, #35336] A keyed record that leaves a key field blank — an
      // empty string, null or no value; any component of a composite key, or
      // the one field of a single-field key (`name` when the dataset names
      // none) — keys `''`, so it matches no row this load or any earlier one
      // wrote: it was inserted again on every load (never found, on `update`),
      // and nothing said so. It is REFUSED here, on the key as authored: after
      // its expressions resolved and its organization was stamped, BEFORE any
      // reference resolves. A reference deferred to pass 2 still holds its
      // authored value at this point, so it is never caught here. The blank
      // rule is {@link seedLandedKey}'s and `externalIdKey`'s (no trim).
      if (keyedMode) {
        const blankKeyFields = [...keyFields].filter((field) => isBlankSeedKeyValue(record[field]));
        if (blankKeyFields.length > 0) {
          errored++;
          const error = blankSeedKeyRefusal(objectName, i, externalId, blankKeyFields, mode);
          errors.push(error);
          allErrors.push(error);
          // `error` (#4632): the record is dropped. Said once per dataset — the
          // fix is the same for every such record — and every refused record
          // is still reported in the result. A dry run reports it like any
          // other refusal it finds.
          if (!config.dryRun && !blankKeyRefusalLogged) {
            blankKeyRefusalLogged = true;
            this.logger.error(`[SeedLoader] ${error.message}`, undefined, {
              object: objectName, recordIndex: i, fields: blankKeyFields,
            });
          }
          continue;
        }
      }

      // [#34800] The key as AUTHORED, before any of its references resolves:
      // the identity of a row that lands while one of them is still empty.
      // `''` when the dataset keys on no reference, or — outside the keyed
      // modes, which refuse such a record above — when the record leaves a
      // key field blank as written; such a record matches by natural key alone.
      const authoredKey = existingRowsById ? seedLandedKey(record, externalId) : '';
      const authoredKeyValues = authoredKey === ''
        ? undefined
        : new Map([...referenceKeyFields].map((field) => [field, record[field]] as const));
      /**
       * [#34856] The key the record of landed rows keeps this row under when a
       * reference in its key is empty on the load that lands it: the id the
       * row lands with ({@link seedDeferredKeyRowId} over the AUTHORED key),
       * spelled as an `id` key. The key as stored cannot serve — it has an
       * empty component then, and once the reference resolves it names an id
       * the landing load never knew — so a person's delete of such a row was
       * recorded under nothing and undone by the next load. This one is the
       * same while the reference stays empty and after it resolves. Read off
       * the record before any reference resolves; `''` exactly when
       * `authoredKey` is.
       */
      const deferredLandedKey = authoredKey === ''
        ? ''
        : seedLandedKey(
          { id: seedDeferredKeyRowId(objectName, String(record[organizationColumn] ?? ''), authoredKey) }, 'id',
        );
      /** [#34800] Key fields whose reference this record defers to pass 2. */
      const deferredKeyFields = new Set<string>();

      // Resolve references
      let unresolvedRefError = false;

      // [#11339] Derive this RECORD's pointer-pair references (ADR-0052 §5
      // ActivityPointer — `record_id` resolving through the object the sibling
      // `object_name` column names). Unlike a lookup's static target, the
      // target object is a per-row fact, so each authored row derives its own
      // reference entry and then flows through the SAME resolution loop below
      // — same insertedRecords/DB probes, same invalid/deferred/unresolved
      // branches, same counters — one contract for every reference kind.
      const pointerPairs = this.pointerRefsByObject.get(objectName) ?? [];
      const derivedPointerRefs: Array<{ field: string; targetObject: string; targetField: string }> = [];
      for (const pair of pointerPairs) {
        const pointerValue = record[pair.field];
        // Empty pointer = no pointer: nothing to resolve, nothing to refuse.
        // "Empty" is the engine's own blank rule (`isMissing`), the one every
        // reference below is skipped by.
        if (isMissing(pointerValue)) continue;
        const targetName = record[pair.objectField];
        if (typeof targetName !== 'string' || targetName === '') {
          // UN-ADDRESSABLE: the id half is authored but the type half names no
          // object, so no pass — now or later — can ever resolve it. Refuse
          // the record rather than store a pointer that attaches to nothing
          // (the exact silent failure #11339 measured). Same three registers
          // as the final unresolvable branch below: counted, reported, logged.
          const error: ReferenceResolutionError = {
            sourceObject: objectName,
            field: pair.field,
            targetObject: `(missing ${pair.objectField})`,
            targetField: '(pointer pair)',
            attemptedValue: pointerValue,
            recordIndex: i,
            message:
              `Pointer ${objectName}.${pair.field} = '${String(pointerValue)}' cannot be addressed: its pair ` +
              `field \`${pair.objectField}\` is empty on record #${i}, so there is no object to resolve the id ` +
              `against. Author \`${pair.objectField}\` with the target object's machine name, or drop the ` +
              `\`${pair.field}\` value.`,
          };
          errors.push(error);
          allErrors.push(error);
          // Dry-run stays QUIET beyond the report, like the unresolved branch
          // below (#4997): nothing was written, the caller reads the result.
          if (!config.dryRun) {
            this.logger.error(
              `[SeedLoader] ${error.message} ${objectName} record #${i} was NOT seeded — a row whose pointer ` +
                `names no object would render on no timeline and match no console filter.`,
              undefined,
              { object: objectName, field: pair.field, recordIndex: i },
            );
            unresolvedRefError = true;
          }
          continue;
        }
        // The pair's targetField follows the same rule buildReferenceMap
        // applies to static references: the target DATASET's declared
        // externalId when this load carries one (single-field only), else the
        // historical 'name' default — resolved here because only the row
        // knows which object it points at.
        const declaredExternalId = this.seedExternalIdByObject.get(targetName);
        derivedPointerRefs.push({
          field: pair.field,
          targetObject: targetName,
          targetField: typeof declaredExternalId === 'string' ? declaredExternalId : DEFAULT_EXTERNAL_ID_FIELD,
        });
      }

      /**
       * [#34800] The row this record landed on while a reference in its key
       * was still empty, found by id when its natural key cannot find it:
       * the row's own key column is NULL, so the key misses whether the
       * reference is still deferred (the record keys `''`) or resolves now
       * (the record carries an id the row does not). An exact natural-key
       * match always wins. The id is the record's own `id` when it carries
       * one, else {@link seedDeferredKeyRowId}; a row found by it is taken
       * only when its other key columns still equal the record's and each
       * reference column it holds is empty or the very value the record
       * resolved, and only by one record of the load. A row a person created
       * carries neither id, so it is never taken.
       *
       * Asked once the key is final — after the key's references resolved —
       * and answered once per record.
       */
      let deferredKeyRow: { row: any } | null | undefined;
      const rowLandedWithEmptyKeyReference = (): any | undefined => {
        if (deferredKeyRow !== undefined) return deferredKeyRow?.row;
        deferredKeyRow = null;
        if (!existingRowsById || authoredKey === '') return undefined;
        const key = this.externalIdKey(record, externalId);
        if (key !== '' && existingRecords?.has(key)) return undefined;
        const ownId = record['id'];
        const rowId = typeof ownId === 'string' && ownId !== ''
          ? ownId
          : seedDeferredKeyRowId(objectName, String(record[organizationColumn] ?? ''), authoredKey);
        const row = existingRowsById.get(rowId);
        if (row === undefined || claimedKeyRowIds.has(rowId)) return undefined;
        for (const field of keyFields) {
          if (deferredKeyFields.has(field)) continue;
          if (referenceKeyFields.has(field) && isMissing(row[field])) continue;
          if (String(row[field] ?? '') !== String(record[field] ?? '')) return undefined;
        }
        claimedKeyRowIds.add(rowId);
        deferredKeyRow = { row };
        return row;
      };
      /**
       * [#34800] The existing rows this record's write decision reads: the
       * dataset's, or — when the record landed on a row its natural key
       * cannot find — that one row, under the key the record has.
       */
      const existingRowsFor = (): Map<string, any> | undefined => {
        const row = rowLandedWithEmptyKeyReference();
        return row === undefined ? existingRecords : new Map([[this.externalIdKey(record, externalId), row]]);
      };

      /**
       * [#25761] Is this row one the load MATCHED — an existing row this
       * dataset writes over? The create-only policy is the only thing that
       * asks. The same lookup {@link SeedLoaderService.decideWriteAction}
       * makes: the record's natural key, as resolved so far, against the rows
       * pre-loaded for the modes that match one (`upsert`, `update`,
       * `ignore`). A dry run pre-loads nothing, so every row it sees is one
       * it creates.
       */
      const matchesExistingRow = (): boolean =>
        existingRowsFor()?.has(this.externalIdKey(record, externalId)) === true;

      const allRecordRefs: Array<
        Pick<ReferenceResolutionParsed, 'field' | 'targetObject' | 'targetField'> & { multiple?: boolean }
      > = derivedPointerRefs.length === 0 ? objectRefs : [...objectRefs, ...derivedPointerRefs];
      // [#25761] Create-only references resolve LAST, so a reference column of
      // the externalId has been resolved by the time one asks
      // `matchesExistingRow`. Every other dataset keeps its order.
      const orderedRefs = createOnlyColumns.size === 0
        ? allRecordRefs
        : [
          ...allRecordRefs.filter((ref) => !createOnlyColumns.has(ref.field)),
          ...allRecordRefs.filter((ref) => createOnlyColumns.has(ref.field)),
        ];
      // [#31021] With a record of landed rows to consult, the externalId's own
      // references resolve FIRST: whether this is a row a person removed is a
      // question about its key, asked before any other reference resolves for
      // a row the load may not write at all — and a key reference naming a
      // removed row withdraws the row before anything else of it is resolved
      // or deferred. A load keeping no record keeps its order. (A create-only
      // column is never a key field, so the create-only references stay behind
      // the key's.)
      const recordRefs = this.landedKeyLedger === undefined
        ? orderedRefs
        : [
          ...orderedRefs.filter((ref) => keyFields.has(ref.field)),
          ...orderedRefs.filter((ref) => !keyFields.has(ref.field)),
        ];
      /**
       * [#31021] Is this the row of a key recorded as landed here whose row is
       * now gone? A row the load cannot find is inserted only when its key
       * never landed in this organization; once it has, its absence is a
       * person's removal, which a replay must not undo.
       */
      const isWithdrawnRow = (): boolean => {
        if (!recordedKeys || !this.landedKeyLedger?.honour) return false;
        const key = this.externalIdKey(record, externalId);
        if (key !== '' && existingRecords?.has(key)) return false;
        // [#34800] Found by id: the row is there, under a key column still empty.
        if (rowLandedWithEmptyKeyReference() !== undefined) return false;
        if (key !== '' && recordedKeys.has(landedKeyOf(record, i))) return true;
        // [#34856] Landed while a reference in its key was empty: recorded
        // under the id it landed with, whether the reference is still empty
        // (the record keys `''`) or resolves now.
        return deferredLandedKey !== '' && recordedKeys.has(deferredLandedKey);
      };
      let withdrawnRow = false;
      let withdrawnAsked = recordedKeys === undefined;
      const referencesResolvedBeforeRow = referencesResolved;
      const referencesDeferredBeforeRow = referencesDeferred; // [#34856]
      const deferredUpdatesBeforeRow = deferredUpdates.length; // [#34856]
      for (const ref of recordRefs) {
        // [#31021] Asked once, the moment the key is final: before the first
        // reference that is not part of it.
        if (!withdrawnAsked && !keyFields.has(ref.field)) {
          withdrawnAsked = true;
          if (!unresolvedRefError && isWithdrawnRow()) {
            withdrawnRow = true;
            break;
          }
        }
        // Never re-resolve the tenant stamp we just wrote (see above). A seed
        // that authors `organization_id` ITSELF still goes through resolution,
        // so naming an org by its natural key keeps working.
        if (stampedTenantOrg && ref.field === organizationColumn) continue;
        // [#25761] A create-only reference on a row the load matched is no
        // part of that row's write: not resolved, not dropped for failing to
        // resolve, and not deferred — pass 2's back-fill would write it after
        // all, the one place the policy could leak.
        if (createOnlyColumns.has(ref.field) && matchesExistingRow()) {
          delete record[ref.field];
          continue;
        }
        const fieldValue = record[ref.field];
        // A blank reference is NO reference: the engine's blank rule
        // (`isMissing` — `undefined`, `null`, `''`, whitespace-only) is the one
        // the insert door stores as empty and the required check refuses by,
        // so the value is left as written for those two. Resolving `''` as a
        // natural key could only miss, and reported "Deferred reference
        // unresolved" for a row that landed with the field empty.
        if (isMissing(fieldValue)) continue;

        const pushError = (message: string, attemptedValue: unknown): ReferenceResolutionError => {
          const error: ReferenceResolutionError = {
            sourceObject: objectName,
            field: ref.field,
            targetObject: ref.targetObject,
            targetField: ref.targetField,
            attemptedValue,
            recordIndex: i,
            message,
          };
          errors.push(error);
          allErrors.push(error);
          return error;
        };

        /**
         * Report a reference the loader had to DROP — the row still lands, so
         * this is the one failure mode in the file whose row counters stay
         * clean (`errored` never moves; only `referencesDropped` does,
         * framework#3932). That is exactly the shape AGENTS.md → "Degradation
         * log levels" reserves `error` for: the record looks seeded while an
         * association it declared is not there. `warn` here was the same
         * count/level contradiction #4729 fixed in pass 2, so the line states
         * the CONSEQUENCE (row written without the association) and the FIX on
         * top of the authored error's own advice.
         */
        const reportDroppedReference = (error: ReferenceResolutionError): void => {
          this.logger.error(
            `[SeedLoader] ${error.message} The value was DROPPED, so ${objectName} record #${i} was written WITHOUT ` +
              `its \`${ref.field}\` association: the row counters stay clean (only referencesDropped moves), and the ` +
              `link is simply absent. Fix the seed value and re-run the seed to restore it.`,
            undefined,
            { recordIndex: i },
          );
        };

        // LOUD FAILURE: an ARRAY of natural keys is only writable by a field
        // that stores an array — `Field.lookup(..., { multiple: true })` (or a
        // multi `user` field). On a single-value field it can never resolve, so
        // report the actionable fix instead of letting it reach the driver.
        if (Array.isArray(fieldValue) && !ref.multiple) {
          const error = pushError(
            `Invalid reference for ${objectName}.${ref.field}: expected a single ` +
              `${ref.targetObject}.${ref.targetField} natural-key string but got an array. ` +
              `Declare the field as \`multiple: true\` to store several references, ` +
              `or pass one natural key.`,
            fieldValue,
          );
          reportDroppedReference(error);
          // Drop the unwritable value so it never reaches the driver. Removing
          // the key (not writing null) matters on the upsert UPDATE path — see
          // the deferred-reference note below. The row itself still gets
          // written, so this is a dropped FIELD, not a dropped record — counted
          // separately (framework#3932) or every count-driven surface, notably
          // the CLI boot banner, reads clean over a severed association.
          delete record[ref.field];
          referencesDropped++;
          continue;
        }

        // A `multiple: true` field's stored shape IS an array, so a lone
        // natural key is one-element shorthand for it; a single-value field
        // keeps its scalar shape. Either way every element resolves the same.
        const items = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
        const resolvedItems: unknown[] = [];
        let invalidItem = false;
        let unresolvedItem: unknown;
        let sawUnresolved = false;
        /** [#31021] Elements naming a seed row a person removed from this organization. */
        let withdrawnItems = 0;

        for (const item of items) {
          // A blank hole (`isMissing`: null, undefined, `''`, whitespace-only)
          // carries no reference — drop it rather than writing it into the
          // stored array, so the field's other elements still land.
          if (isMissing(item)) continue;

          const outcome = await this.resolveReferenceItem(ref, item, insertedRecords, config);
          // [#31021] No link to write for this element: its target is gone on
          // purpose. Handled once the field's other elements are known (below).
          if (outcome.status === 'withdrawn') {
            withdrawnItems++;
            continue;
          }
          if (outcome.status === 'invalid') {
            // LOUD FAILURE: a reference must be a natural-key string (or an
            // internal id). An object value — e.g. the wrapper
            // `{ externalId: 'X' }` — never resolves: it would otherwise fall
            // through unresolved and reach the driver as a non-bindable value
            // ("SQLite3 can only bind ..."). This used to be silently skipped
            // (and only crashed on a persistent DB's update path), so catch it
            // here and report the actionable fix instead.
            const error = pushError(
              `Invalid reference for ${objectName}.${ref.field}: expected a ` +
                `${ref.targetObject}.${ref.targetField} natural-key string but got an object.${outcome.hint}`,
              item,
            );
            reportDroppedReference(error);
            invalidItem = true;
            break;
          }
          if (outcome.status === 'unresolved') {
            unresolvedItem = item;
            sawUnresolved = true;
            break;
          }
          if (outcome.status === 'resolved') referencesResolved++;
          resolvedItems.push(outcome.value);
        }

        if (invalidItem) {
          // Drop the unresolvable value so it never reaches the driver.
          // Removing the key (not writing null) matters on the upsert UPDATE
          // path: an explicit null would overwrite the existing row's valid
          // reference, silently severing the link on every seed replay.
          // Counted as a dropped FIELD (see the array branch above).
          delete record[ref.field];
          referencesDropped++;
          continue;
        }

        if (sawUnresolved) {
          if (config.dryRun) {
            // Dry-run: report the miss but leave the authored value untouched.
            //
            // Deliberately QUIET — no logger call, unlike the real-run branch
            // below (#4997). A dry run writes nothing, so nothing was lost: its
            // caller is by definition reading the result object (that is the
            // whole point of `validate()`), and an `error` line about a
            // SIMULATED outcome is the over-application AGENTS.md → "Degradation
            // log levels" warns about — it trains readers to skim `error`, which
            // is what made the #4420 log unreadable in the first place. Pinned by
            // test so this stays a decision rather than an oversight.
            pushError(
              `[dry-run] Reference may not resolve: ${objectName}.${ref.field} = ` +
                `'${String(unresolvedItem)}' → ${ref.targetObject}.${ref.targetField}`,
              unresolvedItem,
            );
          } else if (config.multiPass) {
            // Defer to pass 2. REMOVE the field rather than writing null:
            // on insert a missing column lands NULL anyway (placeholder until
            // pass 2 back-fills it), but on the upsert UPDATE path an explicit
            // null would OVERWRITE the existing row's already-correct
            // reference — every dev-server restart severed one link per
            // replayed record (NOT NULL columns turned this into a loud
            // constraint error; nullable ones silently lost the association).
            //
            // A multi-value field defers as a WHOLE (the original authored
            // array): a partially-written array is a corrupt association, and
            // pass 2 re-resolves every element from the same authored keys.
            delete record[ref.field];
            if (keyFields.has(ref.field)) deferredKeyFields.add(ref.field); // [#34800]
            deferredUpdates.push({
              objectName,
              recordExternalId: this.externalIdKey(record, externalId),
              externalIdLabel: this.externalIdLabel(externalId),
              field: ref.field,
              targetObject: ref.targetObject,
              targetField: ref.targetField,
              attemptedValue: fieldValue,
              multiple: ref.multiple === true,
              recordIndex: i,
            });
            referencesDeferred++;
            // [commit 1cba33f16] Deferring DELETED a column the write contract requires
            // on insert. Note it now; the signal is emitted once this row's
            // write action is known — see `signalRequiredDeferrals` below.
            if (requiredOnInsert?.has(ref.field)) {
              requiredDeferrals.push({
                field: ref.field,
                targetObject: ref.targetObject,
                attemptedValue: unresolvedItem,
              });
            }
          } else {
            // Cannot resolve and no pass 2 will run — skip the whole record.
            // Writing it anyway would either carry the raw natural-key string
            // into the FK column or, on update, corrupt the existing row.
            //
            // LOUD, and now in all three registers: COUNTED (`errored`, below),
            // REPORTED (`result.errors` / `allErrors` → `success: false`) and
            // LOGGED at `error`. Until #4997 the comment here claimed "LOUD:
            // counted + reported" while this path logged nothing at all, so a
            // load that dropped N records was indistinguishable from a clean one
            // in the console — and `packages/runtime`'s seed call sites only
            // `await` the result. `error` is the level AGENTS.md → "Degradation
            // log levels" reserves for exactly this: the boot looks healthy while
            // rows the seed declares are simply not there.
            const error = pushError(
              `Cannot resolve reference: ${objectName}.${ref.field} = '${String(unresolvedItem)}' → ` +
                `${ref.targetObject}.${ref.targetField} not found`,
              unresolvedItem,
            );
            this.logger.error(
              `[SeedLoader] ${error.message}. ${objectName} record #${i} was NOT seeded AT ALL — the WHOLE ` +
                `record is dropped, not just its \`${ref.field}\` link, because writing it would put the raw ` +
                `natural key '${String(unresolvedItem)}' into the FK column (or, on an upsert UPDATE, corrupt ` +
                `the row already there). Nothing retries this: pass 2 is off. Restore the record in one of ` +
                `three ways, then re-run the seed — seed ${ref.targetObject} BEFORE ${objectName} so the ` +
                `target row exists; or enable \`multiPass\` so pass 2 back-fills the reference once every ` +
                `object is loaded; or fix the natural key in the ${objectName} seed data so it names a real ` +
                `${ref.targetObject}.${ref.targetField}.`,
              undefined,
              {
                object: objectName,
                field: ref.field,
                target: `${ref.targetObject}.${ref.targetField}`,
                recordIndex: i,
              },
            );
            unresolvedRefError = true;
          }
          continue;
        }

        // [#31021] The reference names a seed row a person removed from this
        // organization (recorded as landed, gone now). Nothing is resolved for
        // it and nothing is deferred: the row is gone on purpose, so pass 2
        // could only report it missing, on every replay.
        if (withdrawnItems > 0) {
          // A key naming a removed row is the identity of a row that cannot
          // exist without it: this row is withdrawn with it.
          if (keyFields.has(ref.field)) {
            withdrawnRow = true;
            break;
          }
          this.landedKeyLedger!.withdrawnReferences += withdrawnItems;
          // A single link is left as it is: no column is written, so a matched
          // row keeps what it holds and a created row lands without the link.
          if (!ref.multiple) {
            delete record[ref.field];
            continue;
          }
          // A multi-value link keeps the elements that still resolve.
        }

        // Every element resolved (or was already an internal id). A
        // `multiple: true` field always lands an ARRAY — including when the
        // seed authored a lone key — because that is its stored shape.
        record[ref.field] = ref.multiple ? resolvedItems : resolvedItems[0];
      }

      // [#31021] A key with no reference in it is final before any reference
      // resolves; ask now if the loop above never reached a reference outside it.
      if (!withdrawnRow && !withdrawnAsked && !unresolvedRefError) withdrawnRow = isWithdrawnRow();
      if (withdrawnRow) {
        // Nothing of this row is written, and the references its key resolved
        // on the way are not booked as this load's.
        referencesResolved = referencesResolvedBeforeRow;
        // [#34856] Nor the key references it deferred: pass 2 has no row to
        // write them onto, and would report each as a reference it dropped.
        referencesDeferred = referencesDeferredBeforeRow;
        deferredUpdates.length = deferredUpdatesBeforeRow;
        skipped++;
        const ledger = this.landedKeyLedger!;
        ledger.withdrawnRows.set(objectName, (ledger.withdrawnRows.get(objectName) ?? 0) + 1);
        continue;
      }

      // A definitively unresolvable reference (no pass 2 to fix it) drops the
      // record — reported above, counted here. Better a missing seed row than
      // a written one with a corrupted or unresolved reference.
      if (unresolvedRefError && !config.dryRun) {
        errored++;
        continue;
      }

      // [#25761] The create-only columns leave a matched row's write here, so
      // every write path below sees the same record: the no-op replay check
      // compares without them (a value a job has changed since is not a
      // difference the seed means to undo), and the update writes without
      // them. A row the load creates keeps them all.
      if (createOnlyColumns.size > 0 && matchesExistingRow()) {
        for (const column of createOnlyColumns) delete record[column];
      }

      // [#34800] A row that lands while a reference in its key is still empty
      // takes the id derived from its authored key, so the next load finds it
      // by that id (`rowLandedWithEmptyKeyReference`) instead of inserting
      // another. Only for the modes that insert a keyed row they do not find,
      // only when the record names no id of its own, and never an id a row of
      // this organization or another record of this load already has.
      if (!config.dryRun && (mode === 'upsert' || mode === 'ignore') && deferredKeyFields.size > 0
        && authoredKey !== '' && record['id'] === undefined && rowLandedWithEmptyKeyReference() === undefined) {
        const rowId = seedDeferredKeyRowId(objectName, String(record[organizationColumn] ?? ''), authoredKey);
        if (!existingRowsById!.has(rowId) && !claimedKeyRowIds.has(rowId)) {
          claimedKeyRowIds.add(rowId);
          record['id'] = rowId;
        }
      }
      // [#34800] `ignore` writes nothing over a row it found, so a key
      // reference that was empty when the row landed and resolves now is
      // back-filled by pass 2 onto that row, that column only — the way a held
      // person reference is written later onto the row the seed landed on.
      const landedKeyRow = mode === 'ignore' && config.multiPass && !config.dryRun
        ? rowLandedWithEmptyKeyReference()
        : undefined;
      if (landedKeyRow !== undefined) {
        for (const ref of allRecordRefs) {
          if (!referenceKeyFields.has(ref.field) || deferredKeyFields.has(ref.field) || ref.multiple) continue;
          if (!isMissing(landedKeyRow[ref.field]) || isMissing(record[ref.field])) continue;
          deferredUpdates.push({
            objectName,
            recordExternalId: this.externalIdKey(record, externalId),
            externalIdLabel: this.externalIdLabel(externalId),
            field: ref.field,
            targetObject: ref.targetObject,
            targetField: ref.targetField,
            attemptedValue: authoredKeyValues!.get(ref.field),
            multiple: false,
            recordIndex: i,
          });
          // Booked as pass 2's, which counts it resolved once it is written.
          if (record[ref.field] !== authoredKeyValues!.get(ref.field)) referencesResolved--;
          referencesDeferred++;
        }
      }

      // [#25779] Seed files, once the row's references and organization are
      // final: each `seedFile(path)` becomes the id of a file stored for (or
      // kept by) this row, and a file value that cannot be honoured refuses
      // the row before anything of it is written.
      if (datasetFiles) {
        const matched = existingRowsFor()?.get(this.externalIdKey(record, externalId));
        const organizationOfRow =
          typeof record[organizationColumn] === 'string' && record[organizationColumn] !== ''
            ? (record[organizationColumn] as string)
            : null;
        const outcome = await datasetFiles.prepareRow({
          record,
          existing: matched,
          organizationId: organizationOfRow,
          willWrite: mode === 'update' ? matched !== undefined : mode === 'ignore' ? matched === undefined : true,
          dryRun: config.dryRun === true,
        });
        if (!outcome.ok) {
          errored++;
          const error: ReferenceResolutionError = {
            sourceObject: objectName,
            field: outcome.field,
            targetObject: 'sys_file',
            targetField: 'id',
            attemptedValue: outcome.attemptedValue,
            recordIndex: i,
            message: outcome.message,
          };
          errors.push(error);
          allErrors.push(error);
          // `error` (#4729 / #4632): counted, and the record is dropped. A dry
          // run reports it like any other refusal it finds.
          if (!config.dryRun) {
            this.logger.error(
              `[SeedLoader] ${outcome.message} ${objectName} record #${i} was NOT seeded.`,
              undefined,
              { object: objectName, field: outcome.field, recordIndex: i },
            );
          }
          continue;
        }
        if (outcome.claims.length > 0) {
          fileClaimsByRecordIndex.set(i, { claims: outcome.claims, organizationId: organizationOfRow });
        }
      }

      // [commit 1cba33f16] EARLY SIGNAL — emitted here, before this row reaches the
      // engine, for the deferrals it took on columns the write contract
      // requires on INSERT.
      //
      // Why the row's write ACTION gates it: `decideWriteAction` mirrors
      // `writeRecord`'s mode/existing logic exactly and is side-effect free,
      // so it answers "is this an insert?" without writing. On an UPDATE the
      // deferral's deleted column is an omitted field, which required-
      // validation never checks (ADR-0113: "a PATCH may not null OUT a
      // required field", but an omission is not a clear-out) — so an upsert
      // replay over an existing row succeeds today and must not be warned
      // about. On a SKIP nothing is written at all.
      //
      // ⛔ This changes NO accept behaviour: nothing is counted, nothing
      // reaches `errors`, `success` is untouched. The load proceeds exactly as
      // before and the existing loud failure (the engine's write error naming
      // the column, plus pass 2's dropped-deferral error) is preserved
      // verbatim — this line only moves WHEN the author learns, from after the
      // engine's rejection to before the write that provokes it.
      if (!config.dryRun && requiredDeferrals.length > 0) {
        if (this.decideWriteAction(record, mode, externalId, existingRowsFor(), comparands).action === 'insert') {
          for (const deferral of requiredDeferrals) {
            if (earlySignalledFields.has(deferral.field)) continue;
            earlySignalledFields.add(deferral.field);
            this.logger.warn(
              `[SeedLoader] ${objectName}.${deferral.field} is \`required: true\`, but record #${i} defers it to ` +
                `pass 2: '${String(deferral.attemptedValue)}' names no ${deferral.targetObject} that exists yet. ` +
                `Deferring REMOVES the column from the pass-1 insert, so an engine that enforces \`required\` ` +
                `rejects this row and pass 2 has no row left to back-fill — a failure that is reported loudly ` +
                `either way, just later. Order the \`${deferral.targetObject}\` dataset BEFORE \`${objectName}\` ` +
                `so the reference resolves in pass 1 (a \`required\` id half is order-dependent; pass-2 healing ` +
                `only covers optional ones). Reported once per field per dataset.`,
              {
                object: objectName,
                field: deferral.field,
                target: deferral.targetObject,
                recordIndex: i,
              },
            );
          }
        }
      }

      // [#31021] The key this row is recorded under, should it land: read off
      // the record as written, references resolved.
      if (recordedKeys) {
        const landedKey = landedKeyOf(record, i);
        if (landedKey !== '') landedKeyByRecordIndex.set(i, landedKey);
        // [#34856] A key reference still empty: under the id it lands with.
        else if (deferredKeyFields.size > 0 && deferredLandedKey !== '') landedKeyByRecordIndex.set(i, deferredLandedKey);
      }

      // Insert/upsert the record
      if (!config.dryRun) {
        rowOrganizationByRecordIndex.set(i, record[organizationColumn]); // [#33206]
        if (hasSelfRef) {
          // Self-referencing dataset: keep the historical sequential
          // per-record write so a later record can resolve its self-ref
          // against an earlier one via `insertedRecords` — see `hasSelfRef`.
          try {
            const result = await this.writeRecord(
              objectName, record, mode, externalId, existingRowsFor(), comparands, record[organizationColumn],
            );

            if (result.action === 'inserted') written.inserted++;
            else if (result.action === 'updated') written.updated++;
            else if (result.action === 'skipped') {
              skipped++;
              if (result.uncompared) this.noteUncomparedCredentials(objectName, result.uncompared); // [#24624]
            }

            const externalIdValue = this.externalIdKey(record, externalId);
            const internalId = result.id;
            if (internalId) noteLanded(i, String(internalId)); // [commit 9a884c6e4]
            if (internalId && result.action === 'inserted') insertedRecordIndexes.add(i); // [#30348]
            if (externalIdValue && internalId) {
              insertedRecords.get(objectName)!.set(externalIdValue, String(internalId));
            }
            await settleSeedFiles(i, internalId ? String(internalId) : undefined); // [#25779]
          } catch (err: any) {
            errored++;
            // Same cascade guard as the batched update path: the row may
            // already exist (rejected update), so keep its natural-key
            // mapping alive for downstream reference resolution.
            const externalIdValue = this.externalIdKey(record, externalId);
            const existingId = this.extractId(existingRowsFor()?.get(externalIdValue));
            if (existingId) noteLanded(i, existingId); // [commit 9a884c6e4]
            if (externalIdValue && existingId) {
              insertedRecords.get(objectName)!.set(externalIdValue, existingId);
            }
            const error = this.buildWriteError(objectName, record, externalId, i, err);
            errors.push(error);
            allErrors.push(error);
            // `error`, not `warn` (#4729 / #4632): counted in `allErrors`, and
            // the record did not land. `writeRecord` is in the durability
            // gate's vocabulary, so this catch cannot regress to `warn`.
            // [#8442] carries the caught cause even when the payload withholds.
            this.logger.error(
              seedFailureLogLine(error.message, err),
              err instanceof Error ? err : undefined,
              { recordIndex: i },
            );
          }
        } else {
          const decision = this.decideWriteAction(record, mode, externalId, existingRowsFor(), comparands);
          const externalIdValue = this.externalIdKey(record, externalId);

          if (decision.action === 'skip') {
            skipped++;
            if (decision.uncompared) this.noteUncomparedCredentials(objectName, decision.uncompared); // [#24624]
            if (decision.id) noteLanded(i, decision.id); // [commit 9a884c6e4]
            if (decision.id && externalIdValue) {
              insertedRecords.get(objectName)!.set(externalIdValue, decision.id);
            }
            await settleSeedFiles(i, decision.id); // [#25779]
          } else if (decision.action === 'update') {
            // Register the externalId → id mapping BEFORE attempting the
            // write: the row exists and its id is known regardless of whether
            // this update succeeds. A rejected update (e.g. a state_machine
            // rule vetoing the transition back to the seed value) must not
            // sever downstream natural-key resolution — that cascade is what
            // turned one legitimate validation error into NULLed-out child
            // references on every dev-server restart.
            if (decision.id) noteLanded(i, decision.id); // [commit 9a884c6e4] same rationale
            if (externalIdValue) {
              insertedRecords.get(objectName)!.set(externalIdValue, decision.id);
            }
            try {
              const rowOpts = this.writeOptionsFor(record[organizationColumn]) as any; // [#33206]
              await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.update(objectName, { ...record, id: decision.id }, rowOpts)));
              written.updated++;
              await settleSeedFiles(i, decision.id); // [#25779]
            } catch (err: any) {
              errored++;
              const error = this.buildWriteError(objectName, record, externalId, i, err);
              errors.push(error);
              allErrors.push(error);
              // `error`, not `warn` (#4729 / #4632): counted in `allErrors`,
              // and the row's declared values did not land — an upsert that
              // fails here leaves the PREVIOUS row contents in place, which
              // looks like a seeded record and is not one.
              // [#8442] carries the caught cause even when the payload withholds.
              this.logger.error(
                seedFailureLogLine(error.message, err),
                err instanceof Error ? err : undefined,
                { recordIndex: i },
              );
            }
          } else {
            // Insert: buffer for the batched flush rather than writing now.
            // [#33206] A row written as another organization starts its own batch.
            const rowOpts = this.writeOptionsFor(record[organizationColumn]);
            if (pendingInserts.length > 0 && rowOpts !== batchOpts) await flushPendingInserts();
            batchOpts = rowOpts;
            pendingInserts.push({ recordIndex: i, externalIdValue, record });
            if (pendingInserts.length >= insertBatchSize) {
              await flushPendingInserts();
            }
          }
        }
      } else {
        // Dry-run: simulate insert tracking
        const externalIdValue = this.externalIdKey(record, externalId);
        if (externalIdValue) {
          insertedRecords.get(objectName)!.set(externalIdValue, `dry-run-id-${i}`);
        }
        written.inserted++; // Count as "would be inserted"
      }
    }

    if (!config.dryRun) {
      await flushPendingInserts();
    }

    // [commit 9a884c6e4] Annotate this dataset's deferred updates with the internal id
    // their source row got when it was written — the id pass 2 writes the
    // resolved reference back through. Runs after the final flush so batched
    // inserts have reported their ids; datasets load sequentially, so the
    // slice from `deferredStart` is exactly this dataset's deferrals. An entry
    // that gets no id here is a row this dataset never landed (its write
    // failed, or returned no id) — pass 2 reports that as the drop it is.
    for (let d = deferredStart; d < deferredUpdates.length; d++) {
      const entry = deferredUpdates[d];
      const internalId = internalIdByRecordIndex.get(entry.recordIndex);
      if (internalId) entry.internalId = internalId;
      entry.rowOrganization = rowOrganizationByRecordIndex.get(entry.recordIndex); // [#33206]
    }

    // [#31021] Record the keys of the rows this dataset landed on — inserted,
    // updated, or matched and left alone — in the same pass that wrote them,
    // before the next dataset loads. A matched row is recorded too: that is
    // what lets a row an earlier release seeded count as landed here.
    if (recordedKeys) {
      const fresh = new Set<string>();
      for (const [recordIndex, landedKey] of landedKeyByRecordIndex) {
        if (internalIdByRecordIndex.has(recordIndex) && !recordedKeys.has(landedKey)) fresh.add(landedKey);
      }
      await this.recordLandedKeys(objectName, [...fresh], recordedKeys);
    }

    // [#23354] The same map, published: the rows this dataset landed on. Every
    // write site records through `noteLanded` — an insert, an update, and a key
    // matched on a replay and skipped — so a replay reports the rows an earlier
    // load wrote, and the seed-ownership claim (ADR-0138 D1) can hand over
    // exactly the seed's rows without a second copy of the key and reference
    // rules above. Record order, each id once: two records can resolve to one
    // row. A dry run never calls `noteLanded`, so it reports none.
    const landedIds = [...new Set(
      [...internalIdByRecordIndex.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, id]) => id),
    )];
    // [#30348] The subset this load CREATED, same order and dedupe. An id is
    // here only when the record that landed on it was an insert, so a replay
    // that matches the rows an earlier load inserted reports them as landed
    // and not inserted — the publish receipt tells "created" from "matched"
    // by exactly this.
    const insertedIds = [...new Set(
      [...internalIdByRecordIndex.entries()]
        .filter(([recordIndex]) => insertedRecordIndexes.has(recordIndex))
        .sort(([a], [b]) => a - b)
        .map(([, id]) => id),
    )];

    // [#35655] Once per dataset, naming the object, the fields and the count:
    // the seed asked for a total the platform did not store. This notice IS
    // the report (ruling D as analysed in 7062334196, point (e); the seat's
    // correction 7064615114): no load-result key carries it. `warn`, not
    // `error`: nothing claimed persisted is lost — a roll-up is never the
    // seed's to write, and the rest of every record landed.
    if (summaryValuesDropped > 0) {
      const fields = [...summaryFieldsDropped];
      this.logger.warn(
        `[SeedLoader] The ${objectName} seed supplies ${summaryValuesDropped} value(s) for the roll-up summary ` +
          `field(s) ${fields.map((f) => `\`${f}\``).join(', ')}, which a seed never stores: the values are not ` +
          `written, the rest of each record is, and each roll-up is computed from its child rows, so a record ` +
          `with no children reads the empty-child-list value (0 for count and sum, empty for min, max and avg). ` +
          `Seed the child rows the total counts, and leave the summary field out of the ${objectName} seed.`,
        { object: objectName, fields, droppedValues: summaryValuesDropped },
      );
    }

    if (this.loadProgress) this.loadProgress.loading = undefined;
    return {
      object: objectName,
      mode,
      inserted: written.inserted,
      updated: written.updated,
      skipped,
      errored,
      total: dataset.records.length,
      referencesResolved,
      referencesDeferred,
      referencesDropped,
      summariesStale: this.summariesStale - summariesStaleAtStart,
      landedIds,
      insertedIds,
      errors,
    };
  }

  // ==========================================================================
  // Internal: Reference Resolution
  // ==========================================================================

  /**
   * Resolve the install's SOLE organization — used to stamp every seed row
   * when the caller pinned no `config.organizationId` (an in-process publish
   * has no active user session; the `single`-posture boot seed passes none).
   * A `single` install has exactly one organization, so its seeds carry it like
   * a normal write instead of landing org-less.
   *
   * Three answers ({@link SoleOrganizationReading}):
   *  - `sole` — exactly one organization; stamp with it.
   *  - `unowned` — [ADR-0131 D9] the composition registers the organization
   *    object and holds zero organizations (a missing table included: it can
   *    hold no row) or several: no owner is derivable, and the caller refuses
   *    the rows of an organization-owned object rather than writing NULL.
   *  - `no-organization-object` — the composition registers no organization
   *    object at all (a lean runtime); today's branch, unchanged: nothing is
   *    stamped and nothing refused (ADR-0131 C8 decides whether D9 reaches it).
   *
   * [#12852] A read that FAILED for any other reason PROPAGATES — it is not
   * an emptiness. See the catch below.
   */
  private async resolveSoleOrganizationId(): Promise<SoleOrganizationReading> {
    let count: number;
    try {
      const rows = await this.engine.find('sys_organization', {
        fields: ['id'],
        limit: 2,
        context: { isSystem: true },
      } as any);
      if (Array.isArray(rows) && rows.length === 1) {
        const id = (rows[0] as { id?: unknown; _id?: unknown })?.id ?? (rows[0] as { _id?: unknown })?._id;
        if (id) return { kind: 'sole', organizationId: String(id) };
      }
      count = Array.isArray(rows) ? rows.length : 0;
    } catch (error) {
      // [#12852] Discriminate by error TYPE, the same repair commit 855591fe7 made to
      // `ObjectQL.probeInstallOrganizations` — the sibling probe with this
      // exact shape, on the other side of the engine boundary. This site was
      // missed by that pass.
      //
      // The bare `catch {}` this replaces answered EVERY cause with `undefined`,
      // and `undefined` is not a neutral value here: it is the verdict this
      // method's own JSDoc describes as "genuinely ambiguous", so the caller
      // stamps no `organization_id` and every BUSINESS seed row of the run lands
      // org-less — invisible afterwards under strict org-scoping. Nothing says
      // so: `load()` reports through `SeedLoadResult.errors`, and this path
      // never touches it, so a transient outage mid-seed reads to the operator
      // as a clean, successful seed. ADR-0110 D3's exact shape: "the read found
      // no sole organization" and "the read could not run" are different facts.
      //
      // Benign, and the only one — it is precisely the cause the swallowed
      // comment already named: `sys_organization` is absent because its TABLE
      // was never provisioned (schema sync not run yet, a single-tenant
      // runtime). It can hold no row, so "no sole organization" IS the truth and
      // the historical global/cross-tenant NULL is the right answer. Asked
      // through the shared `isMissingTableError` predicate
      // (`@objectstack/metadata/errors`) — the same call `loadExistingRecords`
      // makes below — never a hand-rolled message test, so one vocabulary of
      // "benign driver error" serves every seam that needs one.
      //
      // [#21516] The same absence in a composition that registers no
      // `sys_organization` object at all (a single-tenant/lean runtime): the
      // engine's in-process verbs now refuse an unresolved name with
      // `OBJECT_NOT_FOUND` before any driver is asked, rather than reaching a
      // table by that raw name. It is the not-provisioned case the missing-table
      // arm already covers — no organization object here, so "no sole
      // organization" is the truth and the historical NULL is right. Attributed
      // on the error's own `object`, like the predicate above: a refusal naming
      // a different object is not evidence about `sys_organization`.
      //
      // Everything else (connection loss, a timeout, a permission denial, a
      // driver fault) means organizations may well exist and simply were not
      // seen. It propagates, envelope intact: the seed run fails loudly instead
      // of writing a batch of rows nobody will be able to see. No new error code
      // and no new result field — the caller receives the read's own failure.
      //
      // [ADR-0131 D9] Those two benign causes now answer differently. The
      // engine's refusal names a composition with NO organization object —
      // today's branch. A missing table is an organization object whose table
      // holds nothing, so it is the zero case, decided below by the same
      // registration read as an empty answer.
      const refused = error as { code?: unknown; object?: unknown } | null | undefined;
      const refusedThisObject = refused?.code === 'OBJECT_NOT_FOUND' && refused.object === 'sys_organization';
      if (refusedThisObject) return { kind: 'no-organization-object' };
      if (!isMissingTableError(error, 'sys_organization')) throw error;
      count = 0;
    }
    // Zero, or several (the read is capped at 2): no owner is derivable — but
    // only a composition that REGISTERS the organization object makes that an
    // unowned install. The registration read is the same one the engine's own
    // decision takes (`resolveSystemWriteOrganization`'s
    // `organizationObjectRegistered`), answered from the object definition the
    // loader resolves every dataset's object through.
    const organizationObject = await this.resolveObjectDefinition('sys_organization');
    return organizationObject
      ? { kind: 'unowned', organizationCount: count }
      : { kind: 'no-organization-object' };
  }

  /**
   * Resolve ONE reference value — the whole value of a single-value field, or
   * one element of a `multiple: true` field's array — against the records
   * seeded so far and then the database.
   *
   * Splitting this out is what lets a multi-value lookup work at all: the
   * authored `authors: ['Alice', 'Bob']` is N independent natural keys, not one
   * unresolvable "object" (framework#3911). Both passes share it so an element
   * deferred to pass 2 resolves by exactly the same rules.
   */
  private async resolveReferenceItem(
    ref: { field: string; targetObject: string; targetField: string },
    value: unknown,
    insertedRecords: Map<string, Map<string, string>>,
    config: { dryRun?: boolean; organizationId?: string },
  ): Promise<
    | { status: 'resolved'; value: string }
    | { status: 'kept'; value: unknown }
    | { status: 'invalid'; hint: string }
    | { status: 'unresolved'; miss?: DatabaseProbeOutcome }
    | { status: 'withdrawn' }
  > {
    if (typeof value === 'object') {
      const wrapped = (value as Record<string, unknown>).externalId;
      return {
        status: 'invalid',
        hint:
          wrapped !== undefined
            ? ` Pass the natural key directly: ${ref.field}: ${JSON.stringify(wrapped)}.`
            : ` Pass the target's ${ref.targetField} value as a plain string.`,
      };
    }

    // [#21665] An authored id of a row this replay re-identified names that
    // row, in THIS organization. Asked BEFORE the internal-id short-circuit
    // below on purpose: a UUID-shaped authored id would otherwise be kept
    // verbatim and link this organization's row to another organization's.
    if (typeof value === 'string') {
      const replayed = this.replayIdByAuthoredId.get(ref.targetObject)?.get(value);
      if (replayed !== undefined) return { status: 'resolved', value: replayed };
    }

    // Not a natural key (an internal id, or a non-string the engine will
    // reject on its own terms) — keep it verbatim.
    //
    // [#33280] Except a person on an organization-scoped load: an id names a
    // person exactly as a name does, so it is judged by the same membership
    // rule. A member's id resolves to itself; an id of someone outside the
    // organization gets the refusal a name gets. A shape the pattern does not
    // recognise (`usr_…`) already reached the probe through its `id` leg, so
    // keeping the recognised shapes verbatim was the only door past the rule.
    if (typeof value !== 'string') return { status: 'kept', value };
    if (this.looksLikeInternalId(value) && !(await this.judgesInternalIdByMembership(ref.targetObject, config))) {
      return { status: 'kept', value };
    }

    // Records seeded during THIS load first, then existing rows in the DB.
    const fromThisLoad = insertedRecords.get(ref.targetObject)?.get(value);
    if (fromThisLoad) return { status: 'resolved', value: fromThisLoad };

    // Dry-run never probes the database — an in-memory miss is the verdict.
    if (config.dryRun) return { status: 'unresolved' };

    const fromDatabase = await this.resolveFromDatabase(
      ref.targetObject, ref.targetField, value, config.organizationId,
    );
    if (fromDatabase.id) return { status: 'resolved', value: fromDatabase.id };
    // [#31021] No row answers, and the record says one landed here under this
    // key: a person removed it. Asked only once every probe has missed, so the
    // record can never stand in for a row that is there.
    if (await this.isWithdrawnSeedTarget(ref.targetObject, ref.targetField, value)) return { status: 'withdrawn' };
    return { status: 'unresolved', miss: fromDatabase };
  }

  private async resolveFromDatabase(
    targetObject: string,
    targetField: string,
    value: unknown,
    organizationId?: string,
  ): Promise<DatabaseProbeOutcome> {
    // Probe order: the target dataset's declared externalId (threaded in as
    // `targetField` via buildReferenceMap), then the historical 'name'
    // default, then the internal id. Each is exact-match, so extra probes
    // can only rescue a reference, never mis-resolve one.
    const probeFields = [targetField];
    if (targetField !== DEFAULT_EXTERNAL_ID_FIELD) probeFields.push(DEFAULT_EXTERNAL_ID_FIELD);
    if (targetField !== 'id') probeFields.push('id');

    // [#9071] Ask the registry before spelling `name`, instead of probing it
    // blind. On an object that declares no `name` column the driver REFUSES
    // the filter (`INVALID_FILTER`) rather than answering "no rows" — and it
    // is right to: a predicate naming a column the object does not have never
    // ran, so "no match" would be a lie (ADR-0110 D3 — a miss and a fault are
    // different facts).
    //
    // The remedy therefore has to be on THIS side: stop asking. Softening the
    // driver's answer would keep provoking a fault and then hide it.
    //
    // Dropping the leg cannot change WHICH probe answers: on an object with no
    // `name` column this probe could only ever throw, never match. When the
    // registry cannot answer at all (object unknown to metadata AND to the
    // engine's schema registry), the leg is KEPT — an unknown is not a denial,
    // and the historical behaviour is the safe default.
    if (probeFields.includes(DEFAULT_EXTERNAL_ID_FIELD) && !(await this.declaresNameColumn(targetObject))) {
      probeFields.splice(probeFields.indexOf(DEFAULT_EXTERNAL_ID_FIELD), 1);
    }

    // [#33207] How an organization-scoped load may look into this target. With
    // no organization on the load (the single-tenant boot, a publish, a hot
    // reload) every probe is unscoped, exactly as before.
    const scope: ProbeScope | { readonly kind: 'unscoped' } = organizationId
      ? await this.probeScopeOf(targetObject)
      : { kind: 'unscoped' };
    let refusal: ProbeRefusal | undefined;
    let nonMemberMatched = false;

    for (const probeField of probeFields) {
      try {
        if (scope.kind === 'members') {
          const outcome = await this.probeOrganizationMember(probeField, value, organizationId!);
          if (outcome.id) return { id: outcome.id };
          nonMemberMatched ||= outcome.nonMemberMatched;
          refusal ??= outcome.refusal;
          continue;
        }
        const where: Record<string, unknown> = { [probeField]: value };
        // A tenant-carrying target (or one the registry cannot describe) is
        // AND-scoped to the load's organization, so a row of another
        // organization is never borrowed as the reference (that would be a
        // cross-organization link). The filter names the column the target's
        // rows are walled by (#33393): a declared `tenancy.tenantField` holds
        // the organization there, and `organization_id` may not exist at all.
        // The organization table itself answers only for the load's own
        // organization. A global target (its author gave it no organization
        // column) has no tenant to borrow from.
        if (scope.kind === 'organization') where[scope.tenantColumn] = organizationId;
        else if (scope.kind === 'own-organization') {
          if (probeField === 'id' && value !== organizationId) continue;
          where.id = organizationId;
        }
        const records = await this.engine.find(targetObject, {
          where,
          fields: ['id'],
          limit: 1,
          context: { isSystem: true },
        } as any);
        // The 'id' probe covers a seed that wires a lookup to a real existing
        // record (e.g. a people field → the current user, whose id is not a
        // UUID/ObjectId so `looksLikeInternalId` did not short-circuit); an id
        // either exists or it does not, so there is no false-match risk.
        if (records && records.length > 0) {
          return { id: String(records[0].id || records[0]._id) };
        }
      } catch (err) {
        // [#33207] A refused probe never ran, so it is not "no match". The
        // chain still moves on (a later leg may answer), the load is never
        // refused for it, and the refusal is carried to the reference's own
        // verdict and said once per target, field and code.
        refusal ??= this.reportRefusedProbe(scope.kind === 'members' ? SystemObjectName.USER : targetObject, probeField, err);
      }
    }
    return { id: null, ...(refusal ? { refusal } : {}), ...(nonMemberMatched ? { nonMemberOf: organizationId } : {}) };
  }

  /**
   * [#33207] Resolve a person for an organization-scoped load: `sys_user`
   * carries no organization (identity lives above the organization), so a
   * person resolves only when they hold a `sys_member` row in the load's
   * organization. ⛔ A person who is not a member is never resolved, however
   * exactly the name matches: they could not even read the row they would be
   * made to own. The member with the lowest id wins, so the answer does not
   * depend on the driver's row order.
   *
   * The probe is driven from the organization's member set, never from the
   * people the key names (#33280): a name is not unique above the organization
   * (every organization may sign its people up under the same seeded names),
   * so reading the same-named people first made the cost grow with the
   * deployment. The members are read in `user_id` order, a page at a time, by
   * keyset (`user_id` greater than the last one seen) — an offset page shifts
   * under a concurrent delete and skips a member, which is a false "not a
   * member". Each page is asked ONE `sys_user` read constrained to that page's
   * people AND the key; the pages ascend, so the first page that answers holds
   * the lowest-id member and the walk stops there. "Not a member" is said only
   * after every member was asked about; whether anyone outside the
   * organization answers to the key is then one bounded read (`limit: 1`),
   * which only words the verdict.
   *
   * The `id` key needs no member page: the membership row of that one person
   * is read directly. A refused membership read is reported as a refusal on
   * `sys_member`, the table that refused it.
   */
  private async probeOrganizationMember(
    probeField: string,
    value: unknown,
    organizationId: string,
  ): Promise<{ id: string | null; nonMemberMatched: boolean; refusal?: ProbeRefusal }> {
    const page = SeedLoaderService.MEMBER_PROBE_PAGE;
    const firstUser = async (where: Record<string, unknown>): Promise<string | null> => {
      const users = (await this.engine.find(SystemObjectName.USER, {
        where,
        fields: ['id'],
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: 1,
        context: { isSystem: true },
      } satisfies EngineQueryOptions)) as Array<Record<string, unknown>> | undefined;
      const id = users?.[0]?.id ?? users?.[0]?._id;
      return id === undefined || id === null ? null : String(id);
    };
    const readMembers = async (where: Record<string, unknown>, limit: number): Promise<string[]> => {
      const members = (await this.engine.find(SystemObjectName.MEMBER, {
        where: { ...where, organization_id: organizationId },
        fields: ['user_id'],
        orderBy: [{ field: 'user_id', order: 'asc' }],
        limit,
        context: { isSystem: true },
      } satisfies EngineQueryOptions)) as Array<Record<string, unknown>> | undefined;
      return (members ?? [])
        .map((m) => m.user_id)
        .filter((id) => id !== undefined && id !== null && id !== '')
        .map(String);
    };

    if (probeField === 'id') {
      let isMember: boolean;
      try {
        isMember = (await readMembers({ user_id: value }, 1)).length > 0;
      } catch (err) {
        return { id: null, nonMemberMatched: false, refusal: this.reportRefusedProbe(SystemObjectName.MEMBER, 'user_id', err) };
      }
      const person = await firstUser({ id: value });
      if (person === null) return { id: null, nonMemberMatched: false };
      return isMember ? { id: person, nonMemberMatched: false } : { id: null, nonMemberMatched: true };
    }

    for (let after: string | undefined; ;) {
      let memberIds: string[];
      try {
        memberIds = await readMembers(after === undefined ? {} : { user_id: { $gt: after } }, page);
      } catch (err) {
        return { id: null, nonMemberMatched: false, refusal: this.reportRefusedProbe(SystemObjectName.MEMBER, 'user_id', err) };
      }
      if (memberIds.length > 0) {
        const member = await firstUser({
          [probeField]: value,
          id: memberIds.length === 1 ? memberIds[0] : { $in: memberIds },
        });
        if (member !== null) return { id: member, nonMemberMatched: false };
      }
      if (memberIds.length < page) break;
      after = memberIds[memberIds.length - 1];
    }
    return { id: null, nonMemberMatched: (await firstUser({ [probeField]: value })) !== null };
  }

  /**
   * [#33207] How an organization-scoped load probes `targetObject`, judged once
   * per load from the same definition resolver the stamp reads:
   *
   * - `organization` — the target carries an `organization_id` column (declared,
   *   or injected by the system-column pass), or the registry cannot describe
   *   it: probe within the load's organization, as always. The filter is on
   *   the target's tenant column (`resolveTenantFieldName`, falling back to
   *   `organization_id` when it resolves none), the column the wall scopes
   *   the target by (#33393).
   * - `members` — `sys_user`, which carries no organization: a person resolves
   *   only through membership in the load's organization.
   * - `own-organization` — `sys_organization`, the tenant table itself: the load
   *   may name its own organization and no other.
   * - `global` — {@link isGlobalSeedObject}: an author's object (no
   *   `managedBy`) with no organization column that resolves no tenant field
   *   at all (`resolveTenantFieldName`, the same reading the wall scopes by;
   *   e.g. `tenancy: { enabled: false }`): no organization walls its rows, so
   *   the probe is unscoped.
   * - any other target with no organization column keeps the `organization`
   *   probe, and its refusal is reported, not swallowed: a platform-managed
   *   table is not a seed target, and an object that resolves another tenant
   *   column (`tenancy.tenantField`) is walled per organization, so an
   *   unscoped probe would borrow another organization's row: it is probed
   *   within the load's organization on that column. A platform-managed table
   *   that resolves no tenant column keeps the `organization_id` filter, whose
   *   refusal is reported; a scope rule for it is not this loader's to invent.
   */
  private async probeScopeOf(targetObject: string): Promise<ProbeScope> {
    const memoised = this.probeScopeCache.get(targetObject);
    if (memoised !== undefined) return memoised;
    let definition: unknown;
    try {
      definition = await this.resolveObjectDefinition(targetObject);
    } catch {
      // The registry could not answer: an unknown is not a tenant-less verdict,
      // so the probe keeps today's organization filter.
    }
    const tenantColumn = resolveTenantFieldName(definition) ?? DEFAULT_TENANT_FIELD;
    let scope: ProbeScope = { kind: 'organization', tenantColumn };
    if (definition && typeof definition === 'object' && !carriesOrganizationColumn(definition)) {
      if (targetObject === SystemObjectName.USER) scope = { kind: 'members' };
      else if (targetObject === SystemObjectName.ORGANIZATION) scope = { kind: 'own-organization' };
      else if (isGlobalSeedObject(targetObject, definition)) scope = { kind: 'global' };
    }
    this.probeScopeCache.set(targetObject, scope);
    return scope;
  }

  /**
   * [#33207] Say a refused reference probe once per load, per target, field and
   * code, and hand back what the reference's own verdict carries. A refusal is
   * a probe that never ran (an unknown column, an unregistered object, a driver
   * fault), so the miss it leaves behind is not evidence that no row exists.
   */
  private reportRefusedProbe(targetObject: string, probeField: string, err: unknown): ProbeRefusal {
    const e = err as { code?: unknown; name?: unknown; message?: unknown } | undefined;
    const code = typeof e?.code === 'string' && e.code ? e.code : typeof e?.name === 'string' && e.name ? e.name : 'UNKNOWN';
    const key = JSON.stringify([targetObject, probeField, code]);
    if (!this.refusedProbes.has(key)) {
      this.refusedProbes.add(key);
      const firstSentence = typeof e?.message === 'string' ? e.message.split(/(?<=\.)\s/)[0] : '';
      this.logger.warn(
        `[SeedLoader] A reference probe on ${targetObject}.${probeField} was refused (${code}), so a reference ` +
          `into ${targetObject} by ${probeField} cannot resolve through it on this load: the probe never ran, ` +
          `which is not the same as no row matching.${firstSentence ? ` ${firstSentence}` : ''}`,
        { object: targetObject, field: probeField, code },
      );
    }
    return { object: targetObject, field: probeField, code };
  }

  /**
   * [#9071] Does `objectName` declare the historical `name` column?
   *
   * The one question {@link resolveFromDatabase} must be able to answer before
   * it may add the `name` leg to its probe chain. Answered from the SAME
   * definition resolver the reference graph is built from
   * ({@link resolveObjectDefinition} — the metadata service first, then the
   * engine's own schema registry), so the loader cannot form one opinion about
   * an object's columns here and a different one two methods up. That resolver
   * is already imported and already called at boot, so this asks the registry
   * a question it is standing right next to; no new dependency, no new seam.
   *
   * **`true` on an unknown**, deliberately. Three populations reach here: an
   * object the metadata service knows (authoritative), one only the engine's
   * registry knows (marketplace-installed packages — the reason
   * `resolveObjectDefinition` has its fallback at all), and one NEITHER can
   * describe. For the third the honest answer is "unknown", and an unknown is
   * not a denial: keeping the leg preserves today's behaviour exactly, and the
   * probe against a genuinely absent object fails on its first leg regardless.
   * Answering `false` there would be this file making up a column list.
   */
  private async declaresNameColumn(objectName: string): Promise<boolean> {
    const memoised = this.declaresNameColumnCache.get(objectName);
    if (memoised !== undefined) return memoised;

    let declared = true;
    try {
      const objDef = await this.resolveObjectDefinition(objectName);
      const fields = objDef?.fields as Record<string, unknown> | undefined;
      if (fields && typeof fields === 'object') {
        declared = Object.prototype.hasOwnProperty.call(fields, DEFAULT_EXTERNAL_ID_FIELD);
      }
    } catch {
      // The registry itself could not answer (store outage, unknown type).
      // Same verdict as an unknown object: keep the historical leg rather than
      // narrow the chain on a fact nobody established.
    }

    this.declaresNameColumnCache.set(objectName, declared);
    return declared;
  }

  private async resolveDeferredUpdates(
    deferredUpdates: DeferredUpdate[],
    insertedRecords: Map<string, Map<string, string>>,
    allResults: SeedLoadResultParsed[],
    allErrors: ReferenceResolutionError[],
    organizationId?: string,
  ): Promise<void> {
    for (const deferred of deferredUpdates) {
      // [commit 460d4b807] How the messages below NAME this record. `recordExternalId`
      // is a map KEY joined with `\u0000` (see {@link externalIdKey}) and stays
      // one — the `insertedRecords` fallback lookup below depends on it — but a
      // raw NUL in a log line turns the whole log binary for `grep`, so every
      // message renders it instead of pasting it.
      const recordName = this.externalIdDisplay(deferred.recordExternalId);
      // A multi-value field deferred its WHOLE authored array (see pass 1), so
      // re-resolve every element here; a single-value field has exactly one.
      const items = Array.isArray(deferred.attemptedValue)
        ? deferred.attemptedValue
        : [deferred.attemptedValue];
      const resolvedItems: unknown[] = [];
      let missingItem: unknown;
      /** [#33207] Why the database probes missed `missingItem`, when that is known. */
      let missingProbe: DatabaseProbeOutcome | undefined;
      let stillUnresolved = false;
      /** [#31021] Elements naming a seed row a person removed from this organization. */
      let withdrawnItems = 0;

      for (const item of items) {
        // The same blank rule pass 1 drops a hole by: the deferred value is the
        // WHOLE authored array, holes included.
        if (isMissing(item)) continue;
        const outcome = await this.resolveReferenceItem(
          deferred, item, insertedRecords, { organizationId },
        );
        if (outcome.status === 'resolved' || outcome.status === 'kept') {
          resolvedItems.push(outcome.value);
          continue;
        }
        // [#31021] Gone on purpose — no link to write, and no miss to report.
        if (outcome.status === 'withdrawn') {
          withdrawnItems++;
          continue;
        }
        // 'invalid' can't reach pass 2 (pass 1 drops it), but treat it as a
        // miss rather than writing an unresolvable value.
        missingItem = item;
        if (outcome.status === 'unresolved') missingProbe = outcome.miss;
        stillUnresolved = true;
        break;
      }

      // [#31021] An element names a seed row a person removed from this
      // organization. With nothing left to write — a single link, or a
      // multi-value one whose every element is gone — the deferral is settled
      // here: no write, no error, and it leaves `referencesDeferred`, whose
      // leftover count must match an entry in `errors`. A multi-value link
      // with elements left writes those below, like any back-fill.
      if (!stillUnresolved && withdrawnItems > 0) {
        this.landedKeyLedger!.withdrawnReferences += withdrawnItems;
        if (!deferred.multiple || resolvedItems.length === 0) {
          const resultEntry = allResults.find(r => r.object === deferred.objectName);
          if (resultEntry) resultEntry.referencesDeferred--;
          continue;
        }
      }

      // A multi-value field writes the array it re-resolved; a single-value one
      // writes its lone id. An empty result is never a resolution.
      const resolvedValue: unknown = deferred.multiple ? resolvedItems : resolvedItems[0];

      if (!stillUnresolved && resolvedItems.length > 0) {
        // [commit 9a884c6e4] Write back through the internal id captured at insert time
        // — the handle that exists for every row this load actually wrote,
        // keyed or KEYLESS, so the declared deferral property ("pass 2 heals
        // an out-of-order reference") holds without requiring the dataset to
        // declare an externalId. The natural-key map is the FALLBACK, not the
        // primary: it can still name a row when this record's own pass-1 write
        // failed but another dataset in the same load upserted the same
        // natural key (same key = same logical row).
        const recordId = deferred.internalId
          ?? insertedRecords.get(deferred.objectName)?.get(deferred.recordExternalId);

        if (recordId) {
          try {
            await this.writeDeferredReference(deferred, recordId, resolvedValue);

            // Update result stats
            const resultEntry = allResults.find(r => r.object === deferred.objectName);
            if (resultEntry) {
              resultEntry.referencesResolved++;
              resultEntry.referencesDeferred--;
            }
          } catch (err: any) {
            // LOUD FAILURE (framework#2805; rule: #4632, accident: #4420): the
            // target resolved but the back-fill WRITE failed (a transient error
            // that outlasted the retry budget, a validation veto, …). The
            // reference stays NULL — the very corruption pass 2 exists to
            // prevent — so this must be a reported, counted `error`, never a
            // warning. It is counted below (`recordDeferredError` → `allErrors`
            // → `success: false`), and until #4729 the LOG line contradicted
            // that count by sitting at `warn`: the one trace a seed leaves in
            // the console was the level nobody reads (#4420). Count and level
            // now agree, and the line owes the two things AGENTS.md
            // ("Degradation log levels") requires of an `error`: the
            // CONSEQUENCE and the FIX.
            // [#14095] Derived ONCE and shared by both halves below: the label
            // asks its question ABOUT the sentence being printed, and
            // `seedFailureCause` now reaches through `cause`, so a second
            // derivation is a chance for the marker to describe a sentence this
            // line is not printing.
            const causeSentence = seedFailureCause(err);
            this.logger.error(
              `[SeedLoader] Deferred reference back-fill FAILED — ${deferred.objectName}.${deferred.field} ` +
                `is NULL at the end of pass 2 on record '${recordName}'. The row itself was seeded, so every row counter looks healthy ` +
                `while the circular relationship is HALF-WRITTEN: nothing links it to ${deferred.targetObject}.` +
                `${deferred.targetField} = '${this.formatAttempted(deferred.attemptedValue)}'. Nothing retries this — ` +
                `fix the write error below (a transient failure that outlasted the retry budget, or a validation rule ` +
                `vetoing the update) and re-run the seed to complete the link. ` +
                // [#8442] Same cause vocabulary as the pass-1 write sites: the
                // raw sentence always, MARKED when the payload half withheld it
                // so an operator can see the reporter did not receive this line.
                `${seedCauseLabel(err, causeSentence)}: ${causeSentence}. ${PASS_2_SCOPE_NOTE}`,
              err instanceof Error ? err : undefined,
              {
                object: deferred.objectName,
                field: deferred.field,
                target: `${deferred.targetObject}.${deferred.targetField}`,
                recordIndex: deferred.recordIndex,
              },
            );
            // [#8442] The pass-2 counterpart of `buildWriteError`'s tail, and
            // the same rule: the located structure (which object, which field,
            // which target, which record) is authored here and untouched; only
            // the caught sentence is gated. The `logger.error` above is this
            // site's operator half — it runs on THIS path, in this same catch,
            // and carries the raw cause under {@link seedCauseLabel}, the same
            // marked vocabulary the pass-1 sites use. Both halves are pinned:
            // an assertion on the pass-2 logger lives beside the payload one in
            // `seed-loader-driver-text.test.ts`, so a later edit that withholds
            // here too cannot stay green.
            this.recordDeferredError(deferred, allResults, allErrors,
              `Failed to write deferred reference: ${deferred.objectName}.${deferred.field} = '${this.formatAttempted(deferred.attemptedValue)}' → ${deferred.targetObject}.${deferred.targetField}: ${quotableSeedFailureDetail(err) ?? WITHHELD_WRITE_REASON}`);
          }
        } else {
          // THE TARGET RESOLVED BUT THE SOURCE ROW HAS NO ID (#5127, commit 9a884c6e4).
          //
          // Pass 2 did its job — `resolvedValue` is a real internal id — and
          // then found no internal id to write it ONTO. Since commit 9a884c6e4 captures
          // the internal id AT INSERT TIME for every row this load writes
          // (keyed or keyless), the one way left to get here is that the
          // source row NEVER LANDED: its pass-1 write failed (already
          // reported at `error` by the write site, #4729) or returned no id.
          // The "pure silent loss" before commit 9a884c6e4 — row written fine but its key
          // evaluated empty, so pass 2's externalId re-resolution had no
          // handle — no longer exists: such a row now heals through its
          // captured internal id.
          //
          // The outcome enters `errors`/`allErrors` (recorded AND logged at
          // `error` per AGENTS.md → "Degradation log levels", #4632), and
          // `referencesDeferred` deliberately stays booked, exactly as the
          // sibling failure branches leave it: the counter means "deferred
          // references that never landed", and only a SUCCESSFUL back-fill
          // decrements it — the leftover count always has a matching entry in
          // `errors` explaining it.
          //
          // Two spellings of one failure, split on how the record can be
          // NAMED: a record with a natural key is called by it; a keyless (or
          // empty-keyed) record can only be called by its index. Both lines
          // point AT the pass-1 write error instead of restating it — one
          // line, not a second flood over the same root cause.
          const missedTarget = this.formatAttempted(deferred.attemptedValue);
          const where = `${deferred.targetObject}.${deferred.targetField} = '${missedTarget}'`;
          if (deferred.recordExternalId === '') {
            this.logger.error(
              `[SeedLoader] Deferred reference DROPPED — ${deferred.objectName}.${deferred.field} is never written ` +
                `on record #${deferred.recordIndex}. Pass 2 RESOLVED the target (${where}) and then had ` +
                `nowhere to write it: this load captured no internal id for that ${deferred.objectName} record, ` +
                `because its pass-1 write FAILED (reported as its own \`error\` above) or returned no id — and its ` +
                `externalId (\`${deferred.externalIdLabel}\`) evaluated to the empty key, so no natural-key ` +
                `fallback can name a row either. Nothing retries this: pass 2 back-fills only rows this load ` +
                `actually seeded, and it is the last pass. Fix the pass-1 write error reported for ` +
                `${deferred.objectName} record #${deferred.recordIndex} and re-run the seed — the row and this ` +
                `link land together or not at all.`,
              undefined,
              {
                object: deferred.objectName,
                field: deferred.field,
                target: `${deferred.targetObject}.${deferred.targetField}`,
                recordIndex: deferred.recordIndex,
                recordExternalId: deferred.recordExternalId,
              },
            );
            this.recordDeferredError(deferred, allResults, allErrors,
              `Deferred reference dropped: ${deferred.objectName}.${deferred.field} = '${missedTarget}' → ` +
                `${deferred.targetObject}.${deferred.targetField} resolved, but no internal id was captured for ` +
                `${deferred.objectName} record #${deferred.recordIndex} in this load (its pass-1 write failed), ` +
                `so the back-fill could not be written`);
          } else {
            this.logger.error(
              `[SeedLoader] Deferred reference DROPPED — ${deferred.objectName}.${deferred.field} is never written ` +
                `on record '${recordName}'. Pass 2 RESOLVED the target (${where}) and then had ` +
                `nowhere to write it: this load registered no internal id for that ${deferred.objectName} record, ` +
                `because its pass-1 write FAILED (reported as its own \`error\` above) or returned no id. Nothing ` +
                `retries this: pass 2 back-fills only rows this load actually seeded, and it is the last pass. ` +
                `Fix the pass-1 write error reported for ${deferred.objectName} '${recordName}' ` +
                `and re-run the seed — the row and this link land together or not at all.`,
              undefined,
              {
                object: deferred.objectName,
                field: deferred.field,
                target: `${deferred.targetObject}.${deferred.targetField}`,
                recordIndex: deferred.recordIndex,
                recordExternalId: deferred.recordExternalId,
              },
            );
            this.recordDeferredError(deferred, allResults, allErrors,
              `Deferred reference dropped: ${deferred.objectName}.${deferred.field} = '${missedTarget}' → ` +
                `${deferred.targetObject}.${deferred.targetField} resolved, but no internal id was registered for ` +
                `${deferred.objectName} '${recordName}' in this load (its pass-1 write failed), so ` +
                `the back-fill could not be written`);
          }
        }
      } else {
        // Still unresolved after pass 2 — the target never materialized. Name
        // the element that missed: on a multi-value field only one of several
        // natural keys is usually at fault.
        //
        // Logged at `error` for the same reason the back-fill-write failure
        // above is, and aligned with it under the same objective criterion
        // (#4997, extending #4729/#5001): this outcome enters `allErrors` and
        // bumps `errored`, and until now it was the file's other
        // counted-but-never-logged branch. The row itself WAS seeded, so every
        // row counter reads healthy while the association it declared is
        // permanently absent.
        const missedValue = this.formatAttempted(stillUnresolved ? missingItem : deferred.attemptedValue);
        // [#33207] Why no row answered, said as what it is: a refused probe is
        // not an absent row, and a person outside the load's organization is
        // not resolved on purpose.
        const why = missingProbe?.refusal
          ? `because the probe into ${missingProbe.refusal.object} by ${missingProbe.refusal.field} was REFUSED ` +
            `(${missingProbe.refusal.code}) and never ran, so this is not evidence that no such row exists. Fix ` +
            `what the refusal names (logged above, once) and re-run the seed to complete the link.`
          : missingProbe?.nonMemberOf
            ? `because the ${deferred.targetObject} row that answers to it is not a member of organization ` +
              `${missingProbe.nonMemberOf}, the organization this load seeds, and a person from outside it is ` +
              `never borrowed. Add that person to the organization (or name a member) and re-run the seed.`
            : `because no such ${deferred.targetObject} row exists — neither seeded in this load nor already in ` +
              `the database. Add the missing ${deferred.targetObject} record to the seed (or fix the natural key ` +
              `that names it) and re-run the seed to complete the link.`;
        this.logger.error(
          `[SeedLoader] Deferred reference UNRESOLVED after pass 2 — ${deferred.objectName}.${deferred.field} ` +
            `is NULL at the end of pass 2 on record '${recordName}'. The row itself was seeded, so every row ` +
            `counter looks healthy while the relationship is MISSING: nothing links it to ` +
            `${deferred.targetObject}.${deferred.targetField} = '${missedValue}', ${why} ` +
            `No further seed pass retries this: pass 2 is the last one. ` +
            PASS_2_SCOPE_NOTE,
          undefined,
          {
            object: deferred.objectName,
            field: deferred.field,
            target: `${deferred.targetObject}.${deferred.targetField}`,
            recordIndex: deferred.recordIndex,
          },
        );
        this.recordDeferredError(deferred, allResults, allErrors,
          `Deferred reference unresolved after pass 2: ${deferred.objectName}.${deferred.field} = '${missedValue}' → ${deferred.targetObject}.${deferred.targetField} not found` +
            (missingProbe?.refusal
              ? `; the probe was refused (${missingProbe.refusal.code}), so this is not evidence that no such row exists`
              : missingProbe?.nonMemberOf
                ? `; the ${deferred.targetObject} row that answers to it is not a member of organization ${missingProbe.nonMemberOf}`
                : ''));
        // [#34458] A person can appear after the seed — the first admin signs
        // up after the boot seed ran — so a missed person is held for
        // `resolveHeldPersonReferences`, on the row this load landed on.
        const heldRowId = deferred.internalId
          ?? insertedRecords.get(deferred.objectName)?.get(deferred.recordExternalId);
        if (stillUnresolved && deferred.targetObject === SystemObjectName.USER && heldRowId) {
          this.heldPersonReferences.push({
            objectName: deferred.objectName,
            recordId: heldRowId,
            field: deferred.field,
            targetObject: deferred.targetObject,
            targetField: deferred.targetField,
            attemptedValue: deferred.attemptedValue,
            multiple: deferred.multiple === true,
            rowOrganization: deferred.rowOrganization,
            organizationId,
          });
        }
      }
    }
  }

  /**
   * Write ONE pass-2 back-fill — the update that turns a deferred reference
   * from NULL into the resolved id.
   *
   * Uses SEED_OPTIONS like every other seed write: this pass is still seeding,
   * so it must carry `skipTriggers` too. Inlining a bare `{ isSystem: true }`
   * here re-fired record-change automation on freshly seeded rows — `isSystem`
   * does NOT suppress trigger dispatch, only `skipTriggers` does — which is
   * exactly the self-trigger vector SEED_OPTIONS exists to prevent (#3760).
   *
   * Extracted (rather than inlined at the call site) so the durability gate can
   * SEE this seam: `scripts/check-durability-degradation-log-level.mjs` matches
   * a guarded `try` by the callee name it finds in the block, and it
   * deliberately does not descend into nested function bodies — the engine
   * write here lives inside the `withTransientRetry` closure, where no AST scan
   * of the try block can reach it. `writeDeferredReference` is listed in that
   * script's `DURABILITY_CRITICAL_CALLEES`, so a future edit that quietly drops
   * the caller's `logger.error` back to `warn` fails CI instead of shipping
   * (#4729; the rule is #4632, the accident it comes from is #4420).
   */
  private async writeDeferredReference(
    deferred: DeferredUpdate,
    recordId: string,
    resolvedValue: unknown,
  ): Promise<void> {
    const updated = await withTransientRetry(() => this.engine.update(deferred.objectName, {
      id: recordId,
      [deferred.field]: resolvedValue,
    }, this.writeOptionsFor(deferred.rowOrganization) as any)); // [#33206] the organization the row was written as
    // [#33206] A by-id update that matched no row answers `null`: the row is
    // gone since pass 1, or (under a walled posture) the organization the write
    // carries cannot see it. The link was NOT written, so it is never counted
    // as resolved: the caller reports it like any other failed back-fill.
    if (updated === null) {
      throw new Error(
        `The back-fill update of ${deferred.objectName} '${recordId}' matched no row: the row is gone, or the ` +
          `organization the write carries cannot see it.`,
      );
    }
  }

  /**
   * Record a pass-2 (deferred) reference failure as a first-class error: it
   * lands in the object's per-result `errors`, bumps its `errored` count (so
   * `summary.totalErrored` is truthful), and joins `allErrors` (so the load
   * reports `success: false`). ALL THREE pass-2 failure modes route through here
   * so none can leave an incomplete relationship reported as a clean load
   * (framework#2805): the target is still missing, the back-fill write threw,
   * or — the mode that used to fall out of `resolveDeferredUpdates` without
   * reaching any of this (#5127) — the target resolved but the source record has
   * no registered internal id to write it onto.
   */
  private recordDeferredError(
    deferred: DeferredUpdate,
    allResults: SeedLoadResultParsed[],
    allErrors: ReferenceResolutionError[],
    message: string,
  ): void {
    const error: ReferenceResolutionError = {
      sourceObject: deferred.objectName,
      field: deferred.field,
      targetObject: deferred.targetObject,
      targetField: deferred.targetField,
      attemptedValue: deferred.attemptedValue,
      recordIndex: deferred.recordIndex,
      message,
    };
    const resultEntry = allResults.find(r => r.object === deferred.objectName);
    if (resultEntry) {
      resultEntry.errors.push(error);
      resultEntry.errored++;
    }
    allErrors.push(error);
  }

  // ==========================================================================
  // Internal: Write Operations
  // ==========================================================================

  /**
   * The seed-write options every write in this loader uses — the shared
   * {@link SEED_WRITE_EXECUTION_CONTEXT} posture, wrapped in the options bag
   * the engine's write methods take.
   *
   * The posture itself (system-elevated, automation suppressed, state-machine
   * exempt) and why each flag is load-bearing are documented once, on that
   * export in `@objectstack/spec/kernel`. What is specific to this loader:
   * `isSystem` is what lets a seed target system tables like `sys_*` and what
   * disables the SecurityPlugin's auto-injection of `organization_id` /
   * `owner_id`, so seeds either declare those fields explicitly per record or
   * are intentionally cross-tenant / global. Lifecycle HOOKS
   * (derived/default fields, validation) still run.
   */
  private static readonly SEED_OPTIONS = { context: SEED_WRITE_EXECUTION_CONTEXT } as const;

  /**
   * [#33206] The options bag every write of the CURRENT {@link load} uses: the
   * shared seed posture, with `tenantId` set to the organization the load
   * stamps its rows with, so a hook on a seeded row sees that organization as
   * `ctx.session.organizationId`, as it does on the same row written through
   * the API. A load with no organization (neither pinned nor derived) keeps
   * {@link SEED_OPTIONS} itself. Set once per load, after the organization is
   * known. A row that supplies its own, different `organization_id` is
   * written with that one instead: see {@link writeOptionsFor}.
   */
  private seedOptions: { readonly context: Record<string, unknown> } = SeedLoaderService.SEED_OPTIONS;

  /** [#33206] The organization {@link seedOptions} carries, or `undefined` for a load with none. */
  private writeOrganization: string | undefined;

  /** [#33206] Per-load bags for rows that supply an organization other than the load's, by organization. */
  private rowWriteOptions = new Map<string, { readonly context: Record<string, unknown> }>();

  /**
   * [#33206] The options bag one row is written with. A record that supplies
   * its own `organization_id` keeps it (the stamp never overrides it), so its
   * writes carry THAT organization: its hooks see the organization the row is
   * really stamped with, and under a walled posture its by-id writes (an
   * update of an existing row, the pass-2 back-fill of a deferred reference)
   * are scoped to the organization the row lives in, where the load's own
   * would match no row. Every other row, and every write of a load with no
   * organization, uses {@link seedOptions} unchanged.
   */
  private writeOptionsFor(rowOrganization: unknown): { readonly context: Record<string, unknown> } {
    if (
      !this.writeOrganization ||
      typeof rowOrganization !== 'string' ||
      rowOrganization === '' ||
      rowOrganization === this.writeOrganization
    ) {
      return this.seedOptions;
    }
    let bag = this.rowWriteOptions.get(rowOrganization);
    if (!bag) {
      bag = { context: { ...SEED_WRITE_EXECUTION_CONTEXT, tenantId: rowOrganization } };
      this.rowWriteOptions.set(rowOrganization, bag);
    }
    return bag;
  }

  /**
   * [#33207] How many members of the load's organization one page of the
   * membership probe weighs (#33280: the probe pages the organization's
   * members by keyset, never the people a key names). The page only bounds
   * each read and the `$in` list the person read carries; an organization
   * smaller than one page is answered by one member read and one person read.
   */
  private static readonly MEMBER_PROBE_PAGE = 500;

  /**
   * The engine write {@link writeRecoveringSummary} guards, as a NAMED callee.
   *
   * Extracted for the same reason {@link writeDeferredReference} is:
   * `scripts/check-durability-degradation-log-level.mjs` recognises a guarded
   * `try` by the callee names it finds in the block and deliberately does not
   * descend into nested function bodies, so the `fn()` parameter this used to
   * call directly was invisible to it — no ledger entry could ever have
   * matched. `performSeedWrite` is listed in that script's
   * `DURABILITY_CRITICAL_CALLEES`, which is what makes the `logger.error`
   * below enforced rather than merely written down (#4998; the rule is #4632).
   */
  private async performSeedWrite<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }

  /**
   * Run an engine write; if it fails ONLY because a post-write roll-up summary
   * recompute exhausted its retries (framework#3147, `code`
   * 'ERR_SUMMARY_RECOMPUTE'), the record WAS written — return the written
   * value rather than re-writing (which would duplicate). Matched by `code` so
   * we needn't import objectql (which depends on this package — importing back
   * would cycle). Any other error propagates.
   *
   * The RECOVERY is unchanged; what it costs is now reported honestly (#4998).
   * A roll-up summary is a persisted DERIVED column on the parent record, so
   * exhausting its recompute retries leaves the database internally
   * inconsistent — detail rows say one thing, the column that summarizes them
   * says another — and nothing recomputes it until some later write touches
   * the same parent, which after a seed may never happen. That is the #4632
   * durability class exactly ("persisted state and runtime state disagree
   * while everything looks normal"), so it logs at `error` naming the
   * consequence and the remedy.
   *
   * It is also COUNTED, into `SeedLoadResultParsed.summariesStale` /
   * `summary.totalSummariesStale`, because a log line is not something a
   * caller can branch on. `success` deliberately stays `true`: the rows landed,
   * and every consumer of this result treats `success: false` as "the write
   * failed" — the protocol seed-apply surface returns it with an EMPTY errors
   * array, the runtime boot banner prints a "0 dropped record(s)" line, and the
   * package/marketplace installers fail an install that in fact wrote every
   * row. The new counter carries the signal instead.
   */
  private async writeRecoveringSummary<T>(objectName: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.performSeedWrite(fn);
    } catch (e: any) {
      if (e?.code === 'ERR_SUMMARY_RECOMPUTE') {
        this.reportStaleSummaries(objectName, e);
        return e.written as T;
      }
      throw e;
    }
  }

  /**
   * Count and announce the roll-up summaries a recovered write left stale.
   *
   * Split out of {@link writeRecoveringSummary}'s catch so the counting and the
   * `error` line are one unit: raising the level without counting was half the
   * #4998 defect, and counting without raising the level was the other half.
   */
  private reportStaleSummaries(objectName: string, e: SummaryRecomputeLike): void {
    const failures = Array.isArray(e.failures) ? e.failures : [];
    // One entry per parent record whose summary field could not be recomputed.
    // If the producer sent no usable list we still KNOW at least one summary is
    // stale — the error code says so — and counting 0 would restore exactly the
    // invisibility this counter exists to remove.
    const staleCount = failures.length || 1;
    const columns = [...new Set(
      failures
        .filter(f => f?.parentObject && f?.field)
        .map(f => `${f.parentObject}.${f.field}`),
    )];
    this.summariesStale += staleCount;
    this.logger.error(
      `[SeedLoader] roll-up summary recompute FAILED after retries while seeding ${objectName} — ` +
      `${staleCount} persisted summary value(s) on ` +
      `${columns.length > 0 ? columns.join(', ') : 'the parent record(s)'} now hold STALE values: ` +
      `they disagree with the detail rows they summarize, and nothing recomputes them on its own. ` +
      `The seeded rows themselves WERE written and are deliberately NOT re-written (that would ` +
      `duplicate them), so this load still reports success: true with every row counter clean — ` +
      `the machine-readable trace is summariesStale on this object's result ` +
      `(summary.totalSummariesStale for the load). Fix the recompute error below and re-run the ` +
      `seed, or trigger any write on the affected parent record(s) to force a recompute. ` +
      `Cause: ${e?.message ?? 'unknown'}`,
      e instanceof Error ? e : undefined,
      {
        object: objectName,
        summariesStale: staleCount,
        summaryColumns: columns,
        failures: failures.map(f => ({
          parentObject: f?.parentObject,
          parentId: f?.parentId,
          field: f?.field,
          error: f?.error instanceof Error ? f.error.message : f?.error,
        })),
      },
    );
  }

  private async writeRecord(
    objectName: string,
    record: Record<string, unknown>,
    mode: string,
    externalId: string | string[],
    existingRecords: Map<string, any> | undefined,
    comparands: ReplayComparands,
    rowOrganization: unknown,
  ): Promise<{ action: 'inserted' | 'updated' | 'skipped'; id?: string; uncompared?: readonly string[] }> {
    const existing = existingRecords?.get(this.externalIdKey(record, externalId));
    // [#33206] The organization the row carries, read from its tenant column by the caller.
    const opts = this.writeOptionsFor(rowOrganization) as any;

    switch (mode) {
      case 'update': {
        if (!existing) {
          return { action: 'skipped' };
        }
        const id = this.extractId(existing);
        if (this.isNoOpReplay(record, existing, comparands)) {
          return { action: 'skipped', id, uncompared: this.uncomparedCredentialFields(record, existing, comparands) };
        }
        await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.update(objectName, { ...record, id }, opts)));
        return { action: 'updated', id };
      }

      case 'upsert': {
        if (existing) {
          const id = this.extractId(existing);
          if (this.isNoOpReplay(record, existing, comparands)) {
            return { action: 'skipped', id, uncompared: this.uncomparedCredentialFields(record, existing, comparands) };
          }
          await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.update(objectName, { ...record, id }, opts)));
          return { action: 'updated', id };
        } else {
          const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
          return { action: 'inserted', id: this.extractId(result) };
        }
      }

      case 'ignore': {
        if (existing) {
          return { action: 'skipped', id: this.extractId(existing) };
        }
        const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }

      // The retired `insert` / `replace` (#34613) never reach here:
      // `loadDataset` refuses a mode outside the live set before any write.
      default: {
        const result = await this.writeRecoveringSummary(objectName, () => withTransientRetry(() => this.engine.insert(objectName, record, opts)));
        return { action: 'inserted', id: this.extractId(result) };
      }
    }
  }

  /** Rows per batch for the buffered-insert flush. See framework#2678. */
  private static readonly BULK_BATCH_SIZE = 200;

  /** [#26670] Rows per buffered-insert batch for a dataset that carries seed files (see `insertBatchSize`). */
  private static readonly SEED_FILE_BATCH_SIZE = 20;

  /**
   * Decide what {@link loadDataset}'s non-self-referencing (batched) path
   * should do with a record — mirrors {@link writeRecord}'s mode/existing
   * logic exactly, but WITHOUT performing the write, so insert decisions can
   * be buffered and flushed as a batch instead of one call per record.
   */
  private decideWriteAction(
    record: Record<string, unknown>,
    mode: string,
    externalId: string | string[],
    existingRecords: Map<string, any> | undefined,
    comparands: ReplayComparands,
  ):
    | { action: 'insert' }
    | { action: 'update'; id: string }
    | { action: 'skip'; id?: string; uncompared?: readonly string[] } {
    const key = this.externalIdKey(record, externalId);
    const existing = existingRecords?.get(key);

    switch (mode) {
      case 'update':
        if (!existing) return { action: 'skip' };
        return this.isNoOpReplay(record, existing, comparands)
          ? { action: 'skip', id: this.extractId(existing), uncompared: this.uncomparedCredentialFields(record, existing, comparands) }
          : { action: 'update', id: this.extractId(existing)! };
      case 'upsert':
        if (!existing) return { action: 'insert' };
        return this.isNoOpReplay(record, existing, comparands)
          ? { action: 'skip', id: this.extractId(existing), uncompared: this.uncomparedCredentialFields(record, existing, comparands) }
          : { action: 'update', id: this.extractId(existing)! };
      case 'ignore':
        return existing ? { action: 'skip', id: this.extractId(existing) } : { action: 'insert' };
      default:
        return { action: 'insert' };
    }
  }

  /**
   * A seed replay (dev-server restart, package re-publish) re-loads the same
   * records over existing rows. When nothing the seed declares actually
   * differs, rewriting the row is pure churn: `updated_at` gets bumped every
   * boot, lifecycle validation re-runs (a state_machine rule can even veto
   * the no-op), and history tracking logs a phantom edit. Skip those.
   *
   * Only fields PRESENT in the seed record are compared (the row's extra
   * columns — audit fields, values edited at runtime that the seed does not
   * pin — never block the skip). Comparison is conservative: any doubt
   * (unparseable dates, type mismatches) reads as "changed", falling back to
   * the historical update behavior.
   *
   * [#24562] A field the object declares `datetime`, `date` or `time`
   * (`comparands.temporal`, from {@link temporalFieldKinds}) is compared in its
   * STORED form: both sides go through `temporalStorageForm`, the one rule
   * every driver applies on write (ADR-0053). The question a replay asks is
   * whether writing the seed value would change what the column holds, and a
   * driver stores `'09:15'` as `'09:15:00'` and `'…T14:30:00Z'` as
   * `'…T14:30:00.000Z'` — so two spellings of one instant, one calendar day or
   * one wall clock are the same stored value and the row is skipped. Read
   * literally, they rewrote the row on every boot.
   *
   * [#24624] A field the read path masks (`comparands.masked`, from
   * {@link maskedOnReadFields}) never blocks the skip by its value: the
   * existing row was read through `engine.find`, which serves a set `secret`,
   * and a set `password` on an object not managed by better-auth, as
   * `SECRET_MASK` in every context (ADR-0100), so the seed's plaintext has
   * nothing to be compared with. Ruled letter B: such a field is not compared,
   * a seed change to it alone is not applied on replay, and the load says so
   * once ({@link reportUncomparedCredentials}); a change to any other field
   * still rewrites the whole seeded record, the credential included. Only a
   * SET value is uncomparable — the mask is presence-preserving, so an unset
   * credential reads back `null` and setting or clearing one is still a
   * change. No unmasked read is taken for this; the loader never sees a
   * stored credential.
   *
   * [#29277] A seed BLANK is compared in the form the write door stores it
   * (`comparands.blankAsNull`, from `blankAsNullColumns` in `@objectstack/core`
   * — the rule the door itself applies, never a second spelling of it): a
   * seed `''` on an optional `select` / `lookup`, on an optional unique text
   * column, or any blank on a number / boolean / date column lands as `null`,
   * so against a stored `null` it is no change. Only the SEED side is put in
   * stored form, and only on those columns: elsewhere `''` against `null` is
   * still a change, because there the door keeps `''`.
   *
   * Pure: {@link decideWriteAction} asks it up to three times per record.
   */
  private isNoOpReplay(
    record: Record<string, unknown>,
    existing: Record<string, unknown>,
    comparands: ReplayComparands,
  ): boolean {
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id') continue;
      if (SeedLoaderService.isUncomparableCredential(key, value, existing[key], comparands)) continue;
      const seedStored = blankStorageForm(value, comparands.blankAsNull.get(key));
      if (!this.seedValueEquals(seedStored, existing[key], comparands.temporal.get(key))) return false;
    }
    return true;
  }

  /**
   * [#24624] The credential fields of `record` a no-op replay skips without
   * comparing — what the skip site records for the load's one notice line.
   */
  private uncomparedCredentialFields(
    record: Record<string, unknown>,
    existing: Record<string, unknown>,
    comparands: ReplayComparands,
  ): readonly string[] {
    if (comparands.masked.size === 0) return [];
    return Object.entries(record)
      .filter(([key, value]) => key !== 'id' && SeedLoaderService.isUncomparableCredential(key, value, existing[key], comparands))
      .map(([key]) => key);
  }

  /**
   * [#24624] Whether the replay must not compare this field: the definition
   * declares it masked on read, the existing row read it back as the mask (a
   * value IS set), and the seed sets one too. Both declaration and mask are
   * required: a field the definition does not mask is compared even when it
   * holds the mask's text, and a field the engine did not mask (an exempt
   * object) never reads back as the mask.
   */
  private static isUncomparableCredential(
    key: string,
    seedValue: unknown,
    stored: unknown,
    comparands: ReplayComparands,
  ): boolean {
    return comparands.masked.has(key) && stored === SECRET_MASK && seedValue != null;
  }

  /**
   * Loose equality across driver round-trip representations (see isNoOpReplay).
   *
   * `kind` is the field's declared temporal kind, when it has one: both sides
   * are then compared in the storage form of that kind, and equal only when
   * that form is the same TEXT. `temporalStorageForm` hands a value it cannot
   * read back unchanged (it never invents one), so an unparseable value keeps
   * reading as changed against anything but its own identical spelling — the
   * "any doubt reads as changed" rule — and a non-text result (an Invalid
   * Date, a structure) is never equal.
   */
  private seedValueEquals(a: unknown, b: unknown, kind?: TemporalComparandKind): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    if (kind) {
      const stored = temporalStorageForm(a, kind);
      return typeof stored === 'string' && stored === temporalStorageForm(b, kind);
    }
    // Booleans come back as 0/1 from SQLite.
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      const toNum = (v: unknown) => (typeof v === 'boolean' ? Number(v) : Number(String(v)));
      return toNum(a) === toNum(b);
    }
    // Dates come back as driver-formatted strings or epoch numbers.
    if (a instanceof Date || b instanceof Date) {
      const toTime = (v: unknown) =>
        v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v));
      const ta = toTime(a);
      const tb = toTime(b);
      return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
    }
    if (typeof a === 'object' || typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    // number 5 vs '5' after a driver round-trip.
    return String(a) === String(b);
  }

  /**
   * Builds the same `ReferenceResolutionError` shape a failed write has always
   * reported.
   *
   * [#8442] Every STRUCTURED key is unchanged — `sourceObject`, `field`,
   * `targetObject`, `targetField`, `attemptedValue`, `recordIndex` are built
   * from the seed declaration and the record, never from the caught error, so
   * "which record, which key" is untouched by the withhold. For a single-field
   * key the authored prefix is unchanged byte for byte too (two runtime pins
   * read it); commit 460d4b807 renders the VALUE side of a COMPOSITE key — see
   * {@link externalIdDisplay} — so its `\u0000` joiner cannot reach the log.
   * What #8442 changes is only what follows the colon: a DECLARED refusal — a 4xx, or the data
   * engine's `VALIDATION_FAILED` shape, which is where "which field and why"
   * lives — is quoted whole; a driver fault is replaced by
   * {@link WITHHELD_WRITE_REASON} and goes to the log instead. See
   * {@link declaresSeedClientRefusal}.
   */
  private buildWriteError(
    objectName: string,
    record: Record<string, unknown>,
    externalId: string | string[],
    recordIndex: number,
    err: unknown,
  ): ReferenceResolutionError {
    const detail = quotableSeedFailureDetail(err) ?? WITHHELD_WRITE_REASON;
    const label = this.externalIdLabel(externalId);
    const keyValue = this.externalIdKey(record, externalId);
    return {
      sourceObject: objectName,
      field: '(write)',
      targetObject: objectName,
      targetField: label,
      // [commit 460d4b807] The STRUCTURED key keeps the real key — a datum a machine
      // reads, and JSON / util.inspect escape a control character rather than
      // emitting it. Only the message is rendered.
      attemptedValue: keyValue || null,
      recordIndex,
      message:
        `Failed to write ${objectName} record #${recordIndex} ` +
        `(${label}=${this.externalIdDisplay(keyValue)}): ${detail}`,
    };
  }

  // ==========================================================================
  // Internal: Dependency Graph
  // ==========================================================================

  /**
   * Kahn's algorithm for topological sort with cycle detection.
   */
  private topologicalSort(
    nodes: ObjectDependencyNodeParsed[],
    declared?: ReadonlyMap<string, ReadonlySet<string>>,
  ): { insertOrder: string[]; circularDependencies: string[][] } {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const objectSet = new Set(nodes.map(n => n.object));

    // Initialize
    for (const node of nodes) {
      inDegree.set(node.object, 0);
      adjacency.set(node.object, []);
    }

    // Build adjacency list and in-degree counts
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        // Exclude self-references from ordering (e.g., employee.manager_id → employee).
        // Self-referencing fields are still tracked in node.references for resolution.
        if (objectSet.has(dep) && dep !== node.object) {
          adjacency.get(dep)!.push(node.object);
          inDegree.set(node.object, (inDegree.get(node.object) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [obj, degree] of inDegree) {
      if (degree === 0) queue.push(obj);
    }

    const insertOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      insertOrder.push(current);

      for (const neighbor of (adjacency.get(current) || [])) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Detect circular dependencies
    const circularDependencies: string[][] = [];
    const remaining = nodes.filter(n => !insertOrder.includes(n.object));

    if (remaining.length > 0) {
      // Find cycles using DFS
      const cycles = this.findCycles(remaining);
      circularDependencies.push(...cycles);

      // Add remaining objects to insertOrder (they'll need multi-pass).
      // [Seed.dependsOn] Their lookup edges are left to the deferred passes,
      // as before, but a DECLARED edge is an order the load must keep: a
      // dataset depending on an object that sits behind a lookup cycle is
      // left over too, and is appended after that object. The declared edges
      // never form a cycle here (the load refuses one before it writes), and
      // with none declared the append order is the node order, as before.
      for (const object of this.orderByDeclaredEdges(remaining.map(n => n.object), declared)) {
        if (!insertOrder.includes(object)) {
          insertOrder.push(object);
        }
      }
    }

    return { insertOrder, circularDependencies };
  }

  /**
   * [Seed.dependsOn] `objects`, stably reordered so each lands after every
   * object of the list it declared a dependency on: repeatedly the first
   * object whose declared dependencies are all placed. An object caught on a
   * declared cycle (which the load refuses before using this order) keeps its
   * place at the end rather than being lost.
   */
  private orderByDeclaredEdges(
    objects: string[],
    declared: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  ): string[] {
    if (!declared || declared.size === 0) return objects;
    const pending = [...new Set(objects)];
    const inList = new Set(pending);
    const placed: string[] = [];
    const isPlaced = new Set<string>();
    while (pending.length > 0) {
      const next = pending.findIndex(object =>
        [...(declared.get(object) ?? [])].every(dep => dep === object || !inList.has(dep) || isPlaced.has(dep)));
      const [object] = pending.splice(next === -1 ? 0 : next, 1);
      placed.push(object);
      isPlaced.add(object);
    }
    return placed;
  }

  /**
   * [Seed.dependsOn] The declared edges of a load, pooled per object across
   * its datasets, and the declarations the load cannot honour: a dataset that
   * names its own object, or a name no dataset of the load seeds — told apart
   * from a name whose datasets `env` / `locale` scoped out of this load.
   * Only datasets this load seeds are judged.
   */
  private collectDeclaredDependencies(
    datasets: Seed[],
    requested: Seed[],
  ): { edges: Map<string, Set<string>>; refusals: DeclaredDependencyRefusal[] } {
    const edges = new Map<string, Set<string>>();
    const refusals: DeclaredDependencyRefusal[] = [];
    const loaded = new Set(datasets.map(d => d.object));
    const scopedOut = new Set(requested.map(d => d.object).filter(object => !loaded.has(object)));
    for (const dataset of datasets) {
      for (const target of dataset.dependsOn ?? []) {
        if (target === dataset.object) {
          refusals.push({
            object: dataset.object,
            target,
            message:
              `Seed dataset '${dataset.object}' declares dependsOn its own object: a dataset cannot load after ` +
              'itself. List the other seeded objects its hooks read, or drop the entry. The seed load was refused ' +
              'and no row was written.',
          });
          continue;
        }
        if (!loaded.has(target)) {
          refusals.push({
            object: dataset.object,
            target,
            message: scopedOut.has(target)
              ? `Seed dataset '${dataset.object}' declares dependsOn '${target}', whose datasets are all scoped out ` +
                'of this load by their env or locale, so its rows would not be there when this dataset loads. ' +
                `Scope '${dataset.object}' the same way, or widen '${target}'. The seed load was refused and no row ` +
                'was written.'
              : `Seed dataset '${dataset.object}' declares dependsOn '${target}', which no dataset of this load ` +
                'seeds. dependsOn names objects that other datasets of the same load seed; check the spelling, or ' +
                `load '${target}'s dataset together with this one. The seed load was refused and no row was written.`,
          });
          continue;
        }
        let set = edges.get(dataset.object);
        if (!set) edges.set(dataset.object, set = new Set());
        set.add(target);
      }
    }
    return { edges, refusals };
  }

  /**
   * [Seed.dependsOn] Every declared edge that closes a cycle of the combined
   * graph. The rule: a declared edge `A dependsOn B` is refused when B already
   * depends on A, directly or through any chain of edges — lookup or declared
   * (self-references excluded, as the sort excludes them). Equivalently, the
   * edge lies on a cycle, which is the one case where no order keeps it. A
   * cycle made of lookup edges alone is not this rule's: those still load in
   * deferred passes.
   */
  private findDeclaredEdgeCycles(
    nodes: ObjectDependencyNodeParsed[],
    declared: ReadonlyMap<string, ReadonlySet<string>>,
  ): DeclaredDependencyRefusal[] {
    if (declared.size === 0) return [];
    const dependsOnOf = new Map<string, string[]>();
    for (const node of nodes) {
      const deps = dependsOnOf.get(node.object) ?? [];
      for (const dep of node.dependsOn) if (dep !== node.object && !deps.includes(dep)) deps.push(dep);
      dependsOnOf.set(node.object, deps);
    }
    /** A dependency chain from `from` to `to` (both ends included), or undefined. */
    const chain = (from: string, to: string): string[] | undefined => {
      const previous = new Map<string, string>();
      const queue = [from];
      const seen = new Set([from]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === to) {
          const path = [to];
          while (path[0] !== from) path.unshift(previous.get(path[0])!);
          return path;
        }
        for (const dep of dependsOnOf.get(current) ?? []) {
          if (seen.has(dep)) continue;
          seen.add(dep);
          previous.set(dep, current);
          queue.push(dep);
        }
      }
      return undefined;
    };
    const refusals: DeclaredDependencyRefusal[] = [];
    for (const [object, targets] of declared) {
      for (const target of targets) {
        const back = chain(target, object);
        if (!back) continue;
        const cycle = [object, ...back].join(' → ');
        refusals.push({
          object,
          target,
          message:
            `Seed dataset '${object}' declares dependsOn '${target}', and that edge closes a cycle: ${cycle} ` +
            '(each arrow reads "loads after", from a lookup field or a dependsOn). No load order keeps it. Drop the ' +
            'entry, or the dependency that runs the other way. The seed load was refused and no row was written.',
        });
      }
    }
    return refusals;
  }

  /**
   * [Seed.fallback] The errors for the objects whose fallback choice this
   * load refused, one per object (`field: 'fallback'`), each named once at
   * `warn`. Every dataset still loads where its own scope admits it, so the
   * errors join the load's own and its result reads `success: false`. The
   * `warn` is a functional degradation (an organization on a locale no set
   * lists visibly gets none of that object's rows), said here because a
   * replay's consumer may report a failed load's errors at `info` only.
   */
  private reportDuplicateFallbackSets(refusals: DuplicateFallbackRefusal[]): ReferenceResolutionError[] {
    for (const refusal of refusals) {
      this.logger.warn(`[SeedLoader] ${refusal.message}`, { object: refusal.object, fallbackSets: refusal.scopes });
    }
    return refusals.map(refusal => ({
      sourceObject: refusal.object,
      field: 'fallback',
      targetObject: refusal.object,
      targetField: '(dataset)',
      attemptedValue: refusal.scopes.join(' | '),
      // The marker is the dataset's, not a row's; no row was attempted.
      recordIndex: 0,
      message: refusal.message,
    }));
  }

  /**
   * [Seed.dependsOn] The answer of a load refused for its declarations:
   * nothing written, `success: false`, one error per refused declaration
   * (`field: 'dependsOn'`). Returned rather than thrown, so every caller
   * reports it the way it reports any failed load, and none falls back to
   * writing the rows some other way.
   */
  private refuseDeclaredDependencies(
    config: SeedLoaderConfigParsed,
    graph: ObjectDependencyGraphParsed,
    refusals: DeclaredDependencyRefusal[],
    durationMs: number,
  ): SeedLoaderResultParsed {
    const errors: ReferenceResolutionError[] = refusals.map(refusal => ({
      sourceObject: refusal.object,
      field: 'dependsOn',
      targetObject: refusal.target,
      targetField: '(dataset)',
      attemptedValue: refusal.target,
      // The declaration is the dataset's, not a row's; no row was attempted.
      recordIndex: 0,
      message: refusal.message,
    }));
    // No log line of its own: the refusal is handed to the caller, which
    // reports a failed load's errors (AGENTS.md, degradation log levels).
    return this.buildResult(config, graph, [], errors, durationMs);
  }

  private findCycles(nodes: ObjectDependencyNodeParsed[]): string[][] {
    const cycles: string[][] = [];
    const nodeMap = new Map(nodes.map(n => [n.object, n]));
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (current: string, path: string[]) => {
      if (inStack.has(current)) {
        // Found a cycle
        const cycleStart = path.indexOf(current);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), current]);
        }
        return;
      }
      if (visited.has(current)) return;

      visited.add(current);
      inStack.add(current);
      path.push(current);

      const node = nodeMap.get(current);
      if (node) {
        for (const dep of node.dependsOn) {
          if (nodeMap.has(dep)) {
            dfs(dep, [...path]);
          }
        }
      }

      inStack.delete(current);
    };

    for (const node of nodes) {
      if (!visited.has(node.object)) {
        dfs(node.object, []);
      }
    }

    return cycles;
  }

  // ==========================================================================
  // Internal: Helpers
  // ==========================================================================

  /**
   * Decide the environment this load filters on, and say so when it cannot.
   *
   * Precedence: an explicit `config.env` from the host always wins (it is the
   * documented escape hatch and the only way to seed "as" another
   * environment), then `NODE_ENV`.
   *
   * When neither answers, the load stays PERMISSIVE — every dataset is seeded,
   * exactly as before this fix — but says so loudly if, and only if, a dataset
   * actually narrowed its scope. Fail-open is the deliberate choice here:
   * fail-closed would also drop a `env: ['prod']` dataset on a production host
   * that merely forgot to export `NODE_ENV`, which is a silent data-loss
   * regression strictly worse than the over-seeding it prevents. The
   * indeterminate window is narrow by construction — both first-party boot
   * paths pin `NODE_ENV` — so this is the embedded-host case, and it is now
   * signposted rather than silent.
   */
  private resolveEnvConfig(config: SeedLoaderConfigParsed, seeds: Seed[]): SeedLoaderConfigParsed {
    if (config.env) return config;

    const resolved = resolveSeedEnvFromNodeEnv();
    if (resolved) return { ...config, env: resolved };

    const scoped = seeds.filter(isEnvScopedDataset);
    if (scoped.length > 0) {
      const named = scoped
        .map(d => `${d.object} (env: ${(d.env as string[]).join(', ')})`)
        .join('; ');
      this.logger.warn(
        `[SeedLoader] Cannot determine the runtime environment — NODE_ENV is unset or names no seed ` +
          `environment, so ${scoped.length} environment-scoped dataset(s) were seeded EVERYWHERE ` +
          `instead of only where they are declared: ${named}. Set NODE_ENV ` +
          `(production | development | test) on the host, or pass an explicit \`config.env\`, to make ` +
          `\`Seed.env\` take effect.`,
        { scoped: scoped.map(d => d.object) },
      );
    }
    return config;
  }

  /**
   * Say so when datasets narrowed their locale scope and no locale was supplied.
   *
   * The locale axis is PERMISSIVE when indeterminate, for the same reason the
   * environment axis is: fail-closed would drop every locale-scoped dataset on
   * a host that simply does not pass a locale, which is a silent data-loss
   * regression strictly worse than the over-seeding it prevents.
   *
   * What it is not allowed to be is silent. `Seed.env` spent releases
   * authorable, defaulted, type-checked and completely inert because no call
   * site ever passed `config.env` (framework#4704) — and an author writing
   * `locale: ['zh-CN']` who silently receives every dataset is that failure
   * again, one axis over. Unlike `env` there is no `NODE_ENV` to resolve from,
   * so the remedy this names is the config key rather than a variable to
   * export.
   */
  private warnOnUnresolvedLocaleScope(config: SeedLoaderConfigParsed, seeds: Seed[]): void {
    if (config.locale) return;

    const scoped = seeds.filter(isLocaleScopedDataset);
    if (scoped.length === 0) return;

    this.logger.warn(
      `[SeedLoader] No locale was supplied — this load carries no \`config.locale\`, so ` +
        `${scoped.length} locale-scoped dataset(s) were seeded for EVERY locale instead of only ` +
        `where they are declared: ${scoped.map(localeScopeLabel).join('; ')}. Pass ` +
        `\`config.locale\` (a BCP-47 tag, e.g. the stack's \`i18n.defaultLocale\`) to make ` +
        `\`Seed.locale\` take effect.`,
      { scoped: scoped.map(d => d.object) },
    );
  }

  /**
   * [#25761] Say so, once per dataset, when its `columns` map names a column
   * the object does not have.
   *
   * Such a policy governs nothing, and nothing else reports it: no row writes
   * the named column, so the engine never refuses it the way it refuses an
   * unknown record key. The column it was meant for (a misspelt `status`)
   * keeps `always`, and every replay re-asserts it. `defineSeed` refuses the
   * key when it runs; this is the same check at load, where a stored `seed`
   * or a package body arrives without passing through `defineSeed`. Judged
   * against the set `defineSeed` uses — the declared fields plus the system
   * columns the platform injects on this object — and only when the
   * definition resolved with a field map: no opinion without one.
   *
   * `error`, not `warn` (AGENTS.md "Degradation log levels"): the load looks
   * normal and reports success while a job's write to the column the policy
   * was meant for is overwritten on every replay. The rows themselves are
   * valid, so they still load: refusing them would turn a policy typo into
   * missing seed data.
   *
   * The log is the one channel, on a dry run too. `result.errors` holds
   * `ReferenceResolutionError`s, each about one record (`recordIndex`), and a
   * dataset-level finding has no shape there. Unlike a dry run's possible
   * reference miss (#4997), nothing about it is simulated: the policy is
   * wrong whether or not the load writes.
   */
  private warnOnUndeclaredSeedColumns(dataset: Seed, definition: unknown): void {
    const columns = Object.keys(dataset.columns ?? {});
    if (columns.length === 0) return;
    const fields = (definition as { fields?: unknown } | null | undefined)?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
    const known = new Set<string>([...Object.keys(fields), ...resolveInjectedSystemColumns(definition).names]);
    const undeclared = columns.filter((column) => !known.has(column));
    if (undeclared.length === 0) return;
    this.logger.error(
      `[SeedLoader] The ${dataset.object} seed declares a write policy for ${undeclared.map((c) => `\`${c}\``).join(', ')}, ` +
        `which ${undeclared.length === 1 ? 'is not a column' : 'are not columns'} of ${dataset.object}: the policy governs ` +
        `nothing, and a column it was meant for keeps \`applyOn: 'always'\`, so every replay overwrites what a job ` +
        `wrote to it while this load still reports success. Name a field ${dataset.object} declares, or a system ` +
        `column the platform injects on it, as the \`columns\` key.`,
      undefined,
      { object: dataset.object, undeclaredColumns: undeclared },
    );
  }

  /**
   * Drop datasets that do not apply to the resolved locale. Runs on the
   * datasets {@link filterByEnv} kept: the axes COMPOSE by conjunction, a
   * dataset is kept when it passes `env` **and** `locale`. They stay separate
   * functions — and separate log lines — because the two answer different
   * operator questions ("why are my demo rows missing in production" vs "why
   * did the Chinese dataset load"), and a single merged message would have to
   * name a reason it did not measure.
   *
   * The mirror of {@link filterByEnv}, down to the reporting posture: skipping
   * is the declared, intended outcome of `locale: ['zh-CN']`, so it logs at
   * `info` — but it always NAMES what it dropped.
   *
   * [Seed.fallback] A dataset marked `fallback: true` that the locale would
   * drop is kept instead when no locale-scoped dataset of its object lists
   * the locale ({@link objectsWithLocaleMatch}), and that is named too —
   * unless its object is in `refusedFallbackObjects` (two distinct marked
   * sets, {@link findDuplicateFallbackSets}): there the marker is ignored and
   * the dataset is filtered like an unmarked one. A load with no locale
   * returns every dataset above, the fallback set included.
   */
  private filterByLocale(datasets: Seed[], locale?: string, refusedFallbackObjects: ReadonlySet<string> = new Set()): Seed[] {
    if (!locale) return datasets;

    const matched = objectsWithLocaleMatch(datasets, locale);
    const kept: Seed[] = [];
    const skipped: Seed[] = [];
    const fellBack: Seed[] = [];
    for (const dataset of datasets) {
      if (datasetAllowsLocale(dataset, locale)) kept.push(dataset);
      else if (isFallbackDataset(dataset) && !matched.has(dataset.object) && !refusedFallbackObjects.has(dataset.object)) {
        kept.push(dataset);
        fellBack.push(dataset);
      } else skipped.push(dataset);
    }

    if (fellBack.length > 0) {
      this.logger.info(
        `[SeedLoader] Locale '${locale}': no dataset is scoped to it for ${fellBack.length} object(s), so their ` +
          `fallback set(s) loaded: ${fellBack.map(localeScopeLabel).join('; ')}`,
        { locale, fallback: fellBack.map(d => d.object) },
      );
    }
    if (skipped.length > 0) {
      this.logger.info(
        `[SeedLoader] Locale '${locale}': skipped ${skipped.length} dataset(s) scoped to other ` +
          `locales: ${skipped.map(localeScopeLabel).join('; ')}`,
        { locale, skipped: skipped.map(d => d.object) },
      );
    }
    return kept;
  }

  /**
   * Drop datasets that do not apply to the resolved environment.
   *
   * Skipping is the declared, intended outcome (that is what `env: ['dev']`
   * asks for), so it logs at `info` rather than crying wolf on every
   * production boot — but it always NAMES what it dropped, so "my demo rows
   * are missing" is one log line to answer instead of a mystery.
   */
  private filterByEnv(datasets: Seed[], env?: SeedEnv): Seed[] {
    if (!env) return datasets;

    const kept: Seed[] = [];
    const skipped: Seed[] = [];
    for (const dataset of datasets) {
      (datasetAllowsEnv(dataset, env) ? kept : skipped).push(dataset);
    }

    if (skipped.length > 0) {
      this.logger.info(
        `[SeedLoader] Environment '${env}': skipped ${skipped.length} dataset(s) scoped to other ` +
          `environments: ${skipped.map(d => `${d.object} (env: ${(d.env as string[]).join(', ')})`).join('; ')}`,
        { env, skipped: skipped.map(d => d.object) },
      );
    }
    return kept;
  }

  private orderDatasets(datasets: Seed[], insertOrder: string[]): Seed[] {
    const orderMap = new Map(insertOrder.map((name, i) => [name, i]));
    return [...datasets].sort((a, b) => {
      const orderA = orderMap.get(a.object) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.object) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  }

  private buildReferenceMap(
    graph: ObjectDependencyGraphParsed,
    externalIdByObject?: Map<string, string | string[]>,
  ): Map<string, ReferenceResolutionParsed[]> {
    const map = new Map<string, ReferenceResolutionParsed[]>();
    for (const node of graph.nodes) {
      if (node.references.length > 0) {
        // Resolve against the TARGET dataset's declared externalId when this
        // load carries one (copy-on-write — graph.nodes is part of the public
        // result and keeps the metadata-level 'name' default). Targets with
        // no dataset in this load (e.g. a user field → os_user) keep 'name'.
        //
        // Only a SINGLE-field externalId participates in reference resolution:
        // a reference value is one natural-key string, so a composite-key
        // target (a join table keyed by several fields) can't be matched by
        // it — such targets keep the 'name' default (they're rarely, if ever,
        // referenced by another object anyway).
        const references = externalIdByObject
          ? node.references.map(ref => {
              const datasetExternalId = externalIdByObject.get(ref.targetObject);
              return typeof datasetExternalId === 'string' && datasetExternalId !== ref.targetField
                ? { ...ref, targetField: datasetExternalId }
                : ref;
            })
          : node.references;
        map.set(node.object, references);
      }
    }
    return map;
  }

  /**
   * [#21665] Decide, for every row of a dataset authored with an `id`, which
   * id that row holds in `organizationId`. Returns authored id → assigned id,
   * or `undefined` when no row of the dataset authors an id.
   *
   * A seeded row on a tenant-scoped object belongs to the organization the
   * replay writes it for (ADR-0131: a seeded business unit is the
   * organization's business unit), and the seed contract keys rows by
   * `externalId` within that organization. An authored `id` is therefore the
   * row's identity INSIDE one organization, never across them. A primary key
   * is global, though, so the replay assigns:
   *
   *   1. the id this organization's row already has — the authored id or the
   *      derived one, whichever it finds — so a replay into the same
   *      organization matches its own row instead of inserting another;
   *   2. otherwise the authored id, while no row anywhere holds it. The first
   *      organization a seed is replayed into keeps exactly the ids the seed
   *      authored, byte for byte what it got before this rule existed;
   *   3. otherwise {@link perOrganizationSeedRowId}: the authored id is
   *      another organization's row (or an organization-less one), and is
   *      never reused.
   *
   * Two reads, both under the system context like every other seed read: this
   * organization's own ids (the same scoped read the upsert pre-load does),
   * and an unscoped probe per authored id this organization does not hold yet.
   * Rows without an authored `id` are untouched: the engine mints theirs.
   */
  private async assignReplayRowIds(
    objectName: string,
    records: ReadonlyArray<Record<string, unknown>>,
    organizationId: string,
  ): Promise<Map<string, string> | undefined> {
    const authoredIds = new Set<string>();
    for (const record of records) {
      const id = record['id'];
      if (typeof id === 'string' && id.length > 0) authoredIds.add(id);
    }
    if (authoredIds.size === 0) return undefined;

    const heldHere = await this.loadExistingRecords(objectName, 'id', organizationId);
    const assigned = new Map<string, string>();
    for (const authoredId of authoredIds) {
      const derivedId = perOrganizationSeedRowId(authoredId, organizationId);
      if (heldHere.has(authoredId)) assigned.set(authoredId, authoredId);
      else if (heldHere.has(derivedId)) assigned.set(authoredId, derivedId);
      else assigned.set(authoredId, (await this.isRowIdHeld(objectName, authoredId)) ? derivedId : authoredId);
    }
    return assigned;
  }

  /**
   * [#21665] Does ANY row of `objectName` hold `id`, in any organization or
   * none? The question {@link assignReplayRowIds} must answer before it may
   * hand a replayed row its authored id.
   *
   * A read that FAILED is not a "no": answering "free" would hand the replay
   * an id that may well be taken, and the insert would collide, which is the
   * defect this rule removes. So only the benign cause is absorbed — the
   * object's table is not provisioned yet, which holds no row by definition —
   * asked through the shared `isMissingTableError` predicate like
   * {@link loadExistingRecords}; everything else propagates with its envelope
   * intact.
   */
  private async isRowIdHeld(objectName: string, id: string): Promise<boolean> {
    try {
      const probe: EngineQueryOptions = {
        where: { id },
        fields: ['id'],
        limit: 1,
        context: { isSystem: true },
      };
      const rows = await this.engine.find(objectName, probe);
      return Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      if (!isMissingTableError(error, objectName)) throw error;
      return false;
    }
  }

  /**
   * The column `objectName`'s rows are walled per organization by:
   * `resolveTenantFieldName` on its definition, `organization_id` when that
   * resolves none or the definition cannot be read — the one reading
   * {@link probeScopeOf} scopes a reference target by. `null` for a global
   * object ({@link isGlobalSeedObject}, the probe's `global` scope): no
   * organization walls its rows and it has no such column to filter on.
   */
  private async organizationColumnOf(objectName: string): Promise<string | null> {
    let definition: unknown;
    try {
      definition = await this.resolveObjectDefinition(objectName);
    } catch {
      // The registry could not answer: keep the organization filter.
    }
    if (isGlobalSeedObject(objectName, definition)) return null;
    return resolveTenantFieldName(definition) ?? DEFAULT_TENANT_FIELD;
  }

  /**
   * Natural key → the existing row, for the write decision (see the #8896
   * note in the catch). Scoped to `organizationId`'s own rows when one is set.
   *
   * [ADR-0131 D8] One read, no NULL arm. A second read that collected the
   * keys held by rows with NO organization (so an organization-scoped
   * upsert/ignore refused to twin or adopt them) retired with those rows: the
   * organization-ownership ceremony attributes every one before a deployment
   * is certified (D10), and a new write without an organization is stamped or
   * refused (D9).
   */
  private async loadExistingRecords(
    objectName: string,
    externalId: string | string[],
    organizationId?: string,
    /** [#34800] When given, filled with every row read, by id — keyed or not. */
    byId?: Map<string, any>,
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    try {
      // Full rows (not just id + externalId): the write decision compares the
      // incoming seed record against the existing row to skip no-op replays.
      // [#25779] File fields in their STORED form: the ids a replay keeps a
      // seed file by, and compares an authored id against.
      const findArgs: Record<string, unknown> = {
        context: { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true },
      };
      // Per-tenant replay: restrict to the target tenant's own rows
      // so upsert key matching never returns another tenant's record
      // (would silently steal/overwrite rows across orgs).
      // The match runs on the column the object is walled by — a declared
      // `tenancy.tenantField`, else `organization_id` — the same reading the
      // reference probe scopes a target by (`probeScopeOf`). An object walled
      // by another column may carry no `organization_id` at all, and a filter
      // on it is refused by the driver. A global object (no organization
      // column, no tenant field) is matched unscoped, as the probe reads it:
      // every organization's replay upserts the one shared row.
      if (organizationId) {
        const organizationColumn = await this.organizationColumnOf(objectName);
        if (organizationColumn !== null) findArgs.where = { [organizationColumn]: organizationId };
      }
      const records = await this.engine.find(objectName, findArgs as any);
      for (const record of records || []) {
        const key = this.externalIdKey(record, externalId);
        if (key) {
          map.set(key, record);
        }
        const id = byId ? this.extractId(record) : undefined;
        if (id) byId!.set(id, record);
      }
    } catch (error) {
      // [#8896] Discriminate by error TYPE. This map is not a convenience —
      // it IS the decision, in all three of its callers, and an empty map is
      // the answer that means "write these rows":
      //
      //   1. the upsert/update/ignore pre-load above: an unmatched key is
      //      written as a new row, so a failed read turns every update into an
      //      INSERT — the duplicate-row outcome, against a table whose rows
      //      were simply not seen;
      //   2. `writeBatchPartial`'s `attempt > 1` recheck: `bulkWrite` is
      //      at-least-once, so a batch may have COMMITTED before its response
      //      was lost (framework#3149). The recheck is the only thing standing
      //      between that retry and a duplicate of every row it already wrote,
      //      and an empty map disarms it silently;
      //   3. `writeOne`'s per-row form of the same recheck, on the degradation
      //      path.
      //
      // The bare `catch {}` this replaces reached all three with "there are no
      // existing rows" no matter WHY the read failed — a connection drop, a
      // timeout, a permission denial, a query error — which is ADR-0110 D3's
      // exact shape: "the read found nothing" and "the read could not run" are
      // different facts, and here they have opposite consequences.
      //
      // Benign, unchanged: the object's TABLE has not been provisioned yet
      // (schema sync has not run — the seed's own write provisions it). It can
      // hold no rows, so an empty map IS the truth and every caller's "write
      // it" verdict is correct. Note the swallowed comment named a case that
      // cannot reach here at all: an object that merely "may not have records
      // yet" answers `find` with `[]`, it does not throw.
      //
      // Everything else propagates: the loader stops rather than computing a
      // write plan from data it never read. No new error code and no new
      // result field — the caller receives the read's own failure, envelope
      // intact, and the seed's existing error accounting reports it.
      if (!isMissingTableError(error, objectName)) throw error;
    }
    return map;
  }

  // ==========================================================================
  // Internal: the record of landed seed rows (#31021)
  // ==========================================================================

  /**
   * [#31021] Open this load's record of landed seed rows, or answer
   * `undefined` when the load keeps none: the loader was not asked to
   * ({@link SeedLoaderServiceOptions.landedKeys}), it is a dry run, it seeds
   * no organization, or the composition does not register the object. The
   * last two are said once — every load kept no record before this existed,
   * so neither is a loss; each is the reason a removed seed row still returns.
   */
  private async openLandedKeyLedger(config: SeedLoaderConfigParsed): Promise<LandedKeyLedger | undefined> {
    if (!this.landedKeysMode || config.dryRun) return undefined;
    const organizationId = config.organizationId ?? this.fallbackOrgId;
    if (!organizationId) {
      this.logger.info(
        `[SeedLoader] This load seeds no organization (no config.organizationId, and the install holds no sole ` +
          `organization), so it keeps no record of the seed rows it lands: a seed row a person deletes is inserted ` +
          `again by the next seed load. That record is kept per organization.`,
      );
      return undefined;
    }
    const definition = await this.resolveObjectDefinition(SEED_LANDED_KEY_OBJECT);
    if (!definition?.fields) {
      this.logger.warn(
        `[SeedLoader] '${SEED_LANDED_KEY_OBJECT}' is not registered in this composition, so this load keeps no ` +
          `record of the seed rows it lands in organization ${organizationId}: a seed row a person deletes is ` +
          `inserted again by the next seed load. Compose @objectstack/platform-objects (PlatformObjectsPlugin), ` +
          `which registers it.`,
        { organizationId },
      );
      return undefined;
    }
    return {
      organizationId,
      honour: this.landedKeysMode === 'honour',
      recorded: new Map(),
      withdrawnRows: new Map(),
      withdrawnReferences: 0,
      writeFailureReported: false,
    };
  }

  /**
   * [#31021] The keys recorded as landed for `objectName` in this load's
   * organization: read once per load and object, then grown in place as the
   * load records more.
   */
  private async landedKeysOf(objectName: string): Promise<Set<string>> {
    const ledger = this.landedKeyLedger!;
    const cached = ledger.recorded.get(objectName);
    if (cached) return cached;
    const keys = new Set<string>();
    try {
      const query: EngineQueryOptions = {
        where: { organization_id: ledger.organizationId, object_name: objectName },
        fields: ['seed_key'],
        context: { isSystem: true },
      };
      const rows = await this.engine.find(SEED_LANDED_KEY_OBJECT, query);
      for (const row of rows || []) {
        const key = (row as { seed_key?: unknown } | null | undefined)?.seed_key;
        if (typeof key === 'string' && key !== '') keys.add(key);
      }
    } catch (error) {
      // Discriminated by error TYPE, as `loadExistingRecords` is: a table not
      // provisioned yet holds no row, so an empty record is the truth there.
      // Any other failure propagates — an empty record read from a store that
      // never answered would insert again every row a person removed.
      if (!isMissingTableError(error, SEED_LANDED_KEY_OBJECT)) throw error;
    }
    ledger.recorded.set(objectName, keys);
    return keys;
  }

  /**
   * [#31021] Does the record name the row a reference into `targetObject` by
   * `targetField` = `value` points at as landed in this organization? Asked
   * only after every probe for that row missed, so a yes means it is gone.
   */
  private async isWithdrawnSeedTarget(targetObject: string, targetField: string, value: string): Promise<boolean> {
    if (!this.landedKeyLedger?.honour) return false;
    return (await this.landedKeysOf(targetObject)).has(seedLandedKey({ [targetField]: value }, targetField));
  }

  /**
   * [#31021] Record `keys` as landed for `objectName` in this load's
   * organization, in batches; `recordedKeys` grows by what was written.
   *
   * A failed write is `error`, said once per load: the rows landed and look
   * seeded, while the record that keeps a person's removal from being undone
   * is missing for them (AGENTS.md → "Degradation log levels"). It fails no
   * row and no load — the rows are there — and it heals on its own: the next
   * load records every row still present.
   */
  private async recordLandedKeys(objectName: string, keys: readonly string[], recordedKeys: Set<string>): Promise<void> {
    const ledger = this.landedKeyLedger;
    if (!ledger || keys.length === 0) return;
    for (let start = 0; start < keys.length; start += SeedLoaderService.BULK_BATCH_SIZE) {
      const batch = keys.slice(start, start + SeedLoaderService.BULK_BATCH_SIZE);
      try {
        await this.writeLandedKeys(
          batch.map((seedKey) => ({ organization_id: ledger.organizationId, object_name: objectName, seed_key: seedKey })),
        );
      } catch (err) {
        if (!ledger.writeFailureReported) {
          ledger.writeFailureReported = true;
          const unrecorded = keys.length - start;
          this.logger.error(
            `[SeedLoader] Recording which seed rows landed FAILED for ${objectName} in organization ` +
              `${ledger.organizationId}: ${unrecorded} row(s) WERE seeded, but ${SEED_LANDED_KEY_OBJECT} does not ` +
              `record them, so the seed looks complete while a person who deletes one of them before the next seed ` +
              `load gets it back on that load (which records every row still present). Nothing retries this write ` +
              `in this load: fix the cause below. Cause: ${seedFailureCause(err)}`,
            err instanceof Error ? err : undefined,
            { object: objectName, organizationId: ledger.organizationId, unrecorded },
          );
        }
        return;
      }
      for (const key of batch) recordedKeys.add(key);
    }
  }

  /**
   * [#31021] One batch of {@link SEED_LANDED_KEY_OBJECT} rows, under the seed
   * write context every write here uses. A named callee for the reason
   * {@link writeDeferredReference} is one: the write sits inside a retry
   * closure no AST scan of the caller's `try` reaches.
   */
  private async writeLandedKeys(rows: Array<Record<string, string>>): Promise<void> {
    await withTransientRetry(() => this.engine.insert(SEED_LANDED_KEY_OBJECT, rows, this.seedOptions as any));
  }

  /**
   * [#31021] ONE line per load naming the seed rows the record kept out and
   * the references to them left alone. Logged at `info`, like
   * {@link reportUncomparedCredentials}: it is the declared, intended outcome
   * of a replay after a person removed a seed row, and it happens on every
   * healthy replay of that organization from then on — a `warn` would cry wolf.
   */
  private reportWithdrawnSeedRows(): void {
    const ledger = this.landedKeyLedger;
    if (!ledger) return;
    const rows = [...ledger.withdrawnRows.values()].reduce((sum, n) => sum + n, 0);
    if (rows === 0 && ledger.withdrawnReferences === 0) return;
    const objects = [...ledger.withdrawnRows].map(([object, n]) => `${object} (${n})`).join(', ');
    this.logger.info(
      `[SeedLoader] ${rows} seed row(s) were not inserted again${objects ? ` — ${objects}` : ''}: each landed in ` +
        `organization ${ledger.organizationId} on an earlier load and its row is gone, so a person removed it. A ` +
        `seed row the load cannot find is inserted only when its key never landed here, so a row an upgrade adds ` +
        `still lands.` +
        (ledger.withdrawnReferences > 0
          ? ` ${ledger.withdrawnReferences} reference(s) to such rows were left as they are rather than reported unresolved.`
          : '') +
        ` A deliberate re-seed brings them back: the seed-replayer service called with { reseed: true }, or an installed package's sample-data reseed.`,
      {
        organizationId: ledger.organizationId,
        rows,
        objects: Object.fromEntries(ledger.withdrawnRows),
        references: ledger.withdrawnReferences,
      },
    );
  }

  /**
   * [#33280] Whether an internal-id-shaped reference value is still judged by
   * the membership rule: only on a load pinned to an organization (the probe
   * is unscoped without one), never on a dry run (which reads no database),
   * and only for the target that resolves through membership (`sys_user`,
   * the `members` probe scope). Every other target keeps its id verbatim.
   */
  private async judgesInternalIdByMembership(
    targetObject: string,
    config: { dryRun?: boolean; organizationId?: string },
  ): Promise<boolean> {
    if (!config.organizationId || config.dryRun) return false;
    return (await this.probeScopeOf(targetObject)).kind === 'members';
  }

  private looksLikeInternalId(value: string): boolean {
    // UUID v4 pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return true;
    }
    // MongoDB ObjectId pattern (24 hex chars)
    if (/^[0-9a-f]{24}$/i.test(value)) {
      return true;
    }
    return false;
  }

  private extractId(record: any): string | undefined {
    if (!record) return undefined;
    return String(record.id || record._id || '');
  }

  /**
   * Build the natural-key string for a record given the dataset's externalId.
   *
   * A single field name keys on that one column (the historical behavior). A
   * COMPOSITE externalId — a list of field names, for objects with no single
   * natural key such as a join / junction table (`['team', 'project']`) —
   * joins the per-field values with a separator (`\u0000`) that cannot occur
   * in a natural-key value, so `('a', 'b')` and `('a\0b', '')` never collide.
   *
   * Composite key fields are usually the join table's foreign keys; by the
   * time this runs they have been RESOLVED to the parent's internal id on the
   * incoming record, and existing DB rows already store that same id, so the
   * two keys match on replay and the row dedupes (framework#3434).
   *
   * Returns '' when ANY component is absent — a partial key is not a usable
   * uniqueness key (this mirrors the single-field miss, which also yields
   * ''). A keyed load refuses such a record before it is written (#34857);
   * only a load with no keyed mode falls back to inserting it.
   */
  private externalIdKey(record: Record<string, unknown>, externalId: string | string[]): string {
    if (Array.isArray(externalId)) {
      const parts: string[] = [];
      for (const field of externalId) {
        const value = record[field];
        if (isBlankSeedKeyValue(value)) return '';
        parts.push(String(value));
      }
      return parts.join('\u0000');
    }
    return String(record[externalId] ?? '');
  }

  /** Readable rendering of an attempted reference value (`['a','b']` for a multi-value field). */
  private formatAttempted(value: unknown): string {
    return Array.isArray(value) ? JSON.stringify(value) : String(value);
  }

  /** Human-readable label for an externalId (single field, or `a+b` for a composite). */
  private externalIdLabel(externalId: string | string[]): string {
    return Array.isArray(externalId) ? externalId.join('+') : externalId;
  }

  /**
   * Human-readable rendering of a natural key built by {@link externalIdKey}.
   *
   * The key is not a display string, and it is not free to become one:
   * `externalIdKey` joins a composite key's parts with `\u0000` precisely
   * because that byte cannot occur in a natural-key value, so `('a','b')` and
   * `('a\0b','')` never collide. That separator stays exactly where it is
   * — every Map keyed by this string depends on it (framework#3434).
   *
   * What must not happen is the KEY reaching a MESSAGE. One raw NUL makes
   * `grep` classify the whole server log as binary, so every later `grep -n` /
   * `grep -c` over it silently returns nothing until the reader remembers
   * `-a`: the reader's main instrument disabled by one byte, at the moment
   * someone is diagnosing a failed boot (commit 460d4b807, measured while investigating
   * objectstack-ai/ats#20).
   *
   * A key with no `\u0000` in it — every single-field key — is returned
   * BYTE-IDENTICAL, so non-composite diagnostics do not move. A composite key
   * renders as a JSON array of its PARTS rather than a `+`-joined string:
   * `externalIdLabel` already spends `+` on the FIELD-name side, and a value
   * is an arbitrary string that may contain `+` (or ` + `) itself, so a joined
   * form is ambiguous exactly where a composite key is interesting. JSON is
   * also NUL-free by construction — it escapes control characters rather than
   * passing them through — so a value carrying one of its own cannot
   * reintroduce the defect through this path.
   */
  private externalIdDisplay(key: string): string {
    return key.includes('\u0000') ? JSON.stringify(key.split('\u0000')) : key;
  }

  private buildEmptyResult(config: SeedLoaderConfigParsed, durationMs: number): SeedLoaderResultParsed {
    return {
      success: true,
      dryRun: config.dryRun,
      dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
      results: [],
      errors: [],
      summary: {
        objectsProcessed: 0,
        totalRecords: 0,
        totalInserted: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        totalReferencesResolved: 0,
        totalReferencesDeferred: 0,
        totalReferencesDropped: 0,
        totalSummariesStale: 0,
        circularDependencyCount: 0,
        durationMs,
      },
    };
  }

  private buildResult(
    config: SeedLoaderConfigParsed,
    graph: ObjectDependencyGraphParsed,
    results: SeedLoadResultParsed[],
    errors: ReferenceResolutionError[],
    durationMs: number,
  ): SeedLoaderResultParsed {
    const summary = {
      objectsProcessed: results.length,
      totalRecords: results.reduce((sum, r) => sum + r.total, 0),
      totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
      totalUpdated: results.reduce((sum, r) => sum + r.updated, 0),
      totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
      totalErrored: results.reduce((sum, r) => sum + r.errored, 0),
      totalReferencesResolved: results.reduce((sum, r) => sum + r.referencesResolved, 0),
      totalReferencesDeferred: results.reduce((sum, r) => sum + r.referencesDeferred, 0),
      totalReferencesDropped: results.reduce((sum, r) => sum + (r.referencesDropped ?? 0), 0),
      // No `?? 0`: every result entry is built by `loadDataset`, which always
      // populates `summariesStale`. A consumer never needs the fallback either
      // — the field is declared with `.default(0)`, so it survives a parse of a
      // payload written before it existed (#4998).
      totalSummariesStale: results.reduce((sum, r) => sum + r.summariesStale, 0),
      circularDependencyCount: graph.circularDependencies.length,
      durationMs,
    };

    const hasErrors = errors.length > 0 || summary.totalErrored > 0;

    return {
      success: !hasErrors,
      dryRun: config.dryRun,
      dependencyGraph: graph,
      results,
      errors,
      summary,
    };
  }
}

// ==========================================================================
// Internal Types
// ==========================================================================

/** [Seed.fallback] One object whose fallback choice a load refuses: it marks more than one distinct set. */
interface DuplicateFallbackRefusal {
  readonly object: string;
  /** The locale scopes of the distinct marked datasets, one entry each, for the error's `attemptedValue`. */
  readonly scopes: string[];
  readonly message: string;
}

/**
 * [Seed.fallback] A dataset's declaration, for telling a second COPY of one
 * declaration from a second declaration: every key but the runtime protection
 * envelope (`_`-prefixed, stamped by the loader that read the artifact),
 * serialised with sorted keys so key order does not make two copies differ.
 */
function seedDeclarationFingerprint(dataset: Seed): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  const declared = Object.fromEntries(Object.entries(dataset as Record<string, unknown>).filter(([key]) => !key.startsWith('_')));
  return JSON.stringify(canonical(declared));
}

/**
 * [Seed.fallback] Every object for which `datasets` (the datasets `env` kept
 * for this load) mark more than one DISTINCT declaration `fallback: true`.
 * Identical copies count once: the shared per-organization replay list holds
 * a package's datasets once per merge (boot rehydrate, install or upgrade,
 * reseed), and a second copy of the one fallback set is not a second choice.
 * Object names are global, so two packages marking the same object are two
 * declarations and that object's fallback choice is refused. (An upgrade
 * replaces a package's datasets on the replay list, so two versions of one
 * package do not meet here.)
 *
 * Judged whatever the load's locale: the declaration is ambiguous on every
 * load, not only on one that needs the fallback, and a refusal that waited for
 * an unmatched locale would surface on the first organization in a new market.
 */
function findDuplicateFallbackSets(datasets: readonly Seed[]): DuplicateFallbackRefusal[] {
  const byObject = new Map<string, Map<string, Seed>>();
  for (const dataset of datasets) {
    if (!isFallbackDataset(dataset)) continue;
    const distinct = byObject.get(dataset.object) ?? new Map<string, Seed>();
    const fingerprint = seedDeclarationFingerprint(dataset);
    if (!distinct.has(fingerprint)) distinct.set(fingerprint, dataset);
    byObject.set(dataset.object, distinct);
  }
  const refusals: DuplicateFallbackRefusal[] = [];
  for (const [object, distinct] of byObject) {
    if (distinct.size < 2) continue;
    const scopes = [...distinct.values()].map(d => `locale: ${((d.locale as string[] | undefined) ?? []).join(', ')}`);
    refusals.push({
      object,
      scopes,
      message:
        `Seed datasets of '${object}' mark ${distinct.size} different sets \`fallback: true\` (${scopes.join('; ')}). ` +
        'An object has at most one fallback set: it is the one set that loads when no other set lists the ' +
        `resolved locale. No fallback was used for '${object}': each marked set still loads for the locales it ` +
        'lists, and a locale none of them lists gets none of them; every other object seeds as usual. The ' +
        `packages being seeded mark more than one set of '${object}', most often two packages marking the same ` +
        'object: keep the marker on one.',
    });
  }
  return refusals;
}

/** [Seed.dependsOn] One declaration a load refuses: `object` named `target`. */
interface DeclaredDependencyRefusal {
  readonly object: string;
  readonly target: string;
  readonly message: string;
}

/**
 * Structural view of objectql's `SummaryRecomputeError` (framework#3147).
 *
 * Declared here rather than imported because objectql depends on THIS package,
 * so importing it back would cycle — the same reason the error is matched by
 * `code` instead of `instanceof`. Every field is optional: this describes an
 * object that crossed a package boundary as `unknown`, and the reader
 * ({@link SeedLoaderService.reportStaleSummaries}) is what decides what to do
 * when a field is missing.
 */
interface SummaryRecomputeLike {
  message?: string;
  failures?: Array<{
    childObject?: string;
    parentObject?: string;
    parentId?: string;
    field?: string;
    error?: unknown;
  }>;
}

interface DeferredUpdate {
  objectName: string;
  /**
   * The source record's INTERNAL id, captured at the moment its pass-1 write
   * landed (commit 9a884c6e4). This is the handle pass 2 writes the resolved reference
   * back through: it exists for every row this load actually wrote —
   * including rows whose key (single or composite) evaluated to the empty
   * string — so the
   * "pass 2 resolved the target and had nowhere to write it" loss (#5127) is
   * reduced to the one case where it is true: the source row never landed.
   *
   * `undefined` exactly when pass 1 registered no id for this record — its
   * write failed (already reported at `error` by the write site) or returned
   * no id. Pass 2 then falls back to the `insertedRecords` natural-key map,
   * which can still name a row when ANOTHER dataset in the same load upserted
   * the same natural key.
   */
  internalId?: string;
  /**
   * The source record's natural key, as {@link SeedLoaderService.externalIdKey}
   * computed it in pass 1 — pass 2's FALLBACK lookup into `insertedRecords`
   * when {@link internalId} is absent, and the name error messages call the
   * record by. It is the KEY, `\u0000` joiner and all; the messages render it
   * through {@link SeedLoaderService.externalIdDisplay} rather than pasting it
   * (commit 460d4b807).
   *
   * May legitimately be `''`: `externalIdKey` returns the empty string when the
   * dataset declares no `externalId` and the row carries no `name`, when the
   * key field is absent or blank, and when ANY ONE component of a composite
   * externalId is. An empty key is never registered in `insertedRecords`, so
   * it can never find a record — since commit 9a884c6e4 that only matters when
   * `internalId` is ALSO absent (the row never landed). Carried verbatim (not
   * normalised to `undefined`) so pass 2 can address the record by index
   * rather than by a key it does not have.
   */
  recordExternalId: string;
  /**
   * Human-readable name of the source dataset's externalId (`name`, or `a+b` for
   * a composite) — pass 2 has no other handle on it, and an empty
   * `recordExternalId` is only actionable if the message can say WHICH key came
   * out empty (#5127).
   */
  externalIdLabel: string;
  field: string;
  targetObject: string;
  targetField: string;
  /** Authored value — one natural key, or the WHOLE array for a `multiple: true` field. */
  attemptedValue: unknown;
  /** Source field stores an array of references, so pass 2 back-fills an array. */
  multiple?: boolean;
  recordIndex: number;
  /**
   * [#33206] The `organization_id` the source row was written with, annotated
   * once its dataset has written: pass 2 back-fills the reference as the same
   * organization (`writeOptionsFor`), so a row that supplied its own
   * organization is found by its by-id update under a walled posture.
   */
  rowOrganization?: unknown;
}

/**
 * [#34458] A person reference pass 2 left NULL because no `sys_user` row
 * answered to it yet, on a row this load landed on: the deferral it came
 * from, plus the id of that row and the organization the load probed in.
 * {@link SeedLoaderService.resolveHeldPersonReferences} retries it once a
 * person exists.
 */
interface HeldPersonReference {
  readonly objectName: string;
  readonly recordId: string;
  readonly field: string;
  readonly targetObject: string;
  readonly targetField: string;
  readonly attemptedValue: unknown;
  readonly multiple: boolean;
  readonly rowOrganization?: unknown;
  readonly organizationId?: string;
}
