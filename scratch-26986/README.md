# #26986 step 1 — evidence for the F2–F6 re-measurement (scratch, never merged)

- objectstack `origin/main` `604a2b3b9a5a`, built (`turbo run build --filter=@objectstack/cli... --filter=@objectstack/runtime...`)
  and symlinked into `node_modules/@objectstack/*` of a scratch worktree of hotcrm `main` `6961ab1`.
- The knob (`hotcrm-scratch-absence.ts.txt`, wired by `hotcrm-scratch-knob.patch.txt`) is the ledger's
  `HOTCRM_ABSENT` knob, shape B: `HOTCRM_ABSENT=revenue|marketing|service` drops the module stack, and
  `HOTCRM_PEEL=perms,i18n,actions,widgets,lookups,flowtarget` peels the referrers already recorded so the next gate shows.
- `HOTCRM_PROBE=ext,action,flow,hook` (`hotcrm-scratch-probe.ts.txt`) adds to the marketing module one
  item per contribution shape onto the app object `crm_opportunity`.
- `validate-readings.txt` and `runtime-log-readings.txt` are the filtered outputs.

## HTTP readings (dev admin, `objectstack dev -p 4001 --no-watch --fresh`)

### Module absent (revenue or marketing stack dropped, peel `perms,i18n,refs`)

| Probe | Answer |
|---|---|
| `DELETE /api/v1/data/crm_contact/ID` (revenue absent, fresh contact) | **404** `{"error":"Object 'crm_quote' is not registered","code":"OBJECT_NOT_FOUND","object":"crm_quote"}` |
| `PATCH crm_opportunity` *Lattice Student Success Platform* → `closed_won` + `win_reason` (revenue absent) | **200**; log `ERROR Trigger-fired run of flow 'billing_handoff_closed_won' failed … "Node 'load_line_items' failed: get_record(crm_opportunity_line_item) failed: Object 'crm_opportunity_line_item' not found"` |
| `PATCH crm_contract` CTR-0002 → `activated` (revenue absent) | **200**; same failure on `billing_handoff_contract_activated` |
| boot seed (marketing absent) | 11× `ERROR [hook] handler failed (onError=log; suppressing) {"hook":"campaign_attribution_refresh",…,"error":"Object 'crm_campaign_member' not found"}` (5 afterInsert, 6 afterUpdate) |
| *Convert Lead* CloudFirst Inc, resume `createOpportunity:false` (marketing absent) | **200**, lead `converted`; log `ERROR [hook] … "campaign_lead_conversion_refresh" … "Object 'crm_campaign_member' not found"` |

### Module disabled (whole artifact, `PATCH /api/v1/packages/app.objectstack.hotcrm.{revenue,marketing}/disable` → 200)

| Probe | Answer |
|---|---|
| `DELETE crm_contact` (fresh contact) | **200** `{"success":true}` |
| `GET /api/v1/data/crm_quote` · `crm_opportunity_line_item` · `crm_campaign` | **404** `OBJECT_PACKAGE_DISABLED` each |
| `closed_won` on *Lattice…*; CTR-0002 → `activated` | **200**; runs of `billing_handoff_closed_won` and `billing_handoff_contract_activated` `completed`; 0 ERROR lines after the disable |
| *Convert Lead* CloudFirst Inc; `PATCH crm_opportunity next_step` | **200** each; 0 hook ERROR lines |
| `GET /api/v1/meta/action/{generate_quote,create_campaign,add_contact_to_campaign}` | **404** each (withheld) |
| `GET /api/v1/meta/object/crm_product`, `/meta/dataset/product_metrics` | **404** each; the served dashboard keeps `top_products` with `requiresObject: "crm_product"` |
| `GET /api/v1/meta/object/crm_opportunity` → `fields.crm_campaign` | still served: `lookup → crm_campaign`, not hidden, not readonly; a record keeps its raw id `ec-suAeSwUsdgnT0` |

### Contribution probes (marketing module → app object `crm_opportunity`)

| Probe | `os validate` (all present) | enabled | marketing disabled |
|---|---|---|---|
| `objectExtensions` adds `probe_campaign: Field.lookup('crm_campaign')` | exit 0 | field served `lookup → crm_campaign` | field **not served** |
| top-level action `objectName: 'crm_opportunity'`, `type: 'flow'`, alone | exit 1 G1 "Action 'probe_enroll_from_opp' references object 'crm_opportunity' which is not defined in objects." | — | — |
| the same action beside the extension | exit 0 | `/meta/action/probe_enroll_from_opp` 200 | 404 |
| `record_change` flow, start `objectName: 'crm_opportunity'` | exit 0, **warning** `flow-trigger-unknown-object` | fires: run `completed` | **still fires**: a second run `completed` |
| hook `object: 'crm_opportunity'` | exit 1 G1 "Hook 'probe_module_hook_on_app_object' references object 'crm_opportunity' which is not defined in objects." | — | — |
