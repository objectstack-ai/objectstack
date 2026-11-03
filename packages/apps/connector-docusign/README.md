# DocuSign eSignature

Send documents out for signature, read envelopes and follow their signature
status from your flows. The app calls DocuSign's eSignature REST API in the
DocuSign **developer sandbox** (`https://demo.docusign.net/restapi`) through a
connector built from DocuSign's own OpenAPI document, and exposes three
envelope operations as connector actions. It signs in to DocuSign with OAuth,
using an integration key your administrator registers for your deployment:
the app carries no key of anyone's.

## What it adds

- **A connector, `docusign`.** Its actions are DocuSign's own operation ids:

  | Action | Request | What it does |
  |:---|:---|:---|
  | `Envelopes_PostEnvelopes` | `POST /v2.1/accounts/{accountId}/envelopes` | Creates an envelope; with `status: "sent"` DocuSign emails it to the signers at once |
  | `Envelopes_GetEnvelope` | `GET /v2.1/accounts/{accountId}/envelopes/{envelopeId}` | Reads one envelope, its `status` included |
  | `Envelopes_GetEnvelopes` | `GET /v2.1/accounts/{accountId}/envelopes` | Lists envelopes, for example those whose status changed since `from_date` |

  No other DocuSign operation is in the package, so none can reach your flows
  or agents.
- **An object, `docusign_envelope`**, one record per envelope the app sent:
  `envelope_id` (DocuSign's envelope id), `signature_status` (DocuSign's own
  status word: `sent`, `delivered`, `completed`, `declined`, `voided`, …),
  `email_subject` and `status_changed_at`. The status is DocuSign's, mirrored
  each time a flow below reads it. Its list view, **DocuSign Envelopes**,
  shows the newest status change first.
- **Three flows that use them**, ready to run or to copy:
  - `docusign_send_envelope` takes `account_id`, `email_subject`,
    `document_name` (for example `contract.pdf`), `document_base64`,
    `signer_name` and `signer_email`, sends the document to that signer and
    records the envelope. DocuSign's answer is the run's `send.body` output.
  - `docusign_get_envelope` takes `account_id` and `envelope_id`, reads the
    envelope and refreshes its record's `signature_status`. DocuSign's
    envelope is the run's `envelope.body` output.
  - `docusign_poll_status_changes` takes `account_id` and `from_date` (an ISO
    8601 instant), lists the envelopes whose status changed since then (at
    most 100) and copies each status onto its record. DocuSign's list is the
    run's `changes.body` output. See [Callbacks](#callbacks) for why this
    poll exists.

`account_id` is your DocuSign account's API account id (a GUID): in the
DocuSign developer console it is **API Account ID** on **Apps and Keys**.

An install adds the connector, the object, its list view and the three
flows, and nothing else: no sample data and no demo users.

## Credentials

The app needs one OAuth client, which **you register with DocuSign for your
own deployment**. ObjectStack ships none: a DocuSign OAuth client is an
integration key that accepts only the redirect URIs registered on it, and the
redirect URI belongs to your deployment. Until an administrator connects the
`docusign` connector, it is listed as degraded "not connected" and its flows
fail, naming the connector.

| What | What it is | Where to get it |
|:---|:---|:---|
| Integration key | DocuSign's client id for your app (a GUID) | DocuSign developer console (<https://admindemo.docusign.com/apps-and-keys>) → **Apps and Keys** → **Add App and Integration Key** |
| Secret key | The client secret DocuSign issues for that integration key, shown once | The same app → **Authentication** → **Add Secret Key** |
| Redirect URI | Your deployment's OAuth callback, which DocuSign must accept | The connector's connection read (below); register it on the same app under **Additional settings** → **Redirect URIs** |

1. Read your deployment's redirect URI. It is your deployment's origin plus
   `/api/v1/automation/connectors/oauth/callback`, and the server answers the
   exact value, before any client exists, as `redirectUri` of
   `GET /api/v1/automation/connectors/docusign/connection`; the Console's
   **Connect** dialog (step 3) shows the same value. Use that answer, never
   your browser's address bar: behind a proxy, or when `OS_AUTH_URL` /
   `OS_BASE_URL` name another origin, the two differ.
2. In the DocuSign developer console, add an app and integration key, choose
   **Authorization Code Grant**, add a secret key, and add the redirect URI
   from step 1. The app needs the `signature` scope, which is DocuSign's
   default for the authorization code grant.
3. Connect the connector: on **Setup → Integrations → Connector Connections**,
   choose **Connect** on `docusign` and enter the integration key and the
   secret key; or begin the connect yourself with
   `POST /api/v1/automation/connectors/docusign/connection` and a body of
   `{ "clientId": "<integration key>", "clientSecret": "<secret key>" }`, then
   open the `authorizationUrl` it answers. Sign in to DocuSign and allow
   access; DocuSign returns to your redirect URI and the connection is
   stored.

Connecting takes the organization-scoped `manage_connector_connections`
capability (organization owners and admins hold it), from a signed-in
session; an agent or an API key is refused. Each organization connects once.
The platform keeps the integration key and its secret encrypted on the
organization's connection, shows the key but never the secret, and uses them
for the authorization, the code exchange and every token refresh. A reconnect
that names no client reuses the stored one; disconnecting removes it.

The token is only ever sent to DocuSign. Neither it nor your secret key is
stored in the app's metadata.

## Running it

```bash
curl -X POST "$OS_URL/api/v1/automation/docusign_send_envelope/trigger" \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"params": {"account_id": "<API account id>", "email_subject": "Please sign the contract",
       "document_name": "contract.pdf", "document_base64": "<the PDF, base64>",
       "signer_name": "Ada Lovelace", "signer_email": "ada@example.com"}}'
```

To use an answer elsewhere, add a `connector_action` node with
`connectorId: 'docusign'` to your own flow and read `<nodeId>.body` in a later
node. An action takes its path parameters as one `path` object, its query
parameters as one `query` object and its request body as one `body` value,
for example
`path: { dialect: 'cel', source: '{"accountId": record.docusign_account_id, "envelopeId": record.envelope_id}' }`.

A contract app that follows its own records' signatures keeps the same two
fields on its record (`envelope_id`, `signature_status`) and copies them from
the `docusign_envelope` record, or from the action's answer, in its own flow.

A DocuSign error answer does not fail the step: it lands as
`<nodeId>.status`, `<nodeId>.ok` false and DocuSign's error in
`<nodeId>.body`. The three flows check `ok` and write no record when DocuSign
refused the call.

## Callbacks

DocuSign can post envelope events to a URL you name (DocuSign Connect). This
app does **not** take those posts, and you should not point Connect at a
deployment's `api` flow door: Connect signs each post with its own HMAC
header, and the `api` door verifies only the platform's own signature
scheme, so a Connect post cannot be told from a forged one there. Until the
platform verifies vendor callback schemes, follow status changes by polling:
run `docusign_poll_status_changes` on a schedule, passing the time of the
previous run as `from_date`, or `docusign_get_envelope` for one envelope.

## Limits

- **Sandbox only.** The connector points at DocuSign's developer environment:
  sign-in at `account-d.docusign.com`, API calls at `demo.docusign.net`. A
  production DocuSign account signs in at `account.docusign.com` and has an
  API host of its own (DocuSign answers it as `base_uri` from
  `/oauth/userinfo`), which this package cannot name for you; production is
  not supported yet.
- One document and one signer per `docusign_send_envelope` run. The action
  itself takes DocuSign's whole envelope definition; copy the flow to send
  more.
- `docusign_poll_status_changes` reads one page of at most 100 changed
  envelopes. Poll often enough that one page covers the interval.
- Not measured live: the tests run against a fake DocuSign. A round trip
  against the DocuSign sandbox (connect, send, read, poll) is owed to the
  acceptance run, and the DocuSign console steps under Credentials follow
  DocuSign's documentation.
- The request body and response schemas in the packaged document are not
  expanded (see Provenance): `Envelopes_PostEnvelopes` takes DocuSign's
  envelope definition as one JSON object, described by its type and
  description only, so its fields are DocuSign's documented ones (the
  `docusign_send_envelope` flow shows the minimal set). The answer itself is
  DocuSign's full JSON.

## Provenance

`openapi/docusign-esignature.openapi.json` is generated, not written by hand.
It is DocuSign's eSignature REST API document,
`docusign/OpenAPI-Specifications` `esignature.rest.swagger-v2.1.json` at
commit `858a3ae59b0edbc8beea4fa3a6d7fe803833dd68` (Swagger 2.0, 414
operations), converted to OpenAPI 3.0 and trimmed to the three operations
above by this repository's offline normalizer:

```bash
pnpm --filter @objectstack/connector-openapi normalize-openapi \
  --in https://raw.githubusercontent.com/docusign/OpenAPI-Specifications/858a3ae59b0edbc8beea4fa3a6d7fe803833dd68/esignature.rest.swagger-v2.1.json \
  --include-pattern '^Envelopes_(PostEnvelopes|GetEnvelope|GetEnvelopes)$' \
  --trim --empty-consumes application/json --max-depth 0 \
  --out packages/apps/connector-docusign/openapi/docusign-esignature.openapi.json
```

It printed OpenAPI 3.0.4, 304,080 bytes, 3 operations trimmed from 414, 187
empty `consumes` lists filled with `application/json`, 7 schema references cut
at `--max-depth 0` and none left, and sha256
`b741ded5cfc4d0291d7f0e26559f8583f8c9a783f8711d8f9a98405cb27f7cb4`, the hash
of the committed file. The package's tests recompute that hash and fail when
the file and this record disagree.

`--max-depth 0` keeps every parameter schema as DocuSign wrote it, and
replaces each named schema (the envelope definition the create operation
takes, and each response) with its type, title and description. At the
default depth of 2 the same three operations write 553,922 bytes (sha256
`e1051eb4bbc381d879e979beac8cb64ead24531c93a19fc26e950a12d9fc961d`), with the
envelope definition's fields expanded two levels.

`--empty-consumes application/json` is required: DocuSign's document clears
the request media type on its operations (`consumes: []`), which would leave
`Envelopes_PostEnvelopes` with no request body at all. The document's
`servers[0].url` is DocuSign's production host,
`https://www.docusign.net/restapi`; the connector's `providerConfig.baseUrl`
points it at the sandbox instead. The document declares no security scheme,
so the OAuth token is sent on every operation.

Re-normalize from a newer commit by running the command with that commit,
then update the commit and the sha256 here in the same change. DocuSign's
document is MIT-licensed; its licence notice is `openapi/LICENSE`.
