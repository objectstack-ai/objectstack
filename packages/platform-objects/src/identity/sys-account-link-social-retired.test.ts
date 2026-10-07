// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21849 — `sys_account` declares no link action; `unlink_account` stays.
 *
 * `link_social` was a `type: 'url'` toolbar action that navigated the browser to
 * a GET of better-auth's social sign-in route, which better-auth serves as POST
 * only, and it offered a fixed list of seven providers whatever the boot had
 * configured. It was dead on every boot: a provider-less boot offered seven
 * providers that 404, and a configured boot still could not link. It was
 * retired under ADR-0049 enforce-or-remove rather than repaired, because the
 * action contract has no way to say "options from the configured providers"
 * or "hidden when none is configured" (the maintainer-ratified ruling on the
 * card). Linking stays reachable through the signed-in
 * `POST /api/v1/auth/link-social` (SDK `auth.accounts.linkSocial`).
 *
 * What is pinned is the absence of a LINK AFFORDANCE, not only of one name: an
 * action that targets a social sign-in or link door under any other name is
 * the same dead shape returning. The unlink half is pinned on the fields that
 * make it work against better-auth, so the retirement cannot have taken it
 * along. The four shipped translation bundles and the three provenance tables
 * are pinned too: a leaf left behind for a retired action is a catalog entry
 * nothing renders, and a provenance row for it keeps a stale echo decision
 * alive.
 */

import { describe, expect, it } from 'vitest';

import { SysAccount } from './sys-account.object.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { zhCNGeneratedSourceHashes } from '../apps/translations/zh-CN.source-hashes.generated.js';
import { jaJPGeneratedSourceHashes } from '../apps/translations/ja-JP.source-hashes.generated.js';
import { esESGeneratedSourceHashes } from '../apps/translations/es-ES.source-hashes.generated.js';

type ActionLike = { name?: string; type?: string; target?: string; [key: string]: unknown };

const actions = (): ActionLike[] => ((SysAccount as { actions?: ActionLike[] }).actions ?? []);

/** A target that starts a social/OIDC sign-in or link round-trip. */
const LINK_DOOR = /\/auth\/(sign-in\/(social|oauth2)|link-social)\b/;

describe('#21849 — sys_account declares no link action', () => {
  it('declares exactly one action, unlink_account — no link_social', () => {
    const names = actions().map((a) => a.name);
    expect(names).not.toContain('link_social');
    expect(names).toEqual(['unlink_account']);
  });

  it('no action targets a social sign-in or link door, under any name', () => {
    const doors = actions()
      .filter((a) => typeof a.target === 'string' && LINK_DOOR.test(a.target))
      .map((a) => `${a.name} -> ${a.target}`);
    expect(doors).toEqual([]);
  });

  it('the link-door predicate can say "yes" — fed the retired target and the link door', () => {
    // Without this, a predicate that matches nothing would green the test above.
    expect(LINK_DOOR.test('/api/v1/auth/sign-in/social?provider=google')).toBe(true);
    expect(LINK_DOOR.test('/api/v1/auth/link-social')).toBe(true);
    expect(LINK_DOOR.test('/api/v1/auth/unlink-account')).toBe(false);
  });
});

describe('#21849 — unlink_account is unchanged by the retirement', () => {
  it('keeps its name, type, target, placement and row-id param', () => {
    const unlink = actions().find((a) => a.name === 'unlink_account');
    expect(unlink, 'unlink_account is missing from sys_account').toBeDefined();
    expect(unlink?.type).toBe('api');
    expect(unlink?.target).toBe('/api/v1/auth/unlink-account');
    expect(unlink?.mode).toBe('delete');
    expect(unlink?.locations).toEqual(['list_item', 'record_header']);
    expect(unlink?.params).toEqual([
      { name: 'accountId', field: 'id', defaultFromRow: true, required: true },
    ]);
  });
});

describe('#21849 — the shipped translation bundles carry no link_social leaf', () => {
  const BUNDLES = [
    ['en', enObjects],
    ['zh-CN', zhCNObjects],
    ['ja-JP', jaJPObjects],
    ['es-ES', esESObjects],
  ] as const;

  for (const [locale, bundle] of BUNDLES) {
    it(`${locale}: sys_account._actions holds unlink_account and no link_social`, () => {
      const acts = (bundle as Record<string, { _actions?: Record<string, unknown> }>).sys_account?._actions;
      // Positive control first: an absent `_actions` would make the absence
      // check below vacuous.
      expect(acts, `${locale} bundle has no sys_account._actions`).toBeDefined();
      expect(Object.keys(acts ?? {})).toEqual(['unlink_account']);
      expect(acts).not.toHaveProperty('link_social');
    });
  }

  const TABLES = [
    ['zh-CN', zhCNGeneratedSourceHashes],
    ['ja-JP', jaJPGeneratedSourceHashes],
    ['es-ES', esESGeneratedSourceHashes],
  ] as const;

  for (const [locale, table] of TABLES) {
    it(`${locale}: the provenance table keeps no row for the retired action`, () => {
      const keys = Object.keys(table);
      expect(keys.length, `${locale} provenance table is empty`).toBeGreaterThan(0);
      expect(keys.filter((k) => k.startsWith('objects.sys_account._actions.link_social'))).toEqual([]);
    });
  }
});
