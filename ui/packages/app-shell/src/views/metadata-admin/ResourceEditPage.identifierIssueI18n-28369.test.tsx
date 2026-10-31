// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28369 — the create form's summary banner states Name's identifier
 * errors in the reader's locale, and wraps them instead of cutting them.
 *
 * A zh-CN administrator who types an all-Chinese label into a new permission
 * set leaves Name empty, and `SnakeCaseIdentifierSchema` refuses it twice
 * (`.min(2)` and `.regex`). Those messages are the spec's, in English, and stay
 * so; the Console picks the reader's-locale text by the issue's code and
 * pattern, never by reading the English:
 *
 *   (a) zh-CN: both banner lines are Chinese, and neither carries the spec's
 *       English sentence;
 *   (b) CONTROL en-US: the banner shows the spec's own sentences, read from
 *       the installed schema (no copy of them lives in this repo);
 *   (c) the banner lines wrap: no line is cut with an ellipsis;
 *   (d) both identifier grammars of `shared/identifiers.zod.ts`, parsed live,
 *       answer zh rows in zh and the spec's message in en.
 *
 * The REAL page with the live registration (`registerBuiltinAnchors`) and the
 * real served permission form from `METADATA_FORM_REGISTRY`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { getMetadataCreateSeed, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { SnakeCaseIdentifierSchema, SystemIdentifierSchema } from '@objectstack/spec/shared';
// The zh rows live in `@object-ui/i18n`'s `studio` namespace, whose `zh`
// catalogue is fetched on demand; resident before any case.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { translateSchemaIssue, tOptional } from './i18n';
import { validateMetadataDraft } from './clientValidation';

await loadStudioCatalogue('zh');

let localeFixture: 'en-US' | 'zh-CN' = 'zh-CN';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

/** The spec's own messages for an empty identifier, from the installed schema. */
function specIssues(schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }) {
  return (schema.safeParse('').error?.issues ?? []) as Array<{
    code: string;
    message: string;
    origin?: string;
    minimum?: number;
    inclusive?: boolean;
    format?: string;
    pattern?: string;
  }>;
}
const SNAKE = specIssues(SnakeCaseIdentifierSchema);
const SNAKE_EN = SNAKE.map((i) => i.message);

const ZH_TOO_SHORT = (tOptional('engine.validation.spec.stringTooShort', 'zh-CN') ?? '').replace('{minimum}', '2');
const ZH_SNAKE = tOptional('engine.validation.spec.snakeCaseIdentifier', 'zh-CN') ?? '';
const ZH_SYSTEM = tOptional('engine.validation.spec.systemIdentifier', 'zh-CN') ?? '';

const PERMISSION_JSON_SCHEMA = z.toJSONSchema(getMetadataTypeSchema('permission') as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

const CLIENT = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => null),
  save: vi.fn(async (_type: string, _name: string, payload: Record<string, unknown>) => payload),
  history: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      {
        type: 'permission',
        label: 'Permission Set',
        domain: 'security',
        allowEnvironmentOverlay: true,
        allowRuntimeCreate: true,
        schema: PERMISSION_JSON_SCHEMA,
        form: METADATA_FORM_REGISTRY.permission,
        createSeed: getMetadataCreateSeed('permission') as Record<string, unknown>,
      },
    ],
  }),
}));

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinAnchors } from './anchors';

registerDefaultMetadataSchemas();
registerBuiltinAnchors();

beforeEach(() => {
  localeFixture = 'zh-CN';
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
});

/** Opens a new permission set and types an all-Chinese label; Name stays empty. */
async function bannerLinesForChineseLabel(): Promise<HTMLElement[]> {
  render(
    <MemoryRouter initialEntries={['/metadata/permission/new']}>
      <MetadataResourceEditPage type="permission" name="" createMode />
    </MemoryRouter>,
  );
  const labelBox = (await screen.findByRole('textbox', { name: /^(Label|标签)/ }, { timeout: 8000 })) as HTMLInputElement;
  fireEvent.change(labelBox, { target: { value: '销售运营' } });
  const banner = await screen.findByTestId('metadata-validation-banner', {}, { timeout: 8000 });
  await waitFor(() => expect(banner.querySelectorAll('[data-testid="metadata-diagnostics-item"]').length).toBeGreaterThanOrEqual(2));
  return Array.from(banner.querySelectorAll<HTMLElement>('[data-testid="metadata-diagnostics-item"]'));
}

describe('the create banner states identifier issues in the reader’s locale (objectstack#28369)', () => {
  it('the fixtures are real: the spec refuses an empty identifier twice, and the zh rows exist', () => {
    expect(SNAKE.map((i) => i.code)).toEqual(['too_small', 'invalid_format']);
    expect(ZH_TOO_SHORT).toBe('至少需要 2 个字符');
    expect(ZH_SNAKE).toMatch(/snake_case/);
    expect(ZH_SYSTEM).not.toBe('');
  });

  it('(a) zh-CN: both Name lines are Chinese, and no line carries the spec’s English', async () => {
    const lines = (await bannerLinesForChineseLabel()).map((li) => li.textContent ?? '');
    expect(lines.some((l) => l.includes(ZH_TOO_SHORT))).toBe(true);
    expect(lines.some((l) => l.includes(ZH_SNAKE))).toBe(true);
    for (const en of SNAKE_EN) expect(lines.some((l) => l.includes(en))).toBe(false);
  });

  it('(b) CONTROL en-US: the banner shows the spec’s own sentences', async () => {
    localeFixture = 'en-US';
    const lines = (await bannerLinesForChineseLabel()).map((li) => li.textContent ?? '');
    for (const en of SNAKE_EN) expect(lines.some((l) => l.includes(en))).toBe(true);
    expect(lines.some((l) => l.includes(ZH_SNAKE))).toBe(false);
  });

  it('(c) the banner lines wrap instead of cutting the message', async () => {
    const lines = await bannerLinesForChineseLabel();
    for (const li of lines) {
      expect(li.className.split(/\s+/)).not.toContain('truncate');
      expect(li.className.split(/\s+/)).toContain('whitespace-normal');
    }
  });
});

describe('the spec’s identifier grammars are rendered by code and pattern (objectstack#28369)', () => {
  it('(d) the client door carries each issue’s code and pattern beside the spec’s message', async () => {
    const { issues } = await validateMetadataDraft('permission', { name: '', label: '销售运营' });
    const nameIssues = issues.filter((i) => i.path === 'name');
    expect(nameIssues.map((i) => i.message)).toEqual(SNAKE_EN);
    expect(nameIssues.map((i) => translateSchemaIssue(i, 'zh-CN'))).toEqual([ZH_TOO_SHORT, ZH_SNAKE]);
    expect(nameIssues.map((i) => translateSchemaIssue(i, 'en-US'))).toEqual(SNAKE_EN);
  });

  it.each([
    ['SnakeCaseIdentifierSchema', SNAKE, ZH_SNAKE],
    ['SystemIdentifierSchema', specIssues(SystemIdentifierSchema), ZH_SYSTEM],
  ] as const)('(d) %s, parsed live: zh rows in zh, the spec’s message in en', (_name, parsed, zhFormat) => {
    const asIssue = ({ message, ...detail }: (typeof parsed)[number]) => ({ message, detail });
    expect(parsed.map((i) => translateSchemaIssue(asIssue(i), 'zh-CN'))).toEqual([ZH_TOO_SHORT, zhFormat]);
    expect(parsed.map((i) => translateSchemaIssue(asIssue(i), 'en-US'))).toEqual(parsed.map((i) => i.message));
  });

  it('an issue without a code keeps the existing message path', () => {
    expect(translateSchemaIssue({ message: SNAKE_EN[1] }, 'zh-CN')).toBe(SNAKE_EN[1]);
  });
});
