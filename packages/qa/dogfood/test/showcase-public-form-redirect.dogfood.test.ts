// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22079] The path an author writes as a public form's `sharing.publicLink`
// answers, on a real showcase boot with the Console mounted.
//
// The showcase ships `showcase_inquiry.contact` with `publicLink:
// '/forms/contact-us'`. The Console serves that form to an anonymous visitor at
// `/_console/f/contact-us`; the path as authored answered the transport's
// unmatched-request 404. The console static plugin now redirects it, and only
// when the anonymous form door (`GET /api/v1/forms/:slug`) serves the slug to
// the same request. Pinned here:
//
//   - an anonymous `GET /forms/contact-us` answers 302 to `/_console/f/contact-us`,
//     that page is the Console bundle, the door it reads serves the form, and
//     the form accepts a submission that lands;
//   - a `prefill_` query on the authored link (the page seeds fields from it)
//     arrives on the redirect's `Location` unchanged;
//   - a disabled form, a non-anonymous form and an unknown slug each answer
//     exactly the unmatched-request 404 an unrouted path gets (compared byte for
//     byte against a path nothing mounts, on the same boot), and the form comes
//     back as a redirect when it is republished;
//   - the signed-in console route `/_console/forms/<name>` is the Console bundle
//     as before, with or without a session (control);
//   - on a WALLED posture, where the door does not offer the published form
//     because it cannot take an anonymous submission there, the redirect does
//     not fire either: it follows the door, not a copy of the door's switches.
//
// The Console's built bundle is not part of this suite's build, so the plugin
// is pointed at a temporary `dist/` holding an `index.html`, which is all the
// plugin needs to mount. The plugin is imported as SOURCE by relative path,
// like the other package-internal reads in this suite, so the verdict is about
// this checkout and not about the last build of `@objectstack/cli`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { createConsoleStaticPlugin } from '../../../cli/src/utils/console.js';

const SLUG = 'contact-us';
const AUTHORED = `/forms/${SLUG}`;
const PAGE = `/_console/f/${SLUG}`;
const VIEW = '/meta/view/showcase_inquiry.contact';
const SYS = { isSystem: true } as const;
const BUNDLE_MARKER = 'console-bundle-22079';

interface Answer {
  status: number;
  location: string | null;
  body: string;
}

const answerOf = async (res: Response): Promise<Answer> => ({
  status: res.status,
  location: res.headers.get('location'),
  body: await res.text(),
});

let consoleRoot: string;
let distPath: string;

beforeAll(() => {
  consoleRoot = mkdtempSync(join(tmpdir(), 'os-dogfood-console-'));
  distPath = join(consoleRoot, 'dist');
  mkdirSync(distPath);
  writeFileSync(join(distPath, 'index.html'), `<!doctype html><html><head></head><body>${BUNDLE_MARKER}</body></html>`);
});

afterAll(() => {
  rmSync(consoleRoot, { recursive: true, force: true });
});

const boot = (extra: { multiTenant?: 'posture-only' } = {}): Promise<VerifyStack> =>
  bootStack(showcaseStack, {
    ...extra,
    security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }),
    extraPlugins: [createConsoleStaticPlugin(distPath)],
  });

describe('showcase: the authored public form path redirects to the console form page', () => {
  let stack: VerifyStack;
  let admin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let published: Record<string, any>;
  /** What an unrouted path answers on this boot: "today's 404". */
  let unrouted: Answer;

  /** Save the form env-wide with these `sharing` keys replaced. */
  const saveSharing = async (patch: Record<string, unknown>) => {
    const body = structuredClone(published);
    Object.assign(body.config.sharing, patch);
    const res = await stack.apiAs(admin, 'PUT', VIEW, body);
    expect(res.status, await res.clone().text()).toBe(200);
  };

  beforeAll(async () => {
    stack = await boot();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const res = await stack.apiAs(admin, 'GET', VIEW);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item?: Record<string, any> };
    const item = (json.item ?? json) as Record<string, any>;
    published = Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));
    expect(published.config?.sharing).toMatchObject({ enabled: true, allowAnonymous: true, publicLink: AUTHORED });
    unrouted = await answerOf(await stack.raw('/no-route-mounted-here-22079'));
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: an unrouted path answers the transport\'s unmatched-request 404', () => {
    expect(unrouted.status).toBe(404);
    expect(JSON.parse(unrouted.body)).toEqual({
      success: false,
      error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
    });
  });

  it('an anonymous GET of the authored path redirects, the page loads, and the form accepts a submission', async () => {
    const redirect = await answerOf(await stack.raw(AUTHORED));
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe(PAGE);

    const page = await stack.raw(redirect.location!);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain(BUNDLE_MARKER);

    // What the page reads and posts: the anonymous form doors.
    const spec = await stack.api(`/forms/${SLUG}`);
    expect(spec.status).toBe(200);
    expect(((await spec.json()) as { object: string }).object).toBe('showcase_inquiry');

    const marker = 'redirect_probe_submission';
    const submit = await stack.api(`/forms/${SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: marker, email: 'probe@example.com', message: 'probe' }),
    });
    expect(submit.status, await submit.clone().text()).toBe(201);
    const landed = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    expect(landed).toHaveLength(1);
  });

  it('a prefill_ query on the authored link arrives on the page it redirects to', async () => {
    // The page seeds a field from `?prefill_<field>=`; `company` is one of the
    // fields the form declares, so this is a link an author would publish.
    const spec = await stack.api(`/forms/${SLUG}`);
    const fields = Object.keys(((await spec.json()) as { objectSchema: { fields: Record<string, unknown> } }).objectSchema.fields);
    expect(fields).toContain('company');

    const query = '?prefill_company=Analytical%20Engines&utm_source=website';
    const redirect = await answerOf(await stack.raw(`${AUTHORED}${query}`));
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe(`${PAGE}${query}`);

    const page = await stack.raw(redirect.location!);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(BUNDLE_MARKER);
  });

  it('an unknown slug answers the unmatched-request 404, byte for byte', async () => {
    expect(await answerOf(await stack.raw('/forms/no-such-form'))).toEqual(unrouted);
  });

  it('a disabled form answers the unmatched-request 404, and redirects again once republished', async () => {
    await saveSharing({ enabled: false });
    try {
      expect((await stack.api(`/forms/${SLUG}`)).status, 'the door no longer serves it').toBe(404);
      expect(await answerOf(await stack.raw(AUTHORED))).toEqual(unrouted);
    } finally {
      await saveSharing({ enabled: true });
    }
    const again = await answerOf(await stack.raw(AUTHORED));
    expect([again.status, again.location]).toEqual([302, PAGE]);
  });

  it('a non-anonymous form answers the unmatched-request 404, and redirects again once republished', async () => {
    await saveSharing({ allowAnonymous: false });
    try {
      expect((await stack.api(`/forms/${SLUG}`)).status, 'the door no longer serves it').toBe(404);
      expect(await answerOf(await stack.raw(AUTHORED))).toEqual(unrouted);
    } finally {
      await saveSharing({ allowAnonymous: true });
    }
    const again = await answerOf(await stack.raw(AUTHORED));
    expect([again.status, again.location]).toEqual([302, PAGE]);
  });

  it('control: the signed-in console route /_console/forms/<name> is the console bundle, with or without a session', async () => {
    const sessions: Array<Record<string, string>> = [{}, { authorization: `Bearer ${admin}` }];
    for (const headers of sessions) {
      const res = await answerOf(await stack.raw('/_console/forms/showcase_inquiry.contact', { headers }));
      expect(res.status).toBe(200);
      expect(res.location).toBeNull();
      expect(res.body).toContain(BUNDLE_MARKER);
    }
  });
});

describe('showcase, walled posture: the redirect follows the door, which does not offer the form', () => {
  let stack: VerifyStack;
  let unrouted: Answer;

  beforeAll(async () => {
    stack = await boot({ multiTenant: 'posture-only' });
    unrouted = await answerOf(await stack.raw('/no-route-mounted-here-22079'));
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: the posture is walled and the published form is not offered by the door', async () => {
    expect(stack.tenancy().posture).toBe('isolated');
    const door = await stack.api(`/forms/${SLUG}`);
    expect(door.status).toBe(404);
    expect(((await door.json()) as { code?: string }).code).toBe('FORM_NOT_FOUND');
  });

  it('the authored path answers the unmatched-request 404, not a redirect', async () => {
    expect(unrouted.status).toBe(404);
    expect(await answerOf(await stack.raw(AUTHORED))).toEqual(unrouted);
  });
});
