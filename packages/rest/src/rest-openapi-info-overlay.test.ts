// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20294] The served OpenAPI `info` carries the publisher's identity —
 * ruling B on #20359, ADR-0049 enforce-or-remove (the ENFORCE half).
 *
 * The eight identity members of `api.documentation` — `title`, `description`,
 * `termsOfService`, `contact.{name,url,email}`, `license.{name,url}` — were
 * parsed and copied into `this.config.api` by `normalizeConfig`, and nothing
 * read them back: measured on origin/main fc0db22b with all of them authored,
 * both doors served the bundled `info` unchanged (0 of 8 honoured). Now
 * `registerOpenApiEndpoints` lays them over the artifact's `info`, on BOTH
 * doors — `{apiPath}/openapi.json` and the environment-scoped twin.
 *
 * The four ruled pins, each on both doors:
 *   (1) all eight authored ⇒ the served `info` carries each one, and
 *       `info.version` is still the artifact's — the spec package version;
 *   (2) nothing authored, `documentation: {}`, and each key alone ⇒ `info`
 *       equals the artifact's except the authored member (the #11646
 *       whole-block pin in `rest-openapi-route.test.ts` is kept, unedited, as
 *       the no-config control);
 *   (3) an authored `documentation.version` is refused — at parse in
 *       `packages/spec` (`rest-api-config-dead-keys-retirement.test.ts`) and at
 *       construction here (`rest-api-config-dead-keys-refused.test.ts`);
 *   (4) an authored `license` without `url` serves no `url`.
 *
 * Every case drives the REAL handler of a server with its real route table
 * mounted (`registerRoutes()`), the way `rest-openapi-route.test.ts` does, so
 * what it measures is the served body — not the helper in isolation.
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const SPEC_PACKAGE_VERSION: string = createRequire(import.meta.url)('@objectstack/spec/package.json').version;

function makeServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
  } as any;
}

function makeProtocol() {
  return {
    getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: [] })),
  } as any;
}

/** Both doors mounted: the environment-scoped twin exists only under project scoping. */
function makeRest(api: Record<string, unknown>) {
  const rest = new RestServer(
    makeServer(),
    makeProtocol(),
    { api: { version: 'v1', enableProjectScoping: true, projectResolution: 'auto', ...api } } as any,
  );
  rest.registerRoutes();
  return rest;
}

const DOORS = ['/api/v1', '/api/v1/environments/:environmentId'] as const;

/** Drive one door's registered `GET {base}/openapi.json` handler and read the body. */
async function serveFrom(rest: RestServer, base: string) {
  const entry = (rest as any).routeManager.get('GET', `${base}/openapi.json`);
  expect(entry, `the ${base}/openapi.json door must be mounted`).toBeDefined();
  let status = 200;
  let body: any;
  const res: any = {
    status: (c: number) => { status = c; return res; },
    json: (b: any) => { body = b; },
    setHeader: () => {},
    send: () => {},
  };
  await entry.handler(
    { headers: { host: 'example.test' }, params: { environmentId: 'env_1' }, path: `${base}/openapi.json` },
    res,
  );
  expect(status).toBe(200);
  return body;
}

/** The artifact's own `info`, as the server's loader holds it, plus both served bodies. */
async function serveBoth(api: Record<string, unknown>) {
  const rest = makeRest(api);
  const artifact = await (rest as any).loadOpenApiSpec();
  expect(artifact?.info, 'the bundled artifact must be loadable for these pins to mean anything').toBeTruthy();
  const before = JSON.stringify(artifact.info);
  const bodies = [] as any[];
  for (const door of DOORS) bodies.push(await serveFrom(rest, door));
  return { rest, artifact, before, bodies };
}

const ALL_EIGHT = {
  title: 'Acme Orders API',
  description: 'Orders, invoices and shipments for Acme. Release 2.3.0.',
  termsOfService: 'https://acme.test/terms',
  contact: { name: 'Acme API Team', url: 'https://acme.test/support', email: 'api@acme.test' },
  license: { name: 'Proprietary', url: 'https://acme.test/license' },
};

describe('[#20294] (1) all eight identity members authored — both doors carry them', () => {
  it('each authored member is served, and `info.version` is still the spec package version', async () => {
    const { artifact, before, bodies } = await serveBoth({ documentation: ALL_EIGHT });

    // Anti-vacuity: every authored value differs from the artifact's, so a
    // served value equal to the authored one cannot be the artifact's.
    for (const key of ['title', 'description', 'termsOfService', 'contact', 'license'] as const) {
      expect(artifact.info[key], `the artifact's ${key} must differ from the authored one`).not.toEqual(ALL_EIGHT[key]);
    }

    for (const [i, body] of bodies.entries()) {
      const door = DOORS[i];
      expect(body.info.title, door).toBe('Acme Orders API');
      expect(body.info.description, door).toBe(ALL_EIGHT.description);
      expect(body.info.termsOfService, door).toBe('https://acme.test/terms');
      expect(body.info.contact, door).toEqual(ALL_EIGHT.contact);
      expect(body.info.license, door).toEqual(ALL_EIGHT.license);
      // The one member no publisher signs: the protocol version (#11646).
      expect(body.info.version, door).toBe(artifact.info.version);
      expect(body.info.version, `${door}: info.version is the spec package version`).toBe(SPEC_PACKAGE_VERSION);
      // Nothing beyond the overlay: the artifact's `info` keys plus the one it lacks.
      expect(Object.keys(body.info).sort(), door).toEqual(
        [...new Set([...Object.keys(artifact.info), 'termsOfService'])].sort(),
      );
    }

    // The overlay is a NEW object: the cached artifact's `info` is unchanged.
    expect(JSON.stringify(artifact.info), 'serving an overlay must not write into the cached artifact').toBe(before);
    expect(bodies[0].info).not.toBe(artifact.info);
  });

  it('`api.version` and the runtime version still never reach `info.version`, with an overlay in play', async () => {
    const SENTINEL = '9.9.9-openapi-info-overlay-sentinel';
    const old = process.env.OS_RUNTIME_VERSION;
    process.env.OS_RUNTIME_VERSION = SENTINEL;
    try {
      const rest = makeRest({ version: 'v9', documentation: ALL_EIGHT });
      const artifact = await (rest as any).loadOpenApiSpec();
      for (const door of ['/api/v9', '/api/v9/environments/:environmentId']) {
        const body = await serveFrom(rest, door);
        // Positive control: the overlay did take effect on this server.
        expect(body.info.title, door).toBe('Acme Orders API');
        expect(body.info.version, door).toBe(artifact.info.version);
        expect(body.info.version, door).not.toBe('v9');
        expect(JSON.stringify(body.info), door).not.toContain(SENTINEL);
      }
    } finally {
      if (old === undefined) delete process.env.OS_RUNTIME_VERSION;
      else process.env.OS_RUNTIME_VERSION = old;
    }
  });
});

describe('[#20294] (2) nothing authored serves the artifact\'s `info`; one key alone moves only that key', () => {
  for (const [label, api] of [
    ['no `documentation` block', {}],
    ['`documentation: {}`', { documentation: {} }],
  ] as const) {
    it(`${label} ⇒ \`info\` is byte-identical to the artifact's, on both doors`, async () => {
      const { artifact, bodies } = await serveBoth(api);
      for (const [i, body] of bodies.entries()) {
        expect(JSON.stringify(body.info), DOORS[i]).toBe(JSON.stringify(artifact.info));
      }
    });
  }

  const ONE_KEY: Array<[string, unknown]> = [
    ['title', 'Acme Orders API'],
    ['description', 'Orders for Acme.'],
    ['termsOfService', 'https://acme.test/terms'],
    ['contact', { name: 'Acme API Team', url: 'https://acme.test/support', email: 'api@acme.test' }],
    ['license', { name: 'Proprietary', url: 'https://acme.test/license' }],
  ];
  for (const [key, value] of ONE_KEY) {
    it(`\`${key}\` alone ⇒ \`info\` equals the artifact's except \`${key}\`, on both doors`, async () => {
      const { artifact, bodies } = await serveBoth({ documentation: { [key]: value } });
      for (const [i, body] of bodies.entries()) {
        expect(body.info, DOORS[i]).toEqual({ ...artifact.info, [key]: value });
      }
    });
  }
});

describe('[#20294] `contact` / `license` replace the bundled object WHOLE — never member by member', () => {
  it('(4) a `license` without `url` serves no `url` — not the bundled Apache-2.0 one', async () => {
    const { artifact, bodies } = await serveBoth({ documentation: { license: { name: 'MIT' } } });
    // Positive control: the artifact really carries a licence URL to inherit.
    expect(artifact.info.license.url, 'the artifact must carry a license url for this pin to bite').toBeTruthy();
    for (const [i, body] of bodies.entries()) {
      expect(body.info.license, DOORS[i]).toEqual({ name: 'MIT' });
      expect(body.info.license, DOORS[i]).not.toHaveProperty('url');
    }
  });

  it('a partial `contact` serves only the authored members — ObjectStack\'s name and URL are not kept', async () => {
    const { artifact, bodies } = await serveBoth({ documentation: { contact: { email: 'api@acme.test' } } });
    expect(artifact.info.contact.name, 'the artifact must carry a contact name for this pin to bite').toBeTruthy();
    for (const [i, body] of bodies.entries()) {
      expect(body.info.contact, DOORS[i]).toEqual({ email: 'api@acme.test' });
    }
  });
});
