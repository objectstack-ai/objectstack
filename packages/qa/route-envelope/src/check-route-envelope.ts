// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared response-envelope conformance guard (#3843).
 *
 * ## What this replaces
 *
 * `BaseResponseSchema` (`packages/spec/src/api/contract.zod.ts`) declares one
 * envelope for every REST body the platform emits — `{ success, error?, meta? }`
 * — and #3675 / #3689 moved `service-storage` and `service-i18n` onto it. Each
 * of those landings shipped its own hand-rolled scan of its own module's source,
 * because the route *ledgers* audit which routes exist and whether the SDK can
 * address them, never what comes back. Three copies of the same scan (storage
 * error, storage success, i18n error) was the signal that the guard wanted to be
 * shared rather than copied — #3843 option 3.
 *
 * The scan generalises cleanly because its load-bearing assertion is not about
 * any particular route: **count the `.json(` call sites**. If every body in a
 * module is built by the `sendOk` / `sendError` pair, that count is fixed at the
 * number of builders and does not grow with the number of routes. A new route
 * that hand-rolls its own body moves the count, and the guard fires — including
 * for routes that did not exist the day the suite was written, which is the one
 * thing a driven-body test can never cover.
 *
 * Everything else here is a tripwire for a specific retired dialect, so a revert
 * fails loudly instead of quietly:
 *
 *   - `{ error: '<string>' }` — the pre-#3675 shape, where a caller reading
 *     `body.error.message` gets `undefined`. Still live in two modules when
 *     #3843 was filed.
 *   - `res.status(…).json({ error … })` — the bare-error idiom, i.e. a route
 *     building an error body itself instead of calling the helper.
 *   - `ok: true` — a private second word for the `success` the envelope already
 *     carries (retired from storage by #3689).
 *
 * ## Shape of the API
 *
 * `checkRouteEnvelope` returns a list of problems (empty = sound) and takes the
 * source as a *string*, so it carries neither a test-runner nor a filesystem
 * dependency — the same contract as `checkLedger` / `checkReadCoercion` in
 * `@objectstack/verify` (ADR-0060). Callers read their own module and assert
 * `toEqual([])`.
 *
 * This is the STATIC half of envelope conformance. It proves no route can
 * bypass the builders; it cannot prove the builders are right. Each module's
 * suite pairs it with driven bodies parsed against the real spec schemas — the
 * half that has to live next to the routes it drives.
 */

import { stripNonCode } from './strip-non-code.js';

/** Distinct failure kinds, stable enough to assert on individually. */
export type EnvelopeRule =
  /** A `.json(` call site that is not one of the declared envelope builders. */
  | 'unenveloped-json-call'
  /** `success: true` is built in more (or fewer) places than declared. */
  | 'success-builder-count'
  /** `success: false` is built in more (or fewer) places than declared. */
  | 'error-builder-count'
  /** `error` is a bare string — the pre-#3675 dialect. */
  | 'string-error-body'
  /** A route builds its own error body instead of calling the helper. */
  | 'bare-error-body'
  /** A private second word for `success` (e.g. a literal `ok: true`). */
  | 'private-success-word';

export interface EnvelopeFinding {
  rule: EnvelopeRule;
  /** Module label supplied by the caller — appears verbatim in the message. */
  where: string;
  /** One-line, actionable description. */
  detail: string;
  /** Observed count, for the counting rules. */
  actual?: number;
  /** Declared count, for the counting rules. */
  expected?: number;
  /** The offending source fragments, for the tripwire rules. */
  matches?: string[];
}

export interface CheckRouteEnvelopeOptions {
  /** Raw module source. Comments and literal bodies are stripped internally. */
  source: string;
  /** Label for the findings, e.g. `'storage-routes.ts'`. */
  module: string;
  /**
   * How many `.json(` call sites the module is allowed — one per envelope
   * builder it defines. Default `2` (a `sendOk` / `sendError` pair).
   *
   * Set `0` for a module that emits through builders imported from elsewhere,
   * and set the real number for a module that legitimately defines only one
   * half (an error-only surface, say).
   */
  jsonCallSites?: number;
  /**
   * How many places may build `success: true`. Default `1`. `0` declares a
   * module with no success bodies of its own.
   */
  successBuilders?: number;
  /** How many places may build `success: false`. Default `1`. */
  errorBuilders?: number;
  /**
   * Identifiers that would duplicate the envelope's own `success` flag if used
   * as a literal boolean key. Default `['ok']` — the word #3689 retired from
   * storage.
   *
   * Only `<word>: true` / `<word>: false` *literals* count. A computed
   * `ok: results.every(…)` is a domain verdict that happens to share the name,
   * not a second envelope flag, and is left alone deliberately: the federated
   * `POST /external/validate` route reports exactly that.
   */
  privateSuccessWords?: string[];
}

/**
 * Audit one route module's source against the declared envelope.
 *
 * @returns findings; an empty array means the module is sound.
 */
export function checkRouteEnvelope(opts: CheckRouteEnvelopeOptions): EnvelopeFinding[] {
  const {
    source,
    module,
    jsonCallSites = 2,
    successBuilders = 1,
    errorBuilders = 1,
    privateSuccessWords = ['ok'],
  } = opts;

  const code = stripNonCode(source);
  const findings: EnvelopeFinding[] = [];

  // ── The load-bearing check ────────────────────────────────────────────────
  // Every body goes through a builder, so this count is a property of the
  // module's *structure* and not of its route list.
  const jsonCalls = [...code.matchAll(/\.\s*json\s*\(/g)];
  if (jsonCalls.length !== jsonCallSites) {
    findings.push({
      rule: 'unenveloped-json-call',
      where: module,
      detail:
        jsonCalls.length > jsonCallSites
          ? `${jsonCalls.length} \`.json(\` call sites, expected ${jsonCallSites} (one per envelope builder) — a route is building its own body instead of calling the helper`
          : `${jsonCalls.length} \`.json(\` call sites, expected ${jsonCallSites} — a declared envelope builder is missing`,
      actual: jsonCalls.length,
      expected: jsonCallSites,
    });
  }

  // ── One builder per envelope half, so each shape lives in one line ────────
  const trueFlags = [...code.matchAll(/success\s*:\s*true/g)];
  if (trueFlags.length !== successBuilders) {
    findings.push({
      rule: 'success-builder-count',
      where: module,
      detail: `\`success: true\` is built in ${trueFlags.length} place(s), expected ${successBuilders}`,
      actual: trueFlags.length,
      expected: successBuilders,
    });
  }

  const falseFlags = [...code.matchAll(/success\s*:\s*false/g)];
  if (falseFlags.length !== errorBuilders) {
    findings.push({
      rule: 'error-builder-count',
      where: module,
      detail: `\`success: false\` is built in ${falseFlags.length} place(s), expected ${errorBuilders}`,
      actual: falseFlags.length,
      expected: errorBuilders,
    });
  }

  // ── Retired dialects, kept explicitly dead ────────────────────────────────

  // `{ error: '<string>' }` — `ApiErrorSchema` declares `error` as an OBJECT
  // with `code` and `message`. A string there is the shape #3675 declared
  // wrong, and the one that makes `body.error.message` read `undefined`.
  const stringErrors = [...code.matchAll(/\.\s*json\s*\(\s*\{\s*error\s*:\s*['"`]/g)];
  if (stringErrors.length > 0) {
    findings.push({
      rule: 'string-error-body',
      where: module,
      detail: `${stringErrors.length} body(ies) emit \`error\` as a bare string; ApiErrorSchema declares \`{ code, message }\``,
      matches: stringErrors.map((m) => m[0]),
    });
  }

  // A route reaching for `res.status(…).json({ error … })` directly.
  const bareErrors = [...code.matchAll(/\.\s*status\s*\([^)]*\)\s*\.\s*json\s*\(\s*\{\s*error/g)];
  if (bareErrors.length > 0) {
    findings.push({
      rule: 'bare-error-body',
      where: module,
      detail: `${bareErrors.length} route(s) build an error body inline instead of calling the error helper`,
      matches: bareErrors.map((m) => m[0]),
    });
  }

  // A second, private word for `success`.
  for (const word of privateSuccessWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hits = [...code.matchAll(new RegExp(`\\b${escaped}\\s*:\\s*(?:true|false)\\b`, 'g'))];
    if (hits.length > 0) {
      findings.push({
        rule: 'private-success-word',
        where: module,
        detail: `\`${word}\` is used as a literal boolean flag — the envelope already carries \`success\``,
        matches: hits.map((m) => m[0]),
      });
    }
  }

  return findings;
}
