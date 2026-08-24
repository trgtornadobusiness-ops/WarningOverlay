const API="https://api.weather.gov/alerts/active";
const REFRESH=15000;
const POPUP_MS=9000;
const NEW_MS=5*60*1000;

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

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#039;"}[c]));

function formatTime(v){
  if(!v)return"Unknown";
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return"Unknown";
  return d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
}

function formatDateTime(v){
  if(!v)return"Unknown";
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return"Unknown";
  return d.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}

function isNew(f){
  const t=new Date(f.properties.sent||f.properties.effective||0).getTime();
  return Number.isFinite(t) && Date.now()-t<=NEW_MS && Date.now()>=t;
}

function signature(list){
  return list.map(f=>[
    f.id,
    f.properties.event,
    f.properties.sent,
    f.properties.effective,
    f.properties.expires,
    f.properties.areaDesc
  ].join("|")).sort().join("~");
}

function sortAlerts(list){
  return [...list].sort((a,b)=>{
    const pa=priority[a.properties.event]||99;
    const pb=priority[b.properties.event]||99;
    return pa-pb ||
      new Date(b.properties.sent||0)-new Date(a.properties.sent||0);
  });
}

function render(){
  const list=sortAlerts(alerts);
  $("alerts").innerHTML="";
  $("empty").classList.toggle("hidden",list.length>0);
  $("count").textContent=`${list.length} ACTIVE ALERT${list.length===1?"":"S"}`;

  for(const f of list){
    const p=f.properties;
    const accent=colors[p.event]||"#64748b";
    const el=document.createElement("article");
    el.className="alert"+(isNew(f)?" new":"");
    el.style.setProperty("--accent",accent);

    const isWatch=p.event.endsWith("Watch");
    el.innerHTML=`
      <div>
        ${isNew(f)?'<div class="badge">NEW</div>':""}
        <div class="alert-type">${esc(p.event)}</div>
      </div>
      <div>
        <div class="alert-area">${esc(p.areaDesc||"Area unavailable")}</div>
        <div class="alert-time">Issued ${formatDateTime(p.sent||p.effective)} · Expires ${formatDateTime(p.expires)}</div>
      </div>
      <div class="alert-detail">
        ${isWatch
          ? "Watch area active. Be prepared for possible severe weather."
          : esc(p.headline||"NWS warning active.")}
      </div>`;
    $("alerts").appendChild(el);
  }
}

function playTone(){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
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
  const p=f.properties;
  const accent=colors[p.event]||"#64748b";
  $("popup").style.setProperty("--popup-accent",accent);
  $("popupEvent").textContent=p.event;
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

async function load(){
  try{
    const r=await fetch(API,{
      cache:"no-store",
      headers:{
        Accept:"application/geo+json",
        "User-Agent":"TRGTornado-WarnOverlay/1.0"
      }
    });
    if(!r.ok)throw new Error(`HTTP ${r.status}`);

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
    render();

    $("status").textContent="LIVE";
    $("liveDot").classList.add("on");
    $("updated").textContent=`UPDATED ${new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit",second:"2-digit"})}`;
  }catch(err){
    console.error(err);
    $("status").textContent="CONNECTION ISSUE";
    $("liveDot").classList.remove("on");
  }
}

load();
setInterval(load,REFRESH);
setInterval(render,30000);
