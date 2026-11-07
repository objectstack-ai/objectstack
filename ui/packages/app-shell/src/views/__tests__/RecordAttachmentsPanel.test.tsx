// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordAttachmentsPanel } from '../RecordAttachmentsPanel';

const ROW = {
  id: 'a1',
  file_id: 'f1',
  file_name: 'report.pdf',
  mime_type: 'application/pdf',
  size: 1024,
  uploaded_by: 'someone-else',
};

function makeDataSource(overrides: Partial<Record<'find' | 'create' | 'delete', any>> = {}) {
  return {
    find: vi.fn(async () => [ROW]),
    create: vi.fn(async () => ({ id: 'a2' })),
    delete: vi.fn(async () => ({})),
    ...overrides,
  };
}

function setup(dataSource: any) {
  render(
    <RecordAttachmentsPanel
      objectName="att_case"
      recordId="r1"
      dataSource={dataSource}
      currentUserId="me"
    />,
  );
}

beforeEach(() => vi.restoreAllMocks());

/**
 * Press a row's delete and answer the confirm dialog it opens (objectui#12248:
 * the delete asks first, through `ActionConfirmDialog`). The delete-path pins
 * below are about what happens AFTER the user confirms.
 */
async function deleteAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Delete attachment' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

describe('RecordAttachmentsPanel — server-denial error mapping (#2755)', () => {
  it('maps ATTACHMENT_DELETE_DENIED to the friendly uploader/editor message', async () => {
    const dataSource = makeDataSource({
      delete: vi.fn(async () => {
        throw new Error(
          '403: Cannot delete attachment a1: only the uploader or a user who can edit the parent record (att_case/r1) may delete it (ATTACHMENT_DELETE_DENIED)',
        );
      }),
    });
    setup(dataSource);
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    // The delete button renders for EVERY row (server is the gate).
    const user = userEvent.setup();
    await deleteAndConfirm(user);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Only the uploader or someone who can edit this record may delete this attachment.',
      ),
    );
    // The optimistic removal must NOT have happened on failure.
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('maps PERMISSION_DENIED (no delete bit in the baseline) to friendly copy', async () => {
    const dataSource = makeDataSource({
      delete: vi.fn(async () => {
        const err: any = new Error("[Security] Access denied: operation 'delete' …");
        err.code = 'PERMISSION_DENIED';
        throw err;
      }),
    });
    setup(dataSource);
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    const user = userEvent.setup();
    await deleteAndConfirm(user);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("You don't have permission to do that."),
    );
  });

  it('successful delete removes the row without an error banner', async () => {
    const dataSource = makeDataSource();
    setup(dataSource);
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    const user = userEvent.setup();
    await deleteAndConfirm(user);

    await waitFor(() => expect(screen.queryByText('report.pdf')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(dataSource.delete).toHaveBeenCalledWith('sys_attachment', 'a1');
  });
});

/**
 * A denied list is not an empty list (#4269).
 *
 * A member denied the parent opened a record holding 2095+ attachments; the
 * `sys_attachment` list read answered 403 and the panel rendered "No
 * attachments yet. Upload a file to get started." — an assertion about the
 * record's contents that the panel had no standing to make, plus an Upload
 * the server would refuse.
 *
 * The 403 arrives as a THROW: the ObjectStack adapter's `find()` degrades only
 * a non-authz 404 to `{ data: [], total: 0 }` and rethrows everything else, so
 * the panel's `catch` is where the two verdicts were being merged.
 */
describe('RecordAttachmentsPanel — denied vs empty list (#4269)', () => {
  /** The decorated shape the adapter rethrows: `httpStatus` + semantic code. */
  function deniedListSource() {
    return makeDataSource({
      find: vi.fn(async () => {
        throw Object.assign(
          new Error(
            "[Security] Access denied: operation 'find' on sys_attachment for user u-42 (2095 rows withheld)",
          ),
          { httpStatus: 403, code: 'PERMISSION_DENIED' },
        );
      }),
    });
  }

  it('THE DEFECT — a 403 list read renders the denied state, never "No attachments yet"', async () => {
    setup(deniedListSource());

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-denied')).toBeInTheDocument(),
    );
    expect(screen.getByText("You don't have access to these attachments.")).toBeInTheDocument();
    // The empty state is reserved for a genuine 200-with-zero-rows.
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
  });

  it('withdraws the Upload affordance under a denied list', async () => {
    setup(deniedListSource());

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-denied')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  // The objectui#2532 failure mode — raw error dump, status code, leaked row
  // counts — was ABSENT before this change and must stay absent: the denied
  // state renders the i18n sentence and nothing sourced from the error.
  it('leaks nothing from the error body — no status code, no server text, no row count', async () => {
    setup(deniedListSource());

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-denied')).toBeInTheDocument(),
    );
    const panel = screen.getByTestId('record-attachments-panel');
    expect(panel.textContent).not.toMatch(/403/);
    expect(panel.textContent).not.toMatch(/2095/);
    expect(panel.textContent).not.toMatch(/u-42/);
    expect(panel.textContent).not.toMatch(/\[Security\]|Access denied: operation/);
    // The denial is a state, not an error banner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('classifies a PERMISSION_DENIED code carrying no numeric status', async () => {
    const dataSource = makeDataSource({
      find: vi.fn(async () => {
        const err: any = new Error('refused');
        err.code = 'PERMISSION_DENIED';
        throw err;
      }),
    });
    setup(dataSource);

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-denied')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  it('a genuine 200-with-zero-rows still renders the empty state AND the Upload button', async () => {
    setup(makeDataSource({ find: vi.fn(async () => []) }));

    await waitFor(() =>
      expect(
        screen.getByText('No attachments yet. Upload a file to get started.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByTestId('record-attachments-denied')).not.toBeInTheDocument();
  });

  // The PIN this file carried for a NON-authz failure ("still the empty
  // state") existed so that changing it would be a DELIBERATE act rather than
  // an accident. #4684 is that deliberate act: the assertion is rewritten
  // below, in `— unavailable vs empty list (#4684)`, where the same
  // `TypeError('Failed to fetch')` now has to reach the unavailable state.
  // What the pin protected — that no one widens this branch silently — is
  // preserved by replacing it with the stricter assertion, not by deleting it.
  it('a NON-authz failure no longer reaches the DENIED state (that split is authz-only)', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    // #4685's denied state is authorization-only and must not creep outward:
    // an outage is not a refusal, and "You don't have access" is the wrong
    // sentence for a user whose network dropped.
    expect(screen.queryByTestId('record-attachments-denied')).not.toBeInTheDocument();
    expect(
      screen.queryByText("You don't have access to these attachments."),
    ).not.toBeInTheDocument();
  });
});

/**
 * An UNLOADED list is not an empty one (#4684).
 *
 * The panel's `catch` split authorization out in #4685 and folded everything
 * else back into `setRows([])`, so a network failure, a 5xx and a 401 all
 * rendered "No attachments yet. Upload a file to get started." — an
 * affirmative claim about the record's contents from a panel that never got an
 * answer, over a record that may hold thousands of files. Same defect class as
 * #4269, one status over.
 *
 * The house rule these tests enforce landed twice before as a bug fix:
 * `HomeActionCenter` (#4235) may only say "You're all caught up" once the inbox
 * has ANSWERED, and an unloadable app list (#4300) is UNKNOWN rather than "no
 * default app".
 */
describe('RecordAttachmentsPanel — unavailable vs empty list (#4684)', () => {
  /** A dead connection: `fetch` rejects before any HTTP status exists. */
  function networkFailureSource() {
    return makeDataSource({
      find: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
  }

  it('THE DEFECT — a network failure renders the unavailable state, never "No attachments yet"', async () => {
    setup(networkFailureSource());

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    expect(
      screen.getByText("We couldn't load the attachments for this record."),
    ).toBeInTheDocument();
    // The empty state is reserved for a genuine 200-with-zero-rows.
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
  });

  it('a 5xx renders the unavailable state', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('Internal Server Error'), { httpStatus: 500 });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
  });

  // A 401 is AUTHENTICATION, not authorization: the session expired, the user
  // is not forbidden. `isPermissionError` deliberately does not claim it (it
  // matches 403 / PERMISSION_DENIED / FORBIDDEN / an RLS denial), so it must
  // land in `unavailable` — where a Retry, after the session refreshes, is
  // exactly the right affordance — and never in the denied state, whose
  // sentence ("You don't have access") would be plainly wrong here.
  it('a 401 / AUTH_REQUIRED renders UNAVAILABLE, not the denied state', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('Authentication required'), {
            httpStatus: 401,
            code: 'AUTH_REQUIRED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('record-attachments-denied')).not.toBeInTheDocument();
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
  });

  it('withdraws the Upload affordance under an unloaded list', async () => {
    setup(networkFailureSource());

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    // Offering an upload against a list the panel could not reach is the same
    // over-assertion as the empty state it replaces.
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  // Same no-leak bar as the denied state (#2532 / #4685): the unavailable
  // state renders the i18n sentence and NOTHING sourced from the error.
  it('leaks nothing from the error — no status code, no server text, no host', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(
            new Error(
              'FetchError: request to https://internal-db.corp.example/api/v1/data/sys_attachment failed (ECONNREFUSED 10.4.7.19:5432)',
            ),
            { httpStatus: 503, code: 'UPSTREAM_UNAVAILABLE' },
          );
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    const panel = screen.getByTestId('record-attachments-panel');
    expect(panel.textContent).not.toMatch(/503/);
    expect(panel.textContent).not.toMatch(/ECONNREFUSED|10\.4\.7\.19/);
    expect(panel.textContent).not.toMatch(/internal-db\.corp\.example/);
    expect(panel.textContent).not.toMatch(/UPSTREAM_UNAVAILABLE|FetchError/);
    // A failed LIST is a state of the panel, not an error banner about
    // something the user did.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The affordance that separates `unavailable` from `denied`: an outage and a
  // lapsed session are both things a second attempt can genuinely fix, whereas
  // retrying a 403 just re-earns the same 403.
  it('offers a retry that re-reads the list and renders it once the read succeeds', async () => {
    const find = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce([ROW]);
    setup(makeDataSource({ find }));

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    expect(find).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());
    expect(find).toHaveBeenCalledTimes(2);
    // Recovery is complete: the unavailable state is gone and the Upload
    // affordance is back, because the panel now has an answer.
    expect(screen.queryByTestId('record-attachments-unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('a retry that fails again stays on the unavailable state', async () => {
    const find = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    setup(makeDataSource({ find }));

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
  });

  // The other three states must keep their own meaning — this card only
  // reassigns the branch that was lying.
  it('a 403 still renders the DENIED state, unchanged by this card', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('refused'), {
            httpStatus: 403,
            code: 'PERMISSION_DENIED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-denied')).toBeInTheDocument(),
    );
    expect(screen.getByText("You don't have access to these attachments.")).toBeInTheDocument();
    expect(screen.queryByTestId('record-attachments-unavailable')).not.toBeInTheDocument();
    // A denial is permanent for this caller: no Retry, unlike `unavailable`.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a genuine 200-with-zero-rows still renders the empty state AND the Upload button', async () => {
    setup(makeDataSource({ find: vi.fn(async () => []) }));

    await waitFor(() =>
      expect(
        screen.getByText('No attachments yet. Upload a file to get started.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByTestId('record-attachments-unavailable')).not.toBeInTheDocument();
  });

  it('a successful read still renders the rows', async () => {
    setup(makeDataSource());

    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());
    expect(screen.queryByTestId('record-attachments-unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText(/No attachments yet/)).not.toBeInTheDocument();
  });
});

/**
 * An api-disabled object is not an outage (#4693).
 *
 * `OBJECT_API_DISABLED` (404, `enable.apiEnabled: false`) and its sibling
 * `OBJECT_API_METHOD_NOT_ALLOWED` (405, the operation is absent from
 * `enable.apiMethods`) are pure functions of the object's metadata — no user,
 * no session, no request body — so every retry of every persona re-fetches
 * the identical refusal. Before this card both landed in `unavailable` and
 * offered a Retry that was guaranteed to change nothing: the same wrong
 * advice ("try again") `ListView`'s error panel already stopped giving for
 * list reads, one surface over. Classified with the shared `classifyLoadError`
 * (`@object-ui/react`, lifted out of `ListView.tsx`'s module scope for this
 * reuse), checked BEFORE the `denied`/`unavailable` split so it cannot be
 * shadowed by either.
 */
describe('RecordAttachmentsPanel — api-unavailable vs denied vs unavailable (#4693)', () => {
  it('renders api-unavailable for a 404 OBJECT_API_DISABLED, with no Retry', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('Object API is disabled'), {
            httpStatus: 404,
            code: 'OBJECT_API_DISABLED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-api-unavailable')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('The attachments list is not available on this object.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('record-attachments-denied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('record-attachments-unavailable')).not.toBeInTheDocument();
  });

  it('renders the same state for the 405 sibling OBJECT_API_METHOD_NOT_ALLOWED', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('Method not allowed'), {
            httpStatus: 405,
            code: 'OBJECT_API_METHOD_NOT_ALLOWED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-api-unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('classifies on the code alone, with no numeric status', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          const err: any = new Error('disabled');
          err.code = 'OBJECT_API_DISABLED';
          throw err;
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-api-unavailable')).toBeInTheDocument(),
    );
  });

  it('withdraws the Upload affordance under api-unavailable', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('disabled'), {
            httpStatus: 404,
            code: 'OBJECT_API_DISABLED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-api-unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  // Same no-leak bar as the other two failure states (#2532).
  it('leaks nothing from the error — no status code, no server text', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('Object API is disabled for att_case'), {
            httpStatus: 404,
            code: 'OBJECT_API_DISABLED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-api-unavailable')).toBeInTheDocument(),
    );
    const panel = screen.getByTestId('record-attachments-panel');
    expect(panel.textContent).not.toMatch(/404/);
    expect(panel.textContent).not.toMatch(/OBJECT_API_DISABLED/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // POSITIVE CONTROL: the sibling `unavailable` state (5xx / network) must
  // keep its Retry — this card narrows exactly one code pair, not the general
  // "read failed" case.
  it('CONTROL: a 500 still renders unavailable WITH a Retry, not api-unavailable', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('Internal Server Error'), { httpStatus: 500 });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-unavailable')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('record-attachments-api-unavailable')).not.toBeInTheDocument();
  });

  // POSITIVE CONTROL: a genuine 403 still reaches `denied`, unaffected by the
  // new fork checked ahead of it.
  it('CONTROL: a 403 still renders denied, not api-unavailable', async () => {
    setup(
      makeDataSource({
        find: vi.fn(async () => {
          throw Object.assign(new Error('refused'), {
            httpStatus: 403,
            code: 'PERMISSION_DENIED',
          });
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-attachments-denied')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('record-attachments-api-unavailable')).not.toBeInTheDocument();
  });
});

describe('RecordAttachmentsPanel — authenticated signed-URL download (#2970)', () => {
  it('fetches /files/:id/url with auth and opens the signed URL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    // The declared envelope the route answers as of objectstack#3689 — the URL
    // moved from the top level down under `data`.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { url: '/api/v1/storage/_local/raw/tok123' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    setup(makeDataSource());
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/v1/storage/files/f1/url');
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/storage/_local/raw/tok123'),
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('maps a 403 ATTACHMENT_DOWNLOAD_DENIED to friendly copy and does not open a tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'ATTACHMENT_DOWNLOAD_DENIED', message: 'You do not have access…' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    setup(makeDataSource());
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "You don't have access to download this attachment.",
      ),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('maps a 401 AUTH_REQUIRED to friendly copy', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication required to download this file' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    setup(makeDataSource());
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Please sign in to download this attachment.'),
    );
  });

  // The console ships independently of the server it talks to, so it must keep
  // reading the PRE-objectstack#3675 body — code as a sibling of `error`, not a
  // field of it. Without this, pointing a new console at an older server turns
  // every gated download into the generic "Download failed (403)".
  it('still maps the legacy top-level `code` shape (older server)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'You do not have access…', code: 'ATTACHMENT_DOWNLOAD_DENIED' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    setup(makeDataSource());
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "You don't have access to download this attachment.",
      ),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  // Same reasoning on the SUCCESS path (objectstack#3689): the route used to
  // answer a bare `{ url }` with no envelope at all. The reader takes both, so
  // whichever repo lands first, downloads keep working — and this pins that
  // tolerance as deliberate rather than incidental.
  it('still opens the legacy bare `{ url }` shape (older server)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: '/api/v1/storage/_local/raw/legacy-tok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    setup(makeDataSource());
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/storage/_local/raw/legacy-tok'),
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * Inside the ObjectStack mobile shell, when it announces `openFile`
 * (objectstack-ai/mobile `docs/HYBRID-SHELL.md`, "Files"): the row tap
 * fetches the signed URL with the Console's session as before, then fetches
 * the BYTES and hands them to the shell's `openFile`. Over the bridge's
 * 8 MiB, a failed byte fetch or a `bad_args` refusal keeps the browser path.
 * ⛔ The signed URL is a credential, so it never crosses the bridge.
 */
describe('RecordAttachmentsPanel — mobile shell openFile', () => {
  const GLOBAL = 'ObjectStackNative';
  const SIGNED = '/api/v1/storage/_local/raw/tok123';

  function installShell(opts: { capabilities?: string[]; refuse?: boolean } = {}) {
    const capabilities = opts.capabilities ?? ['openFile', 'share'];
    const openFile = vi.fn(async (_file: { base64: string; name: string; mime: string }) => {
      if (opts.refuse) throw Object.assign(new Error('Files cross the bridge up to 8 MB'), { code: 'bad_args' });
      return null;
    });
    const host = {
      version: 1,
      platform: 'ios',
      appVersion: '2.2.0',
      capabilities,
      safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
      has: (c: string) => capabilities.includes(c),
      openFile,
      openExternal: vi.fn(async () => null),
      share: vi.fn(async () => null),
      ready: vi.fn(),
      routeChanged: vi.fn(),
    };
    (window as unknown as Record<string, unknown>)[GLOBAL] = host;
    return host;
  }

  /** `/files/:id/url` answers the signed URL; the signed URL answers `bytes`. */
  function mockStorage(bytes: BlobPart = 'hello', type = 'application/pdf', bytesStatus = 200) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/v1/storage/files/f1/url')) {
        return new Response(JSON.stringify({ success: true, data: { url: SIGNED } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith(SIGNED)) return new Response(new Blob([bytes], { type }), { status: bytesStatus });
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  async function tapDownload(rows: unknown[] = [ROW]) {
    setup(makeDataSource({ find: vi.fn(async () => rows) }));
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }));
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[GLOBAL];
  });

  it('hands the fetched bytes to openFile, never the URL, and opens no tab', async () => {
    const host = installShell();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchSpy = mockStorage();
    await tapDownload();

    await waitFor(() => expect(host.openFile).toHaveBeenCalledTimes(1));
    // "hello" in standard padded base64; the bridge file has exactly these keys.
    expect(host.openFile.mock.calls[0][0]).toEqual({ base64: 'aGVsbG8=', name: 'report.pdf', mime: 'application/pdf' });
    expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('/api/v1/storage/files/f1/url'),
      expect.stringContaining(SIGNED),
    ]);
    expect(JSON.stringify(host.openFile.mock.calls)).not.toContain('tok123');
    expect(host.openExternal).not.toHaveBeenCalled();
    expect(host.share).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a row over 8 MiB keeps the browser path without fetching the bytes', async () => {
    const host = installShell();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchSpy = mockStorage();
    await tapDownload([{ ...ROW, size: 8 * 1024 * 1024 + 1 }]);

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(expect.stringContaining(SIGNED), '_blank', 'noopener,noreferrer'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(host.openFile).not.toHaveBeenCalled();
  });

  it('fetched bytes over 8 MiB keep the browser path', async () => {
    const host = installShell();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockStorage(new Uint8Array(8 * 1024 * 1024 + 1));
    await tapDownload([{ ...ROW, size: null }]);

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(expect.stringContaining(SIGNED), '_blank', 'noopener,noreferrer'));
    expect(host.openFile).not.toHaveBeenCalled();
  });

  it('a bad_args refusal keeps the browser path', async () => {
    const host = installShell({ refuse: true });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockStorage();
    await tapDownload();

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(expect.stringContaining(SIGNED), '_blank', 'noopener,noreferrer'));
    expect(host.openFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a failed byte fetch keeps the browser path', async () => {
    const host = installShell();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockStorage('nope', 'text/plain', 403);
    await tapDownload();

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(expect.stringContaining(SIGNED), '_blank', 'noopener,noreferrer'));
    expect(host.openFile).not.toHaveBeenCalled();
  });

  it('CONTROL: an older shell without openFile fetches no bytes and opens the tab as today', async () => {
    const host = installShell({ capabilities: ['share'] });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchSpy = mockStorage();
    await tapDownload();

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(expect.stringContaining(SIGNED), '_blank', 'noopener,noreferrer'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(host.openFile).not.toHaveBeenCalled();
  });
});

/**
 * The upload attaches through the server's attach verb: the presigned upload's
 * own completion carries `attachTo` (`POST /api/v1/storage/upload/complete`),
 * and the server commits the file and writes its `sys_attachment` row as the
 * signed-in user. The panel never creates `sys_attachment` through the generic
 * data door, which refuses a member who may attach but cannot read `sys_file`.
 * Driven through the REAL ObjectStack upload adapter over a stubbed `fetch`.
 */
describe('RecordAttachmentsPanel — upload attaches through the upload’s own completion', () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });

  function stubStorage(complete: () => Response) {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body });
      if (url.endsWith('/api/v1/storage/upload/presigned')) {
        return ok({ uploadUrl: '/api/v1/storage/_local/raw/tok', method: 'PUT', fileId: 'f-new', headers: {} });
      }
      if (url.endsWith('/api/v1/storage/_local/raw/tok')) return ok({ key: 'attachments/f-new.pdf' });
      if (url.endsWith('/api/v1/storage/upload/complete')) return complete();
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    return { spy, calls };
  }

  async function uploadOne() {
    const dataSource = makeDataSource();
    const { container } = render(
      <RecordAttachmentsPanel objectName="att_case" recordId="r1" dataSource={dataSource} currentUserId="me" />,
    );
    await waitFor(() => expect(screen.getByText('report.pdf')).toBeInTheDocument());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.setup().upload(input, new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' }));
    return dataSource;
  }

  afterEach(() => vi.restoreAllMocks());

  it('completes the upload with attachTo naming this record, and creates no sys_attachment through the data door', async () => {
    const { calls } = stubStorage(() => ok({ fileId: 'f-new', name: 'quote.pdf', attachmentId: 'a-new' }));
    const dataSource = await uploadOne();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(2)); // the list re-read after the attach
    const complete = calls.find((c) => c.url.endsWith('/upload/complete'));
    expect(complete).toMatchObject({
      method: 'POST',
      body: { fileId: 'f-new', attachTo: { parentObject: 'att_case', parentId: 'r1' } },
    });
    expect(calls.find((c) => c.url.endsWith('/upload/presigned'))?.body).toMatchObject({ scope: 'attachments' });
    expect(dataSource.create).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('maps the attach verb’s ATTACHMENT_PARENT_ACCESS refusal to the friendly copy', async () => {
    stubStorage(
      () =>
        new Response(
          JSON.stringify({ success: false, error: { code: 'ATTACHMENT_PARENT_ACCESS', message: 'Cannot attach to att_case/r1' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    );
    const dataSource = await uploadOne();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("You don't have access to attach files to this record."),
    );
    expect(dataSource.create).not.toHaveBeenCalled();
  });

  it('a completion that attached nothing is an error, never a silent success', async () => {
    stubStorage(() => ok({ fileId: 'f-new', name: 'quote.pdf' }));
    await uploadOne();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not attach it to this record'));
  });
});
