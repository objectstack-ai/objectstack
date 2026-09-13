---
'@objectstack/platform-objects': minor
---

`apps.account.navigation.nav_connect_agent` is translated in all four locales, so the Connect an Agent page renders the same string behind both doors

`@objectstack/mcp` contributes the Connect an Agent page into **two** apps — `setup` (admins) and, since #17646, `account` → Developer (every authenticated user). The translation bundles are keyed `apps.<app>.navigation.<id>`, one namespace per app, and only the `setup` key existed. So `apps.setup.navigation.nav_connect_agent` never answered for the Account door, and one destination rendered two different strings for the same signed-in user:

| door | before |
|:--|:--|
| Setup → Integrations | 「连接智能体」 / 「エージェントを接続」 / "Conectar un agente" |
| Account → Developer | `Connect an Agent`, the English literal, in every locale |

The population that got the untranslated one is precisely the non-admin on a non-English locale: Account is the only one of the two doors they can open.

Adds the key to `en` / `zh-CN` / `ja-JP` / `es-ES`, mirroring the Setup twin's strings verbatim, plus the `#8765` provenance row in each of the three hand-maintained `<locale>.source-hashes.ts` tables (`en` is the source, not a copy of one, so it has no table and gets no row). The recorded digest is `collectSourceHashes(en)['apps.account.navigation.nav_connect_agent.label']` — the repo's own `hashSource`, not a hand-written value.

⛔ No behaviour outside the bundle moves. No nav item, permission, route or page is added: the contribution and the destination already existed and are untouched, and the Setup key is byte-unchanged. This is an additive key on a published payload, which is why it ships `minor` rather than `patch`.

Neither gate over this surface could see the gap, and neither is changed here: `pnpm check:app-nav-i18n` scopes itself to `APP_NAME = 'setup'` and skips every contribution targeting another app, and `app-nav-translation-parity.test.ts` walks statically declared nav — the Account entry is contributed at runtime, so no static walk reaches it. Extending the gate is the next step in the standing repair order and lands in `packages/cli/scripts/**` under its own card, deliberately not folded in here.
