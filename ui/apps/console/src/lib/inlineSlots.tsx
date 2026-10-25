/**
 * Sentences with an inline element in them — a bold action name, a `<code>`
 * key — translated as ONE string (objectui#13460).
 *
 * Splitting such a sentence into a before-part and an after-part would fix the
 * word order to English's: ja and ko put the action after its object. So each
 * element's `{{slot}}` is interpolated with a private-use mark from
 * {@link SLOT}, and {@link withSlots} splits the translated sentence on those
 * marks, drawing the element where the language put it. The same technique as
 * `element:metadata_viewer`'s chips (objectui#12910).
 */

import { Fragment, type ReactNode } from 'react';

/** The marks a `{{slot}}` is filled with: slot `i` is drawn as `nodes[i]`. */
export const SLOT = ['', '', ''] as const;

/** The translated `text` with `nodes[i]` drawn where `SLOT[i]` was interpolated. */
export function withSlots(text: string, nodes: readonly ReactNode[]): ReactNode {
  return text.split(/([-])/u).map((part, i) => {
    const at = (SLOT as readonly string[]).indexOf(part);
    return <Fragment key={i}>{at === -1 ? part : nodes[at]}</Fragment>;
  });
}
