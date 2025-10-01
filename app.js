/* =========================================================
   Source Code Playing Cards — overlay camera + OCR + render
   (editor visible, starts empty; prevent mobile keyboard during scan)
   ========================================================= */

/* --------- OCR endpoint (declare once) --------- */
const OCR_URL = (window && window.VISION_FN_URL)
  ? window.VISION_FN_URL
  : "https://us-central1-api-project-684372428277.cloudfunctions.net/ocrHttp";

/* --------- DOM refs --------- */
const taEl        = document.getElementById("cardInput");
const hlEl        = document.getElementById("hl");
const btnRender   = document.getElementById("renderBtn");
const btnExamples = document.getElementById("examplesBtn");
const btnScan     = document.getElementById("scanBtn");
const CANVAS      = document.getElementById("cardCanvas");

/* =========================================================
   Highlighter (textarea mirror) — caret-safe
   ========================================================= */
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function tok(s,c){return `<span class="${c}">${s}</span>`;}
function highlight(text){
  if(!hlEl) return;
  let out="",i=0,n=text.length;
  const isDigit=(ch)=>/[0-9]/.test(ch);
  const isPunc =(ch)=>"{}[],:".includes(ch);
  while(i<n){
    const ch=text[i];
    if(ch === '"'){
      let j=i+1,str='"',escp=false;
      while(j<n){ const c=text[j++]; str+=c; if(escp){escp=false;continue;} if(c==='\\'){escp=true;continue;} if(c=== '"') break; }
      let k=j; while(k<n && /\s/.test(text[k])) k++;
      out+=tok(esc(str), text[k] === ":" ? "k" : "s"); i=j; continue;
    }
    if(isDigit(ch)||(ch==='-'&&isDigit(text[i+1]||""))){
      let j=i+1; while(j<n && /[0-9._eE+-]/.test(text[j])) j++; out+=tok(esc(text.slice(i,j)),"n"); i=j; continue;
    }
    if(isPunc(ch)){ out+=tok(esc(ch),"p"); i++; continue; }
    let j=i+1; while(j<n){
      const c=text[j];
      if(c=== '"'||isDigit(c)||isPunc(c)||(c==='-'&&isDigit(text[j+1]||""))) break;
      j++;
    }
    out+=esc(text.slice(i,j)); i=j;
  }
  hlEl.innerHTML = out.replace(/\n/g,"<br>");
}
// Start empty; DO NOT focus (prevents mobile keyboard pop)
if(taEl){ taEl.value = ""; highlight(taEl.value); }

/* =========================================================
   OCR helpers (snap scanner result to valid cards)
   ========================================================= */
function normalizeScanned(raw){
  return String(raw||"")
    .replace(/[“”„‟]/g,'"').replace(/[‘’‚‛]/g,"'")
    .replace(/—|–/g,"-").replace(/[·•●◦]/g,"·")
    .replace(/\u00A0/g," ").replace(/[^\S\r\n]+/g," ")
    .replace(/(\r\n|\r)/g,"\n")
    .replace(/[™©®¥§]/g,'"').replace(/[°]/g,"o")
    .replace(/\s+/g," ").trim();
}
function snapRank(x){
  const s=String(x).toLowerCase();
  if(s==="ace"||s==="a") return "a";
  if(s==="jack"||s==="j") return "j";
  if(s==="queen"||s==="q") return "q";
  if(s==="king"||s==="k") return "k";
  if(/^(10|[2-9])$/.test(s)) return s;
  return null;
}
function snapSuit(x){
  const s=String(x).toLowerCase();
  if(s.startsWith("club")) return "clubs";
  if(s.startsWith("diamond")) return "diamonds";
  if(s.startsWith("heart")) return "hearts";
  if(s.startsWith("spade")) return "spades";
  return null;
}
function coerceCard(any){
  if(!any||typeof any!=="object") return null;
  let {rank,suit,type} = any;
  rank = rank!=null? String(rank).toLowerCase(): null;
  suit = suit!=null? String(suit).toLowerCase(): null;
  rank = snapRank(rank); suit = snapSuit(suit);
  if(!rank || !suit) return null;
  if(!type){ type = rank==="a" ? "number" : (["j","q","k"].includes(rank) ? "face" : "number"); }
  return { rank, suit, type:String(type).toLowerCase() };
}
function snapToKnownCard(text){
  const t = normalizeScanned(text).toLowerCase();
  try{
    const obj = JSON.parse(
      t.replace(/rank\s*:\s*/,'"rank":')
       .replace(/suit\s*:\s*/,'"suit":')
       .replace(/type\s*:\s*/,'"type":')
    );
    const snapped = coerceCard(obj);
    if(snapped) return snapped;
  }catch{}
  const rankHit = (t.match(/\b(10|[2-9]|ace|jack|queen|king|a|j|q|k)\b/i)||[])[0];
  const suitHit = (t.match(/\b(clubs?|diamonds?|hearts?|spades?)\b/i)||[])[0];
  if(rankHit && suitHit){
    const rank=snapRank(rankHit), suit=snapSuit(suitHit);
    if(rank && suit){
      return { rank, suit, type: rank==="a" ? "number" : (["j","q","k"].includes(rank) ? "face" : "number") };
    }
  }
  return null;
}

/* =========================================================
   Overlay Camera (in-page)
   - blur + readonly textarea to suppress mobile keyboard
   ========================================================= */
let overlay, videoEl, stream=null, deviceId=null;

function buildOverlayOnce(){
  if(overlay) return;
  overlay = document.createElement("div");
  overlay.id = "scanOverlay";
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.9); z-index:9999;
    display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; padding:20px;
  `;
  const frame = document.createElement("div");
  frame.style.cssText = `
    position:relative; width:min(90vw,640px); aspect-ratio:3/4; border-radius:14px; overflow:hidden; background:#000;
    outline:2px solid rgba(255,255,255,.15);
  `;
  videoEl = document.createElement("video");
  videoEl.autoplay = true; videoEl.playsInline = true;
  videoEl.style.cssText = "width:100%; height:100%; object-fit:cover;";
  frame.appendChild(videoEl);

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex; gap:10px; width:min(90vw,640px);";
  const mkBtn = (t)=>{ const b=document.createElement("button"); b.textContent=t;
    b.style.cssText="flex:1 1 auto; padding:12px; background:#1b1b1b; color:#fff; border:1px solid #444; border-radius:10px;"; return b; };
  const captureBtn = mkBtn("Capture");
  const flipBtn    = mkBtn("Select Camera");
  const cancelBtn  = mkBtn("Cancel");
  bar.append(captureBtn, flipBtn, cancelBtn);

  overlay.append(frame, bar);
  document.body.appendChild(overlay);

  captureBtn.addEventListener("click", async()=>{
    try{
      const b64 = snapshotToBase64();
      await processImageBase64(b64);
      stopCameraOverlay();  // do NOT focus textarea after scan
    }catch(e){ console.error(e); alert("Capture failed. Try again."); }
  });
  flipBtn.addEventListener("click", async()=>{ await chooseCamera(); });
  cancelBtn.addEventListener("click", ()=> stopCameraOverlay());
}

async function openCameraOverlay(){
  buildOverlayOnce();
  if(taEl){ taEl.blur(); taEl.setAttribute("readonly",""); }  // prevent keyboard
  document.body.classList.add("scan-open");
  overlay.style.display = "flex";
  await chooseCamera(true);
}
function stopCameraOverlay(){
  overlay.style.display = "none";
  document.body.classList.remove("scan-open");
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  if(taEl){ taEl.removeAttribute("readonly"); }               // allow typing again (no focus)
}
async function chooseCamera(preferEnv=false){
  const kinds = await navigator.mediaDevices.enumerateDevices();
  const vids = kinds.filter(d=>d.kind==="videoinput");
  if(!vids.length) throw new Error("No camera found");
  if(preferEnv){
    const rear = vids.find(d=>/back|rear|environment/i.test(d.label));
    deviceId = rear ? rear.deviceId : vids[0].deviceId;
  }else{
    const idx = vids.findIndex(d=>d.deviceId===deviceId);
    deviceId = vids[(idx+1)%vids.length].deviceId;
  }
  await startStreamWithDevice(deviceId);
}
async function startStreamWithDevice(id){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  const constraints = id ? { video:{ deviceId:id } } : { video:{ facingMode:"environment" } };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
}
function snapshotToBase64(){
  const c=document.createElement("canvas");
  const w=videoEl.videoWidth, h=videoEl.videoHeight;
  c.width=w; c.height=h; c.getContext("2d").drawImage(videoEl,0,0,w,h);
  return c.toDataURL("image/jpeg", 0.92);
}

/* =========================================================
   OCR call + populate editor (no focus)
   ========================================================= */
async function processImageBase64(b64){
  const res = await fetch(OCR_URL,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ image:b64 })
  });
  if(!res.ok) throw new Error(`OCR failed ${res.status}`);
  const data = await res.json();
  const snapped = snapToKnownCard(data.text || "");
  if(!snapped){ alert("Couldn’t read a valid card. Try again with flatter, brighter shot."); return; }

  const json = JSON.stringify(snapped, null, 2);
  if(taEl){ taEl.value=json; highlight(json); }  // do NOT focus (prevents keyboard)
}

/* =========================================================
   Card rendering (unchanged)
   ========================================================= */
const W = CANVAS.width, H = CANVAS.height;
const suitChar=(s)=>({clubs:"♣",spades:"♠",hearts:"♥",diamonds:"♦"}[(s||"").toLowerCase()]||"?");
const isRed   =(s)=>/(hearts|diamonds)/i.test(s||"");

const BASE_W=240, BASE_H=336;
const SCALE = Math.min(W/BASE_W, H/BASE_H);
const S=(x)=>x*SCALE;
const layoutScaled=(list)=>list.map(([x,y])=>[S(x),S(y)]);
const LAYOUTS=(()=>{ const B={
  2:[[120,70],[120,266]],
  3:[[120,70],[120,168],[120,266]],
  4:[[72,86],[168,86],[72,250],[168,250]],
  5:[[72,86],[168,86],[120,168],[72,250],[168,250]],
  6:[[72,86],[168,86],[72,168],[168,168],[72,250],[168,250]],
  7:[[72,86],[168,86],[72,168],[168,168],[72,250],[168,250],[120,140]],
  8:[[72,86],[168,86],[72,168],[168,168],[72,250],[168,250],[120,115],[120,221]],
  9:[[72,86],[168,86],[72,168],[168,168],[72,250],[168,250],[120,115],[120,168],[120,221]],
  10:[[72,70],[168,70],[72,130],[168,130],[72,206],[168,206],[72,266],[168,266],[120,95],[120,240]],
  ace:[[120,168]]
}; return Object.fromEntries(Object.entries(B).map(([k,v])=>[k,layoutScaled(v)])); })();

const CARD_SCALE={ corner:26, cornerSuit:24, pips:48, faceCenter:104, cornerPad:14 };

function drawCornerPair(ctx, rankText, suit, color, pad, cornerFont, suitFont){
  ctx.save(); ctx.fillStyle=color; ctx.textBaseline="top"; ctx.textAlign="left"; ctx.font=cornerFont;
  ctx.fillText(rankText,pad,pad); const rankW=ctx.measureText(rankText).width;
  ctx.font=suitFont; ctx.textAlign="center"; ctx.fillText(suitChar(suit), pad+rankW/2, pad+parseInt(cornerFont,10)*0.95);
  ctx.restore();
  ctx.save(); ctx.translate(W-pad,H-pad); ctx.rotate(Math.PI);
  ctx.fillStyle=color; ctx.textBaseline="top"; ctx.textAlign="left"; ctx.font=cornerFont;
  ctx.fillText(rankText,0,0); const rw=ctx.measureText(rankText).width;
  ctx.font=suitFont; ctx.textAlign="center"; ctx.fillText(suitChar(suit), rw/2, parseInt(cornerFont,10)*0.95);
  ctx.restore();
}
function drawPipsCentered(ctx, layout, suit, color, pipFont){
  if(!layout||!layout.length) return;
  const xs=layout.map(([x])=>x); const mid=(Math.min(...xs)+Math.max(...xs))/2;
  const dx=W/2-mid;
  ctx.save(); ctx.fillStyle=color; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.font=pipFont;
  layout.forEach(([x,y])=>ctx.fillText(suitChar(suit), x+dx, y + S(2)));
  ctx.restore();
}
function renderCard(json){
  const card = JSON.parse(json);
  const ctx = CANVAS.getContext("2d");
  ctx.clearRect(0,0,W,H); ctx.fillStyle="#fff"; ctx.fillRect(0,0,W,H);

  if(card.type==="back" && Array.isArray(card.pattern)){ drawBackPattern(ctx,card.pattern,{mode:"cover",inset:S(10),color:"#0b2f66"}); return; }
  if(String(card.type).toLowerCase().startsWith("joker")){ drawJoker(ctx,card); return; }
  if(String(card.type).toLowerCase()==="face"){ drawFaceCard(ctx,card.rank,card.suit); return; }
  if(String(card.type).toLowerCase()==="number"){ drawNumberCard(ctx,card.rank,card.suit); return; }

  ctx.fillStyle="#333"; ctx.font=`${Math.round(S(22))}px ui-monospace`; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText("Invalid card", W/2, H/2);
}
function drawNumberCard(ctx, rank, suit){
  const color=isRed(suit)?"red":"black";
  const cornerFont=`${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall =`${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const pipFont   =`${Math.round(S(CARD_SCALE.pips))}px ui-monospace`;
  const pad=S(CARD_SCALE.cornerPad);
  drawCornerPair(ctx, String(rank).toUpperCase(), suit, color, pad, cornerFont, suitSmall);
  const layout = LAYOUTS[String(rank).toLowerCase()];
  drawPipsCentered(ctx, layout, suit, color, pipFont);
}
function drawFaceCard(ctx, rank, suit){
  const color=isRed(suit)?"red":"black";
  const cornerFont=`${Math.round(S(CARD_SCALE.corner))}px ui-monospace`;
  const suitSmall =`${Math.round(S(CARD_SCALE.cornerSuit))}px ui-monospace`;
  const centerFont=`${Math.round(S(CARD_SCALE.faceCenter))}px ui-monospace`;
  const pad=S(CARD_SCALE.cornerPad);
  const letter=(rank||"?")[0].toUpperCase();
  drawCornerPair(ctx, letter, suit, color, pad, cornerFont, suitSmall);
  ctx.fillStyle=color; ctx.font=centerFont; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(letter, W/2, H/2);
}
function drawJoker(ctx, card){
  ctx.fillStyle="#900"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.font=`${Math.round(S(40))}px ui-monospace`; ctx.fillText("JOKER", W/2, H/2);
  if(card.payload){ ctx.font=`${Math.round(S(12))}px ui-monospace`; ctx.fillText(String(card.payload).replace(/\n/g," "), W/2, H/2+S(34)); }
}
function drawBackPattern(ctx, pattern,{mode="cover",inset=S(14),color="#08326a"}={}){
  const rows=pattern.map(r=>r.trim().split(/\s+/)); const R=rows.length; const C=Math.max(...rows.map(r=>r.length));
  const left=inset, top=inset, right=W-inset, bottom=H-inset; const Wd=right-left, Hd=bottom-top;
  const cell = mode==="cover" ? Math.max(Wd/C, Hd/R) : Math.min(Wd/C, Hd/R);
  const totalW=cell*C, totalH=cell*R; const offsetX=left+(Wd-totalW)/2, offsetY=top+(Hd-totalH)/2;
  ctx.save(); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=Math.max(1,cell*0.08);
  for(let r=0;r<R;r++) for(let c=0;c<rows[r].length;c++){
    const t=rows[r][c], cx=offsetX+c*cell+cell/2, cy=offsetY+r*cell+cell/2; drawToken(ctx,t,cx,cy,cell*0.5);
  }
  ctx.restore();
}
function drawToken(ctx,t,cx,cy,s){
  if(t==="x"||t==="X"){ ctx.beginPath(); ctx.moveTo(cx-s,cy-s); ctx.lineTo(cx+s,cy+s); ctx.moveTo(cx+s,cy-s); ctx.lineTo(cx-s,cy+s); ctx.stroke(); }
  else if(t==="·"||t==="."){ ctx.beginPath(); ctx.arc(cx,cy,s*0.2,0,Math.PI*2); ctx.fill(); }
  else if(t==="o"||t==="O"){ ctx.beginPath(); ctx.lineWidth=Math.max(1,s*0.1); ctx.arc(cx,cy,s*0.3,0,Math.PI*2); ctx.stroke(); }
  else if(t==="-"){ ctx.beginPath(); ctx.moveTo(cx-s*0.4,cy); ctx.lineTo(cx+s*0.4,cy); ctx.stroke(); }
}

/* =========================================================
   Examples
   ========================================================= */
const EXAMPLES = {
  "Number (8♣)": { rank:"8", suit:"clubs", type:"number" },
  "Face (K♠)"  : { rank:"k", suit:"spades", type:"face" },
  "Ace (♦)"    : { rank:"a", suit:"diamonds", type:"number" },
  "Back"       : { type:"back", pattern:[
    "· x · x · x · x · x · x",
    "x · x · x · x · x · x ·",
    "· x · x · x · x · x · x",
    "x · x · x · x · x · x ·",
    "· x · x · x · x · x · x",
    "x · x · x · x · x · x ·",
    "· x · x · x · x · x · x",
    "x · x · x · x · x · x ·",
    "· x · x · x · x · x · x",
    "x · x · x · x · x · x ·",
    "· x · x · x · x · x · x",
    "x · x · x · x · x · x ·",
  ]},
  "Joker"      : { type:"joker1", payload:"<script>alert(JOKER1!)</script>" }
};

/* =========================================================
   UI wiring
   ========================================================= */
const safe=(fn)=>{try{fn();}catch(e){console.error(e);}};

if(btnRender){
  btnRender.addEventListener("click", ()=>{
    btnRender.classList.add("busy");
    safe(()=>renderCard(taEl ? taEl.value : "{}"));
    btnRender.classList.remove("busy");
  });
}

if(btnExamples && taEl){
  btnExamples.addEventListener("click", ()=>{
    const keys=Object.keys(EXAMPLES); if(!keys.length) return;
    const key=keys[Math.floor(Math.random()*keys.length)];
    const json=JSON.stringify(EXAMPLES[key], null, 2);
    taEl.value=json; highlight(json);
  });
}

if(btnScan){
  btnScan.addEventListener("click", async ()=>{
    try{ await openCameraOverlay(); }
    catch(e){ console.error(e); alert("Could not start camera. Check permissions and try again."); }
  });
}

/* No auto-render on load */
