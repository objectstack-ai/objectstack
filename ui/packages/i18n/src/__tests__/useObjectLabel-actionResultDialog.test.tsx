import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '../provider';
import { useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    I18nProvider,
    { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children },
  );

/** The metadata literal spec, as authored on sys_user.create_user. */
const spec = {
  title: 'User Created',
  description: 'Copy the temporary password now — it is shown only once and never stored.',
  acknowledge: 'I have saved this password',
  fields: [
    { path: 'user.email', label: 'Email', format: 'text' },
    { path: 'user.phoneNumber', label: 'Phone Number', format: 'text' },
    { path: 'temporaryPassword', label: 'Temporary Password', format: 'secret' },
  ],
};

describe('useObjectLabel().actionResultDialog', () => {
  it('falls back to the literal spec when no translation is registered', () => {
    const { result } = renderHook(() => useObjectLabel(), { wrapper });
    const out = result.current.actionResultDialog('sys_user', 'create_user', spec);
    expect(out?.title).toBe('User Created');
    expect(out?.fields?.[0].label).toBe('Email');
  });

  it('overlays translated copy and per-path field labels (dotted paths stay literal keys)', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        setup: {
          objects: {
            sys_user: {
              _actions: {
                create_user: {
                  resultDialog: {
                    title: '用户已创建',
                    description: '请立即复制临时密码——它只显示一次，不会被保存。',
                    acknowledge: '我已保存该密码',
                    fields: {
                      'user.email': '邮箱',
                      temporaryPassword: '临时密码',
                    },
                  },
                },
              },
            },
          },
        },
      },
      true,
      true,
    );

    const out = result.current.labels.actionResultDialog('sys_user', 'create_user', spec);
    expect(out?.title).toBe('用户已创建');
    expect(out?.description).toBe('请立即复制临时密码——它只显示一次，不会被保存。');
    expect(out?.acknowledge).toBe('我已保存该密码');
    // The dotted path resolves as ONE literal key of the fields record.
    expect(out?.fields?.[0]).toEqual({ path: 'user.email', label: '邮箱', format: 'text' });
    // Untranslated fields keep the metadata literal; format survives.
    expect(out?.fields?.[1]).toEqual({ path: 'user.phoneNumber', label: 'Phone Number', format: 'text' });
    expect(out?.fields?.[2]).toEqual({ path: 'temporaryPassword', label: '临时密码', format: 'secret' });
    // Source spec is not mutated.
    expect(spec.title).toBe('User Created');
    expect(spec.fields[0].label).toBe('Email');
  });

  it('returns the spec untouched when the action name is missing', () => {
    const { result } = renderHook(() => useObjectLabel(), { wrapper });
    expect(result.current.actionResultDialog('sys_user', undefined, spec)).toBe(spec);
    expect(result.current.actionResultDialog('sys_user', 'create_user', undefined)).toBeUndefined();
  });
});

/**
 * [objectstack#34652] A `format: 'table'` field's column headers, keyed
 * `resultDialog.columns.<path>.<column_path>` (and `preflight.columns…`) —
 * a sibling of `fields`, both levels literal keys, the address the spec's
 * `resolveActionResultDialog` / `resolveActionPreflight` read.
 */
describe('useObjectLabel() — answer table column headers', () => {
  const tableSpec = {
    title: 'Import finished',
    fields: [
      { path: 'summary.added', label: 'Added', format: 'text' },
      {
        path: 'rows',
        label: 'Result per row',
        format: 'table',
        columns: [
          { path: 'email', label: 'Email' },
          { path: 'error.message', label: 'Not added because' },
          { path: 'row', format: 'json' },
        ],
      },
    ],
  };
  const node = (columns: Record<string, unknown> | undefined) => ({
    setup: {
      objects: {
        sys_user: {
          _actions: {
            import_users: {
              resultDialog: { fields: { rows: '逐行结果' }, ...(columns ? { columns } : {}) },
              ...(columns ? { preflight: { columns } } : {}),
            },
          },
        },
      },
    },
  });

  it('draws each declared column header from the zh-CN bundle, and the en bundle in en', async () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    const { i18n } = result.current;
    i18n.addResourceBundle(
      'zh-CN',
      'translation',
      node({ rows: { email: '邮箱', 'error.message': '未添加的原因', row: '行', ghost: '幽灵' } }),
      true,
      true,
    );
    i18n.addResourceBundle('en', 'translation', node({ rows: { email: 'Email address' } }), true, true);

    await i18n.changeLanguage('zh-CN');
    const zh = result.current.labels.actionResultDialog('sys_user', 'import_users', tableSpec);
    expect(zh?.fields?.[1]).toEqual({
      path: 'rows',
      label: '逐行结果',
      format: 'table',
      columns: [
        { path: 'email', label: '邮箱' },
        // A dotted column path is ONE literal key.
        { path: 'error.message', label: '未添加的原因' },
        { path: 'row', label: '行', format: 'json' },
      ],
    });
    // A row with no columns is untouched by the columns node.
    expect(zh?.fields?.[0]).toEqual({ path: 'summary.added', label: 'Added', format: 'text' });
    const zhPreflight = result.current.labels.actionPreflight('sys_user', 'import_users', { fields: tableSpec.fields });
    expect(zhPreflight?.fields?.[1].columns).toEqual(zh?.fields?.[1].columns);

    await i18n.changeLanguage('en');
    const en = result.current.labels.actionResultDialog('sys_user', 'import_users', tableSpec);
    expect(en?.fields?.[1].columns?.map((c: { label?: string }) => c.label)).toEqual([
      'Email address',
      'Not added because',
      undefined,
    ]);
    // Source spec is not mutated.
    expect(tableSpec.fields[1].columns?.[0].label).toBe('Email');
  });

  it('keeps every authored header when the bundle carries no column key', async () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle('zh-CN', 'translation', node(undefined), true, true);
    await result.current.i18n.changeLanguage('zh-CN');
    const out = result.current.labels.actionResultDialog('sys_user', 'import_users', tableSpec);
    expect(out?.fields?.[1]).toEqual({ ...tableSpec.fields[1], label: '逐行结果' });
  });
});
