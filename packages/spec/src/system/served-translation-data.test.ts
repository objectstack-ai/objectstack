// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25785 — the served translation document is the platform face without the
 * groups the server resolves itself.
 *
 * `GET /i18n/translations/:locale` answers `GetTranslationsResponseSchema`,
 * whose `translations` is {@link ServedTranslationDataSchema}. The runtime door
 * leaves out {@link SERVER_RESOLVED_TRANSLATION_GROUPS} (`metadataForms`, which
 * `/meta/types` resolves into Studio's forms on the server), and these pins keep
 * the constant, the served face and the response schema one declaration:
 *
 * - the served face is exactly the platform face minus the constant, both ways;
 * - a server-resolved group stays authorable on both bundle faces (only the
 *   served document leaves it out);
 * - the served face is closed: a body still carrying the group is refused by
 *   name, which is what lets a response conformance suite catch a door that
 *   stops leaving it out.
 */

import { describe, it, expect } from 'vitest';
import { GetTranslationsResponseSchema } from '../api/protocol.zod';
import {
  PlatformTranslationDataSchema,
  SERVER_RESOLVED_TRANSLATION_GROUPS,
  ServedTranslationDataSchema,
  TranslationDataSchema,
} from './translation.zod';

const keysOf = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape).sort();

describe('#25785 — the served translation face', () => {
  it('is the platform face without SERVER_RESOLVED_TRANSLATION_GROUPS, in both directions', () => {
    const platform = keysOf(PlatformTranslationDataSchema);
    const expected = platform.filter((k) => !(SERVER_RESOLVED_TRANSLATION_GROUPS as readonly string[]).includes(k));
    // Positive control: the walk read real shapes, and the constant names a platform group.
    expect(platform).toEqual(expect.arrayContaining(['objects', 'settings', 'metadataForms']));
    expect(expected.length).toBe(platform.length - SERVER_RESOLVED_TRANSLATION_GROUPS.length);
    expect(keysOf(ServedTranslationDataSchema)).toEqual(expected);
  });

  it('is what GetTranslationsResponseSchema serves under `translations`', () => {
    expect(keysOf(GetTranslationsResponseSchema.shape.translations)).toEqual(keysOf(ServedTranslationDataSchema));
  });

  it.each(SERVER_RESOLVED_TRANSLATION_GROUPS)('%s stays authorable on both bundle faces', (group) => {
    expect(Object.keys(TranslationDataSchema.shape)).toContain(group);
    expect(Object.keys(PlatformTranslationDataSchema.shape)).toContain(group);
  });

  it('accepts a document carrying the served groups', () => {
    const served = {
      objects: { lead: { label: '潜在客户', fields: { company: { label: '公司' } } } },
      settings: { mail: { title: '邮件投递' } },
      messages: { save: '保存' },
    };
    expect(ServedTranslationDataSchema.safeParse(served).success).toBe(true);
    expect(GetTranslationsResponseSchema.safeParse({ locale: 'zh-CN', translations: served }).success).toBe(true);
  });

  it.each(SERVER_RESOLVED_TRANSLATION_GROUPS)('refuses a document still carrying %s, by name', (group) => {
    const result = ServedTranslationDataSchema.safeParse({ messages: { save: '保存' }, [group]: {} });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect((issue as { keys?: string[] }).keys).toEqual([group]);

    const response = GetTranslationsResponseSchema.safeParse({ locale: 'zh-CN', translations: { [group]: {} } });
    expect(response.success).toBe(false);
  });
});
