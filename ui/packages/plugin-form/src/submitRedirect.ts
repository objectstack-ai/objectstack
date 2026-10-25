/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Where a form's `submitBehavior: { kind: 'redirect' }` sends the submitter
 * (objectui#4989), under the shape objectstack#7496 ruled on 2026-08-11 and
 * objectstack#7657 landed in `@objectstack/spec` (live on the 17.0.0 GA pin
 * this package depends on).
 *
 * The ruling has three points:
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
 * door and this module ASKS it rather than restating it. Whether
 * `{{record.foo}}` names a field the form's object actually declares needs both
 * the string and the object declaration, so `@objectstack/lint`'s
 * reference-integrity family owns that. Point 2's "when the redirect is built"
 * and point 3's consumption are runtime, and this module is where they happen.
 *
 * ## The shape verdict is the spec's, not a copy of it
 *
 * `@objectstack/spec` does not export its url check as a function, but it does
 * export the schema the check lives in, so the verdict here is produced by
 * PARSING the smallest form view that carries this behavior. That costs one
 * parse per submit and buys the property that matters: there is no second
 * spelling of a security rule in this repo to drift from the first, and when the
 * ruling widens (it says an allowlist of absolute origins "waits for measured
 * demand") this package follows the pin with no edit here.
 *
 * The alternative was a local re-implementation of the seven refusal families
 * kept honest by a parity table. `scripts/check-spec-symbol-derivation.mjs`
 * exists because this repo has paid for that shape four times
 * (objectstack#4115, objectui#4074/#4588/#4592): a hand copy passes every value
 * comparison right up to the release that moves the original.
 *
 * Parsing a MINIMAL view is load-bearing, not laziness. A whole stored
 * `FormView` refuses on any unrelated key the strict schema does not know, and a
 * redirect must not be refused because some other part of the metadata drifted.
 * The question asked here is narrow — "is this url a value the contract
 * allows?" — so only that value is submitted for judgement, and only issues on
 * that value's path are read back.
 *
 * `@objectstack/spec` is already a declared runtime dependency of this package
 * and already imported by its siblings (`sectionFields.ts`, `sanitize.ts`), so
 * the import adds no dependency and no chunk.
 *
 * ## Relationship to `apps/console`'s `submitRedirect.ts`
 *
 * `apps/console` consumes the same ruled key and got the same treatment in
 * objectui#4190 / PR #4992. The two are deliberately SEMANTICALLY aligned and
 * physically separate: a published renderer package cannot import an app's
 * module, and the shared thing — the shape verdict — is not duplicated at all,
 * because both ask the same `FormViewSchema`. What is written twice is the token
 * substitution and the escape, ~20 lines the spec exports no substituter for.
 *
 * Two deliberate divergences, both named so a future consolidation has a map.
 * The accepted value: the console resolves to a `path` it hands to a ROUTER
 * unconditionally, whereas this package resolves to a path it hands to the
 * host's injected navigate when there is one and to a browser-level navigation
 * when there is not — a renderer cannot assume a router, which is the whole
 * subject of `submitRedirectNavigation.ts`. And the split: the console has since
 * separated its shape verdict
 * into `checkSubmitRedirectUrl` because it also owns an authoring door
 * (`PublicFormsPage` asks it before saving), which this package has no
 * counterpart to — a renderer only ever consumes.
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
 * the spec exports no substituter. It is safe in one direction only, and that is
 * deliberate: it runs solely on strings the schema has already accepted, and
 * anything it fails to consume leaves a brace behind, which
 * {@link resolveSubmitRedirect} treats as a refusal. So a future divergence from
 * the spec's token grammar can only ever refuse a redirect loudly — never
 * navigate to a half-substituted URL.
 */
const RECORD_TOKEN_RE = /\{\{record\.([a-z_][a-z0-9_]*)\}\}/g;

/** Accepted: `url` is the resolved relative destination to navigate to. */
interface SubmitRedirectAccepted {
  ok: true;
  url: string;
}

/** Refused: `refusal` is author-facing prose explaining what to write instead. */
interface SubmitRedirectRefused {
  ok: false;
  refusal: string;
}

export type SubmitRedirectVerdict = SubmitRedirectAccepted | SubmitRedirectRefused;

/**
 * The string form of a record value inside a URL.
 *
 * Scalars only, and that is not a shortcut: the ruling accepts a FLAT field
 * segment, so a token can only ever name a top-level field, and a field whose
 * value is an object or array has no scalar form to put in a path. Absent and
 * null read as empty — a blank optional field is data, not an authoring defect,
 * and this layer is explicitly not the one that judges whether the field was
 * declared (see the module docblock).
 */
function urlValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

/**
 * The token scope for one submit: "the record this submit just wrote".
 *
 * The values as submitted, with whatever the DataSource answered layered over
 * them — defaults, computed columns and the new id are canonical there, and the
 * submitted values are what a `create` that echoes nothing back still has. Both
 * form components call this so a `{{record.id}}` token cannot resolve one way in
 * `ObjectForm` and another in `WizardForm`.
 */
export function submitRedirectScope(
  submittedValues: unknown,
  result: unknown,
): Record<string, unknown> {
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return { ...asRecord(submittedValues), ...asRecord(result) };
}

/**
 * Resolve an authored `submitBehavior.url` into the relative destination to
 * navigate to, or refuse it.
 *
 * @param url    the authored value, exactly as the metadata carries it
 * @param record the record this submit just wrote — the token scope
 *
 * Refusal is fail-closed and quotable: the message is the spec's own
 * prescription (it names the key, the rule, and what to write instead, including
 * that a deliberately external destination is an app navigation item rather than
 * this key), so the author reads the same sentence here that the authoring door
 * would have told them. Callers must SHOW it — the write already succeeded, and
 * dropping the refusal leaves the submitter looking at a still-filled form with
 * no idea why nothing happened, which is objectui#4989's defect 2 and the one
 * outcome the ruling's consumer half rules out.
 *
 * ## Why substitution cannot widen the destination
 *
 * Every interpolated value goes through `encodeURIComponent`, which escapes the
 * characters that could add structure — `/` and `:`, along with `?`, `#` and the
 * rest. So a field carrying an address, a traversal, or a space becomes one
 * opaque segment or query value: a token is a VALUE in the path, never a way to
 * add path structure.
 *
 * That escape carries the whole weight of the property, and re-parsing the
 * result would NOT be enough on its own. Interpolated raw,
 * `/t/{{record.slug}}` with an address in `slug` becomes
 * `/t/https://evil.example/steal` — which still starts with `/` and carries no
 * leading scheme, i.e. a spec-VALID relative path pointing somewhere the author
 * never wrote. Relative-only is a rule about where a path STARTS, so it has
 * nothing to say about structure injected further along. `submitRedirect.test.ts`
 * therefore pins both halves.
 *
 * ## What this module does not answer: WHO travels (objectui#4989 defect 4)
 *
 * An accepted value is a rooted relative path, and a rooted path resolves
 * against the ORIGIN root when a browser-level navigation performs it — so
 * under a host mounted at a sub-path a ruled in-app `/thanks` used to leave the
 * app. That is defect 4 of the card, and it is not a property of the string:
 * the same accepted path is correct or wrong depending on who travels to it.
 * It is therefore answered one layer out, in `submitRedirectNavigation.ts`,
 * where the host's optionally injected navigate is used when present
 * (maintainer ruling, 2026-08-17) and `window.location.assign` otherwise.
 *
 * Nothing about the verdict changes with the seam: an injected host navigate is
 * never a laundering route for a value this module refuses, because it is only
 * ever handed a path this module already accepted.
 */
export function resolveSubmitRedirect(
  url: string,
  record: Record<string, unknown>,
): SubmitRedirectVerdict {
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
  // this follows without a second edit. Today the two are identical — the key is
  // a plain string with a refinement, deliberately, so what reaches a renderer
  // stays the string the author wrote.
  const behavior = parsed.data.submitBehavior;
  const accepted = behavior?.kind === 'redirect' ? behavior.url : url;

  const resolved = accepted.replace(RECORD_TOKEN_RE, (_token, field: string) =>
    encodeURIComponent(urlValue(record[field])),
  );

  if (resolved.includes('{') || resolved.includes('}')) {
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

  return { ok: true, url: resolved };
}
