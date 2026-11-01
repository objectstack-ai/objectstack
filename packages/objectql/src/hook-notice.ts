// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The hook face of the save notice — `ctx.notice(message)` (#28251).
 *
 * `HookContextSchema.notice` (`@objectstack/spec/data`) is the contract. The
 * engine is its one producer: {@link ObjectQL.triggerHooks} binds it on every
 * insert / update dispatch, before any handler runs, so every dispatch site —
 * one record, each row of a batch, `before*` and `after*` — gets the same
 * member, and no site can forget it.
 *
 * It is the write's own `onNotice` listener (`WriteObservabilityOptions`) and
 * nothing else: a call reads the listener off `ctx.input.options` at CALL
 * time — the caller's bag, which a `before*` handler reads as passed and an
 * `after*` handler reads after `buildDriverOptions` widened it (it never
 * strips a key) — and hands it the message. A write that passed no listener
 * (a batch, a seed, an import, a flow node's own write) sets nothing; no
 * second channel exists to fall back on.
 *
 * The member, not the listener, judges the message: anything but a non-empty
 * string is refused with a `TypeError` naming the call, so a mistaken call is
 * loud instead of a silent no-op (the listener alone would drop it).
 */

import type { HookContext, HookNoticeSetter } from '@objectstack/spec/data';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';

/** The dispatches whose write answers a notice: insert and update, both phases. */
const NOTICE_EVENTS: ReadonlySet<string> = new Set(['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate']);

/** What a refused message was, for the refusal's sentence. */
function kindOf(value: unknown): string {
  if (value === null) return '`null`';
  if (typeof value === 'string') return 'a blank string';
  if (Array.isArray(value)) return 'an array';
  return `${typeof value === 'object' ? 'an' : 'a'} ${typeof value}`;
}

/** The `ctx.notice` member for one dispatch context. */
function noticeSetterFor(context: HookContext): HookNoticeSetter {
  return (message: unknown) => {
    if (typeof message !== 'string' || message.trim() === '') {
      throw new TypeError(
        `ctx.notice(message) takes one non-empty string, the sentence the person who made this write reads — got `
          + `${kindOf(message)}. Pass the text itself, or leave the call out when there is nothing to say.`,
      );
    }
    const options = (context.input as { options?: unknown } | undefined)?.options as
      | WriteObservabilityOptions
      | undefined;
    options?.onNotice?.(message);
  };
}

/**
 * Bind `context.notice` for `event`: the write's listener on an insert /
 * update dispatch, and no member at all on every other one (whose answer
 * carries no notice). The engine builds every `HookContext`, so the member is
 * always the engine's — a context arriving with one of its own is rebound.
 */
export function bindHookNotice(event: string, context: HookContext): void {
  if (NOTICE_EVENTS.has(event)) {
    (context as { notice?: HookNoticeSetter }).notice = noticeSetterFor(context);
    return;
  }
  delete (context as { notice?: HookNoticeSetter }).notice;
}
