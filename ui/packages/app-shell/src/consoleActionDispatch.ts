/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's action DISPATCH contract — what a host in this package hands
 * to the action runtime, as opposed to what an author may write in metadata.
 *
 * ## Why this type exists at all
 *
 * `ActionDef` (`@object-ui/core`) is the AUTHORED-METADATA mirror: it describes
 * what a metadata document may declare on an action, and objectstack#4075
 * step 3 closed it (the `[key: string]: any` is gone, so `tsc` rejects an
 * unknown key at the construction site). Every key on it is therefore a key an
 * author may legally write.
 *
 * A host, however, composes keys of its own at dispatch time — chrome the
 * runtime reads once and nothing ever stores. `overrideNotice` is the first of
 * those. Declaring it on `ActionDef` was implemented and REJECTED (maintainer
 * ruling 2026-08-22, reaffirming the 2026-08-22 morning Option-B ruling with
 * its shape made precise):
 *
 *   > the 17 undeclared-in-spec keys already on `ActionDef` are author-writable,
 *   > runtime-honoured runner mechanics; `overrideNotice` is the first key that
 *   > is NOT author-supplied at all — declaring it on the authored-metadata
 *   > mirror would let an author (human or AI) legally write a key whose
 *   > enforcement on that path is unmeasured, i.e. a declared-but-unenforced
 *   > surface, which is the platform's red line.
 *
 * So the key is declared HERE instead: at the seam, in the one package where
 * both its producer and its reader live. The authored surface stays exactly as
 * strict as it was — writing `overrideNotice` in an `ActionDef` literal is
 * still a compile error, and `@object-ui/core`'s published `.d.ts` does not
 * move — while the dispatch that really does carry the key finally has a
 * declaration to carry it on.
 *
 * ## What it replaces
 *
 * A `dispatch as ActionDef` cast in `DeclaredActionsBar`, with `action?: any`
 * on both param-collection handlers at the other end. Between those two the key
 * crossed the entire seam with nothing declaring it, so producer and reader
 * could disagree in silence: rename it on either side and the notice simply
 * stops appearing, with every existing test still green (each side's suite
 * spells the key itself, so neither can see the other drift). The safety copy
 * this carries is shown ONCE, in front of a privileged admin override that
 * finalises an approval step over approvers who have not acted — a string that
 * must not be able to vanish quietly.
 *
 * ## Producer / reader
 *
 * - producer — `views/DeclaredActionsBar.tsx`, which sets `overrideNotice` on
 *   the privileged-override branch (`can_act:false && can_override:true`),
 *   naming the approvers about to be bypassed.
 * - readers — `hooks/useConsoleActionRuntime.tsx` and
 *   `views/RecordDetailView.tsx`, the two param-collection handlers the console
 *   mounts. The first renders the notice ahead of the declared description in
 *   the param dialog's subtitle; the second is the same seam and takes the same
 *   envelope, so the two handlers cannot drift apart from each other either.
 *
 * Deliberately NOT re-exported from this package's barrel (`src/index.ts`):
 * it is the contract BETWEEN two modules of this package, not a type any host
 * outside it composes. Keeping it off `dist/index.d.ts` means this card adds no
 * published surface anywhere.
 */

import type { ActionDef } from '@object-ui/core';

/**
 * An action as DISPATCHED by a console host: everything an author may declare,
 * plus the host-composed chrome the runtime reads on the way to the dialog.
 *
 * Anything added here must satisfy all three of: composed by a host in code,
 * never read back out of stored metadata, and read by the console runtime. A
 * key an AUTHOR is meant to write belongs on `ActionDef` (or, when the spec
 * owns it, in `@objectstack/spec` first) — not here.
 */
export type ConsoleActionDispatch = ActionDef & {
  /**
   * A notice that must reach the user AHEAD of the declared description, shown
   * at the top of the param-collection dialog's subtitle.
   *
   * Composed by `DeclaredActionsBar` for the privileged admin-override branch
   * and arriving ALREADY LOCALIZED (bar chrome, resolved through the normal
   * locale bundle), so its reader concatenates it verbatim.
   *
   * Deliberately NOT folded into `description` (objectui#5178): the reader
   * resolves `description` through `_actions.<name>.description` and PREFERS a
   * bundle hit over the passed literal, and `plugin-approvals` ships exactly
   * such an entry for `approval_reject` — so a warning routed through
   * `description` would be silently replaced by the ordinary "Reject this
   * request?" copy in every locale that has the bundle. A safety notice a
   * translation can delete is not a safety notice.
   */
  overrideNotice?: string;
};
