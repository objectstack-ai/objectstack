/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Declarative post-success behaviors shared by ObjectForm + WizardForm. A
 * metadata-only form (authored as JSON) cannot pass an `onSuccess` function, so
 * these let it declare what happens after a create/update: a custom toast
 * (`successMessage`), navigate to the new record (`navigateOnSuccess`), or reset
 * for another entry (`resetOnSuccess`).
 *
 * Kept dependency-free on purpose: importing the redirect guard from
 * EmbeddableForm would create a cycle (EmbeddableForm -> ObjectForm ->
 * WizardForm -> here), so the destination test below is local to this module.
 */

export type { SubmitBehavior } from '@object-ui/types';

/**
 * Two bases that share nothing but their scheme. A relative reference takes its
 * authority from whichever base it is resolved against; anything carrying its
 * own scheme or its own authority ignores the base and answers the same origin
 * for both. `.invalid` is reserved by RFC 2606, so neither can collide with a
 * real deployment origin, and comparing against BOTH means an author who
 * literally writes one of these sentinels is still classified as absolute.
 */
const PROBE_BASE_A = 'https://a.invalid/';
const PROBE_BASE_B = 'https://b.invalid/';

/**
 * Is `rawUrl` a relative reference — a destination that cannot carry its own
 * authority, and therefore always resolves inside the application?
 *
 * True for `/r/1`, `r/1`, `?ok=1`, `#done`. False for `https://x/y`, `//x/y`
 * (protocol-relative carries an authority), `javascript:…` — and, since the
 * 2026-08-17 ruling this module implements, false for a SAME-ORIGIN absolute
 * URL too.
 *
 * Answered by the URL parser rather than by a hand-written scheme grammar, so
 * leading whitespace and C0 controls are handled exactly the way the parser
 * handles them.
 *
 * ## Why this is a second spelling rather than a shared symbol
 *
 * `thankYouRedirectNavigation.ts` holds a predicate that today asks the same
 * question of a string (`isAppRelativeDestination`). It is deliberately NOT
 * imported here, and the reason is not tidiness — it is that the two must stay
 * free to diverge. That one answers WHO TRAVELS to an already-accepted
 * `thankYouPage.redirectUrl`, a key objectui#5112 ruled the opposite way on this
 * very shape: a same-origin absolute there keeps browser-level navigation
 * because "an author who spelled the whole address asked for that address". This
 * one answers WHICH destinations `navigateOnSuccess` accepts at all, where the
 * same shape is refused as out-of-contract. Two keys, two rulings, one string
 * test in common today; binding them to one symbol would mean the next ruling on
 * either key silently moving the other — which is the failure this separation
 * exists to prevent.
 *
 * The drift that separation costs is answered by measurement rather than by
 * hope: `navigateOnSuccess.urlContract.test.tsx` pins the two predicates
 * agreeing over a shared corpus, so a divergence is loud on the day it happens
 * instead of silent.
 */
function isRelativeReference(rawUrl: string): boolean {
  try {
    return (
      new URL(rawUrl, PROBE_BASE_A).origin === 'https://a.invalid'
      && new URL(rawUrl, PROBE_BASE_B).origin === 'https://b.invalid'
    );
  } catch {
    // Unparseable against any base is not a destination. Fail closed.
    return false;
  }
}

/**
 * Resolve a `navigateOnSuccess` template into the relative destination to
 * navigate to, or refuse it. Returns null when there is no template, no usable
 * id, or the resolved value is out of contract — callers then show the success
 * toast carrying `NAVIGATE_ON_SUCCESS_REFUSED_NOTE`.
 *
 * ## The contract (maintainer ruling, 2026-08-17, objectui#5034)
 *
 * `navigateOnSuccess` is the pre-ruling ancestor of the `submitBehavior` family,
 * not a second dialect, and it is **deprecated in favour of `submitBehavior`**
 * (which already takes precedence over it, pinned). As a compat alias it runs
 * under the semantics objectstack#7496 ruled for that family:
 *
 *   1. **relative paths only.** A same-origin ABSOLUTE value is refused like any
 *      other out-of-contract value — not routed differently, refused. The
 *      destination is authored metadata, which is exactly where an address
 *      somebody else chose gets copied in.
 *   2. **the interpolated value is URL-escaped** when the destination is built.
 *   3. the `{id}` / `{recordId}` dialect **stays** for existing authors of this
 *      key. It is the one part deliberately not converged: the ruling keeps the
 *      spelling working and points new authoring at `submitBehavior` instead.
 *
 * ## Why both halves are needed, and neither substitutes for the other
 *
 * The escape is what stops a token from adding path STRUCTURE. Interpolated raw,
 * `{id}` with an address in it becomes the whole destination, and `/r/{id}` with
 * `a/b` in it silently grows a path segment. Relative-only is a rule about where
 * a destination STARTS, so it has nothing to say about structure injected
 * further along — the argument `submitRedirect.ts` records for the ruled sibling,
 * which holds here verbatim.
 *
 * Conversely the escape alone would not refuse an authored absolute, because the
 * template is the AUTHOR's and only the substituted value passes through
 * `encodeURIComponent`. So: escape the data, judge the result.
 *
 * ## This can only narrow what is reachable
 *
 * Every destination this returns is a relative reference, and every relative
 * reference was already accepted by the same-origin guard it replaces (a
 * relative reference cannot carry an authority, RFC 3986, so it always resolves
 * to the current origin). Escaping only ever maps an id onto one opaque segment.
 * So the set of addresses reachable through this key is a strict subset of the
 * set reachable before — there is no value that was refused and is now followed.
 */
export function resolveSuccessNavigate(
  template: string | undefined,
  record: any,
): string | null {
  if (!template) return null;
  const id = record?.id ?? record?.recordId ?? record?._id;
  if (id == null || id === '') return null;
  // Function replacer, not a string one: a string replacement re-reads `$&`,
  // `` $` `` and `$1` out of the substituted value. `encodeURIComponent` escapes
  // `$` today so the two forms agree, but that agreement would be a property of
  // the escape table rather than of this line, and this line is the one that
  // must not re-interpret record data.
  const url = template.replace(/\{(?:id|recordId)\}/g, () => encodeURIComponent(String(id)));
  return isRelativeReference(url) ? url : null;
}
