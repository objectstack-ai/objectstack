// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10424] A metadata-store OUTAGE must not be reported as an absent
 * declaration.
 *
 * ## The premise these tests were written against, measured before the fix
 *
 * On `origin/main` (f094214b3, with #10401 landed) the two inputs below —
 * an object that is genuinely not declared, and a metadata store that cannot
 * answer — produced BYTE-IDENTICAL output:
 *
 *   message: "[Security] Access denied: the security posture of object 'task'
 *             could not be resolved for operation 'find' — neither the live
 *             schema nor the metadata service returned a declaration for it,
 *             so access fails closed. Check that the object is declared and
 *             published on this runtime. …"
 *   log:     "[security] object security posture unresolvable for operation
 *             'find' on object 'task' (user u1) — denying request
 *             (fail-closed, #3545)"
 *
 * …even with a metadata service that DID implement `getDiagnosed` and DID
 * report `degraded: true`. The verdict was computed and discarded (#5840).
 * "Check that the object is declared" is right for the first input and sends
 * an operator to re-check a perfectly good declaration during the second.
 *
 * ## What is and is NOT under test
 *
 * The DENY is not moving and these tests pin that it does not: all three causes
 * refuse, fail-closed, with the same `PermissionDeniedError` /
 * `PERMISSION_DENIED` / 403 envelope (#3545). The accept side is pinned too,
 * because the tempting implementation — swapping the resolving `metadata.get`
 * for `getDiagnosed` — would make an object's resolvability depend on an
 * OPTIONAL member, and that is an externally observable accept/reject change.
 *
 * The third pin is the one that carries the most weight: a service that does
 * NOT implement `getDiagnosed` must report `'unknown'`, never
 * `'metadata_unavailable'`. Without it, an implementation that always claims an
 * outage passes the first two.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import {
  unresolvedPostureRemedy,
  unresolvedPostureDenialMessage,
  unresolvedPostureExplainDetail,
  unresolvedPostureLogLine,
  type UnresolvedPostureCause,
} from './unresolved-posture.js';
import type { PermissionSet } from '@objectstack/spec/security';

/** Plain member: blanket wildcard grant, no superuser bits, no capabilities. */
const memberSet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as any;

const RESOLVABLE_SCHEMA: any = {
  name: 'task',
  fields: Object.fromEntries(
    ['id', 'organization_id', 'owner_id', 'name'].map((f) => [f, { name: f }]),
  ),
};

interface HarnessOpts {
  /** What the live ObjectQL schema answers. `undefined` ⇒ unresolvable there. */
  schema?: any;
  /** The resolving read. Default: answers `undefined` (genuinely absent). */
  metadataGet?: (type: string, name: string) => Promise<any>;
  /**
   * The OPTIONAL diagnosed read. OMITTED ⇒ the service does not implement the
   * capability at all, which is the third pin.
   */
  getDiagnosed?: (type: string, name: string) => Promise<any>;
  /** What the `sys_metadata` draft probe finds. Default: no draft row. */
  draftRow?: any;
}

const boot = async (opts: HarnessOpts) => {
  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: () => opts.schema,
    findOne: vi.fn(async () => opts.draftRow ?? null),
  };
  const metadata: Record<string, any> = {
    get: opts.metadataGet ?? (async () => undefined),
    list: async () => [memberSet],
  };
  // Assigned CONDITIONALLY — the `typeof … !== 'function'` probe in
  // `probeMetadataOutage` is only exercised when the key is truly absent.
  if (opts.getDiagnosed) metadata.getDiagnosed = opts.getDiagnosed;

  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const logged: string[] = [];
  const ctx: any = {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((m: string) => { logged.push(String(m)); }),
    },
    registerService: vi.fn(),
    getService: (n: string) => {
      if (!(n in services)) throw new Error(`service not registered: ${n}`);
      return services[n];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  return {
    logged,
    run: async () => {
      const opCtx: any = {
        object: 'task',
        operation: 'find',
        ast: { where: undefined },
        context: { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] },
      };
      await middleware(opCtx, async () => {});
      return opCtx;
    },
  };
};

/** Drive one request to its refusal and return the whole observable envelope. */
const refusalOf = async (opts: HarnessOpts) => {
  const h = await boot(opts);
  let err: any;
  try {
    await h.run();
    throw new Error('expected the middleware to refuse, but it allowed the operation');
  } catch (e: any) {
    err = e;
  }
  return {
    name: err?.name,
    code: err?.code,
    statusCode: err?.statusCode,
    details: err?.details,
    message: String(err?.message),
    log: h.logged.join('\n'),
  };
};

/** The store answers `undefined` and honestly reports the read as healthy. */
const ABSENT: HarnessOpts = {
  schema: undefined,
  metadataGet: async () => undefined,
  getDiagnosed: async () => ({ data: undefined, degraded: false, errors: [] }),
};

/** The store is down: the resolving read throws AND `degraded: true` is reported. */
const OUTAGE: HarnessOpts = {
  schema: undefined,
  metadataGet: async () => { throw new Error('metadata store unavailable: ECONNREFUSED'); },
  getDiagnosed: async () => ({
    data: undefined,
    degraded: true,
    errors: ['loader "db" failed: ECONNREFUSED'],
  }),
};

/** A service predating #5840: no `getDiagnosed` member at all. */
const NO_DIAGNOSED: HarnessOpts = {
  schema: undefined,
  metadataGet: async () => undefined,
};

const expectedMessage = (cause: UnresolvedPostureCause) =>
  unresolvedPostureDenialMessage('task', 'find', cause);
const expectedLog = (cause: UnresolvedPostureCause) =>
  unresolvedPostureLogLine('task', 'find', 'u1', cause);

describe('[#10424] the three-way split of an unresolved posture', () => {
  it('ABSENT declaration → the pre-existing "check that the object is declared" wording', async () => {
    const r = await refusalOf(ABSENT);
    expect(r.message).toBe(expectedMessage('unknown'));
    expect(r.log).toBe(expectedLog('unknown'));
    expect(r.message).toContain('Check that the object is declared and published on this runtime.');
    // It must not have acquired the outage claim.
    expect(r.message).not.toContain('DEGRADED');
    expect(r.log).not.toContain('OUTAGE');
  });

  it('metadata-store OUTAGE → the store wording, NOT the absent-declaration advice', async () => {
    const r = await refusalOf(OUTAGE);
    expect(r.message).toBe(expectedMessage('metadata_unavailable'));
    expect(r.log).toBe(expectedLog('metadata_unavailable'));
    expect(r.message).toContain('the metadata service reported its own read as DEGRADED');
    expect(r.message).toContain('Check the metadata store');
    // The wrong remedy — the entire point of the card — is gone.
    expect(r.message).not.toContain('Check that the object is declared and published on this runtime.');
    expect(r.message).not.toContain('neither the live schema nor the metadata service returned a declaration');
    // …and the operator-facing line is grep-ably an incident.
    expect(r.log).toContain('DEGRADED read');
    expect(r.log).toContain('metadata-store OUTAGE');
  });

  it('service WITHOUT `getDiagnosed` → `unknown`, never a manufactured outage', async () => {
    // The pin that kills an implementation which simply always reports an
    // outage: reporting "I don't know" as "the store is down" is new false
    // information, in the opposite direction from the defect being fixed.
    const r = await refusalOf(NO_DIAGNOSED);
    expect(r.message).toBe(expectedMessage('unknown'));
    expect(r.log).toBe(expectedLog('unknown'));
    expect(r.message).not.toContain('DEGRADED');
    expect(r.message).not.toContain('Check the metadata store');
    expect(r.log).not.toContain('OUTAGE');
  });

  it('the pre-fix COLLAPSE is gone: absent and outage no longer say the same thing', async () => {
    const absent = await refusalOf(ABSENT);
    const outage = await refusalOf(OUTAGE);
    expect(outage.message).not.toBe(absent.message);
    expect(outage.log).not.toBe(absent.log);
  });
});

describe('[#10424] fail-safe: the absence of a verdict is never published as a verdict', () => {
  it('`getDiagnosed` that THROWS → `unknown` (a failed probe is not an outage report)', async () => {
    const r = await refusalOf({
      ...NO_DIAGNOSED,
      getDiagnosed: async () => { throw new Error('probe blew up'); },
    });
    expect(r.message).toBe(expectedMessage('unknown'));
  });

  it('`degraded` that is not the boolean `true` → `unknown`', async () => {
    for (const degraded of ['true', 1, {}, null, undefined]) {
      const r = await refusalOf({
        ...NO_DIAGNOSED,
        getDiagnosed: async () => ({ data: undefined, degraded, errors: [] }),
      });
      expect(r.message).toBe(expectedMessage('unknown'));
    }
  });

  it('`getDiagnosed` that resolves to nothing at all → `unknown`', async () => {
    const r = await refusalOf({ ...NO_DIAGNOSED, getDiagnosed: async () => undefined });
    expect(r.message).toBe(expectedMessage('unknown'));
  });
});

describe('[#10424] precedence: a degraded read outranks the draft probe', () => {
  it('outage + a visible DRAFT row → `metadata_unavailable`, not `unpublished_draft`', async () => {
    // "A draft exists but no published one" has a second half the outage made
    // unknowable — the store is exactly what could not tell us. Asserting it
    // would state an unsupportable fact, the same error the card is about.
    const r = await refusalOf({ ...OUTAGE, draftRow: { type: 'object', name: 'task', state: 'draft' } });
    expect(r.message).toBe(expectedMessage('metadata_unavailable'));
    expect(r.message).not.toContain('is not published');
  });

  it('healthy store + a visible DRAFT row → `unpublished_draft` is still reached (#10401 intact)', async () => {
    const r = await refusalOf({ ...ABSENT, draftRow: { type: 'object', name: 'task', state: 'draft' } });
    expect(r.message).toBe(expectedMessage('unpublished_draft'));
    expect(r.message).toContain('is not published');
  });
});

describe('[#3545] the refusal direction is unchanged — pinned separately from the wording', () => {
  const cases: Array<[string, HarnessOpts]> = [
    ['absent declaration', ABSENT],
    ['metadata-store outage', OUTAGE],
    ['service without getDiagnosed', NO_DIAGNOSED],
  ];

  for (const [label, opts] of cases) {
    it(`${label} → denies fail-closed with the unchanged 403 envelope`, async () => {
      const r = await refusalOf(opts);
      expect(r.name).toBe('PermissionDeniedError');
      expect(r.code).toBe('PERMISSION_DENIED');
      expect(r.statusCode).toBe(403);
      expect(r.details).toMatchObject({ object: 'task', operation: 'find' });
      expect(r.message.startsWith('[Security] Access denied:')).toBe(true);
    });
  }

  it('a degraded read never resolves to a GRANT, even on a private object', async () => {
    const r = await refusalOf({
      ...OUTAGE,
      metadataGet: async () => { throw new Error('down'); },
    });
    expect(r.code).toBe('PERMISSION_DENIED');
  });
});

describe('[#10424] the ACCEPT side does not move — the resolving read is untouched', () => {
  it('a schema that resolves is still allowed when the service has no `getDiagnosed`', async () => {
    const h = await boot({ schema: RESOLVABLE_SCHEMA });
    await expect(h.run()).resolves.toBeTruthy();
  });

  it('a schema that resolves is still allowed when `getDiagnosed` THROWS', async () => {
    // If the implementation had swapped the resolving `metadata.get` for
    // `getDiagnosed`, this object would now be REFUSED — an externally
    // observable accept/reject change this card must not make.
    const h = await boot({
      schema: RESOLVABLE_SCHEMA,
      getDiagnosed: async () => { throw new Error('optional member is broken'); },
    });
    await expect(h.run()).resolves.toBeTruthy();
  });

  it('an object resolvable only via `metadata.get` is still allowed', async () => {
    const h = await boot({
      schema: undefined,
      metadataGet: async () => RESOLVABLE_SCHEMA,
      getDiagnosed: async () => { throw new Error('optional member is broken'); },
    });
    await expect(h.run()).resolves.toBeTruthy();
  });

  it('a degraded read that STILL returns the declaration resolves normally', async () => {
    // `degraded` is about completeness, not about the datum in hand. When the
    // posture resolves, the cause path is never reached at all.
    const h = await boot({
      schema: undefined,
      metadataGet: async () => RESOLVABLE_SCHEMA,
      getDiagnosed: async () => ({ data: RESOLVABLE_SCHEMA, degraded: true, errors: ['one loader down'] }),
    });
    await expect(h.run()).resolves.toBeTruthy();
  });
});

describe('[#10424] the wording module states three distinct things', () => {
  const causes: UnresolvedPostureCause[] = ['unpublished_draft', 'metadata_unavailable', 'unknown'];

  it('every surface differs pairwise across all three causes', () => {
    for (const render of [
      (c: UnresolvedPostureCause) => unresolvedPostureRemedy(c),
      (c: UnresolvedPostureCause) => unresolvedPostureDenialMessage('task', 'find', c),
      (c: UnresolvedPostureCause) => unresolvedPostureExplainDetail('task', c),
      (c: UnresolvedPostureCause) => unresolvedPostureLogLine('task', 'find', 'u1', c),
    ]) {
      const rendered = causes.map(render);
      expect(new Set(rendered).size).toBe(causes.length);
    }
  });

  it('the outage sentences point at the STORE and disclaim permissions as the lever', () => {
    const remedy = unresolvedPostureRemedy('metadata_unavailable');
    expect(remedy).toContain('Check the metadata store');
    expect(remedy).toContain('Do NOT change the declaration');
    expect(remedy).toContain('NOT a permissions problem');
    expect(unresolvedPostureExplainDetail('task', 'metadata_unavailable')).toContain('OUTAGE');
    expect(unresolvedPostureExplainDetail('task', 'metadata_unavailable')).toContain('#3545');
  });

  it('the outage denial keeps the pinned opening clause verbatim', () => {
    // Substring-compatible with the pre-#10401 sentence, so anything matching
    // on it keeps matching; only what follows the em dash is new.
    const opening = "the security posture of object 'task' could not be resolved for operation 'find'";
    expect(unresolvedPostureDenialMessage('task', 'find', 'metadata_unavailable')).toContain(opening);
    expect(unresolvedPostureDenialMessage('task', 'find', 'unknown')).toContain(opening);
  });

  it('every surface reports the deny as fail-closed regardless of cause', () => {
    for (const c of causes) {
      expect(unresolvedPostureDenialMessage('task', 'find', c)).toContain('[Security] Access denied:');
      expect(unresolvedPostureExplainDetail('task', c)).toContain('fails CLOSED');
      expect(unresolvedPostureLogLine('task', 'find', 'u1', c)).toContain('fail-closed, #3545');
    }
  });
});
