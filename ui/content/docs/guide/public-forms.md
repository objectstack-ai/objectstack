---
title: "Public Forms"
description: "Embed hardened public-facing forms — contact, lead capture, signup — with built-in anti-spam, GDPR consent, prefill whitelist, and open-redirect protection."
---

# Public Forms

`@object-ui/plugin-form` ships an `EmbeddableForm` component that renders a
public-facing form (contact us, lead capture, signup, RSVP) with the security
defaults you'd expect from Airtable Forms, Typeform or HubSpot Forms — without
asking app authors to bolt them on themselves.

The console exposes a turnkey route at `/f/:slug` (`FormPage`) that loads
a `FormView` spec from the server's `GET /api/v1/forms/:slug` resolver and
renders the merged form. The same component also serves authed internal
forms at `/forms/:name` (`mode="internal"`), reading the FormView spec
from `/api/v1/meta/view/:name` and posting to `/api/v1/data/:object`.

## Quick start

```tsx
import { EmbeddableForm } from '@object-ui/plugin-form';
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({ baseUrl: 'https://api.example.com' });

<EmbeddableForm
  config={{
    formId: 'contact-us',
    objectName: 'lead',
    title: 'Contact us',
    description: "We'd love to hear from you.",
    customFields: [
      { name: 'name',    label: 'Full name', type: 'text',  required: true },
      { name: 'email',   label: 'Email',     type: 'email', required: true },
      { name: 'message', label: 'Message',   type: 'textarea', rows: 4 },
    ],
    consent: { required: true },
    privacyPolicyUrl: '/legal/privacy',
    allowedPrefillFields: ['email'],
    allowedRedirectHosts: ['example.com', '*.example.com'],
    thankYouPage: {
      title: 'Thanks!',
      message: "We'll get back to you shortly.",
      redirectUrl: 'https://example.com/thank-you',
    },
  }}
  dataSource={dataSource}
/>
```

## Security defaults (at a glance)

| Defence | Default | Config key |
| --- | --- | --- |
| **Honeypot field** (silent fake-success on bots) | On | `honeypot` (string to rename, `false` to disable) |
| **Min-fill-time guard** | 1500 ms | `minFillTime` (ms, `0` to disable) |
| **URL prefill whitelist** | _none_ — prefill is fully off | `allowedPrefillFields: string[]` |
| **Open-redirect guard** | Same-origin only | `allowedRedirectHosts: string[]` (supports `*.example.com`) |
| **Default `maxLength`** | text 200 · email 254 · url 2048 · phone 32 · textarea/markdown/html 5000 | Per-field `maxLength` overrides |
| **GDPR consent gate** | Off (opt-in) | `consent: { required, label }` + `privacyPolicyUrl` |
| **CAPTCHA token** | Off (opt-in) | `captchaToken` (string sent as `_captcha`) |
| **Demo mode (`?demo=1`)** | DEV only | gated by `import.meta.env.DEV` in `EmbeddableForm` consumers |

All gates run **before** the network call. If the consent gate or min-fill
timer trips, the backend is never contacted. The honeypot silently shows the
thank-you page so bots can't tell they failed.

## Configuration reference

```ts
import type { FormField } from '@object-ui/types';
import type { EmbeddableFormTexts } from '@object-ui/plugin-form';

interface EmbeddableFormConfig {
  formId: string;
  objectName: string;
  title?: string;
  description?: string;

  // Fields — either from a registered schema or inline
  fields?: string[];
  customFields?: FormField[];

  // Anti-spam
  honeypot?: string | false;            // field name (default '_company_website_2'), false disables
  minFillTime?: number;                 // ms before submit allowed (default 1500)
  captchaToken?: string;                // forwarded as payload._captcha

  // Prefill & redirect hardening
  allowedPrefillFields?: string[];      // empty/undefined → no URL prefill
  allowedRedirectHosts?: string[];      // supports '*.example.com'

  // GDPR
  consent?: { required?: boolean; label?: string };
  privacyPolicyUrl?: string;

  // UI
  branding?: { logo?: string; primaryColor?: string; coverImage?: string };
  thankYouPage?: { title?: string; message?: string; redirectUrl?: string; redirectDelay?: number };
  texts?: EmbeddableFormTexts;          // i18n-friendly string overrides
}
```

### URL prefill (safe-by-default)

Public form URLs are user-controlled, so prefill is **off** unless you
explicitly opt fields in:

<!-- doc-snippet: fragment — the quick-start element again with its `config` elided down to the one key this section adds; `EmbeddableForm` is the import made there -->

```tsx
<EmbeddableForm
  config={{
    /* … */
    allowedPrefillFields: ['email', 'utm_source'],
  }}
/>
```

With the snippet above, visiting `/f/contact?email=alice@x.com&secret=foo`
fills the `email` field and silently ignores `secret`. The
`prefillParams` prop (used by trusted hosts such as the console)
bypasses this whitelist.

### Open-redirect guard

`thankYouPage.redirectUrl` is validated against the current origin **plus**
`allowedRedirectHosts` before navigation. Wildcards like `*.example.com`
match subdomains; the apex itself must be listed explicitly. Dangerous
schemes (`javascript:`, `data:`) are always rejected.

The thank-you panel follows that verdict rather than the declaration: the
`Redirecting in N seconds…` line appears only for a destination that was
**accepted**, and reads its countdown from the delay that destination was
accepted with. When the destination is refused the line is omitted, and
`texts.redirectBlocked` — if you declared it — is shown in the panel instead;
leave it undeclared and the panel stays silent. Either way the refusal is
logged with `console.warn`, which is where to look if a redirect you expected
never happens.

### Who performs the redirect (mounted hosts)

The guard decides **whether** a destination is followed; who travels to it
depends on the shape of the destination:

| Destination | Travelled by |
|---|---|
| App-relative — `/thanks`, `thanks`, `?ok=1`, `#done` | the host's navigate, when one is supplied; otherwise a browser navigation |
| External — a host you listed in `allowedRedirectHosts` | a browser navigation, always |
| Same-origin but **absolute** — `https://your.app/thanks` | a browser navigation, always |

This matters when your application is mounted at a sub-path (the console runs
at basename `/_console`). A browser navigation resolves `/thanks` against the
**origin root**, which leaves the application — so an in-app thank-you page
needs the host to place the path. Supply one with `HostNavigationProvider`
from `@object-ui/react` and the form hands app-relative destinations to it:

```tsx
import { HostNavigationProvider } from '@object-ui/react';
import { EmbeddableForm, type EmbeddableFormConfig } from '@object-ui/plugin-form';
import type { DataSource } from '@object-ui/types';

export function MountedPublicForm(props: {
  /** Your own router's navigate — it already knows the basename. */
  navigate: (to: string) => void;
  config: EmbeddableFormConfig;
  dataSource: DataSource;
}) {
  return (
    <HostNavigationProvider value={{ navigate: props.navigate }}>
      <EmbeddableForm config={props.config} dataSource={props.dataSource} />
    </HostNavigationProvider>
  );
}
```

Supplying it is optional and changes nothing for an unmounted host: with no
provider — or with no router at all, where there is no basename to miss —
every destination keeps the browser navigation it always had.

An external destination is never handed to your navigate. A host navigate is a
client-side router transition, so it takes an application-relative path, and a
form holding a cross-origin address must not route it through your router. A
same-origin **absolute** URL is treated the same way for a different reason:
you spelled out the whole address, so that is the address the submitter gets —
write the destination relatively if you want it placed inside your mount.

### GDPR consent

<!-- doc-snippet: fragment — two bare config properties, shown on their own: they belong inside the `config` object of the quick-start block and are not a program -->

```tsx
consent: { required: true, label: 'I agree to the privacy policy.' }
privacyPolicyUrl: '/legal/privacy'
```

When `required: true`, submitting before the box is ticked shows
`texts.consentRequired` and the network call is suppressed.

### Honeypot

The hidden input is rendered off-screen with `tabIndex={-1}` and
`autocomplete="off"`. Bots that blindly fill every field trigger a
**silent fake-success** — the visitor sees the thank-you screen, but
`dataSource.create()` is never called. Honeypot data is also stripped
from the payload defensively.

### Min-fill-time

Genuine users take more than ~1.5 s to read and fill a form. Faster
submissions are soft-rejected with `texts.rateLimited` rather than a
hard error, so legit speed-typers can simply retry.

### CAPTCHA hook

`EmbeddableForm` doesn't bundle a specific provider. Mount your
preferred widget (hCaptcha, Turnstile, reCAPTCHA) and feed the token in:

<!-- doc-snippet: fragment — the captcha widget, `useState` import and data source are the reader's own, and the `config` object is elided down to the one key this section adds -->

```tsx
const [token, setToken] = useState<string>();
<EmbeddableForm config={{ /* … */ captchaToken: token }} dataSource={ds} />
```

The token is forwarded as `payload._captcha` for server-side validation.

## i18n

`EmbeddableForm` is i18n-agnostic — every user-visible string is
overridable via `config.texts: EmbeddableFormTexts`. The console wires
this up through `@object-ui/i18n`:

<!-- doc-snippet: fragment — `t` comes from the console's own i18n provider and the `config` object is elided down to the `texts` key this section is about -->

```tsx
const { t } = useObjectTranslation();
<EmbeddableForm config={{
  /* … */
  texts: {
    submit:           t('publicForm.submit'),
    submitting:       t('publicForm.submitting'),
    consentRequired:  t('publicForm.consentRequired'),
    rateLimited:      t('publicForm.rateLimited'),
    redirectBlocked:  t('publicForm.redirectBlocked'),
    requiredHint:     t('publicForm.requiredHint'),
    /* … */
  },
}} />
```

## Console route — `/f/:slug` and `/forms/:name`

The console's `FormPage` component renders both modes from the same
spec-merging code path:

- **`/f/:slug`** (public, anonymous) — loads `GET /api/v1/forms/:slug` which
  resolves the `FormView` whose `sharing.publicLink` matches the slug, then
  submits to `POST /api/v1/forms/:slug/submit`.
- **`/forms/:name`** (internal, authed) — loads `GET /api/v1/meta/view/:name`
  for the FormView spec plus `GET /api/v1/meta/object/:object` for field
  metadata, then submits to `POST /api/v1/data/:object` with the
  authenticated session cookie.
- **`/apps/:appName/forms/:name`** (internal, authed) — the same form inside
  the app the URL names, with that app's sidebar and branding. A
  `type: 'form'` action opens here when it is fired from an app route (a
  record page, an object list or a page). The app-less `/forms/:name` serves
  every other link, cold deep links included.

URL parameters of the form `?prefill_<field>=<value>` populate the matching
fields on mount; the rest of the chrome (label, section columns, post-submit
behaviour) comes from the `FormView` spec itself. The heading is the view's
label or the form's `title`; a form with neither is headed by its object's
label, and the object's API name is used only when no label is available at
all. The internal form also has a Cancel, which goes back to the page the form
was opened from, or, on a cold link, to the record being edited, else to the
app's home (Home on the app-less route).

For richer public forms with anti-spam, GDPR consent, prefill whitelisting
and open-redirect protection, host `EmbeddableForm` directly inside your own
route — see the Quick start above.

## Testing

Pure helpers (`isRedirectUrlSafe`, `applyDefaultMaxLengths`) are exported
from `@object-ui/plugin-form` for unit testing. See
`packages/plugin-form/src/__tests__/EmbeddableForm.test.tsx` for the
reference test suite covering all gates.
