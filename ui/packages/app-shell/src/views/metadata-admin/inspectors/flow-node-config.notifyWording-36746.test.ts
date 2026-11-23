// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36746 (r10) — the Notify node's rows speak the author's words,
 * in the English base table and in the zh overlay: no key alias
 * (`subject` / `body`), no default spelled as a literal (`"notify"`), no
 * enum spelled as `a | b | c`, no "id" or "object name" a developer reads.
 *
 * The zh overlay also covers the rows only the engine-published descriptor
 * serves (`actorId`, `payload`), keyed by the same field ids.
 */

import { describe, it, expect } from 'vitest';
import { fieldsForNodeType, localizeFlowFields, type FlowConfigField } from './flow-node-config';
import { flowFieldZh } from '../i18n';

const DEVELOPER_WORDING = [/别名/u, /alias/i, /"notify"/, /fan out/i, /扇出/u, /\|/, /\bid\b/i, /对象名/u, /Event topic/i, /事件主题/u];

const rowText = (f: Pick<FlowConfigField, 'label' | 'help' | 'placeholder'>) =>
  [f.label, f.help ?? '', f.placeholder ?? ''].join(' ');

const byId = (fields: FlowConfigField[], id: string) => {
  const f = fields.find((x) => x.id === id);
  expect(f, id).toBeDefined();
  return f!;
};

const ROWS = ['title', 'message', 'channels', 'topic', 'severity', 'sourceObject'] as const;

describe('the Notify node speaks the author\'s words (objectstack#36746)', () => {
  it.each(ROWS)('en: %s carries no developer wording', (id) => {
    const f = byId(fieldsForNodeType('notify'), id);
    for (const re of DEVELOPER_WORDING) expect(rowText(f)).not.toMatch(re);
  });

  it.each(ROWS)('zh: %s carries no developer wording', (id) => {
    const f = byId(localizeFlowFields('notify', fieldsForNodeType('notify'), 'zh-CN'), id);
    for (const re of DEVELOPER_WORDING) expect(rowText(f)).not.toMatch(re);
  });

  it.each(['actorId', 'payload'] as const)('zh: the served-only row %s carries no developer wording', (id) => {
    const z = flowFieldZh('notify', id);
    expect(z?.help).toBeTruthy();
    for (const re of DEVELOPER_WORDING) expect(`${z!.label ?? ''} ${z!.help}`).not.toMatch(re);
  });

  it('the topic row is a category the recipient can switch off, in both languages, with no literal default', () => {
    const en = byId(fieldsForNodeType('notify'), 'topic');
    expect(en.label).toBe('Category');
    expect(en.placeholder).toBeUndefined();
    expect(en.help).toMatch(/notification settings/);
    const zh = byId(localizeFlowFields('notify', fieldsForNodeType('notify'), 'zh-CN'), 'topic');
    expect(zh.label).toBe('通知类别');
    expect(zh.help).toMatch(/通知设置/u);
  });

  it('zh: the severity options read as words, not as the stored values', () => {
    const zh = byId(localizeFlowFields('notify', fieldsForNodeType('notify'), 'zh-CN'), 'severity');
    expect(zh.options?.map((o) => o.label)).toEqual(['一般', '警告', '紧急']);
    expect(zh.options?.map((o) => o.value)).toEqual(['info', 'warning', 'critical']);
  });
});
