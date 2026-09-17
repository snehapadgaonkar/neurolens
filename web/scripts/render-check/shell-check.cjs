// Mount the real Shell to confirm the persistent research banner + nav render.
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { WEB, ORIGIN, setupDom, setupFetch } = require("./harness.cjs");
setupDom();
const nodeFetch = setupFetch();
const shim=path.join(WEB,"scripts/render-check/nav-shim.js");
const linkShim=path.join(WEB,"scripts/render-check/link-shim.js");
const entrySrc=path.join(WEB,"scripts/render-check/_shell-entry.tsx");
fs.writeFileSync(entrySrc,
`import {createRoot} from "react-dom/client";
import {act} from "react";
import {createElement} from "react";
import {StoreProvider} from "@/lib/store";
import {Shell} from "@/components/shell";
export async function mount(){
  const host=document.createElement("div");
  document.body.appendChild(host);
  const root=createRoot(host);
  await act(async()=>{root.render(createElement(StoreProvider,null,createElement(Shell,null,createElement("main",null,"content"))));});
  // Wait for the tree to STOP changing rather than to exceed a length. The
  // previous length threshold broke out of this loop before the report fetch
  // settled, and RunSwitcher renders nothing while it has one run and no report
  // -- so the switcher label assertion failed intermittently depending on how
  // quickly the API answered, not on whether the component was correct.
  let previous = "";
  let stable = 0;
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const now = host.textContent || "";
    if (now === previous && now.length > 0) {
      stable += 1;
      if (stable >= 3) break;
    } else stable = 0;
    previous = now;
  }
  const t=host.textContent||""; root.unmount(); return t;
}`);
(async()=>{
  await esbuild.build({entryPoints:[entrySrc],bundle:true,outfile:path.join(WEB,"scripts/render-check/_shell.cjs"),platform:"node",format:"cjs",target:"node20",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},alias:{"@":WEB,"next/navigation":shim,"next/link":linkShim},external:["react","react-dom","react-dom/client"],logLevel:"error"});
  const text=await require(path.join(WEB,"scripts/render-check/_shell.cjs")).mount();
  const health=await (await nodeFetch(ORIGIN+"/api/health")).json();
  const checks=[
    ["research-use banner", "research prototype" in {} || text.includes("research prototype")],
    // The switcher shows runIdLabel(...), a human date + dataset, not the raw id.
    ["run switcher label", (()=>{const m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(.*)$/.exec(health.active_run);if(!m)return text.includes(health.active_run);const date=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]));return text.includes(date.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"})+" \u00b7 "+m[7]);})()],
    ["Build nav", text.includes("Build")],
    ["Evaluate nav", text.includes("Evaluate")],
    ["Inspect nav", text.includes("Inspect")],
    ["Release nav", text.includes("Release")],
    ["skip link", text.toLowerCase().includes("skip")],
  ];
  let fail=0;
  for(const [n,ok] of checks){ if(!ok)fail++; console.log(`  ${ok?"PASS":"FAIL"}  ${n}`); }
  console.log(fail===0?`\nshell chrome renders (chars=${text.length})`:`\n${fail} shell check(s) failed`);
  process.exit(fail?1:0);
})();
