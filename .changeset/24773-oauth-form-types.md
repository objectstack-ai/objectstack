---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the OAuth application register form offers only Web and Native, and its Redirect URLs help states the rule for each (#24773)

Clause-②: no (a form's offering: nothing on the server reads the action's param options, so this change moves no accept set or served shape; the register route's refusal of the other types is its own breaking entry in this release)

Setup › OAuth Applications › Register offered four application types: Web, Native, User-agent based and Public. The OAuth provider judges only `web` and `native`, and the register route refuses any other type with `400 INVALID_REQUEST`. The form now offers Web and Native, and still defaults to Web.

- **Redirect URLs help.** It said "Must use https:// in production", which did not tell an admin that a local `http://localhost` callback needs the Native type. It now states the rule for each type: a Web application needs `https://` on a host other than localhost or another loopback address; a Native application may also use `http://` on exactly `localhost`, `127.0.0.1` or `[::1]`, on any port.
- **Application Type help.** New: choose Native for a desktop or mobile app, or for an app in local development that redirects to `http://localhost`.
- **Unchanged.** The stored `sys_oauth_application.type` column still lists all four values, so a row written under an earlier provider line keeps its value. The `public` column is unchanged.

The zh-CN, ja-JP and es-ES translations carry the new help texts.
