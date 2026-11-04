// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  API_TRIGGER_SIGNATURE_KEY,
  API_TRIGGER_SIGNATURE_RESERVED_HEADERS,
  ApiTriggerSignatureSchema,
  apiTriggerSignatureRefusals,
  apiTriggerVerifierOf,
} from './api-trigger-signature.zod';
import { FlowSchema } from './flow.zod';

// `config.signature` — an `api` flow's start node declares how a third-party
// sender signs its posts, keyed by `config.secretRef`. These pins hold the
// contract half: the three senders the card names parse whole, the one reader
// answers exactly one verifier per hook, and every refusal lands on the start
// node's `config.signature`. What the verifier must do with a post (the
// constant-time compare, the replay window, the one 401) is the implementer's
// obligation in `contracts/trigger-api-service.ts`, pinned by the server slice.

const DOCUSIGN = {
  signs: 'body',
  header: 'X-DocuSign-Signature-1',
  algorithm: 'hmac-sha256',
  encoding: 'base64',
} as const;

const STRIPE_STYLE = {
  signs: 'timestamp.body',
  header: 'Stripe-Signature',
  algorithm: 'hmac-sha256',
  encoding: 'hex',
  timestampElement: 't',
  digestElement: 'v1',
} as const;

const GITHUB_STYLE = {
  signs: 'body',
  header: 'X-Hub-Signature-256',
  algorithm: 'hmac-sha256',
  encoding: 'hex',
  prefix: 'sha256=',
} as const;

function flow(type: string, config: Record<string, unknown>) {
  return {
    name: 'clm_envelope_status',
    label: 'Envelope status',
    type,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
}

const KEYED = { hookId: 'docusign', secretRef: 'DOCUSIGN_CONNECT_KEY' };

/** The refusals the flow parse raises at `nodes.0.config.signature` and below, by path. */
function refusalsUnderSignature(result: ReturnType<typeof FlowSchema.safeParse>) {
  expect(result.success).toBe(false);
  const issues = result.error!.issues.filter((i) => i.path.join('.').startsWith('nodes.0.config.signature'));
  expect(issues.length).toBeGreaterThan(0);
  for (const issue of issues) expect(issue.code).toBe('custom');
  return issues;
}

const pathsOf = (issues: ReadonlyArray<{ path: PropertyKey[] }>) => issues.map((i) => i.path.join('.'));

describe('config.signature — the three senders the card names parse whole', () => {
  it.each([
    ['DocuSign Connect (base64 HMAC-SHA256 of the raw body)', DOCUSIGN],
    ['Stripe-style t=…,v1=… (hex HMAC-SHA256 of <t>.<raw body>)', STRIPE_STYLE],
    ['GitHub-style sha256=<hex> (a prefix before the digest)', GITHUB_STYLE],
  ])('%s: a type api flow keyed by secretRef parses, the declaration served as written', (_, signature) => {
    const result = FlowSchema.safeParse(flow('api', { ...KEYED, signature }));
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0]!.config).toEqual({ ...KEYED, signature });
  });

  it("a start node triggerType: 'api' binds the hook too, so the declaration is read there", () => {
    expect(
      FlowSchema.safeParse(flow('autolaunched', { triggerType: 'api', secretRef: 'DOCUSIGN_CONNECT_KEY', signature: DOCUSIGN }))
        .success,
    ).toBe(true);
  });

  it('the key is spelled signature', () => {
    expect(API_TRIGGER_SIGNATURE_KEY).toBe('signature');
  });
});

describe('one verifier per hook — apiTriggerVerifierOf decides on the key, never on whether it parses', () => {
  it('no signature: the hook verifies x-objectstack-signature exactly as before, whatever its secret source', () => {
    for (const config of [{ secretRef: 'SRM_HEARTBEAT_SECRET' }, { secret: 'literal' }, {}, undefined, 'not a config']) {
      expect(apiTriggerVerifierOf(config)).toEqual({ kind: 'objectstack-signature' });
    }
  });

  it('a usable declaration REPLACES that check: the reader answers the declared scheme and the key it names', () => {
    expect(apiTriggerVerifierOf({ ...KEYED, signature: DOCUSIGN })).toEqual({
      kind: 'declared',
      signature: DOCUSIGN,
      secretRef: 'DOCUSIGN_CONNECT_KEY',
    });
    expect(apiTriggerVerifierOf({ ...KEYED, signature: STRIPE_STYLE })).toMatchObject({
      kind: 'declared',
      signature: STRIPE_STYLE,
    });
  });

  it('a declaration that is present and unusable is never read as absent, so it cannot fall back to the platform check', () => {
    for (const config of [
      { ...KEYED, signature: { ...DOCUSIGN, encoding: 'base64url' } },
      { ...KEYED, signature: 'X-DocuSign-Signature-1' },
      { ...KEYED, signature: null },
      { signature: DOCUSIGN },
      { secret: 'connect-key', signature: DOCUSIGN },
      { secret: 'connect-key', secretRef: 'DOCUSIGN_CONNECT_KEY', signature: DOCUSIGN },
      { secretRef: 'OS_AUTH_SECRET', signature: DOCUSIGN },
      { ...KEYED, signature: { ...STRIPE_STYLE, digestElement: 't' } },
    ]) {
      expect(apiTriggerVerifierOf(config)).toEqual({ kind: 'unusable' });
    }
  });

  it('is not optional and does not stack: the shape has no key that asks for a second check or a fallback', () => {
    for (const extra of [{ optional: true }, { fallback: 'x-objectstack-signature' }, { also: 'x-objectstack-signature' }]) {
      expect(ApiTriggerSignatureSchema.safeParse({ ...DOCUSIGN, ...extra }).success).toBe(false);
      expect(ApiTriggerSignatureSchema.safeParse({ ...STRIPE_STYLE, ...extra }).success).toBe(false);
    }
  });
});

describe('the replay bound follows what is signed', () => {
  it('a scheme that signs a timestamp must say where it comes from: timestamp.body without a timestamp source is refused', () => {
    const { timestampElement: _t, ...noSource } = STRIPE_STYLE;
    const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: noSource })));
    expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.timestampElement']);
  });

  it('a body-only scheme signs no time, so it cannot name a timestamp source (no replay bound is invented for it)', () => {
    for (const extra of [{ timestampElement: 't' }, { timestampElement: 't', digestElement: 'v1' }]) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...DOCUSIGN, ...extra } })));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toMatch(/signs no time/);
    }
  });

  it('a timestamp.body scheme names its digest element too, distinct from the timestamp, and takes no prefix', () => {
    const { digestElement: _d, ...noDigest } = STRIPE_STYLE;
    expect(pathsOf(refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: noDigest }))))).toEqual([
      'nodes.0.config.signature.digestElement',
    ]);
    expect(
      pathsOf(refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...STRIPE_STYLE, digestElement: 't' } })))),
    ).toEqual(['nodes.0.config.signature.digestElement']);
    expect(
      refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...STRIPE_STYLE, prefix: 'v1=' } }))),
    ).toHaveLength(1);
  });
});

describe('refused at parse, at the start node config.signature', () => {
  it('a verifier with no key reference', () => {
    const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { hookId: 'docusign', signature: DOCUSIGN })));
    expect(pathsOf(issues)).toEqual(['nodes.0.config.signature']);
    expect(issues[0]!.message).toMatch(/names no key/);
  });

  it('a verifier beside a literal secret, the cleared form included: a vendor key is never inline', () => {
    for (const secret of ['connect-key', '']) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { secret, signature: DOCUSIGN })));
      expect(pathsOf(issues)).toEqual(['nodes.0.config.signature']);
      expect(issues[0]!.message).toMatch(/never an inline one/);
    }
  });

  it('an unknown algorithm: HMAC-SHA256 is the one closed value', () => {
    for (const algorithm of ['hmac-sha1', 'HMAC-SHA256', 'sha256', 'hmac-sha512', '', 256, undefined]) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...DOCUSIGN, algorithm } })));
      expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.algorithm']);
    }
  });

  it('an unknown encoding: hex or base64 only', () => {
    for (const encoding of ['base64url', 'HEX', 'binary', 'utf8', '', undefined]) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...DOCUSIGN, encoding } })));
      expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.encoding']);
    }
  });

  it('a signs that is neither form, or none', () => {
    for (const signs of ['timestamp+body', 'raw', 'headers', undefined]) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...DOCUSIGN, signs } })));
      expect(issues).toHaveLength(1);
    }
  });

  it('a header that is not an HTTP header name, or none', () => {
    for (const header of ['', 'X DocuSign Signature', 'X-Signature:', 'X-Sigé', 42, undefined]) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...DOCUSIGN, header } })));
      expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.header']);
    }
  });

  it('a header naming x-objectstack-signature, in any case: the body-only sha256= form stays refused on it (ruling B on #22805)', () => {
    for (const header of ['x-objectstack-signature', 'X-Objectstack-Signature', 'X-OBJECTSTACK-SIGNATURE']) {
      // The platform's own header in its body-only `sha256=` form, declared: what the hook's own check refuses.
      const declared = { ...KEYED, signature: { ...GITHUB_STYLE, header } };
      const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', declared)));
      expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.header']);
      expect(issues[0]!.message).toMatch(/ruling B on #22805/);
      expect(apiTriggerVerifierOf(declared)).toEqual({ kind: 'unusable' });
      const timestamped = refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...STRIPE_STYLE, header } })));
      expect(pathsOf(timestamped)).toEqual(['nodes.0.config.signature.header']);
    }
  });

  it('a header that carries the request credentials, routing or framing, or the idempotency key: a closed list, in any case', () => {
    expect([...API_TRIGGER_SIGNATURE_RESERVED_HEADERS]).toEqual([
      'x-objectstack-signature',
      'authorization',
      'proxy-authorization',
      'cookie',
      'host',
      'content-length',
      'transfer-encoding',
      'x-idempotency-key',
    ]);
    expect(Object.isFrozen(API_TRIGGER_SIGNATURE_RESERVED_HEADERS)).toBe(true);
    for (const name of API_TRIGGER_SIGNATURE_RESERVED_HEADERS.slice(1)) {
      for (const header of [name, name.toUpperCase(), name.replace(/(^|-)([a-z])/g, (_, dash, c) => dash + c.toUpperCase())]) {
        const declared = { ...KEYED, signature: { ...DOCUSIGN, header } };
        const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('api', declared)));
        expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.header']);
        expect(issues[0]!.message).toMatch(/never a sender's signature/);
        expect(apiTriggerVerifierOf(declared)).toEqual({ kind: 'unusable' });
      }
    }
  });

  it('a header whose name only contains a reserved one is a sender header, not reserved', () => {
    for (const header of ['X-Objectstack-Signature-1', 'X-Authorization-Signature', 'Signature', 'X-Cookie-Sig']) {
      expect(FlowSchema.safeParse(flow('api', { ...KEYED, signature: { ...DOCUSIGN, header } })).success).toBe(true);
    }
  });

  it('a prefix with a space or a comma, or a blank one', () => {
    for (const prefix of ['', 'sha256 =', 'a,b']) {
      const issues = refusalsUnderSignature(FlowSchema.safeParse(withPrefix(prefix)));
      expect(pathsOf(issues)).toEqual(['nodes.0.config.signature.prefix']);
    }
  });

  it('a value that is not a declaration object', () => {
    for (const signature of ['X-DocuSign-Signature-1', ['body'], null, 7]) {
      refusalsUnderSignature(FlowSchema.safeParse(flow('api', { ...KEYED, signature })));
    }
  });

  it('a verifier on a flow that binds no api trigger: nothing would read it', () => {
    const issues = refusalsUnderSignature(FlowSchema.safeParse(flow('autolaunched', { ...KEYED, signature: DOCUSIGN })));
    expect(pathsOf(issues)).toEqual(['nodes.0.config.signature']);
    expect(issues[0]!.message).toMatch(/binds no inbound `api` trigger/);
  });

  it('a start node without signature raises nothing here', () => {
    expect(apiTriggerSignatureRefusals(flow('api', { secretRef: 'SRM_HEARTBEAT_SECRET' }))).toEqual([]);
    expect(apiTriggerSignatureRefusals(flow('api', { secret: 'x' }))).toEqual([]);
    expect(apiTriggerSignatureRefusals('not a flow')).toEqual([]);
  });
});

/** A type api flow keyed by secretRef whose GitHub-style declaration carries `prefix`. */
function withPrefix(prefix: unknown) {
  return flow('api', { ...KEYED, signature: { ...GITHUB_STYLE, prefix } });
}
