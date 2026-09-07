import { runCensus, symbolPopulation } from './scripts/isystem-census.mjs';
const c = runCensus();
for (const [f, e] of [...symbolPopulation(c)].sort()) console.log(`${f}\t${e.sites}\t${[...e.symbols].join(',')}`);
