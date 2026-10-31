// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.3 — the `signed` kind of declarative connector instance auth, as
// an author meets it at the publish door (`DeclarativeConnectorEntrySchema`,
// which both authoring doors parse). Every refusal is pinned by its issue
// `code` and `path`; every member has a CONTROL accept, so a refusal that fired
// on everything could not pass.

import { describe, it, expect } from 'vitest';
import {
  DeclarativeConnectorEntrySchema,
  ConnectorInstanceAuthSchema,
  ConnectorInstanceSignedAuthSchema,
  ConnectorSigningSchemeSchema,
} from './connector.zod';

const entry = (auth: unknown, over: Record<string, unknown> = {}) => ({
  name: 'aliyun_ecs',
  label: 'Aliyun ECS',
  type: 'api',
  provider: 'rest',
  providerConfig: { baseUrl: 'https://ecs.cn-shanghai.aliyuncs.com' },
  auth,
  ...over,
});

const aliyun = {
  type: 'signed',
  scheme: 'aliyun-acs3-hmac-sha256',
  keyId: 'YourAccessKeyId',
  credentialRef: 'ALIYUN_ACCESS_KEY_SECRET',
};

const tencent = {
  type: 'signed',
  scheme: 'tencentcloud-tc3-hmac-sha256',
  keyId: 'test-secret-id',
  credentialRef: 'TENCENT_SECRET_KEY',
};

/** The issues of a refused parse, as `code @ path` — what each refusal pins. */
function refused(input: unknown) {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, 'the entry must be refused').toBe(false);
  return result.error!.issues;
}

const located = (input: unknown) => refused(input).map((i) => `${i.code} @ ${i.path.join('.')}`);

describe('ADR-0143 D2.3 — `signed` instance auth', () => {
  it('CONTROL: accepts aliyun-acs3-hmac-sha256 with a key id and the secret as a reference, on rest and openapi', () => {
    expect(DeclarativeConnectorEntrySchema.parse(entry(aliyun)).auth).toEqual(aliyun);
    const openapi = { provider: 'openapi', providerConfig: { spec: './ecs-openapi.json' } };
    expect(DeclarativeConnectorEntrySchema.parse(entry(aliyun, openapi)).auth).toEqual(aliyun);
  });

  it('CONTROL: accepts tencentcloud-tc3-hmac-sha256 with a SecretId and the SecretKey as a reference, on rest and openapi', () => {
    const cvm = { providerConfig: { baseUrl: 'https://cvm.tencentcloudapi.com' } };
    expect(DeclarativeConnectorEntrySchema.parse(entry(tencent, cvm)).auth).toEqual(tencent);
    const openapi = { provider: 'openapi', providerConfig: { spec: './cvm-openapi.json' } };
    expect(DeclarativeConnectorEntrySchema.parse(entry(tencent, openapi)).auth).toEqual(tencent);
  });

  it('refuses an unknown scheme at `auth.scheme`, naming the scheme it got and the ones that ship', () => {
    for (const scheme of ['aws-sigv4', 'wechatpay-rsa2048', 'hmac-sha256-generic', 'alipay-rsa2']) {
      const issues = refused(entry({ ...aliyun, scheme }));
      expect(issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toEqual(['invalid_union @ auth.scheme']);
      expect(issues[0]!.message).toContain(`"${scheme}"`);
      expect(issues[0]!.message).toContain("'aliyun-acs3-hmac-sha256'");
      expect(issues[0]!.message).toContain("'tencentcloud-tc3-hmac-sha256'");
    }
  });

  it('refuses a missing scheme, listing the ones that ship', () => {
    const { scheme: _s, ...noScheme } = aliyun;
    const issues = refused(entry(noScheme));
    expect(issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toEqual(['invalid_union @ auth.scheme']);
    expect(issues[0]!.message).toContain('needs a `scheme`');
  });

  it('refuses each inline-secret spelling by name, pointing at credentialRef, on every scheme', () => {
    for (const shape of [aliyun, tencent]) {
      for (const key of ['secret', 'privateKey', 'secretKey', 'accessKeySecret']) {
        const issues = refused(entry({ ...shape, [key]: 'inline' }));
        expect(issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
          ['unrecognized_keys', 'auth', [key]],
        ]);
        expect(issues[0]!.message).toContain('credentialRef');
      }
    }
  });

  it('refuses an authored signature: the signer computes one per request', () => {
    const issues = refused(entry({ ...aliyun, signature: 'abc' }));
    expect(issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
      ['unrecognized_keys', 'auth', ['signature']],
    ]);
    expect(issues[0]!.message).toContain('computed by the platform for every request');
  });

  it("answers Alibaba Cloud's own word for the key id with `keyId`", () => {
    const { keyId, ...rest } = aliyun;
    const issues = refused(entry({ ...rest, accessKeyId: keyId }));
    const unknown = issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(unknown.message).toContain('keyId');
  });

  it("answers Tencent Cloud's own word for the key id with `keyId`", () => {
    const { keyId, ...rest } = tencent;
    const issues = refused(entry({ ...rest, secretId: keyId }));
    const unknown = issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(unknown.message).toContain('keyId');
  });

  it('requires the key id and the secret reference', () => {
    const { keyId: _k, ...noKeyId } = aliyun;
    expect(located(entry(noKeyId))).toEqual(['invalid_type @ auth.keyId']);
    const { credentialRef: _r, ...noSecret } = aliyun;
    expect(located(entry(noSecret))).toEqual(['invalid_type @ auth.credentialRef']);
  });

  it("refuses `signed` on `provider: 'mcp'` at `auth.type`: an MCP server is never signed per request", () => {
    const mcp = { provider: 'mcp', providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com/mcp' } } };
    const issues = refused(entry(aliyun, mcp));
    expect(issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toEqual(['custom @ auth.type']);
    expect(issues[0]!.message).toContain("`provider: 'openapi'`");
  });

  it('the scheme enum lists exactly the union members, so the closed list cannot drift from the shapes', () => {
    const members = ConnectorInstanceSignedAuthSchema.options.map((o) => o.shape.scheme.value);
    expect([...members].sort()).toEqual([...ConnectorSigningSchemeSchema.options].sort());
  });

  it('is a member of the closed instance-auth union', () => {
    expect(ConnectorInstanceAuthSchema.safeParse(aliyun).success).toBe(true);
    expect(ConnectorInstanceAuthSchema.safeParse(tencent).success).toBe(true);
  });
});
