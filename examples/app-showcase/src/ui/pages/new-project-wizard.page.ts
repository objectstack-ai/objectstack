// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * New Project Wizard — a multi-step (wizard) form surface. The showcase
 * defines wizard/tabbed/split form view *types* but had no page that actually
 * walks a user through a stepped create flow. This renders `object-form` with
 * `formType: 'wizard'` directly: Basics → Health → Budget, with a step
 * indicator, over showcase_project.
 *
 * On `status`, and why it is not a step here, see the comment on `sections`.
 */
export const NewProjectWizardPage = definePage({
  name: 'showcase_new_project_wizard',
  label: 'New Project (Wizard)',
  type: 'app',
  kind: 'full',
  template: 'default',
  isDefault: false,
  regions: [
    {
      name: 'main',
      width: 'large',
      components: [
        {
          type: 'object-form',
          properties: {
            objectName: 'showcase_project',
            mode: 'create',
            formType: 'wizard',
            showStepIndicator: true,
            title: 'Create a Project',
            description: 'A three-step wizard — basics, health, then budget & schedule.',
            // `status` is deliberately ABSENT from this create wizard.
            //
            // `showcase_project`'s `project_status_flow` state machine declares
            // `initialStates: ['planned']`, so `planned` is the only status a
            // project may be CREATED in — the other four are reachable only by
            // transition, after the record exists. The step offered all five
            // (a `select` renders its whole option list; nothing in page
            // metadata narrows it to the machine's entry points), so four of
            // them were dead ends: the wizard accepted the pick, walked the
            // author through a third step, and only then answered
            // `400 VALIDATION_FAILED` from the create. A wizard demonstrating a
            // state machine must not demo a dead end.
            //
            // With the field omitted, the option marked `default: true`
            // (`planned`) supplies the value server-side — which is the same
            // entry point the machine declares, so the two cannot drift. A
            // one-option select would be the alternative and is strictly worse
            // UI: it asks a question with exactly one answer.
            //
            // The GENERAL fix — a create form deriving its allowed values from
            // the object's `stateMachine` — is a console (objectui) feature and
            // is deliberately not built here; this app must be correct without
            // it. `test/new-project-wizard-initial-status.test.ts` pins the
            // invariant against the REAL metadata, so widening `initialStates`
            // later re-opens the question instead of silently rotting.
            sections: [
              { label: 'Basics', description: 'Name the project and bind its account.', fields: ['name', 'account', 'owner'] },
              { label: 'Health', description: 'New projects start as Planned — how healthy is it today?', fields: ['health'] },
              { label: 'Budget & Schedule', description: 'Money and dates.', fields: ['budget', 'spent', 'start_date', 'end_date'] },
            ],
            // Without this, a successful submit left the filled step-3 form in
            // place with only a toast — re-clicking "Create" duplicated the
            // record. `thank-you` swaps the form for a confirmation panel so
            // there's nothing left to resubmit.
            submitBehavior: { kind: 'thank-you', title: 'Project created', message: 'Your new project is ready — find it in Projects, or reopen this wizard to start another.' },
          },
        },
      ],
    },
  ],
});
