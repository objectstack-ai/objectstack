/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression test: the gallery cover must be resolved through the file
 * **value shape**, not by assuming the field value *is* a URL string
 * (objectui#3317).
 *
 * Since ADR-0104 D3 wave 2 a `file`/`image`/`avatar`/`video`/`audio` field
 * stores an opaque `sys_file` id and the read path expands it in place to
 * `{ id, name, size, mimeType, url }`. The gallery's two reads —
 * `hasAnyCover` and the per-card `imageUrl` — both did
 * `typeof v === 'string'` / `v as string`, so for a spec-correct value the
 * cover area collapsed for the whole gallery and the card emitted
 * `<img src="[object Object]">`. The only values that rendered were the
 * inline `data:` URIs and external links ADR-0104 retired.
 *
 * Both reads now share one `resolveCoverUrl`, which delegates to
 * `readFileValues` from `@object-ui/fields` — the platform's single arbiter
 * of file value shapes. These tests pin all three shapes plus the
 * area-collapse regression.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ObjectGallery } from '../ObjectGallery';
import { SchemaRendererProvider } from '@object-ui/react';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    cover: { type: 'image', label: 'Cover' },
  },
};

const renderGallery = (data: Record<string, unknown>[]) => {
  const dataSource = {
    find: vi.fn().mockResolvedValue(data),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  };
  return render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ObjectGallery
        schema={{
          type: 'object-gallery',
          objectName: 'showcase_task',
          gallery: { titleField: 'name', coverField: 'cover' },
        }}
      />
    </SchemaRendererProvider>,
  );
};

/**
 * The cover image a user actually sees.
 *
 * `GalleryCover` always mounts its wrapper and toggles the `hidden`
 * attribute, so "the cover area collapsed" is not the same DOM fact as "no
 * `<img>` was built" — before the fix the card mounted an `<img>` with a
 * garbage `src` *inside* the hidden wrapper. Filtering on the `hidden`
 * ancestor is what makes these assertions describe the rendered result
 * rather than the component's internal bookkeeping.
 */
const visibleCoverImg = (container: HTMLElement): HTMLImageElement | null =>
  Array.from(container.querySelectorAll('img')).find((el) => !el.closest('[hidden]')) ?? null;

describe('ObjectGallery — coverField value shapes (objectui#3317)', () => {
  it('renders the cover from the expanded read form ({ url }) — the ADR-0104 shape', async () => {
    const { container } = renderGallery([
      {
        id: 't1',
        name: 'Task A',
        cover: {
          id: 'fileAAA111',
          name: 'cover.png',
          size: 2048,
          mimeType: 'image/png',
          url: '/api/v1/storage/files/fileAAA111',
        },
      },
    ]);
    await waitFor(() => expect(screen.getByText('Task A')).toBeInTheDocument());

    const img = await waitFor(() => {
      const found = visibleCoverImg(container);
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe('/api/v1/storage/files/fileAAA111');
    // The old string-only read cast the object straight into `src`.
    expect(img.getAttribute('src')).not.toBe('[object Object]');
  });

  it('renders a legacy bare URL string (still valid during the dual-mode window)', async () => {
    const { container } = renderGallery([
      { id: 't2', name: 'Task B', cover: 'https://cdn.example.com/b.png' },
    ]);
    await waitFor(() => expect(screen.getByText('Task B')).toBeInTheDocument());

    const img = await waitFor(() => {
      const found = visibleCoverImg(container);
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/b.png');
  });

  it('resolves an unexpanded `sys_file` id to the stable endpoint instead of a broken src', async () => {
    // NOTE ON DIRECTION: objectui#3317 suggested treating a bare id as "no
    // cover". That suggestion predates `@object-ui/fields`'s `file-value`
    // module, which already decided this platform-wide: a bare reference
    // resolves to `/api/v1/storage/files/:id`, the stable endpoint that
    // 302-redirects to a freshly-signed URL and is directly usable as an
    // `<img src>`. The issue's actual requirement — never emit a broken
    // `src` — is met strictly better by resolving than by hiding, and
    // forking a narrower rule here would put the gallery at odds with the
    // `image` cell renderer and the edit-form widgets reading the same value.
    const { container } = renderGallery([{ id: 't3', name: 'Task C', cover: 'fileCCC333' }]);
    await waitFor(() => expect(screen.getByText('Task C')).toBeInTheDocument());

    const img = await waitFor(() => {
      const found = visibleCoverImg(container);
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe('/api/v1/storage/files/fileCCC333');
    // The raw opaque token must never reach `src` — that is the broken src.
    expect(img.getAttribute('src')).not.toBe('fileCCC333');
  });

  it('treats a value carrying no resolvable URL as no cover', async () => {
    // An object with neither `url` nor an id resolves to nothing; the cover
    // area collapses rather than mounting an `<img>` with a garbage src.
    const { container } = renderGallery([
      { id: 't4', name: 'Task D', cover: { name: 'orphan.png' } },
      { id: 't5', name: 'Task E', cover: null },
      { id: 't6', name: 'Task F', cover: '' },
    ]);
    await waitFor(() => expect(screen.getByText('Task D')).toBeInTheDocument());

    expect(visibleCoverImg(container)).toBeNull();
    // Nothing anywhere in the gallery may carry the stringified object.
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('keeps the cover area open when covers are expanded objects (hasAnyCover shares the resolver)', async () => {
    // The area-collapse regression in its purest form: every populated cover
    // is an object, so the old `typeof === 'string'` predicate reported
    // "no covers anywhere" and hid the area for the whole gallery — including
    // the records that did have one.
    const { container } = renderGallery([
      { id: 't7', name: 'Task G', cover: null },
      {
        id: 't8',
        name: 'Task H',
        cover: { id: 'fileHHH888', name: 'h.png', mimeType: 'image/png', url: '/api/v1/storage/files/fileHHH888' },
      },
    ]);
    await waitFor(() => expect(screen.getByText('Task H')).toBeInTheDocument());

    const img = await waitFor(() => {
      const found = visibleCoverImg(container);
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe('/api/v1/storage/files/fileHHH888');
    // The card without a cover still renders, sharing the now-open area.
    expect(screen.getByText('Task G')).toBeInTheDocument();
  });

  it('uses the first entry of a `multiple` file field as the cover', async () => {
    const { container } = renderGallery([
      {
        id: 't9',
        name: 'Task I',
        cover: [
          { id: 'fileIII111', name: 'first.png', mimeType: 'image/png', url: '/api/v1/storage/files/fileIII111' },
          { id: 'fileIII222', name: 'second.png', mimeType: 'image/png', url: '/api/v1/storage/files/fileIII222' },
        ],
      },
    ]);
    await waitFor(() => expect(screen.getByText('Task I')).toBeInTheDocument());

    const img = await waitFor(() => {
      const found = visibleCoverImg(container);
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe('/api/v1/storage/files/fileIII111');
  });
});
