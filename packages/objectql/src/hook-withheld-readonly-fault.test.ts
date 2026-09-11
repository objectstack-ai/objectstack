// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17219] The composer's contract, at the seam rather than through a driver.
 *
 * The three DECLINE conditions carry as much weight as the accept case, and for
 * the reason the card is about: a diagnostic that fires on the wrong error is
 * the same defect this fixes, aimed the other way. So each decline is asserted
 * with the SAME error the accept case uses wherever the condition permits it,
 * which is what makes the assertions about the condition rather than about the
 * error.
 */

import { describe, it, expect } from 'vitest';
import {
  withheldReadonlyHookFault,
  dispatchHooksExplainingWithheldReadonly,
  HookWithheldReadonlyFaultError,
} from './hook-withheld-readonly-fault.js';

/** The real shape `quickjs-runner.ts` throws — name `SandboxError`, native prefix kept on `innerMessage`. */
class SandboxErrorLike extends Error {
  innerMessage?: string;
  constructor(message: string, innerMessage?: string) {
    super(message);
    this.name = 'SandboxError';
    this.innerMessage = innerMessage;
  }
}

/** Measured verbatim on `origin/main` `501959b72a` — see the module header. */
const REAL_CRASH = () =>
  new SandboxErrorLike(
    "hook 'guard_task_body' threw: TypeError: cannot set property 'who' of undefined",
    "TypeError: cannot set property 'who' of undefined",
  );

const HIDDEN = { locked_meta: { who: 'caller' } };

describe('#17219 withheldReadonlyHookFault', () => {
  it('names the key, says the platform withheld it, and points at ctx.previous', () => {
    const out = withheldReadonlyHookFault(REAL_CRASH(), HIDDEN, 'beforeUpdate');
    expect(out).toBeInstanceOf(HookWithheldReadonlyFaultError);
    const msg = out!.message;
    // ① the withheld KEY is named …
    expect(msg).toContain('`locked_meta`');
    // ② … as WITHHELD BY THE PLATFORM, not absent by accident …
    expect(msg).toContain('withheld by the platform, not missing by accident');
    expect(msg).toContain('`readonly: true`');
    // ③ … and the documented remedy is reachable from the message itself.
    expect(msg).toContain('`ctx.previous.locked_meta`');
    // The original fault is carried, never replaced: an author debugging the
    // body still gets the line that actually threw.
    expect(msg).toContain("TypeError: cannot set property 'who' of undefined");
    expect(out!.withheldKeys).toEqual(['locked_meta']);
    expect(out!.cause).toBeDefined();
  });

  it('declares 400 — the whole envelope change, and what makes the message reachable', () => {
    // Measured: without a declared status `mapDataError` answers
    // `UNCLASSIFIED_FAULT` (500, sanitised body) and the message above never
    // reaches the author at the REST door. `packages/rest`'s
    // `declaredHttpStatus` reads exactly this property.
    expect(withheldReadonlyHookFault(REAL_CRASH(), HIDDEN, 'beforeUpdate')!.status).toBe(400);
  });

  it('names every withheld key when the pass hid more than one', () => {
    const out = withheldReadonlyHookFault(
      REAL_CRASH(), { locked_meta: {}, locked_note: 'CALLER' }, 'beforeUpdate',
    );
    expect(out!.message).toContain('`locked_meta`, `locked_note`');
    expect(out!.message).toContain('`ctx.previous.locked_meta`, `ctx.previous.locked_note`');
    expect(out!.withheldKeys).toEqual(['locked_meta', 'locked_note']);
  });

  it('DECLINES when nothing was withheld — an unrelated crash keeps its own words', () => {
    expect(withheldReadonlyHookFault(REAL_CRASH(), undefined, 'beforeUpdate')).toBeUndefined();
    expect(withheldReadonlyHookFault(REAL_CRASH(), {}, 'beforeUpdate')).toBeUndefined();
  });

  it('DECLINES on an AUTHORED refusal, so a business message is never rewritten', () => {
    // The one that would be a real regression: `mapDataError` serves this text
    // to the caller verbatim at 400, and overwriting it would destroy the
    // author's own words while a readonly key happened to be hidden.
    const authored = new SandboxErrorLike("hook 'guard' threw: 仍有未结清的发票", '仍有未结清的发票');
    expect(withheldReadonlyHookFault(authored, HIDDEN, 'beforeUpdate')).toBeUndefined();
    // And the non-sandboxed spelling of the same thing.
    expect(withheldReadonlyHookFault(new Error('仍有未结清的发票'), HIDDEN, 'beforeUpdate')).toBeUndefined();
  });

  it('ACCEPTS a CODE hook crash, which carries the native name in `name` instead', () => {
    const out = withheldReadonlyHookFault(
      new TypeError("Cannot set properties of undefined (setting 'who')"), HIDDEN, 'beforeUpdate',
    );
    expect(out).toBeInstanceOf(HookWithheldReadonlyFaultError);
    expect(out!.message).toContain('`locked_meta`');
  });

  it('declines on a non-object throw rather than fabricating a shape', () => {
    expect(withheldReadonlyHookFault('boom', HIDDEN, 'beforeUpdate')).toBeUndefined();
  });
});

describe('#17219 dispatchHooksExplainingWithheldReadonly', () => {
  it('is transparent on success', async () => {
    await expect(dispatchHooksExplainingWithheldReadonly(HIDDEN, 'beforeUpdate', async () => 'ok'))
      .resolves.toBe('ok');
  });

  it('rethrows the ORIGINAL error object when the composer declines', async () => {
    const authored = new Error('仍有未结清的发票');
    await expect(
      dispatchHooksExplainingWithheldReadonly(HIDDEN, 'beforeUpdate', async () => { throw authored; }),
    ).rejects.toBe(authored);
  });

  it('replaces an anonymous crash with the named refusal', async () => {
    await expect(
      dispatchHooksExplainingWithheldReadonly(HIDDEN, 'beforeUpdate', async () => { throw REAL_CRASH(); }),
    ).rejects.toBeInstanceOf(HookWithheldReadonlyFaultError);
  });
});
