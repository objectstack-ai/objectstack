/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The settings client reads the declared response envelope (objectui#3366 /
 * framework#3843).
 *
 * What this closes: `settings-routes.ts` moved all five `/api/settings`
 * responses into `{ success, data }` and said what that costs raw `fetch`
 * callers — "must add one hop: `body.data`". This module is a raw `fetch`
 * caller and never took the hop, so on 17.0.0-rc.3 every namespace page handed
 * the ENVELOPE to the view: `Object.entries(payload.values)` on an object with
 * no `values` threw "Cannot convert undefined or null to object" and the whole
 * page went to the error boundary. The hub failed more quietly and worse — its
 * `r.manifests ?? []` turned the same mistake into "no settings are
 * registered", which reads as a plugin bug rather than a client one.
 *
 * The bodies below are the real wire shapes of both generations, not tuned
 * fixtures: the enveloped ones are what a #3843 server sends (the namespace one
 * is quoted from the issue's rc.3 capture), the bare ones are what a server
 * from before it sent. Both are asserted because the console ships as a
 * versioned asset that outlives any single server build — and because a compat
 * branch no test exercises is the branch someone deletes without knowing which
 * server it was carrying.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSettingsNamespace,
  listSettingsManifests,
  runSettingsAction,
  saveSettingsNamespace,
} from './api';

/** A `Response` double — only the three members this client touches. */
function jsonResponse(body: unknown, status = 200, statusText?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText ?? (status === 200 ? 'OK' : 'Bad Request'),
    json: async () => body,
  } as unknown as Response;
}

/** A body that is not JSON at all — `res.json()` rejects. */
function brokenResponse(status = 502, statusText = 'Bad Gateway'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The manifest list, as `service.listManifests` produces it. */
const MANIFESTS = [
  { namespace: 'localization', version: 1, label: 'Localization', specifiers: [] },
  { namespace: 'branding', version: 1, label: 'Branding', specifiers: [] },
];

/** `GET /api/settings/localization` on rc.3, quoted from the issue. */
const NAMESPACE_PAYLOAD = {
  manifest: {
    namespace: 'localization',
    version: 1,
    label: 'Localization',
    specifiers: [{ type: 'select', key: 'timezone', label: 'Timezone' }],
  },
  values: {
    timezone: { value: 'Asia/Shanghai', source: 'env', locked: true, lockedReason: 'locked-by-env' },
  },
};

describe('GET /api/settings — the hub', () => {
  it('unwraps the #3843 envelope, so the list is the manifests and not a fake empty state', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { manifests: MANIFESTS } }));
    const res = await listSettingsManifests();
    // The exact read `SettingsHub` performs — `r.manifests ?? []` is what
    // silently produced "no settings are registered" against the envelope.
    expect(res.manifests).toHaveLength(2);
    expect(res.manifests.map((m) => m.namespace)).toEqual(['localization', 'branding']);
  });

  it('still reads a pre-#3843 server answering the bare body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ manifests: MANIFESTS }));
    expect((await listSettingsManifests()).manifests).toHaveLength(2);
  });

  it('an empty registry is an empty list, not an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { manifests: [] } }));
    expect((await listSettingsManifests()).manifests).toEqual([]);
  });

  it('names a body it cannot read instead of degrading into "nothing is registered"', async () => {
    // A 200 with neither shape — e.g. a third envelope generation, or a proxy
    // answering something else entirely. The hub renders `err.message`.
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await expect(listSettingsManifests()).rejects.toThrow(/Malformed response from GET \/api\/settings.*manifests/);
  });
});

describe('GET /api/settings/:namespace — the page that white-screened', () => {
  it('unwraps the envelope, so the view gets `manifest` + `values`', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: NAMESPACE_PAYLOAD }));
    const payload = await getSettingsNamespace('localization');
    expect(payload.manifest.namespace).toBe('localization');
    // The read that threw: `Object.entries(payload.values)` in SettingsView.
    expect(() => Object.entries(payload.values)).not.toThrow();
    expect(payload.values.timezone.value).toBe('Asia/Shanghai');
    expect(payload.values.timezone.locked).toBe(true);
  });

  it('still reads a pre-#3843 server answering the bare payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(NAMESPACE_PAYLOAD));
    const payload = await getSettingsNamespace('localization');
    expect(payload.values.timezone.source).toBe('env');
  });

  it('encodes the namespace into the URL it asks for', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: NAMESPACE_PAYLOAD }));
    await getSettingsNamespace('data lifecycle');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/settings/data%20lifecycle');
  });

  it('rejects a shape it cannot read by name, rather than letting the view crash on it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await expect(getSettingsNamespace('localization')).rejects.toThrow(
      /Malformed response from GET \/api\/settings\/localization.*`manifest`, `values`/,
    );
  });
});

describe('PUT /api/settings/:namespace — the save read-back', () => {
  const WRITTEN = { timezone: { value: 'UTC', source: 'tenant', locked: false } };

  it('unwraps the envelope, so the saved values merge into the view', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { values: WRITTEN } }));
    const res = await saveSettingsNamespace('localization', { timezone: 'UTC' });
    // `SettingsView` does `{ ...values, ...res.values }`; against the envelope
    // that spread nothing and left the old value on screen under a success toast.
    expect(res.values.timezone.value).toBe('UTC');
  });

  it('still reads a pre-#3843 server answering the bare `{ values }`', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ values: WRITTEN }));
    expect((await saveSettingsNamespace('localization', { timezone: 'UTC' })).values.timezone.source).toBe('tenant');
  });
});

describe('error responses are not unwrapped — `err.payload` keeps the envelope', () => {
  /**
   * A failure envelope carries a boolean `success` but no `data`, which is
   * exactly why the predicate requires BOTH. Unwrapping it would have handed
   * `undefined` to the view's `err.payload?.error` reads and quietly undone
   * objectstack#4224's per-field rendering.
   */
  it('a 400 SETTINGS_VALIDATION keeps `error.details.fields` reachable', async () => {
    const wire = {
      success: false,
      error: {
        code: 'SETTINGS_VALIDATION',
        message: "Settings for 'ai' are incomplete: gateway_model — …",
        details: {
          namespace: 'ai',
          fields: [{ field: 'gateway_model', code: 'invalid_format', message: 'Use provider/model.' }],
        },
      },
    };
    fetchMock.mockResolvedValue(jsonResponse(wire, 400));

    const err = await saveSettingsNamespace('ai', { gateway_model: 'gpt4o' }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.message).toContain('are incomplete');
    // The whole body, envelope and all — this is what `extractFieldErrors` and
    // `lockedKeyOf` are handed via `err.payload.error`.
    expect(err.payload).toEqual(wire);
    expect(err.payload.error.details.fields[0].field).toBe('gateway_model');
  });

  it('a 409 SETTINGS_LOCKED keeps the locked key where `lockedKeyOf` reads it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'SETTINGS_LOCKED',
            message: "Setting 'branding.workspace_name' is locked (locked-by-env).",
            details: { namespace: 'branding', key: 'workspace_name', reason: 'locked-by-env' },
          },
        },
        409,
        'Conflict',
      ),
    );
    const err = await saveSettingsNamespace('branding', { workspace_name: 'X' }).then(
      () => null,
      (e) => e,
    );
    expect(err.status).toBe(409);
    expect(err.payload.error.details.key).toBe('workspace_name');
  });

  it('a 404 UNKNOWN_NAMESPACE surfaces the server sentence, not "Not Found"', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'UNKNOWN_NAMESPACE', message: "Unknown settings namespace 'nope'." } },
        404,
        'Not Found',
      ),
    );
    await expect(getSettingsNamespace('nope')).rejects.toThrow("Unknown settings namespace 'nope'.");
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(brokenResponse());
    const err = await listSettingsManifests().then(
      () => null,
      (e) => e,
    );
    expect(err.message).toBe('Bad Gateway');
    expect(err.status).toBe(502);
  });
});

describe('POST /api/settings/:namespace/:actionId — the action verdict', () => {
  it('reads the message out of the success envelope instead of losing it', async () => {
    // Pre-fix this fell through to `{ ok: res.ok, message: statusText }`: the
    // action ran, and the console said "OK" where the server had said what happened.
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { ok: true, message: 'Test email sent to admin@objectos.ai.', severity: 'success' },
      }),
    );
    const result = await runSettingsAction('email', 'send_test');
    expect(result).toEqual({ ok: true, message: 'Test email sent to admin@objectos.ai.', severity: 'success' });
  });

  it('reads a reported failure out of `error.details`, keeping message and severity', async () => {
    // The route parks the whole SettingsActionResult there precisely so these survive the 400.
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'SETTINGS_ACTION_FAILED',
            message: 'SMTP connection refused',
            details: { ok: false, message: 'SMTP connection refused', severity: 'error', details: { port: 587 } },
          },
        },
        400,
      ),
    );
    const result = await runSettingsAction('email', 'send_test');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('SMTP connection refused');
    expect(result.severity).toBe('error');
    expect(result.details).toEqual({ port: 587 });
  });

  it('still reads a pre-#3843 server answering the bare result on both arms', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, message: 'Sent.' }));
    expect(await runSettingsAction('email', 'send_test')).toEqual({ ok: true, message: 'Sent.' });

    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: 'Refused.' }, 400));
    expect(await runSettingsAction('email', 'send_test')).toEqual({ ok: false, message: 'Refused.' });
  });

  it('a crash carries the server message with ok:false — there is no verdict to read', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Action failed' } },
        500,
        'Internal Server Error',
      ),
    );
    expect(await runSettingsAction('email', 'send_test')).toEqual({ ok: false, message: 'Action failed' });
  });

  it('falls back to the status text when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(brokenResponse(504, 'Gateway Timeout'));
    expect(await runSettingsAction('email', 'send_test')).toEqual({ ok: false, message: 'Gateway Timeout' });
  });
});
