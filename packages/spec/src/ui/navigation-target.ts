// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What an authored navigation target may open — ONE grammar, stated once, for
 * every authoring door whose value the console's action runner navigates to on
 * a click.
 *
 * The admitted set is closed:
 *
 * - an address that opens with one of {@link ADMITTED_SCHEMES} — `http://`,
 *   `https://` or `mailto:`, the scheme compared case-insensitively, as the URL
 *   parser compares it. The two web schemes need the `//` that introduces the
 *   host: `https:example.com` names no host;
 * - an in-app path that starts with `/` or `./`;
 * - a template that opens with `${` (`${ctx.origin}/x`, `${param.url}`). Its
 *   value exists only after interpolation, at click, where the runner judges
 *   the interpolated string against this same set. The door leaves it alone.
 *
 * Everything else is refused: `javascript:`, `data:`, `tel:` and every other
 * scheme; a protocol-relative `//host`; `/` followed by a backslash, which the
 * browser reads as `//host`; any target that holds an ASCII tab, line feed or
 * carriage return, since the URL parser deletes those three before it reads
 * anything; and a bare relative target that opens with neither a scheme nor
 * `/` nor `./` (`thanks`, `../thanks`, `?tab=2`, `#top`).
 *
 * ## Why the door answers exactly what the runner answers
 *
 * The runner's half is objectui's `classifyNavigationTarget` (read point
 * recorded in `liveness/action.json`, row `target`), which both the action
 * runner and the entitlement CTA call. For a
 * literal target this function admits exactly what that classifier admits and
 * refuses exactly what it refuses. A door wider than the runner is the trap the
 * set exists to close: the target publishes clean and fails at click. A door
 * narrower than the runner refuses metadata that would have worked. ⛔ A change
 * to the set is made on both sides, never on one.
 *
 * Decided by ruling A+ on objectstack-ai/objectui#12191 (spec half: this
 * repository's #23010). `tel:` is outside the set because no producer was
 * measured writing one; admitting it is one row in {@link ADMITTED_SCHEMES}
 * plus the runner's matching change. The customer-facing sentences below carry
 * neither the ruling nor a tracker id: each states the rule, why it exists and
 * the repair.
 *
 * Reached by relative import only, like `action-target-aliases.ts`: exported
 * from `action.zod.ts` it would ride the `ui` barrel into the published API.
 */

/**
 * The admitted schemes, each with what must follow its colon. One row per
 * scheme; the refusal text below is built from this table, so a row added here
 * is admitted and named in every refusal at once.
 */
const ADMITTED_SCHEMES: Readonly<Record<string, string>> = {
  http: '//',
  https: '//',
  mailto: '',
};

/** A leading `scheme:` — the URL grammar's scheme production. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/** The three characters the URL parser deletes before it reads an address. */
const PARSER_DELETED_RE = /[\t\n\r]/;

/** The admitted scheme forms, as an author writes them: `` `http://`, `https://` or `mailto:` ``. */
const ADMITTED_FORMS = (() => {
  const forms = Object.entries(ADMITTED_SCHEMES).map(([scheme, after]) => `\`${scheme}:${after}\``);
  return forms.length < 2 ? forms.join('') : `${forms.slice(0, -1).join(', ')} or ${forms[forms.length - 1]}`;
})();

/** The closing sentence of every refusal: the admitted set, as the fix to write. */
const ADMITTED_SET_SENTENCE =
  `Write an address that opens with ${ADMITTED_FORMS} (an \`http(s)://\` URL or a \`mailto:\` address), `
  + 'or an in-app path that starts with `/` or `./`, such as `/thanks`. A target that opens with `${…}` '
  + 'is checked when it is clicked, after interpolation.';

/**
 * Judge an authored navigation target against the admitted set.
 *
 * `subject` names the field as the author wrote it, and opens the refusal —
 * "A `type: 'url'` action's `target`". Returns the author-facing refusal, or
 * `undefined` when the target is admitted. Ordered so the most specific reason
 * is reported: a `java`-tab-`script:` target is told about the tab, not about
 * its scheme.
 */
export function navigationTargetRefusal(raw: string, subject: string): string | undefined {
  if (raw.startsWith('${')) return undefined;

  if (PARSER_DELETED_RE.test(raw)) {
    return `${subject} must not contain a tab, line feed or carriage return. `
      + 'The browser deletes those three characters before it reads an address, so they can hide what '
      + 'the target really opens with: `java`, a tab, then `script:` is read as `javascript:`. '
      + 'Percent-encode one that belongs in the address (`%09`, `%0A`, `%0D`). '
      + ADMITTED_SET_SENTENCE;
  }

  if (raw.startsWith('./')) return undefined;

  if (raw.startsWith('/')) {
    if (raw[1] === '/') {
      return `${subject} opens with \`//\`, which is protocol-relative, not an in-app path. `
        + 'The browser reads `//example.com/x` as ANOTHER ORIGIN despite the leading slash. Use a single '
        + 'leading slash for an in-app path, or the full `https://` URL for a deliberate external link. '
        + ADMITTED_SET_SENTENCE;
    }
    if (raw[1] === '\\') {
      return `${subject} opens with \`/\` followed by a backslash, which the browser reads as \`//\`. `
        + 'So `/\\example.com` leaves the app exactly like the protocol-relative `//example.com`. Write an '
        + 'in-app path with forward slashes only. '
        + ADMITTED_SET_SENTENCE;
    }
    return undefined;
  }

  const scheme = SCHEME_RE.exec(raw)?.[1];
  if (scheme !== undefined) {
    const after = ADMITTED_SCHEMES[scheme.toLowerCase()];
    if (after === undefined) {
      return `${subject} opens with \`${scheme}:\`, a scheme a url target never opens. `
        + `Only ${ADMITTED_FORMS} are admitted, compared case-insensitively: \`javascript:\` and \`data:\` `
        + 'would run or render content inside the app, and every other scheme is refused here rather than '
        + 'at the click. '
        + ADMITTED_SET_SENTENCE;
    }
    if (raw.slice(scheme.length + 1).startsWith(after)) return undefined;
    return `${subject} opens with \`${scheme}:\` but not \`${scheme}:${after}\`. `
      + `The \`${after}\` introduces the host, so \`${scheme}:example.com\` names no host and the runner `
      + `refuses it at the click. Write the full form, \`${scheme}:${after}example.com\`. `
      + ADMITTED_SET_SENTENCE;
  }

  return `${subject} opens with neither an admitted scheme nor \`/\` or \`./\`. `
    + 'A bare relative target such as `thanks`, `../thanks`, `?tab=2` or `#top` is not one the runner '
    + 'opens. Write the rooted in-app path, `/thanks`, or a `./` path. '
    + ADMITTED_SET_SENTENCE;
}
