// Assert the case screen renders real subgroup labels, not "undefined".
const { JSDOM } = require("jsdom");
const path = require("path");
const esbuild = require("esbuild");
const WEB = path.resolve(__dirname, "..", "..");
const ORIGIN = "http://127.0.0.1:3000";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: ORIGIN + "/", pretendToBeVisual: true });
for (const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,SVGElement:dom.window.SVGElement,getComputedStyle:dom.window.getComputedStyle})) global[k]=v;
global.requestAnimationFrame=(cb)=>setTimeout(()=>cb(Date.now()),0);
global.IS_REACT_ACT_ENVIRONMENT=true;
const nodeFetch=global.fetch;
global.fetch=(i,init)=>nodeFetch(typeof i==="string"&&!i.startsWith("http")?ORIGIN+i:i,init);
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
