/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11344 — the success toast is composed from the author's copy, by the
 * contract's three rungs, and the server's own sentence is not one of them.
 *
 * Ruling A on objectstack-ai/cloud#2315: the server returns FACTS (a closed
 * `outcome` and the values around it) and the console writes the sentence in
 * the user's locale. `ActionSchema.outcomeMessages` (`@objectstack/spec`
 * 17.6.0) carries the copy per outcome, and the spec's own docblock gives the
 * selection: the success payload's top-level `outcome` names the entry; failing
 * a match, `successMessage`; failing that, the runner's default text. Each
 * message may interpolate `${result.*}`, the scope `onSuccess.navigate`
 * declares.
 *
 * Every assertion reads what the host's toast handler RECEIVES — the only thing
 * the user sees. The handler's answer in most rows also carries a `message`, so
 * a row can only go green when that message is NOT what was shown.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ActionRunner } from '../ActionRunner';
import type { ActionDef, ActionResult, ToastHandler } from '../ActionRunner';

/** What cloud's `delete_environment` answers with: facts, plus a legacy sentence. */
const ARCHIVED = {
  outcome: 'archived',
  name: 'prod',
  message: 'Environment prod archived (server English).',
};

/** The authored action: one copy per outcome, plus the fallback copy. */
const DELETE_ENVIRONMENT: ActionDef = {
  type: 'script',
  name: 'delete_environment',
  outcomeMessages: {
    archived: 'Environment ${result.name} archived',
    already_archived: 'Environment ${result.name} was already archived',
  },
  successMessage: 'Environment ${result.name} updated',
};

describe('ActionRunner success toast — outcomeMessages, then successMessage, then the default (objectui#11344)', () => {
  let runner: ActionRunner;
  let toast: Mock<ToastHandler>;
  let answer: ActionResult;

  beforeEach(() => {
    runner = new ActionRunner();
    toast = vi.fn();
    runner.setToastHandler(toast);
    answer = { success: true, data: ARCHIVED };
    runner.registerHandler('script', async () => answer);
  });

  /** The text of the one success toast the run raised. */
  const shown = () => {
    const calls = toast.mock.calls.filter(([, options]) => options?.type === 'success');
    expect(calls).toHaveLength(1);
    return calls[0][0];
  };

  it('rung 1 — the entry named by the answer\'s outcome, with ${result.*} filled in', async () => {
    await runner.execute(DELETE_ENVIRONMENT);
    expect(shown()).toBe('Environment prod archived');
  });

  it('rung 1 picks by the outcome, not by declaration order', async () => {
    answer = { success: true, data: { ...ARCHIVED, outcome: 'already_archived' } };
    await runner.execute(DELETE_ENVIRONMENT);
    expect(shown()).toBe('Environment prod was already archived');
  });

  it('rung 1 reads the HANDLER value under a legacy double envelope, the level ${result.*} reads', async () => {
    // Pre-objectstack#3962 servers wrapped the action answer once more;
    // `readActionPayload` is the one place that unwraps it, and the outcome is
    // read at the same level the `${result.*}` tokens are.
    answer = { success: true, data: { success: true, data: { outcome: 'archived', name: 'prod' } } };
    await runner.execute(DELETE_ENVIRONMENT);
    expect(shown()).toBe('Environment prod archived');
  });

  it('rung 2 — an outcome with no entry falls back to successMessage, interpolated the same way', async () => {
    answer = { success: true, data: { ...ARCHIVED, outcome: 'purge_deferred' } };
    await runner.execute(DELETE_ENVIRONMENT);
    expect(shown()).toBe('Environment prod updated');
  });

  it('rung 2 — an action with only successMessage shows it, interpolated', async () => {
    answer = { success: true, data: { update_count: 2, summary: 'CRM 1.0.0→1.0.1' } };
    await runner.execute({
      type: 'script',
      name: 'check_app_updates',
      successMessage: '${result.update_count} update(s): ${result.summary}',
    });
    // Inserted as TEXT. The same grammar percent-encodes in a URL position
    // (`onSuccess.navigate`), which here would read `CRM%201.0.0%E2%86%921.0.1`.
    expect(shown()).toBe('2 update(s): CRM 1.0.0→1.0.1');
  });

  it('rung 3 — neither rung applies: the runner default, in its translator\'s language', async () => {
    runner.setTranslator(() => '操作已成功完成');
    await runner.execute({ type: 'script', name: 'delete_environment' });
    expect(shown()).toBe('操作已成功完成');
  });

  it('an answer carrying `message` overrides neither rung of author copy', async () => {
    await runner.execute(DELETE_ENVIRONMENT);
    expect(shown()).not.toBe(ARCHIVED.message);

    toast.mockClear();
    await runner.execute({ type: 'script', name: 'delete_environment', successMessage: 'Done' });
    expect(shown()).toBe('Done');
  });

  it('an answer carrying `message` is not the toast even with no author copy at all', async () => {
    // `result.data.message` used to be the FIRST rung. It is not a rung now:
    // with nothing authored, the default text is shown, not the server's.
    await runner.execute({ type: 'script', name: 'delete_environment' });
    expect(shown()).toBe('Action completed successfully');
  });

  it("an author can still show the server's sentence by writing ${result.message} as the copy", async () => {
    await runner.execute({ type: 'script', name: 'publish', successMessage: '${result.message}' });
    expect(shown()).toBe(ARCHIVED.message);
  });

  it('the copy reads the `result` scope only — a `${ctx.*}` or `${param.*}` token stays as written', async () => {
    // `result` is the one scope the contract declares for this copy. The
    // grammar is shared with url / api targets, whose `ctx` and `param` scopes
    // stay theirs: a token naming them here is left visible, not blanked.
    await runner.execute({
      type: 'script',
      name: 'delete_environment',
      successMessage: '${result.name} by ${ctx.user.name} with ${param.reason}',
    });
    expect(shown()).toBe('prod by ${ctx.user.name} with ${param.reason}');
  });

  it('an outcome naming an inherited property selects nothing and falls back', async () => {
    for (const outcome of ['constructor', '__proto__', 'toString']) {
      toast.mockClear();
      answer = { success: true, data: { outcome, name: 'prod' } };
      await runner.execute(DELETE_ENVIRONMENT);
      expect(shown()).toBe('Environment prod updated');
    }
  });

  it('an I18nLabel map that skipped the localizer is never handed to the toast as an object', async () => {
    // The runner has no language to resolve a map against; the host's
    // localizer collapses it before dispatch. One that arrives raw is skipped,
    // so the toast never receives an object (the React #31 class).
    await runner.execute({
      ...DELETE_ENVIRONMENT,
      outcomeMessages: { archived: { en: 'Archived', 'zh-CN': '已归档' } },
    });
    expect(shown()).toBe('Environment prod updated');
  });

  it('a resultDialog still suppresses the toast — outcome copy included', async () => {
    runner.setResultDialogHandler(async () => {});
    await runner.execute({
      ...DELETE_ENVIRONMENT,
      resultDialog: { fields: [{ path: 'name' }] },
    });
    expect(toast).not.toHaveBeenCalled();
  });
});
