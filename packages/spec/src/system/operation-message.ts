// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Operation Message Catalog
 *
 * The localized message templates for the data path's OPERATION-level
 * refusals — a write the engine declines as a whole, rather than a constraint
 * one field violated. Members today: the referential-integrity refusal
 * (`409 DELETE_RESTRICTED`, `cascadeDeleteRelations`'s `restrict` branch, #7307),
 * three `403 PERMISSION_DENIED` gates in plugin-security — the object CRUD
 * grant and the capability AND-gate (#7414, #7451), the row-level pre-image
 * write denial and the row-level CHECK post-image denial (#7451) — and two
 * `403 FORBIDDEN` refusals whose keys land ahead of their emitters (commit aa5994e17):
 * the sharing middleware's by-id write denial (`record_write_denied`; emitter
 * conversion is #12260's half) and plugin-approvals' non-submitter recall
 * refusal (`approval_recall_not_submitter`; emitter conversion is #11993's
 * half) — and the unique-constraint refusal (`409 UNIQUE_VIOLATION` on the
 * wire, the engine's `DuplicateRecordError`) — and the `userMessage` of the
 * master-detail write gate's `403 PERMISSION_DENIED` (ADR-0055 §3). The catalog is the seat for the rest of the family as they are
 * localized — a second mechanism for the second producer is exactly what this
 * module exists to prevent.
 *
 * ## One key per SITUATION, not per wire code (#7451)
 *
 * `DELETE_RESTRICTED` already carries two keys, and `PERMISSION_DENIED` now
 * carries three. The unit is the situation the USER is in, because that is what
 * decides what they can do next:
 *
 * | Key | The user's situation | What they can do |
 * |---|---|---|
 * | `permission_denied` | their permissions do not cover this action, on this object, at all | ask an administrator |
 * | `record_access_denied` | they may work with this kind of record, but not with THIS one | ask its owner, or an administrator |
 * | `record_change_not_allowed` | they may edit this record, but not into the state they just asked for | change what they entered |
 * | `record_write_denied` | they can see this record, but changing or deleting it is beyond their access | ask its owner, or an administrator |
 * | `approval_recall_not_submitter` | they asked to recall an approval request someone else submitted | ask the submitter, or an administrator |
 * | `record_owner_change_denied` | they tried to give this record a different owner (a transfer, or taking an unowned record they are not admitted to) | ask an administrator |
 * | `record_owner_assign_denied` | they tried to create a record owned by someone else | leave the owner blank or set it to themselves, or ask an administrator |
 * | `record_owner_remove_denied` | they tried to leave this record with no owner | ask an administrator |
 * | `record_queue_change_denied` | they tried to change which queue an existing record is in (put it in one, take it out, or move it to another) without the right to | ask an administrator |
 * | `record_queue_assign_denied` | they tried to create a record in a queue they do not belong to | leave the queue blank or choose one they belong to, or ask an administrator |
 * | `master_record_edit_denied` / `master_record_read_denied` (and their `_opaque` forms) | they wrote a `controlled_by_parent` record (a detail) without the edit access (or, where the detail asks it, the read access) its master record requires | ask the master record's owner, or an administrator |
 * | `field_edit_denied` / `field_edit_denied_opaque` | they changed a field their permissions do not let them edit | undo that change, or ask an administrator |
 * | `record_locked` (and its `_untitled`, `_unlabeled` and `_opaque` forms) | they tried to change a record an approval in progress holds | wait until that approval is complete |
 *
 * `record_write_denied` (commit aa5994e17) is NOT `record_access_denied` restated: the
 * sharing middleware's by-id write gate fires on a row the READ path already
 * admitted — the user is typically looking at the record it refuses — so
 * "You do not have access to this record" would be false the moment it
 * rendered. The situation is read-yes/write-no, and the honest next step is
 * asking the owner for edit access. It is one key for both write verbs
 * (update and delete) because the user's situation and remedy are the same;
 * which verb was refused is a developer fact that stays on
 * `developerMessage` and the structured `details`.
 *
 * `approval_recall_not_submitter` (commit aa5994e17) names who CAN act because that is
 * the entire content of the refusal: recall belongs to the request's
 * submitter (a privileged administrator may also recall to release a stuck
 * record — the #3424 override), so the sentence sends the user to the
 * submitter or an administrator instead of dead-ending them.
 *
 * `master_record_edit_denied` / `master_record_read_denied` are the
 * master-detail write gate's refusals (ADR-0055 §3, plugin-security): the
 * record the user is saving takes its access from a master record, and the
 * access they lack is on THAT record, so the sentence names the master's
 * object LABEL (`{{master}}`) and sends them to its owner. The `_opaque` forms
 * name no master: the gate uses them for a writer who cannot read the
 * master reference (the refusal's diagnostic names no master to them either)
 * and for a master object with no label, since an API name never reaches a
 * user. Which check refused, and which master row, stay on the diagnostic.
 *
 * The distinction the copy does NOT make is the internal one: a caller blocked
 * by a missing CRUD bit and a caller blocked by a missing `requiredPermissions`
 * capability are in the SAME situation (their grants do not cover the action;
 * an administrator fixes it), so both render `permission_denied`. Which of the
 * two gates answered is a developer fact, and it survives verbatim on
 * `developerMessage` and in the structured `details` — the place for it.
 *
 * ## Why this is a SEPARATE catalog from `validation-message.ts`
 *
 * The sibling catalog renders `FieldValidationError.message` and is addressed
 * as `validation.field.<messageKey>`, because every one of its entries names a
 * field and a constraint that field broke. A `DELETE_RESTRICTED` names neither:
 * the offending field is on a DIFFERENT object from the one the caller acted
 * on, the caller supplied no value, and there is no `fields[]` entry to hang it
 * off. Filing it under `validation.field.*` would give a deployment an override
 * key that lies about what it overrides, and would put an operation refusal in
 * the namespace form UIs scan for per-field copy. Same machinery, honest
 * address: `errors.<messageKey>` (see {@link operationMessageTranslationKey}).
 *
 * ## Why it exists at all (#7307)
 *
 * The restrict branch composed one English sentence with the API names
 * concatenated in, and REST ships `error.message` verbatim in the flat 409
 * envelope — which Console renders as-is in a toast. A business user deleting a
 * 「部门」 in a fully Chinese app read:
 *
 *   `Cannot delete sys_business_unit (): 1 dependent
 *    os_tianshun_ehr_sporadic_application record(s) reference it via apply_dept
 *    … or set deleteBehavior:'cascade' on …`
 *
 * — an English sentence naming two tables and a column they have never seen,
 * ending in a metadata-authoring instruction they cannot act on. This is the
 * same defect #3957 fixed one layer down for field constraints, reached from
 * the operation side, and it is fixed the same way: the catalog renders the
 * user's half in the caller's locale against resolved LABELS, while the
 * developer's half moves to `developerMessage`, which no user-facing surface
 * reads.
 *
 * These strings are platform text, not authored metadata: they exist for every
 * deployment whether or not anyone wrote a `translation`, so they ship as
 * constants (same shape as `BUILTIN_VALIDATION_MESSAGES`) rather than through
 * the extract-and-gate bundle pipeline, which tracks *declared metadata labels*
 * and would read added keys as drift.
 *
 * ## Interpolation
 *
 * `{{name}}` placeholders, matching `II18nService.t()`'s convention. An unknown
 * placeholder is left verbatim so a broken override is visible rather than
 * silently blank — {@link interpolateValidationMessage} is shared with the
 * sibling catalog so the two cannot drift on this.
 */

import { resolveBundleLocale } from './i18n-resolver';
import { interpolateValidationMessage } from './validation-message';
import type { ValidationMessageTranslator } from './validation-message';

/** Prefix under which a deployment can override a built-in operation message. */
export const OPERATION_MESSAGE_KEY_PREFIX = 'errors';

/**
 * The i18n key a `messageKey` resolves under, e.g. `errors.delete_restricted`.
 * A `translation` metadata item that defines this key overrides the built-in
 * catalog for its locale.
 */
export function operationMessageTranslationKey(messageKey: string): string {
  return `${OPERATION_MESSAGE_KEY_PREFIX}.${messageKey}`;
}

/**
 * Built-in templates, `locale → messageKey → template`.
 *
 * Locale keys match the platform bundles (`en`, `zh-CN`, `ja-JP`, `es-ES`);
 * `en` is the last-resort fallback and is therefore the one locale that MUST
 * define every key.
 *
 * The two `delete_restricted*` variants are one wire code with two sentences —
 * the `_required` form is emitted when the child's foreign key is `required`,
 * i.e. the case where reassigning is the only route because the reference
 * cannot simply be cleared. Splitting the SENTENCE, never the code, is the same
 * rule the field catalog states: `DELETE_RESTRICTED` stays one member of the
 * ADR-0112 vocabulary that clients match on.
 *
 * [#12166] Each has an `_opaque` twin — the SAME sentence with `{{count}}`
 * removed, and nothing else changed. Four templates, still one wire code.
 *
 * They exist because the delete-time reference check now runs under the SYSTEM
 * identity (maintainer ruling 2026-08-26): the engine's dependents probe sees
 * rows the caller may hold no read grant on, so the count in the counted
 * variants can be a number the caller could not have obtained. Shipping it
 * would turn the refusal into a cardinality oracle over a table the caller
 * cannot read. The ruling's second constraint — the error names the referenced
 * OBJECT, never record contents, "one notch more conservative than Salesforce"
 * — is what these serve.
 *
 * ⛔ They are NOT a general "shorter" variant, and the choice between the pairs
 * is not cosmetic. `ObjectQL.dependentCountIsDisclosable` owns it: the counted
 * form is used only when the caller's own identity would have produced the same
 * rows. Rendering a counted variant unconditionally re-opens the leak; making
 * the opaque one the default withholds an actionable number from every caller
 * who could always compute it. Both halves matter.
 *
 * The object and the relation field stay named in the opaque forms. They are
 * DECLARED METADATA, not rows, and they are the whole of what makes the refusal
 * self-diagnosable — the reporting deployment's admins could see a delete
 * button that always 403'd and had no way to learn which table was blocking it.
 *
 * Placeholders: `{{object}}` and `{{dependentObject}}` are LABELS in the
 * caller's locale (the API names live on `developerMessage` and on the
 * structured `object` / `dependentObject` fields), `{{field}}` is the
 * referencing field's label, `{{count}}` the number of dependent records.
 *
 * `permission_denied` (#7414) takes NO placeholders, and that is a deliberate
 * divergence from its sibling rather than an omission. `delete_restricted`
 * names the objects because the user must know WHICH related records block
 * them — that is the action they can take. An object-permission refusal gives
 * the user nothing to act on by naming the object, and on a cascade delete the
 * object the gate refuses is a CHILD the operator never addressed and may not
 * know exists (`cascadeDeleteRelations` re-authorises every child
 * independently). Naming it would be accurate and still misleading, so the
 * sentence names nothing: no object, no operation, no `positions`. The machine
 * detail stays on the error's structured `details` and on `developerMessage`,
 * which is logged server-side (see `plugin-security`'s CRUD gate).
 *
 * The three `PERMISSION_DENIED` keys take no placeholders EITHER, and #7451
 * re-derived that per site rather than inheriting it (the question "may this
 * sentence name anything?" is a per-site judgement, not a family rule):
 *
 *   - `permission_denied` — the #7414 reasoning above, unchanged, and it now
 *     also covers the capability AND-gate, whose only nameable facts are
 *     capability IDs: internal authorization vocabulary by construction.
 *   - `record_access_denied` — the refused record is the one the user just
 *     acted on, so naming it is the one case here that WOULD be honest. It
 *     still names nothing, because the only spellings available at the throw
 *     site are the object's API name and the row's opaque id; a label would
 *     need the ladder whose last rung is the API name — exactly what must not
 *     reach a toast (#7414). The user already knows which record they clicked.
 *   - `record_change_not_allowed` — the gate knows a post-image failed a
 *     policy predicate, not WHICH field carried the offending value (the
 *     predicate is an authored expression over the whole row). Naming the
 *     object without naming the field would send the user hunting.
 *
 * The two keys commit aa5994e17 added take no placeholders either, re-derived per site:
 *
 *   - `record_write_denied` — the sharing gate's nameable facts are the
 *     object's API name and the row's opaque id (the raw string interpolated
 *     exactly those), which is the #7414 vocabulary that must not reach a
 *     toast; the user already knows which record they tried to change.
 *   - `approval_recall_not_submitter` — the throw site knows the submitter
 *     only as an opaque user id; "the person who submitted this request" is
 *     the resolvable spelling, and the user's own screen shows who that is.
 *
 * The ownership, queue and field-edit keys are the `userMessage` of
 * plugin-security's owner-anchor, queue and field-write refusals. Those
 * refusals keep their developer sentence as `message`; these keys are the
 * end user's half beside it, so a client that shows `userMessage` shows them.
 * They name no grant and no API name, re-derived per site:
 *
 *   - the five ownership and queue keys take no placeholders: the user knows
 *     which record and which owner or queue they just entered, and the only
 *     other nameable facts are the transfer grants, which are internal
 *     authorization vocabulary.
 *   - the queue keys split by verb for the same reason the owner keys do
 *     (`record_owner_assign_denied` beside `record_owner_change_denied`): the
 *     user can do something different. A create naming a queue is admitted
 *     for a member of that queue, so the user refused there can leave the
 *     queue blank or choose one they belong to. A change of an existing
 *     record's queue is admitted for no member, so the only next step is an
 *     administrator. One wire code, two sentences.
 *   - `field_edit_denied` takes `{{fields}}`: the refused fields' LABELS in the
 *     caller's locale, as a list. A label is named only when the field has one
 *     (a translated or declared label, never the API name as the last rung)
 *     and the caller can read the field by the query read guard (a field the
 *     caller cannot read, or reads only partially masked, is not named to
 *     them). When any refused field fails either test,
 *     `field_edit_denied_opaque` is used and no field is named.
 *
 * `field_label_quoted` and `field_label_list_separator` are not sentences: they
 * are the locale's rules for spelling that `{{fields}}` list. Each label is
 * rendered through `field_label_quoted` (`{{label}}` is the one placeholder)
 * and the quoted labels are joined with `field_label_list_separator`. They
 * live here, beside the sentence they fill, so a locale added to this catalog
 * carries its list rules in the same edit — the every-locale-defines-every-key
 * test refuses a locale that omits them — and so they resolve by the same
 * ladder as the sentence, a deployment's `errors.<key>` override included.
 *
 * The three `duplicate_record*` keys are the end user's sentence of a
 * unique-constraint refusal — one wire code (`UNIQUE_VIOLATION`), three
 * sentences, chosen by how much of the key the engine can name honestly:
 *
 *   - `duplicate_record_field` takes `{{field}}`, the one conflicting field's
 *     LABEL in the caller's locale, named only when the store determinably
 *     named that column and the field has a label (a translation, else its
 *     declared `label`; never the API name);
 *   - `duplicate_record_fields` takes `{{fields}}`, the labels of a composite
 *     unique index's fields spelled by `field_label_quoted` and
 *     `field_label_list_separator`, named only when the columns the store
 *     named match a unique index the object declares and every one of those
 *     fields has a label;
 *   - `duplicate_record` names nothing — every other case, because a wrong
 *     field name is worse than none.
 *
 * The English sentences are byte-identical to the fixed text the HTTP doors
 * answered before they were localized, so an English deployment reads no
 * change for a single field or none.
 *
 * The four `record_locked*` keys are the end user's sentence of plugin-approvals'
 * per-row record lock (`409 RECORD_LOCKED`, the refusal a user reads in a toast
 * when they save a record a live approval holds). One wire code, four
 * sentences, chosen by what the refusing hook has in hand, and none of them
 * names the record id or the object's API name:
 *
 *   - `record_locked` takes `{{object}}` (the object's LABEL in the caller's
 *     locale) and `{{title}}` (the record's title as served to the writer);
 *   - `record_locked_untitled` takes `{{object}}` alone, for a record with no
 *     title the writer may be served;
 *   - `record_locked_unlabeled` takes `{{title}}` alone, for an object with no
 *     label;
 *   - `record_locked_opaque` names nothing.
 *
 * Their English is byte-identical to the fixed sentence the hook answered
 * before it was localized.
 *
 * Three keys are the `userMessage` of refusals whose `message` stays the
 * developer sentence (code, status and `message` unchanged). None takes a
 * placeholder, re-derived per site:
 *
 *   - `record_not_found` — `404 RECORD_NOT_FOUND` from `recordNotFoundError`
 *     (`@objectstack/core`). The by-id doors answer an id the caller cannot
 *     read exactly as an id naming no row (ruling of record 5985885287), so
 *     the sentence says both and tells the user neither. The only nameable
 *     facts at the throw site are the object's API name and the row's id,
 *     the #7414 vocabulary that must not reach a toast.
 *   - `query_field_not_readable` — plugin-security's `403 PERMISSION_DENIED`
 *     for a query that filters, sorts, groups or aggregates by a field the
 *     caller may not read (the filter-oracle guard). The fields are the ones
 *     the caller may not see, so the sentence names none of them.
 *   - `delegation_scope_violation` — `403 DELEGATION_SCOPE_VIOLATION`, a
 *     delegated administrator's write outside their own `adminScope`. The
 *     reason in `message` names business units and permission sets by their
 *     API names and ids; the user's half names none of them.
 *
 * The four `print_*` keys are the print door's own sentences for a print that
 * failed on the server (`POST /api/v1/print/records`, `@objectstack/service-print`):
 * the `message` of a 5xx whose producer declared no text for its caller. The
 * door writes them in the request's language (`Accept-Language`) through
 * `operationUserMessage` (`@objectstack/core`). None takes a placeholder: what
 * the engine or the host said is withheld from the wire and kept in the server
 * fault log, so the sentence can only name the situation.
 *
 *   - `print_engine_unavailable` — `503`: the print engine is not ready.
 *   - `print_timed_out` — `504`: the render ran past the time a print is allowed.
 *   - `print_failed` — any other 5xx, the door's fallback.
 *   - `print_caller_unresolved` — `500`: the door could not resolve who asked.
 *
 * Their English is byte-identical to the fixed sentences the door answered
 * before they were localized.
 *
 * How the door reads them, for whoever overrides or debugs them:
 *
 *   - The door holds no `i18n` service, so a `translation` item's
 *     `errors.print_*` entry is NOT consulted for these keys: the built-in
 *     catalog is the only source of their text.
 *   - `Accept-Language` is read by its top tag only
 *     (`preferredLocaleFromHeader`, no q-value negotiation), the platform's
 *     existing reading. The tag is matched to a catalog locale by language
 *     (`resolveBundleLocale`): `es-MX` reads `es-ES`, `zh` and `zh-TW` read
 *     `zh-CN`, `ja` reads `ja-JP`. Only a language the catalog holds no
 *     locale of (`fr`, `de`, …) answers English.
 *   - The server fault log records the thrown error's own message. Only a
 *     throw with an EMPTY message puts the localized sentence into the log line
 *     in its place (`serverFaultLogMessage`'s fallback); every other throw logs
 *     its own text, whatever language the caller was answered in.
 *
 * The `action_forward_*` keys are the `/actions` door's `503` for a same-origin
 * `type: 'api'` action it cannot forward (`apiActionForwardUnavailableError`,
 * `@objectstack/runtime`): the kernel exposes no in-process request path. They
 * are an operator's sentence, not a business user's, and they say so; they are
 * localized because the console shows the wire `message` of a refused action
 * to whoever clicked it (a print action whose forward is unavailable among
 * them). The door renders them in the caller's language through its execution
 * context (`locale`, which the dispatcher resolves from the request's top
 * `Accept-Language` tag, then `workspaceLocale`, then `en`), the reading every
 * other refusal of that door uses. `{{action}}` is the action's name,
 * `{{target}}` its quoted target, or `action_forward_target_unnamed` when it
 * declares none. Code and status are unchanged, and no `userMessage` is added
 * to the fault.
 *
 *   - `action_forward_unavailable` — the REST and MCP doors: the deployment's
 *     HTTP server is the remedy.
 *   - `action_forward_unavailable_host` — the host door (`dispatchAction`):
 *     the kernel the call was handed is the remedy.
 *
 * The `own_door_*` keys are the own-door bridge's `501 NOT_IMPLEMENTED` on a
 * kernel with no `http.server` (`own-door-bridge.ts`, `@objectstack/runtime`):
 * no service is registered for the door's slot, or the registered one lacks
 * the door's member. `{{door}}` is the door's noun, itself a key of this
 * catalog (`own_door_print`, `own_door_personal_view_delete`,
 * `own_door_attachment_mutate`), capitalized; `{{slot}}`, `{{producer}}` and
 * `{{member}}` are the slot, package and member names, never translated. The
 * bridge reads the request's top `Accept-Language` tag, as the print door
 * does, and holds no `i18n` service either, so no `errors.own_door_*`
 * override is consulted. Every bridge names its noun key. A bridge whose noun
 * is plural (`own_door_attachment_mutate`) reads the `_plural` pair, so the
 * English verb agrees.
 *
 * The `comment_doors_*`, `webhook_redeliver_*`, `approvals_act_*` and
 * `automation_hooks_*` keys are the same `501` on the comment doors
 * (`comments.ts`), the webhook redelivery door (`webhooks.ts`), the approval
 * action-page door (`approvals.ts`) and the inbound automation hooks
 * (`automation-hooks.ts`), which are not own-door bridges: each sentence is
 * whole, with its slot, member and package names written in, never
 * translated. Each door reads them as the bridge does: by the request's top
 * `Accept-Language` tag (`requestLocaleOf`, `own-door-bridge.ts`), matched to
 * a catalog locale by language as the print door's is (a language the catalog
 * holds no locale of answering English), and with no `i18n` service, so no
 * `errors.comment_doors_*`, `errors.webhook_redeliver_*`,
 * `errors.approvals_act_*` or `errors.automation_hooks_*` override is
 * consulted. Their English is byte-identical to the fixed sentences the doors
 * answered before they were localized.
 *
 * The keys from `auth_service_unavailable` to `share_links_unconfigured` are
 * the remaining `501`s of the dispatcher's domain modules (`auth.ts`,
 * `i18n.ts`, `mcp.ts`, `meta.ts`, `packages.ts`, `automation.ts`,
 * `actions.ts`, `catalog-activation.ts`, `permission-set-clone.ts`,
 * `security.ts`, `share-links.ts`, #37811), read the same way: by the
 * request's top `Accept-Language` tag, with no `errors.*` override consulted.
 * Their English is byte-identical to the fixed sentences they replace.
 * `{{member}}`, `{{table}}`, `{{name}}` and `{{packageId}}` are code, table,
 * item and package names, never translated; `{{noun}}` is one of the
 * `catalog_activation_noun_*` keys, rendered in the same locale.
 *
 * The `capability_unavailable_*` keys are the `501` a dispatcher domain
 * answers when its route is mounted and nothing implements the capability
 * behind it (`capabilityUnavailable`, `domains/unavailable.ts` and the
 * custom-endpoint flow target, `@objectstack/runtime`, #37864), read the same
 * way. Their English is byte-identical to `serviceUnavailableMessage(slot)`
 * (`core-services.zod.ts`), the sentence discovery reports for the slot under
 * `services.<slot>.message`: discovery is a machine-read surface and stays
 * English, so only the `501` follows the request's language, and a pin holds
 * the two English sentences equal for every slot. `_ui`, `_ai` and `_search`
 * carry the slots with a sentence of their own; every other slot reads
 * `_install` (`{{package}}`, the slot's provider package) or `_unshipped`
 * (`{{slot}}`); package, slot, plugin and route names are never translated.
 */
export const BUILTIN_OPERATION_MESSAGES: Record<string, Record<string, string>> = {
  en: {
    permission_denied:
      'You do not have permission to perform this action. Contact your administrator if you need access.',
    record_access_denied:
      'You do not have access to this record. Contact the person who owns it, or your administrator, if you need access.',
    record_change_not_allowed:
      'You are not allowed to save this record with the values you entered. Change them and try again, or contact your administrator if you need access.',
    record_write_denied:
      'You do not have access to change or delete this record. Contact the person who owns it, or your administrator, if you need to make changes.',
    approval_recall_not_submitter:
      'Only the person who submitted this approval request can recall it. Contact the submitter, or your administrator, if it needs to be recalled.',
    record_owner_change_denied:
      'You do not have permission to change the owner of this record. Contact your administrator if it needs to be reassigned.',
    record_owner_assign_denied:
      'You do not have permission to create a record owned by someone else. Leave the owner blank or set it to yourself, or contact your administrator.',
    record_owner_remove_denied:
      'You do not have permission to remove the owner from this record. Contact your administrator if it needs a different owner.',
    record_queue_change_denied:
      'You do not have permission to change which queue this record is in. Contact your administrator if it needs to be moved.',
    record_queue_assign_denied:
      'You do not have permission to create a record in that queue. Leave the queue blank or choose a queue you belong to, or contact your administrator.',
    master_record_edit_denied:
      'You need edit access to the {{master}} this record belongs to. Contact the person who owns that {{master}}, or your administrator, if you need access.',
    master_record_edit_denied_opaque:
      'You need edit access to the parent record this record belongs to. Contact your administrator if you need access.',
    master_record_read_denied:
      'You need read access to the {{master}} this record belongs to. Contact the person who owns that {{master}}, or your administrator, if you need access.',
    master_record_read_denied_opaque:
      'You need read access to the parent record this record belongs to. Contact your administrator if you need access.',
    field_edit_denied:
      'You do not have permission to edit {{fields}}. Undo those changes and try again, or contact your administrator if you need access.',
    field_edit_denied_opaque:
      'You do not have permission to edit one or more of the fields you changed. Undo those changes and try again, or contact your administrator if you need access.',
    field_label_quoted: '“{{label}}”',
    field_label_list_separator: ', ',
    delete_restricted:
      'This {{object}} is still referenced by {{count}} {{dependentObject}} record(s) through “{{field}}”. Delete or reassign them first.',
    delete_restricted_required:
      'This {{object}} is still referenced by {{count}} {{dependentObject}} record(s) through “{{field}}”, which is required and cannot be cleared. Delete or reassign them first.',
    delete_restricted_opaque:
      'This {{object}} is still referenced by {{dependentObject}} record(s) through “{{field}}”. Delete or reassign them first.',
    delete_restricted_required_opaque:
      'This {{object}} is still referenced by {{dependentObject}} record(s) through “{{field}}”, which is required and cannot be cleared. Delete or reassign them first.',
    duplicate_record: 'A record with this value already exists',
    duplicate_record_field: 'A record with this {{field}} already exists',
    duplicate_record_fields: 'A record with the same {{fields}} already exists',
    record_locked:
      "{{object}} '{{title}}' is locked while an approval is in progress, and cannot be edited until that approval is complete",
    record_locked_unlabeled:
      "'{{title}}' is locked while an approval is in progress, and cannot be edited until that approval is complete",
    record_locked_untitled:
      'This {{object}} is locked while an approval is in progress, and cannot be edited until that approval is complete',
    record_locked_opaque:
      'This record is locked while an approval is in progress, and cannot be edited until that approval is complete',
    record_not_found: 'This record does not exist, or you do not have access to it.',
    query_field_not_readable:
      'This request filters, sorts or groups by a field you do not have access to. Remove that condition and try again, or contact your administrator if you need access.',
    delegation_scope_violation:
      'This change is outside the scope you were delegated to administer. Contact your administrator if it needs to be made.',
    print_engine_unavailable:
      'Records cannot be printed to a file right now: the print engine is not ready. The server log records why.',
    print_timed_out: 'The record could not be printed to a file in the time a print is allowed.',
    print_failed: 'The record could not be printed to a file because of an error on the server.',
    print_caller_unresolved: 'The caller of this print could not be resolved.',
    action_forward_unavailable:
      "Action '{{action}}' is a same-origin `type: 'api'` action whose `target` ({{target}}) this door forwards to in-process, but this deployment's HTTP server exposes no in-process request path (IHttpServer.getRawApp). Operator: run an HTTP server plugin that implements getRawApp; the action is not dispatched around the door.",
    action_forward_unavailable_host:
      "Action '{{action}}' is a same-origin `type: 'api'` action whose `target` ({{target}}) this door forwards to in-process, but the kernel dispatchAction was handed exposes no in-process request path (IHttpServer.getRawApp). Pass dispatchAction the kernel your HTTP door is served from: on a multi-kernel host, the kernel that registers `kernel-resolver`, with the call's `environmentId` (an environment's own kernel owns no socket). On a single kernel, run an HTTP server plugin that implements getRawApp. The action is not dispatched around the door.",
    action_forward_target_unnamed: 'endpoint',
    own_door_service_unregistered:
      '{{door}} is not available: no {{slot}} service is registered on this kernel. {{producer}} registers it.',
    own_door_member_missing: '{{door}} is not available: the registered {{slot}} service does not implement {{member}}.',
    own_door_print: 'the print door',
    own_door_personal_view_delete: 'the personal view delete door',
    own_door_attachment_mutate: 'the attachment removal and rename doors',
    own_door_service_unregistered_plural:
      '{{door}} are not available: no {{slot}} service is registered on this kernel. {{producer}} registers it.',
    own_door_member_missing_plural: '{{door}} are not available: the registered {{slot}} service does not implement {{member}}.',
    comment_doors_service_unregistered:
      'The comment doors are not available: no comments service is registered. @objectstack/plugin-audit registers it; compose AuditPlugin on this kernel.',
    comment_doors_member_missing:
      'The comment doors are not available: the registered comments service does not implement handleCommentDoor.',
    webhook_redeliver_service_unregistered:
      'Webhook redelivery is not available: no webhooks service is registered. @objectstack/plugin-webhooks registers it once its redelivery veto is installed, which needs the data engine and @objectstack/service-messaging; the boot log names the one that is missing.',
    webhook_redeliver_member_missing:
      'Webhook redelivery is not available: the registered webhooks service does not implement handleRedeliver.',
    approvals_act_service_unregistered:
      'Approval action pages are not available: no approvals service is registered. Register @objectstack/plugin-approvals to serve them.',
    approvals_act_member_missing:
      'Approval action pages are not available: the registered approvals service does not implement handleActionPage.',
    automation_hooks_service_unregistered:
      'Inbound automation hooks are not available: no trigger-api service is registered. The inbound-hook trigger (@objectstack/trigger-api) serves this route through that service; compose it on the environment that owns the flow.',
    automation_hooks_member_missing:
      'Inbound automation hooks are not available: the registered trigger-api service does not implement handleInboundHook.',
    auth_service_unavailable: 'Auth service not available — register @objectstack/plugin-auth to enable authentication',
    i18n_service_unavailable: 'i18n service not available',
    mcp_server_unavailable: 'MCP server is not available',
    meta_layered_view_unsupported: 'Layered metadata view not supported by protocol implementation',
    meta_save_conditions_unsupported:
      'This host has no protocol saveMetaItem, so it cannot honour If-Match, If-None-Match or ?mode=draft on a save. Send the save without them, or save through a host whose protocol implements saveMetaItem.',
    meta_save_unsupported: 'Save not supported',
    meta_draft_listing_unsupported: 'Draft listing not supported',
    meta_stored_migration_unsupported: 'Stored-metadata migration not supported',
    packages_draft_publish_unsupported: 'Draft publishing not supported',
    packages_draft_discard_unsupported: 'Draft discarding not supported',
    packages_commit_history_unsupported: 'Commit history not supported',
    packages_commit_revert_unsupported: 'Commit revert not supported',
    packages_commit_rollback_unsupported: 'Commit rollback not supported',
    packages_orphan_adoption_unsupported: 'Orphan adoption not supported',
    packages_duplication_unsupported: 'Package duplication not supported',
    packages_customization_ensure_unsupported: 'Customization package ensure not supported',
    automation_connector_credentials_unsupported:
      'Connector credentials are not supported by the automation service this deployment mounts — it does not implement `{{member}}`, an optional member of `IAutomationService`. Nothing was read or changed.',
    automation_connector_connections_unsupported:
      'Connector connections are not supported by the automation service this deployment mounts — it does not implement `{{member}}`, an optional member of `IAutomationService`. Nothing was read or changed.',
    automation_flow_clone_unsupported:
      'Flow clone not supported: a copy lands in a package, and this deployment has no metadata protocol that can ensure a customization package and save a flow into it.',
    automation_resume_unsupported: 'Resume not supported',
    automation_run_cancel_unsupported:
      'Cancelling a run is not supported by the automation service this deployment mounts — it does not implement `cancelRun`, an optional member of `IAutomationService`. No run was cancelled.',
    automation_run_restore_unsupported:
      'Restoring a consumed suspension is not supported by the automation service this deployment mounts — it does not implement `restoreConsumedSuspension`, an optional member of `IAutomationService`. No suspension was restored.',
    automation_screen_lookup_unsupported: 'Screen lookup not supported',
    automation_runs_list_unsupported:
      'Listing the runs of a flow is not supported by the automation service this deployment mounts — it does not implement `listRunsPage`, an optional member of `IAutomationService`. No runs were listed.',
    action_activation_ledger_unsupported:
      "This deployment's data engine does not implement the packaged-metadata activation ledger (ADR-0126 §8), so a packaged action cannot be switched off here.",
    catalog_activation_ledger_missing_on:
      "This deployment does not carry the activation ledger ({{table}}, ADR-0126 §4), so {{noun}} '{{name}}' cannot be switched on here.",
    catalog_activation_ledger_missing_off:
      "This deployment does not carry the activation ledger ({{table}}, ADR-0126 §4), so {{noun}} '{{name}}' cannot be switched off here.",
    catalog_activation_noun_position: 'position',
    catalog_activation_noun_permission: 'permission set',
    catalog_activation_noun_sharing_rule: 'declared sharing rule',
    catalog_activation_noun_webhook: 'declared webhook',
    catalog_activation_noun_queue: 'declared queue',
    catalog_activation_noun_assignment_rule: 'declared assignment rule',
    permission_set_clone_pair_unsupported:
      "Permission set '{{name}}' is shipped by read-only package '{{packageId}}', so its copy belongs in that package's paired customization package, and this deployment's metadata protocol cannot ensure one.",
    permission_set_clone_no_protocol:
      'This deployment has no metadata protocol to save the copy through, so a permission set cannot be cloned here.',
    security_audience_reopen_unsupported:
      "This deployment's security service does not implement re-opening a dismissed audience-binding suggestion, so the dismissal stands.",
    share_links_unconfigured: 'Sharing is not configured',
    capability_unavailable_install: 'Install {{package}} to enable',
    capability_unavailable_unshipped: "No implementation ships for the '{{slot}}' slot — register a service under it to enable",
    capability_unavailable_ui:
      'Served by the protocol service — register MetadataPlugin (@objectstack/metadata-protocol) to enable',
    capability_unavailable_ai:
      'Provided by @objectstack/service-ai in ObjectOS Cloud/Enterprise — no implementation ships in the open framework',
    capability_unavailable_search:
      "No implementation ships for the 'search' slot — a dedicated search engine (Elasticsearch/Meilisearch); register a service under it to enable. Cross-object search does not depend on it: GET {basePath}/search is served by the protocol itself, and whether it is served on this host is reported by capabilities.search — not by this slot.",
  },
  'zh-CN': {
    permission_denied: '您没有执行此操作的权限，如需访问请联系管理员。',
    record_access_denied: '您无权访问这条记录，如需访问请联系该记录的负责人或管理员。',
    record_change_not_allowed: '您无权将这条记录保存为当前填写的内容，请修改后重试，或联系管理员。',
    record_write_denied: '您无权修改或删除这条记录，如需修改请联系该记录的负责人或管理员。',
    approval_recall_not_submitter: '只有提交人可以撤回这条审批请求，如需撤回请联系提交人或管理员。',
    record_owner_change_denied: '您无权更改这条记录的负责人，如需改派请联系管理员。',
    record_owner_assign_denied: '您无权创建负责人为他人的记录，请将负责人留空或设为自己，或联系管理员。',
    record_owner_remove_denied: '您无权清除这条记录的负责人，如需更换负责人请联系管理员。',
    record_queue_change_denied: '您无权更改这条记录所在的队列，如需调整请联系管理员。',
    record_queue_assign_denied: '您无权在该队列中创建记录，请将队列留空或选择您所属的队列，或联系管理员。',
    master_record_edit_denied: '您需要拥有这条记录所属{{master}}的编辑权限，如需访问请联系该{{master}}的负责人或管理员。',
    master_record_edit_denied_opaque: '您需要拥有这条记录所属上级记录的编辑权限，如需访问请联系管理员。',
    master_record_read_denied: '您需要拥有这条记录所属{{master}}的查看权限，如需访问请联系该{{master}}的负责人或管理员。',
    master_record_read_denied_opaque: '您需要拥有这条记录所属上级记录的查看权限，如需访问请联系管理员。',
    field_edit_denied: '您无权编辑{{fields}}，请撤销这些修改后重试，或联系管理员。',
    field_edit_denied_opaque: '您无权编辑所修改的部分字段，请撤销这些修改后重试，或联系管理员。',
    field_label_quoted: '「{{label}}」',
    field_label_list_separator: '、',
    delete_restricted:
      '该{{object}}正被 {{count}} 条{{dependentObject}}记录通过「{{field}}」引用，请先删除或改派这些记录。',
    delete_restricted_required:
      '该{{object}}正被 {{count}} 条{{dependentObject}}记录通过「{{field}}」引用，且该字段为必填、无法清空，请先删除或改派这些记录。',
    delete_restricted_opaque:
      '该{{object}}正被{{dependentObject}}记录通过「{{field}}」引用，请先删除或改派这些记录。',
    delete_restricted_required_opaque:
      '该{{object}}正被{{dependentObject}}记录通过「{{field}}」引用，且该字段为必填、无法清空，请先删除或改派这些记录。',
    duplicate_record: '已存在相同值的记录',
    duplicate_record_field: '已存在相同{{field}}的记录',
    duplicate_record_fields: '已存在{{fields}}均相同的记录',
    record_locked: '{{object}}「{{title}}」正在审批中，已被锁定，审批完成前无法编辑',
    record_locked_unlabeled: '「{{title}}」正在审批中，已被锁定，审批完成前无法编辑',
    record_locked_untitled: '该{{object}}正在审批中，已被锁定，审批完成前无法编辑',
    record_locked_opaque: '该记录正在审批中，已被锁定，审批完成前无法编辑',
    record_not_found: '该记录不存在，或您无权访问它。',
    query_field_not_readable: '当前请求按您无权查看的字段筛选、排序或分组，请去掉该条件后重试，或联系管理员。',
    delegation_scope_violation: '此更改超出了您被委派管理的范围，如需更改请联系管理员。',
    print_engine_unavailable: '暂时无法将记录打印为文件：打印引擎尚未就绪，原因已记录在服务器日志中。',
    print_timed_out: '打印超时：记录未能在允许的时间内打印为文件。',
    print_failed: '服务器出错，记录未能打印为文件。',
    print_caller_unresolved: '无法确认发起此次打印的用户。',
    action_forward_unavailable:
      "动作 '{{action}}' 是同源的 `type: 'api'` 动作，本接口会在进程内将其转发到它的 `target`（{{target}}），但此部署的 HTTP 服务器未提供进程内请求通道（IHttpServer.getRawApp）。运维人员：请运行实现了 getRawApp 的 HTTP 服务器插件；该动作不会绕过本接口执行。",
    action_forward_unavailable_host:
      "动作 '{{action}}' 是同源的 `type: 'api'` 动作，本接口会在进程内将其转发到它的 `target`（{{target}}），但传给 dispatchAction 的内核未提供进程内请求通道（IHttpServer.getRawApp）。请把提供 HTTP 接口的内核传给 dispatchAction：在多内核主机上，传入注册了 `kernel-resolver` 的内核，并带上本次调用的 `environmentId`（环境自身的内核不持有套接字）。在单内核上，请运行实现了 getRawApp 的 HTTP 服务器插件。该动作不会绕过本接口执行。",
    action_forward_target_unnamed: '端点',
    own_door_service_unregistered: '{{door}}不可用：此内核上未注册 {{slot}} 服务。该服务由 {{producer}} 注册。',
    own_door_member_missing: '{{door}}不可用：已注册的 {{slot}} 服务未实现 {{member}}。',
    own_door_print: '打印接口',
    own_door_personal_view_delete: '个人视图删除接口',
    own_door_attachment_mutate: '附件删除和重命名接口',
    own_door_service_unregistered_plural: '{{door}}不可用：此内核上未注册 {{slot}} 服务。该服务由 {{producer}} 注册。',
    own_door_member_missing_plural: '{{door}}不可用：已注册的 {{slot}} 服务未实现 {{member}}。',
    comment_doors_service_unregistered:
      '评论接口不可用：未注册 comments 服务。该服务由 @objectstack/plugin-audit 注册；请在此内核上组合 AuditPlugin。',
    comment_doors_member_missing: '评论接口不可用：已注册的 comments 服务未实现 handleCommentDoor。',
    webhook_redeliver_service_unregistered:
      'Webhook 重新投递不可用：未注册 webhooks 服务。@objectstack/plugin-webhooks 在安装其重新投递否决器后注册该服务，这需要数据引擎和 @objectstack/service-messaging；启动日志会指出缺少的是哪一个。',
    webhook_redeliver_member_missing: 'Webhook 重新投递不可用：已注册的 webhooks 服务未实现 handleRedeliver。',
    approvals_act_service_unregistered:
      '审批操作页不可用：未注册 approvals 服务。请注册 @objectstack/plugin-approvals 来提供这些页面。',
    approvals_act_member_missing: '审批操作页不可用：已注册的 approvals 服务未实现 handleActionPage。',
    automation_hooks_service_unregistered:
      '入站自动化钩子不可用：未注册 trigger-api 服务。入站钩子触发器（@objectstack/trigger-api）通过该服务提供此路由；请在拥有该流程的环境上组合它。',
    automation_hooks_member_missing: '入站自动化钩子不可用：已注册的 trigger-api 服务未实现 handleInboundHook。',
    auth_service_unavailable: '认证服务不可用：请注册 @objectstack/plugin-auth 以启用认证。',
    i18n_service_unavailable: 'i18n 服务不可用。',
    mcp_server_unavailable: 'MCP 服务器不可用。',
    meta_layered_view_unsupported: '不支持分层元数据视图：当前的协议实现未提供该功能。',
    meta_save_conditions_unsupported:
      '此主机的协议未提供 saveMetaItem，因此保存时无法遵循 If-Match、If-None-Match 或 ?mode=draft。请去掉这些条件后再保存，或通过协议实现了 saveMetaItem 的主机保存。',
    meta_save_unsupported: '不支持保存。',
    meta_draft_listing_unsupported: '不支持列出草稿。',
    meta_stored_migration_unsupported: '不支持迁移已存储的元数据。',
    packages_draft_publish_unsupported: '不支持发布草稿。',
    packages_draft_discard_unsupported: '不支持丢弃草稿。',
    packages_commit_history_unsupported: '不支持查看提交历史。',
    packages_commit_revert_unsupported: '不支持撤销提交。',
    packages_commit_rollback_unsupported: '不支持回滚到某次提交。',
    packages_orphan_adoption_unsupported: '不支持认领孤立的元数据。',
    packages_duplication_unsupported: '不支持复制软件包。',
    packages_customization_ensure_unsupported: '不支持确保定制包存在。',
    automation_connector_credentials_unsupported:
      '此部署挂载的自动化服务不支持连接器凭据：它未实现 `IAutomationService` 的可选成员 `{{member}}`。未读取或更改任何内容。',
    automation_connector_connections_unsupported:
      '此部署挂载的自动化服务不支持连接器连接：它未实现 `IAutomationService` 的可选成员 `{{member}}`。未读取或更改任何内容。',
    automation_flow_clone_unsupported: '不支持复制流程：副本要存入一个软件包，而此部署没有能够确保定制包存在并将流程保存进去的元数据协议。',
    automation_resume_unsupported: '不支持恢复运行。',
    automation_run_cancel_unsupported: '此部署挂载的自动化服务不支持取消运行：它未实现 `IAutomationService` 的可选成员 `cancelRun`。没有取消任何运行。',
    automation_run_restore_unsupported:
      '此部署挂载的自动化服务不支持恢复已消费的挂起：它未实现 `IAutomationService` 的可选成员 `restoreConsumedSuspension`。没有恢复任何挂起。',
    automation_screen_lookup_unsupported: '不支持查询屏幕。',
    automation_runs_list_unsupported: '此部署挂载的自动化服务不支持列出流程的运行：它未实现 `IAutomationService` 的可选成员 `listRunsPage`。没有列出任何运行。',
    action_activation_ledger_unsupported: '此部署的数据引擎未实现软件包元数据的启用台账（ADR-0126 §8），因此无法在这里停用软件包中的动作。',
    catalog_activation_ledger_missing_on: "此部署没有启用台账（{{table}}，ADR-0126 §4），因此无法在这里启用{{noun}} '{{name}}'。",
    catalog_activation_ledger_missing_off: "此部署没有启用台账（{{table}}，ADR-0126 §4），因此无法在这里停用{{noun}} '{{name}}'。",
    catalog_activation_noun_position: '岗位',
    catalog_activation_noun_permission: '权限集',
    catalog_activation_noun_sharing_rule: '声明的共享规则',
    catalog_activation_noun_webhook: '声明的 webhook',
    catalog_activation_noun_queue: '声明的队列',
    catalog_activation_noun_assignment_rule: '声明的分配规则',
    permission_set_clone_pair_unsupported:
      "权限集 '{{name}}' 由只读软件包 '{{packageId}}' 提供，因此它的副本应存入该软件包配对的定制包，而此部署的元数据协议无法确保该定制包存在。",
    permission_set_clone_no_protocol: '此部署没有可用于保存副本的元数据协议，因此无法在这里复制权限集。',
    security_audience_reopen_unsupported: '此部署的安全服务未实现重新打开已忽略的受众绑定建议，因此该忽略保持有效。',
    share_links_unconfigured: '未配置共享。',
    capability_unavailable_install: '安装 {{package}} 即可启用。',
    capability_unavailable_unshipped: "'{{slot}}' 槽位没有随附的实现：在该槽位下注册一个服务即可启用。",
    capability_unavailable_ui: '由协议服务提供：注册 MetadataPlugin（@objectstack/metadata-protocol）即可启用。',
    capability_unavailable_ai: '由 ObjectOS Cloud/Enterprise 中的 @objectstack/service-ai 提供，开源框架不附带实现。',
    capability_unavailable_search:
      "'search' 槽位没有随附的实现：它对应专用搜索引擎（Elasticsearch/Meilisearch），在该槽位下注册一个服务即可启用。跨对象搜索不依赖它：GET {basePath}/search 由协议本身提供，本主机是否提供它由 capabilities.search 报告，而不是由这个槽位报告。",
  },
  'ja-JP': {
    permission_denied: 'この操作を実行する権限がありません。アクセスが必要な場合は管理者にお問い合わせください。',
    record_access_denied:
      'このレコードにアクセスする権限がありません。アクセスが必要な場合は、レコードの担当者または管理者にお問い合わせください。',
    record_change_not_allowed:
      '入力された内容ではこのレコードを保存できません。内容を変更して再試行するか、管理者にお問い合わせください。',
    record_write_denied:
      'このレコードを変更または削除する権限がありません。変更が必要な場合は、レコードの担当者または管理者にお問い合わせください。',
    approval_recall_not_submitter:
      'この承認申請を取り下げられるのは申請者本人のみです。取り下げが必要な場合は、申請者または管理者にお問い合わせください。',
    record_owner_change_denied:
      'このレコードの所有者を変更する権限がありません。再割り当てが必要な場合は管理者にお問い合わせください。',
    record_owner_assign_denied:
      '他のユーザーが所有するレコードを作成する権限がありません。所有者を空欄にするか自分に設定するか、管理者にお問い合わせください。',
    record_owner_remove_denied:
      'このレコードの所有者を削除する権限がありません。所有者の変更が必要な場合は管理者にお問い合わせください。',
    record_queue_change_denied:
      'このレコードのキューを変更する権限がありません。移動が必要な場合は管理者にお問い合わせください。',
    record_queue_assign_denied:
      '指定したキューにレコードを作成する権限がありません。キューを空欄にするか自分が所属するキューを選択するか、管理者にお問い合わせください。',
    master_record_edit_denied:
      'このレコードが属する{{master}}の編集権限が必要です。アクセスが必要な場合は、その{{master}}の担当者または管理者にお問い合わせください。',
    master_record_edit_denied_opaque:
      'このレコードが属する親レコードの編集権限が必要です。アクセスが必要な場合は管理者にお問い合わせください。',
    master_record_read_denied:
      'このレコードが属する{{master}}の参照権限が必要です。アクセスが必要な場合は、その{{master}}の担当者または管理者にお問い合わせください。',
    master_record_read_denied_opaque:
      'このレコードが属する親レコードの参照権限が必要です。アクセスが必要な場合は管理者にお問い合わせください。',
    field_edit_denied:
      '{{fields}}を編集する権限がありません。その変更を取り消して再試行するか、管理者にお問い合わせください。',
    field_edit_denied_opaque:
      '変更した項目の一部を編集する権限がありません。その変更を取り消して再試行するか、管理者にお問い合わせください。',
    field_label_quoted: '「{{label}}」',
    field_label_list_separator: '、',
    delete_restricted:
      'この{{object}}は {{count}} 件の{{dependentObject}}レコードから「{{field}}」で参照されています。先にそれらを削除するか、参照先を変更してください。',
    delete_restricted_required:
      'この{{object}}は {{count}} 件の{{dependentObject}}レコードから「{{field}}」で参照されています。この項目は必須のため空にできません。先にそれらを削除するか、参照先を変更してください。',
    delete_restricted_opaque:
      'この{{object}}は{{dependentObject}}レコードから「{{field}}」で参照されています。先にそれらを削除するか、参照先を変更してください。',
    delete_restricted_required_opaque:
      'この{{object}}は{{dependentObject}}レコードから「{{field}}」で参照されています。この項目は必須のため空にできません。先にそれらを削除するか、参照先を変更してください。',
    duplicate_record: '同じ値のレコードがすでに存在します',
    duplicate_record_field: '同じ{{field}}のレコードがすでに存在します',
    duplicate_record_fields: '{{fields}}がすべて同じレコードがすでに存在します',
    record_locked: '{{object}}「{{title}}」は承認処理中のためロックされています。承認が完了するまで編集できません',
    record_locked_unlabeled: '「{{title}}」は承認処理中のためロックされています。承認が完了するまで編集できません',
    record_locked_untitled: 'この{{object}}は承認処理中のためロックされています。承認が完了するまで編集できません',
    record_locked_opaque: 'このレコードは承認処理中のためロックされています。承認が完了するまで編集できません',
    record_not_found: 'このレコードは存在しないか、アクセスする権限がありません。',
    query_field_not_readable:
      'この要求は、閲覧権限のない項目で絞り込み、並べ替え、またはグループ化しています。その条件を削除して再試行するか、アクセスが必要な場合は管理者にお問い合わせください。',
    delegation_scope_violation:
      'この変更は、管理を委任された範囲を超えています。変更が必要な場合は管理者にお問い合わせください。',
    print_engine_unavailable:
      '印刷エンジンの準備ができていないため、現在レコードをファイルに印刷できません。原因はサーバーログに記録されています。',
    print_timed_out: '制限時間内にレコードをファイルに印刷できませんでした。',
    print_failed: 'サーバーでエラーが発生したため、レコードをファイルに印刷できませんでした。',
    print_caller_unresolved: 'この印刷を要求したユーザーを特定できませんでした。',
    action_forward_unavailable:
      "アクション '{{action}}' は同一オリジンの `type: 'api'` アクションで、このエンドポイントはその `target`（{{target}}）へプロセス内で転送しますが、このデプロイメントの HTTP サーバーはプロセス内リクエスト経路（IHttpServer.getRawApp）を提供していません。運用担当者：getRawApp を実装した HTTP サーバープラグインを実行してください。アクションがこのエンドポイントを迂回して実行されることはありません。",
    action_forward_unavailable_host:
      "アクション '{{action}}' は同一オリジンの `type: 'api'` アクションで、このエンドポイントはその `target`（{{target}}）へプロセス内で転送しますが、dispatchAction に渡されたカーネルはプロセス内リクエスト経路（IHttpServer.getRawApp）を提供していません。HTTP エンドポイントを提供しているカーネルを dispatchAction に渡してください。マルチカーネルのホストでは、`kernel-resolver` を登録しているカーネルを呼び出しの `environmentId` とともに渡します（環境自身のカーネルはソケットを持ちません）。単一カーネルでは、getRawApp を実装した HTTP サーバープラグインを実行してください。アクションがこのエンドポイントを迂回して実行されることはありません。",
    action_forward_target_unnamed: 'エンドポイント',
    own_door_service_unregistered:
      '{{door}}は利用できません。このカーネルには {{slot}} サービスが登録されていません。このサービスは {{producer}} が登録します。',
    own_door_member_missing: '{{door}}は利用できません。登録されている {{slot}} サービスは {{member}} を実装していません。',
    own_door_print: '印刷エンドポイント',
    own_door_personal_view_delete: '個人ビュー削除エンドポイント',
    own_door_attachment_mutate: '添付ファイルの削除・名前変更エンドポイント',
    own_door_service_unregistered_plural:
      '{{door}}は利用できません。このカーネルには {{slot}} サービスが登録されていません。このサービスは {{producer}} が登録します。',
    own_door_member_missing_plural: '{{door}}は利用できません。登録されている {{slot}} サービスは {{member}} を実装していません。',
    comment_doors_service_unregistered:
      'コメントエンドポイントは利用できません。comments サービスが登録されていません。このサービスは @objectstack/plugin-audit が登録します。このカーネルに AuditPlugin を組み込んでください。',
    comment_doors_member_missing:
      'コメントエンドポイントは利用できません。登録されている comments サービスは handleCommentDoor を実装していません。',
    webhook_redeliver_service_unregistered:
      'Webhook の再配信は利用できません。webhooks サービスが登録されていません。@objectstack/plugin-webhooks は再配信の拒否フックがインストールされると登録します。それにはデータエンジンと @objectstack/service-messaging が必要です。不足しているものは起動ログに示されます。',
    webhook_redeliver_member_missing:
      'Webhook の再配信は利用できません。登録されている webhooks サービスは handleRedeliver を実装していません。',
    approvals_act_service_unregistered:
      '承認アクションページは利用できません。approvals サービスが登録されていません。これらのページを提供するには @objectstack/plugin-approvals を登録してください。',
    approvals_act_member_missing:
      '承認アクションページは利用できません。登録されている approvals サービスは handleActionPage を実装していません。',
    automation_hooks_service_unregistered:
      '受信自動化フックは利用できません。trigger-api サービスが登録されていません。受信フックトリガー（@objectstack/trigger-api）がこのサービスを通じてこのルートを提供します。フローを所有する環境に組み込んでください。',
    automation_hooks_member_missing:
      '受信自動化フックは利用できません。登録されている trigger-api サービスは handleInboundHook を実装していません。',
    auth_service_unavailable: '認証サービスは利用できません。認証を有効にするには @objectstack/plugin-auth を登録してください。',
    i18n_service_unavailable: 'i18n サービスは利用できません。',
    mcp_server_unavailable: 'MCP サーバーは利用できません。',
    meta_layered_view_unsupported: 'レイヤー化されたメタデータビューはサポートされていません。プロトコル実装がこの機能を提供していません。',
    meta_save_conditions_unsupported:
      'このホストのプロトコルには saveMetaItem がないため、保存時に If-Match、If-None-Match、?mode=draft を適用できません。これらを付けずに保存するか、プロトコルが saveMetaItem を実装しているホストを通じて保存してください。',
    meta_save_unsupported: '保存はサポートされていません。',
    meta_draft_listing_unsupported: '下書きの一覧表示はサポートされていません。',
    meta_stored_migration_unsupported: '保存済みメタデータの移行はサポートされていません。',
    packages_draft_publish_unsupported: '下書きの公開はサポートされていません。',
    packages_draft_discard_unsupported: '下書きの破棄はサポートされていません。',
    packages_commit_history_unsupported: 'コミット履歴はサポートされていません。',
    packages_commit_revert_unsupported: 'コミットの取り消しはサポートされていません。',
    packages_commit_rollback_unsupported: 'コミットへのロールバックはサポートされていません。',
    packages_orphan_adoption_unsupported: '孤立したメタデータの引き取りはサポートされていません。',
    packages_duplication_unsupported: 'パッケージの複製はサポートされていません。',
    packages_customization_ensure_unsupported: 'カスタマイズパッケージの確保はサポートされていません。',
    automation_connector_credentials_unsupported:
      'このデプロイメントに組み込まれた自動化サービスはコネクタ資格情報をサポートしていません。`IAutomationService` の任意メンバー `{{member}}` を実装していません。何も読み取り・変更されていません。',
    automation_connector_connections_unsupported:
      'このデプロイメントに組み込まれた自動化サービスはコネクタ接続をサポートしていません。`IAutomationService` の任意メンバー `{{member}}` を実装していません。何も読み取り・変更されていません。',
    automation_flow_clone_unsupported:
      'フローの複製はサポートされていません。コピーはパッケージに保存されますが、このデプロイメントにはカスタマイズパッケージを確保してフローを保存できるメタデータプロトコルがありません。',
    automation_resume_unsupported: '再開はサポートされていません。',
    automation_run_cancel_unsupported:
      'このデプロイメントに組み込まれた自動化サービスは実行のキャンセルをサポートしていません。`IAutomationService` の任意メンバー `cancelRun` を実装していません。実行はキャンセルされていません。',
    automation_run_restore_unsupported:
      'このデプロイメントに組み込まれた自動化サービスは消費済みの一時停止の復元をサポートしていません。`IAutomationService` の任意メンバー `restoreConsumedSuspension` を実装していません。一時停止は復元されていません。',
    automation_screen_lookup_unsupported: '画面の参照はサポートされていません。',
    automation_runs_list_unsupported:
      'このデプロイメントに組み込まれた自動化サービスはフローの実行一覧をサポートしていません。`IAutomationService` の任意メンバー `listRunsPage` を実装していません。実行は一覧表示されていません。',
    action_activation_ledger_unsupported:
      'このデプロイメントのデータエンジンはパッケージ化されたメタデータの有効化台帳（ADR-0126 §8）を実装していないため、ここではパッケージ化されたアクションを無効にできません。',
    catalog_activation_ledger_missing_on:
      "このデプロイメントには有効化台帳（{{table}}、ADR-0126 §4）がないため、ここでは{{noun}} '{{name}}' を有効にできません。",
    catalog_activation_ledger_missing_off:
      "このデプロイメントには有効化台帳（{{table}}、ADR-0126 §4）がないため、ここでは{{noun}} '{{name}}' を無効にできません。",
    catalog_activation_noun_position: '役職',
    catalog_activation_noun_permission: '権限セット',
    catalog_activation_noun_sharing_rule: '宣言された共有ルール',
    catalog_activation_noun_webhook: '宣言された Webhook',
    catalog_activation_noun_queue: '宣言されたキュー',
    catalog_activation_noun_assignment_rule: '宣言された割り当てルール',
    permission_set_clone_pair_unsupported:
      "権限セット '{{name}}' は読み取り専用パッケージ '{{packageId}}' が提供しているため、そのコピーはこのパッケージと対になるカスタマイズパッケージに属しますが、このデプロイメントのメタデータプロトコルはそれを確保できません。",
    permission_set_clone_no_protocol: 'このデプロイメントにはコピーを保存するためのメタデータプロトコルがないため、ここでは権限セットを複製できません。',
    security_audience_reopen_unsupported: 'このデプロイメントのセキュリティサービスは却下された対象者バインドの提案を再度開く機能を実装していないため、却下はそのまま有効です。',
    share_links_unconfigured: '共有が構成されていません。',
    capability_unavailable_install: '有効にするには {{package}} をインストールしてください。',
    capability_unavailable_unshipped:
      "'{{slot}}' スロットには同梱の実装がありません。有効にするには、このスロットにサービスを登録してください。",
    capability_unavailable_ui:
      'プロトコルサービスが提供します。有効にするには MetadataPlugin（@objectstack/metadata-protocol）を登録してください。',
    capability_unavailable_ai:
      'ObjectOS Cloud/Enterprise の @objectstack/service-ai が提供します。オープンフレームワークには実装が同梱されていません。',
    capability_unavailable_search:
      "'search' スロットには同梱の実装がありません。これは専用の検索エンジン（Elasticsearch/Meilisearch）用のスロットで、有効にするにはこのスロットにサービスを登録してください。オブジェクト横断検索はこれに依存しません。GET {basePath}/search はプロトコル自体が提供し、このホストで提供されているかどうかはこのスロットではなく capabilities.search が報告します。",
  },
  'es-ES': {
    permission_denied:
      'No tiene permiso para realizar esta acción. Póngase en contacto con su administrador si necesita acceso.',
    record_access_denied:
      'No tiene acceso a este registro. Póngase en contacto con la persona responsable del registro o con su administrador si necesita acceso.',
    record_change_not_allowed:
      'No puede guardar este registro con los valores que ha introducido. Modifíquelos e inténtelo de nuevo o póngase en contacto con su administrador si necesita acceso.',
    record_write_denied:
      'No tiene acceso para modificar o eliminar este registro. Póngase en contacto con la persona responsable del registro o con su administrador si necesita hacer cambios.',
    approval_recall_not_submitter:
      'Solo la persona que envió esta solicitud de aprobación puede retirarla. Póngase en contacto con el remitente o con su administrador si es necesario retirarla.',
    record_owner_change_denied:
      'No tiene permiso para cambiar el propietario de este registro. Póngase en contacto con su administrador si es necesario reasignarlo.',
    record_owner_assign_denied:
      'No tiene permiso para crear un registro cuyo propietario sea otra persona. Deje el propietario vacío o asígnese a sí mismo, o póngase en contacto con su administrador.',
    record_owner_remove_denied:
      'No tiene permiso para quitar el propietario de este registro. Póngase en contacto con su administrador si necesita otro propietario.',
    record_queue_change_denied:
      'No tiene permiso para cambiar la cola en la que está este registro. Póngase en contacto con su administrador si es necesario moverlo.',
    record_queue_assign_denied:
      'No tiene permiso para crear un registro en esa cola. Deje la cola vacía o elija una cola a la que pertenezca, o póngase en contacto con su administrador.',
    master_record_edit_denied:
      'Necesita acceso de edición al registro de {{master}} al que pertenece este registro. Póngase en contacto con la persona responsable de ese registro de {{master}} o con su administrador si necesita acceso.',
    master_record_edit_denied_opaque:
      'Necesita acceso de edición al registro principal al que pertenece este registro. Póngase en contacto con su administrador si necesita acceso.',
    master_record_read_denied:
      'Necesita acceso de lectura al registro de {{master}} al que pertenece este registro. Póngase en contacto con la persona responsable de ese registro de {{master}} o con su administrador si necesita acceso.',
    master_record_read_denied_opaque:
      'Necesita acceso de lectura al registro principal al que pertenece este registro. Póngase en contacto con su administrador si necesita acceso.',
    field_edit_denied:
      'No tiene permiso para editar {{fields}}. Deshaga esos cambios e inténtelo de nuevo, o póngase en contacto con su administrador si necesita acceso.',
    field_edit_denied_opaque:
      'No tiene permiso para editar uno o varios de los campos que ha modificado. Deshaga esos cambios e inténtelo de nuevo, o póngase en contacto con su administrador si necesita acceso.',
    field_label_quoted: '«{{label}}»',
    field_label_list_separator: ', ',
    delete_restricted:
      '{{count}} registro(s) de {{dependentObject}} todavía hacen referencia a este {{object}} mediante «{{field}}». Elimínelos o reasígnelos primero.',
    delete_restricted_required:
      '{{count}} registro(s) de {{dependentObject}} todavía hacen referencia a este {{object}} mediante «{{field}}», un campo obligatorio que no puede vaciarse. Elimínelos o reasígnelos primero.',
    delete_restricted_opaque:
      'Todavía hay registros de {{dependentObject}} que hacen referencia a este {{object}} mediante «{{field}}». Elimínelos o reasígnelos primero.',
    delete_restricted_required_opaque:
      'Todavía hay registros de {{dependentObject}} que hacen referencia a este {{object}} mediante «{{field}}», un campo obligatorio que no puede vaciarse. Elimínelos o reasígnelos primero.',
    duplicate_record: 'Ya existe un registro con este valor',
    duplicate_record_field: 'Ya existe un registro con el mismo valor de {{field}}',
    duplicate_record_fields: 'Ya existe un registro con los mismos valores de {{fields}}',
    record_locked:
      'El registro de {{object}} «{{title}}» está bloqueado mientras hay una aprobación en curso y no se puede editar hasta que esa aprobación finalice',
    record_locked_unlabeled:
      'El registro «{{title}}» está bloqueado mientras hay una aprobación en curso y no se puede editar hasta que esa aprobación finalice',
    record_locked_untitled:
      'Este registro de {{object}} está bloqueado mientras hay una aprobación en curso y no se puede editar hasta que esa aprobación finalice',
    record_locked_opaque:
      'Este registro está bloqueado mientras hay una aprobación en curso y no se puede editar hasta que esa aprobación finalice',
    record_not_found: 'Este registro no existe o no tiene acceso a él.',
    query_field_not_readable:
      'Esta solicitud filtra, ordena o agrupa por un campo al que no tiene acceso. Quite esa condición e inténtelo de nuevo, o póngase en contacto con su administrador si necesita acceso.',
    delegation_scope_violation:
      'Este cambio está fuera del ámbito que se le ha delegado para administrar. Póngase en contacto con su administrador si es necesario realizarlo.',
    print_engine_unavailable:
      'En este momento no se pueden imprimir registros en un archivo: el motor de impresión no está listo. El motivo figura en el registro del servidor.',
    print_timed_out: 'No se pudo imprimir el registro en un archivo dentro del tiempo permitido.',
    print_failed: 'No se pudo imprimir el registro en un archivo debido a un error en el servidor.',
    print_caller_unresolved: 'No se pudo identificar a la persona que solicitó esta impresión.',
    action_forward_unavailable:
      "La acción '{{action}}' es una acción `type: 'api'` del mismo origen cuyo `target` ({{target}}) este punto de acceso reenvía dentro del proceso, pero el servidor HTTP de esta implementación no expone ninguna vía de solicitud en proceso (IHttpServer.getRawApp). Operador: ejecute un plugin de servidor HTTP que implemente getRawApp; la acción no se despacha eludiendo este punto de acceso.",
    action_forward_unavailable_host:
      "La acción '{{action}}' es una acción `type: 'api'` del mismo origen cuyo `target` ({{target}}) este punto de acceso reenvía dentro del proceso, pero el kernel que se pasó a dispatchAction no expone ninguna vía de solicitud en proceso (IHttpServer.getRawApp). Pase a dispatchAction el kernel desde el que se sirve su punto de acceso HTTP: en un host con varios kernels, el kernel que registra `kernel-resolver`, con el `environmentId` de la llamada (el kernel propio de un entorno no tiene socket). En un solo kernel, ejecute un plugin de servidor HTTP que implemente getRawApp. La acción no se despacha eludiendo este punto de acceso.",
    action_forward_target_unnamed: 'punto de acceso',
    own_door_service_unregistered:
      '{{door}} no está disponible: no hay ningún servicio {{slot}} registrado en este kernel. Lo registra {{producer}}.',
    own_door_member_missing: '{{door}} no está disponible: el servicio {{slot}} registrado no implementa {{member}}.',
    own_door_print: 'el punto de acceso de impresión',
    own_door_personal_view_delete: 'el punto de acceso para eliminar vistas personales',
    own_door_attachment_mutate: 'los puntos de acceso para eliminar y renombrar adjuntos',
    own_door_service_unregistered_plural:
      '{{door}} no están disponibles: no hay ningún servicio {{slot}} registrado en este kernel. Lo registra {{producer}}.',
    own_door_member_missing_plural: '{{door}} no están disponibles: el servicio {{slot}} registrado no implementa {{member}}.',
    comment_doors_service_unregistered:
      'Los puntos de acceso de comentarios no están disponibles: no hay ningún servicio comments registrado. Lo registra @objectstack/plugin-audit; componga AuditPlugin en este kernel.',
    comment_doors_member_missing:
      'Los puntos de acceso de comentarios no están disponibles: el servicio comments registrado no implementa handleCommentDoor.',
    webhook_redeliver_service_unregistered:
      'El reenvío de webhooks no está disponible: no hay ningún servicio webhooks registrado. @objectstack/plugin-webhooks lo registra una vez instalado su veto de reenvío, que necesita el motor de datos y @objectstack/service-messaging; el registro de arranque indica cuál falta.',
    webhook_redeliver_member_missing:
      'El reenvío de webhooks no está disponible: el servicio webhooks registrado no implementa handleRedeliver.',
    approvals_act_service_unregistered:
      'Las páginas de acción de aprobación no están disponibles: no hay ningún servicio approvals registrado. Registre @objectstack/plugin-approvals para servirlas.',
    approvals_act_member_missing:
      'Las páginas de acción de aprobación no están disponibles: el servicio approvals registrado no implementa handleActionPage.',
    automation_hooks_service_unregistered:
      'Los ganchos de automatización entrantes no están disponibles: no hay ningún servicio trigger-api registrado. El disparador de ganchos entrantes (@objectstack/trigger-api) sirve esta ruta a través de ese servicio; compóngalo en el entorno al que pertenece el flujo.',
    automation_hooks_member_missing:
      'Los ganchos de automatización entrantes no están disponibles: el servicio trigger-api registrado no implementa handleInboundHook.',
    auth_service_unavailable:
      'El servicio de autenticación no está disponible: registre @objectstack/plugin-auth para habilitar la autenticación.',
    i18n_service_unavailable: 'El servicio i18n no está disponible.',
    mcp_server_unavailable: 'El servidor MCP no está disponible.',
    meta_layered_view_unsupported:
      'La vista de metadatos por capas no está disponible: la implementación del protocolo no la admite.',
    meta_save_conditions_unsupported:
      'Este host no tiene saveMetaItem en su protocolo, por lo que no puede respetar If-Match, If-None-Match ni ?mode=draft al guardar. Guarde sin ellos o guarde a través de un host cuyo protocolo implemente saveMetaItem.',
    meta_save_unsupported: 'No se admite guardar.',
    meta_draft_listing_unsupported: 'No se admite listar borradores.',
    meta_stored_migration_unsupported: 'No se admite migrar los metadatos almacenados.',
    packages_draft_publish_unsupported: 'No se admite publicar borradores.',
    packages_draft_discard_unsupported: 'No se admite descartar borradores.',
    packages_commit_history_unsupported: 'No se admite el historial de confirmaciones.',
    packages_commit_revert_unsupported: 'No se admite revertir una confirmación.',
    packages_commit_rollback_unsupported: 'No se admite restaurar una confirmación anterior.',
    packages_orphan_adoption_unsupported: 'No se admite adoptar metadatos huérfanos.',
    packages_duplication_unsupported: 'No se admite duplicar paquetes.',
    packages_customization_ensure_unsupported: 'No se admite asegurar el paquete de personalización.',
    automation_connector_credentials_unsupported:
      'El servicio de automatización que monta esta implementación no admite credenciales de conector: no implementa `{{member}}`, un miembro opcional de `IAutomationService`. No se leyó ni cambió nada.',
    automation_connector_connections_unsupported:
      'El servicio de automatización que monta esta implementación no admite conexiones de conector: no implementa `{{member}}`, un miembro opcional de `IAutomationService`. No se leyó ni cambió nada.',
    automation_flow_clone_unsupported:
      'No se admite clonar flujos: la copia se guarda en un paquete, y esta implementación no tiene un protocolo de metadatos que pueda asegurar un paquete de personalización y guardar en él un flujo.',
    automation_resume_unsupported: 'No se admite reanudar.',
    automation_run_cancel_unsupported:
      'El servicio de automatización que monta esta implementación no admite cancelar una ejecución: no implementa `cancelRun`, un miembro opcional de `IAutomationService`. No se canceló ninguna ejecución.',
    automation_run_restore_unsupported:
      'El servicio de automatización que monta esta implementación no admite restaurar una suspensión consumida: no implementa `restoreConsumedSuspension`, un miembro opcional de `IAutomationService`. No se restauró ninguna suspensión.',
    automation_screen_lookup_unsupported: 'No se admite consultar la pantalla.',
    automation_runs_list_unsupported:
      'El servicio de automatización que monta esta implementación no admite listar las ejecuciones de un flujo: no implementa `listRunsPage`, un miembro opcional de `IAutomationService`. No se listó ninguna ejecución.',
    action_activation_ledger_unsupported:
      'El motor de datos de esta implementación no implementa el registro de activación de metadatos empaquetados (ADR-0126 §8), por lo que aquí no se puede desactivar una acción empaquetada.',
    catalog_activation_ledger_missing_on:
      "Esta implementación no tiene el registro de activación ({{table}}, ADR-0126 §4), por lo que aquí no se puede activar {{noun}} '{{name}}'.",
    catalog_activation_ledger_missing_off:
      "Esta implementación no tiene el registro de activación ({{table}}, ADR-0126 §4), por lo que aquí no se puede desactivar {{noun}} '{{name}}'.",
    catalog_activation_noun_position: 'el puesto',
    catalog_activation_noun_permission: 'el conjunto de permisos',
    catalog_activation_noun_sharing_rule: 'la regla de uso compartido declarada',
    catalog_activation_noun_webhook: 'el webhook declarado',
    catalog_activation_noun_queue: 'la cola declarada',
    catalog_activation_noun_assignment_rule: 'la regla de asignación declarada',
    permission_set_clone_pair_unsupported:
      "El conjunto de permisos '{{name}}' lo proporciona el paquete de solo lectura '{{packageId}}', así que su copia pertenece al paquete de personalización emparejado con ese paquete, y el protocolo de metadatos de esta implementación no puede asegurarlo.",
    permission_set_clone_no_protocol:
      'Esta implementación no tiene un protocolo de metadatos con el que guardar la copia, por lo que aquí no se puede clonar un conjunto de permisos.',
    security_audience_reopen_unsupported:
      'El servicio de seguridad de esta implementación no implementa reabrir una sugerencia de vinculación de audiencia descartada, por lo que el descarte se mantiene.',
    share_links_unconfigured: 'El uso compartido no está configurado.',
    capability_unavailable_install: 'Instale {{package}} para habilitarlo.',
    capability_unavailable_unshipped:
      "No se incluye ninguna implementación para la ranura '{{slot}}': registre un servicio en ella para habilitarla.",
    capability_unavailable_ui:
      'Lo proporciona el servicio de protocolo: registre MetadataPlugin (@objectstack/metadata-protocol) para habilitarlo.',
    capability_unavailable_ai:
      'Lo proporciona @objectstack/service-ai en ObjectOS Cloud/Enterprise; el framework abierto no incluye ninguna implementación.',
    capability_unavailable_search:
      "No se incluye ninguna implementación para la ranura 'search': corresponde a un motor de búsqueda dedicado (Elasticsearch/Meilisearch); registre un servicio en ella para habilitarla. La búsqueda entre objetos no depende de ella: GET {basePath}/search lo sirve el propio protocolo, y si se sirve en este host lo indica capabilities.search, no esta ranura.",
  },
};

/** Locale whose catalog is guaranteed complete and used as the last resort. */
export const OPERATION_MESSAGE_FALLBACK_LOCALE = 'en';

export interface RenderOperationMessageInput {
  /** Catalog key, e.g. `delete_restricted`. */
  messageKey: string;
  /** Placeholder values — labels, counts. */
  params?: Record<string, unknown>;
}

export interface RenderOperationMessageOptions {
  /** BCP-47 locale; defaults to `en`. */
  locale?: string;
  /**
   * Deployment override hook — an `II18nService.t`-compatible lookup. It is
   * asked for the override TEMPLATE with no params (`translate(key, locale)`);
   * the renderer fills the placeholders once.
   */
  translate?: ValidationMessageTranslator;
}

/**
 * Render one built-in operation message in the caller's locale.
 *
 * Resolution order (identical to {@link renderValidationMessage}, deliberately
 * — two resolution orders for two catalogs is how a deployment's overrides
 * start behaving differently depending on which layer refused):
 *   1. `translate('errors.<messageKey>', locale)` — a deployment's
 *      `translation` override. A miss is detected by the II18nService contract
 *      of echoing the key back.
 *   2. the built-in catalog for the locale (BCP-47 matched).
 *   3. the built-in catalog for `en`.
 *   4. the messageKey itself — only reachable for a key absent from even the
 *      English catalog, i.e. a coding error; still returns something a human
 *      can act on rather than an empty string.
 */
export function renderOperationMessage(
  input: RenderOperationMessageInput,
  opts: RenderOperationMessageOptions = {},
): string {
  const locale = opts.locale ?? OPERATION_MESSAGE_FALLBACK_LOCALE;
  const params = input.params ?? {};

  if (opts.translate) {
    const key = operationMessageTranslationKey(input.messageKey);
    let override: string | undefined;
    try {
      // [#34454] The override TEMPLATE is asked for, without `params`, and
      // interpolated once below. An `II18nService.t` handed `params`
      // interpolates them itself, and a second pass here would then expand a
      // placeholder that arrived inside a VALUE (a record title such as
      // `Q{{object}}`) instead of printing it as written.
      override = opts.translate(key, locale);
    } catch {
      // A misbehaving i18n service must never turn a 409 into a 500.
      override = undefined;
    }
    if (typeof override === 'string' && override.length > 0 && override !== key) {
      return interpolateValidationMessage(override, params);
    }
  }

  const matched = resolveBundleLocale(BUILTIN_OPERATION_MESSAGES, locale);
  const template = (matched !== undefined
    ? BUILTIN_OPERATION_MESSAGES[matched][input.messageKey]
    : undefined)
    ?? BUILTIN_OPERATION_MESSAGES[OPERATION_MESSAGE_FALLBACK_LOCALE][input.messageKey];

  if (template === undefined) return input.messageKey;
  return interpolateValidationMessage(template, params);
}
