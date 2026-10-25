/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The ONE read point for a `record:*` block's `aria` bag (objectui#9556)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The protocol declares an `aria` bag on every `record:*` block this package
 * renders a container for, and `@object-ui/types` mirrors it as
 * {@link RecordComponentAriaProps}. Before objectui#9556 the family read it in
 * three different ways at once, which is what made an authored accessible name
 * a coin flip:
 *
 *   - five containers read NOTHING, so a spec-valid `aria` was accepted at
 *     publish and dropped at render — the author got a success receipt for an
 *     accessibility declaration that reached no user;
 *   - `record:path` read ONLY `aria.label`, the one spelling the shared ARIA
 *     shape refuses, so the spec-valid `aria.ariaLabel` was the value it threw
 *     away;
 *   - `record:quick_actions` read `ariaLabel ?? label` (objectui#4663). This
 *     module applies its CANONICAL half to all of them; the alias half was
 *     retired by objectui#9945 (see below).
 *
 * ⛔ This module does not write down which blocks declare the bag, nor which
 * member spellings the shape accepts. Both are re-derived from the installed
 * `@objectstack/spec` artifact on every run by
 * `__tests__/recordComponentAria-9556.test.tsx` (AGENTS.md #9).
 *
 * ## Why an authored name needs a ROLE to go with it
 *
 * `aria-label` on a bare `div` reaches nobody: a `div` is `generic`, and
 * browsers expose no accessible name on a generic element. `record:path`'s own
 * history is the measured case — `aria-label="Alternative terminal stages"` sat
 * on a `div` and was inert rather than merely untranslated
 * (`record-path.containerLabel.test.tsx` pins the removal). So emitting the
 * attribute alone would have been a change CI calls green and a screen-reader
 * user cannot hear. {@link useRecordAriaProps} therefore emits a role whenever
 * it emits a name.
 *
 * `defaultRole` is each caller's CURRENT role, so a block that renders no
 * `aria` today renders byte-identical DOM: the five containers pass none and
 * stay bare `div`s until an author declares something, `record:path` passes
 * `'list'`, `record:quick_actions` passes `'toolbar'`. The author's own
 * `aria.role` wins over both, which is the precedence `@object-ui/plugin-list`
 * already ships (`ListView`'s list region: the authored role, else `region`),
 * and `'region'` is the fallback for the same reason it is ListView's.
 *
 * ## The bag is mapped by the shared reader (objectui#11083)
 *
 * The three declared keys go through `resolveInlineAriaProps` from
 * `@object-ui/react`, the one reader of the spec's nested bag, resolved
 * against `useDisplayLocale()`. ⛔ This module keeps no mapping of its own. What
 * stays here is what is the block family's own: the caller's `defaultRole` and
 * `defaultLabel`, the `'region'` fallback, and the report of a served
 * `aria.label`.
 *
 * ## An empty name is no name
 *
 * `||` for the built-in default, as objectui#4663 chose: a declared
 * `ariaLabel: ''` resolves to no name at all (the shared reader leaves it
 * out), so the block's built-in default wins, which matches `ListView`'s own
 * read point (it emits no `aria-label` for an empty `ariaLabel`).
 *
 * ## ⛔ The refused `aria.label` spelling is REPORTED, never read (objectui#9945)
 *
 * `label` is the shared ARIA shape's alias entry: refused on parse, declared
 * on no authoring face, in no registry `inputs` list and not on
 * {@link RecordComponentAriaProps}. Two renderers used to fold it in behind
 * the canonical spelling as back-compat for documents written before the
 * contract closed: `record:path`, which read it and nothing else before
 * objectui#9556, and `record:quick_actions`, which objectui#4663 gave the fold.
 * Ruling `5749677059` on objectui#9945 retired that fold under the standing
 * rule that a deprecated alias retires at once, with no staged window unless a
 * named external user needs one. So this module reads `aria.ariaLabel` and
 * nothing else, on every block. One strict contract, no second dialect
 * (AGENTS.md #0.1).
 *
 * The ruling also made the retirement LOUD. A stored document that names one
 * of those two blocks with `aria.label` alone used to be announced by that
 * name, and now announces the block's default name. That is a change a screen-reader
 * user hears and an author cannot see. So when the caller names its block (the
 * `block` option), a served `aria.label` gets one `console.warn` naming the
 * block and the canonical spelling. This is the channel this package already
 * uses for a declaration the spec refuses and the block ignores: the row-cap
 * refusal (`describeRefusedFeedLimit`, objectui#9925 / objectui#10097). It
 * fires from an effect keyed on the message, never from render, so a re-render
 * with the same bag says nothing a second time.
 *
 * `record:path` and `record:quick_actions` pass `block`, because only those
 * two ever read the spelling in a release, so only there does a stored
 * document's name change. The other five blocks never read it in a release
 * (objectui#9935, as merged, kept the fold off them), and objectui#9945 keeps
 * them out of its scope. The refusal on every block is pinned by
 * `__tests__/recordComponentAria-9556.test.tsx`; the default name and the
 * report on those two by `__tests__/recordAriaLabelRetired-9945.test.tsx`.
 */

import { useEffect } from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { resolveInlineAriaProps } from '@object-ui/react';
import type { RecordComponentAriaProps } from '@object-ui/types';

/**
 * The authored `aria` bag as a renderer actually receives it: the declared
 * face, plus the undeclared `label` spelling a stored document may still carry.
 */
export type AuthoredRecordAria = RecordComponentAriaProps & {
  /**
   * ⛔ Not a member of the contract. It is the shared ARIA shape's alias entry
   * and is refused on parse. Declared on this type ONLY so the diagnostic can
   * see it without an `as any` cast (a cast is how `record:path` once came to
   * read this spelling and no other).
   *
   * ⚠️ It is never read as a name. objectui#9945 retired the fold that did;
   * a served value is reported, and only for a caller that names its `block`.
   * See this module's header.
   */
  label?: string;
};

/** What {@link useRecordAriaProps} spreads onto a block's container element. */
export interface RecordAriaDomProps {
  'aria-label'?: string;
  'aria-describedby'?: string;
  role?: string;
}

/**
 * The report for a served `aria.label`, or `null` when there is nothing to
 * say: the caller named no block, or the bag carries no `label`.
 *
 * The message names the block and the canonical spelling, which is what the
 * author needs to fix the document. It carries no authored value, so the
 * effect keyed on it fires once per mounted block.
 */
function describeRefusedAriaLabel(
  block: string | undefined,
  aria: AuthoredRecordAria | undefined,
): string | null {
  if (!block || aria?.label === undefined) return null;
  return (
    `[ObjectUI] ${block} accessible name: \`aria.label\` is not read. The spec's `
    + 'AriaPropsSchema refuses that spelling (it is the alias of `aria.ariaLabel`), so this block '
    + 'announces its `aria.ariaLabel` when one is declared and its default name otherwise. '
    + 'Declare the name as `aria.ariaLabel`.'
  );
}

/**
 * Report a served `aria.label` once per mounted block, for a caller that names
 * its `block`. The spelling is never read as a name.
 *
 * From an effect keyed on the message, never from render: the channel the
 * row-cap refusal uses (objectui#9925), so a re-render says nothing twice.
 */
function useRefusedAriaLabelReport(
  block: string | undefined,
  aria: AuthoredRecordAria | undefined,
): void {
  const refusal = describeRefusedAriaLabel(block, aria);
  useEffect(() => {
    if (refusal) console.warn(refusal);
  }, [refusal]);
}

/**
 * The ARIA DOM props for a `record:*` block's own container.
 *
 * @param aria - the authored bag, straight off the node's `aria` key.
 * @param defaultRole - the role this block renders when the author declares
 *   none. Omit it and the container stays role-less until an author declares a
 *   name, a description or a role — at which point `'region'` carries the name,
 *   because an attribute on a `generic` element carries nothing.
 * @param defaultLabel - the block's built-in accessible name, used when the
 *   author declared none (or declared an empty one).
 * @param block - the block's registered type (`record:path`), named in the
 *   report of a served `aria.label`. Omit it and that spelling is still not
 *   read, just not reported. See this module's header for which blocks pass it.
 */
export function useRecordAriaProps(
  aria: AuthoredRecordAria | undefined,
  {
    defaultRole,
    defaultLabel,
    block,
  }: { defaultRole?: string; defaultLabel?: string; block?: string } = {},
): RecordAriaDomProps {
  const locale = useDisplayLocale();
  useRefusedAriaLabelReport(block, aria);
  const authored = resolveInlineAriaProps(aria, locale);
  // `||`, not `??`: an authored empty name means "no name", not "this name".
  const label = authored['aria-label'] || defaultLabel;
  const describedBy = authored['aria-describedby'];
  const role = authored.role || defaultRole || (label || describedBy ? 'region' : undefined);
  return {
    ...(label ? { 'aria-label': label } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(role ? { role } : {}),
  };
}
