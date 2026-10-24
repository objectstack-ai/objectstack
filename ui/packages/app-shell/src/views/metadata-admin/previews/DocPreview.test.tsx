// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `doc` editor canvas (objectui#10188): a Markdown source pane beside a
 * live preview, the doc's locale variants, and its placement in a book.
 *
 * ## What is real here and what is stubbed
 *
 * The component, the spec's `DocSchema` and the spec's `resolveBookTree` are
 * the shipping ones. Two things are stood in for:
 *
 *  - the metadata client's `list('book')` — the one read this canvas makes;
 *  - the registry's `markdown` renderer. This package deliberately takes no
 *    dependency on `@object-ui/plugin-markdown`: the preview hands the draft to
 *    `SchemaRenderer` as `{ type: 'markdown', content }`, the registry entry the
 *    console registers and the docs portal renders with. What these tests pin is
 *    that hand-off — the preview is reached ONLY through the registry type, so
 *    the stub renders nothing if the canvas ever stops asking for it. That the
 *    renderer turns a heading, a list and a link into HTML is
 *    `@object-ui/plugin-markdown`'s own contract, pinned in its
 *    `markdown-render.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { DocSchema } from '@objectstack/spec/system';

const mockClient = {
  list: vi.fn(async (_type: string): Promise<unknown[]> => []),
};

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { DocPreview } from './DocPreview';
import { localeRefusal, patchAddLocale, patchRemoveLocale, resolvePlacements, toBookOptions } from './doc-draft';

const STUB_NS = 'doc-preview-test';

/** Reached only through the registry's `markdown` type — see the header. */
function StubMarkdown({ schema }: { schema: { type?: string; content?: string } }) {
  return (
    <div data-testid="markdown-render" data-type={schema.type}>
      {schema.content}
    </div>
  );
}

beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

const MANUAL = {
  name: 'docprobe_manual',
  label: 'Probe Manual',
  groups: [
    { key: 'getting_started', label: 'Getting started', include: 'docprobe_gs_*' },
    { key: 'reference', label: 'Reference' },
  ],
};

beforeEach(() => {
  mockClient.list.mockReset();
  mockClient.list.mockImplementation(async () => [MANUAL]);
});
afterEach(() => cleanup());

/** Host stand-in: holds the draft and merges patches the way `ResourceEditPage` does. */
function Host({
  initial,
  editing = true,
  locale = 'en-US',
  onDraft,
}: {
  initial: Record<string, unknown>;
  editing?: boolean;
  locale?: string;
  onDraft?: (d: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  React.useEffect(() => {
    onDraft?.(draft);
  }, [draft, onDraft]);
  return (
    <DocPreview
      type="doc"
      name={String(draft.name ?? '')}
      draft={draft}
      editing={editing}
      locale={locale}
      onPatch={(p) => setDraft((d) => ({ ...d, ...p }))}
    />
  );
}

/**
 * Open the book-section picker, the shared `Select` (objectui#11865), from the
 * keyboard and return its listbox.
 */
async function openSections(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Book section' }), { key: 'ArrowDown' });
  return screen.findByRole('listbox');
}

/** Pick the book section named `name` through the picker. */
async function pickSection(name: string): Promise<void> {
  fireEvent.click(within(await openSections()).getByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

function renderHost(initial: Record<string, unknown>, opts: { editing?: boolean; locale?: string } = {}) {
  let latest: Record<string, unknown> = initial;
  render(<Host initial={initial} {...opts} onDraft={(d) => (latest = d)} />);
  return { draft: () => latest };
}

const MARKDOWN = '# Getting started\n\n- one\n- two\n\n[the portal](https://example.com/docs)';

describe('DocPreview — the Markdown source pane and its live preview (objectui#10188)', () => {
  it('writes the typed Markdown to `content` and re-renders the preview from the draft', async () => {
    const h = renderHost({ name: 'my_guide', content: '' });
    const source = screen.getByRole('textbox', { name: 'Markdown source' });
    fireEvent.change(source, { target: { value: MARKDOWN } });

    expect(h.draft().content).toBe(MARKDOWN);
    const preview = screen.getByRole('region', { name: 'Live preview' });
    const rendered = within(preview).getByTestId('markdown-render');
    expect(rendered).toHaveAttribute('data-type', 'markdown');
    expect(rendered.textContent).toBe(MARKDOWN);

    fireEvent.change(source, { target: { value: '# Renamed' } });
    expect(within(preview).getByTestId('markdown-render').textContent).toBe('# Renamed');
  });

  it('renders the preview alone when the host is not editing', () => {
    renderHost({ name: 'my_guide', content: MARKDOWN }, { editing: false });
    expect(screen.queryByRole('textbox', { name: 'Markdown source' })).toBeNull();
    expect(screen.getByTestId('markdown-render').textContent).toBe(MARKDOWN);
    expect(screen.getByRole('combobox', { name: 'Book section' })).toBeDisabled();
  });

  it('does not ask the renderer for an empty body', () => {
    renderHost({ name: 'my_guide', content: '' });
    expect(screen.queryByTestId('markdown-render')).toBeNull();
    expect(screen.getByText(/Nothing to preview yet/)).toBeInTheDocument();
  });
});

describe('DocPreview — locale variants are entries of `translations` (objectui#10188)', () => {
  it('adds a variant seeded from the base body and edits only that variant', () => {
    const h = renderHost({ name: 'my_guide', label: 'Guide', content: MARKDOWN });
    fireEvent.change(screen.getByRole('textbox', { name: 'New locale tag' }), { target: { value: 'zh-CN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Locale' }));

    expect(h.draft().translations).toEqual({ 'zh-CN': { content: MARKDOWN } });
    expect(screen.getByRole('tab', { name: 'zh-CN' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown source (zh-CN)' }), {
      target: { value: '# 入门' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: '指南' } });

    expect(h.draft().content).toBe(MARKDOWN);
    expect(h.draft().translations).toEqual({ 'zh-CN': { content: '# 入门', label: '指南' } });
    expect(screen.getByTestId('markdown-render').textContent).toBe('# 入门');

    // Emptying the variant's title drops the key, so the base title is the fallback.
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: '' } });
    expect(h.draft().translations).toEqual({ 'zh-CN': { content: '# 入门' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove the zh-CN variant' }));
    expect(h.draft().translations).toBeUndefined();
    expect(screen.getByRole('tab', { name: 'Default' })).toHaveAttribute('aria-selected', 'true');
  });

  it('refuses a malformed or duplicate locale tag instead of storing it', () => {
    const draft = { name: 'g', content: 'x', translations: { 'zh-CN': { content: 'y' } } };
    expect(localeRefusal(draft, 'zh CN')).toBe('invalid');
    expect(localeRefusal(draft, 'Chinese (Simplified)')).toBe('invalid');
    expect(localeRefusal(draft, 'zh-CN')).toBe('duplicate');
    expect(localeRefusal(draft, 'ja')).toBeNull();

    renderHost(draft);
    fireEvent.change(screen.getByRole('textbox', { name: 'New locale tag' }), { target: { value: 'zh-CN' } });
    expect(screen.getByRole('alert')).toHaveTextContent('zh-CN already has a variant');
    expect(screen.getByRole('button', { name: 'Locale' })).toBeDisabled();
  });

  it('removing the last variant removes the key rather than storing an empty map', () => {
    const draft = { name: 'g', content: 'x', translations: { ja: { content: 'y' } } };
    expect(patchRemoveLocale(draft, 'ja')).toEqual({ translations: undefined });
    expect(patchAddLocale({ name: 'g', content: 'base' }, 'ja')).toEqual({ translations: { ja: { content: 'base' } } });
  });
});

describe('DocPreview — placing the doc in a book writes `doc.group` (objectui#10188)', () => {
  it('lists every book group, writes the picked key, and reads the placement back from the resolver', async () => {
    const h = renderHost({ name: 'my_guide', content: 'x' });
    await waitFor(() => expect(screen.getByTestId('doc-placement')).toHaveTextContent('Not in any book section yet'));

    const sections = await openSections();
    expect(within(sections).getByRole('group', { name: 'Probe Manual' })).toBeInTheDocument();
    fireEvent.click(within(sections).getByRole('option', { name: 'Reference' }));

    expect(h.draft().group).toBe('reference');
    expect(screen.getByTestId('doc-placement')).toHaveTextContent('Appears in: Probe Manual › Reference');

    await pickSection('Not placed in a section');
    expect(h.draft().group).toBeUndefined();
    expect(mockClient.list).toHaveBeenCalledWith('book');
  });

  it('reports a placement a group rule makes, with no explicit `group` at all', async () => {
    renderHost({ name: 'docprobe_gs_intro', content: 'x' });
    await waitFor(() =>
      expect(screen.getByTestId('doc-placement')).toHaveTextContent('Appears in: Probe Manual › Getting started'),
    );
  });

  it('names every book a shared group key places the doc in, and flags a public one', () => {
    const books = toBookOptions([
      MANUAL,
      { name: 'handbook', label: 'Handbook', audience: 'public', groups: [{ key: 'reference', label: 'Reference' }] },
    ]);
    const placements = resolvePlacements({ name: 'my_guide', group: 'reference', content: 'x' }, books);
    expect(placements).toEqual([
      { book: 'handbook', bookLabel: 'Handbook', group: 'Reference', public: true },
      { book: 'docprobe_manual', bookLabel: 'Probe Manual', group: 'Reference', public: false },
    ]);
  });

  it('keeps a group key no book declares visible instead of dropping it', async () => {
    renderHost({ name: 'my_guide', content: 'x', group: 'retired_section' });
    const picker = await screen.findByRole('combobox', { name: 'Book section' });
    await waitFor(() => expect(picker).toHaveTextContent('retired_section (not a section of any book)'));
    expect(within(await openSections()).getByRole('option', { name: 'retired_section (not a section of any book)' })).toBeInTheDocument();
  });

  it('says so when the book list cannot be read, rather than reporting no books', async () => {
    mockClient.list.mockImplementation(async () => {
      throw new Error('503 Service Unavailable');
    });
    renderHost({ name: 'my_guide', content: 'x' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Books could not be loaded: 503 Service Unavailable');
    expect(screen.queryByTestId('doc-placement')).toBeNull();
  });
});

describe('DocPreview — every key it writes is a key `DocSchema` declares (objectui#10188)', () => {
  it('a draft edited through every control parses clean on the spec', async () => {
    const h = renderHost({ name: 'my_guide', label: 'Guide', content: '' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown source' }), { target: { value: MARKDOWN } });
    await waitFor(() => expect(screen.getByTestId('doc-placement')).toBeInTheDocument());
    await pickSection('Reference');
    fireEvent.change(screen.getByRole('textbox', { name: 'New locale tag' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Locale' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: '概要' } });

    const result = DocSchema.safeParse(h.draft());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('DocPreview — its own words in both designer locales (objectui#10188)', () => {
  it('renders no untranslated `engine.docPreview.*` key in zh-CN, in text or attributes', async () => {
    renderHost(
      { name: 'my_guide', content: '', translations: { ja: { content: 'x' } } },
      { locale: 'zh-CN' },
    );
    fireEvent.click(screen.getByRole('tab', { name: 'ja' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新的语言标记' }), { target: { value: 'bad tag' } });
    await waitFor(() => expect(screen.getByTestId('doc-placement')).toBeInTheDocument());

    const leaks: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.value.includes('engine.docPreview.')) leaks.push(`${el.tagName}[${attr.name}]=${attr.value}`);
      }
    }
    if (document.body.textContent?.includes('engine.docPreview.')) leaks.push('text node');
    expect(leaks).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Markdown 源码（ja）' })).toBeInTheDocument();
  });
});
