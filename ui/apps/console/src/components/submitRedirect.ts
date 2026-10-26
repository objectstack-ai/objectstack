// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a form's `submitBehavior: { kind: 'redirect' }` sends the submitter
 * (objectui#4190), under the shape objectstack#7496 ruled on 2026-08-11 and
 * objectstack#7657 landed in `@objectstack/spec` (live on the 17.0.0 GA pin
 * this repo installs).
 *
 * The ruling has three points, and they divide cleanly into three layers:
 *
 *   1. **relative paths only** — an absolute or protocol-relative URL is
 *      refused. This is the open-redirect face: the destination is authored
 *      metadata, which is exactly where an address somebody else chose gets
 *      copied in.
 *   2. **interpolation only from declared record fields**, spelled
 *      `{{record.field_name}}`, with every interpolated value **URL-escaped
 *      when the redirect is built**.
 *   3. a **verbatim redirect on the resolved relative path** is the intended
 *      consumption — the destination is that string with its tokens
 *      substituted, and nothing else.
 *
 * Point 1 is a property of the string, so the spec enforces it at the authoring
 * door. Whether `{{record.foo}}` names a field the form's object actually
 * declares needs both the string and the object, so `@objectstack/lint`'s
 * reference-integrity family owns that. Point 2's "when the redirect is built"
 * and point 3's consumption are runtime, and this module is where they happen.
 *
 * ## Both layers ask the same question here (objectui#4990)
 *
 * "The spec enforces point 1 at the authoring door" is only true of a door that
 * ASKS it. This repo ships one — the console's Public Forms dialog — and it
 * enforced exactly one of the seven refusal families (empty), writing the other
 * six into view metadata unexamined. So the parse below is exported as
 * {@link checkSubmitRedirectUrl} and called there at save time: one parse, two
 * callers, one spelling of a security rule. The author now reads the spec's
 * prescription at the moment they can still fix the value, and the submitter
 * never meets a destination the door let past.
 *
 * The door needs the verdict on the string alone — there is no record at
 * authoring time — which is why the shape check and the substitution are
 * separate exports rather than one function with an optional scope.
 *
 * ## The shape verdict is the spec's, not a copy of it
 *
 * `@objectstack/spec` does not export its URL check as a function, but it does
 * export the schema the check lives in, so the verdict here is produced by
 * PARSING the smallest form view that carries this behavior. That costs one
 * parse per submit or save and buys the property that matters: there is no second
 * spelling of a security rule in this repo to drift from the first. When the
 * ruling widens — it says an allowlist of absolute origins "waits for measured
 * demand" — the console follows the pin with no edit here, which is the same
 * lag this card sat blocked on for six days.
 *
 * The alternative was a local re-implementation of the seven refusal families
 * kept honest by a parity table. `scripts/check-spec-symbol-derivation.mjs`
 * exists because this repo has paid for that shape four times (objectstack#4115,
 * objectui#4074/#4588/#4592): a hand copy passes every value comparison right
 * up to the release that moves the original.
 *
 * That the parsed view is a MINIMAL one is load-bearing, not laziness — see
 * {@link checkSubmitRedirectUrl}, which is where the parse lives.
 *
 * Neither the import nor the parse is new ground in this repo, which is worth
 * knowing before weighing the cost:
 *
 *  - `@object-ui/app-shell` already validates authored metadata drafts on the
 *    client against these same schemas and surfaces their issue messages
 *    (`views/metadata-admin/clientValidation.ts`), so "ask the spec at the
 *    consumer" is the established pattern rather than a new one here.
 *  - the bundle cost is nil, measured: `@objectstack/spec` is already in the
 *    console's `vendor-objectstack` chunk (`vite.config.ts` names it a manual
 *    chunk group) because app-shell — a core console dependency — imports
 *    `@objectstack/spec/ui` at runtime in several modules. This import adds a
 *    reference to a module the bundle already carries. That is also why it is a
 *    static import rather than the lazy one `clientValidation` uses: there is
 *    no chunk to defer, and making it lazy would only force this function to be
 *    async on the submit path.
 *
 * ## Why the accepted value is an in-app route
 *
 * A ruled-relative path IS a route in this shell, and objectui#4190 was filed
 * because the redirect arm handed it to the browser as a full-page navigation
 * instead. That form of navigation does not see React Router's basename, so on
 * a console served under a mount (the framework CLI configures one for every
 * embedded deployment) an authored `/objects/lead` resolves against the ORIGIN
 * root and leaves the SPA — the same class objectui#4181 fixed on the auth
 * pages. Both mounts of this renderer are inside the console's router
 * (`/f/:slug` and `/forms/:name` are siblings under one `BrowserRouter
 * basename=…`), so a router navigation is what makes "in-app" true.
 *
 * `withConsoleBase()` — objectui#4181's answer — is deliberately NOT used, and
 * the card's reason still holds: it prefixes anything not already targeting
 * another absolute SPA mount, so it would have mangled the absolute case rather
 * than fixing it. With absolutes now refused at the door, the helper is not
 * needed either: the router applies the basename itself, from the same injected
 * `<base href>` the helper reads. One mount source, no prefixing arithmetic.
 *
 * A path that matches no route lands on the shell's own not-found, which is the
 * author's error made visible in the app rather than an origin-root 404 with
 * the session left behind.
 */

import { FormViewSchema } from '@objectstack/spec/ui';

/**
 * The one interpolation the ruled `url` accepts, as a capture of the field
 * segment. The grammar (lowercase snake_case) is the one `object.fields` keys
 * are declared under, narrowed by the ruling to a FLAT segment under the
 * `record.` root — the record just submitted is the whole scope a post-submit
 * moment has.
 *
 * This spelling is the one place the spec's rule is restated rather than asked,
 * because substitution is the half of the ruling assigned to the consumer and
 * the spec exports no substituter. It is safe in one direction only, and that
 * is deliberate: it runs solely on strings the schema has already accepted, and
 * anything it fails to consume leaves a brace behind, which
 * {@link resolveSubmitRedirect} treats as a refusal. So a future divergence
 * from the spec's token grammar can only ever refuse a redirect loudly — never
 * navigate to a half-substituted URL.
 */
const RECORD_TOKEN_RE = /\{\{record\.([a-z_][a-z0-9_]*)\}\}/g;

/** Accepted: `path` is the resolved in-app route to navigate to. */
interface SubmitRedirectAccepted {
  ok: true;
  path: string;
}

/** Refused: `refusal` is author-facing prose explaining what to write instead. */
interface SubmitRedirectRefused {
  ok: false;
  refusal: string;
}

export type SubmitRedirectVerdict = SubmitRedirectAccepted | SubmitRedirectRefused;

/**
 * The contract's verdict on one authored `url`, before any substitution: `url`
 * is the value the schema accepted, and the refused arm is the same
 * author-facing prose the renderer quotes.
 */
export type SubmitRedirectUrlVerdict = { ok: true; url: string } | SubmitRedirectRefused;

/**
 * Ask the contract whether an authored `submitBehavior.url` is a value it
 * accepts, and get its own prescription back when it is not.
 *
 * This is the shape half of the ruling — the half that needs only the string —
 * so it is what an authoring door calls before writing the value, and what
 * {@link resolveSubmitRedirect} calls before substituting into it.
 *
 * Parsing a MINIMAL view is load-bearing, not laziness. A whole stored
 * `FormView` refuses on any unrelated key the strict schema does not know, and
 * neither a redirect nor a save dialog must be refused because some other part
 * of the metadata drifted. The question asked here is narrow — "is this url a
 * value the contract allows?" — so only that value is submitted for judgement,
 * and only issues on that value's path are read back.
 */
export function checkSubmitRedirectUrl(url: string): SubmitRedirectUrlVerdict {
  const parsed = FormViewSchema.safeParse({ submitBehavior: { kind: 'redirect', url } });

  if (!parsed.success) {
    // Only this value was submitted for judgement, so an issue on its path is
    // the answer; the two fallbacks exist so a refusal is never silent, not
    // because either is expected to be reached.
    const onUrl = parsed.error.issues.find(
      (issue) => issue.path[0] === 'submitBehavior' && issue.path[1] === 'url',
    );
    return {
      ok: false,
      refusal:
        onUrl?.message
        ?? parsed.error.issues[0]?.message
        ?? `\`submitBehavior.url\` is not a value this contract accepts: ${JSON.stringify(url)}.`,
    };
  }

  // Read the value back off the parse rather than reusing the input: the schema
  // is the authority on what it accepted, so if it ever normalises the string
  // both callers follow without a second edit. Today the two are identical —
  // the key is a plain string with a refinement, deliberately, so that what is
  // saved and what reaches the renderer stay the string the author wrote.
  const behavior = parsed.data.submitBehavior;
  return { ok: true, url: behavior?.kind === 'redirect' ? behavior.url : url };
}

/**
 * The string form of a record value inside a URL.
 *
 * Scalars only, and that is not a shortcut: the ruling accepts a FLAT field
 * segment, so a token can only ever name a top-level field, and a field whose
 * value is an object or array has no scalar form to put in a path. Absent and
 * null read as empty — a blank optional field is data, not an authoring defect,
 * and this layer is explicitly not the one that judges whether the field was
 * declared (see the module docblock).
 *
 * The scope is a JSON record as it came off the API, so dates and references
 * arrive already stringified.
 */
function urlValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

/**
 * Resolve an authored `submitBehavior.url` into the in-app route to navigate
 * to, or refuse it.
 *
 * @param url    the authored value, exactly as the metadata carries it
 * @param record the record this submit just wrote — the token scope
 *
 * Refusal is fail-closed and quotable: the message is the spec's own
 * prescription (it names the key, the rule, and what to write instead,
 * including that a deliberately external destination is an app navigation item
 * rather than this key), so the author reads the same sentence here that the
 * authoring door would have told them.
 *
 * ## Why substitution cannot widen the destination
 *
 * Every interpolated value goes through `encodeURIComponent`, which escapes the
 * characters that could add structure — `/` and `:`, along with `?`, `#` and the
 * rest. So a field carrying an address, a traversal, or a space becomes one
 * opaque segment or query value: a token is a VALUE in the path, never a way to
 * add path structure.
 *
 * This escape carries the whole weight of that property, and re-parsing the
 * result would NOT be enough on its own — measured, not assumed. Interpolated
 * raw, `/t/{{record.slug}}` with an address in `slug` becomes
 * `/t/https://evil.example/steal`, which still starts with `/` and carries no
 * leading scheme: a spec-VALID relative path pointing somewhere the author never
 * wrote. Relative-only is a rule about where a path starts, so it has nothing to
 * say about structure injected further along. `submitRedirect.test.ts` therefore
 * pins both halves — the emitted string re-parses green, AND the escaped value is
 * present in it.
 */
export function resolveSubmitRedirect(
  url: string,
  record: Record<string, unknown>,
): SubmitRedirectVerdict {
  const verdict = checkSubmitRedirectUrl(url);
  if (!verdict.ok) return verdict;

  const path = verdict.url.replace(RECORD_TOKEN_RE, (_token, field: string) =>
    encodeURIComponent(urlValue(record[field])),
  );

  if (path.includes('{') || path.includes('}')) {
    // Unreachable while this module's token grammar matches the schema's — the
    // schema refuses a brace that is not a well-formed token. It is a refusal
    // rather than an assertion because the failure it guards is a future
    // widening upstream, and navigating to a URL with an unsubstituted token in
    // it is the one outcome that must not happen.
    return {
      ok: false,
      refusal:
        '`submitBehavior.url` carries an interpolation this renderer could not resolve '
        + `(${JSON.stringify(url)}). A token names one declared record field, spelled `
        + '`{{record.field_name}}`, and the redirect is refused rather than followed with the '
        + 'token left in it.',
    };
  }

  return { ok: true, path };
}
