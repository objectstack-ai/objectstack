// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#7367 — the extractor half of `action.description`.
//
// Splitting the extractor out of the schema change would open a
// declared-but-not-extracted window: the key parses, objectui renders it, and
// `os i18n extract` scaffolds no translation slot for it — so a zh-CN
// workspace silently shows the English dialog line with no diagnostic, which is
// exactly the leak objectstack#3370 closed for action labels.
//
// The last test walks ONE fixture action through all three surfaces —
// `ActionSchema` accepts it, the extractor emits its key, the translation
// schema accepts the bundle written at that key — because each half passing on
// its own does not prove the addresses agree.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
// Subpath entrypoints — the root barrel re-exports only a curated set, and
// neither of these two is in it.
import { ActionSchema } from '@objectstack/spec/ui';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

const paths = (config: any) => collectExpectedEntries(config).map((e) => e.path.join('.'));

describe('the extractor emits action-level `description` (#7367)', () => {
  it('emits it for a TOP-LEVEL object action that declares one', () => {
    const keys = paths({
      actions: [
        {
          name: 'approval_reject',
          objectName: 'sys_approval_request',
          label: 'Reject',
          description: 'Reject this request? Say why — the requester sees it.',
          params: [{ name: 'reason', label: 'Reason' }],
        },
      ],
    });

    expect(keys).toContain('objects.sys_approval_request._actions.approval_reject.description');
  });

  it('emits it for a GLOBAL action that declares one', () => {
    const keys = paths({
      actions: [{ name: 'rotate_client_secret', label: 'Rotate', description: 'Rotate the secret?' }],
    });

    expect(keys).toContain('globalActions.rotate_client_secret.description');
  });

  it('emits it for an action declared INLINE on the object — the objectstack#3370 walker', () => {
    const keys = paths({
      objects: [
        {
          name: 'sys_approval_request',
          label: 'Approval Request',
          actions: [{ name: 'approval_reject', label: 'Reject', description: 'Reject this request?' }],
        },
      ],
    });

    expect(keys).toContain('objects.sys_approval_request._actions.approval_reject.description');
  });

  it('seeds NOTHING for an action that declares none — exactly as `confirmText` does not', () => {
    // Measured, not presumed: `pushOptional` on an absent value still records a
    // SEED-LESS entry (path, no `inline`/`sourceValue`). That is deliberate —
    // it is how the coverage gate spots a bundle authoring a key the metadata
    // never writes — and it is the same thing `confirmText` and
    // `successMessage` have always done. So the contract to pin is not "the
    // path is absent" but "nothing is seeded and nothing is gated": the dialog
    // falls back to its own generic `actionDialog.description`, so an
    // undeclared description is not a translation gap. `pushDerived` (what
    // `label` uses) WOULD invent an English source string here and then gate
    // every locale on translating it.
    const config = {
      objects: [
        {
          name: 'sys_approval_request',
          label: 'Approval Request',
          actions: [{ name: 'approval_approve', label: 'Approve' }],
        },
      ],
    };
    const entries = collectExpectedEntries(config);
    const at = (key: string) => entries.find((e) => e.path.join('.') === key);
    const root = 'objects.sys_approval_request._actions.approval_approve';

    // Present as a path, carrying no source text — byte-for-byte the shape of
    // the undeclared `confirmText` beside it.
    expect(at(`${root}.description`)).toBeDefined();
    expect(at(`${root}.description`)?.inline).toBeUndefined();
    expect(at(`${root}.description`)?.sourceValue).toBeUndefined();
    expect(at(`${root}.description`)?.sourceValue).toBe(at(`${root}.confirmText`)?.sourceValue);

    // `label` is the contrast: derived, so it DOES carry a seed.
    expect(at(`${root}.label`)?.sourceValue).toBe('Approve');

    // Nothing seeded into a bundle, nothing gated as a gap.
    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects.sys_approval_request._actions.approval_approve)
      .not.toHaveProperty('description');
    expect(computeI18nCoverage({ ...config, translations: [{ 'zh-CN': {} }] }).issues.map((i) => i.key))
      .not.toContain(`${root}.description`);
  });

  it('carries the declared text into the emitted bundle, attributed to the action source', () => {
    const config = {
      objects: [
        {
          name: 'sys_approval_request',
          label: 'Approval Request',
          actions: [{ name: 'approval_reject', label: 'Reject', description: 'Reject this request?' }],
        },
      ],
    };
    const entry = collectExpectedEntries(config).find(
      (e) => e.path.join('.') === 'objects.sys_approval_request._actions.approval_reject.description',
    );

    expect(entry?.source).toBe('action');
    expect(entry?.inline).toBe('Reject this request?');

    const { bundles } = extractTranslations(config, { defaultLocale: 'en', fill: 'default' });
    expect(bundles.en.objects.sys_approval_request._actions.approval_reject.description)
      .toBe('Reject this request?');
  });

  it('gates an untranslated description, and goes quiet once it is translated', () => {
    // The extractable surface and the `os lint` gated surface share one walker;
    // this is that contract applied to the new key.
    const config: any = {
      objects: [
        {
          name: 'sys_approval_request',
          label: 'Approval Request',
          actions: [{ name: 'approval_reject', label: 'Reject', description: 'Reject this request?' }],
        },
      ],
      translations: [
        { 'zh-CN': { objects: { sys_approval_request: { label: '审批请求', _actions: { approval_reject: { label: '拒绝' } } } } } },
      ],
    };

    const gaps = computeI18nCoverage(config).issues.map((i) => i.key);
    expect(gaps).toContain('objects.sys_approval_request._actions.approval_reject.description');

    config.translations[0]['zh-CN'].objects.sys_approval_request._actions.approval_reject.description =
      '拒绝该请求？';
    const after = computeI18nCoverage(config).issues.filter((i) => i.source !== 'metadataForm');
    expect(after).toEqual([]);
  });
});

describe('one fixture action, all three surfaces (#7367 end-to-end)', () => {
  const authored = {
    name: 'approval_reject',
    objectName: 'sys_approval_request',
    label: 'Reject',
    // `type` defaults to `script`, which requires a dispatch target.
    target: 'rejectApproval',
    // The #7278 shape: the confirm question lives here, so the param dialog is
    // the ONE dialog — no `confirmText` stacked in front of it.
    description: 'Reject this request? The requester sees your reason.',
    params: [{ name: 'reason', label: 'Reason', type: 'textarea' as const, required: true }],
  };

  it('parses as metadata, extracts to a key, and that key round-trips a bundle', () => {
    // 1. The producer accepts it.
    const parsed = ActionSchema.safeParse(authored);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.description)
      .toBe('Reject this request? The requester sees your reason.');
    expect(parsed.success && parsed.data.confirmText).toBeUndefined();

    // 2. The extractor emits the address objectui's resolver reads
    //    (`objects.{o}._actions.{a}.description`).
    const key = 'objects.sys_approval_request._actions.approval_reject.description';
    const { bundles } = extractTranslations({ actions: [authored] }, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'empty',
    });
    const bundle: any = bundles['zh-CN'];
    expect(bundle.objects.sys_approval_request._actions.approval_reject)
      .toHaveProperty('description');

    // 3. A translator fills that exact address and the translation schema takes it.
    bundle.objects.sys_approval_request._actions.approval_reject.description = '拒绝该请求？申请人会看到你的理由。';
    const translated = ObjectTranslationDataSchema.safeParse(
      bundle.objects.sys_approval_request,
    );
    expect(translated.success).toBe(true);
    expect(translated.success && translated.data._actions?.approval_reject?.description)
      .toBe('拒绝该请求？申请人会看到你的理由。');

    // The three surfaces agree on ONE address.
    expect(paths({ actions: [authored] })).toContain(key);
  });
});
