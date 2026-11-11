/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28289 — Create User left without an email marks the Email input
 * as required, in the user's language.
 *
 * The whole console seam: a real `ActionRunner` with the console runtime's own
 * api and param handlers, the real `ActionParamDialog`, and a real Chinese
 * `I18nProvider`. The action door is the mocked authenticated fetch, answering
 * the body plugin-auth's Create User serves for an empty email (pinned
 * server-side by `request-json-body-refusal.test.ts`) as the action door
 * relays it whole: `400 VALIDATION_FAILED` with `error.fields`, one `required`
 * entry per input that would satisfy it, and an English sentence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionRunner, type ActionResult } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, per AGENTS.md 测试纪律: the dialog's widgets sit behind
// `React.lazy`, and this barrel statically re-exports them.
import '@object-ui/fields';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));
// Only the metadata label lookups are stood in for (no object metadata is
// mounted); translation itself is the real provider's.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
    actionSubmitText: (_o: any, _a: any, fallback: any) => fallback,
    actionCancelText: (_o: any, _a: any, fallback: any) => fallback,
  }),
}));
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

afterEach(() => cleanup());
beforeEach(() => authFetchSpy.mockReset());

/** The declared action, as `sys_user` serves it (the door looks it up by name and target). */
const CREATE_USER = {
  name: 'create_user',
  label: 'Create User',
  type: 'api',
  target: '/api/v1/auth/admin/create-user',
};
/** The params the dialog draws: the labels a Chinese console resolves for them. */
const EMAIL = { name: 'email', label: '邮箱', type: 'email' };
const PHONE = { name: 'phoneNumber', label: '手机号', type: 'text' };
const NAME = { name: 'name', label: '姓名', type: 'text' };

/** The refusal Create User answers for neither an email nor a phone number. */
function requiredRefusal(fields: string[], message: string) {
  return {
    success: false,
    error: {
      code: 'VALIDATION_FAILED',
      message,
      httpStatus: 400,
      fields: fields.map((field) => ({ field, code: 'required', message })),
    },
  };
}

function answer(status: number, body: unknown) {
  authFetchSpy.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function Harness({ onReady }: { onReady: (rt: ReturnType<typeof useConsoleActionRuntime>) => void }) {
  const runtime = useConsoleActionRuntime({
    dataSource: {},
    objects: [{ name: 'sys_user', actions: [CREATE_USER] }] as any[],
    objectName: 'sys_user',
  });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime);
  }
  return <>{runtime.dialogs}</>;
}

/** Mount under Chinese, open Create User with `params`, and press 确认 with nothing typed. */
async function confirmEmpty(params: unknown[]) {
  let runtime!: ReturnType<typeof useConsoleActionRuntime>;
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <Harness onReady={(rt) => { runtime = rt; }} />
    </I18nProvider>,
  );
  const runner = new ActionRunner({});
  runner.setParamCollectionHandler(runtime.paramCollectionHandler);
  runner.setToastHandler(vi.fn());
  runner.registerHandler('api', runtime.apiHandler);
  const settled: { result?: ActionResult } = {};
  await act(async () => {
    void runner.execute({ ...CREATE_USER, params } as any).then((r) => { settled.result = r; });
  });
  const email = await screen.findByLabelText('邮箱');
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
  return { email, settled };
}

describe('objectstack#28289 — Create User marks a required field the server named, in the user\'s language', () => {
  it('an empty email marks the Email input with the Chinese required sentence, not the server\'s English', async () => {
    answer(400, requiredRefusal(['email'], 'Email is required'));
    const { email, settled } = await confirmEmpty([EMAIL, NAME]);

    expect(String(authFetchSpy.mock.calls[0][0]).endsWith('/api/v1/actions/sys_user/create_user')).toBe(true);
    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('姓名')).not.toHaveAttribute('aria-invalid', 'true');
    // Every entry is marked, so the English sentence is not drawn beside it.
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
    expect(screen.queryByText('Email is required')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(settled.result).toBeUndefined();
  });

  it('with phone sign-in on, both the Email and the Phone Number inputs are marked', async () => {
    answer(400, requiredRefusal(['email', 'phoneNumber'], 'Email or phone number is required'));
    const { email } = await confirmEmpty([EMAIL, PHONE, NAME]);

    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(screen.getByText('手机号 为必填项')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('手机号')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
  });

  it('typing into the marked input clears its mark', async () => {
    answer(400, requiredRefusal(['email'], 'Email is required'));
    const { email } = await confirmEmpty([EMAIL, NAME]);
    await screen.findByText('邮箱 为必填项');

    fireEvent.change(email, { target: { value: 'ada@example.com' } });

    expect(screen.queryByText('邮箱 为必填项')).toBeNull();
    expect(email).toHaveAttribute('aria-invalid', 'false');
  });

  it('control: a refusal that names no field keeps the server\'s sentence in the box and marks nothing', async () => {
    answer(400, { success: false, error: { code: 'INVALID_REQUEST', message: 'A valid email is required', httpStatus: 400 } });
    const { email } = await confirmEmpty([EMAIL, NAME]);

    const box = await screen.findByTestId('action-param-refusal');
    expect(box).toHaveTextContent('A valid email is required');
    expect(screen.queryByText('邮箱 为必填项')).toBeNull();
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('control: an entry the dialog cannot mark keeps the box beside the marks it can make', async () => {
    const body = requiredRefusal(['email'], 'Email is required');
    body.error.fields.push({ field: 'tenant', code: 'required', message: 'Email is required' });
    answer(400, body);
    await confirmEmpty([EMAIL, NAME]);

    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(screen.getByTestId('action-param-refusal')).toHaveTextContent('Email is required');
  });

  it('control: a created user closes the dialog', async () => {
    answer(200, { success: true, data: { user: { id: 'u_new' } } });
    const { settled } = await confirmEmpty([EMAIL, NAME]);

    await waitFor(() => expect(settled.result?.success).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

/**
 * objectstack#32185 — Setup's IdP group-mapping actions run through the same
 * seam: a real `ActionRunner`, the console runtime's api and param handlers and
 * the real `ActionParamDialog`. The declared shapes are restated from
 * `sys_idp_group_mapping` (`@objectstack/platform-objects`, whose own pins hold
 * the declarations); the door is the mocked authenticated fetch, answering what
 * plugin-auth's set-group-mapping and delete-group-mapping mounts answer, as
 * the action door relays them whole.
 */
const SET_GROUP_MAPPING = '/api/v1/auth/admin/scim/set-group-mapping';
const MAP_SSO_GROUP = {
  name: 'map_sso_group',
  label: 'Map SSO Group',
  type: 'api',
  method: 'POST',
  target: SET_GROUP_MAPPING,
  refreshAfter: true,
};
const MAP_SSO_PARAMS = [
  { name: 'providerId', label: 'SSO Provider ID', type: 'text', required: true },
  { name: 'groupExternalId', label: 'Group External ID', type: 'text' },
  { name: 'groupDisplayName', label: 'Group Display Name', type: 'text' },
  { name: 'permissionSet', label: 'Permission Set', type: 'text', widget: 'permission-ref', required: true },
];
const DELETE_GROUP_MAPPING = {
  name: 'delete_group_mapping',
  label: 'Delete Mapping',
  type: 'api',
  method: 'POST',
  target: '/api/v1/auth/admin/scim/delete-group-mapping',
  recordIdParam: 'mappingId',
  confirmText: 'Delete this group mapping?',
  refreshAfter: true,
};
const MAPPING_OBJECTS = [{ name: 'sys_idp_group_mapping', actions: [MAP_SSO_GROUP, DELETE_GROUP_MAPPING] }];

/** The save's boundary refusal, as plugin-auth words it for an administrator set. */
const BOUNDARY_SENTENCE =
  'An identity provider group grants only ordinary permission sets inside the organization boundary, never administrator standing; refused: admin_full_access is an administrator permission set.';
/** The save's conflict, naming the old mapping to delete first. */
const CONFLICT_SENTENCE =
  "IdP group mapping 'm_old' already maps this group to 'sales_reader' for SSO provider 'okta' in organization 'org_a', but the provider now belongs to organization 'org_b'. Delete mapping 'm_old' first (POST /admin/scim/delete-group-mapping), then save again.";

function MappingHarness({ onReady, onRefresh }: { onReady: (rt: ReturnType<typeof useConsoleActionRuntime>) => void; onRefresh: () => void }) {
  const runtime = useConsoleActionRuntime({
    dataSource: {},
    objects: MAPPING_OBJECTS as any[],
    objectName: 'sys_idp_group_mapping',
    onRefresh,
  });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime);
  }
  return <>{runtime.dialogs}</>;
}

async function mountMappingRunner() {
  let runtime!: ReturnType<typeof useConsoleActionRuntime>;
  const onRefresh = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MappingHarness onReady={(rt) => { runtime = rt; }} onRefresh={onRefresh} />
    </I18nProvider>,
  );
  const runner = new ActionRunner({});
  runner.setParamCollectionHandler(runtime.paramCollectionHandler);
  runner.setToastHandler(vi.fn());
  runner.registerHandler('api', runtime.apiHandler);
  return { runner, onRefresh };
}

/** Open Map SSO Group, type a provider, a group name and a set, and press 确认. */
async function mapSsoGroup(permissionSet: string) {
  const { runner, onRefresh } = await mountMappingRunner();
  const settled: { result?: ActionResult } = {};
  await act(async () => {
    void runner.execute({ ...MAP_SSO_GROUP, params: MAP_SSO_PARAMS } as any).then((r) => { settled.result = r; });
  });
  fireEvent.change(await screen.findByLabelText(/^SSO Provider ID/), { target: { value: 'okta' } });
  fireEvent.change(screen.getByLabelText(/^Group Display Name/), { target: { value: 'Sales' } });
  // The permission-ref widget is lazy; with no data source to list the catalog it draws its text box.
  fireEvent.change(await screen.findByLabelText(/^Permission Set/), { target: { value: permissionSet } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
  return { settled, onRefresh };
}

describe('objectstack#32185 — Setup maps and unmaps an IdP group through the platform-admin door', () => {
  it('Map SSO Group sends the typed body to the action door; a saved mapping closes the dialog and refreshes the list', async () => {
    answer(200, { success: true, data: { mappingId: 'm_new', created: true, providerId: 'okta', permissionSet: 'sales_reader', organizationId: 'org_a', reprojected: false, reconciledUsers: 0 } });
    const { settled, onRefresh } = await mapSsoGroup('sales_reader');

    const [url, init] = authFetchSpy.mock.calls[0] as [string, { body: string }];
    expect(String(url).endsWith('/api/v1/actions/sys_idp_group_mapping/map_sso_group')).toBe(true);
    const { params } = JSON.parse(init.body) as { params: Record<string, unknown> };
    expect(params).toMatchObject({ providerId: 'okta', groupDisplayName: 'Sales', permissionSet: 'sales_reader' });
    // The source organization is the door's to derive; the click names none.
    expect(params).not.toHaveProperty('organizationId');
    await waitFor(() => expect(settled.result?.success).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('an administrator set is refused with the door\'s boundary sentence, the dialog kept open and nothing refreshed', async () => {
    answer(400, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: BOUNDARY_SENTENCE,
        httpStatus: 400,
        fields: [{ field: 'permissionSet', code: 'rule_violation', message: BOUNDARY_SENTENCE }],
      },
    });
    const { settled, onRefresh } = await mapSsoGroup('admin_full_access');

    expect(await screen.findByTestId('action-param-refusal')).toHaveTextContent(BOUNDARY_SENTENCE);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Permission Set/)).toHaveValue('admin_full_access');
    expect(settled.result).toBeUndefined();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a same-group mapping left in another organization is refused with the door\'s 409 sentence naming it', async () => {
    answer(409, { success: false, error: { code: 'RESOURCE_CONFLICT', message: CONFLICT_SENTENCE, httpStatus: 409 } });
    const { settled, onRefresh } = await mapSsoGroup('sales_reader');

    // The box leads with the refusal's first sentence and keeps the rest — the
    // mapping to delete first — one click behind 更多 (objectui#13332).
    const box = await screen.findByTestId('action-param-refusal');
    expect(box).toHaveTextContent("IdP group mapping 'm_old' already maps this group to 'sales_reader'");
    fireEvent.click(within(box).getByRole('button', { name: '更多' }));
    expect(box).toHaveTextContent("Delete mapping 'm_old' first (POST /admin/scim/delete-group-mapping), then save again.");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(settled.result).toBeUndefined();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('Delete Mapping asks its confirmation, sends the row id to the action door, and refreshes the list', async () => {
    answer(200, { success: true, data: { mappingId: 'm_1', providerId: 'okta', permissionSet: 'sales_reader', deleted: true, reprojected: true, reconciledUsers: 2 } });
    const { runner, onRefresh } = await mountMappingRunner();
    const asked = vi.fn(async () => true);
    runner.setConfirmHandler(asked);

    let result: ActionResult | undefined;
    await act(async () => {
      result = await runner.execute({ ...DELETE_GROUP_MAPPING, params: { _rowRecord: { id: 'm_1' } } } as any);
    });

    expect(asked).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(asked.mock.calls[0])).toContain('Delete this group mapping?');
    const [url, init] = authFetchSpy.mock.calls[0] as [string, { body: string }];
    expect(String(url).endsWith('/api/v1/actions/sys_idp_group_mapping/delete_group_mapping')).toBe(true);
    expect(JSON.parse(init.body)).toMatchObject({ recordId: 'm_1' });
    expect(result?.success).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('control: an unknown mapping answers the door\'s 404 sentence as the delete\'s error, and nothing refreshes', async () => {
    answer(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: "No IdP group mapping 'm_gone' exists", httpStatus: 404 } });
    const { runner, onRefresh } = await mountMappingRunner();
    runner.setConfirmHandler(async () => true);

    let result: ActionResult | undefined;
    await act(async () => {
      result = await runner.execute({ ...DELETE_GROUP_MAPPING, params: { _rowRecord: { id: 'm_gone' } } } as any);
    });

    expect(result?.success).toBe(false);
    expect(String((result?.error as unknown) ?? '')).toContain("No IdP group mapping 'm_gone' exists");
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#32297 — Setup → SSO Providers → Register SSO Provider registers
 * a Microsoft Entra ID provider with its userinfo endpoint named, through the
 * same seam. After #32296 the register bridge (`POST /api/v1/auth/admin/sso/register`,
 * plugin-auth `register-sso-provider.ts`) reads `userInfoEndpoint`,
 * `discoveryEndpoint` and `skipUserInfo` from the flat form body, and an
 * endpoint the registration names is trusted for it. The declared params are
 * restated from `sys_sso_provider.register_sso_provider`
 * (`@objectstack/platform-objects`, whose `platform-objects.test.ts` pin holds
 * them by name, type and order; help texts trimmed to what is asserted). The
 * door is the mocked authenticated fetch, so what is pinned is the request the
 * console sends: every value under the name the bridge reads.
 */
const ENTRA_ISSUER = 'https://login.microsoftonline.com/7d1c0f2e-0000-4a5b-8c6d-tenant000001/v2.0';
const ENTRA_USERINFO = 'https://graph.microsoft.com/oidc/userinfo';
const REGISTER_SSO = {
  name: 'register_sso_provider',
  label: 'Register SSO Provider',
  type: 'api',
  method: 'POST',
  target: '/api/v1/auth/admin/sso/register',
  refreshAfter: true,
};
const REGISTER_SSO_PARAMS = [
  { name: 'providerId', label: 'Provider ID', type: 'text', required: true },
  { name: 'issuer', label: 'Issuer URL', type: 'text', required: true },
  { name: 'domain', label: 'Email Domain', type: 'text', required: true },
  { name: 'clientId', label: 'Client ID', type: 'text', required: true },
  { name: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
  { name: 'discoveryEndpoint', label: 'Discovery URL', type: 'url', required: false },
  {
    name: 'userInfoEndpoint',
    label: 'Userinfo URL',
    type: 'url',
    required: false,
    helpText: 'Optional. OIDC userinfo endpoint URL (https), kept instead of the one the discovery document names. An endpoint named here is trusted for this provider.',
  },
  { name: 'skipUserInfo', label: 'Read Claims From the ID Token Only', type: 'boolean', required: false },
  { name: 'scopes', label: 'Scopes', type: 'text', required: false, placeholder: 'openid email profile' },
  {
    name: 'mapEmail',
    label: 'Map: Email claim',
    type: 'text',
    required: false,
    placeholder: 'email',
    helpText: 'Optional. Claim mapped to email. Defaults to "email". Microsoft Entra ID (issuer on login.microsoftonline.com): users without a mailbox carry no "email" claim, so map "preferred_username" (or "upn") and turn on Read Claims From the ID Token Only.',
  },
  { name: 'mapName', label: 'Map: Name claim', type: 'text', required: false, placeholder: 'name' },
  { name: 'mapGroups', label: 'Map: Groups claim', type: 'text', required: false, placeholder: 'groups' },
];

function SsoHarness({ onReady }: { onReady: (rt: ReturnType<typeof useConsoleActionRuntime>) => void }) {
  const runtime = useConsoleActionRuntime({
    dataSource: {},
    objects: [{ name: 'sys_sso_provider', actions: [REGISTER_SSO] }] as any[],
    objectName: 'sys_sso_provider',
  });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime);
  }
  return <>{runtime.dialogs}</>;
}

/** Open Register SSO Provider under Chinese chrome. */
async function openRegisterSso() {
  let runtime!: ReturnType<typeof useConsoleActionRuntime>;
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <SsoHarness onReady={(rt) => { runtime = rt; }} />
    </I18nProvider>,
  );
  const runner = new ActionRunner({});
  runner.setParamCollectionHandler(runtime.paramCollectionHandler);
  runner.setToastHandler(vi.fn());
  runner.registerHandler('api', runtime.apiHandler);
  const settled: { result?: ActionResult } = {};
  await act(async () => {
    void runner.execute({ ...REGISTER_SSO, params: REGISTER_SSO_PARAMS } as any).then((r) => { settled.result = r; });
  });
  await screen.findByLabelText(/^Provider ID/);
  return settled;
}

/** Type the five required values of an Entra ID registration. */
function typeEntraRequired() {
  const put = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  put(/^Provider ID/, 'acme-entra');
  put(/^Issuer URL/, ENTRA_ISSUER);
  put(/^Email Domain/, 'acme.com');
  put(/^Client ID/, 'client-id');
  put(/^Client Secret/, 'client-secret');
}

function sentRegisterParams(): Record<string, unknown> {
  const [url, init] = authFetchSpy.mock.calls[0] as [string, { body: string }];
  expect(String(url).endsWith('/api/v1/actions/sys_sso_provider/register_sso_provider')).toBe(true);
  return (JSON.parse(init.body) as { params: Record<string, unknown> }).params;
}

describe('objectstack#32297 — Register SSO Provider registers an Entra ID provider with its userinfo endpoint named', () => {
  it('the dialog offers the userinfo URL and the opt-out, and suggests the Entra email claim in words without setting it', async () => {
    await openRegisterSso();

    expect(screen.getByLabelText(/^Userinfo URL/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Discovery URL/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/map "preferred_username" \(or "upn"\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Map: Email claim/)).toHaveValue('');
  });

  it('an Entra-shaped registration sends the userinfo endpoint, the opt-out and the claim under the bridge\'s names', async () => {
    answer(200, { success: true, data: { providerId: 'acme-entra' } });
    const settled = await openRegisterSso();

    typeEntraRequired();
    fireEvent.change(screen.getByLabelText(/^Userinfo URL/), { target: { value: ENTRA_USERINFO } });
    fireEvent.change(screen.getByLabelText(/^Map: Email claim/), { target: { value: 'preferred_username' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    expect(sentRegisterParams()).toMatchObject({
      providerId: 'acme-entra',
      issuer: ENTRA_ISSUER,
      domain: 'acme.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      userInfoEndpoint: ENTRA_USERINFO,
      skipUserInfo: true,
      mapEmail: 'preferred_username',
    });
    await waitFor(() => expect(settled.result?.success).toBe(true));
  });

  it('control: left alone, the opt-out is not sent as on and no email claim is sent for the admin', async () => {
    answer(200, { success: true, data: { providerId: 'acme-entra' } });
    await openRegisterSso();

    typeEntraRequired();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    const params = sentRegisterParams();
    expect(params.skipUserInfo === true || params.skipUserInfo === 'true').toBe(false);
    expect(params.mapEmail ?? '').toBe('');
  });
});
