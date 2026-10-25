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
