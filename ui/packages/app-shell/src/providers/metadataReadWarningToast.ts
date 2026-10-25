/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Turning a metadata read-warning (objectui#7741) into the message the user
 * reads.
 *
 * Lives apart from `AdapterProvider` — and, deliberately, imports NOTHING that
 * renders — so the wording and the reason-branching can be exercised directly.
 * Same split, and the same reason, as its siblings `writeWarningToast.ts` and
 * `saveAdvisoryToast.ts`: the caller owns the sink, the test hands over its
 * own, and no module mock is needed.
 *
 * ## Why this surface has to exist at all
 *
 * `listImportMappings` degrades every failure to an empty list, and the import
 * wizard hides its saved-mapping selector on an empty list. So a refused or
 * broken door rendered exactly like "no mapping is registered": the feature was
 * simply ABSENT, with a `console.warn` as the only discriminator — in the
 * browser console, with nothing in the UI pointing at it. A user without
 * devtools open could not tell the two apart, and neither could a careful
 * reporter: objectstack#14026 was filed, routed and worked by two seats on that
 * misreading. Promoting the log level would not have changed any of it. This
 * module is the half that makes the failure visible where the decision is made.
 *
 * ## The same surface, a second read (objectui#8151)
 *
 * `listViews` carried the identical swallow, and its cost is the higher one: an
 * empty view list is an object's VIEW SWITCHER, so a user whose token lapsed
 * mid-session was shown an object that appears to have no saved views at all —
 * including views they created. It is the second emitter on this channel, and
 * every string below is chosen by WHICH read failed rather than shared, because
 * a hedged sentence about "a list" would put the ambiguity back in the copy
 * after the event removed it from the data.
 *
 * ## What it deliberately does NOT say
 *
 * Nothing about the supported case. The adapter classifies that arm as
 * `not-served` and emits no event at all, so a deployment in a real, supported
 * shape earns no toast — turning one into a visible fault is the failure this
 * surface must not commit. ⚠️ WHICH failures are in that arm is decided per
 * read and is not the same set twice: a server that does not serve the
 * `mapping` kind is quiet, while on `view` only a host with no metadata door at
 * all is (`classifyImportMappingsFailure` / `classifyViewsFailure`).
 *
 * ## Why the server's own words are appended untranslated
 *
 * `code`, `status` and `message` are SERVER data. They are the evidence that
 * separates "could not be read" from "there are none", they are what a user
 * pastes into a bug report, and they go stale the moment the producer rewords
 * them. Only the frame — the title and the remedy sentence — is i18n copy, the
 * same division `saveAdvisoryToast.ts` draws.
 *
 * @module providers/metadataReadWarningToast
 */

import type { MetadataReadWarningEvent } from '@object-ui/data-objectstack';
import type { TranslateFn } from '@object-ui/i18n';

/**
 * i18next's `t`, narrowed to what this module uses — RE-EXPORTED from its one
 * authority in `@object-ui/i18n`, never re-declared.
 *
 * The rest of this module was modelled on its two siblings, and when it was
 * written (objectui#7741) a further copy of their local
 * `export type TranslateFn = …` came along with the pattern. The objectui#6172
 * 甲/A1 ruling is that every exported name has exactly one authority, and
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` caught it;
 * its remedy is this: `export type { X } from '<the-owner>'` is a re-export,
 * not a second declaration, and the gate does not count it. ⛔ The baseline it
 * also carries is SHRINK-ONLY and is not an option here.
 *
 * The owner was `writeWarningToast` then. objectui#8261 moved the one
 * declaration DOWN into `@object-ui/i18n` (the maintainer's ruling on
 * objectui#8165, option A) — the only home the `@object-ui/fields` copy could
 * re-export from, since `@object-ui/app-shell` depends on `@object-ui/fields`
 * and not the other way round. This module points at the owner itself rather
 * than at `writeWarningToast`, which is now a re-export too.
 */
export type { TranslateFn } from '@object-ui/i18n';

/**
 * Where the message goes. Structurally satisfied by sonner's `toast`, which is
 * what `AdapterProvider` passes.
 *
 * Required rather than defaulted to `sonner` for the same reason its two
 * siblings are: a default would mean importing the toaster here, which is
 * precisely the dependency that has to stay out of this module.
 */
export interface MetadataReadWarningSink {
  warning(title: string, options?: { description?: string; duration?: number }): void;
}

/**
 * How long the warning stays on screen. The body is a remedy plus the server's
 * own words, which the user has to actually read — the same 10s the advisory
 * surfaces use, so the warning tier behaves alike wherever it appears.
 */
const READ_WARNING_TOAST_MS = 10_000;

/**
 * The remedy sentence for a failed `listImportMappings`, chosen by WHICH loud
 * verdict this was.
 *
 * An exhaustive `switch` with a `never` check rather than a ternary, for the
 * reason `saveAdvisoryToast.advisoryTitle` records: a ternary answers "is it
 * refused, else unreadable", so a THIRD reason added to the union would compile
 * everywhere and silently render the wrong remedy. Here it is a compile error
 * instead — the type must not merely be STATED, it must be HANDLED.
 *
 * The `default` branch is unreachable for type-checked callers; it exists for
 * an untyped one (the event type is published, and JS consumers are not bound
 * by it). It throws rather than falling back to either sentence, because the
 * caller wraps this in a try/catch that swallows: the failure mode is therefore
 * "no toast", never "a toast naming the wrong remedy".
 */
function importMappingsRemedy(
  reason: MetadataReadWarningEvent['reason'],
  t: TranslateFn,
): string {
  switch (reason) {
    case 'refused':
      return t('console.importMappingsRefused', {
        defaultValue:
          'The server refused this request, so this list is empty because it could not be read — not because nothing is registered. Sign in again, or ask an administrator for access.',
      });
    case 'unreadable':
      return t('console.importMappingsUnreadable', {
        defaultValue:
          'This list is empty because it could not be read, not because nothing is registered. Try again, and report this if it keeps happening.',
      });
    default: {
      const unhandled: never = reason;
      throw new Error(
        `metadataReadWarningToast: no remedy for reason ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * The remedy sentence for a failed `listViews` (objectui#8151).
 *
 * Same two verdicts, same `never` discipline — a DIFFERENT second clause. The
 * whole point of the sentence is to deny the wrong reading the empty list
 * invites, and the wrong reading differs per list: "nothing is registered" is
 * what an absent saved-mapping selector says, while an empty `listViews` says
 * *this object has no saved views* — including the ones the user created
 * themselves, which is what makes it the sharper lie of the two.
 */
function savedViewsRemedy(
  reason: MetadataReadWarningEvent['reason'],
  t: TranslateFn,
): string {
  switch (reason) {
    case 'refused':
      return t('console.savedViewsRefused', {
        defaultValue:
          'The server refused this request, so this list is empty because it could not be read — not because this object has no saved views. Sign in again, or ask an administrator for access.',
      });
    case 'unreadable':
      return t('console.savedViewsUnreadable', {
        defaultValue:
          'This list is empty because it could not be read, not because this object has no saved views. Try again, and report this if it keeps happening.',
      });
    default: {
      const unhandled: never = reason;
      throw new Error(
        `metadataReadWarningToast: no remedy for reason ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * Which read failed decides BOTH strings (objectui#8151).
 *
 * `operation` — the adapter method — is the discriminant, not `kind`: it is
 * what names the list the user is standing in front of, and the two fields are
 * independent unions on the published event, so only one of them can be the
 * authority here. Exhaustive with a `never` check for the reason the per-reason
 * switches are: this file is the consumer objectui#7741 kept `operation` a
 * closed union FOR, so a third emitter must fail to compile here rather than
 * silently render some other read's sentence.
 *
 * ⛔ There is no shared "generic" wording either branch falls back to. A toast
 * that hedges about WHICH list could not be read would re-introduce, in copy,
 * exactly the ambiguity the event was added to remove.
 */
function remedy(ev: MetadataReadWarningEvent, t: TranslateFn): string {
  switch (ev.operation) {
    case 'listImportMappings':
      return importMappingsRemedy(ev.reason, t);
    case 'listViews':
      return savedViewsRemedy(ev.reason, t);
    default: {
      const unhandled: never = ev.operation;
      throw new Error(
        `metadataReadWarningToast: no remedy for operation ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * The headline, chosen by the same discriminant and held to the same rule as
 * {@link remedy} (objectui#8151).
 *
 * Before this card the title was one hard-coded `t('console.importMappingsUnavailable')`.
 * That is the shape a second emitter would have turned into a runtime lie —
 * *"Saved import mappings for account could not be loaded"* on a failed VIEW
 * read — with nothing failing to compile, which is precisely what the closed
 * `operation` union exists to prevent.
 */
function title(ev: MetadataReadWarningEvent, t: TranslateFn): string {
  switch (ev.operation) {
    case 'listImportMappings':
      return t('console.importMappingsUnavailable', {
        object: ev.objectName,
        defaultValue: 'Saved import mappings for {{object}} could not be loaded',
      });
    case 'listViews':
      return t('console.savedViewsUnavailable', {
        object: ev.objectName,
        defaultValue: 'Saved views for {{object}} could not be loaded',
      });
    default: {
      const unhandled: never = ev.operation;
      throw new Error(
        `metadataReadWarningToast: no title for operation ${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * The server's own words about its own answer, as one line — or nothing at all
 * when it sent none.
 *
 * Assembled from whichever of the three the event carries, in the order a
 * reader needs them: the ADR-0112 code (the contract field the adapter branched
 * ON), the HTTP status, then the message. A failure that declared none of them
 * — a dropped connection, say — adds no line rather than an empty parenthesis.
 */
function serverDetail(ev: MetadataReadWarningEvent): string | undefined {
  const head = [ev.code, ev.status !== undefined ? `HTTP ${ev.status}` : undefined]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' · ');
  const parts = [head, ev.message].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return parts.length > 0 ? parts.join(' — ') : undefined;
}

/**
 * Announce a metadata read that could not be answered and was degraded to an
 * empty result anyway.
 *
 * The title names the object, because that is the scope the empty list is about
 * and the surface the user is standing in — the import wizard, or one object's
 * view switcher — is open on exactly one object.
 */
export function emitMetadataReadWarning(
  ev: MetadataReadWarningEvent,
  t: TranslateFn,
  sink: MetadataReadWarningSink,
): void {
  const detail = serverDetail(ev);
  sink.warning(title(ev, t), {
    description: detail ? `${remedy(ev, t)}\n${detail}` : remedy(ev, t),
    duration: READ_WARNING_TOAST_MS,
  });
}
