// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12663 — the cross-producer `sys_secret` REFERENCE UNION.
 *
 * `sys_secret` is written by **three** privileged producers, and each keeps its
 * handle in a holder column of its own (`sys_secret.object.ts` says so in the
 * `id` field's own description):
 *
 *  1. **settings** — `SettingsService` stores a bare `sec_…` handle in
 *     `sys_setting.value_enc`;
 *  2. **object-field** — the engine's `secret`-typed field channel stores
 *     `secret:<id>` on an arbitrary business row, on every `secret` field of
 *     every REGISTERED object, tenant-authored ones included;
 *  3. **datasource** — the credential binder stores `sys_secret:<id>` at a
 *     datasource artefact's `external.credentialsRef`.
 *
 * This module builds the union of those three reference sets. It is the
 * precondition #8103's deletion half is blocked on: the only sound deletion
 * predicate is "attributable AND unreferenced by the COMPLETE union".
 *
 * ## Why completeness is the whole contract
 *
 * An INCOMPLETE union is strictly worse than no union at all. The shipped
 * settings-scoped classifier (`classifySysSecretRows` in
 * `@objectstack/service-settings`) is honest about its own blindness — it
 * reports a row it cannot attribute as `unattributable`, never `orphaned` — but
 * its attribution test is `(namespace, key)` membership in the settings
 * manifests' encrypted specifiers, and that is a **name match, not ownership**.
 * `sys_secret` carries no producer column, and the three producers write the
 * two columns with three different meanings (settings namespace/specifier key ·
 * object name/field name · `datasource`/datasource name). So a LIVE credential
 * from producer 2 or 3 whose `(namespace, key)` happens to collide with a
 * declared encrypted specifier classifies `orphaned` today. That collision is
 * reproduced against real code in this module's test file, and it is the entire
 * reason this card exists.
 *
 * Downstream of an erroneous delete there is no recovery and no forensics: the
 * settings audit trail records **digests, not handles** (`old_hash`/`new_hash`
 * are content digests), so nothing can name afterwards which handle was
 * destroyed.
 *
 * Hence the two structural devices below, neither of which is decoration:
 *
 *  - **The family set is CLOSED and the assembler demands every member.**
 *    {@link buildSecretReferenceUnion} takes a `Record` keyed by
 *    {@link SecretReferenceFamily}, so forgetting a family is a *type* error
 *    rather than a union that is silently one producer short.
 *  - **A read that did not happen is a GAP, never an empty answer.** Every
 *    collector returns {@link FamilyGap} when it could not enumerate — a
 *    missing driver, an unregistered holder object, a throwing read, an engine
 *    that cannot list the datasource definitions it holds, a host that did not
 *    declare its code-defined datasources. A gap makes the union
 *    `complete: false`, and {@link assertSecretReferenceUnionComplete} refuses
 *    it. Returning `[]` there would be the read-invention defect AGENTS.md
 *    names, with a credential delete on the other end of it.
 *
 * ## Read-only by construction, and UNSCOPED on purpose
 *
 * Nothing here writes, deletes or decrypts. Handle ids and holder coordinates
 * are the only things collected — never ciphertext, never plaintext, mirroring
 * the report-only classifier's `SecretRowSnapshot` discipline.
 *
 * Reads go to the **driver**, through the engine's public
 * `getDriverForObject()`, for two reasons that point the same way:
 *
 *  - the `secret:` ref only EXISTS at driver level — `maskSecretFields`
 *    replaces it with the mask on every `find`/`findOne`, unconditionally
 *    (which is why the engine's own privileged verbs read at driver level too);
 *  - a scoped read would silently UNDER-report. Tenant scoping, sharing,
 *    field-level security and soft-delete filters all subtract rows, and every
 *    row subtracted here is a live handle that #8103 would then read as
 *    unreferenced. Under-reporting is the direction that deletes live
 *    credentials, so the union deliberately declines every filter.
 *
 * The reads also carry **no `limit`**, deliberately. Every driver in this tree
 * bounds a result only when `query.limit` is present, so an unbounded read
 * returns the whole holder set; a page size introduced here would truncate the
 * union silently on exactly the large tables where an orphan sweep matters.
 *
 * The three producer surfaces are consumed **read-only, through their own
 * published predicates** — `isSecretHandle` (service-settings),
 * `collectSecretFields`/`parseSecretRef` (objectql), `parseCredentialsRef`
 * (service-datasource). No producer needed a change to build this, and none of
 * the three ref spellings is restated here: a restated prefix is a second
 * de-facto contract that drifts silently, and the failure it produces is a
 * handle missing from the union.
 *
 * ⛔ This module contains no deletion, no sweep and no classification, and must
 * not grow one. The deletion command, its dry-run default, its mandatory
 * pre-delete export and the rule that `unattributable` is never deleted all
 * belong to #8103.
 */

import { collectSecretFields, parseSecretRef } from '@objectstack/objectql';
import { parseCredentialsRef } from '@objectstack/service-datasource';
import { isSecretHandle } from '@objectstack/service-settings';
import type { ServiceObject } from '@objectstack/spec/data';

/**
 * The closed set of producer families that can hold a `sys_secret` reference.
 *
 * Closed on purpose: {@link buildSecretReferenceUnion} keys a `Record` on this
 * union, so a fourth producer cannot be added to the platform and quietly
 * omitted here — the assembler stops compiling until the new family has a
 * collector. That is the only mechanical defence there is against the silent
 * incompleteness this module exists to prevent.
 */
export const SECRET_REFERENCE_FAMILIES = ['settings', 'object-field', 'datasource'] as const;

/** One producer/holder family. See {@link SECRET_REFERENCE_FAMILIES}. */
export type SecretReferenceFamily = (typeof SECRET_REFERENCE_FAMILIES)[number];

/**
 * One reference to a `sys_secret` handle, with the coordinates of the column
 * that holds it.
 *
 * ⛔ Deliberately carries no cipher material and no plaintext — the same
 * typing discipline as the report-only classifier's `SecretRowSnapshot`. The
 * holder coordinates are what an operator needs and what the digest-only audit
 * trail can never reconstruct after a delete.
 */
export interface SecretReference {
  /** The `sys_secret.id` this reference names. */
  handleId: string;
  /** Which producer family holds it. */
  family: SecretReferenceFamily;
  /**
   * Where the reference lives, safe to print — e.g.
   * `sys_setting(namespace=mail,key=smtp_password)`,
   * `smtp_account.password#rec_7`,
   * `datasource(main).external.credentialsRef`.
   */
  holder: string;
}

/** A family whose references were fully enumerated. */
export interface FamilyEnumeration {
  family: SecretReferenceFamily;
  status: 'enumerated';
  references: SecretReference[];
}

/**
 * A family whose references could NOT be fully enumerated.
 *
 * The distinction from `references: []` is the whole safety property: "there
 * are none" and "the read did not happen" are different facts, and only the
 * first one is safe to feed a deletion predicate.
 */
export interface FamilyGap {
  family: SecretReferenceFamily;
  status: 'gap';
  /** Why enumeration could not complete, safe to print. */
  reason: string;
  /**
   * References gathered before the gap opened. Kept because they are real —
   * a partial set still proves those handles are LIVE — but they can never
   * make the union complete.
   */
  references: SecretReference[];
}

/** Per-family outcome: either a complete enumeration or a declared gap. */
export type FamilyResult = FamilyEnumeration | FamilyGap;

/** The union. */
export interface SecretReferenceUnion {
  /**
   * Every handle id named by any family. `true` membership means the handle is
   * LIVE. Absence means "not named by what was enumerated" — which is only
   * "unreferenced" when {@link SecretReferenceUnion.complete} is true.
   */
  handleIds: ReadonlySet<string>;
  /** Every reference, with holder coordinates. Order follows family order. */
  references: readonly SecretReference[];
  /** Per-family outcome, one entry for every member of the closed set. */
  families: Readonly<Record<SecretReferenceFamily, FamilyResult>>;
  /** True only when every family enumerated. */
  complete: boolean;
  /** The declared gaps, empty when `complete`. */
  gaps: ReadonlyArray<{ family: SecretReferenceFamily; reason: string }>;
}

/**
 * Refusal to use an incomplete union as if it were complete.
 *
 * Carries the ADR-0112 pair as fields so a consumer branches on `code`/`status`
 * rather than message text. `PRECONDITION_REQUIRED` (428) is the standard
 * catalog's "request is missing a required precondition" — no ledger entry is
 * needed, and the precondition here is literal: the complete union IS the
 * precondition #8103 is blocked on.
 */
export class IncompleteSecretReferenceUnionError extends Error {
  readonly code = 'PRECONDITION_REQUIRED';
  readonly status = 428;
  readonly gaps: ReadonlyArray<{ family: SecretReferenceFamily; reason: string }>;
  constructor(gaps: ReadonlyArray<{ family: SecretReferenceFamily; reason: string }>) {
    super(
      'Refusing to treat an incomplete sys_secret reference union as complete: '
        + `${gaps.length} of ${SECRET_REFERENCE_FAMILIES.length} producer families could not be `
        + `enumerated (${gaps.map((g) => `${g.family}: ${g.reason}`).join('; ')}). `
        + 'A handle absent from a partial union is not thereby unreferenced — the missing family '
        + 'may hold it, and the sys_secret audit trail records digests, not handles, so an '
        + 'erroneous delete cannot be named afterwards. Fix the gap and re-collect.',
    );
    this.name = 'IncompleteSecretReferenceUnionError';
    this.gaps = gaps;
  }
}

/**
 * Throw unless every family enumerated.
 *
 * The one guard every consumer of this union owes. Reading
 * `union.handleIds.has(id) === false` off an incomplete union and acting on it
 * is the defect this whole module exists to prevent.
 */
export function assertSecretReferenceUnionComplete(
  union: SecretReferenceUnion,
): asserts union is SecretReferenceUnion & { complete: true } {
  if (!union.complete) throw new IncompleteSecretReferenceUnionError(union.gaps);
}

/**
 * Assemble the union from one result per family.
 *
 * Pure. The `Record` over the closed family union is the assembler's whole
 * defence: a caller that forgets a family does not get a smaller union, it
 * fails to compile.
 */
export function buildSecretReferenceUnion(
  families: Record<SecretReferenceFamily, FamilyResult>,
): SecretReferenceUnion {
  const references: SecretReference[] = [];
  const handleIds = new Set<string>();
  const gaps: Array<{ family: SecretReferenceFamily; reason: string }> = [];

  for (const family of SECRET_REFERENCE_FAMILIES) {
    const result = families[family];
    for (const ref of result.references) {
      references.push(ref);
      handleIds.add(ref.handleId);
    }
    if (result.status === 'gap') gaps.push({ family, reason: result.reason });
  }

  return { handleIds, references, families, complete: gaps.length === 0, gaps };
}

// ---------------------------------------------------------------------------
// Runtime ports — the smallest read-only slice of a booted runtime this needs.
// Structural rather than nominal so no producer package has to grow an export
// for the consumer's benefit (the contract-first split this card was fenced
// against). `ObjectQL` satisfies both today: `getConfigs()` and
// `getDriverForObject()` are public members of it.
// ---------------------------------------------------------------------------

/** The driver read this module uses. Matches `IDataDriver.find`. */
export interface SecretReferenceDriverLike {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/** The engine slice this module uses. */
export interface SecretReferenceEngineLike {
  /** Every REGISTERED object, name → schema. Family 2's enumeration source. */
  getConfigs(): Record<string, ServiceObject>;
  /** The driver serving an object, or `undefined` when none resolves. */
  getDriverForObject(objectName: string): SecretReferenceDriverLike | undefined;
  /**
   * Every datasource DEFINITION the engine holds — family 3's SECOND source,
   * covering the artefacts that never reach `sys_metadata`.
   *
   * OPTIONAL, and that is a WIDENING of this port rather than a narrowing:
   * every slice that satisfied this interface before still satisfies it, and
   * the real `ObjectQL` satisfies the new member structurally (pinned in this
   * module's test file).
   *
   * ⛔ Absence is NOT "the engine holds none". A slice without the accessor
   * gaps the family — see {@link readEngineDatasourceDefs} — for the same
   * reason `declaredDatasources: undefined` does: a read that did not happen
   * cannot be reported as an empty answer. A slice that genuinely holds none
   * says so exactly the way the host does, by answering `[]`.
   */
  listDatasourceDefs?(): readonly DatasourceArtefactLike[];
}

/** A datasource artefact, as far as this module reads it. */
export interface DatasourceArtefactLike {
  name?: string;
  external?: { credentialsRef?: unknown } | null;
}

/** Normalise a driver result (`T[]` or `{ data: T[] }` or a single row). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (!result) return [];
  const list = Array.isArray(result)
    ? result
    : Array.isArray((result as { data?: unknown }).data)
      ? ((result as { data: unknown[] }).data)
      : [result];
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
}

const describeCause = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/**
 * Family 1 — handles held in `sys_setting.value_enc`.
 *
 * `value_enc` also carries LEGACY INLINE ciphertext on rows written before the
 * Phase-3 split, and such a row references no `sys_secret` row at all. The
 * discriminator is service-settings' own `isSecretHandle`, imported rather than
 * restated: treating inline ciphertext as a handle would inject a phantom id
 * into the union, and restating the `sec_` prefix is how the two spellings
 * would drift apart later.
 */
export async function collectSettingsSecretReferences(
  engine: SecretReferenceEngineLike,
): Promise<FamilyResult> {
  const family: SecretReferenceFamily = 'settings';
  const references: SecretReference[] = [];

  const driver = engine.getDriverForObject('sys_setting');
  if (!driver) {
    return {
      family,
      status: 'gap',
      reason:
        'no driver resolves for `sys_setting`, so the settings producer\'s holder column could '
        + 'not be read (is the settings subsystem registered on this runtime?)',
      references,
    };
  }

  let result: unknown;
  try {
    result = await driver.find('sys_setting', { fields: ['namespace', 'key', 'scope', 'user_id', 'value_enc'] });
  } catch (err) {
    return {
      family,
      status: 'gap',
      reason: `reading \`sys_setting\` threw — ${describeCause(err)}`,
      references,
    };
  }

  for (const row of rowsOf(result)) {
    const value = row.value_enc;
    if (!isSecretHandle(value)) continue; // unset, or legacy inline ciphertext
    references.push({
      handleId: value,
      family,
      holder: `sys_setting(namespace=${String(row.namespace)},key=${String(row.key)}`
        + `${row.scope == null ? '' : `,scope=${String(row.scope)}`}`
        + `${row.user_id == null ? '' : `,user_id=${String(row.user_id)}`})`,
    });
  }

  return { family, status: 'enumerated', references };
}

/**
 * Family 2 — `secret:<id>` refs on business rows.
 *
 * **Instance-specific and runtime-enumerated, by necessity.** The holders are
 * every `secret`-typed field on every REGISTERED object, tenant-authored ones
 * included, so no list of them can be precomputed, checked in, or written into
 * a fixture. The enumeration therefore walks `engine.getConfigs()` on each
 * call: an object registered a moment ago is in the union with no code change,
 * which is pinned in the test file.
 *
 * Each object's read is guarded separately, and a failure gaps the WHOLE
 * family rather than dropping that object: one unreadable object is one set of
 * live handles the union would otherwise be missing, and the union has no way
 * to be "mostly" complete.
 */
export async function collectObjectFieldSecretReferences(
  engine: SecretReferenceEngineLike,
): Promise<FamilyResult> {
  const family: SecretReferenceFamily = 'object-field';
  const references: SecretReference[] = [];

  let configs: Record<string, ServiceObject>;
  try {
    configs = engine.getConfigs() ?? {};
  } catch (err) {
    return {
      family,
      status: 'gap',
      reason: `enumerating registered objects threw — ${describeCause(err)}`,
      references,
    };
  }

  for (const [objectName, schema] of Object.entries(configs)) {
    const secretFields = collectSecretFields(schema);
    if (secretFields.length === 0) continue;

    const driver = engine.getDriverForObject(objectName);
    if (!driver) {
      return {
        family,
        status: 'gap',
        reason:
          `object \`${objectName}\` declares secret field(s) ${secretFields.join(', ')} but no `
          + 'driver resolves for it, so its holders could not be read',
        references,
      };
    }

    let result: unknown;
    try {
      result = await driver.find(objectName, { fields: ['id', ...secretFields] });
    } catch (err) {
      return {
        family,
        status: 'gap',
        reason: `reading secret field(s) of \`${objectName}\` threw — ${describeCause(err)}`,
        references,
      };
    }

    for (const row of rowsOf(result)) {
      for (const field of secretFields) {
        const handleId = parseSecretRef(row[field]);
        if (handleId === null) continue; // unset, cleared, or already masked-out
        references.push({
          handleId,
          family,
          holder: `${objectName}.${field}#${String(row.id)}`,
        });
      }
    }
  }

  return { family, status: 'enumerated', references };
}

/**
 * Family 3 — handles held at a datasource artefact's `external.credentialsRef`.
 *
 * Pure over the artefacts its caller supplies — but the caller now assembles
 * those from THREE sources, and none of the three dominates the others:
 *
 *  - {@link readStoredDatasourceArtefacts} — the persisted `sys_metadata` rows;
 *  - {@link readEngineDatasourceDefs} — the definitions this engine holds.
 *    `registerDatasourceDef` retains `external.credentialsRef` and
 *    `listDatasourceDefs()` reads it back, so the engine can now answer for
 *    every datasource REGISTERED on this runtime, by either entry route (the
 *    direct call and the package-manifest install path);
 *  - `SecretReferenceUnionInput.declaredDatasources` — the host's own list.
 *
 * A union, ⛔ not a replacement, because the two code-side sources have
 * different blind spots: the engine indexes only what was registered on it, so
 * a config file nothing ever installed is invisible to it, while a host's list
 * can omit a datasource a package manifest installed behind its back. Letting
 * either source stand for the other would under-report, and under-reporting is
 * the direction that deletes live credentials.
 *
 * References are de-duplicated on the EXACT `(handleId, holder)` pair, which
 * is information-preserving: the same handle at the same holder coordinate,
 * seen twice because two sources both name it, is one reference. Two sources
 * disagreeing — one holder, two different handles — keeps BOTH, because both
 * are real and dropping either is the under-report this module refuses.
 */
export function collectDatasourceSecretReferences(
  artefacts: readonly DatasourceArtefactLike[],
): FamilyResult {
  const family: SecretReferenceFamily = 'datasource';
  const references: SecretReference[] = [];
  // Keyed on the JSON of the exact pair rather than a joined string: a
  // separator character would have to be one no holder coordinate can contain,
  // and that is a property this module cannot enforce over datasource names.
  const seen = new Set<string>();

  for (const artefact of artefacts) {
    const ref = artefact?.external?.credentialsRef;
    if (typeof ref !== 'string' || ref === '') continue;
    const handleId = parseCredentialsRef(ref);
    if (handleId === undefined) continue; // a ref shape this producer did not mint
    const holder = `datasource(${String(artefact.name)}).external.credentialsRef`;
    const key = JSON.stringify([handleId, holder]);
    if (seen.has(key)) continue; // the same reference, reached through two sources
    seen.add(key);
    references.push({ handleId, family, holder });
  }

  return { family, status: 'enumerated', references };
}

/**
 * Read the PERSISTED datasource artefacts — `sys_metadata` rows of type
 * `datasource`, the durable store the admin plugin writes and rehydrates from.
 *
 * Read at driver level and deliberately UNFILTERED by state: an artefact
 * carried as `inactive` still holds its `credentialsRef`, and a handle held by
 * a disabled datasource is a handle that must not be collected. Corrupt JSON
 * is surfaced as a gap rather than skipped — a row this cannot parse is a row
 * whose `credentialsRef` is unknown, not absent.
 */
export async function readStoredDatasourceArtefacts(
  engine: SecretReferenceEngineLike,
): Promise<{ artefacts: DatasourceArtefactLike[]; gap?: string }> {
  const artefacts: DatasourceArtefactLike[] = [];

  const driver = engine.getDriverForObject('sys_metadata');
  if (!driver) {
    return {
      artefacts,
      gap: 'no driver resolves for `sys_metadata`, so persisted datasource artefacts could not be read',
    };
  }

  let result: unknown;
  try {
    result = await driver.find('sys_metadata', { where: { type: 'datasource' } });
  } catch (err) {
    return { artefacts, gap: `reading \`sys_metadata\` threw — ${describeCause(err)}` };
  }

  for (const row of rowsOf(result)) {
    if (row.type !== 'datasource') continue; // a driver that ignored `where`
    const raw = row.metadata;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') artefacts.push(parsed as DatasourceArtefactLike);
    } catch (err) {
      return {
        artefacts,
        gap:
          `sys_metadata row \`${String(row.id)}\` (name=${String(row.name)}) does not parse as a `
          + `datasource artefact — ${describeCause(err)}; its credentialsRef is unknown, not absent`,
      };
    }
  }

  return { artefacts };
}

/**
 * Read the datasource definitions THIS ENGINE HOLDS — family 3's code-side
 * source, and the half of it the union used to be unable to reach.
 *
 * `ObjectQL.registerDatasourceDef` retains `external.credentialsRef`, and
 * `listDatasourceDefs()` answers every definition the engine indexed, from both
 * entry routes and UNFILTERED by `schemaMode` (a managed datasource may carry a
 * `credentialsRef` too, so filtering here would hide live handles).
 *
 * ⛔ The accessor's ABSENCE is a gap, never an empty answer. An engine slice
 * that cannot list its definitions has not answered the question, and a
 * code-declared datasource never reaches `sys_metadata` — so nothing else in
 * this module would see the handle it holds. A slice that holds none states
 * that by answering `[]`, exactly as the host does with `declaredDatasources`.
 */
export function readEngineDatasourceDefs(
  engine: SecretReferenceEngineLike,
): { artefacts: DatasourceArtefactLike[]; gap?: string } {
  if (typeof engine.listDatasourceDefs !== 'function') {
    return {
      artefacts: [],
      gap:
        'this runtime\'s engine exposes no `listDatasourceDefs()`, so the datasource definitions '
        + 'held in code could not be read; a code-declared datasource never reaches `sys_metadata`, '
        + 'so its `external.credentialsRef` is invisible to the persisted read — implement the '
        + 'accessor, or have it answer `[]` to state the engine holds none',
    };
  }

  try {
    return { artefacts: [...engine.listDatasourceDefs()] };
  } catch (err) {
    return {
      artefacts: [],
      gap: `listing the engine's datasource definitions threw — ${describeCause(err)}`,
    };
  }
}

/** Input to {@link collectSecretReferenceUnion}. */
export interface SecretReferenceUnionInput {
  /** A booted runtime's ObjectQL engine. */
  engine: SecretReferenceEngineLike;
  /**
   * The datasource artefacts the HOST declared in code (`defineStack`, an app
   * manifest, a config file) — the ones that never reach `sys_metadata`.
   *
   * **Required, and `undefined` is not the same as `[]`.** The union now ASKS
   * the engine as well ({@link readEngineDatasourceDefs}), so the code-side
   * blind spot is narrower than it was — but it has not closed. The engine
   * indexes only what was REGISTERED on this runtime, so a datasource declared
   * in code that nothing ever installed reaches neither `sys_metadata` nor
   * `listDatasourceDefs()`. This module cannot discover THAT residue until it
   * asks the host, and it will not pretend to: `undefined` still says "nobody
   * answered", which opens a declared gap, while `[]` is the host stating it
   * has none. Collapsing the two would be exactly the silent incompleteness
   * this union exists to refuse.
   */
  declaredDatasources: readonly DatasourceArtefactLike[] | undefined;
}

/**
 * Collect the complete union from a booted runtime.
 *
 * Runs all three families. Each is a separate exported collector so a consumer
 * can enumerate one family alone — and so that ablating any single family's
 * enumeration is a real, isolated experiment rather than a rewrite.
 */
export async function collectSecretReferenceUnion(
  input: SecretReferenceUnionInput,
): Promise<SecretReferenceUnion> {
  const { engine, declaredDatasources } = input;

  const settings = await collectSettingsSecretReferences(engine);
  const objectField = await collectObjectFieldSecretReferences(engine);

  const stored = await readStoredDatasourceArtefacts(engine);
  const held = readEngineDatasourceDefs(engine);
  const datasource = collectDatasourceSecretReferences([
    ...stored.artefacts,
    ...held.artefacts,
    ...(declaredDatasources ?? []),
  ]);

  const datasourceGaps: string[] = [];
  if (stored.gap) datasourceGaps.push(stored.gap);
  if (held.gap) datasourceGaps.push(held.gap);
  if (declaredDatasources === undefined) {
    datasourceGaps.push(
      'the host did not declare its code-defined datasource artefacts (`declaredDatasources` was '
        + 'undefined). The engine\'s own definitions WERE read, but an engine indexes only the '
        + 'datasources REGISTERED on this runtime — a datasource declared in code that nothing ever '
        + 'installed reaches neither `sys_metadata` nor `listDatasourceDefs()`, so this union cannot '
        + 'discover it until the host is asked — pass `[]` to state there are none',
    );
  }

  return buildSecretReferenceUnion({
    settings,
    'object-field': objectField,
    datasource:
      datasourceGaps.length === 0
        ? datasource
        : { family: 'datasource', status: 'gap', reason: datasourceGaps.join('; '), references: datasource.references },
  });
}
