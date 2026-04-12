import { useState, useEffect } from "react";

const ACTIVITY_MULTIPLIERS = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725 };
const GOAL_DEFICITS = { lose:500, "lose-muscle":300, maintain:0 };
const PROTEIN_GOALS = { lose:1.6, "lose-muscle":2.0, maintain:1.4 };
const WATER_GOAL = 2500;
const NAV = [
  {id:"tracker",icon:"⚡",label:"Today"},
  {id:"search",icon:"🔍",label:"Search"},
  {id:"goals",icon:"🎯",label:"Goals"},
  {id:"history",icon:"📅",label:"Logs"},
  {id:"weight",icon:"📈",label:"Weight"},
];

// ─── Math helpers ─────────────────────────────────────────────────────────────
function calcTargets(s) {
  const w=parseFloat(s.weight),h=parseFloat(s.height),a=parseFloat(s.age);
  if(!w||!h||!a) return null;
  const bmr=s.sex==="male"?10*w+6.25*h-5*a+5:10*w+6.25*h-5*a-161;
  const tdee=bmr*(ACTIVITY_MULTIPLIERS[s.activity]||1.375);
  const calories=Math.round(tdee-(GOAL_DEFICITS[s.goal]||500));
  const protein=Math.round(w*(PROTEIN_GOALS[s.goal]||1.6));
  const fat=Math.round((calories*0.25)/9);
  const carbs=Math.round((calories-protein*4-fat*9)/4);
  return {calories,protein,fat,carbs,tdee:Math.round(tdee)};
}

// Given a deficitGoal config + TDEE, return derived numbers
function resolveGoal(dg, tdee) {
  if(!dg||!tdee) return null;
  if(dg.mode==="rate") {
    const dailyDeficit=Math.round((parseFloat(dg.kgPerWeek)||0)*7700/7);
    const calsPerDay=tdee-dailyDeficit;
    const weeksTo=dg.targetKg&&dailyDeficit>0 ? +((parseFloat(dg.targetKg)*7700)/(dailyDeficit*7)).toFixed(1) : null;
    const daysTo=weeksTo?Math.round(weeksTo*7):null;
    const arrivalDate=daysTo ? (() => { const d=new Date(); d.setDate(d.getDate()+daysTo); return d.toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}); })() : null;
    return { dailyDeficit, calsPerDay, kgPerWeek:parseFloat(dg.kgPerWeek)||0, daysLeft:null, totalKg:parseFloat(dg.targetKg)||null, weeksTo, arrivalDate };
  }
  if(dg.mode==="date") {
    const now=new Date(); now.setHours(0,0,0,0);
    const target=new Date((dg.targetDate||todayKey())+"T00:00:00");
    const daysLeft=Math.max(1,Math.round((target-now)/(86400000)));
    const totalKcal=(parseFloat(dg.targetKg)||0)*7700;
    const dailyDeficit=Math.round(totalKcal/daysLeft);
    const calsPerDay=tdee-dailyDeficit;
    const kgPerWeek=+((dailyDeficit*7)/7700).toFixed(2);
    return { dailyDeficit, calsPerDay, kgPerWeek, daysLeft, totalKg:parseFloat(dg.targetKg)||0, weeksTo:null, arrivalDate:dg.targetDate };
  }
  return null;
}

const todayKey=()=>{
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const fmtDate=(k)=>new Date(k+"T12:00:00").toLocaleDateString("en-AU",{weekday:"short",month:"short",day:"numeric"});
const fmtLong=(k)=>new Date(k+"T12:00:00").toLocaleDateString("en-AU",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
const sumE=(arr=[])=>arr.reduce((a,e)=>({cal:a.cal+(e.cal||0),protein:a.protein+(e.protein||0),carbs:a.carbs+(e.carbs||0),fat:a.fat+(e.fat||0)}),{cal:0,protein:0,carbs:0,fat:0});
const minDate=()=>{ const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); };

// ─── Storage ──────────────────────────────────────────────────────────────────
const sg=async(k)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}catch{return null;}};
const ss=async(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
const sl=async(p)=>{try{return Object.keys(localStorage).filter(k=>k.startsWith(p));}catch{return[];}};

// ─── AI ───────────────────────────────────────────────────────────────────────
async function aiCall(prompt,sys){
  try {
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:sys,messages:[{role:"user",content:prompt}]})});
    const d=await res.json();
    return d.content?.map(b=>b.text||"").join("")||"";
  } catch(e) {
    console.error("API error:",e);
    return "";
  }
}
async function searchFood(q){
  const raw=await aiCall(`Nutritional info for: "${q}". Focus on Australian products (Coles, Woolworths, Aldi) and Australian fast food/Uber Eats. Return ONLY a JSON array of up to 6 results: [{"name":"...","brand":"...","serving":"...","cal":0,"protein":0,"carbs":0,"fat":0}]. Integers only. No markdown.`,"You are a nutrition database. Return only valid JSON arrays. No markdown fences, no explanation.");
  try{return JSON.parse(raw.replace(/```json|```/g,"").trim());}catch{return[];}
}
async function getMeals(rem,tgt){
  const raw=await aiCall(`Remaining macros today: ${rem.cal}cal, ${rem.protein}g protein, ${rem.carbs}g carbs, ${rem.fat}g fat. Daily targets: ${tgt.calories}cal, ${tgt.protein}g protein. Suggest 4 practical Australian meal/snack ideas (Coles, Woolworths, Aldi, fast food). Return ONLY JSON: [{"name":"...","description":"...","cal":0,"protein":0,"carbs":0,"fat":0,"tip":"..."}]. Integers. No markdown.`,"You are a nutrition coach. Return only valid JSON arrays. No markdown fences.");
  try{return JSON.parse(raw.replace(/```json|```/g,"").trim());}catch{return[];}
}

// ─── Design ───────────────────────────────────────────────────────────────────
// ─── Theme ────────────────────────────────────────────────────────────────────
const LIGHT={bg:"#f5f5f7",surface:"#ffffff",card:"#ffffff",border:"#e5e5ea",red:"#e8372a",redLight:"#ff6b5e",cyan:"#007aff",violet:"#5856d6",green:"#34c759",yellow:"#ff9500",text:"#1c1c1e",muted:"#8e8e93",subtle:"#f2f2f7",shadow:"0 2px 16px rgba(0,0,0,0.08)"};
const DARK={bg:"#07090f",surface:"#0e1118",card:"#131a24",border:"#1e2d3f",red:"#ff4757",redLight:"#ff6b78",cyan:"#00d4ff",violet:"#7c5cfc",green:"#00e5a0",yellow:"#fbbf24",text:"#edf2f8",muted:"#4a6078",subtle:"#172030",shadow:"0 4px 24px rgba(0,0,0,0.3)"};
const useTheme=(dark)=>{
  const C=dark?DARK:LIGHT;
  const pStyle={minHeight:"100vh",background:C.bg,fontFamily:"'DM Mono',monospace",color:C.text,maxWidth:430,margin:"0 auto",paddingBottom:82};
  const crd={background:C.card,borderRadius:18,border:`1px solid ${C.border}`,padding:"15px",boxShadow:C.shadow};
  const iStyle={background:C.subtle,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,padding:"10px 12px",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",fontFamily:"'DM Mono',monospace"};
  const chipFn=(on,col=C.red)=>({border:`1px solid ${on?col:C.border}`,borderRadius:9,padding:"8px 6px",fontSize:10,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:700,background:on?col+"22":C.subtle,color:on?col:C.muted,transition:"all 0.15s",letterSpacing:"0.03em"});
  const btnFn=(col=C.red)=>({background:col,border:"none",borderRadius:50,color:"#fff",padding:"13px 18px",fontSize:13,fontWeight:700,cursor:"pointer",width:"100%",fontFamily:"'DM Mono',monospace",letterSpacing:"0.03em",boxShadow:`0 4px 16px ${col}55`});
  return{C,pStyle,crd,iStyle,chipFn,btnFn};
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function Ring({value,max,color,size=68,stroke=6,label,sub}){
  const r=(size-stroke)/2,circ=2*Math.PI*r,dash=Math.min(value/(max||1),1)*circ;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 0.5s ease"}}/>
      </svg>
      <div style={{textAlign:"center",marginTop:-2}}>
        <div style={{fontSize:12,fontWeight:700,color:C.text}}>{label}</div>
        <div style={{fontSize:10,color:C.muted}}>{sub}</div>
      </div>
    </div>
  );
}

function Bar({label,current,max,color}){
  const pct=Math.min((current/(max||1))*100,100),over=current>max;
  return(
    <div style={{marginBottom:9}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:11,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</span>
        <span style={{fontSize:11,color:over?C.red:C.text}}>{current}g / {max}g</span>
      </div>
      <div style={{height:5,borderRadius:99,background:C.subtle,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,borderRadius:99,background:over?C.red:color,transition:"width 0.4s"}}/>
      </div>
    </div>
  );
}

function WaterRing({ml}){
  const pct=Math.min(ml/WATER_GOAL,1),size=86,stroke=7,r=(size-stroke)/2,circ=2*Math.PI*r,dash=pct*circ;
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)",position:"absolute"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.cyan} strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 0.5s"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:14,fontWeight:700,color:C.cyan}}>{Math.round(ml/100)/10}L</div>
        <div style={{fontSize:9,color:C.muted}}>/{WATER_GOAL/1000}L</div>
      </div>
    </div>
  );
}

// Radial progress for Goals tab
function GoalRing({pct,color,size=110,stroke=9,label,sub}){
  const r=(size-stroke)/2,circ=2*Math.PI*r,dash=Math.min(pct/100,1)*circ;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
      <div style={{position:"relative",width:size,height:size}}>
        <svg width={size} height={size} style={{transform:"rotate(-90deg)",position:"absolute"}}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke}/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={pct>100?C.red:color} strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 0.6s ease"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:18,fontWeight:700,color:pct>100?C.red:color}}>{Math.round(pct)}%</div>
          <div style={{fontSize:9,color:C.muted}}>of goal</div>
        </div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:12,fontWeight:700,color:C.text}}>{label}</div>
        {sub&&<div style={{fontSize:10,color:C.muted}}>{sub}</div>}
      </div>
    </div>
  );
}

function Spin({col=C.red}){
  return <span style={{display:"inline-block",width:14,height:14,border:`2px solid ${col}33`,borderTop:`2px solid ${col}`,borderRadius:"50%",animation:"spin 0.7s linear infinite",verticalAlign:"middle"}}/>;
}

function NavBar({active,onChange}){
  return(
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:C.surface,borderTop:`1px solid ${C.border}`,display:"flex",zIndex:100}}>
      {NAV.map(n=>(
        <button key={n.id} onClick={()=>onChange(n.id)} style={{flex:1,background:"none",border:"none",padding:"9px 2px 11px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
          <span style={{fontSize:17}}>{n.icon}</span>
          <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.06em",color:active===n.id?C.red:C.muted,textTransform:"uppercase"}}>{n.label}</span>
          {active===n.id&&<div style={{width:14,height:2,borderRadius:1,background:C.red}}/>}
        </button>
      ))}
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────
function Tile({label,value,sub,color=C.text}){
  return(
    <div style={{background:C.subtle,borderRadius:12,padding:"10px 11px",border:`1px solid ${C.border}`}}>
      <div style={{fontSize:8,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color}}>{value}</div>
      {sub&&<div style={{fontSize:9,color:C.muted,marginTop:1}}>{sub}</div>}
    </div>
  );
}

// ─── Safety check ─────────────────────────────────────────────────────────────
function safetyLabel(calsPerDay){
  if(calsPerDay<1000) return {text:"⚠️ Below safe minimum (1000 kcal). Consider a smaller deficit.",color:C.red};
  if(calsPerDay<1200) return {text:"⚠️ Very aggressive — consult a health professional.",color:C.yellow};
  return null;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App(){
  const [darkMode,setDarkMode]=useState(()=>{try{const v=localStorage.getItem("fp:darkmode");return v?JSON.parse(v):false;}catch{return false;}});
  const [screen,setScreen]=useState("loading");
  const [nav,setNav]=useState("tracker");
  const [stats,setStats]=useState({weight:"",height:"",age:"",sex:"male",activity:"moderate",goal:"lose"});
  const [targets,setTargets]=useState(null);
  const [entries,setEntries]=useState([]);
  const [water,setWater]=useState(0);
  const [newFood,setNewFood]=useState({name:"",cal:"",protein:"",carbs:"",fat:""});
  const [templates,setTemplates]=useState([]);
  const [showTpl,setShowTpl]=useState(false);
  const [histDays,setHistDays]=useState([]);
  const [dayDetail,setDayDetail]=useState(null);
  const [wLog,setWLog]=useState([]);
  const [newW,setNewW]=useState("");
  const [searchQ,setSearchQ]=useState("");
  const [recentSearches,setRecentSearches]=useState([]);
  const [searchMode,setSearchMode]=useState("search"); // "search" | "recipe"
  const [recipeName,setRecipeName]=useState("");
  const [recipeIngredients,setRecipeIngredients]=useState([]);
  const [recipeSearchQ,setRecipeSearchQ]=useState("");
  const [recipeSearchR,setRecipeSearchR]=useState([]);
  const [recipeSearchLoading,setRecipeSearchLoading]=useState(false);
  const [recipeManual,setRecipeManual]=useState({name:"",cal:"",protein:"",carbs:"",fat:""});
  const [searchR,setSearchR]=useState([]);
  const [searchLoading,setSearchLoading]=useState(false);
  const [suggestions,setSuggestions]=useState([]);
  const [suggestLoading,setSuggestLoading]=useState(false);
  const [streak,setStreak]=useState(0);
  const [weekData,setWeekData]=useState([]);
  const [savedToday,setSavedToday]=useState(false);
  const [editMode,setEditMode]=useState(false);
  const [editFood,setEditFood]=useState({name:"",cal:"",protein:"",carbs:"",fat:""});
  const [showAddPastDay,setShowAddPastDay]=useState(false);
  const [pastDayDate,setPastDayDate]=useState("");
  const [pastDayFood,setPastDayFood]=useState({name:"",cal:"",protein:"",carbs:"",fat:""});
  const [pastDayEntries,setPastDayEntries]=useState([]);

  // Deficit goal state
  const [defGoal,setDefGoal]=useState(null); // persisted config
  const [dgDraft,setDgDraft]=useState({mode:"rate",kgPerWeek:"0.5",targetKg:"",targetDate:""}); // editing draft

  const today=todayKey(); // recalculates on every render via todayKey()

  // ── Reset if date has changed since app opened ──
  useEffect(()=>{
    const interval=setInterval(async()=>{
      const currentDay=todayKey();
      if(currentDay!==today){
        // Date has changed — load fresh entries for the new day
        const e=await sg(`fp:day:${currentDay}`)||[];
        const w=await sg(`fp:water:${currentDay}`)||0;
        setEntries(e);
        setWater(w);
        setSavedToday(false);
      }
    },60000); // check every minute
    return()=>clearInterval(interval);
  },[today]);

  // ── Boot ──
  useEffect(()=>{
    (async()=>{
      const cfg=await sg("fp:settings");
      if(cfg){setStats(cfg.stats);setTargets(cfg.targets);}
      const e=await sg(`fp:day:${todayKey()}`)||[];
      const w=await sg(`fp:water:${todayKey()}`)||0;
      const t=await sg("fp:templates")||[];
      const wl=await sg("fp:weights")||[];
      const dg=await sg("fp:deficitgoal");
      const rs=await sg("fp:recentsearches")||[];
      setEntries(e);setWater(w);setTemplates(t);setWLog(wl);
      setRecentSearches(rs);
      if(dg){setDefGoal(dg);setDgDraft(dg);}
      let s=0,d=new Date();
      for(let i=0;i<365;i++){
        const k=d.toISOString().slice(0,10);
        const de=await sg(`fp:day:${k}`)||[];
        if(de.length===0&&k!==today)break;
        if(de.length>0)s++;
        d.setDate(d.getDate()-1);
      }
      setStreak(s);
      setScreen(cfg?"main":"setup");
    })();
  },[]);

  // ── Persist helpers ──
  const saveEntries=async(e)=>{setEntries(e);await ss(`fp:day:${todayKey()}`,e);};
  const saveWater=async(w)=>{setWater(w);await ss(`fp:water:${todayKey()}`,w);};
  const saveDefGoal=async(dg)=>{
    setDefGoal(dg);
    await ss("fp:deficitgoal",dg);
    // Also update the daily calorie target to match the new goal
    if(targets){
      const preview=resolveGoal(dg,targets.tdee);
      if(preview&&preview.calsPerDay>0){
        const updated={...targets,calories:Math.round(preview.calsPerDay)};
        setTargets(updated);
        await ss("fp:settings",{stats,targets:updated});
      }
    }
  };

  // ── Setup ──
  const handleSetup=async()=>{
    const t=calcTargets(stats);
    if(!t)return alert("Please fill in all fields.");
    await ss("fp:settings",{stats,targets:t});
    setTargets(t);setScreen("main");
  };

  // ── Food ──
  const addFood=async(item)=>{
    const e=[...entries,{id:Date.now(),...item,time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}];
    await saveEntries(e);
  };
  const removeFood=async(id,name)=>{if(!window.confirm(`Remove "${name}" from today?`))return;await saveEntries(entries.filter(e=>e.id!==id));};
  const addFromForm=async()=>{
    if(!newFood.name||!newFood.cal)return;
    await addFood({name:newFood.name,cal:parseInt(newFood.cal)||0,protein:parseInt(newFood.protein)||0,carbs:parseInt(newFood.carbs)||0,fat:parseInt(newFood.fat)||0});
    setNewFood({name:"",cal:"",protein:"",carbs:"",fat:""});
  };

  // ── Templates ──
  const saveTpl=async(item)=>{const t=[...templates,{id:Date.now(),name:item.name,cal:item.cal,protein:item.protein,carbs:item.carbs,fat:item.fat}];setTemplates(t);await ss("fp:templates",t);};
  const removeTpl=async(id)=>{const t=templates.filter(x=>x.id!==id);setTemplates(t);await ss("fp:templates",t);};

  // ── Weight ──
  const logWeight=async()=>{
    if(!newW)return;
    const wl=[...wLog,{date:todayKey(),kg:parseFloat(newW)}].sort((a,b)=>a.date.localeCompare(b.date));
    setWLog(wl);await ss("fp:weights",wl);setNewW("");
  };

  // ── History ──
  const loadHistory=async()=>{
    const keys=await sl("fp:day:");
    const days=await Promise.all(keys.map(k=>k.replace("fp:day:","")).sort((a,b)=>b.localeCompare(a)).map(async k=>{
      const e=await sg(`fp:day:${k}`)||[];
      const w=await sg(`fp:water:${k}`)||0;
      return{key:k,entries:e,totals:sumE(e),water:w};
    }));
    setHistDays(days);
  };

  // ── Weekly ──
  const loadWeekly=async()=>{
    const days=[];
    for(let i=6;i>=0;i--){
      const d=new Date();d.setDate(d.getDate()-i);
      const k=d.toISOString().slice(0,10);
      const e=await sg(`fp:day:${k}`)||[];
      const w=await sg(`fp:water:${k}`)||0;
      days.push({key:k,label:d.toLocaleDateString("en-AU",{weekday:"short"}),totals:sumE(e),water:w});
    }
    setWeekData(days);
  };

  // ── Save Day ──
  const saveDay=async()=>{
    const currentDay=todayKey(); // always use current date, never stale
    await ss(`fp:day:${currentDay}`,entries);
    await ss(`fp:water:${currentDay}`,water);
    setHistDays([]); // clear cached history so Load Logs fetches fresh
    setSavedToday(true);
    setTimeout(()=>setSavedToday(false),2500);
  };

  // ── Recipe ingredient search ──
  const doRecipeSearch=async()=>{
    if(!recipeSearchQ.trim())return;
    setRecipeSearchLoading(true);setRecipeSearchR([]);
    const r=await searchFood(recipeSearchQ);
    setRecipeSearchR(r);setRecipeSearchLoading(false);
  };
  const addIngredient=(item)=>{
    setRecipeIngredients(prev=>[...prev,{id:Date.now(),name:item.name,cal:item.cal,protein:item.protein||0,carbs:item.carbs||0,fat:item.fat||0}]);
  };
  const removeIngredient=(id)=>setRecipeIngredients(prev=>prev.filter(i=>i.id!==id));
  const recipeTotals=recipeIngredients.reduce((a,i)=>({cal:a.cal+i.cal,protein:a.protein+i.protein,carbs:a.carbs+i.carbs,fat:a.fat+i.fat}),{cal:0,protein:0,carbs:0,fat:0});

  // ── Search ──
  const doSearch=async()=>{
    if(!searchQ.trim())return;
    setSearchLoading(true);setSearchR([]);
    const r=await searchFood(searchQ);
    setSearchR(r);setSearchLoading(false);
    // Save to recent searches (max 10, most recent first, no duplicates)
    const updated=[searchQ.trim(),...recentSearches.filter(s=>s.toLowerCase()!==searchQ.trim().toLowerCase())].slice(0,10);
    setRecentSearches(updated);
    await ss("fp:recentsearches",updated);
  };

  // ── Suggestions ──
  const getSuggestions=async()=>{
    if(!targets)return;
    const t=sumE(entries);
    const rem={cal:Math.max(0,(targets.calories||0)-t.cal),protein:Math.max(0,(targets.protein||0)-t.protein),carbs:Math.max(0,(targets.carbs||0)-t.carbs),fat:Math.max(0,(targets.fat||0)-t.fat)};
    setSuggestLoading(true);setSuggestions([]);
    const s=await getMeals(rem,targets);
    setSuggestions(s);setSuggestLoading(false);
  };

  // ── Derived ──
  const totals=sumE(entries);
  const calLeft=(targets?.calories||0)-totals.cal;
  const tdee=targets?.tdee||0;
  const resolvedGoal=resolveGoal(defGoal,tdee);
  // actual deficit today
  const todayDeficit=tdee>0?tdee-totals.cal:null;

  // ── Apply theme ──
  const {C,pStyle,crd,iStyle,chipFn,btnFn}=useTheme(darkMode);

  const STYLES=`
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
    .fi{animation:fi 0.25s ease forwards}
    input::placeholder{color:${C.muted}}
    input:focus{border-color:${C.red}88 !important;box-shadow:0 0 0 3px ${C.red}11}
    input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
    input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.3)}
    ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:${C.bg}} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
    button:active{transform:scale(0.97)}
    *{transition:background 0.2s,color 0.2s,border-color 0.2s}
  `;

  // ─── Loading ──────────────────────────────────────────────────────────────
  if(screen==="loading") return(
    <div style={{...pStyle,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{STYLES}</style>
      <Spin/>&nbsp;<span style={{color:C.muted,fontSize:13}}>Loading…</span>
    </div>
  );

  // ─── Setup ────────────────────────────────────────────────────────────────
  if(screen==="setup") return(
    <div style={pStyle}>
      <style>{STYLES}</style>
      <div style={{padding:"24px 20px"}}>
        <div style={{marginBottom:32,paddingTop:24,textAlign:"center"}}>
          <div style={{display:"inline-block",background:"linear-gradient(135deg,#ff6b2b22,#7c5cfc22)",border:"1px solid #ff6b2b44",borderRadius:14,padding:"6px 16px",fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase",marginBottom:14}}>FUEL PROTOCOL</div>
          <div style={{fontSize:32,fontWeight:700,color:C.text,lineHeight:1.1,marginBottom:8}}>Set your<br/><span style={{color:C.red}}>targets</span></div>
          <div style={{fontSize:11,color:C.muted}}>Enter your details to calculate daily calorie and macro targets</div>
        </div>

        <div style={{marginBottom:6,fontSize:9,color:C.muted,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase"}}>Body Stats</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {[["weight","Weight (kg)","number"],["height","Height (cm)","number"],["age","Age (years)","number"]].map(([f,p,t])=>(
            <input key={f} type={t} placeholder={p} value={stats[f]} onChange={e=>setStats(s=>({...s,[f]:e.target.value}))} style={{...iStyle,gridColumn:f==="age"?"1 / -1":undefined}}/>
          ))}
        </div>

        <div style={{marginBottom:6,fontSize:9,color:C.muted,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase"}}>Biological Sex</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {[["male","♂ Male"],["female","♀ Female"]].map(([v,l])=>(
            <button key={v} onClick={()=>setStats(s=>({...s,sex:v}))} style={{...chipFn(stats.sex===v),padding:"11px 6px",fontSize:11}}>{l}</button>
          ))}
        </div>

        <div style={{marginBottom:6,fontSize:9,color:C.muted,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase"}}>Activity Level</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {[["sedentary","🪑 Sedentary","Desk job, little exercise"],["light","🚶 Light","1-3 days/week"],["moderate","🏃 Moderate","3-5 days/week"],["active","💪 Very Active","6-7 days/week"]].map(([v,l,sub])=>(
            <button key={v} onClick={()=>setStats(s=>({...s,activity:v}))} style={{...chipFn(stats.activity===v,C.cyan),padding:"10px 8px",textAlign:"left"}}>
              <div style={{fontSize:11}}>{l}</div>
              <div style={{fontSize:8,opacity:0.7,marginTop:2,fontWeight:400}}>{sub}</div>
            </button>
          ))}
        </div>

        <div style={{marginBottom:6,fontSize:9,color:C.muted,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase"}}>Your Goal</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:28}}>
          {[["lose","🔥","Lose Weight"],["lose-muscle","💪","Lose + Build"],["maintain","⚖️","Maintain"]].map(([v,icon,l])=>(
            <button key={v} onClick={()=>setStats(s=>({...s,goal:v}))} style={{...chipFn(stats.goal===v,C.violet),padding:"12px 6px",textAlign:"center"}}>
              <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
              <div style={{fontSize:9}}>{l}</div>
            </button>
          ))}
        </div>

        <button onClick={handleSetup} style={btnFn()}>Calculate My Targets →</button>
      </div>
    </div>
  );

  // ─── Main App ─────────────────────────────────────────────────────────────
  return(
    <div style={pStyle}>
      <style>{STYLES}</style>

      {/* ══ TODAY ══════════════════════════════════════════════════════════════ */}
      {nav==="tracker"&&(
        <div className="fi">
          {/* Header */}
          <div style={{padding:"18px 14px 0",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase"}}>FUEL PROTOCOL</div>
              <div style={{fontSize:19,fontWeight:700,color:C.text}}>{new Date().toLocaleDateString("en-AU",{weekday:"long",month:"short",day:"numeric"})}</div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {streak>0&&<div style={{background:C.subtle,border:`1px solid ${C.border}`,borderRadius:8,padding:"3px 9px",fontSize:11,color:C.red,fontWeight:700}}>🔥{streak}d</div>}
              <button onClick={async()=>{const d=!darkMode;setDarkMode(d);await ss("fp:darkmode",d);}}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:13,padding:"3px 8px",cursor:"pointer",lineHeight:1}}>
                {darkMode?"☀️":"🌙"}
              </button>
              <button onClick={()=>setScreen("setup")} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:11,padding:"4px 9px",cursor:"pointer"}}>⚙</button>
            </div>
          </div>

          {/* Calorie hero */}
          <div style={{padding:"10px 14px 0"}}>
            <div style={{...crd,background:darkMode?`linear-gradient(135deg,${C.card},${C.surface})`:`linear-gradient(135deg,#ffffff,#f8f8fa)`,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:-30,right:-30,width:140,height:140,borderRadius:"50%",background:calLeft<0?`rgba(232,55,42,${darkMode?0.08:0.05})`:`rgba(232,55,42,${darkMode?0.06:0.04})`,filter:"blur(30px)"}}/>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.15em",marginBottom:1}}>Calories Remaining</div>
              <div style={{fontSize:48,fontWeight:700,color:calLeft<0?C.red:C.red,lineHeight:1}}>{calLeft<0?"-":""}{Math.abs(calLeft)}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:1}}>{totals.cal} eaten · {targets?.calories} target · {tdee} TDEE</div>
              <div style={{display:"flex",gap:10,marginTop:14,justifyContent:"space-around"}}>
                <Ring value={totals.protein} max={targets?.protein||1} color={C.cyan} size={64} label={`${totals.protein}g`} sub="protein"/>
                <Ring value={totals.carbs} max={targets?.carbs||1} color={C.violet} size={64} label={`${totals.carbs}g`} sub="carbs"/>
                <Ring value={totals.fat} max={targets?.fat||1} color={C.green} size={64} label={`${totals.fat}g`} sub="fat"/>
              </div>
            </div>
          </div>

          {/* Macro bars */}
          <div style={{padding:"10px 14px 0"}}>
            <div style={crd}>
              <Bar label="Protein" current={totals.protein} max={targets?.protein||1} color={C.cyan}/>
              <Bar label="Carbs" current={totals.carbs} max={targets?.carbs||1} color={C.violet}/>
              <Bar label="Fat" current={totals.fat} max={targets?.fat||1} color={C.green}/>
            </div>
          </div>

          {/* Today deficit card */}
          {tdee>0&&totals.cal>0&&(()=>{
            const actual=todayDeficit;
            const isSurplus=actual<0;
            const goalD=resolvedGoal?.dailyDeficit||0;
            const gFat=Math.round(Math.abs(actual)/7.7);
            const kgWk=+((actual/7700)*7).toFixed(2);
            const pctOfGoal=goalD>0?Math.round((actual/goalD)*100):null;
            const defColor=isSurplus?C.red:actual<100?C.muted:actual>=goalD&&goalD>0?C.green:C.red;
            return(
              <div style={{padding:"10px 14px 0"}}>
                <div style={{...crd,border:`1px solid ${isSurplus?C.red+"44":actual>=(goalD||1)&&goalD>0?C.green+"44":C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Today's Deficit</div>
                    {resolvedGoal&&<div style={{fontSize:9,color:C.muted}}>Goal: −{resolvedGoal.dailyDeficit}kcal/day</div>}
                  </div>

                  <div style={{fontSize:36,fontWeight:700,color:defColor,lineHeight:1,marginBottom:2}}>
                    {isSurplus?"+":" −"}{Math.abs(actual).toLocaleString()}
                    <span style={{fontSize:13,fontWeight:400,color:C.muted}}> kcal</span>
                  </div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:12}}>{totals.cal} eaten vs {tdee} TDEE</div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:pctOfGoal!=null?12:0}}>
                    <Tile label="Fat today" value={isSurplus?`+${gFat}g`:`~${gFat}g`} color={defColor}/>
                    <Tile label="Pace /wk" value={isSurplus?`+${Math.abs(kgWk)}kg`:`−${Math.abs(kgWk)}kg`} color={defColor}/>
                    <Tile label="Pace /mo" value={isSurplus?`+${Math.abs(+(kgWk*4).toFixed(1))}kg`:`−${+(Math.abs(kgWk)*4).toFixed(1)}kg`} color={defColor}/>
                  </div>

                  {pctOfGoal!=null&&(
                    <>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.muted,marginBottom:4}}>
                        <span>vs your goal deficit</span>
                        <span style={{color:defColor,fontWeight:700}}>{pctOfGoal}%</span>
                      </div>
                      <div style={{height:6,borderRadius:99,background:C.subtle,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(Math.max(pctOfGoal,0),100)}%`,borderRadius:99,background:isSurplus?C.red:pctOfGoal>=100?C.green:C.red,transition:"width 0.5s"}}/>
                      </div>
                      <div style={{fontSize:9,color:C.muted,marginTop:5}}>
                        {isSurplus?"⚠️ Surplus today — tap Goals to adjust your plan":pctOfGoal>=100?"✅ Deficit goal hit!":pctOfGoal>=60?"💪 Good progress, keep going":"📉 Under goal — room to tighten up"}
                      </div>
                    </>
                  )}
                  {pctOfGoal==null&&(
                    <div style={{fontSize:9,color:C.muted,marginTop:4}}>
                      💡 <span style={{color:C.violet,cursor:"pointer"}} onClick={()=>setNav("goals")}>Set a deficit goal →</span> to track progress here
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Water */}
          <div style={{padding:"10px 14px 0"}}>
            <div style={{...crd,display:"flex",alignItems:"center",gap:14}}>
              <WaterRing ml={water}/>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Hydration</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5}}>
                  {[150,250,500].map(ml=>(<button key={ml} onClick={()=>saveWater(water+ml)} style={{...chipFn(false,C.cyan),fontSize:10}}>+{ml}ml</button>))}
                  <button onClick={()=>saveWater(Math.max(0,water-250))} style={{...chipFn(false,C.muted),gridColumn:"1/3",fontSize:10}}>−250ml</button>
                  <button onClick={()=>saveWater(0)} style={{...chipFn(false,C.red),fontSize:9}}>Reset</button>
                </div>
              </div>
            </div>
          </div>

          {/* Meal suggestions */}
          <div style={{padding:"10px 14px 0"}}>
            <div style={crd}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Meal Suggestions</div>
                <button onClick={getSuggestions} disabled={suggestLoading} style={{background:C.subtle,border:`1px solid ${C.border}`,borderRadius:8,color:C.red,fontSize:11,padding:"5px 11px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:700}}>
                  {suggestLoading?<Spin col={C.red}/>:"✨ Suggest"}
                </button>
              </div>
              {suggestions.length>0?suggestions.map((s,i)=>(
                <div key={i} style={{background:C.subtle,borderRadius:10,padding:"10px 11px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:1}}>{s.name}</div>
                      <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{s.description}</div>
                      <div style={{fontSize:10}}><span style={{color:C.red}}>{s.cal}cal</span> · <span style={{color:C.cyan}}>{s.protein}g pro</span> · <span style={{color:C.violet}}>{s.carbs}g carbs</span> · <span style={{color:C.green}}>{s.fat}g fat</span></div>
                      {s.tip&&<div style={{fontSize:10,color:C.violet,marginTop:3}}>💡 {s.tip}</div>}
                    </div>
                    <button onClick={()=>addFood({name:s.name,cal:s.cal,protein:s.protein,carbs:s.carbs,fat:s.fat})} style={{background:C.red,border:"none",borderRadius:8,color:"#fff",fontSize:11,padding:"5px 10px",cursor:"pointer",fontFamily:"'DM Mono',monospace",marginLeft:8,flexShrink:0}}>+ Add</button>
                  </div>
                </div>
              )):<div style={{textAlign:"center",color:C.muted,fontSize:11,padding:"10px 0"}}>Tap Suggest for AI meal ideas based on your remaining macros</div>}
            </div>
          </div>

          {/* Log food */}
          <div style={{padding:"10px 14px 0"}}>
            <div style={crd}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Log Food</div>
                {templates.length>0&&<button onClick={()=>setShowTpl(v=>!v)} style={{background:C.subtle,border:`1px solid ${C.border}`,borderRadius:8,color:C.violet,fontSize:10,padding:"4px 9px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:700}}>📋 {showTpl?"Hide":"Templates"}</button>}
              </div>
              {showTpl&&(
                <div style={{marginBottom:10}}>
                  {templates.map(t=>(
                    <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.subtle,borderRadius:8,padding:"8px 10px",marginBottom:5,border:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:C.text}}>{t.name}</div>
                        <div style={{fontSize:10,color:C.muted}}>{t.cal}cal · {t.protein}g pro · {t.carbs}g carbs · {t.fat}g fat</div>
                      </div>
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={()=>addFood(t)} style={{background:C.red,border:"none",borderRadius:6,color:"#fff",fontSize:11,padding:"4px 8px",cursor:"pointer"}}>+</button>
                        <button onClick={()=>removeTpl(t.id)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.red,fontSize:11,padding:"4px 8px",cursor:"pointer"}}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input placeholder="Food name" value={newFood.name} onChange={e=>setNewFood(p=>({...p,name:e.target.value}))} style={{...iStyle,marginBottom:7}}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                {[["cal","Cals"],["protein","Pro"],["carbs","Carbs"],["fat","Fat"]].map(([f,p])=>(
                  <input key={f} type="number" placeholder={p} value={newFood[f]} onChange={e=>setNewFood(prev=>({...prev,[f]:e.target.value}))} style={{...iStyle,fontSize:11}}/>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                <button onClick={addFromForm} style={btnFn()}>+ Add</button>
                <button onClick={()=>{if(!newFood.name||!newFood.cal)return;saveTpl({name:newFood.name,cal:parseInt(newFood.cal)||0,protein:parseInt(newFood.protein)||0,carbs:parseInt(newFood.carbs)||0,fat:parseInt(newFood.fat)||0});}} style={btnFn(C.violet)}>💾 Template</button>
              </div>
            </div>
          </div>

          {/* Today's log */}
          <div style={{padding:"10px 14px 0"}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Today's Log · {entries.length} items</div>
            {entries.length===0&&<div style={{textAlign:"center",color:C.border,padding:"20px 0",fontSize:12}}>No food logged yet. Add your first meal above!</div>}
            {[...entries].reverse().map(e=>(
              <div key={e.id} style={{...crd,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,padding:"10px 12px"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{e.name}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                    <span style={{color:C.red}}>{e.cal}cal</span>
                    {e.protein>0&&<span> · <span style={{color:C.cyan}}>{e.protein}g pro</span></span>}
                    {e.carbs>0&&<span> · {e.carbs}g carbs</span>}
                    {e.fat>0&&<span> · {e.fat}g fat</span>}
                    <span> · {e.time}</span>
                  </div>
                </div>
                <button onClick={()=>removeFood(e.id,e.name)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:14,padding:"4px 6px"}}>✕</button>
              </div>
            ))}
          </div>

          {/* Save Day */}
          <div style={{padding:"10px 14px 16px"}}>
            <button onClick={saveDay}
              style={{...btnFn(savedToday?C.green:C.red),transition:"all 0.3s"}}>
              {savedToday?"✅ Saved!":"💾 Save Today's Log"}
            </button>
            <div style={{fontSize:9,color:C.muted,textAlign:"center",marginTop:6}}>
              Saves your current entries to the 📅 Logs tab · Tomorrow starts a fresh day automatically
            </div>
          </div>
        </div>
      )}

      {/* ══ SEARCH ══════════════════════════════════════════════════════════════ */}
      {nav==="search"&&(
        <div className="fi" style={{padding:"18px 14px"}}>
          <div style={{fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>FUEL PROTOCOL</div>
          <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:10}}>Search & Build</div>

          {/* Mode tabs */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <button onClick={()=>setSearchMode("search")} style={{...chipFn(searchMode==="search",C.red),padding:"10px 8px",fontSize:11}}>
              🔍 Food Search
            </button>
            <button onClick={()=>setSearchMode("recipe")} style={{...chipFn(searchMode==="recipe",C.violet),padding:"10px 8px",fontSize:11}}>
              🍳 Recipe Builder
            </button>
          </div>

          {/* ── FOOD SEARCH MODE ── */}
          {searchMode==="search"&&(
            <>
              <div style={{fontSize:10,color:C.muted,marginBottom:12}}>Coles · Woolworths · Aldi · Fast food · Uber Eats — AI powered</div>
              <div style={{display:"flex",gap:7,marginBottom:14}}>
                <input placeholder="e.g. Coles chicken breast, Big Mac…" value={searchQ} onChange={e=>setSearchQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()} style={{...iStyle,flex:1}}/>
                <button onClick={doSearch} disabled={searchLoading} style={{...btnFn(),width:"auto",padding:"10px 14px",flexShrink:0}}>{searchLoading?<Spin/>:"Go"}</button>
              </div>
              <div style={{marginBottom:14}}>
                {recentSearches.length>0?(
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{fontSize:9,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase"}}>Recent Searches</div>
                      <button onClick={async()=>{setRecentSearches([]);await ss("fp:recentsearches",[]);}} style={{background:"none",border:"none",color:C.muted,fontSize:9,cursor:"pointer",padding:0}}>Clear all</button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {recentSearches.map(q=>(
                        <button key={q} onClick={()=>setSearchQ(q)} style={{...chipFn(searchQ===q,C.cyan),padding:"5px 9px",fontSize:10}}>{q}</button>
                      ))}
                    </div>
                  </>
                ):(
                  <>
                    <div style={{fontSize:9,color:C.muted,marginBottom:6,letterSpacing:"0.08em",textTransform:"uppercase"}}>Suggested searches</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {["Big Mac","Coles Greek Yoghurt","Woolworths chicken breast","Aldi protein bar","Subway footlong","KFC Original Piece","Boost Mango","Weet-Bix"].map(q=>(
                        <button key={q} onClick={()=>setSearchQ(q)} style={{...chipFn(searchQ===q,C.cyan),padding:"5px 9px",fontSize:10}}>{q}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {searchLoading&&<div style={{textAlign:"center",padding:"28px 0",color:C.muted,fontSize:12}}><Spin col={C.red}/><br/><span style={{display:"block",marginTop:8}}>Searching nutrition data…</span></div>}
              {searchR.map((r,i)=>(
                <div key={i} style={{...crd,marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.text}}>{r.name}</div>
                      {r.brand&&<div style={{fontSize:10,color:C.red,marginBottom:1}}>{r.brand}</div>}
                      {r.serving&&<div style={{fontSize:10,color:C.muted,marginBottom:6}}>per {r.serving}</div>}
                      <div style={{display:"flex",gap:10,fontSize:11,flexWrap:"wrap"}}>
                        <span style={{color:C.red,fontWeight:700}}>{r.cal}cal</span>
                        <span style={{color:C.cyan}}>{r.protein}g pro</span>
                        <span style={{color:C.violet}}>{r.carbs}g carbs</span>
                        <span style={{color:C.green}}>{r.fat}g fat</span>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginLeft:10}}>
                      <button onClick={()=>addFood({name:r.name,cal:r.cal,protein:r.protein,carbs:r.carbs,fat:r.fat})} style={{background:C.red,border:"none",borderRadius:8,color:"#fff",fontSize:11,padding:"6px 11px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontWeight:700}}>+ Log</button>
                      <button onClick={()=>saveTpl({name:r.name,cal:r.cal,protein:r.protein,carbs:r.carbs,fat:r.fat})} style={{background:C.subtle,border:`1px solid ${C.border}`,borderRadius:8,color:C.violet,fontSize:10,padding:"5px 8px",cursor:"pointer",fontFamily:"'DM Mono',monospace"}}>💾 Save</button>
                    </div>
                  </div>
                </div>
              ))}
              {!searchLoading&&searchR.length===0&&searchQ&&<div style={{textAlign:"center",color:C.muted,fontSize:12,padding:"20px 0"}}>No results — tap Go to search!</div>}
              {!searchLoading&&searchR.length===0&&!searchQ&&<div style={{textAlign:"center",color:C.border,fontSize:12,padding:"28px 0"}}>Search any food to get full nutrition info</div>}
            </>
          )}

          {/* ── RECIPE BUILDER MODE ── */}
          {searchMode==="recipe"&&(
            <>
              {/* Recipe name */}
              <div style={{...crd,marginBottom:10,border:`1px solid ${C.violet}44`}}>
                <div style={{fontSize:10,color:C.violet,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Recipe Name</div>
                <input placeholder="e.g. Chicken Stir Fry, Protein Smoothie…" value={recipeName} onChange={e=>setRecipeName(e.target.value)} style={iStyle}/>
              </div>

              {/* Search ingredients */}
              <div style={{...crd,marginBottom:10}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Search Ingredients</div>
                <div style={{display:"flex",gap:7,marginBottom:8}}>
                  <input placeholder="e.g. chicken breast, brown rice…" value={recipeSearchQ} onChange={e=>setRecipeSearchQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doRecipeSearch()} style={{...iStyle,flex:1}}/>
                  <button onClick={doRecipeSearch} disabled={recipeSearchLoading} style={{...btnFn(C.cyan),width:"auto",padding:"10px 12px",flexShrink:0}}>{recipeSearchLoading?<Spin col={C.cyan}/>:"Find"}</button>
                </div>
                {recipeSearchLoading&&<div style={{textAlign:"center",padding:"12px 0",color:C.muted,fontSize:11}}><Spin col={C.cyan}/> Searching…</div>}
                {recipeSearchR.map((r,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.subtle,borderRadius:9,padding:"9px 11px",marginBottom:5,border:`1px solid ${C.border}`}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.text}}>{r.name}</div>
                      <div style={{fontSize:10,color:C.muted}}><span style={{color:C.red}}>{r.cal}cal</span> · <span style={{color:C.cyan}}>{r.protein}g pro</span> · {r.carbs}g carbs · {r.fat}g fat</div>
                    </div>
                    <button onClick={()=>{addIngredient(r);setRecipeSearchR([]);setRecipeSearchQ("");}}
                      style={{background:C.violet,border:"none",borderRadius:7,color:"#fff",fontSize:11,padding:"5px 10px",cursor:"pointer",fontFamily:"'DM Mono',monospace",marginLeft:8,flexShrink:0}}>+ Add</button>
                  </div>
                ))}
              </div>

              {/* Manual ingredient entry */}
              <div style={{...crd,marginBottom:10}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Or Enter Manually</div>
                <input placeholder="Ingredient name" value={recipeManual.name} onChange={e=>setRecipeManual(p=>({...p,name:e.target.value}))} style={{...iStyle,marginBottom:7}}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                  {[["cal","Cals"],["protein","Pro"],["carbs","Carbs"],["fat","Fat"]].map(([f,p])=>(
                    <input key={f} type="number" placeholder={p} value={recipeManual[f]||""} onChange={e=>setRecipeManual(prev=>({...prev,[f]:e.target.value}))} style={{...iStyle,fontSize:11}}/>
                  ))}
                </div>
                <button onClick={()=>{
                  if(!recipeManual.name||!recipeManual.cal) return;
                  addIngredient({name:recipeManual.name,cal:parseInt(recipeManual.cal)||0,protein:parseInt(recipeManual.protein)||0,carbs:parseInt(recipeManual.carbs)||0,fat:parseInt(recipeManual.fat)||0});
                  setRecipeManual({name:"",cal:"",protein:"",carbs:"",fat:""});
                }} style={btnFn(C.violet)}>+ Add Ingredient</button>
              </div>

              {/* Ingredients list + totals */}
              {recipeIngredients.length>0&&(
                <div style={{...crd,marginBottom:10,border:`1px solid ${C.violet}33`}}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>
                    Ingredients · {recipeIngredients.length} items
                  </div>
                  {recipeIngredients.map((ing)=>(
                    <div key={ing.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.subtle,borderRadius:8,padding:"8px 10px",marginBottom:5,border:`1px solid ${C.border}`}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.text}}>{ing.name}</div>
                        <div style={{fontSize:10,color:C.muted}}><span style={{color:C.red}}>{ing.cal}cal</span>{ing.protein>0&&<span> · <span style={{color:C.cyan}}>{ing.protein}g pro</span></span>}{ing.carbs>0&&<span> · {ing.carbs}g carbs</span>}{ing.fat>0&&<span> · {ing.fat}g fat</span>}</div>
                      </div>
                      <button onClick={()=>removeIngredient(ing.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:14,padding:"2px 6px",marginLeft:6}}>✕</button>
                    </div>
                  ))}
                  {/* Totals */}
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Recipe Totals</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                      {[{l:"Calories",v:`${recipeTotals.cal}`,c:C.red},{l:"Protein",v:`${recipeTotals.protein}g`,c:C.cyan},{l:"Carbs",v:`${recipeTotals.carbs}g`,c:C.violet},{l:"Fat",v:`${recipeTotals.fat}g`,c:C.green}].map((x,i)=>(
                        <div key={i} style={{background:C.bg,borderRadius:8,padding:"7px 6px",textAlign:"center",border:`1px solid ${C.border}`}}>
                          <div style={{fontSize:8,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{x.l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:x.c}}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {recipeIngredients.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <button onClick={async()=>{
                    const name=recipeName||"My Recipe";
                    await addFood({name,cal:recipeTotals.cal,protein:recipeTotals.protein,carbs:recipeTotals.carbs,fat:recipeTotals.fat});
                    setRecipeIngredients([]);setRecipeName("");setRecipeSearchR([]);
                    setSearchMode("search");setNav("tracker");
                  }} style={btnFn(C.red)}>+ Log as Meal</button>
                  <button onClick={async()=>{
                    const name=recipeName||"My Recipe";
                    await saveTpl({name,cal:recipeTotals.cal,protein:recipeTotals.protein,carbs:recipeTotals.carbs,fat:recipeTotals.fat});
                    setRecipeIngredients([]);setRecipeName("");setRecipeSearchR([]);
                    alert(`"${name}" saved as a template!`);
                  }} style={btnFn(C.violet)}>💾 Save as Template</button>
                </div>
              )}
              {recipeIngredients.length===0&&<div style={{textAlign:"center",color:C.border,fontSize:12,padding:"20px 0"}}>Search or manually enter ingredients above to build your recipe</div>}
            </>
          )}
        </div>
      )}

      {/* ══ GOALS ═══════════════════════════════════════════════════════════════ */}
      {nav==="goals"&&(
        <div className="fi" style={{padding:"18px 14px"}}>
          <div style={{fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>FUEL PROTOCOL</div>
          <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:4}}>Deficit Goals</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:16}}>Set a loss rate or a target by a date — the app calculates your required daily deficit.</div>

          {/* Mode toggle */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <button onClick={()=>setDgDraft(d=>({...d,mode:"rate"}))} style={chipFn(dgDraft.mode==="rate",C.red)}>📉 Loss Rate</button>
            <button onClick={()=>setDgDraft(d=>({...d,mode:"date"}))} style={chipFn(dgDraft.mode==="date",C.violet)}>📅 Target Date</button>
          </div>

          {/* Rate mode */}
          {dgDraft.mode==="rate"&&(
            <div style={{...crd,marginBottom:12}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Weekly Loss Rate</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:12}}>
                {[0.25,0.5,0.75,1.0].map(v=>(
                  <button key={v} onClick={()=>setDgDraft(d=>({...d,kgPerWeek:String(v)}))}
                    style={{...chipFn(parseFloat(dgDraft.kgPerWeek)===v,C.red),padding:"10px 4px",fontSize:11}}>
                    {v}kg<br/><span style={{fontSize:8,fontWeight:400}}>/ wk</span>
                  </button>
                ))}
                {[1.25,1.5,1.75,2.0].map(v=>(
                  <button key={v} onClick={()=>setDgDraft(d=>({...d,kgPerWeek:String(v)}))}
                    style={{...chipFn(parseFloat(dgDraft.kgPerWeek)===v,C.red),padding:"10px 4px",fontSize:11}}>
                    {v}kg<br/><span style={{fontSize:8,fontWeight:400}}>/ wk</span>
                  </button>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={{fontSize:10,color:C.muted,flexShrink:0}}>Custom:</span>
                <input type="number" placeholder="e.g. 0.8" value={dgDraft.kgPerWeek} onChange={e=>setDgDraft(d=>({...d,kgPerWeek:e.target.value}))} style={{...iStyle,flex:1}}/>
                <span style={{fontSize:10,color:C.muted,flexShrink:0}}>kg/wk</span>
              </div>
              <div style={{marginTop:12}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Also set a total target (optional):</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input type="number" placeholder="e.g. 10" value={dgDraft.targetKg} onChange={e=>setDgDraft(d=>({...d,targetKg:e.target.value}))} style={{...iStyle,flex:1}}/>
                  <span style={{fontSize:10,color:C.muted,flexShrink:0}}>kg to lose</span>
                </div>
              </div>
            </div>
          )}

          {/* Date mode */}
          {dgDraft.mode==="date"&&(
            <div style={{...crd,marginBottom:12}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Target by a Date</div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:5}}>How much do you want to lose?</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input type="number" placeholder="e.g. 5" value={dgDraft.targetKg} onChange={e=>setDgDraft(d=>({...d,targetKg:e.target.value}))} style={{...iStyle,flex:1}}/>
                  <span style={{fontSize:10,color:C.muted,flexShrink:0}}>kg</span>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:5}}>By when?</div>
                <input type="date" min={minDate()} value={dgDraft.targetDate} onChange={e=>setDgDraft(d=>({...d,targetDate:e.target.value}))} style={iStyle}/>
                {/* Quick date presets */}
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                  {[["1 month",30],["3 months",90],["6 months",180],["1 year",365]].map(([l,days])=>{
                    const d=new Date();d.setDate(d.getDate()+days);
                    const v=d.toISOString().slice(0,10);
                    return <button key={l} onClick={()=>setDgDraft(dr=>({...dr,targetDate:v}))} style={{...chipFn(dgDraft.targetDate===v,C.violet),padding:"5px 10px",fontSize:10}}>{l}</button>;
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Live preview */}
          {(()=>{
            const preview=resolveGoal(dgDraft,tdee);
            if(!preview||!tdee) return(
              <div style={{...crd,marginBottom:12,textAlign:"center",color:C.muted,fontSize:11,padding:"18px"}}>
                Complete your profile in ⚙ Settings to see calorie targets
              </div>
            );
            const safe=safetyLabel(preview.calsPerDay);
            const isSurplus=preview.calsPerDay<0;
            return(
              <div style={{...crd,marginBottom:12,border:`1px solid ${safe?C.red+"55":C.green+"44"}`}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>📊 Live Preview</div>

                {/* Big calorie target */}
                <div style={{textAlign:"center",marginBottom:14,padding:"14px",background:C.subtle,borderRadius:12}}>
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Daily Calorie Target</div>
                  <div style={{fontSize:40,fontWeight:700,color:isSurplus?C.red:C.red,lineHeight:1}}>{Math.max(preview.calsPerDay,0).toLocaleString()}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:3}}>−{preview.dailyDeficit.toLocaleString()} kcal deficit · {tdee} TDEE</div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:safe?10:0}}>
                  <Tile label="Loss per week" value={`−${preview.kgPerWeek}kg`} color={C.green} sub="7,700kcal = 1kg"/>
                  <Tile label="Loss per month" value={`−${+(preview.kgPerWeek*4).toFixed(1)}kg`} color={C.green}/>
                  {preview.daysLeft!=null&&<Tile label="Days remaining" value={preview.daysLeft} color={C.cyan} sub={`to ${fmtDate(preview.arrivalDate)}`}/>}
                  {preview.totalKg&&<Tile label="Total to lose" value={`${preview.totalKg}kg`} color={C.violet} sub={preview.weeksTo?`~${preview.weeksTo} wks`:""}/>}
                  {preview.weeksTo&&<Tile label="Estimated done" value={preview.arrivalDate||"—"} color={C.cyan}/>}
                  {preview.daysLeft==null&&!preview.weeksTo&&<Tile label="Daily deficit" value={`−${preview.dailyDeficit}kcal`} color={C.red}/>}
                </div>

                {safe&&(
                  <div style={{padding:"8px 10px",background:`${C.red}18`,borderRadius:8,border:`1px solid ${C.red}44`,fontSize:10,color:safe.color,marginTop:10}}>
                    {safe.text}
                  </div>
                )}
              </div>
            );
          })()}

          <button onClick={async()=>{
            await saveDefGoal(dgDraft);
            setTimeout(()=>setNav("tracker"),300);
          }} style={btnFn()}>✅ Save Goal & Update Today</button>

          {defGoal&&(
            <button onClick={async()=>{setDefGoal(null);setDgDraft({mode:"rate",kgPerWeek:"0.5",targetKg:"",targetDate:""});await ss("fp:deficitgoal",null);}}
              style={{...btnFn(C.subtle),marginTop:8,color:C.red,border:`1px solid ${C.border}`}}>
              🗑 Clear Goal
            </button>
          )}

          {/* How it works */}
          <div style={{...crd,marginTop:14}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>How it works</div>
            <div style={{fontSize:10,color:C.muted,lineHeight:1.7}}>
              <div>• <span style={{color:C.text}}>1 kg of fat ≈ 7,700 kcal</span></div>
              <div>• To lose 0.5kg/week you need a −550kcal/day deficit</div>
              <div>• To lose 1kg/week you need a −1,100kcal/day deficit</div>
              <div>• Safe range is generally 0.25–1kg/week</div>
              <div>• Never go below 1,000–1,200 kcal/day</div>
              <div>• Your deficit = TDEE ({tdee||"?"} kcal) minus calories eaten</div>
              <div style={{marginTop:6,color:C.border}}>Estimates only. Consult a health professional for medical advice.</div>
            </div>
          </div>
        </div>
      )}

      {/* ══ WEIGHT ══════════════════════════════════════════════════════════════ */}
      {nav==="weight"&&(
        <div className="fi" style={{padding:"18px 14px"}}>
          <div style={{fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>FUEL PROTOCOL</div>
          <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:14}}>Weight Log</div>
          <div style={{...crd,marginBottom:12}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:9}}>Log Today's Weight</div>
            <div style={{display:"flex",gap:7}}>
              <input type="number" placeholder="e.g. 75.5" value={newW} onChange={e=>setNewW(e.target.value)} style={{...iStyle,flex:1}}/>
              <span style={{color:C.muted,lineHeight:"40px",fontSize:13}}>kg</span>
              <button onClick={logWeight} style={{...btnFn(),width:"auto",padding:"10px 14px"}}>Log</button>
            </div>
          </div>

          {/* Trend + goal overlay */}
          {wLog.length>1&&(()=>{
            const recent=wLog.slice(-14);
            const minW=Math.min(...recent.map(x=>x.kg));
            const maxW=Math.max(...recent.map(x=>x.kg));
            const range=maxW-minW||0.1;
            const W=370,H=80,pd=8;
            const first=wLog[0].kg,last=wLog[wLog.length-1].kg,diff=+(last-first).toFixed(1);
            const pts=recent.map((x,i)=>{const px=pd+(i/(recent.length-1||1))*(W-pd*2);const py=H-pd-(((x.kg-minW)/range)*(H-pd*2));return`${px},${py}`;}).join(" ");
            const apts=recent.map((x,i)=>{const px=pd+(i/(recent.length-1||1))*(W-pd*2);const py=H-pd-(((x.kg-minW)/range)*(H-pd*2));return`${px},${py}`;});
            return(
              <div style={{...crd,marginBottom:12}}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Trend</div>
                <div style={{display:"flex",gap:16,marginBottom:10}}>
                  <div><div style={{fontSize:9,color:C.muted}}>Current</div><div style={{fontSize:18,fontWeight:700,color:C.red}}>{last}kg</div></div>
                  <div><div style={{fontSize:9,color:C.muted}}>Change</div><div style={{fontSize:18,fontWeight:700,color:diff<0?C.green:diff>0?C.red:C.muted}}>{diff>0?"+":""}{diff}kg</div></div>
                  {resolvedGoal?.totalKg&&<div><div style={{fontSize:9,color:C.muted}}>Goal loss</div><div style={{fontSize:18,fontWeight:700,color:C.violet}}>−{resolvedGoal.totalKg}kg</div></div>}
                </div>
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
                  <defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.red} stopOpacity="0.15"/><stop offset="100%" stopColor={C.red} stopOpacity="0"/></linearGradient></defs>
                  <polygon points={`${pd},${H} ${apts.join(" ")} ${W-pd},${H}`} fill="url(#og)"/>
                  <polyline points={pts} fill="none" stroke={C.red} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                  {recent.map((x,i)=>{const px=pd+(i/(recent.length-1||1))*(W-pd*2);const py=H-pd-(((x.kg-minW)/range)*(H-pd*2));return<circle key={i} cx={px} cy={py} r={3.5} fill={C.red}/>;})}
                </svg>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.muted,marginTop:4}}>
                  <span>{fmtDate(recent[0].date)}</span><span>{fmtDate(recent[recent.length-1].date)}</span>
                </div>
                {resolvedGoal?.totalKg&&last&&(()=>{
                  const targetW=first-resolvedGoal.totalKg;
                  const done=Math.max(0,first-last);
                  const pctDone=Math.round((done/resolvedGoal.totalKg)*100);
                  return(
                    <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.muted,marginBottom:4}}>
                        <span>Goal progress: {done.toFixed(1)}kg / {resolvedGoal.totalKg}kg lost</span>
                        <span style={{color:C.violet,fontWeight:700}}>{pctDone}%</span>
                      </div>
                      <div style={{height:5,borderRadius:99,background:C.subtle,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(pctDone,100)}%`,borderRadius:99,background:C.violet,transition:"width 0.5s"}}/>
                      </div>
                      <div style={{fontSize:9,color:C.muted,marginTop:3}}>Target: {targetW.toFixed(1)}kg</div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:7}}>All Entries</div>
          {wLog.length===0&&<div style={{textAlign:"center",color:C.border,fontSize:12,padding:"20px 0"}}>No weight entries yet</div>}
          {[...wLog].reverse().map((w,i)=>(
            <div key={i} style={{...crd,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px"}}>
              <span style={{fontSize:12,color:C.muted}}>{fmtDate(w.date)}</span>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:14,fontWeight:700,color:C.red}}>{w.kg} kg</span>
                <button onClick={async()=>{if(!window.confirm(`Remove ${w.kg}kg entry for ${fmtDate(w.date)}?`))return;const updated=wLog.filter((_,idx)=>idx!==(wLog.length-1-i));setWLog(updated);await ss("fp:weights",updated);}} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.red,fontSize:11,padding:"3px 8px",cursor:"pointer"}}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ HISTORY / DAY LOGS ═══════════════════════════════════════════════════ */}
      {nav==="history"&&(
        <div className="fi" style={{padding:"18px 14px"}}>
          <div style={{fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>FUEL PROTOCOL</div>
          <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:4}}>Day Logs</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:14}}>Every day you log food is automatically saved here</div>
          {dayDetail?(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <button onClick={()=>{setDayDetail(null);setEditMode(false);}} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:11,padding:"5px 11px",cursor:"pointer"}}>← Back</button>
                <button onClick={()=>setEditMode(v=>!v)} style={{background:editMode?C.red+"22":"none",border:`1px solid ${editMode?C.red:C.border}`,borderRadius:8,color:editMode?C.red:C.muted,fontSize:11,padding:"5px 11px",cursor:"pointer",fontWeight:editMode?700:400}}>
                  {editMode?"✅ Done Editing":"✏️ Edit Day"}
                </button>
              </div>
              <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:10}}>{fmtLong(dayDetail.key)}</div>
              <div style={{...crd,marginBottom:10}}>
                <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:2}}>Total Calories</div>
                <div style={{fontSize:38,fontWeight:700,color:C.red,lineHeight:1}}>{dayDetail.totals.cal}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>target: {targets?.calories} · {Math.round((dayDetail.totals.cal/(targets?.calories||1))*100)}% of goal</div>
                <div style={{height:5,borderRadius:99,background:C.subtle,overflow:"hidden",marginTop:8,marginBottom:12}}>
                  <div style={{height:"100%",width:`${Math.min((dayDetail.totals.cal/(targets?.calories||1))*100,100)}%`,borderRadius:99,background:dayDetail.totals.cal>(targets?.calories||0)?C.red:C.red}}/>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"space-around"}}>
                  <Ring value={dayDetail.totals.protein} max={targets?.protein||1} color={C.cyan} size={62} label={`${dayDetail.totals.protein}g`} sub="protein"/>
                  <Ring value={dayDetail.totals.carbs} max={targets?.carbs||1} color={C.violet} size={62} label={`${dayDetail.totals.carbs}g`} sub="carbs"/>
                  <Ring value={dayDetail.totals.fat} max={targets?.fat||1} color={C.green} size={62} label={`${dayDetail.totals.fat}g`} sub="fat"/>
                </div>
                {/* Water summary */}
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>💧</span>
                    <div>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Water</div>
                      <div style={{fontSize:16,fontWeight:700,color:C.cyan}}>{Math.round((dayDetail.water||0)/100)/10}L <span style={{fontSize:10,color:C.muted,fontWeight:400}}>/ {WATER_GOAL/1000}L</span></div>
                    </div>
                  </div>
                  <div style={{height:6,borderRadius:99,background:C.subtle,overflow:"hidden",flex:1,marginLeft:12}}>
                    <div style={{height:"100%",width:`${Math.min(((dayDetail.water||0)/WATER_GOAL)*100,100)}%`,borderRadius:99,background:C.cyan,transition:"width 0.4s"}}/>
                  </div>
                </div>
                {/* Edit water in edit mode */}
                {editMode&&(
                  <div style={{marginTop:10}}>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Edit Water Intake</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {[150,250,500].map(ml=>(
                        <button key={ml} onClick={async()=>{
                          const updated=(dayDetail.water||0)+ml;
                          await ss(`fp:water:${dayDetail.key}`,updated);
                          setDayDetail({...dayDetail,water:updated});
                        }} style={{...chipFn(false,C.cyan),padding:"6px 10px",fontSize:10}}>+{ml}ml</button>
                      ))}
                      <button onClick={async()=>{
                        const updated=Math.max(0,(dayDetail.water||0)-250);
                        await ss(`fp:water:${dayDetail.key}`,updated);
                        setDayDetail({...dayDetail,water:updated});
                      }} style={{...chipFn(false,C.muted),padding:"6px 10px",fontSize:10}}>−250ml</button>
                      <button onClick={async()=>{
                        await ss(`fp:water:${dayDetail.key}`,0);
                        setDayDetail({...dayDetail,water:0});
                      }} style={{...chipFn(false,C.red),padding:"6px 10px",fontSize:10}}>Reset</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Add food in edit mode */}
              {editMode&&(
                <div style={{...crd,marginBottom:10,border:`1px solid ${C.red}44`}}>
                  <div style={{fontSize:10,color:C.red,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Add Food to This Day</div>
                  <input placeholder="Food name" value={editFood.name} onChange={e=>setEditFood(p=>({...p,name:e.target.value}))} style={{...iStyle,marginBottom:7}}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                    {[["cal","Cals"],["protein","Pro"],["carbs","Carbs"],["fat","Fat"]].map(([f,p])=>(
                      <input key={f} type="number" placeholder={p} value={editFood[f]} onChange={e=>setEditFood(prev=>({...prev,[f]:e.target.value}))} style={{...iStyle,fontSize:11}}/>
                    ))}
                  </div>
                  <button onClick={async()=>{
                    if(!editFood.name||!editFood.cal) return;
                    const newEntry={id:Date.now(),name:editFood.name,cal:parseInt(editFood.cal)||0,protein:parseInt(editFood.protein)||0,carbs:parseInt(editFood.carbs)||0,fat:parseInt(editFood.fat)||0,time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})};
                    const updated=[...dayDetail.entries,newEntry];
                    await ss(`fp:day:${dayDetail.key}`,updated);
                    setDayDetail({...dayDetail,entries:updated,totals:sumE(updated)});
                    setEditFood({name:"",cal:"",protein:"",carbs:"",fat:""});
                  }} style={btnFn()}>+ Add to This Day</button>
                </div>
              )}

              <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>{dayDetail.entries.length} items logged</div>
              {dayDetail.entries.length===0&&<div style={{textAlign:"center",color:C.border,fontSize:12,padding:"16px 0"}}>Nothing logged this day</div>}
              {[...dayDetail.entries].map((e,i)=>(
                <div key={i} style={{...crd,marginBottom:6,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.text}}>{e.name}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                        <span style={{color:C.red,fontWeight:700}}>{e.cal}cal</span>
                        {e.protein>0&&<span> · <span style={{color:C.cyan}}>{e.protein}g pro</span></span>}
                        {e.carbs>0&&<span> · <span style={{color:C.violet}}>{e.carbs}g carbs</span></span>}
                        {e.fat>0&&<span> · <span style={{color:C.green}}>{e.fat}g fat</span></span>}
                        {e.time&&<span style={{color:C.muted}}> · {e.time}</span>}
                      </div>
                    </div>
                    {editMode&&<button onClick={async()=>{
                      if(!window.confirm(`Remove "${e.name}" from this day?`))return;
                      const updated=dayDetail.entries.filter((_,idx)=>idx!==i);
                      await ss(`fp:day:${dayDetail.key}`,updated);
                      setDayDetail({...dayDetail,entries:updated,totals:sumE(updated)});
                    }} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.red,fontSize:12,padding:"3px 8px",cursor:"pointer",marginLeft:8,flexShrink:0}}>✕</button>}
                  </div>
                </div>
              ))}
            </>
          ):(
            <>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                <button onClick={loadHistory} style={{...btnFn(C.cyan),width:"auto",padding:"9px 20px"}}>Load Logs</button>
                <button onClick={()=>{setShowAddPastDay(v=>!v);setPastDayEntries([]);setPastDayDate("");}}
                  style={{...btnFn(C.violet),width:"auto",padding:"9px 20px"}}>
                  {showAddPastDay?"✕ Cancel":"+ Add Past Day"}
                </button>
              </div>

              {/* Add Past Day Form */}
              {showAddPastDay&&(
                <div style={{...crd,marginBottom:14,border:`1px solid ${C.violet}44`}}>
                  <div style={{fontSize:10,color:C.violet,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Log a Past Day</div>

                  {/* Date picker */}
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Select Date</div>
                    <input type="date" max={today} value={pastDayDate} onChange={e=>setPastDayDate(e.target.value)} style={iStyle}/>
                  </div>

                  {/* Add food entries */}
                  {pastDayDate&&(
                    <>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Add Food Items</div>
                      <input placeholder="Food name" value={pastDayFood.name} onChange={e=>setPastDayFood(p=>({...p,name:e.target.value}))} style={{...iStyle,marginBottom:7}}/>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                        {[["cal","Cals"],["protein","Pro"],["carbs","Carbs"],["fat","Fat"]].map(([f,p])=>(
                          <input key={f} type="number" placeholder={p} value={pastDayFood[f]||""} onChange={e=>setPastDayFood(prev=>({...prev,[f]:e.target.value}))} style={{...iStyle,fontSize:11}}/>
                        ))}
                      </div>
                      <button onClick={()=>{
                        if(!pastDayFood.name||!pastDayFood.cal) return;
                        const entry={id:Date.now(),name:pastDayFood.name,cal:parseInt(pastDayFood.cal)||0,protein:parseInt(pastDayFood.protein)||0,carbs:parseInt(pastDayFood.carbs)||0,fat:parseInt(pastDayFood.fat)||0};
                        setPastDayEntries(prev=>[...prev,entry]);
                        setPastDayFood({name:"",cal:"",protein:"",carbs:"",fat:""});
                      }} style={{...btnFn(C.violet),marginBottom:10}}>+ Add Item</button>

                      {/* Preview entries */}
                      {pastDayEntries.length>0&&(
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{pastDayEntries.length} items added</div>
                          {pastDayEntries.map((e,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.subtle,borderRadius:8,padding:"7px 10px",marginBottom:4,border:`1px solid ${C.border}`}}>
                              <div>
                                <div style={{fontSize:12,fontWeight:700,color:C.text}}>{e.name}</div>
                                <div style={{fontSize:10,color:C.muted}}><span style={{color:C.red}}>{e.cal}cal</span>{e.protein>0&&<span> · {e.protein}g pro</span>}{e.carbs>0&&<span> · {e.carbs}g carbs</span>}{e.fat>0&&<span> · {e.fat}g fat</span>}</div>
                              </div>
                              <button onClick={()=>setPastDayEntries(prev=>prev.filter((_,idx)=>idx!==i))} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:13,padding:"2px 6px"}}>✕</button>
                            </div>
                          ))}
                          <div style={{fontSize:10,color:C.red,fontWeight:700,marginTop:6}}>
                            Total: {pastDayEntries.reduce((a,e)=>a+e.cal,0)}cal · {pastDayEntries.reduce((a,e)=>a+e.protein,0)}g pro
                          </div>
                        </div>
                      )}

                      {/* Save past day */}
                      <button onClick={async()=>{
                        if(pastDayEntries.length===0) return alert("Add at least one food item!");
                        const existing=await sg(`fp:day:${pastDayDate}`)||[];
                        const merged=[...existing,...pastDayEntries];
                        await ss(`fp:day:${pastDayDate}`,merged);
                        setShowAddPastDay(false);
                        setPastDayEntries([]);
                        setPastDayDate("");
                        await loadHistory();
                        alert(`Day saved! ${fmtDate(pastDayDate)} has been added to your logs.`);
                      }} style={btnFn(C.green)}>💾 Save {pastDayDate?fmtDate(pastDayDate):""} to Logs</button>
                    </>
                  )}
                </div>
              )}

              {histDays.length===0&&!showAddPastDay&&<div style={{textAlign:"center",color:C.border,fontSize:12,padding:"32px 0",lineHeight:1.8}}>Tap Load Logs to see your history.<br/>Every day you log food is saved automatically.</div>}
              {histDays.map(day=>{
                const pct=Math.round((day.totals.cal/(targets?.calories||1))*100);
                const isToday=day.key===today;
                return(
                  <div key={day.key} style={{...crd,marginBottom:8,position:"relative",overflow:"hidden"}}>
                    {isToday&&<div style={{position:"absolute",top:10,right:10,background:C.red,borderRadius:5,fontSize:8,fontWeight:700,color:"#fff",padding:"2px 7px",letterSpacing:"0.1em"}}>TODAY</div>}
                    <div onClick={()=>setDayDetail(day)} style={{cursor:"pointer"}}>
                      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:1}}>{fmtDate(day.key)}</div>
                      <div style={{fontSize:10,color:C.muted,marginBottom:8}}>{day.entries.length} items · tap to view</div>
                      <div style={{height:4,borderRadius:99,background:C.subtle,overflow:"hidden",marginBottom:7}}>
                        <div style={{height:"100%",width:`${Math.min(pct,100)}%`,borderRadius:99,background:pct>100?C.red:C.red,transition:"width 0.4s"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,flexWrap:"wrap",gap:4}}>
                        <span style={{color:C.red,fontWeight:700}}>{day.totals.cal}cal</span>
                        <span style={{color:C.cyan}}>{day.totals.protein}g pro</span>
                        <span style={{color:C.violet}}>{day.totals.carbs}g carbs</span>
                        <span style={{color:C.green}}>{day.totals.fat}g fat</span>
                        <span style={{color:C.cyan}}>💧{Math.round((day.water||0)/100)/10}L</span>
                        <span style={{color:pct>100?C.red:C.muted}}>{pct}%</span>
                      </div>
                    </div>
                    <button onClick={async(e)=>{
                      e.stopPropagation();
                      if(!window.confirm(`Delete the log for ${fmtDate(day.key)}? This cannot be undone.`)) return;
                      localStorage.removeItem(`fp:day:${day.key}`);
                      localStorage.removeItem(`fp:water:${day.key}`);
                      setHistDays(prev=>prev.filter(d=>d.key!==day.key));
                    }} style={{marginTop:10,background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.red,fontSize:11,padding:"5px 12px",cursor:"pointer",fontFamily:"'DM Mono',monospace",width:"100%"}}>
                      🗑 Delete This Day
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ══ WEEKLY ══════════════════════════════════════════════════════════════ */}
      {nav==="weekly"&&(
        <div className="fi" style={{padding:"18px 14px"}}>
          <div style={{fontSize:9,letterSpacing:"0.3em",color:C.red,fontWeight:700,textTransform:"uppercase",marginBottom:3}}>FUEL PROTOCOL</div>
          <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:14}}>Weekly Summary</div>
          <button onClick={loadWeekly} style={{...btnFn(C.cyan),width:"auto",padding:"8px 18px",marginBottom:14}}>Refresh</button>

          {weekData.length>0&&(()=>{
            const avg=Math.round(weekData.reduce((a,d)=>a+d.totals.cal,0)/7);
            const logged=weekData.filter(d=>d.totals.cal>0).length;
            const onTarget=weekData.filter(d=>d.totals.cal>0&&Math.abs(d.totals.cal-(targets?.calories||2000))<300).length;
            const totalPro=weekData.reduce((a,d)=>a+d.totals.protein,0);
            const goalD=resolvedGoal?.dailyDeficit||0;

            // Weekly deficit analysis
            const loggedDays=weekData.filter(d=>d.totals.cal>0);
            const totalDeficit=tdee>0?loggedDays.reduce((a,d)=>a+(tdee-d.totals.cal),0):0;
            const avgDefPerDay=loggedDays.length>0?Math.round(totalDeficit/loggedDays.length):0;
            const estFatG=Math.round(totalDeficit/7.7);
            const estFatKg=+(totalDeficit/7700).toFixed(3);
            const projMonth=+((estFatKg/7)*30).toFixed(2);
            const isSurplusWk=totalDeficit<0;
            const defColorWk=isSurplusWk?C.red:C.green;
            const maxAbsDef=Math.max(...weekData.map(d=>d.totals.cal>0?Math.abs(tdee-d.totals.cal):0),goalD,1);

            return(
              <>
                {/* Summary tiles */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:12}}>
                  {[{l:"Avg Cal/day",v:`${avg}`,s:"this week",c:C.red},{l:"Days On Target",v:`${onTarget}/7`,s:"±300cal",c:C.green},{l:"Total Protein",v:`${totalPro}g`,s:"this week",c:C.cyan},{l:"Days Logged",v:`${logged}/7`,s:"with entries",c:C.violet}].map((x,i)=>(
                    <div key={i} style={{...crd,textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:3}}>{x.l}</div>
                      <div style={{fontSize:17,fontWeight:700,color:x.c}}>{x.v}</div>
                      <div style={{fontSize:9,color:C.muted}}>{x.s}</div>
                    </div>
                  ))}
                </div>

                {/* Weekly deficit analysis */}
                {tdee>0&&loggedDays.length>0&&(
                  <div style={{...crd,marginBottom:12,border:`1px solid ${isSurplusWk?C.red+"55":C.green+"44"}`}}>
                    <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>
                      ⚖️ Deficit Analysis
                    </div>

                    {/* Radial rings if goal set */}
                    {resolvedGoal&&(
                      <div style={{display:"flex",justifyContent:"space-around",marginBottom:14}}>
                        <GoalRing pct={goalD>0?Math.round((avgDefPerDay/goalD)*100):0} color={C.red} size={90} stroke={7} label={`${avgDefPerDay>0?"−":"+"}${Math.abs(avgDefPerDay)}kcal`} sub="avg deficit/day"/>
                        <GoalRing pct={resolvedGoal.kgPerWeek>0?Math.round((Math.abs(estFatKg)/resolvedGoal.kgPerWeek)*100):0} color={C.green} size={90} stroke={7} label={`${isSurplusWk?"+":"−"}${Math.abs(estFatKg).toFixed(2)}kg`} sub="fat this week"/>
                      </div>
                    )}

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:12}}>
                      <Tile label="Total deficit" value={`${isSurplusWk?"+":"−"}${Math.abs(totalDeficit).toLocaleString()}kcal`} color={defColorWk}/>
                      <Tile label="Avg per day" value={`${avgDefPerDay>0?"−":"+"}${Math.abs(avgDefPerDay)}kcal`} color={defColorWk}/>
                      <Tile label={`Est. fat ${isSurplusWk?"gained":"lost"}`} value={`${Math.abs(estFatG)}g / ${Math.abs(estFatKg).toFixed(2)}kg`} color={defColorWk}/>
                      <Tile label="30-day proj." value={`${isSurplusWk?"+":"−"}${Math.abs(projMonth)}kg`} color={defColorWk}/>
                    </div>

                    {/* Per-day deficit bars */}
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:7}}>
                      Daily vs TDEE ({tdee}kcal){resolvedGoal?` — goal: −${goalD}kcal`:""}
                    </div>
                    {weekData.map((d,i)=>{
                      if(d.totals.cal===0) return(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                          <div style={{fontSize:9,color:C.muted,width:26,flexShrink:0}}>{d.label}</div>
                          <div style={{flex:1,height:16,borderRadius:4,background:C.subtle,display:"flex",alignItems:"center",paddingLeft:6}}>
                            <span style={{fontSize:8,color:C.border}}>not logged</span>
                          </div>
                        </div>
                      );
                      const def=tdee-d.totals.cal;
                      const isSur=def<0;
                      const barW=Math.min((Math.abs(def)/maxAbsDef)*100,100);
                      const col=isSur?C.red:goalD>0&&def>=goalD?C.green:C.red;
                      const gFat=Math.round(Math.abs(def)/7.7);
                      return(
                        <div key={i} style={{marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:9,color:d.key===today?C.red:C.muted,width:26,flexShrink:0,fontWeight:d.key===today?700:400}}>{d.label}</div>
                            <div style={{flex:1,height:16,borderRadius:4,background:C.subtle,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${barW}%`,background:col,borderRadius:4}}/>
                            </div>
                            <div style={{fontSize:9,fontWeight:700,color:col,width:58,textAlign:"right",flexShrink:0}}>
                              {isSur?"+":"-"}{Math.abs(def)}kcal
                            </div>
                          </div>
                          <div style={{fontSize:8,color:C.muted,marginLeft:34,marginTop:1}}>
                            ~{gFat}g fat {isSur?"gained":"lost"} · {d.totals.cal}cal eaten
                          </div>
                        </div>
                      );
                    })}
                    {goalD>0&&<div style={{fontSize:9,color:C.muted,marginTop:8,paddingTop:6,borderTop:`1px solid ${C.border}`}}>🟢 at/above goal · 🟠 partial deficit · 🔴 surplus</div>}
                    <div style={{fontSize:9,color:C.border,marginTop:4}}>7,700kcal ≈ 1kg fat. Estimates only.</div>
                  </div>
                )}

                {/* Cal chart */}
                <div style={{...crd,marginBottom:12}}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Calories This Week</div>
                  <div style={{display:"flex",alignItems:"flex-end",gap:5,height:90}}>
                    {weekData.map((d,i)=>{
                      const pct=(d.totals.cal/(targets?.calories||2000||1))*100;
                      const h=Math.max(Math.min(pct*0.7,94),d.totals.cal>0?4:0);
                      const over=pct>100;
                      return(
                        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                          <div style={{fontSize:8,color:C.muted,textAlign:"center"}}>{d.totals.cal>0?d.totals.cal:""}</div>
                          <div style={{width:"100%",height:70,display:"flex",alignItems:"flex-end"}}>
                            <div style={{width:"100%",height:`${h}%`,borderRadius:"4px 4px 2px 2px",background:over?C.red:d.key===today?C.red:C.subtle,border:`1px solid ${over?C.red:d.key===today?C.red:C.border}`,transition:"height 0.5s"}}/>
                          </div>
                          <div style={{fontSize:8,color:d.key===today?C.red:C.muted,fontWeight:d.key===today?700:400}}>{d.label}</div>
                        </div>
                      );
                    })}
                  </div>
                  {targets?.calories&&<div style={{fontSize:9,color:C.muted,textAlign:"center",marginTop:6}}>Target: {targets.calories}cal/day{resolvedGoal?` · Goal: ${Math.max(resolvedGoal.calsPerDay,0)}cal/day`:""}
                  </div>}
                </div>

                {/* Water chart */}
                <div style={{...crd,marginBottom:12}}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Hydration 💧</div>
                  <div style={{display:"flex",alignItems:"flex-end",gap:5,height:60}}>
                    {weekData.map((d,i)=>{
                      const pct=(d.water/WATER_GOAL)*100;
                      return(
                        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                          <div style={{width:"100%",height:50,display:"flex",alignItems:"flex-end"}}>
                            <div style={{width:"100%",height:`${Math.max(Math.min(pct,100),d.water>0?5:0)}%`,borderRadius:"4px 4px 2px 2px",background:pct>=100?C.cyan:d.water>0?`${C.cyan}66`:C.subtle,border:`1px solid ${pct>=100?C.cyan:C.border}`}}/>
                          </div>
                          <div style={{fontSize:8,color:C.muted}}>{d.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Daily breakdown */}
                <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:7}}>Daily Breakdown</div>
                {[...weekData].reverse().map((d,i)=>(
                  <div key={i} style={{...crd,marginBottom:6,padding:"10px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:12,fontWeight:700,color:d.key===today?C.red:C.text}}>{fmtDate(d.key)}{d.key===today?" ← today":""}</span>
                      <span style={{fontSize:12,fontWeight:700,color:C.red}}>{d.totals.cal}cal</span>
                    </div>
                    <div style={{display:"flex",gap:9,fontSize:10,color:C.muted,flexWrap:"wrap"}}>
                      <span style={{color:C.cyan}}>{d.totals.protein}g pro</span>
                      <span style={{color:C.violet}}>{d.totals.carbs}g carbs</span>
                      <span style={{color:C.green}}>{d.totals.fat}g fat</span>
                      <span>💧{Math.round(d.water/100)/10}L</span>
                      {tdee>0&&d.totals.cal>0&&<span style={{color:tdee-d.totals.cal<0?C.red:C.muted}}>
                        {tdee-d.totals.cal<0?"+":"−"}{Math.abs(tdee-d.totals.cal)}kcal deficit
                      </span>}
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
          {weekData.length===0&&<div style={{textAlign:"center",color:C.border,fontSize:12,padding:"28px 0"}}>Tap Refresh to load your week</div>}
        </div>
      )}

      <NavBar active={nav} onChange={setNav} dark={darkMode}/>
    </div>
  );
}