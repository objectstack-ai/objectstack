// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0120 D5e] The `isolated`-posture install gate for `'global'` uniqueness.
 *
 * ## Why a gate exists at all
 *
 * ADR-0120's scope vocabulary is deliberately **posture-invariant**: the author
 * states a business boundary (`'organization'` = one holder per organization,
 * `'global'` = one holder across the whole installation) and the same app
 * package runs unmodified under every tenancy posture (ADR-0105 D1
 * `single | group | isolated`). No index shape reads the posture — a posture
 * flip has zero automatic schema consequences, which is exactly what makes one
 * app package serve all three.
 *
 * One residual survives that invariance, and only in one direction
 * (ADR-0120 §Posture portability, Resolved question #4):
 *
 * - Under `single` / `group`, `'global'` means "the installation" — which for a
 *   `group` deployment IS the customer company (集团). An app business rule
 *   spelled `'global'` is correct there.
 * - Under `isolated`, organizations are **separate customers**. The identical
 *   declaration now crosses customers: it over-constrains (customer B cannot
 *   reuse customer A's material code) and it becomes a cross-tenant existence
 *   oracle — the very leak #3696 closed for field-level uniques (S10).
 *
 * `'global'` is therefore physically posture-invariant but not *safety*-invariant,
 * and the ADR's S14 row records the honest cost: "unique across the whole
 * company" is not expressible in metadata alone, because it means the
 * installation under `group` and one organization under `isolated`. A third,
 * posture-resolved word (`'company'`) was designed and **rejected** — it is the
 * one token that cannot be used without first understanding the posture
 * spectrum, exactly the cognitive load an AI-authored vocabulary must not carry.
 * The scenario is handled **here**, at the deployment seam, instead.
 *
 * ## Why a HARD stop and not an advisory
 *
 * Maintainer decision, 2026-08-04 (ADR-0120 Resolved #4). An advisory that
 * nobody reads leaves a cross-customer constraint enforced in production — the
 * ADR-0049/0078 class this whole ADR exists to close. So installing an app that
 * carries `'global'` uniques on non-`sys` objects into an `isolated` environment
 * **stops**, lists each index, and asks the installer (typically an AI agent) to
 * either confirm it as genuinely platform-wide or rewrite it to
 * `'organization'`. The confirmation is recorded in the install manifest
 * (ADR-0104 attestation style) so it is **never re-asked**.
 *
 * ⛔ **Never a boot-time warning** (#4884 discipline). A deployment whose apps
 * were installed before this gate existed, or whose posture changed after
 * install, is reached by the ADVISORY form in `os doctor` / `os migrate plan` —
 * the two cases a gate at the install seam structurally cannot see. Turning
 * this into a startup diagnostic would fire on every boot of every deployment
 * forever, which is the false-alarm class #4884 retired.
 *
 * ## What counts as a finding
 *
 * | Declaration | Finding? | Why |
 * |:---|:---|:---|
 * | field `unique: 'global'` | ✅ | one holder across the installation — crosses customers under `isolated` |
 * | declared index `unique: 'global'` | ✅ | same boundary, spelled on the index |
 * | declared index `unique: true` | ✅ | ADR-0120 D1: bare `true` **is** the deprecated positional spelling of `'global'`; identical physical shape, identical hazard. Excluding it would leave the gate bypassable by spelling for the whole of 17.x |
 * | field `unique: true` / `'organization'` | ❌ | per-organization — correct under every posture |
 * | declared index `unique: 'organization'` | ❌ | per-organization (D3 NULL-safe key part) |
 * | anything on a `sys_*` object | ❌ | engine idempotency / dedup keys (the ADR's S5 inventory) are platform-wide **by construction**; asking about them on every install is the false-alarm class again |
 *
 * The enumeration is a pure projection of declared metadata — no tenancy
 * inference, no database access — which is what lets the identical function
 * serve the hard gate, `os doctor` and `os migrate plan`.
 */

import { normalizeTenancyPosture, type TenancyPosture } from '@objectstack/spec/security';

/** Objects owned by the platform itself never raise a finding. */
const SYS_OBJECT_PREFIXES = ['sys_', 'base_'] as const;

/**
 * Is this object platform-owned (the ADR's "`sys` objects")?
 *
 * The ADR scopes the gate to **non-`sys`** objects because the platform's own
 * `'global'` uniques are the S5 inventory — `sys_job.name`,
 * `sys_notification.dedup_key`, `http_delivery (source, dedup_key)` and the rest
 * — engine idempotency keys that are platform-wide on purpose and identical
 * under every posture. Re-confirming them on every app install would be the
 * #4884 false-alarm class with extra steps.
 *
 * `base_` is included alongside `sys_`: it is the platform's other reserved
 * object prefix, carrying the same "owned by the framework, not the app"
 * meaning. An app object can never legitimately claim either.
 */
export function isPlatformOwnedObject(objectName: unknown): boolean {
  const name = typeof objectName === 'string' ? objectName.trim().toLowerCase() : '';
  if (!name) return false;
  return SYS_OBJECT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Does a FIELD-level `unique` value ask for the installation-wide boundary?
 *
 * Only the explicit `'global'` does. Bare `true` at field level is the
 * documented, unambiguous synonym of `'organization'` (ADR-0120 D1 —
 * "field-level bare `true` stays valid indefinitely", Resolved #2), so it is
 * never a finding.
 */
export function fieldUniqueIsGlobal(unique: unknown): boolean {
  return unique === 'global';
}

/**
 * Does a DECLARED-INDEX `unique` value ask for the installation-wide boundary?
 *
 * `'global'` and bare `true` both do. Per ADR-0120 D1 the bare spelling **is**
 * `'global'` — "today's verbatim semantics, materialized over exactly the listed
 * columns" — deprecated (lint `unique/unscoped-declared-index` warns in 17.x,
 * protocol 18 rejects it, #5082) but physically identical while it lasts. A gate
 * that judged only the explicit word would be bypassable by writing the
 * deprecated one, which is the #4986 trap wearing the gate's own uniform.
 */
export function declaredIndexUniqueIsGlobal(unique: unknown): boolean {
  return unique === 'global' || unique === true;
}

/** One installation-wide unique declaration found on an app (non-`sys`) object. */
export interface GlobalUniqueFinding {
  /** Stable identity for the attestation record — see {@link globalUniqueFindingId}. */
  readonly id: string;
  /** Object (and therefore table) the declaration sits on. */
  readonly object: string;
  /** Which spelling carried it. */
  readonly kind: 'field' | 'index';
  /** Field name for `kind: 'field'`; the index's declared name (when it has one) otherwise. */
  readonly name?: string;
  /** The columns the constraint spans, in declaration order. */
  readonly columns: readonly string[];
  /** The exact authored value (`true` | `'global'`) — quoted back in the stop message. */
  readonly spelling: true | 'global';
}

/**
 * Stable id for one finding, used as the attestation key.
 *
 * Keyed by object + kind + **columns**, deliberately NOT by the index's optional
 * `name`: a declared index may be anonymous, and renaming an index does not
 * change which constraint the installer confirmed. Two indexes on the same
 * object spanning the same columns are the same constraint by any physical
 * reading, so collapsing them is correct rather than lossy.
 */
export function globalUniqueFindingId(
  objectName: string,
  kind: 'field' | 'index',
  columns: readonly string[],
): string {
  return `${objectName}:${kind}:${columns.join('+')}`;
}

/** Field map or field array — both authoring shapes are accepted. */
function fieldEntriesOf(fields: unknown): Array<{ name: string; def: any }> {
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields
      .filter((f: any) => f && f.name != null)
      .map((f: any) => ({ name: String(f.name), def: f }));
  }
  if (typeof fields !== 'object') return [];
  return Object.entries(fields as Record<string, any>).map(([name, def]) => ({ name, def }));
}

/**
 * Enumerate every installation-wide unique declared on an app's non-`sys`
 * objects (ADR-0120 D5e).
 *
 * Pure and posture-agnostic on purpose: the CALLER decides whether the posture
 * makes these findings a hard stop (`isolated`, at install) or an advisory
 * (`os doctor` / `os migrate plan`). Deterministic order — objects as supplied,
 * fields before indexes within an object — so the stop message and the
 * attestation record are reproducible across runs.
 */
export function collectGlobalUniques(objects: unknown): GlobalUniqueFinding[] {
  if (!Array.isArray(objects)) return [];
  const findings: GlobalUniqueFinding[] = [];

  for (const obj of objects as any[]) {
    const objectName = typeof obj?.name === 'string' ? obj.name.trim() : '';
    if (!objectName) continue;
    if (isPlatformOwnedObject(objectName)) continue;

    for (const { name, def } of fieldEntriesOf(obj?.fields)) {
      if (!fieldUniqueIsGlobal(def?.unique)) continue;
      findings.push({
        id: globalUniqueFindingId(objectName, 'field', [name]),
        object: objectName,
        kind: 'field',
        name,
        columns: [name],
        spelling: 'global',
      });
    }

    const declaredIndexes = Array.isArray(obj?.indexes) ? obj.indexes : [];
    for (const idx of declaredIndexes as any[]) {
      if (!declaredIndexUniqueIsGlobal(idx?.unique)) continue;
      const columns = Array.isArray(idx?.fields)
        ? idx.fields.filter((f: unknown) => typeof f === 'string').map((f: string) => f)
        : [];
      if (columns.length === 0) continue;
      const indexName = typeof idx?.name === 'string' && idx.name.trim() ? idx.name.trim() : undefined;
      findings.push({
        id: globalUniqueFindingId(objectName, 'index', columns),
        object: objectName,
        kind: 'index',
        ...(indexName ? { name: indexName } : {}),
        columns,
        spelling: idx.unique === true ? true : 'global',
      });
    }
  }

  return findings;
}

/**
 * The attestation recorded in the install manifest once an installer has
 * confirmed a set of findings as genuinely platform-wide (ADR-0104 style).
 *
 * Shape follows the ADR-0104 precedent rather than inventing one: the FACT
 * observed (which constraint ids a human/agent affirmed), WHO affirmed it, WHEN,
 * and under WHICH posture the question was asked. That last field is what keeps
 * the record honest — an attestation given under `isolated` is evidence about
 * `isolated`, and nothing else.
 *
 * Never rewritten in place: confirmations ACCUMULATE. A later install of a newer
 * version that adds a new `'global'` index asks about the new one only — the
 * earlier answers stand, which is the "之后不复问" half of the decision.
 */
export interface GlobalUniqueAttestation {
  /** Posture the confirmation was given under. */
  readonly posture: TenancyPosture;
  /** Finding ids affirmed as genuinely platform-wide. */
  readonly confirmed: readonly string[];
  /** ISO timestamp of the most recent confirmation. */
  readonly attestedAt: string;
  /** Identity of the confirming installer, when the seam knows one. */
  readonly attestedBy?: string | null;
}

/**
 * Which findings still need an answer, given an existing attestation.
 *
 * Returns the findings NOT covered by `attestation.confirmed`. An empty result
 * means the install proceeds silently — this is the mechanism behind "never
 * re-asked".
 *
 * An attestation recorded under a DIFFERENT posture does not carry over: the
 * question "is this genuinely platform-wide, knowing organizations here are
 * separate customers?" was never asked. Confirmations made under `isolated` are
 * the only ones that answer it, so a `single`-posture record is treated as
 * absent rather than as consent — the conservative direction, and the only one
 * that cannot silently admit a cross-customer constraint.
 */
export function unconfirmedGlobalUniques(
  findings: readonly GlobalUniqueFinding[],
  attestation: GlobalUniqueAttestation | undefined | null,
  posture: TenancyPosture,
): GlobalUniqueFinding[] {
  if (!attestation || attestation.posture !== posture) return [...findings];
  const confirmed = new Set(attestation.confirmed ?? []);
  return findings.filter((f) => !confirmed.has(f.id));
}

/**
 * Merge a new set of confirmations into an existing attestation.
 *
 * Additive by construction — see {@link GlobalUniqueAttestation}. A record from
 * another posture is replaced rather than merged: its `confirmed` ids answered a
 * different question.
 */
export function recordGlobalUniqueAttestation(
  previous: GlobalUniqueAttestation | undefined | null,
  confirmedIds: readonly string[],
  posture: TenancyPosture,
  attestedBy?: string | null,
  now: string = new Date().toISOString(),
): GlobalUniqueAttestation {
  const carried = previous && previous.posture === posture ? previous.confirmed ?? [] : [];
  const merged = Array.from(new Set([...carried, ...confirmedIds])).sort();
  return {
    posture,
    confirmed: merged,
    attestedAt: now,
    ...(attestedBy !== undefined ? { attestedBy } : {}),
  };
}

/** Render one finding the way both the hard stop and the advisory quote it. */
export function describeGlobalUniqueFinding(finding: GlobalUniqueFinding): string {
  const spelling = finding.spelling === true ? '`unique: true`' : "`unique: 'global'`";
  const deprecated = finding.spelling === true ? ' [deprecated bare spelling of \'global\']' : '';
  if (finding.kind === 'field') {
    return `${finding.object}.${finding.name} — field-level ${spelling}`;
  }
  const label = finding.name ? ` '${finding.name}'` : '';
  return `${finding.object} — declared index${label} [${finding.columns.join(', ')}] ${spelling}${deprecated}`;
}

/**
 * The prescription every surface repeats verbatim, so the hard stop and the two
 * advisories cannot drift into three different pieces of advice.
 */
export const GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION =
  "Under the 'isolated' posture organizations are separate CUSTOMERS, so an installation-wide unique " +
  'constrains across customers and can reveal that another customer already holds a value (ADR-0120 S10/S14). ' +
  'For each index above, either (a) confirm it is genuinely platform-wide — an infrastructure/dedup key, a DNS ' +
  'hostname, an external provider id — or (b) rewrite it to `unique: \'organization\'` so it is one holder per ' +
  'organization. See ADR-0120 §Posture portability.';

/**
 * The full hard-stop message for an install into an `isolated` environment.
 *
 * Built here rather than at the install seam so the CLI, the HTTP surface and
 * the tests all quote one text.
 */
export function buildGlobalUniqueStopMessage(
  appLabel: string,
  findings: readonly GlobalUniqueFinding[],
): string {
  const lines = findings.map((f) => `  • ${describeGlobalUniqueFinding(f)}`);
  return (
    `'${appLabel}' declares ${findings.length} installation-wide unique constraint(s) on its own objects, and this ` +
    "environment runs the 'isolated' tenancy posture (ADR-0120 D5e):\n" +
    `${lines.join('\n')}\n` +
    `${GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION}\n` +
    'Re-run the install with the confirmation to record it in the install manifest — it is asked once, ' +
    'never again for the same constraints.'
  );
}

/** Error code the install seam returns when the gate stops an install. */
export const GLOBAL_UNIQUE_CONFIRMATION_REQUIRED = 'UNIQUE_SCOPE_CONFIRMATION_REQUIRED';

/**
 * Does this posture make `'global'` uniques a decision point at all?
 *
 * `isolated` only. Under `single` there is one customer; under `group` the
 * installation IS the customer company, which is what `'global'` means there —
 * both are the benign direction the ADR leaves to the app's install notes.
 */
export function postureGatesGlobalUniques(posture: unknown): boolean {
  return normalizeTenancyPosture(posture) === 'isolated';
}
