// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysImportJob } from './sys-import-job.object.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

/**
 * #28113 — the import job's `error` column is headed "Failure Reason".
 *
 * Since the every-row-failed ruling (#27676), `error` holds either the fatal
 * error that aborted the job or, when every row failed, one sentence pointing
 * at the job's `results` (`ImportJobProgressSchema.error` describes both).
 * Headed "Fatal Error", the second outcome sent an administrator looking for a
 * crash. The label now covers both; the field stays the same optional textarea
 * in the Outcome group.
 */
describe('sys_import_job.error label (#28113)', () => {
  const field = (SysImportJob.fields as Record<string, Record<string, unknown>>).error;

  it('is labelled "Failure Reason" and stays an optional textarea in Outcome', () => {
    expect(field.label).toBe('Failure Reason');
    expect(field.type).toBe('textarea');
    expect(field.required ?? false).toBe(false);
    expect(field.group).toBe('Outcome');
  });

  const words = {
    en: [enObjects, 'Failure Reason'],
    'zh-CN': [zhCNObjects, '失败原因'],
    'ja-JP': [jaJPObjects, '失敗理由'],
    'es-ES': [esESObjects, 'Motivo del fallo'],
  } as const;

  for (const [locale, [bundle, word]] of Object.entries(words)) {
    it(`reads ${word} in ${locale}`, () => {
      const leaf = (bundle as Record<string, { fields?: Record<string, { label?: string }> }>).sys_import_job?.fields?.error;
      expect(leaf?.label).toBe(word);
    });
  }
});
