---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec, cli): an application contributes its own first-run credentials to the development boot banner — `devHint` / `devLogins[]` (#17556)

Clause-②: yes (widening)

## What an operator sees

`os dev` seeds a platform admin on an empty DB, and the banner prints it as the only
credential a first-run operator is handed. #17081 made that line honest about what the
account *cannot* see; it could not name an account that *can*, because the platform does
not know an application's audiences. Measured on a downstream app, of five personas the
four it seeds each rendered their navigation group and the one the banner printed
rendered none — and the operator read the empty shell as a broken product.

Two new top-level keys on the stack definition close that. Declaring either adds a block
BENEATH the seeded-admin lines, on a development boot only:

```
  🔑  Dev admin: admin@objectos.ai / admin123
      seeded on empty DB · dev only — do not use in production
      platform admin — Setup, Studio and every record, but NO app-declared capability, so
      an app that gates navigation on requiredPermissions may show it an empty menu; grant
      it a permission set under Setup → Users, or sign in as an account your app seeds

  👥  App logins: 2 declared by this app
      Hiring admin — admin@quillstone.example / demo1234
      Job seeker — candidate01@mail.example / demo1234
      declared in this app's `devLogins` · dev only — the platform seeded none of them

  💡  App hint:   run `pnpm seed:demo` first, then sign in as the Hiring admin
```

## What is writable that was not

The top-level stack door has been strict since #8687, so before this both spellings were
an `unrecognized_keys` refusal. The accept set gains exactly:

- **`devHint?: string`** — one sentence printed under the credential block. Composes as
  `'single'`: two stacks declaring different hints is a composition error naming the key,
  never a silent last-wins.
- **`devLogins?: DevLogin[]`**, where `DevLogin` is `{ email: string; password?: string;
  label?: string }`, closed against unknown keys from birth. Composes as `'concat'`, so
  composing two applications keeps both publishers' personas. An artifact ENVELOPE key
  like `plugins` / `devPlugins`: it stays at the top level and is refused inside
  `packages[].manifest`, because the banner's only reader looks at the top level.

`DevLoginSchema` / `DevLogin` / `DevLoginParsed` are exported from
`@objectstack/spec/system`. Nothing is renamed, nothing is retired, and no value that
parsed before is refused now.

## Three properties worth knowing before you author one

- **Declaring is not seeding.** An entry CREATES NOTHING: it names an account the
  application seeds by other means (`data` fixtures, `onEnable`, its own script) so the
  banner can point at one that shows something. An entry naming an unseeded account
  prints a credential that will not work, exactly as a README line would — which is why
  the banner says the application declared it.
- **Additive, never a replacement.** The seeded-admin block still prints, unchanged and
  first. An application-controlled key able to suppress a platform disclosure would let
  an app hide a live credential the operator was just handed.
- **Development only, and scrubbed.** The block renders only under `os dev`,
  `objectstack serve --dev` or `NODE_ENV=development`; any other boot is byte-identical
  to one declaring nothing. The values are author-controlled text reaching a terminal, so
  every C0/C1 control byte is replaced with U+FFFD before printing — an escape sequence
  in a hint cannot erase the rows above it or repaint a forged `🔑 Dev admin` row. ⚠️
  Whatever is written here is committed to the application's repository and printed to a
  terminal: it is a development fixture, never a real secret.
