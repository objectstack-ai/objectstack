---
"@objectstack/plugin-email": patch
---

`@objectstack/plugin-email` declares `nodemailer` `^10.0.2` (was `^9.1.1`), clearing GHSA-6vj9-mwq6-2f5v (5.9): nodemailer's process-global DNS cache kept the TLS `servername` per host, so a second SMTPS transport to the same host could inherit the first transport's SNI and certificate identity and send its credentials to the wrong TLS virtual host. Every release from 5.0.0 through 10.0.1 is affected and the fix ships only in 10.0.2, so the 9.x line has no patched release and the major is taken.

Clause-②: no

No exported symbol, option key, payload key or accept/reject verdict of ours moves; the published surface is unchanged and grades `patch`. What an operator can see is nodemailer's own behaviour inside the 10.x line this range admits:

- **Node.js floor.** nodemailer 10 declares `node >= 20`. `@objectstack/core`, which this package depends on, already declares `node >= 22`, so no install that could load the plugin is excluded.
- **Module shape.** nodemailer 10 is a TypeScript rewrite shipping both ESM and CommonJS builds with bundled declarations. `SmtpTransport` loads it lazily and reads `createTransport` off the namespace or its `default`; measured on 10.0.2, 10.0.10, 10.0.11 and 10.0.12, both entry points expose it both ways, so the loader is unchanged.
- **Contradictory TLS flags in `transportOptions`.** From nodemailer 10.0.12 (the version a fresh install resolves today), `requireTLS` wins over `ignoreTLS` / `opportunisticTLS`. `SmtpTransport` sets `requireTLS` itself whenever TLS is on and the port is not 465. On such a port, a `transportOptions: { ignoreTLS: true }` escape-hatch override ran a cleartext session under nodemailer 9. It now performs the required STARTTLS upgrade or fails the send, which is the behaviour `secure: true` already documents. To connect in the clear on purpose, set `secure: false`.

The devDependency on `@types/nodemailer` is dropped: nodemailer 10 ships its own declarations, and TypeScript resolves `nodemailer` to them (`dist/esm/nodemailer.d.ts`) before any `@types` package.

The same sweep also moves two transitive packages. Neither release changes anything, and they are listed here so all seven findings can be read in one place. Both are workspace overrides in `pnpm-workspace.yaml`, and each dependent's declared range already admits the fixed version:

- `ip-address` 10.4.0 and 10.5.0 → one copy on `^10.5.1`, for GHSA-2vr4-cq9g-pvrc (6.9) and GHSA-rpw4-54j3-4h4q (6.3). It reaches the tree through `@modelcontextprotocol/sdk` → `express-rate-limit` and through `mongodb` → `socks`.
- `undici` 7.29.0 → `^7.29.1` (a target-only lift of the existing pin) and 8.9.0 → `^8.10.2` (a new 8.x selector), for GHSA-3wwx-pv8p-q78v (5.9). Both copies are dev-only, through `ai` and `jsdom`.

`osv-scanner.toml` keeps zero exemptions and is untouched.
