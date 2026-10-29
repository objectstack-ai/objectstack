// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `sys_api_key`'s Revoke and Restore toasts name the key they acted on: a
// record-level success message names the record (the write-feedback
// convention).
//
// Both are `list_item` row actions. The console's runner fills a
// `successMessage` `{{ record.* }}` hole from the row the dispatch carries
// (ActionRunner `composeSuccessMessage`, pinned in objectui's
// `ActionRunner.copyTemplate-13367.test.ts`, "the row a dispatch carries is
// `record`"), so `{{ record.name }}` prints the key's name. A copy without the
// hole names no key.
//
// The translated bundles are pinned as well: merge mode keeps every existing
// translated value, so a revised source sentence would go on serving the old,
// key-less translation, and both states are "in sync" to `check:i18n`.
import { describe, expect, it } from 'vitest';
import { translateMetadataDocument } from '@objectstack/spec/system';
import { templateSlotSource } from '@objectstack/spec/automation';
import { SetupAppTranslations } from '../apps/translations/setup.translation.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { SysApiKey } from './sys-api-key.object.js';

interface CopyAction {
  name?: string;
  successMessage?: unknown;
}

/** The hole the console runner fills from the dispatched row. */
const KEY_NAME = '{{ record.name }}';

const ACTIONS = ['revoke_api_key', 'restore_api_key'] as const;

const TRANSLATED = [
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

// `successMessage` is a `template` slot: the parsed object carries the
// `{ dialect: 'template', source }` envelope, read through `templateSlotSource`.
function action(object: unknown, name: string): CopyAction {
  const found = ((object as { actions?: CopyAction[] }).actions ?? []).find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return { ...found, successMessage: templateSlotSource(found?.successMessage) };
}

const bundleNode = (bundle: unknown, name: string): CopyAction | undefined =>
  (bundle as Record<string, { _actions?: Record<string, CopyAction> }>)?.sys_api_key?._actions?.[name];

describe('sys_api_key Revoke / Restore — declared copy', () => {
  it.each(ACTIONS)('%s names the key in its success message', (name) => {
    expect(action(SysApiKey, name).successMessage).toContain(KEY_NAME);
  });

  it('the two toasts are different sentences', () => {
    const [revoke, restore] = ACTIONS.map((name) => action(SysApiKey, name).successMessage);
    expect(revoke).not.toBe(restore);
  });
});

describe('sys_api_key Revoke / Restore — translated bundles follow the source', () => {
  it.each(ACTIONS)('en carries the source copy for %s', (name) => {
    expect(bundleNode(enObjects, name)?.successMessage).toBe(action(SysApiKey, name).successMessage);
  });

  for (const [locale, bundle] of TRANSLATED) {
    it.each(ACTIONS)(`${locale} keeps the key-name token in the success message for %s`, (name) => {
      // The old translation survives every re-extract in merge mode; only the
      // token proves the leaf was revised with the source.
      const translated = bundleNode(bundle, name)?.successMessage;
      expect(translated, `${locale} sys_api_key.${name}.successMessage missing`).toBeTruthy();
      expect(translated).toContain(KEY_NAME);
      expect(translated).not.toBe(action(SysApiKey, name).successMessage);
    });
  }
});

describe('sys_api_key Revoke / Restore — the served object metadata', () => {
  // The object-metadata read the console uses localizes through
  // `translateMetadataDocument('object', …)` over this package's bundle.
  const served = (locale: string, name: string): CopyAction =>
    action(translateMetadataDocument('object', SysApiKey, SetupAppTranslations, { locale }), name);

  it.each(ACTIONS)('zh-CN serves the translated, key-naming copy for %s', (name) => {
    const zh = served('zh-CN', name);
    expect(zh.successMessage).toBe(bundleNode(zhCNObjects, name)?.successMessage);
    expect(zh.successMessage).toContain(KEY_NAME);
  });

  it.each(ACTIONS)('en serves the declared copy for %s', (name) => {
    expect(served('en', name).successMessage).toBe(action(SysApiKey, name).successMessage);
  });
});
