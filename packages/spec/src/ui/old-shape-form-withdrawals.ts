// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { projectViewForms } from './view.zod';
import { formExplicitlyWithdraws, type FormWithdrawal } from './anonymous-form-intake';

/**
 * [ADR-0159 D6 rule 10, D7; ruled question 4 = A] THE reader of a withdrawal
 * held in an OLD-SHAPE body: the forms a stored `view` body (a container's
 * `form`, a `formViews` entry, a `viewKind: 'form'` item) explicitly
 * withdraws, read through THE projection ({@link projectViewForms}), each under
 * the name it is served as.
 *
 * ⛔ ADR-0159: exempt from the ADR-0087 age-out; leaves only by a release
 * whose upgrade precheck refuses a deployment still holding an old-shape form
 * row. A permission boundary: an old-shape row that withdraws a public form
 * keeps it withdrawn after the form's source moves to `forms:`, and no
 * withdrawn public form may re-open. It is not registered as an ADR-0087
 * conversion-layer entry, so no retirement clock starts on it; the upgrade
 * precheck is card ⑤'s (major 19).
 *
 * A body the projection cannot turn into items withdraws nothing BY NAME
 * here: its links are closed by the two-type layer (D6 rule 7,
 * `formIntakeLayer`), which reads {@link projectViewForms}' `unreadable`.
 */
export function oldShapeFormWithdrawals(body: unknown): FormWithdrawal[] {
  const out: FormWithdrawal[] = [];
  for (const form of projectViewForms(body).forms) {
    const withdrawal = formExplicitlyWithdraws(form);
    if (withdrawal !== undefined) out.push({ name: form.name, slug: withdrawal });
  }
  return out;
}
