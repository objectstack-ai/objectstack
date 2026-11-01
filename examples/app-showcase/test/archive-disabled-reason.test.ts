// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The greyed Archive button on a task says why it is unavailable
 * (objectstack#27520 row 9).
 *
 * `showcase_archive_task` is the `disabled`-predicate specimen: it stays on
 * screen and is greyed until the task is done. The console draws the action's
 * `disabledReason` (`ActionSchema.disabledReason`, #26619) as the button's
 * hover title and accessible description, and falls back to "Not available for
 * this record" only when the action declares none, which told the user neither
 * why nor what to do. So the specimen declares the sentence, in English on the
 * action and in zh-CN at `objects.showcase_task._actions.<name>.disabledReason`,
 * the copy keys' translation route.
 */

import { describe, expect, it } from 'vitest';
import { ActionSchema } from '@objectstack/spec/ui';
import { ArchiveTaskAction } from '../src/ui/actions/index.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

const GENERIC = 'Not available for this record';

describe('showcase_archive_task says why it is greyed (objectstack#27520 row 9)', () => {
  it('declares a disabledReason beside its disabled predicate, and the spec keeps it', () => {
    const parsed = ActionSchema.parse(ArchiveTaskAction);
    // Control: the action is still the `disabled` specimen.
    expect(parsed.disabled).toBeTruthy();
    expect(typeof parsed.disabledReason).toBe('string');
    const reason = String(parsed.disabledReason);
    expect(reason.trim()).not.toBe('');
    expect(reason).not.toBe(GENERIC);
  });

  it('carries the zh-CN reason on the copy keys\' translation route', () => {
    const zhActions = (ShowcaseTranslationBundle['zh-CN'] as {
      objects: Record<string, { _actions?: Record<string, { disabledReason?: unknown }> }>;
    }).objects.showcase_task._actions ?? {};
    const zh = zhActions.showcase_archive_task?.disabledReason;
    expect(typeof zh).toBe('string');
    expect(String(zh).trim()).not.toBe('');
    expect(zh).not.toBe(ArchiveTaskAction.disabledReason);
  });
});
