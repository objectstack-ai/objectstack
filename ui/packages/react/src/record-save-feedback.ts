/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * record-save-feedback — the ONE toast of a record save
 * (objectstack-ai/objectstack#27999).
 *
 * A write that succeeds with advisory `warnings` reaches the user through two
 * doors: the write-warning channel (`app-shell`'s `emitWriteWarning`, fed by
 * the adapter's write-warning event) and the save surface's own record-named
 * success toast. While a save surface is open it CLAIMS the warnings of the
 * write it makes ({@link claimAnswerWarnings}); the channel parks them on that
 * claim ({@link parkAnswerWarnings}) instead of raising its own toast, and the
 * surface's toast carries them ({@link toastRecordSave}).
 *
 * It lives here, below every save surface — `app-shell`'s record page and
 * record dialogs, and `plugin-form`'s `object-form` drawer and modal — so
 * there is one claim registry and one matching rule for all of them
 * (objectstack-ai/objectstack#28216). Like `data-invalidation`, it renders
 * nothing: the caller owns the toast sink.
 */

/**
 * The part of a write-warning event the claim reads. `@object-ui/data-objectstack`'s
 * `WriteWarningEvent` satisfies it structurally; this package sits below that
 * one and cannot import it.
 */
export interface AnswerWarningsEvent {
  operation: 'create' | 'update';
  resource: string;
  id?: string | number;
  warnings?: readonly { message?: string }[];
}

/**
 * The writes a record save surface reports itself: the record form an open
 * overlay or page saves. An update names the record it writes; a create's
 * record id is only known from its answer.
 */
export interface AnswerWarningScope {
  operation: AnswerWarningsEvent['operation'];
  resource: string;
  id?: string | number;
}

/** A record save surface's hold on the answer warnings of its own write. */
export interface AnswerWarningClaim {
  /**
   * The distinct warning messages of the write that answered `saved`, removed
   * from the claim. Every other event the claim parked is shown on the
   * channel's own toast at once, so a write the surface did not make keeps
   * the toast it always had.
   */
  take(saved: unknown): string[];
  /** Close the claim; whatever it still parks is shown on the channel's toast. */
  release(): void;
}

/** The write answer's advisory `warnings`, one entry per distinct message. */
export function answerWarningLines(ev: AnswerWarningsEvent): string[] {
  const messages: string[] = [];
  for (const w of ev.warnings ?? []) {
    if (w.message && !messages.includes(w.message)) messages.push(w.message);
  }
  return messages;
}

interface ParkedAnswerWarnings {
  ev: AnswerWarningsEvent;
  show: () => void;
}

interface ClaimEntry {
  scope: AnswerWarningScope;
  parked: ParkedAnswerWarnings[];
}

/** Open claims per adapter instance: the one the write-warning channel subscribes to. */
const CLAIMS = new WeakMap<object, Set<ClaimEntry>>();

const sameId = (a: unknown, b: unknown): boolean =>
  a === undefined || a === null ? b === undefined || b === null : String(a) === String(b);

function matchingClaim(adapter: object, ev: AnswerWarningsEvent): ClaimEntry | undefined {
  for (const entry of CLAIMS.get(adapter) ?? []) {
    const { scope } = entry;
    if (scope.operation !== ev.operation || scope.resource !== ev.resource) continue;
    if (scope.operation === 'update' && !sameId(scope.id, ev.id)) continue;
    return entry;
  }
  return undefined;
}

/**
 * The write-warning channel's side: park `ev`'s answer warnings on the open
 * claim that names it, with `show` as the channel's own toast for them should
 * the claim hand them back. True when a claim took them, so the channel stays
 * quiet; false when none names the write, so the channel toasts as it always
 * did.
 *
 * Call it SYNCHRONOUSLY when the event arrives: the adapter emits the event
 * inside the write, before the write's promise settles, so the claim holds
 * the warnings by the time the surface's success handler runs.
 */
export function parkAnswerWarnings(adapter: object, ev: AnswerWarningsEvent, show: () => void): boolean {
  const claim = matchingClaim(adapter, ev);
  if (!claim) return false;
  claim.parked.push({ ev, show });
  return true;
}

/**
 * Claim the answer warnings of the writes `scope` names on `adapter`, for as
 * long as the surface that will report them is open. The surface reads its
 * write's warnings with {@link AnswerWarningClaim.take} when the save succeeds
 * and closes the claim with {@link AnswerWarningClaim.release} when it closes;
 * no parked warning is dropped by either.
 */
export function claimAnswerWarnings(adapter: object, scope: AnswerWarningScope): AnswerWarningClaim {
  const entry: ClaimEntry = { scope, parked: [] };
  let open = CLAIMS.get(adapter);
  if (!open) CLAIMS.set(adapter, (open = new Set()));
  open.add(entry);
  const showAll = (list: ParkedAnswerWarnings[]) => {
    for (const p of list) p.show();
  };
  return {
    take(saved) {
      const record = saved && typeof saved === 'object' ? (saved as { id?: unknown; _id?: unknown }) : undefined;
      const savedId = record?.id ?? record?._id;
      // An update's parked events already name its record; a create's are its
      // own only when the answer's record id is the saved record's.
      const own = entry.parked.filter((p) => scope.operation === 'update' || sameId(p.ev.id, savedId));
      const others = entry.parked.filter((p) => !own.includes(p));
      entry.parked = [];
      showAll(others);
      const messages: string[] = [];
      for (const p of own) {
        for (const m of answerWarningLines(p.ev)) if (!messages.includes(m)) messages.push(m);
      }
      return messages;
    },
    release() {
      open?.delete(entry);
      const left = entry.parked;
      entry.parked = [];
      showAll(left);
    },
  };
}

/** Where a record save toast goes. Structurally satisfied by sonner's `toast`. */
export interface RecordSaveSink {
  success(title: string): void;
  warning(title: string, options?: { description?: string }): void;
}

/**
 * The one toast of a record save: the surface's record-named message, carrying
 * its write's advisory warnings one per line on the warning variant when there
 * are any.
 */
export function toastRecordSave(sink: RecordSaveSink, message: string, warnings: readonly string[] = []): void {
  if (warnings.length > 0) sink.warning(message, { description: warnings.join('\n') });
  else sink.success(message);
}
