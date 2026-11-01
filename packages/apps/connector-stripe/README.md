# Stripe

Read Stripe customers, charges, invoices and payment intents from your flows.
The app calls the Stripe API (`https://api.stripe.com/`) through a connector
built from Stripe's own OpenAPI document, and exposes eight read operations as
connector actions. Nothing is written to Stripe.

## What it adds

- **A connector, `stripe`.** Its actions are Stripe's own operation ids, a
  list and a retrieve for each of four resources:

  | Resource | List | Retrieve |
  |:---|:---|:---|
  | Customers | `GetCustomers` (`GET /v1/customers`) | `GetCustomersCustomer` (`GET /v1/customers/{customer}`) |
  | Charges | `GetCharges` (`GET /v1/charges`) | `GetChargesCharge` (`GET /v1/charges/{charge}`) |
  | Invoices | `GetInvoices` (`GET /v1/invoices`) | `GetInvoicesInvoice` (`GET /v1/invoices/{invoice}`) |
  | Payment intents | `GetPaymentIntents` (`GET /v1/payment_intents`) | `GetPaymentIntentsIntent` (`GET /v1/payment_intents/{intent}`) |

  No other Stripe operation is in the package, so none can reach your flows
  or agents.
- **Two flows that use it**, ready to run or to copy:
  - `stripe_get_customer` takes a `customer_id` (for example `cus_123`) and
    returns Stripe's customer object as `customer.body`.
  - `stripe_list_open_invoices` takes a `customer_id` and returns that
    customer's open invoices, at most ten, as `invoices.body` (the invoices
    are in `invoices.body.data`).

The app adds no objects, no sample data and no demo users. An install adds the
connector and the two flows, and nothing else.

## Credentials

The app needs one credential. Until it is set, the `stripe` connector is listed
as disconnected and its flows fail, naming the credential.

| Credential | What it is | Where to get it | Permissions it needs |
|:---|:---|:---|:---|
| `STRIPE_RESTRICTED_KEY` | A Stripe restricted API key (it starts with `rk_live_`, or `rk_test_` in a sandbox), sent to Stripe as `Authorization: Bearer <key>` | Stripe Dashboard → **Developers → API keys** (<https://dashboard.stripe.com/apikeys>) → create a restricted key | **Read** on Customers, Charges, Invoices and PaymentIntents, and no other permission |

Use a restricted key, not your secret key (`sk_…`): a restricted key carries
only the permissions you give it, and this app only reads. A request for a
resource the key has no permission for is refused by Stripe with HTTP 403. The
step does not fail on it: the answer lands as `<nodeId>.status` 403,
`<nodeId>.ok` false and Stripe's error in `<nodeId>.body`, so a flow that
must stop on it checks `ok`.

Set the value in **Setup → Integrations → Connector Credentials**, or in the
install dialog right after installing. An environment variable named
`STRIPE_RESTRICTED_KEY` on the server takes precedence over a stored value.
Try the app with a sandbox key first; a live key reads your live account.

The key is only ever sent to Stripe. It is never stored in the app's metadata.

## Running it

```bash
curl -X POST "$OS_URL/api/v1/automation/stripe_get_customer/trigger" \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"params": {"customer_id": "cus_123"}}'
```

To use an answer elsewhere, add a `connector_action` node with
`connectorId: 'stripe'` to your own flow and read `<nodeId>.body` in a later
node. An action takes its path parameters as one `path` object and its query
parameters as one `query` object, for example
`query: { dialect: 'cel', source: '{"customer": record.stripe_customer_id, "limit": dyn(10)}' }`
(a CEL map's values share one type, so a literal beside a field read is
wrapped in `dyn(…)`).

## Limits

- Read only. The package carries Stripe's GET operations for four resources
  and nothing else; Stripe's write operations take form-encoded bodies, which
  this connector does not send.
- Query parameters are sent by the `style` the document declares. Stripe's
  `deepObject` parameters go out bracketed: a `created` range
  `{ gte: 1700000000 }` as `created[gte]=1700000000`, and an `expand` list as
  `expand[0]=…&expand[1]=…`, one index per element. Stripe's answer to these
  encodings is not measured here (the tests run against a fake Stripe).
- The response schemas in the packaged document are not expanded (see
  Provenance): each response is described as its Stripe object type, without
  its fields. The answer itself is Stripe's full JSON.

## Provenance

`openapi/stripe.openapi.json` is generated, not written by hand. It is
Stripe's OpenAPI document, `stripe/openapi` `openapi/spec3.json` at commit
`51610f5f061c9723730582a7638b8cc0e646640d` (OpenAPI 3.0.0, API version
`2026-09-30.endive`, 612 operations), trimmed to the eight operations above by
this repository's offline normalizer:

```bash
pnpm --filter @objectstack/connector-openapi normalize-openapi \
  --in https://raw.githubusercontent.com/stripe/openapi/51610f5f061c9723730582a7638b8cc0e646640d/openapi/spec3.json \
  --include-pattern '^Get(Customers(Customer)?|Charges(Charge)?|Invoices(Invoice)?|PaymentIntents(Intent)?)$' \
  --trim --max-depth 0 \
  --out packages/apps/connector-stripe/openapi/stripe.openapi.json
```

It printed 47,094 bytes, 8 operations trimmed from 612, 17 schema references
cut at `--max-depth 0` and none left, and sha256
`3aec4b32c8cda2adeb5abb8393f02c63ecaf02ce78ca8bacd697f20edb4b2ca5`, the hash
of the committed file. The package's tests recompute that hash and fail when
the file and this record disagree.

`--max-depth 0` keeps every parameter schema as Stripe wrote it, since those
are what a flow's input is checked against, and replaces each named response
schema with its type, title and description. At the default depth of 2 the
same eight operations write 2,574,259 bytes.

Re-normalize from a newer commit by running the command with that commit,
then update the commit and the sha256 here in the same change. Stripe's
document is MIT-licensed; its licence notice is `openapi/LICENSE`.
