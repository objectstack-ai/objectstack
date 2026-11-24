// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — the OWD overview's rows on the top bar's Save, when not
 * every row goes through.
 *
 * The Save walks the changed rows one after another: each row's draft, then
 * that object's own publish. Two rows are changed in each case, Alpha before
 * Beta (the table's order), against a server double that keeps a published
 * body and a draft per object.
 *
 * - Beta's publish is refused: Alpha is live and no longer "Unsaved"; Beta
 *   keeps its edit, the refusal names Beta and the server's reason, and the
 *   draft this Save wrote for Beta is taken back.
 * - Beta asks the controlled-by-parent prerequisite after Alpha went live: the
 *   page reads Alpha back before it asks, so Alpha is not shown as unsaved,
 *   and the top bar's Cancel never puts Alpha back to a value the server no
 *   longer holds. Confirming saves Beta alone.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';

const PACKAGE = 'com.qa.owd';
const L = (key: string) => t(key, 'en-US');
const PUBLIC_READ = L('engine.studio.settings.sharingPublicRead');
const PRIVATE = L('engine.studio.settings.sharingPrivate');
const CBP = L('engine.studio.settings.sharingControlledByParent');
const PUBLISH_REFUSAL = 'Beta is referenced by a sharing rule that is not saved yet';

type Body = Record<string, unknown>;

function destructive() {
  const message = "Field 'project' is now required but has no default value";
  return Object.assign(new Error(message), {
    status: 409,
    code: 'DESTRUCTIVE_CHANGE',
    issues: [{ kind: 'required_added', path: 'fields.project', message }],
  });
}

interface Server {
  published: Record<string, Body>;
  drafts: Record<string, Body>;
  writes: Array<{ op: 'save' | 'publish' | 'reset'; name: string; force?: boolean; state?: string; packageId?: string }>;
}

/**
 * A server double. `refusePublish` names an object whose publish is refused;
 * `prereq` names one whose unforced save answers 409 DESTRUCTIVE_CHANGE.
 */
function renderPanel({ refusePublish, prereq }: { refusePublish?: string; prereq?: string } = {}): Server {
  const server: Server = {
    published: {
      a_alpha: { name: 'a_alpha', label: 'Alpha', sharingModel: 'private', fields: { name: { type: 'text' } } },
      b_beta: {
        name: 'b_beta',
        label: 'Beta',
        sharingModel: 'private',
        fields: { name: { type: 'text' }, project: { type: 'master_detail', reference: 'a_alpha' } },
      },
    },
    drafts: {},
    writes: [],
  };
  const client = {
    list: async () => Object.values(server.published).map((b) => ({ name: b.name, label: b.label })),
    listDrafts: async () => Object.keys(server.drafts).map((name) => ({ name })),
    layered: async (_t: string, name: string) => ({ effective: server.published[name] ?? {}, code: null }),
    getDraft: async (_t: string, name: string) =>
      server.drafts[name] ? { type: 'object', name, item: server.drafts[name] } : null,
    save: async (_t: string, name: string, body: Body, opts: { force?: boolean }) => {
      server.writes.push({ op: 'save', name, force: opts?.force === true });
      if (name === prereq && !opts?.force) throw destructive();
      server.drafts[name] = JSON.parse(JSON.stringify(body)) as Body;
      return body;
    },
    publish: async (_t: string, name: string, opts: { packageId?: string }) => {
      server.writes.push({ op: 'publish', name, packageId: opts?.packageId });
      if (name === refusePublish) throw Object.assign(new Error(PUBLISH_REFUSAL), { status: 422 });
      server.published[name] = server.drafts[name];
      delete server.drafts[name];
      return {};
    },
    reset: async (_t: string, name: string, opts: { state?: string; packageId?: string }) => {
      server.writes.push({ op: 'reset', name, state: opts?.state, packageId: opts?.packageId });
      delete server.drafts[name];
      return {};
    },
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
  render(
    <StudioSaveHarness locale="en-US">
      <PackageOwdOverviewPanel client={client} packageId={PACKAGE} locale="en-US" />
    </StudioSaveHarness>,
  );
  return server;
}

async function pick(name: string, option: string): Promise<void> {
  await screen.findByTestId(`owd-row-${name}`);
  fireEvent.keyDown(screen.getByTestId(`owd-internal-${name}`), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
  await screen.findByTestId(`owd-dirty-${name}`);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('the OWD overview when not every row goes through (objectstack#36511)', () => {
  it('a refused publish keeps that row unsaved and names it; the other row is live; the draft it wrote is taken back', async () => {
    const server = renderPanel({ refusePublish: 'b_beta' });
    await pick('a_alpha', PUBLIC_READ);
    await pick('b_beta', PUBLIC_READ);
    await pressStudioSave();

    // Alpha: live, and read back as saved.
    await waitFor(() => expect(server.published.a_alpha.sharingModel).toBe('public_read'));
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull());
    expect(screen.getByTestId('owd-internal-a_alpha')).toHaveTextContent(PUBLIC_READ);

    // Beta: not live, its edit still on the page, named with the server's reason.
    expect(server.published.b_beta.sharingModel).toBe('private');
    expect(screen.getByTestId('owd-dirty-b_beta')).toBeInTheDocument();
    expect(screen.getByTestId('owd-internal-b_beta')).toHaveTextContent(PUBLIC_READ);
    expect(await screen.findByText(new RegExp(`Beta: .*${PUBLISH_REFUSAL}`))).toBeInTheDocument();

    // The draft this Save wrote for Beta is taken back, at the package.
    expect(server.writes.filter((w) => w.op === 'reset')).toEqual([
      { op: 'reset', name: 'b_beta', state: 'draft', packageId: PACKAGE },
    ]);
    expect(server.drafts.b_beta).toBeUndefined();
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
  });

  it('the prerequisite asked after an earlier row went live: that row reads back as saved, and Cancel keeps what the server holds', async () => {
    const server = renderPanel({ prereq: 'b_beta' });
    await pick('a_alpha', PUBLIC_READ);
    await pick('b_beta', CBP);
    await pressStudioSave();

    await screen.findByTestId('owd-cbp-prereq');
    expect(server.published.a_alpha.sharingModel).toBe('public_read');
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull());
    expect(screen.getByTestId('owd-dirty-b_beta')).toBeInTheDocument();

    // Closing the confirm, then the top bar's Cancel: Alpha shows the live value.
    fireEvent.click(within(screen.getByTestId('owd-cbp-prereq')).getByRole('button', { name: L('engine.cancel') }));
    await waitFor(() => expect(screen.queryByTestId('owd-cbp-prereq')).toBeNull());
    const writesBeforeCancel = server.writes.length;
    await pressStudioCancel();
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-b_beta')).toBeNull());
    expect(screen.getByTestId('owd-internal-a_alpha')).toHaveTextContent(PUBLIC_READ);
    expect(screen.getByTestId('owd-internal-b_beta')).toHaveTextContent(PRIVATE);
    expect(server.writes.length, 'Cancel sends nothing').toBe(writesBeforeCancel);
  });

  it('confirming the prerequisite saves the remaining row alone, forced, and publishes it', async () => {
    const server = renderPanel({ prereq: 'b_beta' });
    await pick('a_alpha', PUBLIC_READ);
    await pick('b_beta', CBP);
    await pressStudioSave();
    await screen.findByTestId('owd-cbp-prereq');
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull());

    const before = server.writes.length;
    fireEvent.click(screen.getByTestId('owd-cbp-prereq-confirm'));
    await waitFor(() => expect(server.published.b_beta.sharingModel).toBe('controlled_by_parent'));
    expect(server.writes.slice(before)).toEqual([
      { op: 'save', name: 'b_beta', force: true },
      { op: 'publish', name: 'b_beta', packageId: PACKAGE },
    ]);
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-b_beta')).toBeNull());
  });
});
