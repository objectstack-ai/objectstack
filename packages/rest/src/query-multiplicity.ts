// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Query-parameter MULTIPLICITY, for every REST handler in this package (#6877).
 *
 * `IHttpRequest.query` is declared `Record< string, string | string[] >`
 * (`packages/spec/src/contracts/http-server.ts`). A repeated parameter
 * (`?package=a&package=b`) is the ARRAY arm, and that arm is not hypothetical:
 * the `node:http` adapter (`@objectstack/http-conformance`'s `NodeHttpServer`)
 * hands it through as `['a','b']`, measured over a real socket on #6878. The
 * production Hono adapter happens to collapse repeats to the first value before
 * a handler runs — which is why this class is dormant today, and why it stops
 * being dormant the moment that collapse is removed (#6878's ruled route 2).
 *
 * ## Why the answer is a refusal and not a rule for picking
 *
 * `?version=1.0.0&version=2.0.0` is a well-formed request carrying two
 * conflicting intents. Picking one silently is a wrong answer delivered as a
 * success. The measured shapes in `rest-server.ts` were all of that kind, in
 * three flavours — none of which `tsc` can see, because each launders the array
 * through `any`, `String()` or `Number()`:
 *
 *   - `?force=false&force=false` → `!!['false','false']` → **`force: true`**,
 *     i.e. a repeated *opt-out* turned the destructive-change guard OFF.
 *   - `?limit=1&limit=2` on the export route → `Number([...])` is `NaN`,
 *     `NaN || 0` is `0`, `Math.max(1, 0)` is `1` → a **one-row export**, 200 OK.
 *   - `?status=open&status=won` → `String([...])` → the single status
 *     `'open,won'`, a name no record has → an empty list, 200 OK.
 *
 * So the rule is about the COUNT, not the shape: a parameter this API declares
 * single-valued may be supplied **at most once**. A one-element array is one
 * occurrence encoded differently by an adapter and is accepted (and unwrapped);
 * an empty array is no occurrence. Two identical values are still two
 * occurrences and are still refused — "at most one *distinct* value" would be a
 * de-duplication rule no caller can predict, while "supply it at most once" is
 * checkable client-side without knowing anything about our semantics.
 *
 * This is NOT tolerance for off-spec input: the contract already declares the
 * array. It is the consumer finally handling a declared shape.
 *
 * ## Single-valued is a per-parameter judgement, never a sweep
 *
 * Several parameters on this surface are genuinely multi-valued and their
 * consumers already read both arms — `select` / `expand` (`getData` accepts
 * `string | string[]` and splits the comma form itself), `objects` on
 * `/search`, `fields` / `searchFields` on the export route, `approverId` on
 * `/approvals/requests`. Those are deliberately absent from every declaration
 * below; flattening them would be a real regression, which is why each call
 * site names the parameters it declares single-valued instead of gating "every
 * key in `req.query`".
 *
 * #6307 landed the first copy of this rule in `package-routes.ts`. The two pure
 * helpers now live here so there is ONE rule and one message, not a second
 * implementation that drifts.
 */

/**
 * The outcome of reading a query parameter that this API declares as
 * single-valued. `ok: false` carries the multiplicity so the refusal can say
 * what it saw rather than only that it refused.
 */
export type SingleQueryRead =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly count: number };

/**
 * Read a query parameter the route declares single-valued out of the shape the
 * transport contract actually declares (#6307).
 *
 * See this module's header for why repetition is refused rather than resolved,
 * and why the rule counts occurrences instead of inspecting the value.
 */
export function readSingleQueryValue(raw: string | string[] | undefined): SingleQueryRead {
  if (Array.isArray(raw)) {
    // length 0 → the parameter was not supplied; length 1 → supplied once.
    return raw.length > 1 ? { ok: false, count: raw.length } : { ok: true, value: raw[0] };
  }
  return { ok: true, value: raw };
}

/**
 * The one refusal message for a repeated single-valued parameter, so every
 * route answers the SAME rule identically — two different answers for one
 * parameter would just be a new inconsistency.
 */
export function repeatedQueryParamMessage(name: string, count: number): string {
  return `The "${name}" query parameter was supplied ${count} times. Supply it at most once — `
    + `this endpoint will not choose between conflicting values.`;
}

/**
 * The gate `rest-server.ts` handlers open with: refuse a repeated occurrence of
 * any parameter this route declares single-valued, and normalise the benign
 * one-element array away so nothing downstream has to know the union existed.
 *
 * Returns `true` when it answered the request — the caller `return`s
 * immediately, exactly like the capability gates it sits beside.
 *
 * ## The envelope
 *
 * `400` with the ADR-0112 **nested** body `{ error: { code, message } }` — the
 * position ADR-0112 declares and the one PR #7293 (#7035) just converged this
 * file's `/meta` 501 refusals onto. `VALIDATION_ERROR` is not a new code: it is
 * the standard catalog's member for 400 (`spec/src/api/errors.zod.ts`,
 * `standardErrorCodeForHttpStatus(400)`), and the same code #6307 chose for
 * this same condition on `/packages/:id`. Nothing in `packages/spec` moves.
 *
 * ## Why it also normalises
 *
 * The rule accepts a one-element array as one occurrence. Accepting it without
 * unwrapping would leave `['a']` for the very `String()` / `Number()` / truthy
 * reads this exists to protect, so the acceptance would be a hole rather than a
 * courtesy. `req.query` is a plain mutable `Record` per the contract, and the
 * assignment happens ONLY on the array arm — a well-formed single-valued
 * request carries a `string` and is not touched at all, which is what makes the
 * preservation half of this change byte-identical.
 *
 * @param req    the handler's request (`IHttpRequest`-shaped; `any` because
 *               `rest-server.ts` types its handlers that way)
 * @param res    the handler's response
 * @param names  the parameters THIS route declares single-valued, in the order
 *               they should be reported; the first repeated one is refused, so
 *               the answer is deterministic for a request that repeats two.
 */
export function refuseRepeatedQueryParams(
  req: any,
  res: any,
  names: readonly string[],
): boolean {
  const query = req?.query;
  if (!query || typeof query !== 'object') return false;
  for (const name of names) {
    const raw = query[name];
    if (!Array.isArray(raw)) continue;
    const read = readSingleQueryValue(raw);
    if (!read.ok) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: repeatedQueryParamMessage(name, read.count) },
      });
      return true;
    }
    // One occurrence encoded as an array (or none): unwrap so every read
    // below this line sees the `string | undefined` it was written for.
    query[name] = read.value as string;
  }
  return false;
}
