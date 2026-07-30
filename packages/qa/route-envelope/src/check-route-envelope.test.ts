// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The guard's own guard.
 *
 * Six route modules delegate their envelope conformance to `checkRouteEnvelope`
 * (#3843), so a false negative here is a false negative everywhere at once —
 * strictly worse than the three hand-rolled copies it replaces, which at least
 * failed independently. The cases below therefore cover both directions: a
 * sound module produces no findings, and each retired dialect produces exactly
 * the finding that names it.
 *
 * The stripping cases are not decoration. The regex pair these scans used to
 * open with ate `//` inside string literals, so a module with a URL in it had
 * the rest of that line — `.json(` calls included — deleted before counting.
 */

import { describe, it, expect } from 'vitest';
import { checkRouteEnvelope } from './check-route-envelope.js';
import { stripNonCode } from './strip-non-code.js';

/** A module in the declared envelope: one builder per half, nothing else. */
const SOUND = `
function sendError(res, status, code, message) {
  res.status(status).json({ success: false, error: { code, message } });
}
function sendOk(res, data) {
  res.json({ success: true, data });
}
export function register(http, svc) {
  http.get('/things', async (req, res) => {
    try {
      sendOk(res, { things: await svc.list() });
    } catch (err) {
      sendError(res, 500, 'INTERNAL', String(err));
    }
  });
}
`;

describe('checkRouteEnvelope — a sound module', () => {
  it('produces no findings', () => {
    expect(checkRouteEnvelope({ source: SOUND, module: 'sound.ts' })).toEqual([]);
  });

  it('stays sound as routes are added — the count tracks builders, not routes', () => {
    const manyRoutes = SOUND + `
      export function more(http, svc) {
        http.get('/a', async (_q, res) => sendOk(res, { a: 1 }));
        http.get('/b', async (_q, res) => sendOk(res, { b: 2 }));
        http.get('/c', async (_q, res) => sendError(res, 404, 'NOPE', 'gone'));
      }
    `;
    expect(checkRouteEnvelope({ source: manyRoutes, module: 'many.ts' })).toEqual([]);
  });

  it('ignores the envelope shapes quoted in its own prose', () => {
    // Every converted module documents the dialect it left behind. A doc
    // comment is not a code path — this is why the scan strips comments first.
    const documented = `
      /**
       * These routes used to emit a bare \`{ error: 'not_found' }\`, and one
       * answered \`{ ok: true, key }\` — a private second word for success.
       */
      // res.status(404).json({ error: 'not_found' });
      ${SOUND}
    `;
    expect(checkRouteEnvelope({ source: documented, module: 'documented.ts' })).toEqual([]);
  });
});

describe('checkRouteEnvelope — the retired dialects', () => {
  it('flags `{ error: "<string>" }` — the pre-#3675 shape', () => {
    const source = `
      const unavailable = (res) => res.status(503).json({ error: 'datasource_admin_unavailable' });
    `;
    const rules = checkRouteEnvelope({ source, module: 'admin-routes.ts' }).map((f) => f.rule);
    expect(rules).toContain('string-error-body');
    expect(rules).toContain('bare-error-body');
  });

  it('flags a route that hand-rolls a body instead of calling the helper', () => {
    const source = SOUND + `
      http.get('/rogue', async (_q, res) => { res.json({ rogue: true }); });
    `;
    const finding = checkRouteEnvelope({ source, module: 'rogue.ts' }).find(
      (f) => f.rule === 'unenveloped-json-call',
    );
    expect(finding).toBeDefined();
    expect(finding!.actual).toBe(3);
    expect(finding!.expected).toBe(2);
  });

  it('flags a missing envelope half as firmly as an extra one', () => {
    // A module that only ever answers errors, declared as if it had both.
    const source = `
      function sendError(res, status, code, message) {
        res.status(status).json({ success: false, error: { code, message } });
      }
    `;
    const rules = checkRouteEnvelope({ source, module: 'half.ts' }).map((f) => f.rule);
    expect(rules).toContain('unenveloped-json-call');
    expect(rules).toContain('success-builder-count');
  });

  it('accepts a module that legitimately declares only one half', () => {
    const source = `
      function sendError(res, status, code, message) {
        res.status(status).json({ success: false, error: { code, message } });
      }
    `;
    expect(
      checkRouteEnvelope({ source, module: 'errors-only.ts', jsonCallSites: 1, successBuilders: 0 }),
    ).toEqual([]);
  });

  it('flags two places building the same envelope half', () => {
    const source = SOUND.replace(
      'export function register',
      `function sendOkAgain(res, data) { return { success: true, data }; }
       export function register`,
    );
    const finding = checkRouteEnvelope({ source, module: 'twice.ts' }).find(
      (f) => f.rule === 'success-builder-count',
    );
    expect(finding).toBeDefined();
    expect(finding!.actual).toBe(2);
  });

  it('flags a literal `ok: true` as a private second word for success', () => {
    const source = SOUND + `
      http.put('/raw', async (_q, res) => { sendOk(res, { ok: true, key: 'k' }); });
    `;
    const finding = checkRouteEnvelope({ source, module: 'raw.ts' }).find(
      (f) => f.rule === 'private-success-word',
    );
    expect(finding).toBeDefined();
    expect(finding!.matches).toEqual(['ok: true']);
  });

  it('leaves a COMPUTED `ok` alone — a domain verdict is not an envelope flag', () => {
    // `POST /datasources/:name/external/validate` reports whether every
    // federated object validates. That verdict shares a name with the flag
    // #3689 retired and is not the same thing.
    const source = SOUND + `
      http.post('/validate', async (_q, res) => {
        sendOk(res, { ok: results.every((r) => r.ok), results });
      });
    `;
    expect(checkRouteEnvelope({ source, module: 'validate.ts' })).toEqual([]);
  });

  it('names the module in every finding, so a failure says where', () => {
    const source = `res.status(400).json({ error: 'bad' });`;
    const findings = checkRouteEnvelope({ source, module: 'package-routes.ts' });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.where).toBe('package-routes.ts');
  });
});

describe('stripNonCode', () => {
  it('does not truncate a line at a `//` inside a string — the old regex bug', () => {
    // The hand-rolled scans used `.replace(/\\/\\/[^\\n]*/g, '')`, which turned
    // this line into `const base = 'http:` and deleted the `.json(` after it.
    const source = `const base = 'http://local'; res.json({ success: true, data });`;
    const code = stripNonCode(source);
    expect(code).toContain('.json(');
    expect(checkRouteEnvelope({ source, module: 'url.ts', jsonCallSites: 1, errorBuilders: 0 })).toEqual([]);
  });

  it('empties literal bodies but keeps their delimiters', () => {
    expect(stripNonCode(`x = 'not_found';`)).toBe(`x = '';`);
    expect(stripNonCode('x = `a${b}c`;')).toBe('x = ``;');
  });

  it('removes both comment forms', () => {
    expect(stripNonCode('a; // trailing\nb;')).toBe('a;  \nb;');
    expect(stripNonCode('a; /* block\nspanning */ b;')).toBe('a;   b;');
  });

  it('drops a regex body without unbalancing the scan', () => {
    // A pattern containing a quote would otherwise open a phantom string and
    // swallow the remainder of the file.
    const source = `const q = /['"]/g; res.json({ success: true, data });`;
    const code = stripNonCode(source);
    expect(code).toContain('.json(');
    expect(checkRouteEnvelope({ source, module: 'regex.ts', jsonCallSites: 1, errorBuilders: 0 })).toEqual([]);
  });

  it('reads a `/` after a value as division, not a regex', () => {
    const source = `const pct = done / total; res.json({ success: true, data });`;
    expect(stripNonCode(source)).toContain('done / total');
  });
});
