// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12454 — the Automations rail groups flows by the object each one is
 * about, read off the flow's own definition as the metadata list serves it.
 *
 * The fixture is HotCRM's flow list, `GET /api/v1/meta/flow?package=app.objectstack.hotcrm`,
 * served by `objectstack dev` from hotcrm `63db83e` on 2026-10-15, with every
 * key the grouping does not read removed (labels, descriptions, variables and
 * node config other than `objectName`, `triggerType`, `schedule`,
 * `timeRelative` and the nested regions). The object index is the same
 * server's `GET /api/v1/meta/object?package=app.objectstack.hotcrm`.
 *
 * The card (measured on an older HotCRM) listed 23 flows in ten groups. HotCRM
 * has since added three flows, each under an object that already had a group
 * (`billing_handoff_contract_activated` on Contract, `billing_handoff_closed_won`
 * on Opportunity, `task_due_reminder` on Task), so the ten groups stand and three
 * counts move by one.
 */

import { describe, it, expect } from 'vitest';
import { FLOW_TRIGGER_GLYPHS, flowGroupObject, flowTriggerGlyph, groupFlowsByObject, navigationObjectOrder } from './flowGrouping';

/** HotCRM `63db83e`'s served flow list, trimmed to what the grouping reads (see the header). */
const HOTCRM_FLOWS: Array<Record<string, unknown> & { name: string; label: string }> = [
  {"name":"campaign_enrollment","label":"Enroll Members in Campaign","type":"screen","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_campaign"}},{"id":"screen_1","type":"screen"},{"id":"get_campaign","type":"get_record","config":{"objectName":"crm_campaign"}},{"id":"check_campaign_open","type":"decision"},{"id":"query_leads","type":"get_record","config":{"objectName":"crm_lead"}},{"id":"loop_leads","type":"loop","config":{"body":{"nodes":[{"id":"guard_lead","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_lead","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"find_existing_member","type":"get_record","config":{"objectName":"crm_campaign_member"}},{"id":"check_not_enrolled","type":"decision"},{"id":"create_campaign_member","type":"subflow"}],"edges":[{"source":"find_existing_member","target":"check_not_enrolled"},{"source":"check_not_enrolled","target":"create_campaign_member"}]}}}],"edges":[]}}},{"id":"query_contacts","type":"get_record","config":{"objectName":"crm_contact"}},{"id":"loop_contacts","type":"loop","config":{"body":{"nodes":[{"id":"guard_contact","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_contact","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"find_existing_contact_member","type":"get_record","config":{"objectName":"crm_campaign_member"}},{"id":"check_contact_not_enrolled","type":"decision"},{"id":"create_contact_member","type":"subflow"}],"edges":[{"source":"find_existing_contact_member","target":"check_contact_not_enrolled"},{"source":"check_contact_not_enrolled","target":"create_contact_member"}]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"screen_1"},{"source":"screen_1","target":"get_campaign"},{"source":"get_campaign","target":"check_campaign_open"},{"source":"check_campaign_open","target":"query_leads"},{"source":"query_leads","target":"loop_leads"},{"source":"loop_leads","target":"end"},{"source":"check_campaign_open","target":"query_contacts"},{"source":"query_contacts","target":"loop_contacts"},{"source":"loop_contacts","target":"end"}]},
  {"name":"campaign_lead_member_enroll","label":"Enroll Lead in Campaign","type":"autolaunched","nodes":[{"id":"start","type":"start"},{"id":"create_campaign_member","type":"create_record","config":{"objectName":"crm_campaign_member"}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"create_campaign_member"},{"source":"create_campaign_member","target":"end"}]},
  {"name":"campaign_contact_member_enroll","label":"Enroll Contact in Campaign","type":"autolaunched","nodes":[{"id":"start","type":"start"},{"id":"create_contact_member","type":"create_record","config":{"objectName":"crm_campaign_member"}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"create_contact_member"},{"source":"create_contact_member","target":"end"}]},
  {"name":"account_approval","label":"Account Approval","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_account","triggerType":"record-after-create"}},{"id":"get_account","type":"get_record","config":{"objectName":"crm_account"}},{"id":"account_review","type":"approval"},{"id":"mark_approved","type":"update_record","config":{"objectName":"crm_account"}},{"id":"notify_approved","type":"notify"},{"id":"mark_rejected","type":"update_record","config":{"objectName":"crm_account"}},{"id":"notify_rejected","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_account"},{"source":"get_account","target":"account_review"},{"source":"account_review","target":"mark_approved"},{"source":"account_review","target":"mark_rejected"},{"source":"mark_approved","target":"notify_approved"},{"source":"notify_approved","target":"end"},{"source":"mark_rejected","target":"notify_rejected"},{"source":"notify_rejected","target":"end"}]},
  {"name":"lead_conversion","label":"Lead Conversion Process","type":"screen","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_lead"}},{"id":"screen_1","type":"screen"},{"id":"get_lead","type":"get_record","config":{"objectName":"crm_lead"}},{"id":"decision_duplicate","type":"decision"},{"id":"warn_duplicate","type":"assignment"},{"id":"no_duplicate_warning","type":"assignment"},{"id":"refuse_confirmed_duplicate","type":"end"},{"id":"decision_approval","type":"decision"},{"id":"refuse_unapproved","type":"end"},{"id":"decision_match_key","type":"decision"},{"id":"refuse_no_match_key","type":"end"},{"id":"decision_amount","type":"decision"},{"id":"refuse_nonpositive_amount","type":"end"},{"id":"find_account","type":"get_record","config":{"objectName":"crm_account"}},{"id":"decision_account","type":"decision"},{"id":"create_account","type":"create_record","config":{"objectName":"crm_account"}},{"id":"copy_account_revenue","type":"subflow"},{"id":"use_new_account","type":"assignment"},{"id":"use_existing_account","type":"assignment"},{"id":"find_contact","type":"get_record","config":{"objectName":"crm_contact"}},{"id":"decision_contact","type":"decision"},{"id":"create_contact","type":"create_record","config":{"objectName":"crm_contact"}},{"id":"use_new_contact","type":"assignment"},{"id":"use_existing_contact","type":"assignment"},{"id":"decision_contact_do_not_call","type":"decision"},{"id":"raise_contact_do_not_call","type":"update_record","config":{"objectName":"crm_contact"}},{"id":"decision_contact_email_opt_out","type":"decision"},{"id":"raise_contact_email_opt_out","type":"update_record","config":{"objectName":"crm_contact"}},{"id":"decision_opportunity","type":"decision"},{"id":"create_opportunity","type":"create_record","config":{"objectName":"crm_opportunity"}},{"id":"use_new_opportunity","type":"assignment"},{"id":"no_opportunity","type":"assignment"},{"id":"mark_converted","type":"update_record","config":{"objectName":"crm_lead"}},{"id":"send_notification","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_lead"},{"source":"get_lead","target":"decision_approval"},{"source":"decision_approval","target":"refuse_unapproved"},{"source":"decision_approval","target":"decision_duplicate"},{"source":"decision_duplicate","target":"warn_duplicate"},{"source":"decision_duplicate","target":"refuse_confirmed_duplicate"},{"source":"decision_duplicate","target":"no_duplicate_warning"},{"source":"warn_duplicate","target":"decision_match_key"},{"source":"no_duplicate_warning","target":"decision_match_key"},{"source":"decision_match_key","target":"screen_1"},{"source":"decision_match_key","target":"refuse_no_match_key"},{"source":"screen_1","target":"decision_amount"},{"source":"decision_amount","target":"find_account"},{"source":"decision_amount","target":"refuse_nonpositive_amount"},{"source":"find_account","target":"decision_account"},{"source":"decision_account","target":"use_existing_account"},{"source":"decision_account","target":"create_account"},{"source":"create_account","target":"copy_account_revenue"},{"source":"copy_account_revenue","target":"use_new_account"},{"source":"use_new_account","target":"find_contact"},{"source":"use_existing_account","target":"find_contact"},{"source":"find_contact","target":"decision_contact"},{"source":"decision_contact","target":"use_existing_contact"},{"source":"decision_contact","target":"create_contact"},{"source":"create_contact","target":"use_new_contact"},{"source":"use_new_contact","target":"decision_opportunity"},{"source":"use_existing_contact","target":"decision_contact_do_not_call"},{"source":"decision_contact_do_not_call","target":"raise_contact_do_not_call"},{"source":"decision_contact_do_not_call","target":"decision_contact_email_opt_out"},{"source":"raise_contact_do_not_call","target":"decision_contact_email_opt_out"},{"source":"decision_contact_email_opt_out","target":"raise_contact_email_opt_out"},{"source":"decision_contact_email_opt_out","target":"decision_opportunity"},{"source":"raise_contact_email_opt_out","target":"decision_opportunity"},{"source":"decision_opportunity","target":"create_opportunity"},{"source":"decision_opportunity","target":"no_opportunity"},{"source":"create_opportunity","target":"use_new_opportunity"},{"source":"use_new_opportunity","target":"mark_converted"},{"source":"no_opportunity","target":"mark_converted"},{"source":"mark_converted","target":"send_notification"},{"source":"send_notification","target":"end"}]},
  {"name":"lead_conversion_account_revenue","label":"Copy Lead Revenue to New Account","type":"autolaunched","nodes":[{"id":"start","type":"start"},{"id":"copy_revenue","type":"update_record","config":{"objectName":"crm_account"}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"copy_revenue"},{"source":"copy_revenue","target":"end"}]},
  {"name":"lead_conversion_approval","label":"Lead Conversion Approval","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_lead","triggerType":"record-after-create"}},{"id":"get_lead","type":"get_record","config":{"objectName":"crm_lead"}},{"id":"conversion_review","type":"approval"},{"id":"mark_approved","type":"update_record","config":{"objectName":"crm_lead"}},{"id":"notify_approved","type":"notify"},{"id":"mark_rejected","type":"update_record","config":{"objectName":"crm_lead"}},{"id":"notify_rejected","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_lead"},{"source":"get_lead","target":"conversion_review"},{"source":"conversion_review","target":"mark_approved"},{"source":"conversion_review","target":"mark_rejected"},{"source":"mark_approved","target":"notify_approved"},{"source":"notify_approved","target":"end"},{"source":"mark_rejected","target":"notify_rejected"},{"source":"notify_rejected","target":"end"}]},
  {"name":"schedule_followup","label":"Schedule Follow-up","type":"screen","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_lead"}},{"id":"screen_1","type":"screen"},{"id":"get_lead","type":"get_record","config":{"objectName":"crm_lead"}},{"id":"create_task","type":"create_record","config":{"objectName":"crm_task"}},{"id":"stamp_lead","type":"update_record","config":{"objectName":"crm_lead"}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"screen_1"},{"source":"screen_1","target":"get_lead"},{"source":"get_lead","target":"create_task"},{"source":"create_task","target":"stamp_lead"},{"source":"stamp_lead","target":"end"}]},
  {"name":"opportunity_approval","label":"Large Deal Approval","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity","triggerType":"record-after-update"}},{"id":"get_opportunity","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"manager_review","type":"approval"},{"id":"check_high_value","type":"decision"},{"id":"director_signoff","type":"approval"},{"id":"mark_approved","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"notify_approved","type":"notify"},{"id":"mark_rejected","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"notify_rejected","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_opportunity"},{"source":"get_opportunity","target":"manager_review"},{"source":"manager_review","target":"check_high_value"},{"source":"manager_review","target":"mark_rejected"},{"source":"check_high_value","target":"director_signoff"},{"source":"check_high_value","target":"mark_approved"},{"source":"director_signoff","target":"mark_approved"},{"source":"director_signoff","target":"mark_rejected"},{"source":"mark_approved","target":"notify_approved"},{"source":"notify_approved","target":"end"},{"source":"mark_rejected","target":"notify_rejected"},{"source":"notify_rejected","target":"end"}]},
  {"name":"opportunity_approval_on_create","label":"Large Deal Approval (on create)","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity","triggerType":"record-after-create"}},{"id":"get_opportunity","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"manager_review","type":"approval"},{"id":"check_high_value","type":"decision"},{"id":"director_signoff","type":"approval"},{"id":"mark_approved","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"notify_approved","type":"notify"},{"id":"mark_rejected","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"notify_rejected","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_opportunity"},{"source":"get_opportunity","target":"manager_review"},{"source":"manager_review","target":"check_high_value"},{"source":"manager_review","target":"mark_rejected"},{"source":"check_high_value","target":"director_signoff"},{"source":"check_high_value","target":"mark_approved"},{"source":"director_signoff","target":"mark_approved"},{"source":"director_signoff","target":"mark_rejected"},{"source":"mark_approved","target":"notify_approved"},{"source":"notify_approved","target":"end"},{"source":"mark_rejected","target":"notify_rejected"},{"source":"notify_rejected","target":"end"}]},
  {"name":"opportunity_status_change_approval","label":"Opportunity Status Change Approval","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity","triggerType":"record-after-update"}},{"id":"get_opportunity","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"status_review","type":"approval"},{"id":"apply_status","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"clear_request","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_opportunity"},{"source":"get_opportunity","target":"status_review"},{"source":"status_review","target":"apply_status"},{"source":"status_review","target":"clear_request"},{"source":"apply_status","target":"end"},{"source":"clear_request","target":"end"}]},
  {"name":"opportunity_qualification_approval","label":"Opportunity Qualification Approval","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity","triggerType":"record-after-update"}},{"id":"get_opportunity","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"qualification_review","type":"approval"},{"id":"mark_qualified","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"clear_request","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_opportunity"},{"source":"get_opportunity","target":"qualification_review"},{"source":"qualification_review","target":"mark_qualified"},{"source":"qualification_review","target":"clear_request"},{"source":"mark_qualified","target":"end"},{"source":"clear_request","target":"end"}]},
  {"name":"quote_generation","label":"Generate Quote from Opportunity","type":"screen","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity"}},{"id":"get_held","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"refuse_held","type":"end"},{"id":"screen_1","type":"screen"},{"id":"get_opportunity","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"create_quote","type":"create_record","config":{"objectName":"crm_quote"}},{"id":"check_stage","type":"decision"},{"id":"update_opportunity","type":"update_record","config":{"objectName":"crm_opportunity"}},{"id":"notify_owner","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"get_held"},{"source":"get_held","target":"refuse_held"},{"source":"get_held","target":"screen_1"},{"source":"screen_1","target":"get_opportunity"},{"source":"get_opportunity","target":"create_quote"},{"source":"create_quote","target":"check_stage"},{"source":"check_stage","target":"update_opportunity"},{"source":"check_stage","target":"notify_owner"},{"source":"update_opportunity","target":"notify_owner"},{"source":"notify_owner","target":"end"}]},
  {"name":"contract_renewal","label":"Contract Renewal Reminder","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"0 8 * * *"}},{"id":"query_contracts","type":"get_record","config":{"objectName":"crm_contract"}},{"id":"loop_contracts","type":"loop","config":{"body":{"nodes":[{"id":"guard_contract","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_contract","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"check_notice_window","type":"decision"},{"id":"find_existing_task","type":"get_record","config":{"objectName":"crm_task"}},{"id":"check_not_reminded","type":"decision"},{"id":"create_renewal_task","type":"create_record","config":{"objectName":"crm_task"}},{"id":"notify_owner","type":"notify"},{"id":"check_auto_renewal","type":"decision"},{"id":"find_existing_renewal_opp","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"check_no_open_renewal","type":"decision"},{"id":"create_renewal_opp","type":"create_record","config":{"objectName":"crm_opportunity"}}],"edges":[{"source":"check_notice_window","target":"find_existing_task"},{"source":"find_existing_task","target":"check_not_reminded"},{"source":"check_not_reminded","target":"create_renewal_task"},{"source":"create_renewal_task","target":"notify_owner"},{"source":"notify_owner","target":"check_auto_renewal"},{"source":"check_auto_renewal","target":"find_existing_renewal_opp"},{"source":"find_existing_renewal_opp","target":"check_no_open_renewal"},{"source":"check_no_open_renewal","target":"create_renewal_opp"}]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_contracts"},{"source":"query_contracts","target":"loop_contracts"},{"source":"loop_contracts","target":"end"}]},
  {"name":"opportunity_stagnation","label":"Stalled Deal Alert","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"30 7 * * *"}},{"id":"query_stalled","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"loop_opps","type":"loop","config":{"body":{"nodes":[{"id":"guard_opp","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_opp","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"find_existing_task","type":"get_record","config":{"objectName":"crm_task"}},{"id":"check_not_nudged","type":"decision"},{"id":"notify_owner","type":"notify"},{"id":"create_followup_task","type":"create_record","config":{"objectName":"crm_task"}}],"edges":[{"source":"find_existing_task","target":"check_not_nudged"},{"source":"check_not_nudged","target":"notify_owner"},{"source":"notify_owner","target":"create_followup_task"}]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_stalled"},{"source":"query_stalled","target":"loop_opps"},{"source":"loop_opps","target":"end"}]},
  {"name":"forecast_snapshot","label":"Forecast Snapshot","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"0 3 * * *"}},{"id":"query_owners","type":"get_record","config":{"objectName":"sys_user"}},{"id":"loop_owners","type":"loop","config":{"body":{"nodes":[{"id":"guard_owner","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_owner","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"find_any_deal","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"has_deals","type":"decision"},{"id":"find_forecast","type":"get_record","config":{"objectName":"crm_forecast"}},{"id":"check_missing","type":"decision"},{"id":"create_forecast","type":"create_record","config":{"objectName":"crm_forecast"}},{"id":"reload_forecast","type":"get_record","config":{"objectName":"crm_forecast"}},{"id":"check_owned","type":"decision"},{"id":"reset_totals","type":"assignment"},{"id":"find_pipeline","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"sum_pipeline","type":"loop","config":{"body":{"nodes":[{"id":"add_pipeline","type":"assignment"}],"edges":[]}}},{"id":"find_best_case","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"sum_best_case","type":"loop","config":{"body":{"nodes":[{"id":"add_best_case","type":"assignment"}],"edges":[]}}},{"id":"find_commit","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"sum_commit","type":"loop","config":{"body":{"nodes":[{"id":"add_commit","type":"assignment"}],"edges":[]}}},{"id":"find_won","type":"get_record","config":{"objectName":"crm_opportunity"}},{"id":"sum_won","type":"loop","config":{"body":{"nodes":[{"id":"add_won","type":"assignment"}],"edges":[]}}},{"id":"write_snapshot","type":"update_record","config":{"objectName":"crm_forecast"}}],"edges":[{"source":"find_any_deal","target":"has_deals"},{"source":"has_deals","target":"find_forecast"},{"source":"find_forecast","target":"check_missing"},{"source":"check_missing","target":"create_forecast"},{"source":"check_missing","target":"reload_forecast"},{"source":"create_forecast","target":"reload_forecast"},{"source":"reload_forecast","target":"check_owned"},{"source":"check_owned","target":"reset_totals"},{"source":"reset_totals","target":"find_pipeline"},{"source":"find_pipeline","target":"sum_pipeline"},{"source":"sum_pipeline","target":"find_best_case"},{"source":"find_best_case","target":"sum_best_case"},{"source":"sum_best_case","target":"find_commit"},{"source":"find_commit","target":"sum_commit"},{"source":"sum_commit","target":"find_won"},{"source":"find_won","target":"sum_won"},{"source":"sum_won","target":"write_snapshot"}]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_owners"},{"source":"query_owners","target":"loop_owners"},{"source":"loop_owners","target":"end"}]},
  {"name":"lead_assignment","label":"New Lead Routing & SLA","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_lead","triggerType":"record-after-create"}},{"id":"check_hot","type":"decision"},{"id":"sla_hot","type":"update_record","config":{"objectName":"crm_lead"}},{"id":"owner_hot","type":"decision"},{"id":"notify_hot","type":"notify"},{"id":"sla_std","type":"update_record","config":{"objectName":"crm_lead"}},{"id":"owner_std","type":"decision"},{"id":"notify_std","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"check_hot"},{"source":"check_hot","target":"sla_hot"},{"source":"check_hot","target":"sla_std"},{"source":"sla_hot","target":"owner_hot"},{"source":"notify_hot","target":"end"},{"source":"sla_std","target":"owner_std"},{"source":"notify_std","target":"end"},{"source":"owner_hot","target":"notify_hot"},{"source":"owner_hot","target":"end"},{"source":"owner_std","target":"notify_std"},{"source":"owner_std","target":"end"}]},
  {"name":"campaign_completion","label":"Campaign Auto-Completion","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"0 2 * * *"}},{"id":"query_campaigns","type":"get_record","config":{"objectName":"crm_campaign"}},{"id":"loop_campaigns","type":"loop","config":{"body":{"nodes":[{"id":"guard_campaign","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_campaign","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"mark_completed","type":"update_record","config":{"objectName":"crm_campaign"}}],"edges":[]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_campaigns"},{"source":"query_campaigns","target":"loop_campaigns"},{"source":"loop_campaigns","target":"end"}]},
  {"name":"quote_expiration","label":"Quote Auto-Expiration","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"0 1 * * *"}},{"id":"query_quotes","type":"get_record","config":{"objectName":"crm_quote"}},{"id":"loop_quotes","type":"loop","config":{"body":{"nodes":[{"id":"guard_quote","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_quote","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"mark_expired","type":"update_record","config":{"objectName":"crm_quote"}}],"edges":[]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_quotes"},{"source":"query_quotes","target":"loop_quotes"},{"source":"loop_quotes","target":"end"}]},
  {"name":"contract_expiration","label":"Contract Auto-Expiration","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"0 0 * * *"}},{"id":"query_contracts","type":"get_record","config":{"objectName":"crm_contract"}},{"id":"loop_contracts","type":"loop","config":{"body":{"nodes":[{"id":"guard_contract","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_contract","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"mark_expired","type":"update_record","config":{"objectName":"crm_contract"}},{"id":"notify_owner","type":"notify"}],"edges":[{"source":"mark_expired","target":"notify_owner"}]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_contracts"},{"source":"query_contracts","target":"loop_contracts"},{"source":"loop_contracts","target":"end"}]},
  {"name":"contact_welcome","label":"Contact Welcome","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_contact","triggerType":"record-after-create"}},{"id":"send_welcome","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"send_welcome"},{"source":"send_welcome","target":"end"}]},
  {"name":"opportunity_won_alert","label":"Large Deal Won Alert","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity","triggerType":"record-after-update"}},{"id":"notify_management","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"notify_management"},{"source":"notify_management","target":"end"}]},
  {"name":"task_urgent_alert","label":"Urgent Task Alert","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_task","triggerType":"record-after-create"}},{"id":"notify_owner","type":"notify"},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"notify_owner"},{"source":"notify_owner","target":"end"}]},
  {"name":"task_due_reminder","label":"Task Due Reminder","type":"schedule","nodes":[{"id":"start","type":"start","config":{"schedule":"0 * * * *"}},{"id":"query_due","type":"get_record","config":{"objectName":"crm_task"}},{"id":"loop_tasks","type":"loop","config":{"body":{"nodes":[{"id":"guard_task","type":"try_catch","config":{"catch":{"nodes":[{"id":"handled_task","type":"assignment"}],"edges":[]},"try":{"nodes":[{"id":"notify_owner","type":"notify"},{"id":"mark_sent","type":"update_record","config":{"objectName":"crm_task"}}],"edges":[{"source":"notify_owner","target":"mark_sent"}]}}}],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"query_due"},{"source":"query_due","target":"loop_tasks"},{"source":"loop_tasks","target":"end"}]},
  {"name":"billing_handoff_closed_won","label":"Billing Hand-off: Closed Won","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_opportunity","triggerType":"record-after-update"}},{"id":"load_account","type":"get_record","config":{"objectName":"crm_account"}},{"id":"load_line_items","type":"get_record","config":{"objectName":"crm_opportunity_line_item"}},{"id":"send_closed_won_handoff","type":"http","config":{"body":{"nodes":[],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"load_account"},{"source":"load_account","target":"load_line_items"},{"source":"load_line_items","target":"send_closed_won_handoff"},{"source":"send_closed_won_handoff","target":"end"}]},
  {"name":"billing_handoff_contract_activated","label":"Billing Hand-off: Contract Activated","type":"record_change","nodes":[{"id":"start","type":"start","config":{"objectName":"crm_contract","triggerType":"record-after-update"}},{"id":"load_account","type":"get_record","config":{"objectName":"crm_account"}},{"id":"load_line_items","type":"get_record","config":{"objectName":"crm_opportunity_line_item"}},{"id":"send_contract_activated_handoff","type":"http","config":{"body":{"nodes":[],"edges":[]}}},{"id":"end","type":"end"}],"edges":[{"source":"start","target":"load_account"},{"source":"load_account","target":"load_line_items"},{"source":"load_account","target":"send_contract_activated_handoff"},{"source":"load_line_items","target":"send_contract_activated_handoff"},{"source":"send_contract_activated_handoff","target":"end"}]}
];

/** The same server's object index for the package: name → label. */
const HOTCRM_OBJECTS = new Map<string, string>([
  ['crm_account', 'Account'],
  ['crm_campaign', 'Campaign'],
  ['crm_campaign_member', 'Campaign Member'],
  ['crm_contact', 'Contact'],
  ['crm_contract', 'Contract'],
  ['crm_event', 'Event'],
  ['crm_event_attendee', 'Event Attendee'],
  ['crm_forecast', 'Forecast'],
  ['crm_lead', 'Lead'],
  ['crm_opportunity', 'Opportunity'],
  ['crm_opportunity_line_item', 'Opportunity Line Item'],
  ['crm_product', 'Product'],
  ['crm_quote', 'Quote'],
  ['crm_quote_line_item', 'Quote Line Item'],
  ['crm_task', 'Task'],
]);

/**
 * HotCRM `63db83e`'s app navigation (`src/sales/apps/crm.app.ts`), trimmed to
 * the keys the order reads: groups and their entries, object entries with
 * their `objectName`, a few of the other kinds. Sales lists Leads, Accounts,
 * Contacts, Opportunities, Quotes, Contracts, Products; My Work repeats three
 * of them and adds Tasks and Events; Marketing lists Campaigns; Insights
 * lists Forecasts. Campaign Member is in no entry.
 */
const HOTCRM_NAVIGATION = [
  { id: 'nav_home', type: 'dashboard', dashboardName: 'home' },
  { id: 'nav_sales_home', type: 'page', pageName: 'sales_home' },
  {
    id: 'group_sales',
    type: 'group',
    children: [
      { id: 'nav_lead', type: 'object', objectName: 'crm_lead' },
      { id: 'nav_account', type: 'object', objectName: 'crm_account' },
      { id: 'nav_account_workbench', type: 'page', pageName: 'account_workbench' },
      { id: 'nav_contact', type: 'object', objectName: 'crm_contact' },
      { id: 'nav_opportunity', type: 'object', objectName: 'crm_opportunity' },
      { id: 'nav_quote', type: 'object', objectName: 'crm_quote' },
      { id: 'nav_contract', type: 'object', objectName: 'crm_contract' },
      { id: 'nav_product', type: 'object', objectName: 'crm_product' },
      { id: 'nav_sales_dashboard', type: 'dashboard', dashboardName: 'sales_dashboard' },
    ],
  },
  {
    id: 'group_work',
    type: 'group',
    children: [
      { id: 'nav_my_tasks', type: 'object', objectName: 'crm_task', viewName: 'my_open_tasks' },
      { id: 'nav_my_deals', type: 'object', objectName: 'crm_opportunity', viewName: 'my_open_deals' },
      { id: 'nav_my_leads', type: 'object', objectName: 'crm_lead', viewName: 'my_leads' },
      { id: 'nav_my_calendar', type: 'object', objectName: 'crm_event', viewName: 'my_events' },
      { id: 'nav_approval_requests', type: 'component', componentRef: 'approvals:inbox' },
    ],
  },
  { id: 'group_marketing', type: 'group', children: [{ id: 'nav_campaign', type: 'object', objectName: 'crm_campaign' }] },
  {
    id: 'group_insights',
    type: 'group',
    children: [
      { id: 'nav_crm_dashboard', type: 'dashboard', dashboardName: 'crm_overview_dashboard' },
      { id: 'nav_forecast', type: 'object', objectName: 'crm_forecast' },
    ],
  },
];
const HOTCRM_ORDER = navigationObjectOrder(HOTCRM_NAVIGATION);

const definitions = new Map<string, unknown>(HOTCRM_FLOWS.map((f) => [f.name, f]));
const rows = HOTCRM_FLOWS.map((f) => ({ name: f.name, label: f.label }));
const NO_OBJECT = 'No object';

function group(flows = rows, objects = HOTCRM_OBJECTS, objectOrder: readonly string[] = HOTCRM_ORDER) {
  return groupFlowsByObject(flows, definitions, objects, { noObjectLabel: NO_OBJECT, objectOrder, locale: 'en' });
}

describe('the HotCRM flows group by object (objectui#12454)', () => {
  it('the fixture is the 26 flows the package serves', () => {
    expect(HOTCRM_FLOWS).toHaveLength(26);
    expect(new Set(HOTCRM_FLOWS.map((f) => f.name)).size).toBe(26);
  });

  it('ten groups, in the navigation order (objectui#12612), with their counts, and no "No object" group', () => {
    expect(group().map((g) => [g.label, g.items.length])).toEqual([
      ['Lead', 4],
      ['Account', 2],
      ['Contact', 1],
      ['Opportunity', 8],
      ['Quote', 1],
      ['Contract', 3],
      ['Task', 2],
      ['Campaign', 2],
      ['Forecast', 1],
      // In no navigation entry: after every listed object.
      ['Campaign Member', 2],
    ]);
  });

  it('each flow sits under the object it is about, in the order the rail was handed them', () => {
    const members = Object.fromEntries(group().map((g) => [g.objectName, g.items.map((f) => f.name)]));
    expect(members).toEqual({
      crm_account: ['account_approval', 'lead_conversion_account_revenue'],
      crm_campaign: ['campaign_enrollment', 'campaign_completion'],
      crm_campaign_member: ['campaign_lead_member_enroll', 'campaign_contact_member_enroll'],
      crm_contact: ['contact_welcome'],
      crm_contract: ['contract_renewal', 'contract_expiration', 'billing_handoff_contract_activated'],
      crm_forecast: ['forecast_snapshot'],
      crm_lead: ['lead_conversion', 'lead_conversion_approval', 'schedule_followup', 'lead_assignment'],
      crm_opportunity: [
        'opportunity_approval',
        'opportunity_approval_on_create',
        'opportunity_status_change_approval',
        'opportunity_qualification_approval',
        'quote_generation',
        'opportunity_stagnation',
        'opportunity_won_alert',
        'billing_handoff_closed_won',
      ],
      crm_quote: ['quote_expiration'],
      crm_task: ['task_urgent_alert', 'task_due_reminder'],
    });
  });

  it('a search filters within groups: only the matching flows, and only the groups that hold one', () => {
    const shown = rows.filter((f) => f.label.toLowerCase().includes('approval'));
    expect(group(shown).map((g) => [g.label, g.items.map((f) => f.name)])).toEqual([
      ['Lead', ['lead_conversion_approval']],
      ['Account', ['account_approval']],
      [
        'Opportunity',
        ['opportunity_approval', 'opportunity_approval_on_create', 'opportunity_status_change_approval', 'opportunity_qualification_approval'],
      ],
    ]);
  });

  it('the trigger glyphs: twelve record-triggered, seven scheduled, four screen, three autolaunched', () => {
    const count = Object.fromEntries(FLOW_TRIGGER_GLYPHS.map((g) => [g, 0]));
    for (const f of HOTCRM_FLOWS) count[flowTriggerGlyph(f)] += 1;
    expect(count).toEqual({ record: 12, scheduled: 7, screen: 4, autolaunched: 3 });
    expect(flowTriggerGlyph(definitions.get('campaign_enrollment'))).toBe('screen');
    expect(flowTriggerGlyph(definitions.get('contract_renewal'))).toBe('scheduled');
    expect(flowTriggerGlyph(definitions.get('account_approval'))).toBe('record');
    expect(flowTriggerGlyph(definitions.get('campaign_lead_member_enroll'))).toBe('autolaunched');
  });
});

describe('the order of the questions (objectui#12454)', () => {
  const start = (config?: Record<string, unknown>) => ({ id: 'start', type: 'start', ...(config ? { config } : {}) });
  const node = (id: string, type: string, objectName?: string) => ({ id, type, ...(objectName ? { config: { objectName } } : {}) });
  const chain = (...ids: string[]) => ids.slice(1).map((target, i) => ({ source: ids[i], target }));

  it("1 — the Start node's object wins over every data node", () => {
    const flow = {
      type: 'record_change',
      nodes: [start({ triggerType: 'record-after-update', objectName: 'crm_lead' }), node('g', 'get_record', 'crm_account')],
      edges: chain('start', 'g'),
    };
    expect(flowGroupObject(flow)).toBe('crm_lead');
  });

  it('1 — a time-relative sweep reads the object it sweeps', () => {
    const flow = {
      type: 'autolaunched',
      nodes: [start({ timeRelative: { object: 'crm_contract', dateField: 'end_date', offset: { value: -30, unit: 'days' } } }), node('u', 'update_record', 'crm_task')],
      edges: chain('start', 'u'),
    };
    expect(flowGroupObject(flow)).toBe('crm_contract');
  });

  it('2 — the first data node in graph order, not in authored order', () => {
    const flow = {
      type: 'schedule',
      nodes: [start({ schedule: { type: 'cron', expression: '0 7 * * *' } }), node('late', 'get_record', 'crm_task'), node('early', 'get_record', 'crm_quote')],
      edges: chain('start', 'early', 'late'),
    };
    expect(flowGroupObject(flow)).toBe('crm_quote');
  });

  it("2, then 3 — a sweep that first reads a platform object groups under what it writes (HotCRM's Forecast Snapshot)", () => {
    const inScope = (name: string) => HOTCRM_OBJECTS.has(name);
    expect(flowGroupObject(definitions.get('forecast_snapshot'), inScope)).toBe('crm_forecast');
    // The control: with every object admitted, the first data node answers.
    expect(flowGroupObject(definitions.get('forecast_snapshot'))).toBe('sys_user');
  });

  it('an empty object index admits every object', () => {
    const groups = group(rows.filter((f) => f.name === 'forecast_snapshot'), new Map());
    expect(groups.map((g) => [g.key, g.label])).toEqual([['sys_user', 'sys_user']]);
  });

  it('4 — a flow that touches no object, and a flow with no served definition, land in a trailing "No object" group', () => {
    const local = new Map<string, unknown>([
      ['ping', { type: 'autolaunched', nodes: [start(), node('n', 'notify'), node('end', 'end')], edges: chain('start', 'n', 'end') }],
      ['lead_flow', { type: 'record_change', nodes: [start({ triggerType: 'record-after-create', objectName: 'crm_lead' })], edges: [] }],
    ]);
    const groups = groupFlowsByObject(
      [{ name: 'ping' }, { name: 'unknown_draft' }, { name: 'lead_flow' }],
      local,
      HOTCRM_OBJECTS,
      { noObjectLabel: NO_OBJECT, objectOrder: HOTCRM_ORDER, locale: 'en' },
    );
    expect(groups.map((g) => [g.label, g.items.map((f) => f.name)])).toEqual([
      ['Lead', ['lead_flow']],
      [NO_OBJECT, ['ping', 'unknown_draft']],
    ]);
    expect(groups[1].objectName).toBeNull();
    expect(groups[1].key).toBe('');
  });

  it("among unlisted objects with as many flows, the order follows the locale it is handed, not the machine's (objectui#9909)", () => {
    // 安装 (an-zhuang) and 保单 (bao-dan): pinyin order under zh-CN, code-point
    // order under en-US — the two locales the pillar hands in. Neither is in a
    // navigation and each has one flow, so the collator breaks the tie.
    const local = new Map<string, unknown>([
      ['install_flow', { type: 'record_change', nodes: [start({ triggerType: 'record-after-create', objectName: 'install' })], edges: [] }],
      ['policy_flow', { type: 'record_change', nodes: [start({ triggerType: 'record-after-create', objectName: 'policy' })], edges: [] }],
    ]);
    const labels = new Map([
      ['install', '安装'],
      ['policy', '保单'],
    ]);
    const order = (locale: string) =>
      groupFlowsByObject([{ name: 'policy_flow' }, { name: 'install_flow' }], local, labels, { noObjectLabel: NO_OBJECT, objectOrder: [], locale }).map(
        (g) => g.label,
      );
    expect(order('zh-CN')).toEqual(['安装', '保单']);
    expect(order('en-US')).toEqual(['保单', '安装']);
  });

  it('a malformed definition answers no object instead of throwing', () => {
    expect(flowGroupObject(null)).toBeNull();
    expect(flowGroupObject({ nodes: 'nope', edges: 7 })).toBeNull();
    expect(flowTriggerGlyph(undefined)).toBe('autolaunched');
  });
});

describe("the groups follow the app's navigation order (objectui#12612)", () => {
  const onObject = (objectName: string) => ({
    type: 'record_change',
    nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-create', objectName } }],
    edges: [],
  });
  const local = new Map<string, unknown>([
    ['a1', onObject('obj_a')],
    ['b1', onObject('obj_b')],
    ['c1', onObject('obj_c')],
    ['d1', onObject('obj_d')],
    ['d2', onObject('obj_d')],
    ['ping', { type: 'autolaunched', nodes: [{ id: 'start', type: 'start' }], edges: [] }],
  ]);
  const EN = new Map([
    ['obj_a', 'Account'],
    ['obj_b', 'Lead'],
    ['obj_c', 'Contract'],
    ['obj_d', 'Quote'],
  ]);
  const ZH = new Map([
    ['obj_a', '客户'],
    ['obj_b', '线索'],
    ['obj_c', '合同'],
    ['obj_d', '报价单'],
  ]);
  const keys = (flows: Array<{ name: string }>, labels: Map<string, string>, objectOrder: readonly string[], locale: string) =>
    groupFlowsByObject(flows, local, labels, { noObjectLabel: NO_OBJECT, objectOrder, locale }).map((g) => g.key);

  it('a navigation listing B, A and flows on A, B, C: the groups read B, A, C, identically under en and zh labels', () => {
    const flows = [{ name: 'a1' }, { name: 'b1' }, { name: 'c1' }];
    const nav = navigationObjectOrder([
      { id: 'n_b', type: 'object', objectName: 'obj_b' },
      { id: 'n_a', type: 'object', objectName: 'obj_a' },
    ]);
    expect(keys(flows, EN, nav, 'en')).toEqual(['obj_b', 'obj_a', 'obj_c']);
    expect(keys(flows, ZH, nav, 'zh-CN')).toEqual(['obj_b', 'obj_a', 'obj_c']);
    // The control: without a navigation the labels' alphabet decides, and the
    // two locales disagree — the defect the card measured.
    expect(keys(flows, EN, [], 'en')).toEqual(['obj_a', 'obj_c', 'obj_b']);
    expect(keys(flows, ZH, [], 'zh-CN')).toEqual(['obj_c', 'obj_a', 'obj_b']);
  });

  it('an unlisted object with more flows comes before one with fewer, and "No object" stays last', () => {
    const flows = [{ name: 'ping' }, { name: 'c1' }, { name: 'd1' }, { name: 'a1' }, { name: 'd2' }];
    for (const [labels, locale] of [
      [EN, 'en'],
      [ZH, 'zh-CN'],
    ] as const) {
      expect(keys(flows, labels, ['obj_a'], locale)).toEqual(['obj_a', 'obj_d', 'obj_c', '']);
    }
  });

  it('the walk: depth first with every group opened, object entries only, each object at its first entry', () => {
    expect(
      navigationObjectOrder([
        { id: 'p', type: 'page', pageName: 'home', objectName: 'not_an_object_entry' },
        {
          id: 'g',
          type: 'group',
          children: [
            { id: 'x', type: 'object', objectName: 'obj_x' },
            { id: 'g2', type: 'group', children: [{ id: 'y', type: 'object', objectName: 'obj_y' }] },
          ],
        },
        { id: 'x2', type: 'object', objectName: 'obj_x', viewName: 'mine' },
        { id: 'z', type: 'object', objectName: 'obj_z' },
        { id: 'blank', type: 'object', objectName: '  ' },
      ]),
    ).toEqual(['obj_x', 'obj_y', 'obj_z']);
    expect(HOTCRM_ORDER).toEqual([
      'crm_lead',
      'crm_account',
      'crm_contact',
      'crm_opportunity',
      'crm_quote',
      'crm_contract',
      'crm_product',
      'crm_task',
      'crm_event',
      'crm_campaign',
      'crm_forecast',
    ]);
  });

  it('a navigation that is not a list answers no order', () => {
    expect(navigationObjectOrder(undefined)).toEqual([]);
    expect(navigationObjectOrder({ type: 'object', objectName: 'obj_a' })).toEqual([]);
    expect(navigationObjectOrder([null, 'obj_a', { type: 'group', children: 'nope' }])).toEqual([]);
  });
});
