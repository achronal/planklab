#!/usr/bin/env node
/* Headless checks for PlankLab. Run: node tests/check.js
   Boots the exact script embedded in index.html inside a minimal DOM
   harness, then asserts core behavior including the offset optimizer. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m) { console.error("FAIL: no embedded script found"); process.exit(1); }

const HARNESS = String.raw`
const __handlers={};
function __el(id){
  return {id,tagName:"DIV",style:{},dataset:{},children:[],value:"",textContent:"",
    innerHTML:"",checked:true,disabled:false,files:[],_listeners:{},
    classList:{_s:new Set(),toggle(c,on){on?this._s.add(c):this._s.delete(c);},
      add(c){this._s.add(c);},remove(c){this._s.delete(c);},contains(c){return this._s.has(c);}},
    addEventListener(t,f){(this._listeners[t]=this._listeners[t]||[]).push(f);},
    querySelectorAll(){return[];},contains(){return false;},
    getBoundingClientRect(){return{width:1000,height:650,left:0,top:0};},
    setPointerCapture(){},click(){if(this.onclick)this.onclick({});},
    setAttribute(){},appendChild(){}};}
const __els={};
const document={getElementById(id){return __els[id]||(__els[id]=__el(id));},
  createElement(t){const e=__el(t);e.tagName=t.toUpperCase();return e;},
  activeElement:null};
const __rafQ=[];
const requestAnimationFrame=f=>{__rafQ.push(f);return __rafQ.length;};
function __flushRaf(){let n=0;while(__rafQ.length&&n<200){__rafQ.shift()();n++;}return n;}
const localStorage={_m:new Map(),
  getItem(k){return this._m.has(k)?this._m.get(k):null;},
  setItem(k,v){this._m.set(k,String(v));},removeItem(k){this._m.delete(k);}};
const window={addEventListener(t,f){__handlers[t]=f;}};
class Blob{constructor(parts){this.parts=parts;}}
const URL={createObjectURL(){return "blob:x";},revokeObjectURL(){}};
`;

const ASSERTIONS = String.raw`
;(async()=>{
let failures=0;
function assert(cond,msg){if(!cond){failures++;console.error("FAIL:",msg);}
  else console.log("ok -",msg);}
function totalOf(){let t=0;for(const p of R.pools)t+=R.stats[p.key].total;return t;}
__flushRaf();
assert(R&&!R.errors.length,"initial compute has no errors");
assert(Math.abs(R.coverage-R.area)<1,"coverage exact after init");
assert(R.pieces.every(p=>p.label),"every piece labelled");

// --- pure search: synthetic stepped bowl with a known minimum ---
assert(typeof searchOffsets==="function","searchOffsets exists");
assert(typeof OPTIMIZER==="object"&&OPTIMIZER.MAX_ATTEMPTS>=100&&OPTIMIZER.MAX_ATTEMPTS<=1000,
  "OPTIMIZER.MAX_ATTEMPTS is a few hundred (got "+(typeof OPTIMIZER==="object"&&OPTIMIZER.MAX_ATTEMPTS)+")");
const bowl=(x,y)=>({tot:10+Math.round(((x-137)**2+(y+88)**2)/4000),small:0});
const sr=await searchOffsets(bowl,{x:0,y:0},1000,OPTIMIZER,null,null);
assert(sr.attempts<=OPTIMIZER.MAX_ATTEMPTS,"synthetic search respects attempt cap ("+sr.attempts+")");
assert(sr.best.tot<=11,"synthetic search finds near-minimum (tot "+sr.best.tot+")");
assert(Math.abs(sr.best.x-137)<40&&Math.abs(sr.best.y+88)<40,
  "synthetic search lands near true optimum ("+sr.best.x.toFixed(1)+","+sr.best.y.toFixed(1)+")");

// --- end-to-end: optimizer strictly improves a deliberately bad start ---
let worst=null;
for(let ox=-900;ox<=900;ox+=150)for(let oy=-90;oy<=90;oy+=45){
  const s=plankTotalAt(ox,oy);
  if(s&&(!worst||s.tot>worst.tot))worst={ox,oy,tot:s.tot};}
S.fill.ox=worst.ox;S.fill.oy=worst.oy;update();__flushRaf();
const before=totalOf();
assert(before===worst.tot,"bad-start fixture is the scanned worst ("+before+")");
const startOx=S.fill.ox,startOy=S.fill.oy;
let done=false;
const p=optimizeOffsets().then(r=>{done=true;return r;});
while(!done){__flushRaf();await new Promise(r=>setImmediate(r));}
const res=await p;__flushRaf();
assert(res&&!res.cancelled,"optimizer completed");
assert(res.attempts<=OPTIMIZER.MAX_ATTEMPTS,"optimizer respects attempt cap ("+res.attempts+")");
assert(totalOf()<before,"planks after optimize ("+totalOf()+") < bad start ("+before+")");
assert(Math.abs(S.fill.ox-res.best.x)<1e-9&&Math.abs(S.fill.oy-res.best.y)<1e-9,
  "final offsets written back to state");
assert(document.getElementById("optOverlay").style.display==="none","overlay hidden after run");

// --- cancel restores the original offsets ---
S.fill.ox=startOx;S.fill.oy=startOy;update();__flushRaf();
let done2=false;
const p2=optimizeOffsets().then(r=>{done2=true;return r;});
optCancelRequested=true;
while(!done2){__flushRaf();await new Promise(r=>setImmediate(r));}
const res2=await p2;__flushRaf();
assert(res2.cancelled,"cancel reported");
assert(S.fill.ox===startOx&&S.fill.oy===startOy,"cancel restores original offsets");

// --- alignment shortcuts + herringbone starting rotation ---
const selEl=document.getElementById("patternSel");
function choosePattern(v){selEl.value=v;
  (selEl._listeners.change||[]).forEach(fn=>fn());__flushRaf();}
S.fill.rot=12;choosePattern("herringbone");
assert(S.fill.rot===-45,"herringbone starts at -45 (got "+S.fill.rot+")");
document.getElementById("alV").click();__flushRaf();
assert(S.fill.rot===45,"herringbone Vertical sets 45");
document.getElementById("alH").click();__flushRaf();
assert(S.fill.rot===-45,"herringbone Horizontal sets -45");
choosePattern("doubleHerringbone");
assert(S.fill.rot===-45,"double herringbone starts at -45");
choosePattern("chevron");
document.getElementById("alH").click();__flushRaf();
assert(S.fill.rot===90,"chevron Horizontal sets 90");
document.getElementById("alV").click();__flushRaf();
assert(S.fill.rot===0,"chevron Vertical sets 0");
choosePattern("linear");
document.getElementById("alV").click();__flushRaf();
assert(S.fill.rot===90,"linear Vertical sets 90");
document.getElementById("alH").click();__flushRaf();
assert(S.fill.rot===0,"linear Horizontal sets 0");

if(failures){console.error(failures+" check(s) failed");process.exitCode=1;}
else console.log("ALL CHECKS PASSED");
})().catch(e=>{console.error("FAIL (exception):",e&&e.stack||e);process.exitCode=1;});
`;

new vm.Script(HARNESS + m[1] + ASSERTIONS, { filename: "planklab-check.js" })
  .runInThisContext();
