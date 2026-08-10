import { describe, it, expect } from 'vitest';
import { NotificationChannelSchema } from './notification.zod';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  originFile,
  holderOriginsOf,
} from '../../scripts/lib/export-origins-testkit';
describe('NotificationChannelSchema', () => {
  it('should accept all valid channels', () => {
    const validChannels = [
      'email',
      'sms',
      'push',
      'in-app',
      'slack',
      'teams',
      'webhook',
    ];

    validChannels.forEach((channel) => {
      expect(() => NotificationChannelSchema.parse(channel)).not.toThrow();
    });
  });

  it('should reject invalid channel', () => {
    expect(() => NotificationChannelSchema.parse('invalid')).toThrow();
  });
});

// ─── [#4616] the orphan notification-template vocabulary is gone ─────────────
//
// ADR-0049 enforce-or-remove, v17 breaking window. `EmailTemplateSchema`,
// `SMSTemplateSchema`, `PushNotificationSchema` and `InAppNotificationSchema`
// (+ their four type aliases) existed ONLY as the member shapes of the
// `NotificationConfigSchema.template` union that #4610 (#4535 C3) deleted.
// After #4610 they were reachable from no parent schema and from no
// metadata-type root — declared capability the runtime never read.
//
// This is a whole-def removal (#4650 route 3: the defs stop being emitted, so
// the authorable-surface deletion is adjudicated by json-schema.manifest.json
// and check:api-surface), NOT a `retiredKey()` tombstone: a tombstone lives on
// a surviving schema's shape, and there is no surviving shape here. No
// ADR-0087 D2 conversion either — no metadata document was ever parsed against
// these defs, so `os migrate meta` has nothing to rewrite (same disposition as
// #4610 in this very file, and as #4767/#4783).
//
// WHY THIS PIN IS A COMPILER-API TEST. #4642 established that a conditional
// type over `typeof import(...)` in this package was a NO-OP until #5286 — `tsconfig.json`
// excluded `**/*.test.ts` and vitest never enables `typecheck`, so nothing ever
// evaluated it. (#5286's sibling `tsconfig.test.json` now does; the
// compiler-API test stays load-bearing because it resolves EVERY public entry,
// which a same-module conditional cannot.) The `NotificationConfig` pin #4610
// left here was exactly that
// shape; it is folded into the load-bearing test below rather than left as a
// gate that cannot fail. Sabotage-verified in the PR: S1 re-declares a removed
// const in notification.zod.ts, S2 re-exports it from another entry under the
// bare name (the route a "./system does not export it" assertion would miss).
describe('[#4616] notification-template orphan removal', () => {
  /** Names that must not be exported by ANY public entry point. */
  const REMOVED = [
    // #4616 — this change.
    'EmailTemplateSchema',
    'EmailTemplate',
    'SMSTemplateSchema',
    'SMSTemplate',
    'PushNotificationSchema',
    'PushNotification',
    'InAppNotificationSchema',
    'InAppNotification',
    // #4610 — the holder that made the four above orphans; pinned here so the
    // whole cluster has one enforceable home.
    'NotificationConfigSchema',
    'NotificationConfig',
  ];

  it('resolves the export surface: no removed name survives on any entry, and the survivors keep their owners', () => {
    // Anti-vacuity: the baseline must cover the real surface, including every
    // entry these names could plausibly be re-exported from. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796.)
    for (const needed of ['.', './system', './ui', './contracts', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // Anti-vacuity: the entries we are about to prove things ABSENT from must
    // each resolve a large, real surface first.
    expect(exportNamesOf('./system').length, './system must export a non-trivial surface').toBeGreaterThan(400);
    expect(exportNamesOf('./ui').length, './ui must export a non-trivial surface').toBeGreaterThan(200);
    expect(exportNamesOf('./contracts').length, './contracts must export a non-trivial surface').toBeGreaterThan(100);

    // 1. Every removed name is absent from EVERY entry — not merely from
    //    ./system. A re-export elsewhere under the bare name would keep the
    //    orphan authorable while looking like a clean removal of the
    //    declaration (the C14/C15/C17 lesson: a re-export can lie about the
    //    domain even when the symbol is honest).
    for (const name of REMOVED) {
      expect(holderOriginsOf(name), `${name} must not be exported by any entry point`).toEqual([]);
    }

    // 2. The survivor in this module: `NotificationChannel(Schema)` is live —
    //    `./contracts` re-exports the TYPE and service-messaging consumes it —
    //    so both holders must resolve to the ONE declaration in this file.
    const channelSchema = holderOriginsOf('NotificationChannelSchema');
    expect(channelSchema.map((h) => h.sub)).toEqual(['./system']);
    expect(originFile(channelSchema[0].origin)).toBe('src/system/notification.zod.ts');
    const channelType = holderOriginsOf('NotificationChannel');
    expect(channelType.map((h) => h.sub)).toEqual(['./contracts', './system']);
    for (const h of channelType) {
      expect(originFile(h.origin), 'both holders must share one declaration').toBe(
        'src/system/notification.zod.ts',
      );
    }

    // 3. The live email-template contract — what an author must use instead of
    //    the removed `EmailTemplateSchema`. `BUILTIN_METADATA_TYPE_SCHEMAS`
    //    resolves the `email_template` kind to this one; spec 7.1.0 already
    //    demoted the legacy shape here, and #4616 finished the job.
    const definition = holderOriginsOf('EmailTemplateDefinitionSchema');
    expect(definition.map((h) => h.sub)).toEqual(['./system']);
    expect(originFile(definition[0].origin)).toBe('src/system/email-template.zod.ts');

    // 4. REFUTED SIBLING — #4616's issue body proposed retiring `./ui`'s
    //    `NotificationSeveritySchema` in the same sweep on the premise that
    //    objectui pins only Type/Position/Action. That is false: objectui
    //    re-exports the TYPE (`packages/types/src/index.ts`), consumes it in
    //    `packages/core/src/protocols/NotificationProtocol.ts`, pins the SCHEMA
    //    name in `packages/types/src/__tests__/spec-ui-schema-reexports.test.ts`,
    //    and types two severity→tone maps as `Record<NotificationSeverityLevel, …>`
    //    precisely so a new spec severity fails type-check downstream. It stays
    //    live and ./ui-owned; this assertion exists so the claim is not
    //    re-litigated from the issue text.
    for (const name of ['NotificationSeveritySchema', 'NotificationSeverity']) {
      const holders = holderOriginsOf(name);
      expect(holders.map((h) => h.sub), `${name} is LIVE in objectui — must stay ./ui-owned`).toEqual(['./ui']);
      expect(originFile(holders[0].origin)).toBe('src/ui/notification.zod.ts');
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const system = await import('./index');
    const ui = await import('../ui/index');

    for (const name of REMOVED) {
      expect(name in system, `./system must not export ${name} at runtime`).toBe(false);
      expect(name in ui, `./ui must not export ${name} at runtime`).toBe(false);
    }

    // Anti-vacuity: the namespaces just probed are real, and the neighbours
    // that must survive do.
    expect('NotificationChannelSchema' in system).toBe(true);
    expect('EmailTemplateDefinitionSchema' in system).toBe(true);
    expect('NotificationSeveritySchema' in ui).toBe(true);

    // The live email-template contract still parses a canonical authored item,
    // and still rejects the removed legacy shape — so "use the definition
    // schema instead" is a prescription that actually works.
    const parsed = system.EmailTemplateDefinitionSchema.parse({
      name: 'crm_welcome',
      label: 'Welcome',
      subject: 'Welcome to {{company}}',
      bodyHtml: '<h1>Welcome {{user}}</h1>',
    });
    expect(parsed.name).toBe('crm_welcome');
    expect(parsed.locale).toBe('en-US');
    // The legacy shape's required keys (`id`, `body`) are not this contract's,
    // and it is a strictObject — authoring the old shape fails loudly instead
    // of being silently stripped.
    expect(() =>
      system.EmailTemplateDefinitionSchema.parse({
        id: 'welcome-email',
        subject: 'Welcome',
        body: '<h1>Welcome</h1>',
        bodyType: 'html',
      }),
    ).toThrow();
  });
});
