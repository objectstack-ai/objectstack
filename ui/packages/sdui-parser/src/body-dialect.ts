/**
 * ObjectUI — the retired `body` child-list dialect (objectui#6771)
 *
 * `body` was a declared twin of `children` on `BaseSchema`, and for a long
 * while it was the ONLY child-list key a dozen registrations read. This tier
 * never knew it: `BASE_PROPS` lists `children` and not `body`, so the one
 * spelling that resolved drew `unknown-prop` — the same warning a typo draws,
 * on the tier built to accept AI-authored pages, where the diagnostic IS the
 * contract. The maintainer ruled the retirement (2026-09-01, option B): one
 * concept, one spelling, and the spelling is `children`.
 *
 * This module is the tier's half of that ruling. It REPLACES the diagnostic the
 * prop walk would otherwise emit for `body`, rather than adding to it — two
 * diagnostics for one mistake is the shape `checkMemberTypes` already refuses
 * (objectui#8067).
 *
 * WHY A REPLACEMENT AND NOT A BARE `unknown-prop`. After the retirement
 * "`<badge>` has no prop body" is TRUE — but it is the answer that sent authors
 * the wrong way in the first place. Every `body` node in this repository's own
 * docs, examples and READMEs was migrated in the same change, and an author
 * carrying the old spelling in from anywhere else needs the replacement NAMED,
 * not merely the key refused. The two codes below are the ruling's own words:
 * the tier teaches `children` only, and a `body` child list under a
 * non-container draws the same `not-a-container` the `children` spelling draws.
 *
 * SCOPE — asked INSIDE the `!input` branch, because its claim is about a key
 * nobody declares, so a
 * component that publishes its own `body` input keeps its declared type check
 * untouched. Re-derived against the registry rather than recalled: exactly one
 * registration in the tree declares an input named `body`, and it is
 * `record:alert` (`plugin-detail`, `register('alert', …, { namespace: 'record' })`),
 * whose `body` takes an inline translation map and is not this spelling.
 * Control on the same sweep: `name: 'children'` fires seven times.
 */

import type { Diagnostic, ParsedSchemaNode } from './types.js';

/** The child-list spelling objectui#6771 retired. `children` replaced it. */
export const RETIRED_CHILD_LIST_KEY = 'body';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Is this value shaped like the child list the dialect used to carry?
 *
 * A list of nodes, or the bare single node `FlatContent` and `renderChildren`
 * have always accepted. A scalar is not — `body="hi"` is a dead key and nothing
 * more, so it does not get the containment sentence, which would name a shape
 * its author did not write.
 */
const isChildList = (value: unknown): value is ParsedSchemaNode | ParsedSchemaNode[] =>
  Array.isArray(value) || isPlainObject(value);

/**
 * The diagnostic for an authored `body`, or `null` when this module has nothing
 * to say about the key.
 *
 * @param tag              the node's component type, for the message and the `tag` field
 * @param key              the authored prop name
 * @param value            its authored value
 * @param acceptsChildren  whether the component declares the `children` slot
 *                         input — `acceptsChildren(comp)` in `./validate.ts`,
 *                         the ONE containment predicate this tier has. It used
 *                         to be `comp.isContainer`; objectui#9910 moved both
 *                         sites together so the retired spelling and the live
 *                         one can never disagree about who takes a list.
 */
export function checkRetiredBodyDialect(
  tag: string,
  key: string,
  value: unknown,
  acceptsChildren: boolean,
): Diagnostic | null {
  if (key !== RETIRED_CHILD_LIST_KEY) return null;

  if (isChildList(value) && !acceptsChildren) {
    // The ruling, verbatim: "a `body` child list under a non-container draws
    // the same `not-a-container` the `children` spelling draws". Same code, so
    // a consumer keying on the code cannot tell the two spellings apart — which
    // is the single-spelling rule stated in the diagnostic stream. The sentence
    // carries the extra fact the `children` path has no need of.
    return {
      severity: 'warning',
      code: 'not-a-container',
      message:
        `<${tag}> does not accept children — and "body" is the retired spelling of ` +
        `"children" (objectui#6771), so this child list has no door here at all`,
      tag,
    };
  }

  return {
    severity: 'warning',
    code: 'unknown-prop',
    message:
      `<${tag}> has no prop "body" — the child-list key is "children" ` +
      `("body" was retired by objectui#6771)`,
    tag,
  };
}
