/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:details` fills a section heading's `{{ count }}` hole with how many
 * values a field holds on the current record (objectui#12192) — the renderer
 * half of `@objectstack/spec`'s `RecordDetailsProps.sections[].count`.
 *
 * What the spec declares, and what each leg below holds the renderer to:
 *
 *  - `count: { field }` names the field; the heading (`label`) writes the hole
 *    where the number goes. The hole is the spec's exported
 *    `SECTION_HEADING_COUNT_HOLE` (`{{ count }}`, inner whitespace free).
 *  - "an absent or empty value counts 0" — the spec's own describe.
 *  - "Every locale of an inline label map, and a translated
 *    `objects.<object>._sections.<name>.label`, writes the same `{{ count }}`
 *    hole" — so the fill happens AFTER translation, in `en` and in `zh`.
 *  - A section WITHOUT `count` is not touched: `label` accepted any text before
 *    the key existed, so a literal hole there prints as written.
 *  - `count` changes the heading only. A section whose fields are all empty is
 *    still absent under the renderer's `hideEmpty` default, so a collapsed
 *    section that is "absent when the field is empty" stays absent.
 *
 * Every node is mounted the way a page mounts it: a `{ type, properties }`
 * document through the real `SchemaRenderer` and this package's registration,
 * inside a record context. The field names here are generic on purpose; the
 * renderer has no special case for any section, object or field.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { PermissionProvider } from '@object-ui/permissions';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
// Registers `record:details`, the block under test.
import '../../index';

// `record:details` asks `POST /api/v1/security/explain` whether the record may
// be edited; under happy-dom a relative fetch is a real socket, so it is served
// from a double installed for every case.
beforeEach(() => installRecordSecurityExplainDouble(vi));

// Unmount before the real `fetch` is restored, so no late read escapes.
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

const OBJECT = 'article_12192';

/**
 * `name` is declared and left unset: the page-H1 dedupe ladder resolves its
 * title candidate to `name`, finds no value and hides nothing, so every row the
 * legs below rely on stays in its section.
 */
const objectSchema = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Name' },
    headline: { type: 'text', label: 'Headline' },
    tags: {
      type: 'multiselect',
      label: 'Tags',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
        { value: 'gamma', label: 'Gamma' },
      ],
    },
    reviewers: { type: 'lookup', reference: 'sys_user', multiple: true, label: 'Reviewers' },
    status: {
      type: 'select',
      label: 'Status',
      options: [{ value: 'open', label: 'Open' }],
    },
  },
};

const THREE_TAGS = { headline: 'Launch notes', tags: ['alpha', 'beta', 'gamma'] };

/** The sibling every leg keeps: proves the body rendered at all. */
const ANCHOR = { name: 'basics', label: 'Basics', fields: ['headline'] };

const detailsDoc = (...sections: Array<Record<string, unknown>>) => ({
  type: 'record:details',
  properties: { sections },
});

type Wrap = (node: React.ReactElement) => React.ReactElement;

function mount(
  doc: Record<string, unknown>,
  record: Record<string, unknown>,
  {
    language = 'en',
    i18n,
    wrap = (node) => node,
  }: { language?: string; i18n?: ReturnType<typeof createI18n>; wrap?: Wrap } = {},
) {
  const provider = i18n
    ? { instance: i18n }
    : { config: { defaultLanguage: language, detectBrowserLanguage: false } };
  return render(
    wrap(
      <I18nProvider {...provider}>
        <RecordContextProvider
          objectName={OBJECT}
          recordId="A1"
          data={{ id: 'A1', ...record }}
          objectSchema={objectSchema as never}
        >
          <SchemaRenderer schema={doc as never} />
        </RecordContextProvider>
      </I18nProvider>,
    ),
  );
}

/** The body rendered: the anchor section's heading and its row value. */
async function requireLiveBody(): Promise<void> {
  expect(await screen.findByText('Basics')).toBeInTheDocument();
  expect(screen.getByText('Launch notes')).toBeInTheDocument();
}

/** No hole survived anywhere on the page (the spec's grammar, whitespace free). */
function expectNoLiteralHole(container: HTMLElement): void {
  expect(container.textContent ?? '').not.toMatch(/\{\{\s*count\s*\}\}/);
}

const tagsSection = (extra: Record<string, unknown> = {}) => ({
  name: 'tagging',
  label: '{{ count }} tags',
  count: { field: 'tags' },
  fields: ['tags'],
  ...extra,
});

describe('record:details fills a section heading\'s `{{ count }}` hole (objectui#12192)', () => {
  it('a multi-select holding three values reads 3 in the heading', async () => {
    const { container } = mount(detailsDoc(ANCHOR, tagsSection()), THREE_TAGS);
    await requireLiveBody();
    expect(screen.getByText('3 tags')).toBeInTheDocument();
    expectNoLiteralHole(container);
  });

  it('every hole in the heading is filled, whatever its inner whitespace', async () => {
    const { container } = mount(
      detailsDoc(ANCHOR, tagsSection({ label: '{{count}} of {{ count }} tags' })),
      THREE_TAGS,
    );
    await requireLiveBody();
    expect(screen.getByText('3 of 3 tags')).toBeInTheDocument();
    expectNoLiteralHole(container);
  });

  it('an expanded multi-value lookup counts its records', async () => {
    mount(
      detailsDoc(ANCHOR, {
        name: 'review',
        label: '{{ count }} reviewers',
        count: { field: 'reviewers' },
        fields: ['tags'],
      }),
      { ...THREE_TAGS, reviewers: [{ id: 'u1', name: 'Ann' }, { id: 'u2', name: 'Bo' }] },
    );
    await requireLiveBody();
    expect(screen.getByText('2 reviewers')).toBeInTheDocument();
  });
});

describe('an absent or empty value counts 0, as the spec states', () => {
  it('an empty array reads 0 when the section is kept (`hideEmpty: false`)', async () => {
    const { container } = mount(
      detailsDoc(ANCHOR, tagsSection({ hideEmpty: false })),
      { headline: 'Launch notes', tags: [] },
    );
    await requireLiveBody();
    expect(screen.getByText('0 tags')).toBeInTheDocument();
    expectNoLiteralHole(container);
  });

  it('an absent value reads 0 in a section a filled field keeps on the page', async () => {
    const { container } = mount(
      detailsDoc(tagsSection({ fields: ['headline', 'tags'] })),
      { headline: 'Launch notes' },
    );
    expect(await screen.findByText('0 tags')).toBeInTheDocument();
    expectNoLiteralHole(container);
  });

  it('a field the viewer may not read counts 0, never its hidden values', async () => {
    const denying = (field: string): Wrap => (node) => (
      <PermissionProvider
        roles={[]}
        userRoles={['viewer']}
        permissions={[
          {
            object: OBJECT,
            roles: { viewer: { actions: ['read'], fieldPermissions: [{ field, read: false }] } },
          },
        ] as never}
      >
        {node}
      </PermissionProvider>
    );
    const section = tagsSection({ fields: ['headline', 'tags'] });

    mount(detailsDoc(section), THREE_TAGS, { wrap: denying('tags') });
    expect(await screen.findByText('0 tags')).toBeInTheDocument();
    expect(screen.queryByText('3 tags')).toBeNull();
    cleanup();

    // CONTROL: the same policy denying a field the count does not read.
    mount(detailsDoc(section), THREE_TAGS, { wrap: denying('status') });
    expect(await screen.findByText('3 tags')).toBeInTheDocument();
  });
});

describe('`count` changes the heading only, never whether the section renders', () => {
  const collapsedSection = tagsSection({ collapsible: true, defaultCollapsed: true });

  it('a collapsed section over an empty field is still absent', async () => {
    const { container } = mount(
      detailsDoc(ANCHOR, collapsedSection),
      { headline: 'Launch notes', tags: [] },
    );
    await requireLiveBody();
    expect(screen.queryByText('0 tags')).toBeNull();
    expectNoLiteralHole(container);
  });

  it('a collapsed section over a filled field shows its count while collapsed', async () => {
    const { container } = mount(detailsDoc(ANCHOR, collapsedSection), THREE_TAGS);
    await requireLiveBody();
    expect(screen.getByText('3 tags')).toBeInTheDocument();
    // Collapsed: the option badges are not drawn, the heading carries the count.
    expect(screen.queryByText('Alpha')).toBeNull();
    expectNoLiteralHole(container);
  });
});

describe('a heading on a section without `count` is unchanged', () => {
  it('a literal hole prints as written when the section declares no `count`', async () => {
    mount(
      detailsDoc(ANCHOR, { name: 'tagging', label: '{{ count }} tags', fields: ['tags'] }),
      THREE_TAGS,
    );
    await requireLiveBody();
    expect(screen.getByText('{{ count }} tags')).toBeInTheDocument();
    expect(screen.queryByText('3 tags')).toBeNull();
  });

  it('a plain heading renders exactly as authored', async () => {
    mount(detailsDoc(ANCHOR, { name: 'tagging', label: 'Tags list', fields: ['tags'] }), THREE_TAGS);
    await requireLiveBody();
    expect(screen.getByText('Tags list')).toBeInTheDocument();
  });
});

describe('the hole is filled after translation, in `zh` as in `en`', () => {
  const LABEL_MAP = { en: '{{ count }} tags', 'zh-CN': '已选 {{ count }} 个标签' };

  it('zh: an inline label map paints the zh-CN entry with the count filled', async () => {
    const { container } = mount(detailsDoc(ANCHOR, tagsSection({ label: LABEL_MAP })), THREE_TAGS, {
      language: 'zh',
    });
    await requireLiveBody();
    expect(screen.getByText('已选 3 个标签')).toBeInTheDocument();
    expect(screen.queryByText('3 tags')).toBeNull();
    expectNoLiteralHole(container);
  });

  it('en: the same map paints the en entry with the count filled', async () => {
    mount(detailsDoc(ANCHOR, tagsSection({ label: LABEL_MAP })), THREE_TAGS, { language: 'en' });
    await requireLiveBody();
    expect(screen.getByText('3 tags')).toBeInTheDocument();
  });

  it('zh: a translated `_sections.<name>.label` bundle entry carries the hole, and it is filled', async () => {
    const instance = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: {
        zh: { app: { objects: { [OBJECT]: { _sections: { tagging: { label: '{{ count }} 个标签已选' } } } } } },
      },
    });
    const { container } = mount(detailsDoc(ANCHOR, tagsSection()), THREE_TAGS, { i18n: instance });
    await requireLiveBody();
    // The bundle outranks the authored text, and its hole is the one filled.
    expect(screen.getByText('3 个标签已选')).toBeInTheDocument();
    expect(screen.queryByText('3 tags')).toBeNull();
    expectNoLiteralHole(container);
  });
});

describe('a non-array value is one value', () => {
  it('a single value counts 1, as the body draws it as one', async () => {
    // Naming a single-valued field in `count.field` is refused at authoring
    // time by `@objectstack/lint`; this pins what the renderer shows if one
    // reaches it anyway, not a recommended authoring.
    mount(
      detailsDoc(ANCHOR, {
        name: 'state',
        label: '{{ count }} status',
        count: { field: 'status' },
        fields: ['tags'],
      }),
      { ...THREE_TAGS, status: 'open' },
    );
    await requireLiveBody();
    expect(screen.getByText('1 status')).toBeInTheDocument();
  });
});
