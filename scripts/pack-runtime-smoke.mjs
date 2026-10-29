import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const pack=resolve(process.argv[2]??"output/Kissa-Menu-Windows-v1");
await mkdir("tmp/runtime-smoke",{recursive:true});
const root=await mkdtemp(resolve("tmp/runtime-smoke/pack-"));
for(const name of ["index.html","assets","fonts","images","seed.json"])await cp(join(pack,name),join(root,name),{recursive:true});
const {startMenuServer}=await import(pathToFileURL(join(pack,"server.mjs")).href);
const app=await startMenuServer({root,config:{feedUrl:"https://offline.invalid/api/public/menu-display"},port:0,pollMs:3600_000,fetchImpl:async()=>{throw new Error("Deliberately offline for runtime verification");}});
try{
  for(const path of ["/","/assets/menu.js","/assets/menu.css","/images/cafe-logo.svg","/fonts/NotoSansJP-Regular.otf"]){const r=await fetch(app.origin+path);assert.equal(r.status,200);assert((await r.arrayBuffer()).byteLength>0);}
  const body=await(await fetch(app.origin+"/api/menu-display")).json();
  assert.equal(body.ok,true);assert.equal(body.data.categories.flatMap(category=>category.menus).length,11);
  assert.equal((await(await fetch(app.origin+"/health")).json()).hasSnapshot,true);
  assert((await readFile(join(root,"cache/snapshot.json"),"utf8")).includes('"version":1'));
  console.log(`Pack runtime smoke test passed on ${process.version}: all assets and the saved menu load without network access.`);
}finally{await app.close();}
