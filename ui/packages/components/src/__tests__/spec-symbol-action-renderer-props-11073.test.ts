/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11073 — why `action:button` / `action:icon` name their React props
 * `…RendererProps`.
 *
 * `@objectstack/spec` 17.5.0 began exporting `ActionButtonProps` and
 * `ActionIconProps` from `@objectstack/spec/ui`: the blocks' AUTHORED property
 * bags. The renderers here had declared their React props envelope under those
 * same names, which `pnpm check:spec-symbols` refuses (a local declaration under
 * a spec export's name reads as the spec's own definition). The envelope is a
 * different layer — it carries the node as `schema`, the host's `context` and
 * its evaluated `disabled`, with an open tail — so it was renamed rather than
 * derived, as objectui#7265 renamed `RecordAlertRendererProps`. Neither type is
 * on `@object-ui/components`' published entry, so no public name moved.
 *
 * These rows pin the REASON, read off the spec's live schemas: the day the
 * spec's bag becomes the envelope, they go red and the rename's premise has
 * expired. That the spec does not own the NEW names is held by
 * `pnpm check:spec-symbols`, which judges every declaration against every spec
 * export name on each run.
 */
import { describe, expect, it } from 'vitest';
import { ActionButtonPropsSchema, ActionIconPropsSchema } from '@objectstack/spec/ui';

const keysOf = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape);

describe('objectui#11073 — the spec owns the AUTHORED action props bags, not the renderer envelope', () => {
  it.each([
    ['ActionButtonProps', ActionButtonPropsSchema],
    ['ActionIconProps', ActionIconPropsSchema],
  ] as const)('the spec`s `%s` is the authored bag: it declares `actionType`, and no envelope member', (_name, schema) => {
    const keys = keysOf(schema);
    expect(keys).toContain('actionType');
    expect(keys).toContain('label');
    for (const envelope of ['schema', 'context', 'className']) expect(keys).not.toContain(envelope);
  });
});
