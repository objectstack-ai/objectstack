import { describe, it, expect } from 'vitest';
import { ConnectorSchema } from '../integration/connector.zod';
import {
  ConnectorAPIKeySchema,
  ConnectorBasicAuthSchema,
  ConnectorBearerAuthSchema,
  ConnectorNoAuthSchema,
  ConnectorAuthConfigSchema,
} from './connector-auth.zod';

describe('ConnectorAPIKeySchema', () => {
  it('should accept valid api-key config with default headerName', () => {
    const result = ConnectorAPIKeySchema.parse({
      type: 'api-key',
      key: 'my-api-key-123',
    });
    expect(result.type).toBe('api-key');
    expect(result.key).toBe('my-api-key-123');
    expect(result.headerName).toBe('X-API-Key');
  });

  it('should accept custom headerName', () => {
    const result = ConnectorAPIKeySchema.parse({
      type: 'api-key',
      key: 'key123',
      headerName: 'Authorization',
    });
    expect(result.headerName).toBe('Authorization');
  });

  it('should accept optional paramName', () => {
    const result = ConnectorAPIKeySchema.parse({
      type: 'api-key',
      key: 'key123',
      paramName: 'api_key',
    });
    expect(result.paramName).toBe('api_key');
  });

  it('should reject missing key', () => {
    expect(() => ConnectorAPIKeySchema.parse({ type: 'api-key' })).toThrow();
  });
});

describe('ConnectorBasicAuthSchema', () => {
  it('should accept valid basic auth', () => {
    const result = ConnectorBasicAuthSchema.parse({
      type: 'basic',
      username: 'admin',
      password: 'secret',
    });
    expect(result.type).toBe('basic');
    expect(result.username).toBe('admin');
    expect(result.password).toBe('secret');
  });

  it('should reject missing username', () => {
    expect(() =>
      ConnectorBasicAuthSchema.parse({ type: 'basic', password: 'secret' }),
    ).toThrow();
  });

  it('should reject missing password', () => {
    expect(() =>
      ConnectorBasicAuthSchema.parse({ type: 'basic', username: 'admin' }),
    ).toThrow();
  });
});

describe('ConnectorBearerAuthSchema', () => {
  it('should accept valid bearer auth', () => {
    const result = ConnectorBearerAuthSchema.parse({
      type: 'bearer',
      token: 'my-bearer-token',
    });
    expect(result.type).toBe('bearer');
    expect(result.token).toBe('my-bearer-token');
  });

  it('should reject missing token', () => {
    expect(() => ConnectorBearerAuthSchema.parse({ type: 'bearer' })).toThrow();
  });
});

describe('ConnectorNoAuthSchema', () => {
  it('should accept valid no-auth config', () => {
    const result = ConnectorNoAuthSchema.parse({ type: 'none' });
    expect(result.type).toBe('none');
  });

  it('should reject wrong type', () => {
    expect(() => ConnectorNoAuthSchema.parse({ type: 'other' })).toThrow();
  });
});

describe('ConnectorAuthConfigSchema', () => {
  it('should accept api-key via discriminated union', () => {
    const result = ConnectorAuthConfigSchema.parse({
      type: 'api-key',
      key: 'key123',
    });
    expect(result.type).toBe('api-key');
  });

  it('should accept basic via discriminated union', () => {
    const result = ConnectorAuthConfigSchema.parse({
      type: 'basic',
      username: 'user',
      password: 'pass',
    });
    expect(result.type).toBe('basic');
  });

  it('should accept bearer via discriminated union', () => {
    const result = ConnectorAuthConfigSchema.parse({
      type: 'bearer',
      token: 'tok',
    });
    expect(result.type).toBe('bearer');
  });

  it('should accept none via discriminated union', () => {
    const result = ConnectorAuthConfigSchema.parse({ type: 'none' });
    expect(result.type).toBe('none');
  });

  it('should reject unknown auth type', () => {
    expect(() => ConnectorAuthConfigSchema.parse({ type: 'custom' })).toThrow();
  });

  it('should reject missing type', () => {
    expect(() => ConnectorAuthConfigSchema.parse({ key: 'value' })).toThrow();
  });
});

// ADR-0143 D7 — the runtime `oauth2` variant (`ConnectorOAuth2Schema`) is
// retired, not redefined: it inlined a client secret and a refresh token and
// no provider read it. Its one remaining reader is an author who still writes
// it, and that author meets the prescription, at `type`, on both carriers.
describe('ConnectorAuthConfigSchema — the retired `oauth2` variant (ADR-0143 D7)', () => {
  const retired = {
    type: 'oauth2',
    authorizationUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'id',
    clientSecret: 'secret',
  };

  it('refuses it at `type` with the prescription naming the instance auth that replaces it', () => {
    const result = ConnectorAuthConfigSchema.safeParse(retired);
    expect(result.success).toBe(false);
    const [issue] = result.error!.issues;
    expect([issue!.code, issue!.path.join('.')]).toEqual(['invalid_union', 'type']);
    expect(issue!.message).toMatch(/oauth2.*was removed in @objectstack\/spec 18 \(ADR-0143 D7\)/s);
    expect(issue!.message).toContain("auth: { type: 'oauth2'");
    expect(issue!.message).toContain('credentialRef');
  });

  it('refuses it on the connector definition too, located at `authentication.type`', () => {
    const result = ConnectorSchema.safeParse({ name: 'crm', label: 'CRM', type: 'saas', authentication: retired });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'authentication.type');
    expect(issue?.code).toBe('invalid_union');
    expect(issue?.message).toContain('ADR-0143 D7');
  });

  it("CONTROL: any other unknown variant keeps zod's own report, not the retirement text", () => {
    const result = ConnectorAuthConfigSchema.safeParse({ type: 'custom' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).not.toContain('ADR-0143');
  });
});
