// Assert the case screen renders real subgroup labels, not "undefined".
const path = require("path");
const esbuild = require("esbuild");
const { WEB, ORIGIN, setupDom, setupFetch } = require("./harness.cjs");
setupDom();
const nodeFetch = setupFetch();
for (const l of ["error","warn"]) { const o=console[l].bind(console); console[l]=(...a)=>{const t=a.map(String).join(" ");if(!/act\(|fire events|assert on the output|ensures that you|wrap-tests-with-act/.test(t))o(...a);}; }
(async()=>{
  const cases=(await (await nodeFetch(ORIGIN+"/api/cases?limit=200")).json()).cases;
  let id=null, rows=null;
  for (const c of cases){ const d=await (await nodeFetch(ORIGIN+"/api/case/"+encodeURIComponent(c.patient_id))).json();
    if((d.subgroup_context||[]).length){id=c.patient_id; rows=d.subgroup_context; break;} }
  if(!id){console.log("no patient with subgroup_context");process.exit(2);}
  globalThis.__CASE_ID__=id;
  await esbuild.build({entryPoints:[path.join(WEB,"scripts/render-check/entry.tsx")],bundle:true,outfile:path.join(WEB,"scripts/render-check/bundle.cjs"),platform:"node",format:"cjs",target:"node20",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},alias:{"@":WEB,"next/navigation":path.join(WEB,"scripts/render-check/nav-shim.js"),"next/link":path.join(WEB,"scripts/render-check/link-shim.js")},external:["react","react-dom","react-dom/client"],logLevel:"error"});
  const text=await require(path.join(WEB,"scripts/render-check/bundle.cjs")).mountCaseDetail(id);
  const norm=s=>s.replace(/[_/]+/g," ").replace(/\s+/g," ").trim().toLowerCase();
  const T=norm(text);
  let fail=0;
  console.log(`patient ${id} has ${rows.length} subgroup rows\n`);
  for(const r of rows){
    const ok=T.includes(norm(r.subgroup));
    if(!ok)fail++;
    console.log(`  ${ok?"PASS":"FAIL"}  axis=${r.axis} subgroup="${r.subgroup}" n=${r.n}`);
  }
  const noUndef=!/\bundefined\b/.test(text);
  if(!noUndef)fail++;
  console.log(`  ${noUndef?"PASS":"FAIL"}  no literal "undefined" in output`);
  console.log(fail===0?`\nall ${rows.length+1} subgroup assertions pass`:`\n${fail} failed`);
  process.exit(fail?1:0);
})();
