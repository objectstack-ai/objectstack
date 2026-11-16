/**
 * The hosted refusal and the AI projection, read by their declared shapes
 * (objectstack#34149), and `runSettingsAction` handing the refusal to the view.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiProviderManagedByPlatform, isPlatformManagedRefusal } from './platformManaged';
import { runSettingsAction } from './api';

const MANAGED = {
  success: false,
  error: {
    code: 'RESOURCE_CONFLICT',
    message: 'This environment is cloud-managed: … so its settings are not shown here.',
    details: { namespace: 'storage', managedBy: 'platform' },
  },
};

describe('isPlatformManagedRefusal', () => {
  it('reads 409 + RESOURCE_CONFLICT + details.managedBy platform', () => {
    expect(isPlatformManagedRefusal(409, MANAGED)).toBe(true);
  });

  it('refuses every other shape', () => {
    const withDetails = (details: unknown) => ({ ...MANAGED, error: { ...MANAGED.error, details } });
    expect(isPlatformManagedRefusal(400, MANAGED)).toBe(false);
    expect(isPlatformManagedRefusal(409, { ...MANAGED, error: { ...MANAGED.error, code: 'SETTINGS_LOCKED' } })).toBe(false);
    expect(isPlatformManagedRefusal(409, withDetails({ namespace: 'storage' }))).toBe(false);
    expect(isPlatformManagedRefusal(409, withDetails({ namespace: 'storage', managedBy: 'operator' }))).toBe(false);
    expect(isPlatformManagedRefusal(409, withDetails(undefined))).toBe(false);
    expect(isPlatformManagedRefusal(409, null)).toBe(false);
    expect(isPlatformManagedRefusal(undefined, MANAGED)).toBe(false);
  });
});

describe('aiProviderManagedByPlatform', () => {
  const projected = [{ key: 'title_generation_enabled' }, {}];
  const full = [{ key: 'provider' }, { key: 'title_generation_enabled' }];

  it('needs the hosted flag, the ai namespace and a withheld provider', () => {
    expect(aiProviderManagedByPlatform('ai', projected, { cloudManaged: true })).toBe(true);
    expect(aiProviderManagedByPlatform('ai', full, { cloudManaged: true })).toBe(false);
    expect(aiProviderManagedByPlatform('ai', projected, { cloudManaged: false })).toBe(false);
    expect(aiProviderManagedByPlatform('ai', projected, { cloudManaged: 'true' })).toBe(false);
    expect(aiProviderManagedByPlatform('ai', projected, null)).toBe(false);
    expect(aiProviderManagedByPlatform('mail', projected, { cloudManaged: true })).toBe(false);
  });
});

describe('runSettingsAction and the hosted refusal', () => {
  const fetchMock = vi.fn();
  const answer = (body: unknown, status: number): Response =>
    ({ ok: status < 300, status, statusText: 'Conflict', json: async () => body }) as unknown as Response;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('throws the refusal with its status and raw body, so the view reads it by shape', async () => {
    const body = { ...MANAGED, error: { ...MANAGED.error, details: { namespace: 'ai', managedBy: 'platform', actionId: 'test' } } };
    fetchMock.mockResolvedValue(answer(body, 409));
    const err = await runSettingsAction('ai', 'test').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.payload).toEqual(body);
  });

  it('CONTROL: another 409 stays a reported verdict with the server sentence', async () => {
    fetchMock.mockResolvedValue(
      answer({ success: false, error: { code: 'RESOURCE_CONFLICT', message: 'Busy.', details: { namespace: 'ai' } } }, 409),
    );
    await expect(runSettingsAction('ai', 'test')).resolves.toEqual({ ok: false, message: 'Busy.' });
  });
});
