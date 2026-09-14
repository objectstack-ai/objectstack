---
'@objectstack/mcp': patch
---

Point Connect-an-Agent instructions at the Account door too, so a non-admin is told a path they can actually take

#17646 made the Connect-an-Agent page reachable for every signed-in user by
adding a second `navigationContributions` entry into the **`account`** app's
`grp_account_developer` group. It deliberately did **not** ungate Setup — that
was measured to expose 14+ unrelated Setup surfaces — so the same principal
still gets `403 PERMISSION_DENIED` on `GET /api/v1/meta/apps/setup`.

The shipped instructions never moved. The stdio transport's refusal message and
this package's README both said *"Setup → Connect an Agent"*, naming the one app
a non-admin cannot open — read, in the refusal's case, at exactly the moment the
user is stuck. Both now name **both** doors: **Account → Developer** for any
signed-in user, **Setup → Connect an Agent** for platform admins. The Setup
entry is unchanged and stays where admins already look.

Text only — no behaviour, no gate, no authorization change.
