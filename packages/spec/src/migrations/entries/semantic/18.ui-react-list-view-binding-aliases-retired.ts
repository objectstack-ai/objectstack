// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-react-list-view-binding-aliases-retired',
  surface: '`kind:\'react\'` page source — `<ListView objectName="…">` and `<ListView viewType="…">` '
    + '(the react-tier overlay aliases #11284 had published as deprecated)',
  replacement: '`<ListView data={{ provider: \'object\', object: \'…\' }} type="…">` — ListViewSchema\'s own '
    + '`data` data source and `type` view kind, the same two keys a metadata list view authors. '
    + '`objectName="x"` → `data={{ provider: \'object\', object: \'x\' }}`; `viewType="kanban"` → '
    + '`type="kanban"`. A `<ListView>` with no `data` at all is refused too: on a react page no '
    + 'host stamps the object, so the data source is the required binding there.',
  reason:
    'A react page\'s source is a JSX string, not a keyed document: `objectstack migrate meta` '
    + 'rewrites stored metadata by key and cannot rewrite props inside authored source, so the '
    + 'move is by hand. The contract deprecated both aliases in favour of the metadata-tier '
    + 'spelling (#11284) while objectui\'s ListView still read only `objectName`, so the canonical '
    + 'spelling validated green and rendered an empty list. The consumer fold has landed (objectui '
    + '`normalizeListViewSchema`, console pin a472b071: `data.provider === \'object\'` → '
    + '`objectName`, and the author\'s `type` read for the view kind), and the maintainer ruled the '
    + 'aliases retired with no deprecation window (#14791, 2026-09-07). Writing either alias is now '
    + 'a publish-time `react-prop-retired` error carrying this prescription — never a silent pass '
    + 'on a key the renderer happens to still read.',
  acceptanceCriteria:
    '`objectstack validate` reports no `react-prop-retired` and no `react-prop-missing-required` '
    + 'finding on any `kind:\'react\'` page; every `<ListView>` carries `data={{ provider: '
    + '\'object\', object }}` (or another ViewData provider) and, where a view kind was chosen, '
    + '`type`; in the console each rewritten list renders the same rows and visualization it '
    + 'rendered under the alias spelling. The platform\'s own sites are the reference: the '
    + 'showcase `crm-workbench`, `renewals-pipeline` and `task-desk` pages pass with zero findings.',
};
