---
'@objectstack/cli': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(cli,i18n,console): the hosted product reads "ObjectOS Cloud" everywhere a user reads it; the Community Console carries a "Powered by ObjectStack" mark

Clause-②: no
Metadata-protocol: none

ObjectOS is one product in three editions — Community (this repository's runtime and Console, open source), Cloud (cloud.objectos.ai) and Enterprise — and ObjectStack is the name of the protocol, SDK, CLI and framework. The hosted product is "ObjectOS Cloud" wherever a user reads it; it was still "ObjectStack Cloud" in the CLI and in the Console's cloud-install strings.

- **`@objectstack/cli`.** `os cloud login`, `os cloud logout`, `os cloud whoami`, `os package publish` and `os plugin publish` say "ObjectOS Cloud" in their `--help` descriptions, their `--url` / `--server` / `--token` / `--visibility` flag descriptions, their headers and their "Not logged in" prescriptions; so do the `os serve` welcome page's link to the cloud console and the shared "Authentication required" message. The CLI README and the deployment CLI reference follow. Internal identifiers are unchanged: `~/.objectstack/cloud.json`, `OS_CLOUD_API_KEY`, `OS_CLOUD_URL`, the `os cloud …` command names.
- **`@object-ui/i18n`.** The cloud-connection "Connected to …" title and the three cloud-install dialog sentences ("You need to be signed into …", "… sign into … first") name "ObjectOS Cloud" in all ten locales, the product name kept untranslated inside each locale's sentence. New key `auth.shell.poweredBy` ("Powered by ObjectStack") in all ten locales.
- **`@object-ui/app-shell`.** New `isDefaultProductName()`: true while the deployment carries the default `branding.productName` ("ObjectOS"), false once a runtime has pushed its own.
- **`@object-ui/console`.** The sign-in layout (login, register, forgot/reset password, verify email, setup, consent, device, invitation) shows a small "Powered by ObjectStack" link to objectstack.ai under the form when `isDefaultProductName()` is true. A deployment that pushes its own product name — ObjectOS Cloud, Enterprise, a cloud-connected workspace — shows its own name and no second brand line. The default product name, `logo.svg`, `manifest.json` and `admin@objectos.ai` are unchanged.

What to do: nothing. An operator who rebrands the Console through `branding.productName` keeps a single brand line, as before.
