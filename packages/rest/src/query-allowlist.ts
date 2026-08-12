// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Query-parameter RECOGNITION, for the routes that declare a closed parameter
 * set (#7527).
 *
 * The sibling rule in `query-multiplicity.ts` answers "how many times may a
 * parameter I understand be supplied". This one answers the question before
 * it: **do I understand this parameter at all**.
 *
 * ## The defect this exists for
 *
 * `GET /api/v1/approvals/requests?assignedToMe=true` answered **200 with every
 * request the caller can see**. The handler reads the keys it knows off the
 * query string and ignores the remainder, so a caller who believes they asked
 * for "the requests assigned to me" is handed the UNFILTERED list — and cannot
 * tell, because an unfiltered result is shaped exactly like a genuinely broad
 * one. There is no status code, no header and no field that distinguishes
 * "your filter matched everything" from "your filter was thrown away".
 *
 * That is the same anti-pattern as #7463's defect 2 (an unknown field inside
 * `where` answers 200/0 instead of a located `400`), pointed the other way:
 * there an unrecognised key silently NARROWS to zero, here it silently WIDENS
 * to everything. Both are the server accepting a request it does not
 * understand and returning a plausible-looking answer — the #5714 / #5931 /
 * #7463 family norm is to refuse instead of guessing.
 *
 * ## Why refusal, and not an alias
 *
 * The obvious-looking alternative — teach the endpoint what `assignedToMe`
 * means — is surface expansion with no pull behind it. The capability already
 * exists and is already reachable: the Console asks precisely this question as
 * `approverId=<id>,role:user`, which the `approverId` multi-identity arm was
 * built for. Adding a second spelling for a question that already has one buys
 * nothing and has to be carried forever. Refusing costs one error path and
 * makes every FUTURE typo self-reporting.
 *
 * ## Why a whitelist rather than a blacklist of known-bad names
 *
 * The bug is not `assignedToMe` specifically. `assigned_to_me`, `assignee`,
 * `mine`, `approver` and every other plausible-but-wrong spelling fails the
 * identical way, silently, and a blacklist can only ever name the ones someone
 * already tripped over. A closed set is the only shape with no escape valve
 * (#5794: one fix, no escape hatch).
 *
 * ⚠️ The closed set must be MEASURED from what the handler actually reads —
 * filters, paging, ordering, and any alias spelling it honours — not from the
 * filters alone. A whitelist that forgets `limit` / `offset` converts a
 * silent-widening bug into a loud paging outage, which is worse.
 *
 * ## The envelope
 *
 * `400` with the ADR-0112 **nested** body `{ error: { code, message } }` —
 * byte-identical in position and code to the multiplicity refusal that runs on
 * the same handler, so one route never answers two dialects for two flavours
 * of "this request is malformed". `VALIDATION_ERROR` is the standard catalog's
 * member for 400 (`spec/src/api/errors.zod.ts`); nothing in `packages/spec`
 * moves for this.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * # THE INGRESS POLICY (#7606)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Maintainer ruling, 2026-08-12, verbatim and untranslated:
 *
 * > 裁定:政策 YES —— 闭合查询参数集成为 REST ingress 政策;采纳方式为增量,
 * > ⛔ 不打大包。
 *
 * ## The rule
 *
 * **A new REST route declares its closed query-parameter set on the day it
 * lands**, by opening its handler with {@link refuseUnknownQueryParams} over
 * an exported `readonly string[]`. This is review-enforceable: a PR adding a
 * `GET` route that reads `req.query` and does not declare a closed set is
 * incomplete, and the reviewer should say so.
 *
 * Existing routes convert **per lane, never as one sweep** — a broad wave with
 * thin pins is the failure mode the ruling explicitly rejected. Data READ
 * routes convert first: silent widening and narrowing bite hardest there, and
 * an AI caller can detect neither direction.
 *
 * ## Three rules for measuring the set — the part that goes wrong
 *
 * 1. ⛔ **Measure from the handler's ACTUAL read points. Never guess, and
 *    never copy the docs.** The set is not "the filters": it includes paging,
 *    ordering, output format, alias spellings the handler honours, and
 *    anything a middleware reads off the query before the handler runs. A
 *    whitelist that forgets `limit` converts a silent-widening bug into a loud
 *    pagination incident — strictly worse than the defect it fixes.
 * 2. **Declare only what the handler really implements.** When a route reads
 *    an alias but not the canonical spelling (`GET /data/:object/:id` reads
 *    `select`, never the canonical `fields`), the missing spelling stays
 *    OUTSIDE the set. Adding it would advertise a capability that does not
 *    exist; refusing it makes the gap self-reporting.
 * 3. **Recognition and arity are different questions** and a name may be
 *    answered differently by each. A multi-valued parameter belongs in the
 *    recognition set and stays out of the multiplicity declaration.
 *
 * ## ⛔ Routes whose parameter set is genuinely OPEN are excluded — by name
 *
 * The policy is not "every route eventually". Some surfaces accept
 * caller-defined names by design, and closing them would be a defect:
 *
 * - **`GET {basePath}/data/:object` (the record list)** — ⛔ **do not add this
 *   gate.** The handler hands the WHOLE query record to `findData`, whose
 *   normalizer lowers every leftover key into an implicit field-equality
 *   predicate (`?status=open` IS the filter). The valid parameter names are
 *   therefore the object's own field names, which vary per object and include
 *   the audit / tenant / owner columns the registry injects — a closed list in
 *   this file could only ever be wrong. That route is already guarded, one
 *   layer down and against the right authority: #4134's read-path gate refuses
 *   an unknown FIELD with `400 INVALID_FIELD` (`assertQueryParamsAreFields`,
 *   `metadata-protocol`), and #7534 extended the same gate to the explicit
 *   `where` / `$filter` axes. Adding recognition here would break every
 *   implicit filter and author a third dialect for a condition that already
 *   has two correct answers.
 *
 * The general test: **if an unrecognised name has a defined meaning on this
 * route, the set is open and this gate does not belong.** Gate it where the
 * authority for the name actually lives.
 *
 * ## Composition with the sibling gates
 *
 * Recognition runs FIRST, before {@link refuseRepeatedQueryParams} — see that
 * helper and the note on {@link refuseUnknownQueryParams} itself. Both answer
 * the same nested `VALIDATION_ERROR` envelope, so composing them adds no
 * dialect. The third gate, `assertFilterParamSuppliedOnce` (#7390), answers
 * `400 INVALID_FILTER` through the flat `mapDataError` envelope and lives
 * ONLY on the list route excluded above — so it and this gate never run on one
 * request, and the cross-route code divergence recorded in #8001 is neither
 * widened nor resolved by this policy.
 *
 * ## This breaks tolerated traffic, deliberately
 *
 * A caller sending a parameter we ignore today starts getting a `400`. That is
 * the point, and v17 is the intended window: the traffic is invisible to us
 * precisely because we drop it silently, so the blast radius cannot be
 * measured from our side — only decided. It was decided above.
 */

/**
 * The one refusal message for unrecognised query parameters, so every route
 * adopting this rule answers it identically.
 *
 * The message is LOCATED in both directions a caller needs: it names the
 * parameters that were not understood, and it lists the ones that are — so a
 * caller who guessed wrong can fix the request from the response alone,
 * without reading our source or our docs.
 *
 * @param unknown    the unrecognised names, in the order they should be
 *                   reported (the caller sorts them for determinism)
 * @param supported  every name this route accepts, sorted
 */
export function unknownQueryParamMessage(
  unknown: readonly string[],
  supported: readonly string[],
): string {
  const subject = unknown.length === 1
    ? `The "${unknown[0]}" query parameter is not supported by this endpoint.`
    : `The query parameters ${unknown.map(n => `"${n}"`).join(', ')} are not supported by this endpoint.`;
  return `${subject} This endpoint will not silently ignore a parameter it does not `
    + `understand — an ignored filter is indistinguishable from one that matched everything. `
    + `Supported parameters: ${supported.join(', ')}.`;
}

/**
 * Refuse a request carrying any query parameter outside this route's closed
 * set. Returns `true` when it answered the request — the caller `return`s
 * immediately, exactly like {@link refuseRepeatedQueryParams} and the
 * capability gates it sits beside.
 *
 * Runs BEFORE the multiplicity rule on purpose: "I do not know this parameter"
 * outranks "this parameter I do know was supplied twice", so a request that
 * commits both errors gets the answer that explains the more fundamental one.
 *
 * @param req      the handler's request (`IHttpRequest`-shaped; `any` because
 *                 `rest-server.ts` types its handlers that way)
 * @param res      the handler's response
 * @param allowed  every parameter name this route accepts — including paging,
 *                 ordering and alias spellings, not only filters
 */
export function refuseUnknownQueryParams(
  req: any,
  res: any,
  allowed: readonly string[],
): boolean {
  const query = req?.query;
  if (!query || typeof query !== 'object') return false;
  const permitted = new Set(allowed);
  // Sorted so a request carrying several unknown names always produces the
  // same message, whatever order the adapter happened to build the object in.
  const unknown = Object.keys(query).filter(k => !permitted.has(k)).sort();
  if (unknown.length === 0) return false;
  res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: unknownQueryParamMessage(unknown, [...allowed].sort()),
    },
  });
  return true;
}
