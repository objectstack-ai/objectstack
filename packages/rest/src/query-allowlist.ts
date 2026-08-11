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
