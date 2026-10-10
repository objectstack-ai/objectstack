// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import { isAuthGateAllowlisted, evaluateAuthGate, normalizeAuthGate } from './auth-gate';

describe('auth-gate (ADR-0069 session gate)', () => {
  describe('isAuthGateAllowlisted', () => {
    it('allows auth + remediation + health paths (both REST and dispatcher shapes)', () => {
      for (const p of [
        '/api/v1/auth/change-password',
        '/api/v1/auth/two-factor/enable',
        '/api/v1/auth/sign-out',
        '/auth/sign-out',
        '/api/v1/health',
        '/api/v1/discovery',
        '/api/v1/me/apps',
        '/api/v1/auth/me/localization',
      ]) {
        expect(isAuthGateAllowlisted(p)).toBe(true);
      }
    });
    it('blocks data / meta / settings paths', () => {
      for (const p of ['/api/v1/data/sys_user', '/api/v1/meta/object/foo', '/api/settings/auth', '/api/v1/ai/chat']) {
        expect(isAuthGateAllowlisted(p)).toBe(false);
      }
    });
    it('strips query and trailing slash', () => {
      expect(isAuthGateAllowlisted('/api/v1/auth/sign-out/?x=1')).toBe(true);
      expect(isAuthGateAllowlisted('/api/v1/data/x/')).toBe(false);
    });

    // ── [#16839] The allow-list is ANCHORED ────────────────────────────────
    //
    // It used to match unanchored: `path.includes('/auth/')` at ANY position
    // and an `endsWith` suffix test at ANY depth. So a segment whose VALUE
    // spelled an allow-listed token carried the exemption, and object names
    // and record ids are TENANT-CONTROLLED. Both seams hand this predicate a
    // data-plane path directly — `HttpDispatcher.enforceAuthGate(context,
    // cleanPath)` and `RestServer.enforceAuth` (`req.path`) — so a tenant that
    // declared an object named `auth`, or held a record whose id is `health`,
    // handed a password-expired / MFA-required session a bypass on that
    // object's data routes.
    //
    // ⛔ These pin the DECISION for the exact paths the card measured, not the
    // spelling of the predicate, so they survive a rewrite of it.
    describe('[#16839] a tenant-controlled segment cannot buy the exemption', () => {
      it('gates the four paths that were falsely exempt', () => {
        for (const p of [
          '/data/auth/123',       // an object named `auth`
          '/meta/auth/objects',   // an object named `auth`
          '/data/x/health',       // a record whose id is `health`
          '/data/xyz/me/apps',
        ]) {
          expect(isAuthGateAllowlisted(p), p).toBe(false);
        }
      });

      it('gates the same shapes under the REST mount, where the seam sees the base', () => {
        for (const p of [
          '/api/v1/data/auth/123',
          '/api/v1/meta/auth/objects',
          '/api/v1/data/health',                 // `/data/:object` with object = `health`
          '/api/v1/data/x/health',               // `/data/:object/:id` with id = `health`
          '/api/v1/data/contacts/me/apps',
          '/api/v1/data/environments/x/health',  // a scope-shaped OBJECT name, mid-path
        ]) {
          expect(isAuthGateAllowlisted(p), p).toBe(false);
        }
      });

      // ⭐ The card's own two control rows. Without them the block above would
      // read the same for a predicate that had simply started refusing
      // everything.
      it('CONTROL — the genuinely-exempt path stays exempt and the protected one stays gated', () => {
        expect(isAuthGateAllowlisted('/auth/me')).toBe(true);
        expect(isAuthGateAllowlisted('/data/contacts/1')).toBe(false);
      });

      // The other direction, at full width: every mount shape a real
      // remediation / bootstrap route arrives in must still be exempt. An
      // anchoring that is too strict fails HERE rather than in production.
      it('keeps every genuinely-exempt route shape exempt', () => {
        for (const p of [
          // dispatcher shape — the hono adapter strips the app prefix
          '/auth/sign-out', '/auth/two-factor/enable', '/auth/me/localization',
          '/auth', '/health', '/ready', '/discovery',
          // REST + better-auth mounts
          '/api/auth', '/api/auth/sign-in',
          '/api/v1/auth', '/api/v1/auth/change-password', '/api/v1/auth/me/permissions',
          '/api/v1/health', '/api/v1/ready', '/api/v1/discovery',
          '/api/v1/me/apps', '/api/v1/me/localization',
          // environment-scoped mount — the dispatcher evaluates the gate
          // BEFORE its scoped-URL strip, so this spelling reaches the predicate
          '/api/v1/environments/env_1/auth/sign-out',
          '/environments/env_1/auth/sign-out',
          '/api/v1/environments/env_1/discovery',
          // the legacy `projects` spelling of the same scope (ADR-0006)
          '/api/v1/projects/env_1/auth/sign-out',
        ]) {
          expect(isAuthGateAllowlisted(p), p).toBe(true);
        }
      });

      // ⭐ CLAUSE ② DISCHARGE — the repair only ever REMOVES exemptions.
      //
      // The dispatch declared "nothing is newly accepted"; this measures it
      // instead of asserting it. `preAnchoringAllowlisted` is the predicate
      // this file's subject replaced, transcribed verbatim from `origin/main`
      // cf6e0a193b, and the corpus is every path of up to four segments drawn
      // from the vocabulary the two spellings can disagree on. A single
      // `new && !old` row means a path became NEWLY exempt, which is a
      // widening and is not this card's to make.
      it('is a strict SUBSET of the pre-anchoring allow-list — nothing becomes newly exempt', () => {
        const OLD_PREFIXES = ['/api/v1/auth/', '/api/auth/', '/auth/'];
        const OLD_SUFFIXES = ['/health', '/ready', '/discovery', '/me/apps', '/me/localization'];
        const preAnchoringAllowlisted = (rawPath: string | undefined | null): boolean => {
          if (!rawPath) return true;
          let path = rawPath.split('?')[0] || '/';
          let end = path.length;
          while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
          path = path.slice(0, end) || '/';
          if (path.includes('/auth/')) return true;
          for (const p of OLD_PREFIXES) if (path.startsWith(p) || path === p.replace(/\/$/, '')) return true;
          for (const s of OLD_SUFFIXES) if (path.endsWith(s)) return true;
          return false;
        };

        const SEG = ['api', 'v1', 'auth', 'health', 'ready', 'discovery', 'me', 'apps',
          'localization', 'data', 'meta', 'ui', 'environments', 'projects', 'env1', 'x'];
        const corpus: string[] = ['/', ''];
        for (const a of SEG) {
          corpus.push(`/${a}`);
          for (const b of SEG) {
            corpus.push(`/${a}/${b}`);
            for (const c of SEG) {
              corpus.push(`/${a}/${b}/${c}`);
              for (const d of SEG) corpus.push(`/${a}/${b}/${c}/${d}`);
            }
          }
        }

        const widened = corpus.filter((p) => isAuthGateAllowlisted(p) && !preAnchoringAllowlisted(p));
        expect(widened).toEqual([]);
        // Anti-vacuity: the corpus really does exercise both predicates, and
        // the repair really did remove exemptions — a corpus that narrowed
        // nothing would satisfy the line above without measuring anything.
        const narrowed = corpus.filter((p) => !isAuthGateAllowlisted(p) && preAnchoringAllowlisted(p));
        expect(corpus.length).toBeGreaterThan(10_000);
        expect(narrowed.length).toBeGreaterThan(0);
        expect(narrowed).toContain('/data/x/health');
      });
    });
  });

  // ── [#7898] FAIL-CLOSED — an absent or empty path is NOT exempt ──────────
  //
  // Maintainer ruling, director seat batch #114 item 2, verbatim 「其他同意」:
  // Option A, fail-close at the source. The predicate used to answer `true`
  // for a falsy path, so any caller reaching the ADR-0069 gate without a
  // populated `path` was exempt on EVERY route — a transport author who simply
  // forgot to set `path` disabled the gate with no diagnostic at all.
  //
  // ⛔ These pin the DECISION (exempt / not exempt, blocked / not blocked),
  // never the spelling of the predicate, so they survive a rewrite of it.
  describe('[#7898] a falsy path is not exempt (fail-closed)', () => {
    it('refuses to exempt an absent, null or empty path', () => {
      for (const p of [undefined, null, ''] as const) {
        expect(isAuthGateAllowlisted(p), JSON.stringify(p)).toBe(false);
      }
    });

    it('⭐ POSITIVE CONTROL — the predicate still EXEMPTS a real control-plane path', () => {
      // ⛔ Without this, a predicate that answered `false` for everything (a
      // broken import, an over-eager guard, a rename) reads exactly like the
      // refusal above — the failure this card must not ship is "a request that
      // used to work now 403s", not "the refusal did not fire".
      expect(isAuthGateAllowlisted('/api/v1/auth/sign-in')).toBe(true);
      expect(isAuthGateAllowlisted('/api/v1/health')).toBe(true);
      expect(isAuthGateAllowlisted('/api/v1/discovery')).toBe(true);
    });

    it('carries the flip through A3 `evaluateAuthGate`, and tightens only the EXEMPTION', () => {
      const gated = { id: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } };
      // A3 is the seam the dispatcher hands `cleanPath` to.
      expect(evaluateAuthGate(gated, '')).toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
      // ⭐ The other direction, and the one that matters more: the flip narrows
      // what is EXEMPT, never what is GATED. A session with no `authGate` has
      // nothing to enforce and is still not blocked on the same empty path,
      // and a gated session still reaches every remediation route.
      expect(evaluateAuthGate({ id: 'u1' }, '')).toBeNull();
      expect(evaluateAuthGate(gated, '/api/v1/auth/change-password')).toBeNull();
      expect(evaluateAuthGate(gated, '/api/v1/me/apps')).toBeNull();
    });

    // ⭐ THE FENCE — the ruling's own control, verbatim:
    // 「控制:现有四处生产调用点行为逐字节不变,普查 5257880748 重跑」
    //
    // The census re-run on d46deba195 finds the SAME four production call
    // sites it found on #7432, and no fifth:
    //
    //   A1 `RestServer.enforceAuth`        rest-server.ts      — guards non-empty
    //   A2 `HttpDispatcher.enforceAuthGate` http-dispatcher.ts — passes `cleanPath`
    //   A3 `evaluateAuthGate`              this file           — `path: string`
    //   B1 `shouldDenyAnonymous`           anonymous-deny.ts   — guards non-empty
    //
    // A1 and B1 reach this predicate ONLY with a non-empty string, so "their
    // behaviour did not move" is exactly "no non-empty path changed answer" —
    // which is what this measures, over the whole corpus rather than a handful
    // of examples.
    //
    // `preFlipAllowlisted` is the predicate this card replaced, transcribed
    // verbatim from origin/main d46deba195. A legitimate future change to the
    // allow-list updates BOTH sides: this is a ratchet on the FLIP, not on the
    // route rules (those are #16839's, pinned above and untouched here).
    it('changes the answer for the falsy path ONLY — every real caller input is unmoved', () => {
      const OLD_MOUNT_BASES: readonly (readonly string[])[] = [['api', 'v1'], ['api'], []];
      const OLD_SCOPE_SEGMENTS: readonly string[] = ['environments', 'projects'];
      const OLD_ALLOW_ROUTES: readonly (readonly string[])[] = [
        ['health'], ['ready'], ['discovery'], ['me', 'apps'], ['me', 'localization'],
      ];
      const startsWith = (segments: readonly string[], prefix: readonly string[]): boolean => {
        if (segments.length < prefix.length) return false;
        for (let k = 0; k < prefix.length; k++) if (segments[k] !== prefix[k]) return false;
        return true;
      };
      const preFlipAllowlisted = (rawPath: string | undefined | null): boolean => {
        if (!rawPath) return true;             // ⬅ the fail-open default this card removes
        let path = rawPath.split('?')[0] || '/';
        let end = path.length;
        while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
        path = path.slice(0, end) || '/';
        const segments = path.split('/').filter((s) => s !== '');
        for (const base of OLD_MOUNT_BASES) {
          if (!startsWith(segments, base)) continue;
          let i = base.length;
          let scoped = false;
          if (i + 1 < segments.length && OLD_SCOPE_SEGMENTS.includes(segments[i] as string)) {
            i += 2;
            scoped = true;
          }
          if (segments[i] === 'auth') {
            if (i + 1 < segments.length) return true;
            if (!scoped) return true;
          }
          for (const route of OLD_ALLOW_ROUTES) {
            if (segments.length - i === route.length && startsWith(segments.slice(i), route)) return true;
          }
        }
        return false;
      };

      const SEG = ['api', 'v1', 'auth', 'health', 'ready', 'discovery', 'me', 'apps',
        'localization', 'data', 'meta', 'ui', 'environments', 'projects', 'env1', 'x'];
      const corpus: string[] = ['', '/'];
      for (const a of SEG) {
        corpus.push(`/${a}`);
        for (const b of SEG) {
          corpus.push(`/${a}/${b}`);
          for (const c of SEG) {
            corpus.push(`/${a}/${b}/${c}`);
            for (const d of SEG) corpus.push(`/${a}/${b}/${c}/${d}`);
          }
        }
      }

      const moved = corpus.filter((p) => isAuthGateAllowlisted(p) !== preFlipAllowlisted(p));
      expect(moved).toEqual(['']);

      // Anti-vacuity: the corpus really exercises BOTH answers on BOTH
      // predicates — an all-`false` predicate would satisfy the line above for
      // every non-empty path without measuring anything.
      expect(corpus.length).toBeGreaterThan(10_000);
      expect(corpus.filter((p) => isAuthGateAllowlisted(p)).length).toBeGreaterThan(0);
      expect(corpus.filter((p) => !isAuthGateAllowlisted(p)).length).toBeGreaterThan(0);
      expect(corpus.filter((p) => preFlipAllowlisted(p)).length).toBeGreaterThan(0);
    });

    // ⚠️ The one shipped input whose answer DOES move, recorded rather than
    // left to be discovered. `http-dispatcher.ts` computes
    // `cleanPath = path.replace(/\/$/, '')`, so the bare-root `${prefix}/`
    // arrives as `''` — exempt via the fail-open default before this card, not
    // exempt after it. Normalising `'' → '/'` at the dispatcher is the ruling's
    // step 2 (#17625, `domain:cli`, `Blocked-by: #7898`); it is deliberately
    // NOT a tolerance re-added here.
    it('does not exempt the dispatcher bare-root `cleanPath` — step 2 is #17625', () => {
      expect(isAuthGateAllowlisted('')).toBe(false);
      // ⛔ And `'/'`, the value step 2 normalises to, is not exempt either —
      // so #17625 keeping bare-root discovery reachable for a GATED session is
      // its own question, not something this flip already answered.
      expect(isAuthGateAllowlisted('/')).toBe(false);
      // The named discovery route is unaffected in both spellings.
      expect(isAuthGateAllowlisted('/discovery')).toBe(true);
      expect(isAuthGateAllowlisted('/api/v1/discovery')).toBe(true);
    });
  });

  // ── The ADR-0043 approval action page (ruling A on #22438) ───────────────
  //
  // `GET` / `POST /api/v1/approvals/act` is session-less by design: the
  // single-use token in the request is its whole authorization. The self-hosted
  // raw-app mount (`plugin-approvals` `ACT_PATH`) never passes through this
  // gate, so the allow-list gives the dispatcher's spelling of the same route
  // the same token-only authentication. The card's scope is binding: the exact
  // route only, no prefix or wildcard, no other approvals path.
  //
  // ⛔ These pin the DECISION per path, never the spelling of the entry.
  describe('[#22577] the approval action page is exempt as the exact route, and nothing wider', () => {
    it('PIN 1 — exempts the exact act route in every spelling the gate already normalises', () => {
      for (const p of [
        '/api/v1/approvals/act',                    // the self-hosted mount's ACT_PATH, as a REST-shaped seam sees it
        '/approvals/act',                           // the dispatcher shape: the hono adapter strips the app prefix
        '/api/approvals/act',                       // the third mount base the gate recognises
        '/api/v1/approvals/act?token=abc',          // the e-mail link's spelling: query stripped
        '/approvals/act?token=abc',
        '/api/v1/approvals/act/',                   // trailing slash stripped
        '/approvals/act//',
        '//approvals//act',                         // empty segments dropped
        '/environments/env_1/approvals/act',        // scoped: the dispatcher gates BEFORE its scoped-URL strip
        '/api/v1/environments/env_1/approvals/act',
        '/api/v1/projects/env_1/approvals/act',     // the legacy `projects` spelling of the same scope (ADR-0006)
      ]) {
        expect(isAuthGateAllowlisted(p), p).toBe(true);
      }
    });

    it('PIN 2 — gates every sibling approvals path and every extension of the act route', () => {
      for (const p of [
        // prefix extensions of the act route
        '/api/v1/approvals/act/x', '/approvals/act/x', '/api/v1/approvals/act/x/y',
        '/api/v1/approvals/actx', '/approvals/actx', '/approvals/act-x', '/api/v1/approvals/acts',
        // the approvals base and its other routes (the REST approvals surface)
        '/api/v1/approvals', '/approvals', '/api/v1/approvals/',
        '/api/v1/approvals/requests', '/api/v1/approvals/requests/req_1',
        '/api/v1/approvals/requests/req_1/approve', '/approvals/requests/req_1/approve',
        '/approvals/x', '/x/act',
        // the act route below a non-mount segment, whose value a tenant controls
        '/data/approvals/act', '/api/v1/data/approvals/act', '/meta/approvals/act',
        '/data/environments/x/approvals/act', '/api/v2/approvals/act', '/rest/v1/approvals/act',
        // a scope with no id: `approvals` is the id here, and the route is `act`
        '/environments/approvals/act', '/api/v1/environments/approvals/act',
        // spellings the gate does not normalise: case and percent-encoding
        '/api/v1/Approvals/act', '/APPROVALS/ACT', '/approvals/Act',
        '/api/v1/approvals%2Fact', '/approvals/%61ct',
      ]) {
        expect(isAuthGateAllowlisted(p), p).toBe(false);
      }
    });

    it('carries through `evaluateAuthGate`: a gated session passes the act route and stays gated next door', () => {
      const gated = { id: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } };
      expect(evaluateAuthGate(gated, '/approvals/act')).toBeNull();
      expect(evaluateAuthGate(gated, '/api/v1/approvals/act?token=abc')).toBeNull();
      // ⭐ The control: the same fixture is still gated on the sibling route.
      expect(evaluateAuthGate(gated, '/api/v1/approvals/requests/req_1/approve'))
        .toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
      expect(evaluateAuthGate(gated, '/approvals/act/x'))
        .toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
    });

    // ⭐ CLAUSE ② — the widening, measured rather than asserted.
    //
    // `preEntryAllowlisted` is this file's subject as it stood before the
    // entry, transcribed from `origin/main` 99801d831f. Over every path of up to
    // five segments drawn from a vocabulary that mixes the new route's tokens
    // with the existing ones (plus the six-segment scoped REST shape), the set
    // of paths whose answer moved must be EXACTLY the act route at each mount
    // base the gate recognises, unscoped or under one environment scope, and
    // every move must be a newly exempt path, none newly gated.
    it('BOUNDARY — newly exempt is exactly the act route at each mount base and scope, nothing else', () => {
      const PRE_MOUNT_BASES: readonly (readonly string[])[] = [['api', 'v1'], ['api'], []];
      const PRE_SCOPE_SEGMENTS: readonly string[] = ['environments', 'projects'];
      const PRE_ALLOW_ROUTES: readonly (readonly string[])[] = [
        ['health'], ['ready'], ['discovery'], ['me', 'apps'], ['me', 'localization'],
      ];
      const startsWith = (segments: readonly string[], prefix: readonly string[]): boolean => {
        if (segments.length < prefix.length) return false;
        for (let k = 0; k < prefix.length; k++) if (segments[k] !== prefix[k]) return false;
        return true;
      };
      const preEntryAllowlisted = (rawPath: string | undefined | null): boolean => {
        if (!rawPath) return false;
        let path = rawPath.split('?')[0] || '/';
        let end = path.length;
        while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
        path = path.slice(0, end) || '/';
        const segments = path.split('/').filter((s) => s !== '');
        for (const base of PRE_MOUNT_BASES) {
          if (!startsWith(segments, base)) continue;
          let i = base.length;
          let scoped = false;
          if (i + 1 < segments.length && PRE_SCOPE_SEGMENTS.includes(segments[i] as string)) {
            i += 2;
            scoped = true;
          }
          if (segments[i] === 'auth') {
            if (i + 1 < segments.length) return true;
            if (!scoped) return true;
          }
          for (const route of PRE_ALLOW_ROUTES) {
            if (segments.length - i === route.length && startsWith(segments.slice(i), route)) return true;
          }
        }
        return false;
      };

      const SEG = ['api', 'v1', 'approvals', 'act', 'requests', 'environments', 'projects', 'env1', 'auth', 'health'];
      const corpus: string[] = ['', '/'];
      const walk = (prefix: string, depth: number) => {
        if (depth === 0) return;
        for (const s of SEG) {
          const p = `${prefix}/${s}`;
          corpus.push(p);
          walk(p, depth - 1);
        }
      };
      walk('', 5);
      // The scoped REST shape is six segments deep: `/api/v1/<scope>/<id>/approvals/act`.
      walk('/api/v1', 4);

      // Built independently of the predicate: base × (no scope | scope × id) × route.
      const expected = new Set<string>();
      for (const base of PRE_MOUNT_BASES) {
        const scopes: string[][] = [[]];
        for (const s of PRE_SCOPE_SEGMENTS) for (const id of SEG) scopes.push([s, id]);
        for (const scope of scopes) expected.add(`/${[...base, ...scope, 'approvals', 'act'].join('/')}`);
      }

      const newlyExempt = corpus.filter((p) => isAuthGateAllowlisted(p) && !preEntryAllowlisted(p));
      const newlyGated = corpus.filter((p) => !isAuthGateAllowlisted(p) && preEntryAllowlisted(p));
      expect(newlyGated).toEqual([]);
      expect([...new Set(newlyExempt)].sort()).toEqual([...expected].sort());

      // Anti-vacuity: the corpus reaches every expected path, exercises both
      // answers on both predicates, and carries the siblings PIN 2 names.
      const inCorpus = new Set(corpus);
      for (const p of expected) expect(inCorpus.has(p), p).toBe(true);
      expect(corpus.length).toBeGreaterThan(100_000);
      expect(corpus.filter((p) => preEntryAllowlisted(p)).length).toBeGreaterThan(0);
      expect(corpus.filter((p) => !isAuthGateAllowlisted(p)).length).toBeGreaterThan(0);
      for (const p of ['/approvals/act/requests', '/api/v1/approvals/requests', '/approvals/act/act']) {
        expect(inCorpus.has(p), p).toBe(true);
        expect(isAuthGateAllowlisted(p), p).toBe(false);
      }
    });
  });

  describe('evaluateAuthGate', () => {
    it('returns null when the user carries no authGate', () => {
      expect(evaluateAuthGate({ id: 'u1' }, '/api/v1/data/x')).toBeNull();
    });
    it('returns null on an allow-listed path even when gated', () => {
      const u = { id: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'm' } };
      expect(evaluateAuthGate(u, '/api/v1/auth/change-password')).toBeNull();
    });
    it('returns the gate on a blocked path', () => {
      const u = { id: 'u1', authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } };
      expect(evaluateAuthGate(u, '/api/v1/data/sys_user')).toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
    });
    it('falls back to a generic message when none provided', () => {
      const u = { authGate: { code: 'MFA_REQUIRED' } };
      const g = evaluateAuthGate(u, '/api/v1/data/x');
      expect(g?.code).toBe('MFA_REQUIRED');
      expect(typeof g?.message).toBe('string');
    });
  });

  // #7280 — `ExecutionContext.authGate` is now DECLARED (`{ code, message }`,
  // both required), and the session user it is lifted from crosses an external
  // boundary as `any`. This is the one place that turns the loose thing into
  // the declared thing, for BOTH consumers: `evaluateAuthGate` (the seams that
  // decide per path) and REST's `computeExecCtx` (the seam that puts the
  // posture on the envelope). A test here is what stops the two from
  // re-deriving it differently.
  describe('normalizeAuthGate (#7280)', () => {
    it('returns null for a user with no gate, and for no user at all', () => {
      expect(normalizeAuthGate({ id: 'u1' })).toBeNull();
      expect(normalizeAuthGate(undefined)).toBeNull();
      expect(normalizeAuthGate(null)).toBeNull();
    });

    it('returns null when the gate names no string code — that is not a gate', () => {
      expect(normalizeAuthGate({ authGate: {} })).toBeNull();
      expect(normalizeAuthGate({ authGate: { code: 403 } })).toBeNull();
    });

    it('passes a well-formed gate through verbatim', () => {
      expect(normalizeAuthGate({ authGate: { code: 'PASSWORD_EXPIRED', message: 'change it' } }))
        .toEqual({ code: 'PASSWORD_EXPIRED', message: 'change it' });
    });

    it('fills a missing or blank message, so the declared shape is always met', () => {
      // Without this the envelope would carry `message: undefined` into a 403
      // body — the loose shape the declaration exists to rule out.
      for (const gate of [{ code: 'MFA_REQUIRED' }, { code: 'MFA_REQUIRED', message: '' }]) {
        const g = normalizeAuthGate({ authGate: gate });
        expect(g?.code).toBe('MFA_REQUIRED');
        expect(typeof g?.message).toBe('string');
        expect(g?.message.length).toBeGreaterThan(0);
      }
    });

    it('drops any key the declaration does not name', () => {
      const g = normalizeAuthGate({
        authGate: { code: 'PASSWORD_EXPIRED', message: 'm', redirectTo: '/change-password' },
      });
      expect(Object.keys(g ?? {}).sort()).toEqual(['code', 'message']);
    });
  });
});
