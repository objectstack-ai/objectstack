// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// zh-CN names a dashboard 仪表盘 everywhere (#30039 item 4): the Console and
// Studio already say it, so the metadata forms the platform serves must too.
// This reads the SERVED bundle (`MetadataFormsTranslations`, the one
// `/api/v1/meta/types` localizes forms with, after `withSourceFallback`), not
// the generated file alone, so a stale-source fallback cannot hide the word.

import { describe, it, expect } from 'vitest';
import { MetadataFormsTranslations } from './index.js';

/** Every string leaf under `node`, with its dotted path. */
function leaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, path ? `${path}.${k}` : k),
  );
}

describe('#30164 — served zh-CN metadata forms say 仪表盘 for dashboard', () => {
  const served = MetadataFormsTranslations['zh-CN']?.metadataForms as Record<string, any>;

  it('the dashboard form title reads 仪表盘', () => {
    expect(served?.dashboard?.label).toBe('仪表盘');
  });

  it('no served zh-CN metadata-form string carries the retired spelling 仪表板', () => {
    const offenders = leaves(served).filter(([, text]) => text.includes('仪表板'));
    expect(offenders).toEqual([]);
  });
});
