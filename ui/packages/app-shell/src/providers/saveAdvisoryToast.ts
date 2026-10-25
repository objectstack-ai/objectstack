/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Turning the runtime authoring gate's advisory findings (objectui#4133,
 * backend objectstack#7435) into the message the author reads.
 *
 * Lives apart from the client factory that wires it — and, deliberately,
 * imports NOTHING that renders — so the wording and the grouping can be
 * exercised directly. Same split, and the same reason, as its sibling
 * `writeWarningToast.ts`: the caller owns the sink, the test hands over its
 * own, and no module mock is needed.
 *
 * ## Why the save is acknowledged, never failed
 *
 * These findings ride a **200**. The row persisted, the version bumped, and the
 * author's change is live; the gate merely noticed something worth saying about
 * it. So the affordance is the warning tier, and the title says "Saved" first —
 * the mistake this module exists to avoid is a successful save that reads as a
 * failure. `severity` on this channel is never `'error'` (an error-severity
 * finding is a 422 and never reaches a 2xx body), which is why nothing here
 * branches on it.
 *
 * ## Why the finding text is not translated
 *
 * `message` and `hint` are SERVER data — composed by the gate's rules, which
 * name the offending node, object and field. They are rendered verbatim. Only
 * the frame around them (the title, and the "rule — message" scaffolding) is
 * i18n copy. Putting server prose through `t()` would need a key per rule and
 * would go stale the moment a rule's wording changed upstream.
 *
 * @module providers/saveAdvisoryToast
 */

import type { MetadataSaveAdvisoryEvent } from '@object-ui/data-objectstack';
import type { TranslateFn } from '@object-ui/i18n';

/**
 * i18next's `t`, narrowed to what this module uses — RE-EXPORTED from its one
 * authority in `@object-ui/i18n`, never re-declared.
 *
 * This module carried its own byte-identical copy until objectui#8165, which
 * re-pointed it at `writeWarningToast` — then the de facto owner, and the
 * module `AdapterProvider` imports it from when it hands one `t` to all three
 * emitters. The objectui#6172 甲/A1 ruling is that every exported name has
 * exactly one authority, and
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` is the gate
 * that re-derives it: `export type { X } from '<the-owner>'` is a re-export,
 * not a second declaration, and the gate does not count it.
 *
 * objectui#8261 then moved the one declaration DOWN into `@object-ui/i18n`
 * (the maintainer's ruling on objectui#8165, option A), because the copy in
 * `packages/fields/src/widgets/file-size-guard.ts` could not re-export from
 * app-shell — `@object-ui/app-shell` depends on `@object-ui/fields`, so that
 * arrow is a package cycle. This module points at the owner itself rather than
 * at `writeWarningToast`, which is now a re-export too: a reader following the
 * import lands on the declaration in one hop.
 */
export type { TranslateFn } from '@object-ui/i18n';

/**
 * Where the message goes. Structurally satisfied by sonner's `toast`, which is
 * what the console metadata client factory passes.
 *
 * Required rather than defaulted to `sonner` for the same reason the write
 * warning sink is: a default would mean importing the toaster here, which is
 * precisely the dependency that has to stay out of this module.
 */
export interface SaveAdvisorySink {
  warning(title: string, options?: { description?: string; duration?: number }): void;
}

/**
 * How long the advisory stays on screen. Longer than the 4s default because
 * the body is multi-line prose the author has to actually read — the same
 * 10s the pre-publish capability lint uses for its findings toast
 * (`preview/usePublishAllDrafts.ts`), so the two advisory surfaces behave
 * alike.
 */
const ADVISORY_TOAST_MS = 10_000;

/**
 * Render one finding as a line: the rule id that produced it, its message, and
 * its remedy. `where` is appended as secondary context when the gate supplied
 * it — it names the flow/node the finding is about, which is what the author
 * needs to go fix it. `path` is deliberately NOT rendered: it is a document
 * pointer (`flows[0].nodes[2].config…`) meant for tooling, and next to a
 * human-readable `where` it reads as noise.
 */
function formatFinding(f: MetadataSaveAdvisoryEvent['advisories'][number]): string {
  const head = f.where ? `[${f.rule}] ${f.where}` : `[${f.rule}]`;
  const hint = f.hint ? ` ${f.hint}` : '';
  return `${head} — ${f.message}${hint}`;
}

/**
 * The frame's verb, chosen by the door the write came through.
 *
 * An exhaustive `switch` with a `never` check rather than a two-way ternary,
 * and the difference is the whole point of the field. A ternary answers
 * "is it publish, else save" — so a THIRD door added to the union would
 * compile everywhere, declare itself honestly at its constructor, and still
 * silently render "Saved". That is precisely the silent-wrong-verb class
 * `door` exists to kill, reintroduced one level up. Here a new member makes
 * this function a compile error instead, which is the only form of the
 * guarantee worth having: the type must not merely be STATED, it must be
 * HANDLED.
 *
 * The `default` branch is unreachable for type-checked callers — it exists
 * for an untyped one (the event type is published, and JS consumers are not
 * bound by it). It throws rather than falling back to the save wording,
 * because both emitters wrap the sink in a try/catch that swallows: the
 * failure mode is therefore "no toast", never "a toast that says the wrong
 * thing about what just happened to the author's data".
 */
function advisoryTitle(ev: MetadataSaveAdvisoryEvent, t: TranslateFn): string {
  const count = ev.advisories.length;
  switch (ev.door) {
    case 'save':
      return t('console.saveAdvisoryTitle', {
        count,
        defaultValue: 'Saved — the authoring check raised {{count}} advisory finding(s)',
      });
    case 'publish':
      return t('console.publishAdvisoryTitle', {
        count,
        defaultValue: 'Published — the authoring check raised {{count}} advisory finding(s)',
      });
    default: {
      const unhandled: never = ev.door;
      throw new Error(
        `saveAdvisoryToast: no title for advisory door ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * Announce the gate's advisory findings for a metadata write that SUCCEEDED.
 *
 * Says nothing when there is nothing to say: the server omits `advisories`
 * entirely on a clean write, so the common case never reaches here, and an
 * event that somehow carried an empty list is dropped rather than toasted as
 * "0 findings".
 *
 * ## One renderer, two doors (#5026)
 *
 * The publish door reports through this same function, the same warning tier,
 * the same duration and the same per-finding formatting — a second SOURCE, not
 * a second surface. Only the frame's verb changes, and it has to: Save and
 * Publish are two different buttons in this product, so "Saved" after a Publish
 * would tell the author their change is still a draft. `ev.door` is what says
 * which one, because `ev.mode` cannot — a direct active save and a draft
 * promotion both report `mode: 'publish'`. The choice is an exhaustive switch,
 * not a two-way test: see {@link advisoryTitle} for why that distinction is
 * the field's actual guarantee.
 */
export function emitSaveAdvisories(
  ev: MetadataSaveAdvisoryEvent,
  t: TranslateFn,
  sink: SaveAdvisorySink,
): void {
  if (!ev.advisories || ev.advisories.length === 0) return;

  sink.warning(
    advisoryTitle(ev, t),
    {
      description: ev.advisories.map(formatFinding).join('\n'),
      duration: ADVISORY_TOAST_MS,
    },
  );
}
