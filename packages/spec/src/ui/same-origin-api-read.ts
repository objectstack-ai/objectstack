// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE same-origin API read rule of the UI protocol — the URL a declared
 * read may name, the refusal that names why a URL was refused, the dotted path
 * a read selects from its answer, and what an author who reached for a
 * credential is told.
 *
 * Two declarations read an endpoint through the console's signed-in fetch, and
 * both import this module, so there is one rule and not two:
 *
 * - a page element's `api` data source (`ElementApiDataSourceSchema`,
 *   `page.zod.ts`) — the declaration the rule was written for;
 * - an action's `preflight` read (`ActionSchema.preflight`, `action.zod.ts`) —
 *   the read the param dialog shows before submit.
 *
 * Import-free on purpose: both consumers sit in `ui/`, and a leaf that imports
 * nothing cannot close a cycle back to either. Package-internal: the module is
 * not re-exported from the `ui` barrel, because the schemas that apply it are
 * the published contract and the console re-judges stored metadata with those
 * schemas, never with the regex alone.
 *
 * ## The admitted set
 *
 * A path that opens with ONE `/` (`/api/v1/cloud/home`), whose second
 * character is neither `/` nor a backslash, and that carries no space and no
 * ASCII control character anywhere. Everything else is refused, and the
 * refusal says which of five classes the value fell in:
 *
 * - `scheme` — an absolute URL of ANY scheme (`https:`, `http:`, `mailto:`,
 *   `javascript:`, `data:`, …): it names an origin of its own;
 * - `protocol-relative` — `//host`, which the browser reads as a host name;
 * - `backslash` — `/` then a backslash, or a backslash first: the URL parser
 *   reads a backslash as a slash in a special-scheme URL, so both are `//host`;
 * - `whitespace-or-control` — a tab, line feed or carriage return anywhere (the
 *   parser deletes them before it reads the URL, so `/`+tab+`/host` is
 *   `//host`), or a space or another control character, which the parser strips
 *   from either end (a space before `//host` is `//host`);
 * - `relative` — no leading `/` at all (`./home`, `../home`, `api/v1/home`,
 *   `?q`, an empty string): it resolves against the PAGE's own address, never
 *   the API.
 *
 * The first four are the browser-equivalent spellings of another origin that
 * objectui's `classifyNavigationTarget` (`@object-ui/core`, the one answer its
 * user-click navigations share) refuses for a navigation target. `./relative`,
 * which that classifier admits for a NAVIGATION, is refused HERE on a
 * measurement of the renderer, not by analogy: a read is a `fetch`, and the
 * `apiBase` promotion the console applies to a `url` action
 * (`ActionRunner.navigateTo`; read points recorded in `liveness/page.json`,
 * row `regions`) prefixes a root-relative `/api/…` path only — a `./` path
 * would resolve against the
 * console route the page is mounted on, on the SPA host, and read the wrong
 * thing in the silent direction.
 *
 * ## Why a regex and not a `superRefine`
 *
 * A `.regex()` projects into the published JSON Schema as `pattern`, exactly;
 * a refinement is dropped from it (`dropped-refinements.baseline.json`), so a
 * document a validator accepted would be refused at parse a release later.
 * The pattern IS the rule; {@link sameOriginApiPathRefusal} only names the
 * class a refused value fell in, so the author reads why.
 *
 * Whatever the class, no credential is ever written here: the console reads the
 * endpoint with its own signed-in fetch (the maintainer's ruling: "No
 * credentials in metadata; the console's authenticated fetch is reused").
 */
export const SAME_ORIGIN_API_PATH_RE = /^\/(?:[^/\\\x00-\x20\x7F][^\x00-\x20\x7F]*)?$/;

/** The classes {@link SAME_ORIGIN_API_PATH_RE} refuses, in the order they are asked. */
const SAME_ORIGIN_API_URL_CLASSES: ReadonlyArray<{ test: (url: string) => boolean; why: string }> = [
  {
    // whitespace-or-control — asked first: a space before `//host` is `//host`.
    test: (url) => /[\x00-\x20\x7F]/.test(url),
    why: 'This value holds a space or an ASCII control character. The browser\'s URL parser deletes a '
      + 'tab, line feed or carriage return wherever it stands and strips spaces and control characters '
      + 'from both ends before it reads the URL, so what it fetches is not what was written: a slash, a '
      + 'tab and then `/host` is read as `//host`, another origin. Percent-encode a space the path '
      + 'really needs (`%20`).',
  },
  {
    // scheme — any scheme, not only http(s).
    test: (url) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url),
    why: 'This value is an absolute URL: it opens with a scheme (`https:`, `http:`, `mailto:`, '
      + '`javascript:`, `data:`, …), so it names an origin of its own.',
  },
  {
    // protocol-relative.
    test: (url) => url.startsWith('//'),
    why: 'This value opens with `//`, a protocol-relative URL: the browser reads what follows as a host '
      + 'name, so it is another origin.',
  },
  {
    // backslash — `/\host` and a leading backslash are both `//host` to the parser.
    test: (url) => url.startsWith('\\') || url.startsWith('/\\'),
    why: 'This value puts a backslash where the browser\'s URL parser reads a slash, so it is read as '
      + '`//host`, another origin.',
  },
];

/**
 * The refusal a declared read's URL raises when {@link SAME_ORIGIN_API_PATH_RE}
 * refuses it — the rule, the class the value fell in, and the fix. `subject`
 * names the slot in the author's words (`` `read.url` of an `api` data source ``).
 * ⛔ The value itself is never echoed: a URL an author pasted may carry a
 * credential in its user-info or query.
 */
export function sameOriginApiPathRefusal(input: unknown, subject: string): string | undefined {
  // A non-string is the type check's to report, in zod's own words.
  if (typeof input !== 'string') return undefined;
  const why = SAME_ORIGIN_API_URL_CLASSES.find((c) => c.test(input))?.why
    ?? 'This value does not open with `/`, so it is a relative path: it resolves against the page\'s '
      + 'own address, never the API.';
  return subject + ' must be a same-origin API path — one that '
    + 'opens with a single `/`, such as `/api/v1/cloud/home`. ' + why + ' Write the endpoint\'s path '
    + 'on this deployment\'s own origin. The console reads it with its own signed-in fetch, so a host, '
    + 'a scheme or a credential is never written in metadata.';
}

/**
 * The dotted path a declared read selects from the response —
 * `data.environments` in a `{ success, data }` envelope. Segments of letters,
 * digits, `_` and `-`, joined by single dots: no brackets, no leading `$`, no
 * slashes, so a JSONPath or a URL path written here is refused rather than
 * selecting nothing.
 */
export const API_RESPONSE_PATH_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** What an author who reached for a credential on a declared read is told. */
export const API_READ_NO_CREDENTIALS =
  'No credential is written in metadata: the console reads the endpoint with its own signed-in '
  + 'fetch, so the request already carries the user\'s session. Delete this key.';
