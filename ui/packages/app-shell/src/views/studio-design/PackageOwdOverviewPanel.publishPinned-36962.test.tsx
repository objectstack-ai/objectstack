// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36962 — the OWD overview's Save publishes each changed row over
 * the published row its load read, never over one another writer published
 * since.
 *
 * The Save is each changed row's draft and then that object's own publish
 * (objectstack#36511), so it leaves no draft behind, and two admins who open
 * the overview each pass the draft door. The load reads each saved row's
 * layers at the package the publish writes, and the publish is pinned to that
 * read's `overlayVersion` (`If-Match`): the later Save is refused
 * `409 METADATA_CONFLICT` and the author is asked (reload, overwrite, keep
 * editing), as the Studio editors are (objectstack#36726).
 *
 * The other writer is the server double's own move of the live row. The
 * door's refusal is parsed by the REAL `MetadataClient`, so the error the
 * guard reads is production's.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';
import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';

const PACKAGE = 'com.qa.owd';
const L = (key: string) => t(key, 'en-US');
const PUBLIC_READ = L('engine.studio.settings.sharingPublicRead');
const PUBLIC_READ_WRITE = L('engine.studio.settings.sharingPublicReadWrite');
const WAIT = { timeout: 4000 };

type Body = Record<string, unknown>;

interface Publish {
  name: string;
  packageId: string | undefined;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
}

interface Server {
  published: Map<string, Body>;
  versions: Map<string, string>;
  drafts: Map<string, Body>;
  /** A server from before `overlayVersion` was served serves none (the control). */
  servesPublishedVersion: boolean;
  publishes: Publish[];
  resets: string[];
  seq: number;
}

/** The 409 the door answers, run through the real client's error parser. */
async function conflictRefusal(name: string, head: string | null): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `object/${name} has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.publish('object', name).then(
    () => {
      throw new Error('the stub door accepted the publish');
    },
    (e: unknown) => e as MetadataError,
  );
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function newServer(): Server {
  const server: Server = {
    published: new Map(),
    versions: new Map(),
    drafts: new Map(),
    servesPublishedVersion: true,
    publishes: [],
    resets: [],
    seq: 0,
  };
  server.published.set('a_alpha', { name: 'a_alpha', label: 'Alpha', sharingModel: 'private', fields: {} });
  server.versions.set('a_alpha', 'hmac-sha256:alpha0');
  server.published.set('b_beta', { name: 'b_beta', label: 'Beta', sharingModel: 'private', fields: {} });
  server.versions.set('b_beta', 'hmac-sha256:beta0');
  return server;
}

function renderPanel(server: Server): void {
  const client = {
    list: async () => [...server.published.values()].map((b) => ({ name: b.name, label: b.label })),
    listDrafts: async () => [...server.drafts.keys()].map((name) => ({ name })),
    layered: async (_t: string, name: string) => {
      const live = server.published.get(name) ?? null;
      const version = server.servesPublishedVersion
        ? { overlayVersion: live ? (server.versions.get(name) ?? null) : null }
        : {};
      return { code: null, overlay: live && copy(live), effective: live && copy(live), ...version };
    },
    getDraft: async (_t: string, name: string) => {
      const draft = server.drafts.get(name);
      return draft ? { type: 'object', name, item: copy(draft) } : null;
    },
    save: async (_t: string, name: string, body: Body) => {
      server.drafts.set(name, copy(body));
      return { success: true };
    },
    publish: async (_t: string, name: string, opts?: { packageId?: string; ifMatch?: string; ifNoneMatch?: '*' }) => {
      server.publishes.push({ name, packageId: opts?.packageId, ifMatch: opts?.ifMatch, ifNoneMatch: opts?.ifNoneMatch });
      const head = server.published.has(name) ? (server.versions.get(name) ?? null) : null;
      if (opts?.ifMatch !== undefined && opts.ifMatch !== head) throw await conflictRefusal(name, head);
      if (opts?.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(name, head);
      server.seq += 1;
      const version = `hmac-sha256:mine${server.seq}`;
      const draft = server.drafts.get(name);
      if (draft) {
        server.published.set(name, draft);
        server.versions.set(name, version);
      }
      server.drafts.delete(name);
      return { success: true, version };
    },
    reset: async (_t: string, name: string, opts?: { state?: string }) => {
      if (opts?.state === 'draft') {
        server.resets.push(name);
        server.drafts.delete(name);
      }
      return { success: true };
    },
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
  render(
    <StudioSaveHarness locale="en-US">
      <PackageOwdOverviewPanel client={client} packageId={PACKAGE} locale="en-US" />
    </StudioSaveHarness>,
  );
}

/** Another admin publishes the object's sharing model: the live row and its version move. */
function anotherAdminPublishes(server: Server, name: string, sharingModel: string): string {
  server.seq += 1;
  const version = `hmac-sha256:theirs${server.seq}`;
  server.published.set(name, { ...server.published.get(name)!, sharingModel });
  server.versions.set(name, version);
  return version;
}

async function pick(name: string, option: string): Promise<void> {
  await screen.findByTestId(`owd-row-${name}`, undefined, WAIT);
  fireEvent.keyDown(screen.getByTestId(`owd-internal-${name}`), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
  await screen.findByTestId(`owd-dirty-${name}`);
}

const sharingOf = (server: Server, name: string) => server.published.get(name)?.sharingModel;

/** The race: the overview loaded, another admin published Alpha, then this overview's Save. */
async function raceAlpha(server: Server): Promise<string> {
  renderPanel(server);
  await pick('a_alpha', PUBLIC_READ_WRITE);
  const theirs = anotherAdminPublishes(server, 'a_alpha', 'public_read');
  await pressStudioSave({ settle: false });
  await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
  return theirs;
}

let server: Server;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  server = newServer();
});
afterEach(cleanup);

describe('the OWD overview — two Saves over one object are not last-writer-wins (objectstack#36962)', () => {
  it('the later Save is refused at its publish, worded as a live change; keep editing leaves the edit unsaved', async () => {
    await raceAlpha(server);
    expect(server.publishes.map((p) => [p.name, p.packageId, p.ifMatch, p.ifNoneMatch])).toEqual([
      ['a_alpha', PACKAGE, 'hmac-sha256:alpha0', undefined],
    ]);
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('This changed since you opened it');
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('a_alpha');

    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    // Nothing went live: the other admin's value stands, the draft the Save
    // wrote is taken back, and the edit stays on the page, named as not saved.
    expect(await screen.findByText(/Alpha: Not saved:/, undefined, WAIT)).toBeInTheDocument();
    expect(sharingOf(server, 'a_alpha')).toBe('public_read');
    expect(server.resets).toEqual(['a_alpha']);
    expect(server.drafts.size).toBe(0);
    expect(screen.getByTestId('owd-dirty-a_alpha')).toBeInTheDocument();
    expect(screen.getByTestId('owd-internal-a_alpha')).toHaveTextContent(PUBLIC_READ_WRITE);
  });

  it('"reload" reads the other admin\'s value back, and the next Save is pinned to it', async () => {
    const theirs = await raceAlpha(server);
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull(), WAIT);
    expect(screen.getByTestId('owd-internal-a_alpha')).toHaveTextContent(PUBLIC_READ);
    expect(server.drafts.size).toBe(0);

    await pick('a_alpha', PUBLIC_READ_WRITE);
    await pressStudioSave();
    await waitFor(() => expect(sharingOf(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    expect(server.publishes[server.publishes.length - 1]).toMatchObject({ name: 'a_alpha', ifMatch: theirs });
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('"overwrite" asks again, then re-publishes pinned to the refusal\'s currentVersion', async () => {
    const theirs = await raceAlpha(server);
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    const before = server.publishes.length;
    expect(await screen.findByTestId('draft-conflict-overwrite-confirm')).toBeInTheDocument();
    expect(server.publishes.length).toBe(before);
    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(sharingOf(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    expect(server.publishes[server.publishes.length - 1]).toMatchObject({ name: 'a_alpha', ifMatch: theirs });
  });

  it('one row refused among two (objectstack#36511): the other goes live, and the kept edit stays pinned to the read it was made on', async () => {
    renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    await pick('b_beta', PUBLIC_READ);
    anotherAdminPublishes(server, 'a_alpha', 'public_read');
    await pressStudioSave({ settle: false });
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));

    // Beta, after Alpha in the table's order, still went live, pinned to its own read.
    await waitFor(() => expect(sharingOf(server, 'b_beta')).toBe('public_read'), WAIT);
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-b_beta')).toBeNull(), WAIT);
    expect(server.publishes.find((p) => p.name === 'b_beta')).toMatchObject({ ifMatch: 'hmac-sha256:beta0' });
    // Alpha keeps its edit, though the page re-read the table after Beta went live.
    expect(screen.getByTestId('owd-dirty-a_alpha')).toBeInTheDocument();
    expect(sharingOf(server, 'a_alpha')).toBe('public_read');

    // That re-read did not re-pin Alpha's kept edit to the other admin's row: the next Save is asked again.
    const before = server.publishes.length;
    await pressStudioSave({ settle: false });
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    expect(server.publishes.slice(before).map((p) => [p.name, p.ifMatch])).toEqual([['a_alpha', 'hmac-sha256:alpha0']]);
    expect(sharingOf(server, 'a_alpha')).toBe('public_read');
  });

  it('one editor: each Save is pinned to the version the last one left, so it never conflicts with itself', async () => {
    renderPanel(server);
    await pick('a_alpha', PUBLIC_READ);
    await pressStudioSave();
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull(), WAIT);
    const first = server.versions.get('a_alpha');
    await pick('a_alpha', PUBLIC_READ_WRITE);
    await pressStudioSave();
    await waitFor(() => expect(sharingOf(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    expect(server.publishes.map((p) => p.ifMatch)).toEqual(['hmac-sha256:alpha0', first]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('a row the published list does not hold publishes asserting no published row of its name', async () => {
    server.drafts.set('c_gamma', { name: 'c_gamma', label: 'Gamma', sharingModel: 'private', fields: {} });
    renderPanel(server);
    await pick('c_gamma', PUBLIC_READ);
    await pressStudioSave();
    await waitFor(() => expect(sharingOf(server, 'c_gamma')).toBe('public_read'), WAIT);
    expect(server.publishes).toEqual([{ name: 'c_gamma', packageId: PACKAGE, ifMatch: undefined, ifNoneMatch: '*' }]);
  });

  it('control: a server that serves no `overlayVersion` gets an unpinned publish, as before', async () => {
    server.servesPublishedVersion = false;
    renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    anotherAdminPublishes(server, 'a_alpha', 'public_read');
    await pressStudioSave();
    await waitFor(() => expect(sharingOf(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    expect(server.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[undefined, undefined]]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });
});
