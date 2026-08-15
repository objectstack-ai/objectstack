// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8222 — the OIDC subject claim is not authorable, so the form must not offer it.
 *
 * `register_sso_provider` used to collect a `mapId` ("Map: User ID claim") param.
 * The capability behind it was retired UPSTREAM in `@better-auth/sso@1.7.0-rc.2`:
 * `oidcConfig.mapping` is a `z.strictObject` whose members are
 * `{ email, emailVerified?, name, image?, extraFields? }` — no `id` — and the
 * federated subject is hard-wired to the OIDC `sub` claim
 * (`id: readStringClaim(rawUserInfo, "sub")` / `id: idToken.sub`, then
 * cross-checked). `extraFields` is not an escape hatch: it is spread BEFORE `id`
 * in the profile literal, so an `extraFields.id` is overwritten by `sub` before
 * anything reads it. 1.6.20 did honour `mapping.id`; the version bump deleted it.
 *
 * The field therefore promised a choice the runtime does not have: its only
 * accepted values were "empty" and the `sub` it already defaulted to, and #8193
 * (PR #8221) made anything else answer `INVALID_REQUEST` — a 400 from a field the
 * UI presented as optional and free-form. Removing it restores declared = enforced.
 *
 * **What this file pins is the admin-visible affordance, in both directions.**
 * The risk is not that the identifier `mapId` reappears somewhere — a grep sees
 * that. It is (a) that the param comes back under some other spelling while every
 * `mapId` grep stays green, and (b) that a future sweep over-applies and takes the
 * mapping params that ARE still real down with it. `mapEmail` and `mapName` map to
 * live `oidcMappingSchema` members and must survive.
 *
 * The bridge-side guard in plugin-auth `register-sso-provider.ts` is deliberately
 * NOT removed and is NOT this file's subject: the form is only one caller, and a
 * direct API client can still put `mapId` on the wire. Its refusal is pinned where
 * it lives, in `register-sso-provider.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { SysSsoProvider } from './sys-sso-provider.object.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

const registerAction = (): any => {
  const action = ((SysSsoProvider as any).actions ?? []).find(
    (a: any) => a.name === 'register_sso_provider',
  );
  if (!action) throw new Error('sys_sso_provider declares no `register_sso_provider` action');
  return action;
};

const paramNames = (): string[] => (registerAction().params ?? []).map((p: any) => p.name);

describe('#8222 — `register_sso_provider` does not offer a user-ID claim mapping', () => {
  it('declares no `mapId` param', () => {
    expect(
      paramNames(),
      'the OIDC subject is read from `sub` and is not configurable in '
        + '@better-auth/sso@1.7.0-rc.2 — offering the field makes the form promise '
        + 'a choice the runtime does not have',
    ).not.toContain('mapId');
  });

  it('offers no param that collects a user-ID / subject claim under ANY spelling', () => {
    // The half a `mapId` grep cannot see: the same false promise re-added as
    // `subjectClaim`, `idClaim`, `mapSubject`, … Judge the admin-facing copy,
    // not the identifier.
    const offenders = (registerAction().params ?? []).filter((p: any) => {
      const copy = `${p.name ?? ''} ${p.label ?? ''} ${p.helpText ?? ''}`.toLowerCase();
      const namesSubject = /\bsub\b|subject|user id|userid|user-id/.test(copy);
      // `mapEmail`/`mapName` mention neither; the scopes param mentions neither.
      return namesSubject;
    });
    expect(
      offenders.map((p: any) => p.name),
      'these params collect the federated subject claim, which is hard-wired to '
        + '`sub` upstream — the value would be refused (INVALID_REQUEST) or silently discarded',
    ).toEqual([]);
  });

  it('keeps the claim mappings that ARE still honoured — the over-removal guard', () => {
    // `oidcMappingSchema` still carries `email` (required) and `name` (required),
    // and the bridge emits both. A sweep that took these out with `mapId` would
    // remove real capability, and no `mapId` assertion above would notice.
    const names = paramNames();
    expect(names).toContain('mapEmail');
    expect(names).toContain('mapName');
  });

  it('ships no translated label for the retired param in any locale', () => {
    // What the admin actually reads. A stale bundle entry would keep rendering
    // "Map: User ID claim" for a param the action no longer declares.
    for (const [locale, bundle] of [
      ['en', enObjects],
      ['zh-CN', zhCNObjects],
      ['ja-JP', jaJPObjects],
      ['es-ES', esESObjects],
    ] as const) {
      const params: Record<string, unknown> =
        (bundle as any)?.sys_sso_provider?._actions?.register_sso_provider?.params ?? {};
      expect(Object.keys(params), `${locale} bundle still translates the retired param`).not.toContain('mapId');
      // Counter-probe: the surviving params ARE translated in this bundle, so an
      // empty/misshaped lookup path cannot make the assertion above pass vacuously.
      expect(Object.keys(params), `${locale} bundle lookup path is wrong — it resolved nothing`).toContain('mapEmail');
    }
  });
});
