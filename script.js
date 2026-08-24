const API="https://api.weather.gov/alerts/active";
const NORMAL_REFRESH=30000;
const MAX_BACKOFF=300000;
const NEW_MS=5*60*1000;
const ROTATE_MS=5000;
const NEW_ALERT_MS=9000;
const STORAGE_KEY="trg-warningoverlay-last-alerts-v3";

const ALLOWED=new Set(["Tornado Warning","Severe Thunderstorm Warning","Tornado Watch","Severe Thunderstorm Watch"]);
const priority={"Tornado Warning":1,"Severe Thunderstorm Warning":2,"Tornado Watch":3,"Severe Thunderstorm Watch":4};
const colors={"Tornado Warning":"#ef4444","Severe Thunderstorm Warning":"#f97316","Tornado Watch":"#eab308","Severe Thunderstorm Watch":"#eab308"};

let alerts=[];
let currentIndex=0;
let lastSignature="";
let popupTimer=null;
let rotationTimer=null;
let failureCount=0;
let firstSuccessfulLoad=false;
let audioCtx=null;

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));

function formatDateTime(v){const d=new Date(v||0);return Number.isNaN(d.getTime())?"Unknown":d.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
function isNew(f){const t=new Date(f.properties?.sent||f.properties?.effective||0).getTime();return Number.isFinite(t)&&Date.now()-t<=NEW_MS&&Date.now()>=t}
function signature(list){return list.map(f=>[f.id,f.properties?.event,f.properties?.sent,f.properties?.effective,f.properties?.expires,f.properties?.areaDesc].join("|")).sort().join("~")}
function sortAlerts(list){return [...list].sort((a,b)=>{const pa=priority[a.properties?.event]||99,pb=priority[b.properties?.event]||99;return pa-pb||new Date(b.properties?.sent||0)-new Date(a.properties?.sent||0)})}
function removeExpired(list){const now=Date.now();return list.filter(f=>{const exp=new Date(f.properties?.expires||0).getTime();return !Number.isFinite(exp)||exp>now})}
function saveAlerts(list){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({savedAt:Date.now(),alerts:list}))}catch{}}
function loadSavedAlerts(){try{const x=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");return Array.isArray(x.alerts)?x.alerts.filter(f=>ALLOWED.has(f.properties?.event)):[]}catch{return[]}}

function renderAlert(f,index,total){
  if(!f){$("activeAlert").classList.add("hidden");$("empty").classList.remove("hidden");return}
  const p=f.properties||{},accent=colors[p.event]||"#64748b";
  $("empty").classList.add("hidden");
  $("activeAlert").classList.remove("hidden");
  $("activeAlert").style.setProperty("--accent",accent);
  $("alertStripe").style.background=accent;
  $("alertBadge").textContent=isNew(f)?"NEW ALERT":(p.event?.endsWith("Watch")?"WATCH":"WARNING");
  $("alertBadge").style.background=accent;
  $("alertIndex").textContent=total>1?`${index+1} / ${total}`:"ACTIVE";
  $("alertEvent").textContent=p.event||"ACTIVE ALERT";
  $("alertArea").textContent=p.areaDesc||"Area unavailable";
  $("alertTime").textContent=`Issued ${formatDateTime(p.sent||p.effective)} · Expires ${formatDateTime(p.expires)}`;
  $("alertHeadline").textContent=p.headline||"NWS severe weather alert active.";
  $("activeAlert").classList.remove("animate-alert");
  void $("activeAlert").offsetWidth;
  $("activeAlert").classList.add("animate-alert");
  $("count").textContent=`${total} ACTIVE ALERT${total===1?"":"S"}`;
}

function render(){
  alerts=removeExpired(sortAlerts(alerts));
  if(!alerts.length){currentIndex=0;renderAlert(null,0,0);$("count").textContent="0 ACTIVE ALERTS";return}
  if(currentIndex>=alerts.length)currentIndex=0;
  renderAlert(alerts[currentIndex],currentIndex,alerts.length);
}

function startRotation(){
  clearInterval(rotationTimer);
  rotationTimer=setInterval(()=>{
    alerts=removeExpired(sortAlerts(alerts));
    if(alerts.length<=1){render();return}
    currentIndex=(currentIndex+1)%alerts.length;
    render();
  },ROTATE_MS);
}

function playTone(){try{audioCtx ||= new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type="square";o.frequency.setValueAtTime(740,audioCtx.currentTime);o.frequency.setValueAtTime(520,audioCtx.currentTime+.12);g.gain.setValueAtTime(.0001,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.14,audioCtx.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.35);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.36)}catch{}}

function showNewAlert(f){
  const p=f.properties||{},accent=colors[p.event]||"#64748b";
  $("newAlert").style.setProperty("--new-accent",accent);
  $("newStripe").style.background=accent;
  $("newEvent").textContent=p.event||"NEW ALERT";
  $("newArea").textContent=p.areaDesc||"Area unavailable";
  $("newTime").textContent=`Issued ${formatDateTime(p.sent||p.effective)} · Expires ${formatDateTime(p.expires)}`;
  $("newAlert").classList.remove("hidden");
  clearTimeout(popupTimer);
  popupTimer=setTimeout(()=>$("newAlert").classList.add("hidden"),NEW_ALERT_MS);
  playTone();
}

function setStatus(text,live=false){$("status").textContent=text;$("liveDot").classList.toggle("on",live)}
function schedule(ms){clearTimeout(window.nwsTimer);window.nwsTimer=setTimeout(load,ms)}

async function load(){
  try{
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
    const r=await fetch(API,{cache:"no-store",headers:{Accept:"application/geo+json"},signal:controller.signal});clearTimeout(timeout);
    if(!r.ok)throw new Error(`NWS HTTP ${r.status}`);
    const data=await r.json();
    const next=(data.features||[]).filter(f=>ALLOWED.has(f.properties?.event));
    const oldIds=new Set(alerts.map(f=>f.id));
    const newAlerts=sortAlerts(next).filter(f=>!oldIds.has(f.id));
    const nextSig=signature(next);
    if(lastSignature&&nextSig!==lastSignature&&newAlerts.length)showNewAlert(newAlerts[0]);
    alerts=sortAlerts(next);lastSignature=nextSig;saveAlerts(alerts);firstSuccessfulLoad=true;failureCount=0;
    if(newAlerts.length){const newestIndex=alerts.findIndex(f=>f.id===newAlerts[0].id);if(newestIndex>=0)currentIndex=newestIndex}
    render();setStatus("LIVE",true);$("updated").textContent=`UPDATED ${new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit",second:"2-digit"})}`;schedule(NORMAL_REFRESH);
  }catch(err){
    console.error("WarningOverlay NWS request failed:",err);failureCount++;
    if(!firstSuccessfulLoad&&alerts.length===0){alerts=removeExpired(loadSavedAlerts());if(alerts.length)lastSignature=signature(alerts)}
    render();setStatus(alerts.length?"STALE DATA":"NWS OFFLINE",false);$("updated").textContent="LAST GOOD DATA · RETRYING";
    schedule(Math.min(MAX_BACKOFF,NORMAL_REFRESH*Math.pow(2,Math.min(failureCount-1,4))));
  }
}

alerts=removeExpired(sortAlerts(loadSavedAlerts()));
if(alerts.length){lastSignature=signature(alerts);render();setStatus("CACHED DATA",false)}else render();
startRotation();load();setInterval(render,30000);
