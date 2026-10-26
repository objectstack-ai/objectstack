// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25801 — a flat screen collects a file.
 *
 * A `type: 'file'` screen field renders the platform upload widget, the upload
 * goes through the host's `UploadProvider` (the file service), and the run
 * resumes with the uploaded file's id — the one shape the engine admits for a
 * file field, and the one a later node writes into an object's `file` field.
 *
 * The widget is the REAL `FileField`, reached through the dialog's own lazy
 * registry and driven through its real file input; only the upload adapter is
 * the test's, and it holds its promise so the mid-upload window is
 * deterministic. Each refusal leg asserts "no resume left the dialog", with the
 * pass leg beside it asserting the request that did — the defect this guards
 * is a Submit that resumes WITHOUT the file, which "no error" would pass on.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
// Module scope, per AGENTS.md 测试纪律: the file leg reaches `FileField`
// through a `React.lazy` factory inside `@object-ui/fields`.
import '@object-ui/fields';
import { UploadProvider, type UploadResult } from '@object-ui/providers';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';
import { screenResumeValues } from '../ScreenView';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** uuid/nanoid-shaped, so the platform's `isFileIdToken` accepts it. */
const MINTED_ID = 'V1StGXR8_Z5jdHi6B-myT';

const CONTRACT_FIELD = { name: 'contract_file', label: 'Contract', type: 'file', required: true };

const INTAKE: ScreenFlowState = {
  flowName: 'contract_intake',
  runId: 'run-1',
  screen: { nodeId: 'ask', title: 'First version', fields: [CONTRACT_FIELD] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const okResume = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, data: { success: true } }));

/** An upload adapter whose every upload stays in flight until its release is called. */
function heldUploads() {
  const pending: Array<() => void> = [];
  const upload = vi.fn(async (f: File | Blob): Promise<UploadResult> => {
    await new Promise<void>((release) => {
      pending.push(release);
    });
    return {
      url: `/api/v1/storage/files/${MINTED_ID}`,
      name: (f as File).name,
      size: f.size,
      mimeType: f.type,
      meta: { fileId: MINTED_ID },
    };
  });
  return { adapter: { name: 'held', upload }, upload, pending };
}

function setup(state: ScreenFlowState, authFetch: ReturnType<typeof okResume>, adapter = heldUploads().adapter) {
  render(
    <UploadProvider adapter={adapter}>
      <FlowRunner state={state} authFetch={authFetch} baseUrl="" onClose={vi.fn()} onComplete={vi.fn()} />
    </UploadProvider>,
  );
}

/** The inputs the one resume request carried. */
function resumedInputs(authFetch: ReturnType<typeof okResume>): unknown {
  expect(authFetch).toHaveBeenCalledTimes(1);
  return JSON.parse(String(authFetch.mock.calls[0][1]?.body)).inputs;
}

/** The real widget's hidden picker, once its lazy chunk is in (the dialog renders in a portal). */
async function filePicker(): Promise<HTMLInputElement> {
  await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('objectstack#25801 — a `type: \'file\'` screen field is the platform upload widget', () => {
  it('renders the upload widget, not a text input', async () => {
    setup(INTAKE, okResume());
    await filePicker();
    // The plain text input every unknown hint used to fall back to is gone.
    expect(document.getElementById('ff-contract_file')?.tagName).not.toBe('INPUT');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('holds Submit while the upload is in flight, then resumes with the uploaded file\'s id', async () => {
    const authFetch = okResume();
    const { adapter, upload, pending } = heldUploads();
    setup(INTAKE, authFetch, adapter);

    fireEvent.change(await filePicker(), {
      target: { files: [new File(['%PDF'], 'nda.pdf', { type: 'application/pdf' })] },
    });
    // The upload IS in flight, through the host's provider: the adapter holds it.
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(upload).toHaveBeenCalledTimes(1);

    // Submit is held and says why; a click on it resumes nothing.
    const held = await screen.findByRole('button', { name: 'Uploading…' });
    expect(held).toBeDisabled();
    fireEvent.click(held);
    expect(authFetch).not.toHaveBeenCalled();

    pending[0]!();

    const submit = await screen.findByRole('button', { name: 'Submit' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(String(authFetch.mock.calls[0][0])).toBe('/api/v1/automation/contract_intake/runs/run-1/resume');
    expect(resumedInputs(authFetch)).toEqual({ contract_file: MINTED_ID });
  });

  it('refuses a required file field left empty, and resumes nothing', async () => {
    const authFetch = okResume();
    setup(INTAKE, authFetch);
    await filePicker();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(String(toasts.error.mock.calls[0][0])).toContain('Contract');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('posts a prefilled expanded file value as its bare id', async () => {
    const authFetch = okResume();
    const prefilled: ScreenFlowState = {
      ...INTAKE,
      screen: {
        ...INTAKE.screen,
        fields: [{
          ...CONTRACT_FIELD,
          defaultValue: { id: MINTED_ID, name: 'nda.pdf', size: 4, mimeType: 'application/pdf', url: '/x' },
        }],
      },
    };
    setup(prefilled, authFetch);
    await filePicker();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(resumedInputs(authFetch)).toEqual({ contract_file: MINTED_ID });
  });
});

describe('screenResumeValues — the values a flat screen resumes with (objectstack#25801)', () => {
  const screenSpec = {
    nodeId: 'ask',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'contract_file', type: 'file' },
      { name: 'cover', type: 'image' },
    ],
  };

  it('reduces a file field\'s expanded value to its id, and leaves every other field alone', () => {
    const expanded = { id: MINTED_ID, name: 'nda.pdf', url: '/api/v1/storage/files/x' };
    const image = { id: 'img_1', url: '/i.png' };
    expect(screenResumeValues(screenSpec, { title: 'NDA', contract_file: expanded, cover: image }))
      .toEqual({ title: 'NDA', contract_file: MINTED_ID, cover: image });
    // The legacy `file_id` spelling is read the way action params read it.
    expect(screenResumeValues(screenSpec, { contract_file: { file_id: MINTED_ID, name: 'nda.pdf' } }))
      .toEqual({ contract_file: MINTED_ID });
  });

  it('hands back the same object when nothing needs reducing', () => {
    const values = { title: 'NDA', contract_file: MINTED_ID };
    expect(screenResumeValues(screenSpec, values)).toBe(values);
    const empty = { title: 'NDA', contract_file: null };
    expect(screenResumeValues(screenSpec, empty)).toBe(empty);
  });

  it('sends a value carrying no id as it is, so the engine\'s refusal names it', () => {
    const values = { contract_file: 'https://cdn.example.com/nda.pdf' };
    expect(screenResumeValues(screenSpec, values)).toBe(values);
  });
});
