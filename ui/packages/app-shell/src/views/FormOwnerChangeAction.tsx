/**
 * The Change Owner action beside the read-only owner of an edit form
 * (objectstack#35403) — the Console's answer to `@object-ui/plugin-form`'s
 * `FormOwnerLineContext`.
 *
 * The owner line is the form's; whether the action appears is the record
 * page's own gate (`useRecordChangeOwnerOffer`: the object offers Change
 * Owner, the switch's `visibleWhen` admits the record, and the explain
 * engine's `transfer` verdict for this record is a definite allow). A caller
 * who may edit but not transfer sees the owner, read-only, and no action.
 */

import { useState } from 'react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { FormOwnerActionTarget } from '@object-ui/plugin-form/core';
import { ChangeOwnerDialog } from './ChangeOwnerDialog.js';
import { useRecordChangeOwnerOffer, type ChangeOwnerObjectDef } from './changeOwner.js';

export function FormOwnerChangeAction({ objectName, recordId, record, objectSchema }: FormOwnerActionTarget) {
  const { t } = useObjectTranslation();
  const objectDef = (objectSchema?.name ? objectSchema : { ...objectSchema, name: objectName }) as ChangeOwnerObjectDef;
  const offer = useRecordChangeOwnerOffer(objectDef, recordId, record);
  const [open, setOpen] = useState(false);
  if (!offer.offered) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={offer.disabled}
        onClick={() => setOpen(true)}
        data-testid="form-owner-change"
      >
        {t('console.changeOwner.title')}
      </Button>
      <ChangeOwnerDialog
        open={open}
        onOpenChange={setOpen}
        objectDef={objectDef}
        records={[{ ...record, id: recordId }]}
      />
    </>
  );
}
