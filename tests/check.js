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
assert(Hist.canUndo(),"optimizer run is recorded in history");
assert(document.getElementById("btnUndo").disabled===false,
  "undo button is re-enabled after the optimizer finishes");
undoAction();__flushRaf();
assert(S.fill.ox===startOx&&S.fill.oy===startOy,
  "undo after optimize restores the pre-optimizer offsets");
redoAction();__flushRaf();
assert(Math.abs(S.fill.ox-res.best.x)<1e-9&&Math.abs(S.fill.oy-res.best.y)<1e-9,
  "redo reapplies the optimized offsets");
assert(document.getElementById("optOverlay").style.display==="none","overlay hidden after run");

// --- cancel restores the original offsets ---
S.fill.ox=startOx;S.fill.oy=startOy;update();__flushRaf();
let done2=false;
const p2=optimizeOffsets().then(r=>{done2=true;return r;});
optCancelRequested=true;
while(!done2){__flushRaf();await new Promise(r=>setImmediate(r));}
const res2=await p2;__flushRaf();
assert(res2.cancelled,"cancel reported");
assert(document.getElementById("btnUndo").disabled===false,
  "undo button is re-enabled after cancelling the optimizer too");
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

// --- selection highlight layer + cut guide ---
choosePattern("linear");S.fill.rot=30;update();__flushRaf();
const cutPiece=R.pieces.find(p=>p.isCut);
assert(cutPiece&&Array.isArray(cutPiece.stockPoly),
  "cut piece retains packed position inside its source plank");
highlightSrc=cutPiece.src;renderSVG();renderCutGuide();
const svgHtml=document.getElementById("svg").innerHTML;
assert(svgHtml.includes("#2ee66b"),"selection highlight is bright green");
assert(svgHtml.indexOf("#2ee66b")>svgHtml.indexOf("#e8c98f"),
  "highlight is drawn above pieces and room outline (top layer)");
const cpos=n=>svgHtml.indexOf('data-layer="'+n+'"');
assert(cpos("pieces")>=0&&cpos("pieces")<cpos("area")&&
  cpos("area")<cpos("cutMarks")&&cpos("cutMarks")<cpos("highlight")&&
  cpos("highlight")<cpos("labels")&&cpos("labels")<cpos("handles"),
  "canvas layers render in declared z-order");
// cut marks must not hide under the room outline they coincide with
const marksOn=(svgHtml.match(/#ff7a45/g)||[]).length;
assert(marksOn>0,"cut edge marks are generated ("+marksOn+")");
assert(svgHtml.indexOf("#ff7a45")>svgHtml.indexOf("#e8c98f"),
  "cut marks paint above the room outline");
document.getElementById("showCutEdges").checked=false;renderSVG();
assert(!document.getElementById("svg").innerHTML.includes("#ff7a45"),
  "toggling Mark cut edges off removes the marks");
document.getElementById("showCutEdges").checked=true;renderSVG();
assert(document.getElementById("svg").innerHTML.includes("#ff7a45"),
  "toggling Mark cut edges back on restores the marks");
const guide=document.getElementById("cutGuide").innerHTML;
assert(guide.includes("<svg")&&guide.includes("datum"),
  "cut guide shows the source plank diagram with datum");
assert(/cut 1:/.test(guide)&&(guide.includes("from square")||guide.includes("square cut")),
  "cut guide lists a cut with its miter angle");
assert(guide.includes("along "),"cut guide gives measurements from the datum end");
const svgW=+((guide.match(/<svg width='(\d+)'/)||[])[1]||0);
assert(svgW>=400,"cut diagram is large (width "+svgW+")");
assert(svgW<=516,"diagram fits the card content box, no horizontal overflow (width "+svgW+")");
assert(document.getElementById("cutGuideFloat").style.display==="flex",
  "cut guide floats over the canvas on selection");
const gpos=n=>guide.indexOf('data-layer="'+n+'"');
assert(gpos("stock")>=0&&gpos("stock")<gpos("pieces")&&
  gpos("pieces")<gpos("cuts")&&gpos("cuts")<gpos("pieceLabels")&&
  gpos("pieceLabels")<gpos("dims"),
  "cut guide layers render in declared z-order");
assert(gpos("dims")>guide.lastIndexOf("fill-opacity"),
  "dimension labels paint above every piece fill");
const shared=R.sources.find(s=>s.kind==="cut"&&s.ids.length>1);
assert(!!shared,"fixture has a shared cut source");
if(shared){highlightSrc=R.sources.indexOf(shared);renderCutGuide();
  const g2=document.getElementById("cutGuide").innerHTML;
  assert(shared.ids.every(id=>g2.includes(R.pieces.find(p=>p.id===id).label)),
    "paired pieces appear together in one plank diagram");}
highlightSrc=-1;renderCutGuide();
assert(document.getElementById("cutGuideFloat").style.display==="none",
  "cut guide hidden when nothing is selected");
choosePattern("herringbone");
const fe=document.getElementById("fillEditor").innerHTML;
assert(fe.includes("↔ (-45°)")&&!fe.includes("Horizontal (-45"),
  "align buttons show arrow and angle only");
// --- cut guide docking ---
assert(nearestCorner(10,10,100,100)==="tl"&&nearestCorner(90,10,100,100)==="tr"&&
  nearestCorner(10,90,100,100)==="bl"&&nearestCorner(90,90,100,100)==="br",
  "nearestCorner picks the right quadrant");
applyDock("bl");
const wf=document.getElementById("cutGuideFloat");
assert(wf.style.bottom==="10px"&&wf.style.left==="10px"&&
  wf.style.top===""&&wf.style.right==="","applyDock anchors bottom-left only");
assert((localStorage.getItem("planklab.ui.v1")||"").includes("bl"),
  "dock corner persisted as UI preference");
applyDock("tr");
assert(wf.style.top==="10px"&&wf.style.right==="10px"&&
  wf.style.bottom===""&&wf.style.left==="","applyDock anchors top-right only");

// --- paired L/R purchasing (default on, relaxable) ---
choosePattern("herringbone");
S.fill.rot=0;S.fill.ox=0;S.fill.oy=0;S.fill.pairedLR=true;update();__flushRaf();
const needL=R.stats.hbL.total,needR=R.stats.hbR.total;
assert(needL!==needR,"fixture has unequal L/R needs ("+needL+"/"+needR+")");
assert(buyTotalFor(R.pools,R.stats)===2*Math.max(needL,needR),
  "paired buy total = 2 x max(L,R)");
const scP=plankTotalAt(0,0);
assert(scP.tot===2*Math.max(needL,needR)&&scP.need===needL+needR,
  "optimizer objective is the paired total (need breaks ties)");
update();__flushRaf();
let resHtml=document.getElementById("results").innerHTML;
assert(resHtml.includes("sold in pairs"),"results explain the pairing");
const bigP=+((resHtml.match(/class='big'>(\d+)/)||[])[1]||0);
assert(bigP===2*Math.max(needL,needR),"headline buy number is paired ("+bigP+")");
const fp=document.getElementById("fPaired");
assert(!!fp,"pairs toggle exists for herringbone");
fp.checked=false;(fp._listeners.change||[]).forEach(fn=>fn());__flushRaf();
assert(S.fill.pairedLR===false,"toggle relaxes the pairing constraint");
assert(buyTotalFor(R.pools,R.stats)===needL+needR,"relaxed buy = exact needs");
resHtml=document.getElementById("results").innerHTML;
const bigR=+((resHtml.match(/class='big'>(\d+)/)||[])[1]||0);
assert(bigR===needL+needR,"headline buy number relaxed ("+bigR+")");
S.fill.pairedLR=true;update();__flushRaf();

// --- room-scale units: m²/ft² for area, m/ft for perimeter ---
S.units="in";
assert(fmtArea(92903.04)==="1.0 ft²","imperial area in ft² ("+fmtArea(92903.04)+")");
assert(fmtArea(12.6e6)==="135.6 ft²","room area in ft² ("+fmtArea(12.6e6)+")");
assert(fmtRoomLen(3048)==="10.00 ft","imperial perimeter in ft ("+fmtRoomLen(3048)+")");
renderRoomInfo();
assert(document.getElementById("roomInfo").innerHTML.includes("ft²")&&
  /Perimeter [\d.]+ ft/.test(document.getElementById("roomInfo").innerHTML),
  "room card shows ft² and ft in imperial");
S.units="mm";
assert(fmtArea(12.6e6)==="12.60 m²","metric area in m² ("+fmtArea(12.6e6)+")");
assert(fmtRoomLen(14400)==="14.40 m","metric perimeter in m ("+fmtRoomLen(14400)+")");
renderRoomInfo();
assert(/Perimeter [\d.]+ m /.test(document.getElementById("roomInfo").innerHTML+" "),
  "room card shows perimeter in metres in metric");

// --- edge vertex badges + add-vertex (button and double-click) ---
choosePattern("linear");
S.outer=[[0,0],[4200,0],[4200,3000],[0,3000]];S.holes=[];S.locked=false;
setMode("edit");fitView();update();__flushRaf();
sel={type:"edge",ring:-1,idx:0};renderSVG();
const svg2=document.getElementById("svg").innerHTML;
assert(svg2.includes(">V1<")&&svg2.includes(">V2<"),
  "selected edge badges its vertices V1/V2 on the canvas");
renderInspector(true);
assert(document.getElementById("inspector").innerHTML.includes("edge V1 → V2"),
  "inspector names the edge by its V labels");
const nBefore=S.outer.length;
document.getElementById("addMidVt").click();__flushRaf();
assert(S.outer.length===nBefore+1&&Math.abs(S.outer[1][0]-2100)<1e-6&&S.outer[1][1]===0,
  "Add vertex at midpoint inserts at the edge midpoint");
sel=null;lastPtrClick=null;
const scr=w2s([1000,0]);
const firePd=()=>(svg._listeners.pointerdown||[]).forEach(fn=>
  fn({clientX:scr[0],clientY:scr[1],button:0,pointerId:1,preventDefault(){}}));
const n2=S.outer.length;
firePd();__flushRaf();
assert(S.outer.length===n2,"single click on edge does not insert a vertex");
firePd();__flushRaf();
assert(S.outer.length===n2+1,"double-click on edge inserts a vertex");
assert(S.outer.some(p=>Math.abs(p[0]-1000)<2&&p[1]===0),
  "double-clicked vertex lies exactly on the edge");

// --- destructive actions need a deliberate hold-to-confirm ---
S.outer=[[0,0],[4200,0],[4200,3000],[0,3000]];S.holes=[];update();__flushRaf();
document.getElementById("btnClear").click();
assert(document.getElementById("confirmOverlay").style.display==="flex",
  "Clear room asks for confirmation first");
assert(S.outer.length===4,"room intact before confirming");
const holdEl=document.getElementById("confirmHold");
const fireHold=t=>(holdEl._listeners[t]||[]).forEach(fn=>
  fn({pointerId:1,preventDefault(){}}));
fireHold("pointerdown");fireHold("pointerup");__flushRaf();
assert(S.outer.length===4,"a quick click on the hold button does not confirm");
document.getElementById("confirmCancel").click();
assert(S.outer.length===4&&
  document.getElementById("confirmOverlay").style.display==="none",
  "cancel closes the dialog and keeps the room");
document.getElementById("btnSample").click();
assert(document.getElementById("confirmTitle").textContent.includes("sample"),
  "Sample room also asks first");
document.getElementById("confirmCancel").click();
CONFIRM_HOLD_MS=40;
document.getElementById("btnClear").click();
fireHold("pointerdown");
for(let i=0;i<40&&S.outer.length;i++){__flushRaf();
  await new Promise(r=>setTimeout(r,15));}
assert(S.outer.length===0,"holding the button through the fill clears the room");
assert(document.getElementById("confirmOverlay").style.display==="none",
  "dialog closes after a confirmed hold");
CONFIRM_HOLD_MS=900;
S.outer=[[0,0],[4200,0],[4200,3000],[0,3000]];update();__flushRaf();

// --- undo/redo history (persisted) ---
S=defaultState();
Hist.entries=[{label:"Open project",json:Hist.snapshot(S)}];
Hist.index=0;Hist.persist();syncHistoryButtons();syncAll();__flushRaf();
assert(!Hist.canUndo()&&!Hist.canRedo(),"fresh history has nothing to undo or redo");
S.fill.rot=33;save("Change rotation");update();__flushRaf();
assert(Hist.canUndo()&&Hist.undoLabel()==="Change rotation",
  "action recorded with its label");
S.outer[1][0]=4300;save("Move vertex");update();__flushRaf();
undoAction();__flushRaf();
assert(S.outer[1][0]===4200&&S.fill.rot===33,"undo reverts only the last action");
undoAction();__flushRaf();
assert(S.fill.rot===0,"second undo reverts the rotation");
redoAction();__flushRaf();
assert(S.fill.rot===33,"redo reapplies the rotation");
S.fill.rot=10;save("Change rotation");update();__flushRaf();
assert(!Hist.canRedo(),"a new action after undo drops the redo tail");
__handlers.keydown({key:"z",ctrlKey:true,shiftKey:false,altKey:false,
  metaKey:false,code:"KeyZ",target:{tagName:"BODY"},preventDefault(){}});
__flushRaf();
assert(S.fill.rot===33,"Ctrl+Z undoes");
const nHist=Hist.entries.length;save("Edit");
assert(Hist.entries.length===nHist,"no-op save adds no history entry");
S.units="in";S.locked=true;
undoAction();__flushRaf();
assert(S.units==="in"&&S.locked===true,
  "undo keeps current units and lock (view state excluded)");
S.units="mm";S.locked=false;syncHeader();
const savedIdx=Hist.index,savedLen=Hist.entries.length;
Hist.entries=[];Hist.index=-1;Hist.init();
assert(Hist.entries.length===savedLen&&Hist.index===savedIdx,
  "history reloads from browser storage after a fresh start");
assert(HISTORY_LIMITS.MAX_ENTRIES>=500&&HISTORY_LIMITS.MAX_BYTES>=1000000,
  "history limits are generous ("+HISTORY_LIMITS.MAX_ENTRIES+" entries / "+
  HISTORY_LIMITS.MAX_BYTES+" bytes)");
// slider drags coalesce: many input ticks, one entry on release
const idxBefore=Hist.index,lenBefore=Hist.entries.length;
const sld=document.getElementById("fRotS");
for(const v of[5,9,14,20]){sld.value=String(v);
  (sld._listeners.input||[]).forEach(fn=>fn());}
__flushRaf();
assert(Hist.index===idxBefore&&Hist.entries.length===lenBefore&&S.fill.rot===20,
  "slider drag previews record no history entries");
(sld._listeners.change||[]).forEach(fn=>fn());__flushRaf();
assert(Hist.index===idxBefore+1,"slider release records exactly one history entry");

if(failures){console.error(failures+" check(s) failed");process.exitCode=1;}
else console.log("ALL CHECKS PASSED");
})().catch(e=>{console.error("FAIL (exception):",e&&e.stack||e);process.exitCode=1;});
`;

new vm.Script(HARNESS + m[1] + ASSERTIONS, { filename: "planklab-check.js" })
  .runInThisContext();

// Static markup checks (outside the VM).
for (const [ok, msg] of [
  [html.includes('class="infoIcon"'), "info icon present next to autosave status"],
  [/title="[^"]*Export JSON[^"]*persistent/.test(html),
   "info tooltip warns storage is temporary and points at Export JSON"],
  [!/\.greeting\{[^}]*position\s*:\s*sticky/.test(html),
   "greeting is static content, not sticky/floating"],
  [html.includes("#svg,#svg text,#stageBar,#toolHint,#banner{user-select:none"),
   "canvas workspace disables text selection during drags"],
  [!/aside\{[^}]*user-select/.test(html) && !/body\{[^}]*user-select/.test(html),
   "side panels keep selectable text (no global user-select ban)"],
]) {
  if (!ok) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok -", msg);
}
