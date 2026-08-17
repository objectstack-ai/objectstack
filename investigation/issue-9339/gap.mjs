// Margin available to the ONE usable poll: how far view/'s mtime advances
// between the seed write (= chokidar's arming baseline) and the anchor write.
// Under a coarse-clock kernel (jiffy-granular mtime, e.g. HZ=250 -> 4ms) a
// margin below one tick can round to a TIE, which chokidar's `>` filter drops.
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { FileSystemRepository } from '/home/user/objectstack-9339/packages/metadata-fs/dist/index.js';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const LOAD = process.argv.includes('--load');
let timers=[];
if(LOAD){ timers.push(setInterval(()=>{const e=Date.now()+80;while(Date.now()<e);},30));
  for(let i=0;i<6;i++) timers.push(setInterval(()=>{for(let j=0;j<128;j++) fs.readdir(os.tmpdir()).catch(()=>{});},10)); }
const gaps=[];
for(let i=0;i<40;i++){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gap-')); const v=path.join(root,'view');
  await fs.mkdir(v); await fs.writeFile(path.join(v,'seed.json'),'{"label":"seed"}');
  const repo=new FileSystemRepository({root,org:'system'}); await repo.start();
  const w=repo.watcher; await Promise.race([new Promise(r=>w.once('ready',r)),sleep(20000)]);
  const before=(await fs.stat(v)).mtimeMs;
  await fs.writeFile(path.join(v,'anchor.json'),'{"label":"anchor"}');
  const after=(await fs.stat(v)).mtimeMs;
  gaps.push(after-before);
  await repo.close().catch(()=>{}); await fs.rm(root,{recursive:true,force:true});
}
timers.forEach(clearInterval);
gaps.sort((a,b)=>a-b);
const q=(p)=>gaps[Math.floor(p*(gaps.length-1))];
console.log(`load=${LOAD} n=${gaps.length} min=${gaps[0].toFixed(2)}ms p10=${q(.1).toFixed(2)} p50=${q(.5).toFixed(2)} p90=${q(.9).toFixed(2)} max=${gaps.at(-1).toFixed(2)}`);
console.log('  would TIE under a 4ms-granular (HZ=250) clock:', gaps.filter(g=>g<4).length, '/', gaps.length);
console.log('  would TIE under a 10ms-granular (HZ=100) clock:', gaps.filter(g=>g<10).length, '/', gaps.length);
