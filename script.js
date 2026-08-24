const API="https://api.weather.gov/alerts/active";
const NORMAL_REFRESH=30000;
const MAX_BACKOFF=300000;
const POPUP_MS=9000;
const NEW_MS=5*60*1000;
const STORAGE_KEY="trg-warningoverlay-last-alerts-v2";

const ALLOWED=new Set([
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch"
]);

const priority={
  "Tornado Warning":1,
  "Severe Thunderstorm Warning":2,
  "Tornado Watch":3,
  "Severe Thunderstorm Watch":4
};

const colors={
  "Tornado Warning":"#ef4444",
  "Severe Thunderstorm Warning":"#f97316",
  "Tornado Watch":"#eab308",
  "Severe Thunderstorm Watch":"#eab308"
};

let alerts=[];
let lastSignature="";
let popupTimer=null;
let audioCtx=null;
let failureCount=0;
let timer=null;
let firstSuccessfulLoad=false;

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  "\"":"&quot;",
  "'":"&#039;"
}[c]));

function formatDateTime(v){
  if(!v)return"Unknown";
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return"Unknown";
  return d.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}

function isNew(f){
  const t=new Date(f.properties?.sent||f.properties?.effective||0).getTime();
  return Number.isFinite(t) && Date.now()-t<=NEW_MS && Date.now()>=t;
}

function signature(list){
  return list.map(f=>[
    f.id,
    f.properties?.event,
    f.properties?.sent,
    f.properties?.effective,
    f.properties?.expires,
    f.properties?.areaDesc
  ].join("|")).sort().join("~");
}

function sortAlerts(list){
  return [...list].sort((a,b)=>{
    const pa=priority[a.properties?.event]||99;
    const pb=priority[b.properties?.event]||99;
    return pa-pb || new Date(b.properties?.sent||0)-new Date(a.properties?.sent||0);
  });
}

function saveAlerts(list){
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify({savedAt:Date.now(),alerts:list}));
  }catch{}
}

function loadSavedAlerts(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw)return [];
    const saved=JSON.parse(raw);
    if(!Array.isArray(saved.alerts))return [];
    return saved.alerts.filter(f=>ALLOWED.has(f.properties?.event));
  }catch{return []}
}

function removeExpired(list){
  const now=Date.now();
  return list.filter(f=>{
    const exp=new Date(f.properties?.expires||0).getTime();
    return !Number.isFinite(exp)||exp>now;
  });
}

function render(){
  const list=sortAlerts(removeExpired(alerts));
  alerts=list;
  $("alerts").innerHTML="";
  $("empty").classList.toggle("hidden",list.length>0);
  $("count").textContent=`${list.length} ACTIVE ALERT${list.length===1?"":"S"}`;

  for(const f of list){
    const p=f.properties||{};
    const accent=colors[p.event]||"#64748b";
    const el=document.createElement("article");
    el.className="alert"+(isNew(f)?" new":"");
    el.style.setProperty("--accent",accent);
    const isWatch=String(p.event||"").endsWith("Watch");
    el.innerHTML=`
      <div>
        ${isNew(f)?'<div class="badge">NEW</div>':""}
        <div class="alert-type">${esc(p.event)}</div>
      </div>
      <div>
        <div class="alert-area">${esc(p.areaDesc||"Area unavailable")}</div>
        <div class="alert-time">Issued ${formatDateTime(p.sent||p.effective)} · Expires ${formatDateTime(p.expires)}</div>
      </div>
      <div class="alert-detail">${isWatch?"Watch area active. Be prepared for possible severe weather.":esc(p.headline||"NWS warning active.")}</div>`;
    $("alerts").appendChild(el);
  }
}

function playTone(){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended")audioCtx.resume();
    const osc=audioCtx.createOscillator();
    const gain=audioCtx.createGain();
    osc.type="square";
    osc.frequency.setValueAtTime(740,audioCtx.currentTime);
    osc.frequency.setValueAtTime(520,audioCtx.currentTime+.12);
    gain.gain.setValueAtTime(.0001,audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.14,audioCtx.currentTime+.02);
    gain.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime+.36);
  }catch{}
}

function showPopup(f){
  const p=f.properties||{};
  const accent=colors[p.event]||"#64748b";
  $("popup").style.setProperty("--popup-accent",accent);
  $("popupEvent").textContent=p.event||"NEW ALERT";
  $("popupArea").textContent=p.areaDesc||"Area unavailable";
  $("popupTime").textContent=`Issued ${formatDateTime(p.sent||p.effective)} · Expires ${formatDateTime(p.expires)}`;
  $("popup").classList.remove("hidden");
  document.body.classList.add("popup-active");
  playTone();
  clearTimeout(popupTimer);
  popupTimer=setTimeout(()=>{
    $("popup").classList.add("hidden");
    document.body.classList.remove("popup-active");
  },POPUP_MS);
}

function setLiveStatus(text,live=false){
  $("status").textContent=text;
  $("liveDot").classList.toggle("on",live);
}

function schedule(ms){
  clearTimeout(timer);
  timer=setTimeout(load,ms);
}

async function load(){
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    const r=await fetch(API,{
      method:"GET",
      cache:"no-store",
      headers:{Accept:"application/geo+json"},
      signal:controller.signal
    });
    clearTimeout(timeout);
    if(!r.ok)throw new Error(`NWS HTTP ${r.status}`);

    const data=await r.json();
    const next=(data.features||[]).filter(f=>ALLOWED.has(f.properties?.event));
    const nextSig=signature(next);

    if(lastSignature && nextSig!==lastSignature){
      const oldIds=new Set(alerts.map(f=>f.id));
      const newAlerts=sortAlerts(next).filter(f=>!oldIds.has(f.id));
      if(newAlerts.length)showPopup(newAlerts[0]);
    }

    alerts=next;
    lastSignature=nextSig;
    saveAlerts(next);
    firstSuccessfulLoad=true;
    failureCount=0;
    render();
    setLiveStatus("LIVE",true);
    $("updated").textContent=`UPDATED ${new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit",second:"2-digit"})}`;
    schedule(NORMAL_REFRESH);
  }catch(err){
    console.error("WarningOverlay NWS request failed:",err);
    failureCount++;
    if(!firstSuccessfulLoad && alerts.length===0){
      alerts=removeExpired(loadSavedAlerts());
      if(alerts.length){
        lastSignature=signature(alerts);
        render();
      }
    }else{
      render();
    }
    setLiveStatus(alerts.length?"STALE DATA":"NWS OFFLINE",false);
    const delay=Math.min(MAX_BACKOFF,NORMAL_REFRESH*Math.pow(2,Math.min(failureCount-1,4)));
    $("updated").textContent=`LAST GOOD DATA${alerts.length?" · RETRYING":" · RETRYING"}`;
    schedule(delay);
  }
}

alerts=removeExpired(loadSavedAlerts());
if(alerts.length){
  lastSignature=signature(alerts);
  render();
  setLiveStatus("CACHED DATA",false);
}

load();
setInterval(render,30000);
