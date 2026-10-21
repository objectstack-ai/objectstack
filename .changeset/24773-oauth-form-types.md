---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the OAuth application register form offers only Web and Native, and its Redirect URLs help states the rule for each (#24773)

Clause-②: no (a form's offering: the register route still accepts every type value it accepted, and nothing on the server reads the action's param options, so no accept set or served shape moves)

Setup › OAuth Applications › Register offered four application types: Web, Native, User-agent based and Public. The OAuth provider judges only `web` and `native`, so the register route registers the other two as `web`, with a client secret. The form now offers Web and Native, and still defaults to Web.

- **Redirect URLs help.** It said "Must use https:// in production", which did not tell an admin that a local `http://localhost` callback needs the Native type. It now states the rule for each type: a Web application needs `https://` on a host other than localhost or another loopback address; a Native application may also use `http://` on exactly `localhost`, `127.0.0.1` or `[::1]`, on any port.
- **Application Type help.** New: choose Native for a desktop or mobile app, or for an app in local development that redirects to `http://localhost`.
- **Unchanged.** The register route accepts the same values as before, including `user-agent-based` and `public`. The stored `sys_oauth_application.type` column still lists all four values, so a row written under an earlier provider line keeps its value. The `public` column is unchanged.

The zh-CN, ja-JP and es-ES translations carry the new help texts.
