// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ActionSchema.outcomeMessages` (#21095) — ruling A on objectstack-ai/cloud#2315:
 * a server-executing action that can succeed in more than one way declares
 * one message per closed `outcome` fact its handler reports, and the console
 * picks the entry the success payload names.
 *
 * ## What this repo can pin, and what it cannot
 *
 * The SELECTION (`outcomeMessages[result.outcome]` → `successMessage` → the
 * runner default) and the `${result.*}` INTERPOLATION are the console's — the
 * reader is objectstack-ai/objectui#11344, a later link of the same ruling,
 * carried from the pin this repo builds against (`.objectui-sha` =
 * `a58626c88`, re-read there 2026-10-06:
 * every objectui file this record cites is byte-identical across the hop from
 * `0abd4f9f8` (`git diff --quiet`), so every anchor held unmoved.
 * At `0abd4f9f8`, re-read there 2026-10-05:
 * every objectui file this record cites is byte-identical across the hop from
 * `9dfaca654` (`git diff --quiet`), so every anchor held unmoved.
 * At `9dfaca654`; `ActionRunner.composeSuccessMessage`, in
 * `core/src/actions/ActionRunner.ts`, byte-identical to `2e818d0b5`, re-read
 * 2026-10-05, and to `ab1879721` before it), where the ledger row
 * turned `live`. Its behaviour is pinned on objectui's side, so the "a handler returning
 * `{ outcome: 'archived', … }` resolves to the archived copy, interpolated"
 * acceptance splits in two. HERE: the key is accepted on exactly the two types
 * that have a success payload, refused loudly everywhere it would be inert or
 * malformed, carried through parse untouched (so the console reads what was
 * authored, `${result.*}` tokens included), and translated KEY BY KEY at the
 * REST localization seam (`translateAction`) — the archived copy resolves in
 * the user's locale, its token intact. THERE (objectui#11344): choosing the
 * entry and substituting the token.
 *
 * Refusals are pinned on the issue `code` and `path` — the located verdict —
 * never on prose.
 */
import { describe, it, expect } from 'vitest';
import { ActionSchema, InlineActionSchema } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { translateAction, translateMetadataDocument } from '../system/i18n-resolver';
import { TranslationDataSchema, type TranslationBundle } from '../system/translation.zod';

/**
 * The fixture is the shape the ruling's first producer will write: cloud's
 * environment delete, whose four outcomes are the closed vocabulary the
 * client's `environments.delete` answer declares (`packages/client`).
 */
const DELETE_ENVIRONMENT = {
  name: 'delete_environment',
  label: 'Delete environment',
  objectName: 'sys_environment',
  type: 'script' as const,
  target: 'deleteEnvironment',
  successMessage: 'Environment updated.',
  outcomeMessages: {
    archived: 'Environment ${result.environmentId} archived — recoverable for ${result.retentionDays} days.',
    already_archived: 'Environment ${result.environmentId} was already archived.',
    purge_deferred: { en: 'Archived instead of purged — delete again to purge.', 'zh-CN': '已改为归档 —— 再次删除即可清除。' },
    destroyed: 'Environment ${result.environmentId} destroyed.',
  },
};

/** The located issues of a failed parse: `code` + `path`, the verdict without the prose. */
function located(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } }) {
  expect(result.success).toBe(false);
  return result.error!.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.') }));
}

describe('ActionSchema.outcomeMessages — accepted on the two types with a success payload', () => {
  it('accepts the map on a type:script action and carries it through parse untouched', () => {
    const r = ActionSchema.safeParse(DELETE_ENVIRONMENT);
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    // Byte-for-byte: the spec interpolates nothing — the `${result.*}` tokens
    // are the renderer's, and an inline locale map stays a map.
    expect((r.data as { outcomeMessages: unknown }).outcomeMessages).toEqual(DELETE_ENVIRONMENT.outcomeMessages);
  });

  it('accepts the map on a type:api action', () => {
    const r = ActionSchema.safeParse({
      name: 'check_app_updates',
      label: 'Check for updates',
      type: 'api',
      target: '/api/v1/cloud/packages/updates',
      outcomeMessages: {
        updates_available: '${result.count} app updates available.',
        up_to_date: 'All apps are up to date.',
        none_installed: 'No apps are installed yet.',
      },
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('accepts it on an action that leaves `type` at its default (script)', () => {
    const r = ActionSchema.safeParse({
      name: 'recompute',
      label: 'Recompute',
      body: { language: 'js', source: 'return { outcome: "unchanged" };' },
      outcomeMessages: { unchanged: 'Nothing to recompute.' },
    });
    expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it('reaches the same verdict through the registered `action` metadata schema (the parsing door)', () => {
    const schema = getMetadataTypeSchema('action');
    expect(schema).toBeDefined();
    expect(schema!.safeParse(DELETE_ENVIRONMENT).success).toBe(true);
    expect(located(schema!.safeParse({ ...DELETE_ENVIRONMENT, type: 'url', target: '/x', body: undefined })))
      .toContainEqual({ code: 'custom', path: 'outcomeMessages' });
  });
});

describe('ActionSchema.outcomeMessages — an unknown shape is refused at its own path', () => {
  const withMap = (outcomeMessages: unknown) => ActionSchema.safeParse({ ...DELETE_ENVIRONMENT, outcomeMessages });

  it('refuses an array (a list of messages is not a map from outcome to message)', () => {
    expect(located(withMap(['Archived.', 'Destroyed.']))).toEqual([{ code: 'invalid_type', path: 'outcomeMessages' }]);
  });

  it('refuses a bare string (one message is `successMessage`)', () => {
    expect(located(withMap('Archived.'))).toEqual([{ code: 'invalid_type', path: 'outcomeMessages' }]);
  });

  it('refuses an outcome key that is not snake_case — it could never equal a handler outcome', () => {
    for (const key of ['Archived', 'already-archived', 'alreadyArchived', 'a', '1st_try']) {
      expect(located(withMap({ [key]: 'x' })), key).toEqual([{ code: 'invalid_key', path: `outcomeMessages.${key}` }]);
    }
  });

  it('refuses a message that is not an I18nLabel', () => {
    const issues = located(withMap({ archived: 42 }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('outcomeMessages.archived');
  });
});

describe('ActionSchema.outcomeMessages — refused where it would parse clean and never be read', () => {
  it.each([
    ['url', { target: '/apps/x' }],
    ['modal', { target: 'some_page' }],
    ['flow', { target: 'some_flow' }],
    ['form', { target: 'some_form' }],
  ])('refuses it on a type:%s action (no success payload to carry an outcome)', (type, extra) => {
    const r = ActionSchema.safeParse({
      name: 'not_a_server_action',
      label: 'Not a server action',
      type,
      ...extra,
      outcomeMessages: { done: 'Done.' },
    });
    expect(located(r)).toEqual([{ code: 'custom', path: 'outcomeMessages' }]);
  });

  it('refuses it beside `resultDialog`, which suppresses the success toast', () => {
    const r = ActionSchema.safeParse({
      name: 'rotate_secret',
      label: 'Rotate secret',
      type: 'api',
      target: '/api/v1/rotate',
      resultDialog: { title: 'New secret', fields: [{ path: 'secret', format: 'secret' }] },
      outcomeMessages: { rotated: 'Secret rotated.' },
    });
    expect(located(r)).toEqual([{ code: 'custom', path: 'outcomeMessages' }]);
  });

  it("refuses it beside `operation: 'update'` — one issue, from the declarative-update table", () => {
    const r = ActionSchema.safeParse({
      name: 'mark_done',
      label: 'Mark done',
      operation: 'update',
      patch: { status: 'done' },
      outcomeMessages: { done: 'Marked done.' },
    });
    expect(located(r)).toEqual([{ code: 'custom', path: 'outcomeMessages' }]);
  });

  it('is not picked into the inline action shape — no inline host reads it', () => {
    const r = InlineActionSchema.safeParse({
      type: 'api',
      target: '/api/v1/x',
      outcomeMessages: { done: 'Done.' },
    });
    expect(located(r)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });
});

describe('the translation face — outcome copy rides beside `successMessage`', () => {
  const bundle: TranslationBundle = {
    'zh-CN': TranslationDataSchema.parse({
      objects: {
        sys_environment: {
          _actions: {
            delete_environment: {
              successMessage: '环境已更新。',
              outcomeMessages: {
                archived: '环境 ${result.environmentId} 已归档，可在 ${result.retentionDays} 天内恢复。',
                // A bundle cannot add an outcome the action does not declare.
                restored: '环境已恢复。',
              },
            },
          },
        },
      },
      globalActions: {
        delete_environment: {
          outcomeMessages: { destroyed: '环境 ${result.environmentId} 已销毁。' },
        },
      },
    }),
  };

  it('resolves the archived copy in the user locale, its ${result.*} tokens intact for the renderer', () => {
    const out = translateAction(DELETE_ENVIRONMENT as never, bundle, { locale: 'zh-CN' }) as typeof DELETE_ENVIRONMENT;
    expect(out.outcomeMessages.archived).toBe('环境 ${result.environmentId} 已归档，可在 ${result.retentionDays} 天内恢复。');
  });

  it('reads a bound action\'s outcomes under its own object only, then falls back to the authored copy', () => {
    const out = translateAction(DELETE_ENVIRONMENT as never, bundle, { locale: 'zh-CN' }) as typeof DELETE_ENVIRONMENT;
    // The action is bound to `sys_environment`, so its `globalActions` copy is
    // never read — that group is for object-less actions.
    expect(out.outcomeMessages.destroyed).toBe(DELETE_ENVIRONMENT.outcomeMessages.destroyed);
    expect(out.outcomeMessages.already_archived).toBe(DELETE_ENVIRONMENT.outcomeMessages.already_archived);
    expect(out.outcomeMessages.purge_deferred).toEqual(DELETE_ENVIRONMENT.outcomeMessages.purge_deferred);
  });

  it('never adds an outcome the action does not declare, and never mutates the source', () => {
    const before = JSON.stringify(DELETE_ENVIRONMENT);
    const out = translateAction(DELETE_ENVIRONMENT as never, bundle, { locale: 'zh-CN' }) as typeof DELETE_ENVIRONMENT;
    expect(Object.keys(out.outcomeMessages).sort()).toEqual(Object.keys(DELETE_ENVIRONMENT.outcomeMessages).sort());
    expect(JSON.stringify(DELETE_ENVIRONMENT)).toBe(before);
  });

  it('reaches the REST localization seam (`translateMetadataDocument`) unchanged', () => {
    const out = translateMetadataDocument('action', DELETE_ENVIRONMENT, bundle, { locale: 'zh-CN' });
    expect(out.outcomeMessages.archived).toContain('已归档');
    expect(out.successMessage).toBe('环境已更新。');
  });

  it('refuses a bundle outcome key that is not snake_case, located', () => {
    const r = TranslationDataSchema.safeParse({
      globalActions: { delete_environment: { outcomeMessages: { 'Already-Archived': 'x' } } },
    });
    expect(located(r)).toEqual([{ code: 'invalid_key', path: 'globalActions.delete_environment.outcomeMessages.Already-Archived' }]);
  });
});
