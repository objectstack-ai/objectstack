/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A stored criteria reads as words (objectstack#30209 row 2).
 *
 * A sharing rule's `criteria_json` declares `widget: 'filter-condition'`. Its
 * record page drew the stored JSON, `{"priority":"urgent"}`, because the key
 * had no read face and fell to its `textarea` type. The key now draws through
 * the widget's read display, which says the criteria in the object's field and
 * option labels. Red before the fix (the cell printed the JSON), green after.
 *
 * Two controls keep the change narrow: a criteria the builder cannot represent
 * still reads as the stored JSON, and an empty one is the empty cell.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { SchemaRendererProvider } from '@object-ui/react';
import { getCellRenderer, resolveCellRendererType } from '../../index';

afterEach(cleanup);

const TASK_SCHEMA = {
  name: 'task',
  fields: {
    priority: {
      name: 'priority',
      label: '优先级',
      type: 'select',
      options: [
        { value: 'urgent', label: '紧急' },
        { value: 'low', label: '低' },
      ],
    },
    done: { name: 'done', label: '已完成', type: 'boolean' },
  },
};

const dataSource = { getObjectSchema: async () => TASK_SCHEMA } as any;

const criteriaField = { name: 'criteria_json', label: '条件', type: 'textarea', widget: 'filter-condition' } as any;

function renderCell(value: string) {
  const Cell = getCellRenderer(resolveCellRendererType(criteriaField));
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={dataSource}>
        <Cell value={value} field={criteriaField} dependentValues={{ object_name: 'task' }} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

describe('a `filter-condition` value reads as words (objectstack#30209)', () => {
  it('says one condition in the field and option labels', async () => {
    renderCell('{"priority":"urgent"}');
    expect(await screen.findByText('优先级 等于 紧急')).toBeInTheDocument();
    expect(screen.queryByText('{"priority":"urgent"}')).toBeNull();
  });

  it('joins an OR group with its word and draws a boolean as a word', async () => {
    renderCell('{"$or":[{"priority":"low"},{"done":true}]}');
    expect(await screen.findByText('优先级 等于 低 或 已完成 等于 是')).toBeInTheDocument();
  });

  it('keeps a criteria the builder cannot represent as the stored JSON (control)', async () => {
    const nested = '{"$or":[{"$and":[{"priority":"low"},{"done":true}]},{"priority":"urgent"}]}';
    const { container } = renderCell(nested);
    await screen.findByText(nested);
    expect(container.querySelector('[data-filter-condition="words"]')).toBeNull();
  });
});

/**
 * objectstack#37288 (c) — the sentence says the object's TRANSLATED field and
 * option labels, the way a record page draws the same field and option
 * (`fieldLabel`, `translateOptions`), and falls back to the authored label
 * where the bundle has none.
 */
describe('a `filter-condition` sentence says the translated labels (objectstack#37288)', () => {
  const TICKET_SCHEMA = {
    name: 'ticket',
    fields: {
      priority: {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        options: [
          { value: 'urgent', label: 'Urgent' },
          { value: 'low', label: 'Low' },
        ],
      },
      queue: { name: 'queue', label: 'Queue', type: 'text' },
    },
  };
  /** An app bundle carrying the zh labels of `priority` and its `urgent` option only. */
  const ZH_APP_BUNDLE = {
    'zh-Hans': {
      testapp: {
        fields: { ticket: { priority: '优先级' } },
        fieldOptions: { ticket: { priority: { urgent: '紧急' } } },
      },
    },
  };
  const equals = (language: string): unknown =>
    ((builtInLocales as Record<string, any>)[language]?.filterBuilder?.operators?.equals);

  function renderTicket(language: string, value: string) {
    const ticketSource = { getObjectSchema: async () => TICKET_SCHEMA } as any;
    const Cell = getCellRenderer(resolveCellRendererType(criteriaField));
    return render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_APP_BUNDLE }}>
        <SchemaRendererProvider dataSource={ticketSource}>
          <Cell value={value} field={criteriaField} dependentValues={{ object_name: 'ticket' }} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
  }

  it('says the zh field and option labels, not the authored English', async () => {
    renderTicket('zh-Hans', '{"priority":"urgent"}');
    expect(await screen.findByText(`优先级 ${equals('zh-Hans')} 紧急`)).toBeInTheDocument();
  });

  it('says the authored en labels under en', async () => {
    renderTicket('en', '{"priority":"urgent"}');
    expect(await screen.findByText(`Priority ${equals('en')} Urgent`)).toBeInTheDocument();
  });

  it('CONTROL: an option and a field the bundle does not translate keep their authored labels', async () => {
    renderTicket('zh-Hans', '{"$or":[{"priority":"low"},{"queue":"ops"}]}');
    const or = (builtInLocales as Record<string, any>)['zh-Hans']?.filterBuilder?.or;
    expect(
      await screen.findByText(`优先级 ${equals('zh-Hans')} Low ${or} Queue ${equals('zh-Hans')} ops`),
    ).toBeInTheDocument();
  });

  it('CONTROL: a value no option holds stays as stored', async () => {
    renderTicket('zh-Hans', '{"priority":"legacy"}');
    expect(await screen.findByText(`优先级 ${equals('zh-Hans')} legacy`)).toBeInTheDocument();
  });
});
