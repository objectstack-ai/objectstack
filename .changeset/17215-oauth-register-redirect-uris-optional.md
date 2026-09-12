---
"@objectstack/client": minor
---

fix(client): `oauth.applications.register` declares `redirect_uris` optional, matching the body schema of the route it posts to (#17215)

`ObjectStackClient.oauth.applications.register` declared `redirect_uris` **required**. `POST /api/v1/auth/oauth2/create-client` is mounted verbatim from `@better-auth/oauth-provider`, and that route's body schema declares the member **optional** — so a request the route accepts had no spelling through this SDK. The caller never got a wrong answer; they got a call they could not write.

## What changes for a caller

Nothing they have to do. Every existing call still compiles — this only *adds* spellings:

```ts
// now expressible, and accepted by the route:
await client.oauth.applications.register({ client_name: 'My App' });

// unchanged, and still the right call when you have redirect URIs:
await client.oauth.applications.register({
  client_name: 'My App',
  redirect_uris: ['https://app.example.com/cb'],
});
```

⛔ Not breaking in this direction — relaxing a required member to optional keeps every existing call valid. Tightening it back later would be breaking, which is why the parity is now pinned.

## Measured at runtime, not read off a `.d.ts`

The vendor body schema was re-introspected the way the card's original measurement was taken: instantiate `oauthProvider()`, walk `endpoints`, find the endpoint whose `path` is `/oauth2/create-client`, read `options.body`. At the installed **1.7.3** (the card measured 1.7.2; the package has since moved) the object still declares **21 members and every one of them is optional**, and `body.safeParse({ client_name: '…' })` succeeds with `redirect_uris` absent.

⚠️ Optional does **not** mean an empty array will do: the vendor refuses `[]`, so when the member is present it must be non-empty. Omitting it and passing `[]` are different requests and only the first is legal. Nor does it mean a client registered without redirect URIs is *usable* — it cannot complete an `authorization_code` flow. The type states what the route accepts, never that every accepted call yields a client fit for every grant; the docblock now says both.

## Why it was required, for the record

Not as a guard. It is residue from the method's first commit, which declared `client_name` required too; the same-day follow-up relaxed `client_name` and left this one behind. No comment, test, ADR or review thread ever asserted a reason for it — which is exactly why it read as a defect to the next auditor.

Nothing else on the signature moves: the other ten members are byte-identical.
