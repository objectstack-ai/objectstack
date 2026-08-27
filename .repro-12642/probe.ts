// Serving-seam reproduction probe.
//
// Resolves every module by RELATIVE SOURCE PATH on purpose: each one imports
// only `type`-level symbols from @objectstack/spec, so nothing here reads a
// dist/ and the probe measures exactly the committed text. Declared, not
// implied — no ablation-of-a-built-artifact is involved.
import {
  findStaleFills,
  collectGeneratedLeaves,
  hashSource,
} from '../packages/platform-objects/src/apps/translations/source-hash.js';

// --- the card's measured case: plugin-sharing, es-ES, one recorded leaf -----
import { SharingTranslations } from '../packages/plugins/plugin-sharing/src/translations/index.js';
import { enObjects } from '../packages/plugins/plugin-sharing/src/translations/en.objects.generated.js';
import { esESObjects } from '../packages/plugins/plugin-sharing/src/translations/es-ES.objects.generated.js';
import { esESGeneratedSourceHashes } from '../packages/plugins/plugin-sharing/src/translations/es-ES.source-hashes.generated.js';

// --- positive control: platform-objects, where the seam was already wired ---
import { SetupAppTranslations } from '../packages/platform-objects/src/apps/translations/setup.translation.js';
import { esES as poEsESRaw } from '../packages/platform-objects/src/apps/translations/es-ES.js';

const PATH = 'objects.sys_share_link.fields.token.label';
const CONTROL = 'objects.sys_account._actions.link_social.params.provider.options.apple';

const read = (d: any, p: string) => p.split('.').reduce((n: any, k) => (n == null ? undefined : n[k]), d);

// The bundle shape `origin/main` served for this set: the raw generated modules,
// assembled with no consultation of the companion sitting beside them.
const UNWIRED = { objects: esESObjects } as any;
const enSource = { objects: enObjects } as any;

console.log('================ plugin-sharing :: ' + PATH + ' ================');
console.log('  current source (en)      =', JSON.stringify(collectGeneratedLeaves(enSource).get(PATH)));
console.log('  recorded digest (es-ES)  =', esESGeneratedSourceHashes[PATH]);
console.log('  hash(current source)     =', hashSource(String(collectGeneratedLeaves(enSource).get(PATH))));
const stale = findStaleFills(UNWIRED, enSource, esESGeneratedSourceHashes as any);
console.log('  findStaleFills(es-ES)    =', stale.length, 'stale', stale.map((s) => s.path).join(','));
console.log('  BEFORE (origin/main shape, companion never read) serves =', JSON.stringify(read(UNWIRED, PATH)));
console.log('  AFTER  (this branch, companion read at serving time)    =', JSON.stringify(read((SharingTranslations as any)['es-ES'], PATH)));

console.log('\n================ POSITIVE CONTROL: platform-objects (seam already wired on main) ================');
console.log('  raw es-ES module serves        =', JSON.stringify(read(poEsESRaw, CONTROL)));
console.log('  SetupAppTranslations es-ES     =', JSON.stringify(read((SetupAppTranslations as any)['es-ES'], CONTROL)));
console.log('  probe can observe substitution =', read(poEsESRaw, CONTROL) !== read((SetupAppTranslations as any)['es-ES'], CONTROL) ? 'YES' : 'no');
