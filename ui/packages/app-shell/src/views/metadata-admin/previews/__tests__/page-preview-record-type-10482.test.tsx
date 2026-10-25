// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10482 — `PagePreview` decides "record page" from `type` alone.
 *
 * `PageSchema` declares `type` as the page kind and refuses `pageType`, a
 * declared alias of it. The runtime resolver (`usePageAssignment`) reads
 * `type` alone since objectui#9674. The designer preview's `isRecordPage` also
 * read `pageType`, so a raw draft from the JSON source editor (it reaches the
 * preview unparsed) that the `/meta` save would refuse still bound a sample
 * record, and the preview and the runtime disagreed on what a record page is.
 *
 * ## What is observed
 *
 * Record binding has two effects this file can see without reading the
 * component's internals: the sample-record reads it issues through the global
 * `fetch` (the object schema, then its records), and the record context it
 * wraps around the rendered page. Every case mounts through the same
 * `mountAndSettle` window. The `type: 'record'` case is the lit control: it
 * proves that window is long enough to see a binding, so the unbound cases
 * are a reading and not an empty wait.
 *
 * The fixtures are put to the spec's own parser too, so the contract face is
 * measured here rather than quoted: the lit fixture parses, and the alias
 * fixture is refused by key (`unrecognized_keys` naming `pageType`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PageSchema } from '@objectstack/spec/ui';

/** Records which object each record context was opened for. */
const { providerSpy } = vi.hoisted(() => ({ providerSpy: vi.fn() }));

// The rendered page body is orthogonal to what this file observes; the record
// context is replaced by a spy that still renders its children.
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: () => <div data-testid="mock-schema-renderer" />,
  RecordContextProvider: ({ children, objectName }: { children?: ReactNode; objectName: string }) => {
    providerSpy(objectName);
    return <>{children}</>;
  },
}));

import { PagePreview } from '../PagePreview';

const OBJECT = 'showcase_account';
const REGIONS = [{ name: 'main', components: [{ type: 'record:details' }] }];

/** Spec-valid record page: `type` is the one discriminator. */
const RECORD_BY_TYPE = { name: 'acct_record', label: 'Account', type: 'record', object: OBJECT, regions: REGIONS };
/** Carries the refused alias only, no `type`. */
const RECORD_BY_ALIAS = { name: 'acct_alias', label: 'Account', pageType: 'record', object: OBJECT, regions: REGIONS };
/** The alias says record, `type` says app. */
const ALIAS_CONTRADICTS_TYPE = { name: 'acct_conflict', label: 'Account', type: 'app', pageType: 'record', object: OBJECT, regions: REGIONS };
/** Second control: a non-record page kind with an object stays unbound. */
const APP_PAGE = { name: 'acct_app', label: 'Account', type: 'app', object: OBJECT, regions: REGIONS };

/** A `fetch` answer carrying only the `json()` this component reads. */
const answer = (body: unknown) => ({ json: async () => body }) as unknown as Response;

/** Serve both reads the record binding makes; record every URL asked for. */
function stubFetch(): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith('/api/v1/meta/object/')) {
      return answer({ item: { name: OBJECT, fields: { name: { type: 'text' } } } });
    }
    if (url.startsWith('/api/v1/data/')) {
      return answer({ records: [{ id: 'r1', name: 'Northwind' }] });
    }
    return answer({});
  }));
  return urls;
}

/**
 * Mount in preview mode and let the record-binding effect's whole chain
 * (schema read, records read, state update) run out. The stubbed reads resolve
 * in microtasks, so one macrotask turn inside `act` drains them.
 */
async function mountAndSettle(draft: Record<string, unknown>) {
  const urls = stubFetch();
  render(<PagePreview type="page" name={String(draft.name)} draft={draft} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The page body rendered, so an unbound reading is not an empty tree.
  expect(screen.getByTestId('mock-schema-renderer')).toBeInTheDocument();
  return {
    urls,
    boundObjects: providerSpy.mock.calls.map(([objectName]) => objectName),
    picker: screen.queryByText('Preview record'),
  };
}

afterEach(() => {
  cleanup();
  providerSpy.mockClear();
  vi.unstubAllGlobals();
});

describe('PagePreview binds a sample record by `type` alone (objectui#10482)', () => {
  it('the fixtures are judged by the spec: `type: record` parses, `pageType` is refused by key', () => {
    expect(PageSchema.safeParse(RECORD_BY_TYPE).success).toBe(true);
    const refused = PageSchema.safeParse(RECORD_BY_ALIAS);
    expect(refused.success).toBe(false);
    const issue = refused.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue && 'keys' in issue ? issue.keys : []).toContain('pageType');
  });

  it('lit control: a `type: record` draft fetches sample records and opens a record context', async () => {
    const { urls, boundObjects, picker } = await mountAndSettle(RECORD_BY_TYPE);
    expect(urls).toContain(`/api/v1/meta/object/${OBJECT}`);
    expect(urls.some((u) => u.startsWith(`/api/v1/data/${OBJECT}`))).toBe(true);
    expect(boundObjects).toContain(OBJECT);
    expect(picker).not.toBeNull();
  });

  it('a draft carrying only the refused `pageType: record` alias is NOT bound', async () => {
    const { urls, boundObjects, picker } = await mountAndSettle(RECORD_BY_ALIAS);
    expect(urls, 'the preview must not fetch sample records for a key PageSchema refuses').toEqual([]);
    expect(boundObjects).toEqual([]);
    expect(picker).toBeNull();
  });

  it('`pageType: record` does not override `type: app`', async () => {
    const { urls, boundObjects, picker } = await mountAndSettle(ALIAS_CONTRADICTS_TYPE);
    expect(urls).toEqual([]);
    expect(boundObjects).toEqual([]);
    expect(picker).toBeNull();
  });

  it('second control: a `type: app` page with an object stays unbound', async () => {
    const { urls, boundObjects, picker } = await mountAndSettle(APP_PAGE);
    expect(urls).toEqual([]);
    expect(boundObjects).toEqual([]);
    expect(picker).toBeNull();
  });
});
