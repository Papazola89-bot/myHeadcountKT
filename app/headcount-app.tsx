"use client";

import {
  Activity, AlertCircle, ArrowRight, Award, BarChart3, Bell, BookOpen,
  Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ClipboardCheck, Clock3, Download, FileBarChart, FileSpreadsheet,
  FileText, Filter, GraduationCap, HelpCircle, History, LayoutDashboard, Lock,
  LogOut, Menu, MoreHorizontal, Plus, Printer, RotateCcw, School, Search,
  Settings, ShieldCheck, TrendingDown, TrendingUp, Upload, UserCog, UserRound,
  Users, WandSparkles, X, Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createAppsScriptDataService,
  loginWithSchoolCode,
  normalizeAppsScriptStudent,
  type InterventionRecord,
  type SchoolRecord,
  type UserProfile,
} from "./lib/data-service";

type Role = "guru" | "admin";
type Subject = "Bahasa Melayu" | "Matematik";
type Cycle = "TOV" | "OTI 1" | "AR 1" | "OTI 2" | "AR 2" | "OTI 3" | "AR 3" | "ETR";
type View = "dashboard" | "students" | "headcount" | "interventions" | "analysis" | "reports" | "schools" | "submissions" | "users" | "audit" | "settings";
type Student = { id:string; name:string; year:number; className:string; subject:Subject; status:"Aktif"|"Pelepasan"; startDate:string; skills:Record<Cycle,number>; intervention:"Tiada"|"Aktif"|"Selesai"|"Perlu susulan" };
type Intervention = { id:string; studentId:string; issue:string; action:string; method:string; start:string; review:string; status:string };
type AuthStatus = "loading" | "signed-out" | "signed-in" | "error";
type SheetStatus = "idle" | "connecting" | "connected" | "fallback";
type GoogleCredentialResponse = { credential?: string };
type AuthMethod = "google" | "school" | null;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options:{client_id:string;callback:(response:GoogleCredentialResponse)=>void;auto_select?:boolean}):void;
          renderButton(element:HTMLElement,options:{theme:string;size:string;text:string;shape:string;width:number}):void;
          disableAutoSelect():void;
        };
      };
    };
  }
}

const cycles:Cycle[] = ["TOV","OTI 1","AR 1","OTI 2","AR 2","OTI 3","AR 3","ETR"];
const STUDENT_YEARS=[2,3,4,5,6] as const;
const skillOptions = Array.from({length:33},(_,i)=>i);
const S=(TOV:number,AR1:number,AR2:number,AR3:number,ETR:number):Record<Cycle,number>=>({TOV,"OTI 1":Math.max(TOV,AR1-1),"AR 1":AR1,"OTI 2":Math.max(AR1,AR2-1),"AR 2":AR2,"OTI 3":Math.max(AR2,AR3-1),"AR 3":AR3,ETR});
const GOOGLE_CLIENT_ID=(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID||"491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com").trim();
const GOOGLE_GIS_SRC="https://accounts.google.com/gsi/client";
const appsScriptEndpoint=(process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL||"https://script.google.com/macros/s/AKfycbxxplK0PDUs2sS0_CkVes8RB9c42dSX8ptP7ZMMXmGDJl1Nt_rO7fOMS99YN2SFChvY/exec").trim();
const todayIso=()=>new Date().toISOString().slice(0,10);
const todayLabel=()=>new Intl.DateTimeFormat("ms-MY",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date()).toUpperCase();
const normalizeStudent=(value:unknown):Student=>{
  const student=normalizeAppsScriptStudent(value);
  return {...student,skills:student.skills as Record<Cycle,number>};
};
const decodeGoogleToken=(token:string):{email:string;name:string;exp:number;aud:string;iss:string}|null=>{
  try{
    const encoded=token.split(".")[1];
    if(!encoded)return null;
    const base64=encoded.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(encoded.length/4)*4,"=");
    const payload=JSON.parse(decodeURIComponent(Array.from(atob(base64),char=>`%${char.charCodeAt(0).toString(16).padStart(2,"0")}`).join(""))) as {email?:unknown;name?:unknown;exp?:unknown;aud?:unknown;iss?:unknown};
    const email=typeof payload.email==="string"?payload.email:"",name=typeof payload.name==="string"?payload.name.trim():"";
    const exp=Number(payload.exp||0),aud=String(payload.aud||""),iss=String(payload.iss||"");
    return email&&exp&&aud&&iss?{email,name:name||email.split("@")[0],exp,aud,iss}:null;
  }catch{return null}
};
const validSessionToken=(token:string)=>{
  const claims=decodeGoogleToken(token);
  const googleIssuer=claims?.iss==="accounts.google.com"||claims?.iss==="https://accounts.google.com";
  return claims&&claims.aud===GOOGLE_CLIENT_ID&&googleIssuer&&claims.exp*1000>Date.now()+30_000?claims:null;
};
const kp=(v:number)=>v<=0?"Belum dinilai":v>=32?"Menguasai":`KP${v}`;
const initials=(n:string)=>n.split(" ").slice(0,2).map(p=>p[0]).join("");
const date=(d:string)=>new Intl.DateTimeFormat("ms-MY",{day:"numeric",month:"short",year:"numeric"}).format(new Date(d));
const range=(v:number)=>v<=0?"Belum dinilai":v<=5?"KP1–KP5":v<=12?"KP6–KP12":v<=19?"KP13–KP19":v<=27?"KP20–KP27":v<32?"KP28–KP32":"Menguasai";
const downloadCsvFile=(filename:string,rows:(string|number)[][])=>{const csv=rows.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(",")).join("\n");const link=document.createElement("a");link.href=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));link.download=filename;link.click();URL.revokeObjectURL(link.href)};

const guruMenu=[
  ["dashboard","Dashboard",LayoutDashboard],["students","Murid Saya",Users],["headcount","Headcount",FileSpreadsheet],
  ["interventions","Intervensi",Activity],["analysis","Analisis",BarChart3],["reports","Laporan",FileBarChart],
] as const;
const adminMenu=[
  ["dashboard","Dashboard Daerah",LayoutDashboard],["schools","Sekolah",Building2],["headcount","Headcount",FileSpreadsheet],
  ["interventions","Intervensi",Activity],["submissions","Penghantaran",ClipboardCheck],["reports","Laporan",FileBarChart],
  ["users","Pengguna",UserCog],["settings","Tetapan",Settings],["audit","Audit",History],
] as const;

export default function HeadcountApp(){
  const [role,setRole]=useState<Role>("guru"),[view,setView]=useState<View>("dashboard"),[students,setStudents]=useState<Student[]>([]);
  const [schools,setSchools]=useState<SchoolRecord[]>([]),[schoolsLoading,setSchoolsLoading]=useState(false);
  const [interventions,setInterventions]=useState<Intervention[]>([]),[adminInterventions,setAdminInterventions]=useState<InterventionRecord[]>([]),[interventionsLoading,setInterventionsLoading]=useState(false),[cycle,setCycle]=useState<Cycle>("AR 3"),[subject,setSubject]=useState<Subject|"Semua">("Bahasa Melayu");
  const [year,setYear]=useState("Semua tahun"),[query,setQuery]=useState(""),[selected,setSelected]=useState<Student|null>(null),[modal,setModal]=useState<"add"|"intervention"|"submit"|"profile"|null>(null);
  const [mobile,setMobile]=useState(false),[toast,setToast]=useState(""),[saved,setSaved]=useState("Menunggu sambungan Google Sheets"),[undo,setUndo]=useState<Student[]|null>(null);
  const [submission,setSubmission]=useState<Record<string,string>>({});
  const [idToken,setIdToken]=useState(""),[schoolSessionToken,setSchoolSessionToken]=useState(""),[authMethod,setAuthMethod]=useState<AuthMethod>(null),[authPortal,setAuthPortal]=useState<Role>("guru"),[googleEmail,setGoogleEmail]=useState(""),[authStatus,setAuthStatus]=useState<AuthStatus>("loading"),[sheetStatus,setSheetStatus]=useState<SheetStatus>("idle"),[gisReady,setGisReady]=useState(false),[schoolLoginBusy,setSchoolLoginBusy]=useState(false);
  const [profile,setProfile]=useState<UserProfile|null>(null),[profileSaving,setProfileSaving]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false),[notificationsRead,setNotificationsRead]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),googleButton=useRef<HTMLDivElement|null>(null);
  const announce=(m:string)=>{setToast(m);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(""),3600)};
  const appsScriptService=useMemo(()=>appsScriptEndpoint&&(idToken||schoolSessionToken)?createAppsScriptDataService<Student>(appsScriptEndpoint,normalizeStudent,()=>idToken?{idToken:validSessionToken(idToken)?idToken:""}:{schoolSessionToken}):null,[idToken,schoolSessionToken]);

  useEffect(()=>{
    let active=true;
    const acceptCredential=(response:GoogleCredentialResponse)=>{
      const token=response.credential||"",claims=validSessionToken(token);
      if(!active||!claims){setAuthStatus("error");announce("Token Google tidak sah atau telah tamat tempoh.");return}
      // ID token hanya berada dalam memori React dan hilang apabila halaman dimuat semula.
      setSchoolSessionToken("");setAuthMethod("google");setIdToken(token);setGoogleEmail(claims.email);setProfile(null);setAuthStatus("signed-in");
      announce(`Identiti Google disahkan. Akses admin sedang diperiksa.`);
    };
    const initialize=()=>{
      if(!active||!window.google)return;
      window.google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:acceptCredential,auto_select:false});
      setGisReady(true);
    };
    setAuthStatus("signed-out");
    if(window.google){initialize();return()=>{active=false}}
    let script=document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_GIS_SRC}"]`);
    if(!script){script=document.createElement("script");script.src=GOOGLE_GIS_SRC;script.async=true;script.defer=true;document.head.appendChild(script)}
    const failed=()=>{if(active){setAuthStatus(current=>current==="signed-in"?current:"error");announce("Butang log masuk Google gagal dimuatkan.")}};
    script.addEventListener("load",initialize);script.addEventListener("error",failed);
    return()=>{active=false;script?.removeEventListener("load",initialize);script?.removeEventListener("error",failed)};
  },[]);

  useEffect(()=>{
    if(!gisReady||authPortal!=="admin"||authStatus==="signed-in"||!googleButton.current||!window.google)return;
    googleButton.current.replaceChildren();
    window.google.accounts.id.renderButton(googleButton.current,{theme:"filled_blue",size:"large",text:"signin_with",shape:"rectangular",width:300});
  },[authStatus,gisReady,authPortal]);

  useEffect(()=>{
    if(!idToken)return;
    const claims=validSessionToken(idToken);
    if(!claims){setIdToken("");setGoogleEmail("");setAuthMethod(null);setAuthStatus("signed-out");return}
    const expiryTimer=window.setTimeout(()=>{setIdToken("");setGoogleEmail("");setAuthMethod(null);setProfile(null);setAuthStatus("signed-out");setSheetStatus("idle");announce("Sesi Google telah tamat. Sila log masuk semula.")},Math.max(claims.exp*1000-Date.now(),0));
    return()=>window.clearTimeout(expiryTimer);
  },[idToken]);

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      if(authStatus==="loading")return;
      if(!appsScriptService){
        if(active){setStudents([]);setSchools([]);setInterventions([]);setAdminInterventions([]);setSheetStatus("idle");setSaved("Log masuk untuk menyambung Google Sheets")}
        return;
      }
      setSheetStatus("connecting");setSaved("Menyambung ke Google Sheets...");
      try{
        const currentProfile=await appsScriptService.getProfile();
        if(authMethod==="google"&&currentProfile.role!=="ADMIN")throw new Error("Akaun Google ini tidak dibenarkan mengakses portal admin.");
        const safeProfile=authMethod==="school"?{...currentProfile,role:"GURU" as const,email:""}:currentProfile;
        const remote=await appsScriptService.getStudents();
        if(!active)return;
        setProfile(safeProfile);setRole(safeProfile.role==="ADMIN"?"admin":"guru");setStudents(remote);
        setInterventionsLoading(true);
        if(safeProfile.role==="ADMIN"){
          setSchoolsLoading(true);
          const [remoteSchools,remoteInterventions]=await Promise.all([appsScriptService.getSchools(),appsScriptService.getInterventions()]);
          if(active){setSchools(remoteSchools);setAdminInterventions(remoteInterventions)}
        }else{
          const remoteInterventions=await appsScriptService.getInterventions();
          if(active)setInterventions(remoteInterventions.map(row=>({id:row.id,studentId:row.studentId,issue:row.issue,action:row.action,method:row.method,start:row.startDate,review:row.reviewDate,status:row.status})));
        }
        if(active){setSchoolsLoading(false);setInterventionsLoading(false)}
        setSheetStatus("connected");setSaved("Google Sheets disambungkan");
      }catch(error){
        if(!active)return;
        setStudents([]);setSchools([]);setInterventions([]);setAdminInterventions([]);setSchoolsLoading(false);setInterventionsLoading(false);
        setSheetStatus("fallback");setSaved("Google Sheets gagal disambungkan");
        const message=error instanceof Error?error.message:"Sambungan tidak berjaya.";
        if(authMethod==="google"){setIdToken("");setGoogleEmail("");setAuthMethod(null);setProfile(null);setAuthStatus("signed-out")}
        announce(`Google Sheets tidak dapat dicapai. Tiada data tempatan dipaparkan. ${message}`.trim());
      }
    };
    void load();
    return()=>{active=false};
  },[appsScriptService,authStatus,authMethod]);
  const signOut=()=>{window.google?.accounts.id.disableAutoSelect();setIdToken("");setSchoolSessionToken("");setAuthMethod(null);setGoogleEmail("");setProfile(null);setStudents([]);setSchools([]);setInterventions([]);setAdminInterventions([]);setAuthStatus("signed-out");setSheetStatus("idle");setSaved("Log masuk untuk menyambung Sheets");setRole("guru");setView("dashboard");setSelected(null);setModal(null);setMobile(false);setNotificationsOpen(false);setNotificationsRead(false);announce("Anda telah log keluar daripada sesi myHeadcountKT.")};
  const loginSchool=async(code:string)=>{
    setSchoolLoginBusy(true);
    try{
      const session=await loginWithSchoolCode(appsScriptEndpoint,code);
      setIdToken("");setGoogleEmail("");setSchoolSessionToken(session.sessionToken);setAuthMethod("school");setProfile({...session.profile,role:"GURU",email:""});setRole("guru");setView("dashboard");setAuthStatus("signed-in");announce(`Akses guru dibuka untuk ${session.profile.schoolName||session.profile.schoolCode}.`);
    }catch(error){setAuthStatus("signed-out");announce(error instanceof Error?error.message:"Kod sekolah tidak sah.")}
    finally{setSchoolLoginBusy(false)}
  };
  const persist=(next:Student[],previous?:Student[])=>{if(previous)setUndo(previous);setStudents(next);setSaved("Perubahan belum disahkan oleh Google Sheets")};
  const localOnlyMessage=!(idToken||schoolSessionToken)?"Log masuk untuk menyimpan ke Sheets.":"Google Sheets belum tersedia. Perubahan belum disimpan.";
  const filtered=useMemo(()=>students.filter(s=>(subject==="Semua"||s.subject===subject)&&(year==="Semua tahun"||s.year===Number(year.slice(-1)))&&s.name.toLowerCase().includes(query.toLowerCase())),[students,subject,year,query]);
  const menu=role==="guru"?guruMenu:adminMenu;
  const go=(v:View)=>{setView(v);setMobile(false);setNotificationsOpen(false);window.scrollTo({top:0,behavior:"smooth"})};
  const updateSkill=async(id:string,value:number)=>{
    const student=students.find(s=>s.id===id);
    const prev=students;
    persist(students.map(s=>s.id===id?{...s,skills:{...s.skills,[cycle]:value}}:s),prev);
    if(!appsScriptService||!student){announce(localOnlyMessage);return}
    try{
      await appsScriptService.saveAssessment(id,cycle,`KP${value}`,{subject:student.subject,tahun_data:2026});
      setSheetStatus("connected");setSaved(`Google Sheets · ${new Intl.DateTimeFormat("ms-MY",{hour:"numeric",minute:"2-digit"}).format(new Date())}`);
    }catch(error){
      setStudents(prev);
      setSheetStatus("fallback");setSaved("Disimpan lokal · Google Sheets gagal");
      announce(`Penilaian tidak disimpan dan perubahan telah dibatalkan. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const saveIntervention=async(i:Intervention)=>{
    setInterventions(current=>[i,...current]);setModal(null);setSelected(null);
    if(!appsScriptService){announce(localOnlyMessage);return}
    const student=students.find(s=>s.id===i.studentId);
    try{
      await appsScriptService.saveIntervention({studentId:i.studentId,skillCode:`KP${student?.skills["AR 3"]??1}`,issue:i.issue,action:i.action,method:i.method,startDate:i.start,reviewDate:i.review,status:i.status});
      setSheetStatus("connected");announce("Intervensi berjaya disimpan ke Google Sheets.");
    }catch(error){
      setInterventions(current=>current.filter(item=>item.id!==i.id));
      setSheetStatus("fallback");announce(`Intervensi tidak disimpan dan perubahan telah dibatalkan. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const saveStudent=async(student:Student)=>{
    persist([...students,student],students);setModal(null);
    if(!appsScriptService){announce(localOnlyMessage);return}
    try{
      await appsScriptService.saveStudent({studentId:student.id,name:student.name,year:student.year,className:student.className,subject:student.subject,status:student.status,startDate:student.startDate});
      setSheetStatus("connected");announce("Murid baharu berjaya disimpan ke Google Sheets.");
    }catch(error){
      setStudents(students);
      setSheetStatus("fallback");announce(`Murid tidak disimpan dan perubahan telah dibatalkan. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const submitCurrentCycle=async()=>{
    if(!appsScriptService){setModal(null);announce(!(idToken||schoolSessionToken)?"Log masuk dahulu untuk menghantar data kepada admin.":"Google Sheets belum tersedia; data kekal sebagai draf.");return}
    try{
      await appsScriptService.submitCycle(cycle,{subject:subject==="Semua"?"Bahasa Melayu":subject,tahun:2026});
      setSheetStatus("connected");setSubmission(current=>({...current,[cycle]:"Telah Dihantar"}));setModal(null);announce(`Data ${cycle} telah dihantar dan direkodkan dalam Google Sheets.`);
    }catch(error){
      setSheetStatus("fallback");setModal(null);announce(`Penghantaran gagal; data kekal sebagai draf. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const saveProfileName=async(name:string)=>{
    if(!appsScriptService){announce("Log masuk untuk mengemas kini profil.");return}
    setProfileSaving(true);
    try{
      const updated=await appsScriptService.saveProfile(name);
      setProfile(updated);setModal(null);announce("Profil berjaya dikemas kini dalam Google Sheets.");
    }catch(error){
      announce(`Profil tidak dapat dikemas kini. ${error instanceof Error?error.message:""}`.trim());
    }finally{setProfileSaving(false)}
  };
  const addSchool=async(payload:{code:string;name:string;zone:string})=>{
    if(!appsScriptService)throw new Error("Google Sheets belum tersedia.");
    try{
      const created=await appsScriptService.saveSchool(payload);
      setSchools(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name,"ms")));
      announce(`${created.name} berjaya ditambah ke Google Sheets.`);
      return created;
    }catch(error){announce(`Sekolah tidak dapat ditambah. ${error instanceof Error?error.message:""}`.trim());throw error}
  };
  const rotateSchoolCode=async(school:SchoolRecord)=>{
    if(!appsScriptService)throw new Error("Google Sheets belum tersedia.");
    try{
      const issued=await appsScriptService.rotateSchoolAccessCode(school.id);
      setSchools(current=>current.map(item=>item.id===school.id?{...item,accessCodeConfigured:true,accessCodeLast4:issued.accessCodeLast4}:item));
      announce(`Kod akses ${school.name} telah dijana semula.`);
      return issued.accessCode;
    }catch(error){announce(`Kod akses tidak dapat dijana. ${error instanceof Error?error.message:""}`.trim());throw error}
  };
  const clearAllData=async(confirmation:string)=>{
    if(!appsScriptService)throw new Error("Google Sheets belum tersedia.");
    try{
      await appsScriptService.clearAllData(confirmation);
      setStudents([]);setInterventions([]);setAdminInterventions([]);setSubmission({});setUndo(null);
      setSchools(current=>current.map(s=>({...s,teacherCount:0,studentCount:0,achievement:0,submissionStatus:"Belum mula"})));
      setSaved("Data operasi Google Sheets telah dikosongkan");
      announce("Semua data operasi telah dikosongkan. Sekolah, kod akses dan akaun admin dikekalkan.");
    }catch(error){announce(`Data tidak dapat dikosongkan. ${error instanceof Error?error.message:""}`.trim());throw error}
  };
  const deleteSchool=async(school:SchoolRecord)=>{
    if(!appsScriptService){announce("Google Sheets belum tersedia.");return}
    try{
      await appsScriptService.deleteSchool(school.id);
      setSchools(current=>current.filter(item=>item.id!==school.id));
      announce(`${school.name} telah dipadam daripada Google Sheets.`);
    }catch(error){announce(`Sekolah tidak dapat dipadam. ${error instanceof Error?error.message:""}`.trim());throw error}
  };
  const clearSchools=async(confirmation:string)=>{
    if(!appsScriptService){announce("Google Sheets belum tersedia.");return}
    try{
      await appsScriptService.clearSchools(confirmation);setSchools([]);announce("Semua rekod sekolah kosong telah dipadam daripada Google Sheets.");
    }catch(error){announce(`Senarai sekolah tidak dapat dikosongkan. ${error instanceof Error?error.message:""}`.trim());throw error}
  };
  const exportCsv=()=>{downloadCsvFile("headcount-"+cycle.replace(" ","-")+".csv",[["ID","Nama","Tahun","Kelas","Subjek",...cycles],...filtered.map(s=>[s.id,s.name,s.year,s.className,s.subject,...cycles.map(c=>kp(s.skills[c]))])]);announce("Fail CSV telah dijana.")};
  const userName=profile?.name||googleEmail.split("@")[0]||(authMethod==="school"?"Guru Pemulihan":"Pengguna"),userInitials=initials(userName)||"PG";
  const userRoleLabel=profile?.role==="ADMIN"?"Pentadbir Sistem":"Guru Pemulihan Khas";
  const notifications: {title:string;detail:string;time:string;view:View;Icon:typeof Activity;tone:string}[]=[];
  const schoolName=profile?.schoolName||(profile?.role==="ADMIN"?"Pentadbir sistem":"Sekolah belum dipadankan");
  const schoolMeta=profile?.schoolCode?[profile.schoolCode,profile.schoolZone&&`Zon ${profile.schoolZone}`].filter(Boolean).join(" · "):(profile?.role==="ADMIN"?"Akses semua sekolah":"Semak tab PENGGUNA");
  const props={students:filtered,allStudents:students,cycle,setCycle,subject,setSubject,year,setYear,query,setQuery,go,setSelected,announce,exportCsv,userName};
  const sheetLabel=sheetStatus==="connected"?"Sheets disambungkan":sheetStatus==="connecting"?"Menyambung Sheets":sheetStatus==="fallback"?"Sheets gagal":"Sheets belum disambungkan";
  if(authStatus!=="signed-in"||!profile)return <LoginScreen authStatus={authStatus==="signed-in"?"loading":authStatus} authPortal={authPortal} setAuthPortal={setAuthPortal} gisReady={gisReady} googleButton={googleButton} onSchoolLogin={loginSchool} schoolLoginBusy={schoolLoginBusy} toast={toast}/>;
  return <div className="app-shell">
    <aside className={`sidebar ${mobile?"open":""}`}>
      <div className="brand"><b><GraduationCap size={23}/></b><span><strong>myHeadcountKT</strong><small>Headcount & Intervensi</small></span><button onClick={()=>setMobile(false)}><X size={20}/></button></div>
      <div className="school-card"><i><School size={20}/></i><span><small>{profile?.role==="ADMIN"?"Pentadbir sistem":"Sekolah anda"}</small><strong>{schoolName}</strong><em>{schoolMeta}</em></span></div>
      <nav><p>MENU UTAMA</p>{menu.map(([key,label,Icon])=><button key={key} className={view===key?"active":""} onClick={()=>go(key)}><Icon size={19}/><span>{label}</span>{key==="interventions"&&<em>{role==="guru"?interventions.length:adminInterventions.length}</em>}</button>)}</nav>
      <div className="side-bottom"><button onClick={()=>go("settings")}><Settings size={19}/>Profil & Tetapan</button><button onClick={()=>announce("Bantuan: hubungi pentadbir sekolah atau PPD Kota Tinggi untuk sokongan akses.")}><HelpCircle size={19}/>Bantuan</button><div><b className="avatar">{userInitials}</b><span><strong>{userName}</strong><small>{userRoleLabel}</small></span><button className="side-logout" onClick={signOut} aria-label="Log keluar" title="Log keluar"><LogOut size={17}/></button></div></div>
    </aside>{mobile&&<button className="backdrop nav" onClick={()=>setMobile(false)}/>}
    <main><header className="topbar"><div><button className="menu-btn" onClick={()=>setMobile(true)}><Menu size={21}/></button><span><small>{role==="guru"?"PORTAL GURU":"PORTAL ADMIN"}</small><strong>{menu.find(x=>x[0]===view)?.[1]||"Tetapan"}</strong></span></div><div>{profile.role==="ADMIN"&&<span className="role-toggle"><button className={role==="guru"?"active":""} onClick={()=>{setRole("guru");go("dashboard")}}>Guru</button><button className={role==="admin"?"active":""} onClick={()=>{setRole("admin");go("dashboard")}}>Admin</button></span>}<div className={`google-session ${authStatus} ${sheetStatus}`}><span className="connection-state"><i/><b>{authMethod==="school"?"Kod sekolah disahkan":"Google admin disahkan"}</b><small>{authMethod==="school"?`${profile.schoolCode} · ${sheetLabel}`:`${googleEmail} · ${sheetLabel}`}</small></span><button className="google-signout" onClick={signOut} title="Log keluar"><LogOut size={15}/>Log keluar</button></div><button className={"bell "+(notificationsOpen?"active":"")} onClick={()=>setNotificationsOpen(open=>!open)} aria-label={notificationsOpen?"Tutup notifikasi":"Buka notifikasi"} aria-expanded={notificationsOpen}><Bell size={20}/>{notifications.length>0&&!notificationsRead&&<i/>}</button>{notificationsOpen&&<><button className="notification-scrim" onClick={()=>setNotificationsOpen(false)} aria-label="Tutup notifikasi"/><aside className="notifications-panel"><header><span><strong>Notifikasi</strong><small>{notifications.length?notificationsRead?"Semua telah dibaca":notifications.length+" notifikasi baharu":"Tiada notifikasi"}</small></span><button onClick={()=>setNotificationsRead(true)} disabled={notificationsRead||!notifications.length}>Tandakan semua dibaca</button></header><div>{notifications.length?notifications.map(({title,detail,time,view:target,Icon,tone})=><button className="notification-item" key={title} onClick={()=>{setNotificationsRead(true);go(target)}}><i className={tone}><Icon size={17}/></i><span><strong>{title}</strong><small>{detail}</small><em>{time}</em></span>{!notificationsRead&&<b/>}</button>):<div className="empty-state"><strong>Tiada notifikasi</strong><p>Notifikasi contoh telah dibuang.</p></div>}</div><footer><ShieldCheck size={14}/>Notifikasi sistem myHeadcountKT</footer></aside></>}<button className="profile" onClick={()=>go("settings")}><b className="avatar">{userInitials}</b><span>{userName}</span><ChevronDown size={15}/></button></div></header>
      <div className="page">
        {role==="guru"?<>
          {view==="dashboard"&&<GuruDashboard {...props}/>} {view==="students"&&<StudentsView {...props} onAdd={()=>setModal("add")} onIntervention={(s:Student)=>{setSelected(s);setModal("intervention")}}/>}
          {view==="headcount"&&<Headcount {...props} saved={saved} updateSkill={updateSkill} undo={()=>{if(undo){const now=students;persist(undo);setUndo(now);announce("Perubahan terakhir dibatalkan.")}}} canUndo={!!undo} submission={submission} onSubmit={()=>setModal("submit")}/>} 
          {view==="interventions"&&<Interventions students={students} interventions={interventions} setSelected={setSelected} onAdd={()=>setModal("intervention")} announce={announce}/>} {view==="analysis"&&<Analysis students={students} exportCsv={exportCsv}/>} {view==="reports"&&<Reports role={role} hasData={students.length>0} exportCsv={exportCsv} announce={announce}/>} {view==="settings"&&<SettingsView profile={profile} onEdit={()=>profile?setModal("profile"):announce("Log masuk untuk mengemas kini profil.")} clearAllData={clearAllData}/>}
        </>:<>
          {view==="dashboard"&&<AdminDashboard go={go} announce={announce} schools={schools}/>} {view==="schools"&&<SchoolsView schools={schools} loading={schoolsLoading} announce={announce} addSchool={addSchool} rotateSchoolCode={rotateSchoolCode} deleteSchool={deleteSchool} clearSchools={clearSchools}/>} {view==="headcount"&&<AdminHeadcount schools={schools} announce={announce}/>} {view==="interventions"&&<AdminInterventions records={adminInterventions} loading={interventionsLoading}/>} {view==="submissions"&&<Submissions schools={schools} announce={announce}/>} {view==="reports"&&<Reports role={role} hasData={schools.some(s=>s.studentCount>0)} exportCsv={exportCsv} announce={announce}/>} {view==="users"&&<UsersView profile={profile}/>} {view==="audit"&&<Audit/>} {view==="settings"&&<SettingsView profile={profile} onEdit={()=>profile?setModal("profile"):announce("Log masuk untuk mengemas kini profil.")} clearAllData={clearAllData}/>}
        </>}
      </div>
    </main>
    {selected&&!modal&&<StudentDrawer student={selected} close={()=>setSelected(null)} intervention={()=>setModal("intervention")}/>} 
    {modal==="add"&&<AddModal close={()=>setModal(null)} save={s=>{void saveStudent(s)}}/>}
    {modal==="intervention"&&<InterventionModal students={students} selected={selected} close={()=>{setModal(null);setSelected(null)}} save={i=>{void saveIntervention(i)}}/>}
    {modal==="submit"&&<Confirm cycle={cycle} count={students.length} close={()=>setModal(null)} confirm={()=>{void submitCurrentCycle()}}/>}
    {modal==="profile"&&profile&&<ProfileModal profile={profile} saving={profileSaving} close={()=>setModal(null)} save={name=>{void saveProfileName(name)}}/>}
    {toast&&<div className="toast"><CheckCircle2 size={19}/>{toast}</div>}
  </div>
}

function LoginScreen({authStatus,authPortal,setAuthPortal,gisReady,googleButton,onSchoolLogin,schoolLoginBusy,toast}:{authStatus:AuthStatus;authPortal:Role;setAuthPortal:(role:Role)=>void;gisReady:boolean;googleButton:React.RefObject<HTMLDivElement|null>;onSchoolLogin:(code:string)=>Promise<void>;schoolLoginBusy:boolean;toast:string}){
  const [schoolCode,setSchoolCode]=useState("");
  const status=authStatus==="error"?"Perkhidmatan Google tidak dapat dimuatkan. Muat semula halaman untuk mencuba lagi.":authStatus==="loading"?"Memeriksa sambungan Google...":"Gunakan akaun Google yang telah didaftarkan oleh pentadbir.";
  return <main className="login-page">
    <section className="login-showcase">
      <div className="login-brand"><b><GraduationCap size={29}/></b><span><strong>myHeadcountKT</strong><small>Headcount & Intervensi Pemulihan Khas</small></span></div>
      <div className="login-copy"><span className="login-eyebrow">SISTEM PEMULIHAN KHAS · KOTA TINGGI</span><h1>Kenal pasti kemajuan.<br/><em>Bertindak dengan tepat.</em></h1><p>Satu ruang kerja untuk guru merekod headcount, memantau perkembangan kemahiran dan merancang intervensi murid.</p></div>
      <div className="login-features">
        <article><i><FileSpreadsheet size={20}/></i><span><strong>Rekod berpusat</strong><small>Data disimpan terus ke Google Sheets</small></span></article>
        <article><i><TrendingUp size={20}/></i><span><strong>Pantau kemajuan</strong><small>Ikuti TOV, AR dan sasaran ETR</small></span></article>
        <article><i><ShieldCheck size={20}/></i><span><strong>Akses terkawal</strong><small>Peranan guru dan admin ditentukan sistem</small></span></article>
      </div>
      <div className="login-preview" aria-hidden="true"><span><small>RINGKASAN KEMAJUAN</small><strong>Headcount semasa</strong></span><div><b><em>—</em><small>Menunggu data sekolah</small></b><i><span/><span/><span/><span/><span/></i></div></div>
      <div className="login-organizations">
        <span><small>IDENTITI ORGANISASI</small><strong>Inisiatif pendidikan Pemulihan Khas Kota Tinggi</strong></span>
        <div>
          <figure className="org-logo ppdkt-logo"><span><img src="/logos/ppd-kota-tinggi.png" alt="Logo Pejabat Pendidikan Daerah Kota Tinggi"/></span><figcaption>PPD Kota Tinggi</figcaption></figure>
          <figure className="org-logo spb-logo"><span><img src="/logos/spb-ppdkt.png" alt="Logo Sektor Pembelajaran PPD Kota Tinggi"/></span><figcaption>Sektor Pembelajaran</figcaption></figure>
          <figure className="org-logo m3p-logo"><span><img src="/logos/m3p-johor.png" alt="Logo Majlis Permuafakatan Guru Pemulihan Khas Negeri Johor"/></span><figcaption>M3P Johor</figcaption></figure>
        </div>
      </div>
      <footer>myHeadcountKT · Data lebih jelas, intervensi lebih terarah</footer>
    </section>
    <section className="login-access">
      <div className="login-card">
        <div className="login-card-icon"><Lock size={23}/></div>
        <span className="login-card-label">PORTAL AKSES SELAMAT</span>
        <h2>Log masuk ke myHeadcountKT</h2>
        <p>Guru masuk menggunakan kod sekolah. Portal admin hanya boleh dibuka melalui akaun Google pentadbir yang ditetapkan.</p>
        <div className="login-role-tabs" role="tablist" aria-label="Pilih portal"><button role="tab" aria-selected={authPortal==="guru"} className={authPortal==="guru"?"active":""} onClick={()=>setAuthPortal("guru")}><School size={16}/>Guru</button><button role="tab" aria-selected={authPortal==="admin"} className={authPortal==="admin"?"active":""} onClick={()=>setAuthPortal("admin")}><ShieldCheck size={16}/>Admin</button></div>
        <form className={`school-code-login ${authPortal==="guru"?"active":""}`} onSubmit={event=>{event.preventDefault();void onSchoolLogin(schoolCode)}}><label htmlFor="school-code">Kod akses rahsia sekolah</label><div><input id="school-code" autoComplete="off" value={schoolCode} onChange={event=>setSchoolCode(event.target.value.toUpperCase())} placeholder="Contoh: KT-AB12-CD34-EF56" maxLength={30}/><button className="primary" type="submit" disabled={!schoolCode.trim()||schoolLoginBusy}>{schoolLoginBusy?"Menyemak...":"Masuk sebagai Guru"}<ArrowRight size={16}/></button></div><small>Gunakan kod rahsia yang diberi oleh admin, bukan kod JBA awam. Akses hanya untuk sekolah berkenaan.</small></form>
        <div className={`admin-google-login ${authPortal==="admin"?"active":""}`}><div className={`login-google ${authStatus}`} ref={googleButton}>{!gisReady&&<span className="login-loading"><i/><small>{status}</small></span>}</div>{gisReady&&<small className="login-help">{status}</small>}<aside><Lock size={17}/><span><strong>Admin terhad</strong><small>Hanya akaun Google pentadbir yang telah dibenarkan boleh masuk.</small></span></aside></div>
        <div className="login-divider"><span>AKSES SELAMAT</span></div>
        <ul><li><CheckCircle2 size={16}/>Guru dihadkan kepada sekolah sendiri</li><li><CheckCircle2 size={16}/>Kod sekolah tidak membuka menu admin</li><li><CheckCircle2 size={16}/>Data tidak dipaparkan sebelum akses disahkan</li></ul>
        <aside><ShieldCheck size={18}/><span><strong>Akses mengikut peranan</strong><small>Sesi guru dan sesi admin diasingkan oleh sistem.</small></span></aside>
      </div>
      <p className="login-support"><HelpCircle size={15}/>Masalah akses? Hubungi pentadbir sistem sekolah anda.</p>
    </section>
    {toast&&<div className="toast"><AlertCircle size={19}/>{toast}</div>}
  </main>
}

function Heading({eyebrow,title,desc,children}:{eyebrow:string;title:string;desc:string;children?:React.ReactNode}){return <section className="heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{desc}</p></div>{children}</section>}
function CardHeader({title,desc,children}:{title:string;desc?:string;children?:React.ReactNode}){return <div className="card-header"><div><h2>{title}</h2>{desc&&<p>{desc}</p>}</div>{children}</div>}
function Status({text}:{text:string}){const t=text.toLowerCase();const tone=t.includes("berjaya")||t.includes("disahkan")||t.includes("meningkat")||t==="aktif"?"green":t.includes("lewat")||t.includes("susulan")||t.includes("segera")?"red":t.includes("draf")||t.includes("perhatian")?"amber":t.includes("intervensi")||t.includes("dihantar")?"blue":"gray";return <span className={`status ${tone}`}><i/>{text}</span>}
function Stat({label,value,detail,Icon,tone}:{label:string;value:number|string;detail:string;Icon:typeof Users;tone:string}){return <div className="stat"><i className={tone}><Icon size={21}/></i><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></div>}
function StudentCell({s,onClick}:{s:Student;onClick?:()=>void}){const content=<><b>{initials(s.name)}</b><span><strong>{s.name}</strong><small>{s.id}</small></span></>;return onClick?<button className="student-cell" onClick={onClick}>{content}</button>:<div className="student-cell">{content}</div>}
function Delta({n}:{n:number}){return <span className={`delta ${n>0?"up":n<0?"down":"same"}`}>{n>0?<TrendingUp size={15}/>:n<0?<TrendingDown size={15}/>:<ArrowRight size={15}/>} {n>0?`+${n} KP`:n===0?"Kekal":`${n} KP`}</span>}
type CommonProps={students:Student[];allStudents:Student[];cycle:Cycle;setCycle:(v:Cycle)=>void;subject:Subject|"Semua";setSubject:(v:Subject|"Semua")=>void;year:string;setYear:(v:string)=>void;query:string;setQuery:(v:string)=>void;go:(v:View)=>void;setSelected:(s:Student|null)=>void;announce:(m:string)=>void;exportCsv:()=>void;userName:string};

function GuruDashboard(p:CommonProps){
  const scope=p.students,stats={total:scope.length,up:scope.filter(s=>s.skills[p.cycle]>s.skills.TOV).length,same:scope.filter(s=>s.skills[p.cycle]===s.skills.TOV).length,intervention:scope.filter(s=>s.intervention==="Aktif"||s.intervention==="Perlu susulan").length,master:scope.filter(s=>s.skills[p.cycle]>=32||s.status==="Pelepasan").length};
  const labels=["KP1–KP5","KP6–KP12","KP13–KP19","KP20–KP27","KP28–KP32","Menguasai"],values=labels.map(l=>scope.filter(s=>range(s.skills[p.cycle])===l).length),max=Math.max(...values,1);
  const attention=p.allStudents.filter(s=>s.intervention==="Aktif"||s.intervention==="Perlu susulan"||s.skills["AR 3"]<=s.skills["AR 2"]).slice(0,5);
  return <>
    <Heading eyebrow={todayLabel()} title={`Selamat datang, ${p.userName}.`} desc="Ini ringkasan perkembangan murid Pemulihan Khas anda."><button className="primary" onClick={()=>p.go("headcount")}><FileSpreadsheet size={18}/> Rekod Headcount</button></Heading>
    {attention.length?<section className="action-strip"><div><i><AlertCircle size={20}/></i><span><strong>Perlu tindakan</strong><small>{attention.length} murid memerlukan perhatian</small></span></div><nav><button onClick={()=>p.go("interventions")}><i className="red"/>{stats.intervention} intervensi aktif atau susulan<ChevronRight size={17}/></button><button onClick={()=>p.go("students")}><i className="amber"/>{attention.length} murid untuk disemak<ChevronRight size={17}/></button></nav></section>:<section className="card"><div className="empty-state"><i><CheckCircle2 size={24}/></i><strong>Tiada tindakan dipaparkan</strong><p>Data akan muncul selepas murid dan penilaian direkodkan dalam Google Sheets.</p></div></section>}
    <section className="filters"><label className="search"><Search size={17}/><input value={p.query} onChange={e=>p.setQuery(e.target.value)} placeholder="Cari nama murid"/></label><label><span>Tahun data</span><select><option>2026</option><option>2027</option></select></label><label><span>Mata pelajaran</span><select value={p.subject} onChange={e=>p.setSubject(e.target.value as Subject|"Semua")}><option>Bahasa Melayu</option><option>Matematik</option><option>Semua</option></select></label><label><span>Tahun murid</span><select value={p.year} onChange={e=>p.setYear(e.target.value)}><option>Semua tahun</option>{STUDENT_YEARS.map(value=><option key={value}>Tahun {value}</option>)}</select></label><label><span>Tempoh</span><select value={p.cycle} onChange={e=>p.setCycle(e.target.value as Cycle)}>{["TOV","AR 1","AR 2","AR 3"].map(x=><option key={x}>{x}</option>)}</select></label><button className="outline" onClick={()=>p.announce("Gunakan pilihan tahun, subjek, murid dan tempoh untuk menapis data.")}><Filter size={17}/>Penapis <b>3</b></button></section>
    <section className="stat-grid"><Stat label="Jumlah Murid" value={stats.total} detail="Murid aktif" Icon={Users} tone="blue"/><Stat label="Meningkat" value={stats.up} detail={`${stats.total?Math.round(stats.up/stats.total*100):0}% daripada murid`} Icon={TrendingUp} tone="green"/><Stat label="Tidak Berubah" value={stats.same} detail="Perlu perhatian" Icon={ArrowRight} tone="amber"/><Stat label="Perlu Intervensi" value={stats.intervention} detail="Daripada rekod semasa" Icon={Activity} tone="red"/><Stat label="Menguasai" value={stats.master} detail="Layak pelepasan" Icon={Award} tone="purple"/></section>
    <section className="dashboard-grid">
      <article className="card distribution"><CardHeader title="Kedudukan Semasa Murid" desc={`Taburan kemahiran bagi ${p.cycle}`}><button className="text-btn" onClick={()=>p.go("analysis")}>Lihat analisis <ArrowRight size={15}/></button></CardHeader><div className="bars">{values.map((v,i)=><div key={labels[i]}><b>{v}</b><span><i style={{height:`${Math.max(v/max*100,v?12:2)}%`}}/></span><small>{labels[i]}</small></div>)}</div><footer><span><i/> {scope.length} murid dianalisis</span><span>Sumber: Google Sheets</span></footer></article>
      <article className="card progress"><CardHeader title="Perkembangan Headcount" desc="Dikira daripada rekod murid semasa"><button className="icon" onClick={()=>p.go("analysis")} aria-label="Lihat analisis perkembangan"><MoreHorizontal size={19}/></button></CardHeader>{scope.length?<><div className="metric"><span><small>Purata semasa</small><strong>KP{(scope.reduce((sum,s)=>sum+s.skills[p.cycle],0)/scope.length).toFixed(1)}</strong></span><em><TrendingUp size={14}/>{stats.up} meningkat</em></div><footer><span><strong>{stats.up}</strong><small>Meningkat</small></span><span><strong>{stats.same}</strong><small>Kekal</small></span><span><strong>{scope.filter(s=>s.skills[p.cycle]>=s.skills.ETR).length}</strong><small>Capai ETR</small></span></footer></>:<div className="empty-state"><strong>Belum ada data headcount</strong><p>Tambah murid dan penilaian untuk melihat analisis.</p></div>}</article>
      <article className="card intervention-chart"><CardHeader title="Status Intervensi" desc="Daripada status murid semasa"/><div><div className="donut"><span><strong>{scope.filter(s=>s.intervention!=="Tiada").length}</strong><small>Jumlah</small></span></div><ul><li><i className="blue"/>Aktif <b>{scope.filter(s=>s.intervention==="Aktif").length}</b></li><li><i className="green"/>Selesai <b>{scope.filter(s=>s.intervention==="Selesai").length}</b></li><li><i className="red"/>Perlu susulan <b>{scope.filter(s=>s.intervention==="Perlu susulan").length}</b></li></ul></div><button className="card-link" onClick={()=>p.go("interventions")}>Urus semua intervensi <ArrowRight size={15}/></button></article>
    </section>
    <section className="card table-card"><CardHeader title="Murid Perlu Tindakan" desc="Disusun mengikut tahap keutamaan"><button className="text-btn" onClick={()=>p.go("students")}>Lihat semua murid <ArrowRight size={15}/></button></CardHeader><Table><thead><tr><th>MURID</th><th>KELAS</th><th>TOV</th><th>{p.cycle}</th><th>PERUBAHAN</th><th>STATUS</th><th/></tr></thead><tbody>{attention.map(s=><tr key={s.id}><td><StudentCell s={s} onClick={()=>p.setSelected(s)}/></td><td>{s.className}</td><td><b className="kp neutral">{kp(s.skills.TOV)}</b></td><td><b className="kp">{kp(s.skills[p.cycle])}</b></td><td><Delta n={s.skills[p.cycle]-s.skills.TOV}/></td><td><Status text={s.intervention==="Perlu susulan"?"Segera":s.intervention==="Aktif"?"Intervensi aktif":"Perlu perhatian"}/></td><td><button className="icon" onClick={()=>p.setSelected(s)}><ChevronRight size={18}/></button></td></tr>)}</tbody></Table></section>
  </>
}

function Table({children}:{children:React.ReactNode}){return <div className="table-wrap"><table>{children}</table></div>}
function Toolbar({query,setQuery,children}:{query?:string;setQuery?:(v:string)=>void;children?:React.ReactNode}){return <div className="toolbar"><label className="search"><Search size={17}/><input value={query} onChange={e=>setQuery?.(e.target.value)} placeholder="Cari nama, ID atau sekolah"/></label>{children}</div>}

function StudentsView(p:CommonProps&{onAdd:()=>void;onIntervention:(s:Student)=>void}){const downloadTemplate=()=>{downloadCsvFile("template-murid-myHeadcountKT.csv",[["ID","Nama","Tahun","Kelas","Subjek","Status","Tarikh Mula"]]);p.announce("Template murid telah dimuat turun.")};return <>
  <Heading eyebrow="PENGURUSAN MURID" title="Murid Saya" desc="Urus profil, rekod penilaian dan perkembangan murid."><div className="heading-actions"><button className="outline" onClick={p.exportCsv}><Download size={17}/>Eksport</button><button className="primary" onClick={p.onAdd}><Plus size={18}/>Tambah Murid</button></div></Heading>
  <section className="card table-card"><Toolbar query={p.query} setQuery={p.setQuery}><select value={p.year} onChange={e=>p.setYear(e.target.value)}><option>Semua tahun</option>{STUDENT_YEARS.map(value=><option key={value}>Tahun {value}</option>)}</select><select value={p.subject} onChange={e=>p.setSubject(e.target.value as Subject|"Semua")}><option>Semua</option><option>Bahasa Melayu</option><option>Matematik</option></select><button className="outline" onClick={()=>p.announce("Import pukal belum diaktifkan. Gunakan Tambah Murid atau muat turun template dahulu.")}><Upload size={16}/>Import CSV / Excel</button></Toolbar><div className="table-meta"><span><strong>{p.students.length}</strong> murid ditemui</span><button onClick={downloadTemplate}><Download size={15}/>Muat turun template</button></div><Table><thead><tr><th>MURID</th><th>TAHUN / KELAS</th><th>SUBJEK</th><th>TOV</th><th>AR 1</th><th>AR 2</th><th>AR 3</th><th>ETR</th><th>INTERVENSI</th><th/></tr></thead><tbody>{p.students.map(s=><tr key={s.id}><td><StudentCell s={s} onClick={()=>p.setSelected(s)}/></td><td><strong>Tahun {s.year}</strong><small className="sub">{s.className}</small></td><td><b className="subject">{s.subject==="Bahasa Melayu"?"BM":"MT"}</b></td>{(["TOV","AR 1","AR 2","AR 3","ETR"] as Cycle[]).map(c=><td key={c}><b className={`kp ${c==="TOV"?"neutral":c==="ETR"?"target":""}`}>{kp(s.skills[c])}</b></td>)}<td><Status text={s.intervention}/></td><td><div className="row-actions"><button onClick={()=>p.onIntervention(s)}><Plus size={17}/></button><button onClick={()=>p.setSelected(s)}><ChevronRight size={18}/></button></div></td></tr>)}</tbody></Table><div className="pagination"><span>Menunjukkan 1–{p.students.length} daripada {p.students.length}</span><div><button disabled><ChevronLeft size={17}/></button><button className="active" disabled aria-current="page">1</button><button disabled><ChevronRight size={17}/></button></div></div></section>
  </>}

function Headcount(p:CommonProps&{saved:string;updateSkill:(id:string,v:number)=>void;undo:()=>void;canUndo:boolean;submission:Record<string,string>;onSubmit:()=>void}){
  const state=p.submission[p.cycle]||"Belum Mula",locked=state==="Dikunci"||state==="Disahkan Admin";
  return <><Heading eyebrow="REKOD PENILAIAN" title="Headcount Murid" desc="Kemas kini kemahiran murid dengan pantas. Setiap perubahan disimpan automatik."><div className="heading-actions"><span className="saved"><Check size={15}/>{p.saved}</span><button className="outline" disabled={!p.canUndo} onClick={p.undo}><RotateCcw size={16}/>Undo</button><button className="primary" disabled={locked} onClick={p.onSubmit}><Upload size={17}/>Hantar Data</button></div></Heading>
    <section className="card headcount-top"><div><i><BookOpen size={21}/></i><label><small>Mata pelajaran</small><select value={p.subject} onChange={e=>p.setSubject(e.target.value as Subject|"Semua")}><option>Bahasa Melayu</option><option>Matematik</option></select></label></div><span><small>Status {p.cycle}</small><Status text={state}/>{locked&&<Lock size={15}/>}</span></section>
    <div className="cycle-tabs">{cycles.map(c=><button key={c} className={c===p.cycle?"active":""} onClick={()=>p.setCycle(c)}>{c}{p.submission[c]==="Disahkan Admin"?<CheckCircle2 size={14}/>:p.submission[c]==="Draf"?<i/>:null}</button>)}</div>
    {locked&&<div className="locked"><Lock size={18}/><span><strong>Data {p.cycle} telah disahkan dan dikunci</strong><small>Hubungi admin daerah jika perubahan diperlukan.</small></span></div>}
    <section className="card sheet"><CardHeader title={`${p.cycle} · ${p.subject}`} desc={`${p.students.length} murid · Tahun data 2026`}><div><button className="outline" onClick={()=>p.announce("Kemas kini pukal belum diaktifkan. Gunakan pilihan kemahiran setiap murid untuk kemas kini yang selamat.")}><WandSparkles size={16}/>Bulk Update</button><button className="outline" onClick={p.exportCsv}><Download size={16}/>Eksport</button></div></CardHeader><Table><thead><tr><th>#</th><th>NAMA MURID</th><th>KELAS</th><th>KEMAHIRAN {p.cycle}</th><th>KATEGORI</th><th>PERUBAHAN DARI TOV</th><th>STATUS</th></tr></thead><tbody>{p.students.map((s,i)=>{const d=s.skills[p.cycle]-s.skills.TOV;return <tr key={s.id}><td>{String(i+1).padStart(2,"0")}</td><td><StudentCell s={s}/></td><td>{s.className}</td><td><label className={`skill-select ${locked?"disabled":""}`}><select value={s.skills[p.cycle]} disabled={locked} onChange={e=>p.updateSkill(s.id,Number(e.target.value))}>{skillOptions.map(v=><option key={v} value={v}>{kp(v)}</option>)}</select><ChevronDown size={15}/></label></td><td><span className="range">{range(s.skills[p.cycle])}</span></td><td><Delta n={d}/></td><td>{s.skills[p.cycle]>=s.skills.ETR?<Status text="Capai ETR"/>:d===0?<Status text="Perlu perhatian"/>:<Status text="Meningkat"/>}</td></tr>})}</tbody></Table><footer className="autosave"><span><CheckCircle2 size={16}/>Semua perubahan telah disimpan</span><span>Simpan Draf aktif secara automatik</span></footer></section>
  </>}

function Interventions({students,interventions,setSelected,onAdd,announce}:{students:Student[];interventions:Intervention[];setSelected:(s:Student)=>void;onAdd:()=>void;announce:(message:string)=>void}){const visible=interventions.filter(item=>students.some(student=>student.id===item.studentId));const now=new Date(),active=visible.filter(item=>item.status.toLowerCase().includes("sedang")).length,overdue=visible.filter(item=>new Date(item.review)<now&&!/selesai|berjaya/i.test(item.status)).length,successful=visible.filter(item=>/selesai|berjaya/i.test(item.status)).length,followUp=visible.filter(item=>/lanjutan|susulan/i.test(item.status)).length;return <><Heading eyebrow="TINDAKAN SUSULAN" title="Intervensi" desc="Rancang, laksana dan nilai intervensi murid secara berstruktur."><button className="primary" onClick={onAdd} disabled={!students.length}><Plus size={18}/>Rekod Intervensi</button></Heading><section className="stat-grid four"><Stat label="Sedang Dilaksana" value={active} detail="Intervensi aktif" Icon={Activity} tone="blue"/><Stat label="Perlu Disemak" value={overdue} detail="Melepasi tarikh semakan" Icon={Clock3} tone="amber"/><Stat label="Berjaya" value={successful} detail="Sasaran dicapai" Icon={CheckCircle2} tone="green"/><Stat label="Perlu Susulan" value={followUp} detail="Strategi baharu" Icon={AlertCircle} tone="red"/></section><section className="card intervention-list"><Toolbar><button className="outline" onClick={()=>announce("Semua status intervensi sedang dipaparkan.")}><Filter size={16}/>Semua status</button><button className="outline" onClick={()=>announce("Intervensi disusun mengikut tarikh semakan.")}><CalendarDays size={16}/>Tarikh semakan</button></Toolbar>{visible.length?visible.map(item=>{const s=students.find(x=>x.id===item.studentId);if(!s)return null;const isOverdue=new Date(item.review)<now&&!/selesai|berjaya/i.test(item.status);return <article key={item.id} className={isOverdue?"urgent":""}><i/><StudentCell s={s} onClick={()=>setSelected(s)}/><div><small>ISU DIKENAL PASTI</small><strong>{item.issue}</strong><p>{item.action}</p></div><div><small>KAEDAH</small><strong>{item.method}</strong><em>Mula {date(item.start)}</em></div><div className={isOverdue?"overdue":""}><small>TARIKH SEMAKAN</small><strong><CalendarDays size={15}/>{date(item.review)}</strong>{isOverdue&&<em>Lewat disemak</em>}</div><div><Status text={item.status==="Sedang dilaksanakan"?"Intervensi aktif":item.status}/><button className="outline small" onClick={()=>setSelected(s)}>Semak <ChevronRight size={15}/></button></div></article>}):<div className="empty-state"><i><Activity size={24}/></i><strong>Belum ada intervensi untuk murid semasa</strong><p>Rekod contoh telah dibuang. Tambah intervensi apabila data murid tersedia.</p></div>}</section></>}

function Analysis({students,exportCsv}:{students:Student[];exportCsv:()=>void}){const ranges=["KP1–KP5","KP6–KP12","KP13–KP19","KP20–KP27","KP28–KP32"],tov=ranges.map(label=>students.filter(s=>range(s.skills.TOV)===label).length),current=ranges.map(label=>students.filter(s=>range(s.skills["AR 3"])===label).length),increased=students.filter(s=>s.skills["AR 3"]>s.skills.TOV).length,achieved=students.filter(s=>s.skills["AR 3"]>=s.skills.ETR).length,near=students.filter(s=>s.skills["AR 3"]<s.skills.ETR&&s.skills.ETR-s.skills["AR 3"]<=2).length,notYet=Math.max(students.length-achieved-near,0),average=students.length?students.reduce((sum,s)=>sum+(s.skills["AR 3"]-s.skills.TOV),0)/students.length:0,max=Math.max(...tov,...current,1);return <><Heading eyebrow="CERAPAN DATA" title="Analisis Sekolah" desc="Kenal pasti pola perkembangan dan jurang kemahiran murid."><button className="outline" disabled={!students.length} onClick={exportCsv}><Download size={17}/>Eksport Analisis</button></Heading>{students.length?<><section className="analysis-grid"><article className="card big-analysis"><CardHeader title="Pergerakan Kemahiran" desc="Dikira daripada TOV dan AR 3"/><div className="metric"><span><small>Peningkatan purata</small><strong>{average>=0?"+":""}{average.toFixed(1)} KP</strong></span><em><TrendingUp size={14}/>{increased} murid meningkat</em></div></article><article className="card etr"><CardHeader title="Pencapaian ETR" desc="Status sasaran individu"/><div className="etr-ring"><span><strong>{Math.round(achieved/students.length*100)}%</strong><small>Capai sasaran</small></span></div><ul><li><i className="green"/>Telah mencapai <b>{achieved}</b></li><li><i className="amber"/>Hampir mencapai <b>{near}</b></li><li><i className="red"/>Belum mencapai <b>{notYet}</b></li></ul></article></section><section className="card horizontal"><CardHeader title="Taburan Murid Mengikut Julat Kemahiran" desc="Perbandingan TOV dengan AR 3"/>{ranges.map((label,i)=><div key={label}><span>{label}</span><b><i style={{width:`${tov[i]/max*100}%`}}/><em style={{width:`${current[i]/max*100}%`}}/></b><strong>{current[i]}</strong></div>)}<footer><span><i/>TOV</span><span><i/>AR 3</span></footer></section></>:<section className="card"><div className="empty-state"><i><BarChart3 size={24}/></i><strong>Belum ada data untuk dianalisis</strong><p>Angka contoh telah dibuang. Analisis akan muncul selepas rekod murid dimasukkan.</p></div></section>}</>}

function Reports({role,hasData,exportCsv,announce}:{role:Role;hasData:boolean;exportCsv:()=>void;announce:(m:string)=>void}){const items=role==="guru"?[["Laporan Headcount Sekolah","Ringkasan headcount mengikut tempoh dan kemahiran",FileSpreadsheet],["Perkembangan Murid","Perbandingan TOV, AR dan pencapaian ETR",TrendingUp],["Laporan Intervensi","Rekod intervensi, semakan dan hasil tindakan",Activity],["Profil Individu Murid","Laporan lengkap bagi seorang murid",UserRound]]:[["Laporan Headcount Daerah","Analisis keseluruhan sekolah dan zon",FileSpreadsheet],["Analisis Sekolah","Perbandingan prestasi antara sekolah",Building2],["Status Penghantaran","Pemantauan penghantaran setiap cycle",ClipboardCheck],["Analisis Intervensi","Keberkesanan intervensi peringkat daerah",Activity]];return <><Heading eyebrow="PUSAT LAPORAN" title="Laporan" desc="Jana, cetak dan eksport laporan berdasarkan data semasa."/><section className="report-grid">{items.map(([title,desc,Icon])=><article className="card report" key={title as string}><i><Icon size={23}/></i><div><h2>{title as string}</h2><p>{desc as string}</p></div><footer><button disabled={!hasData} onClick={exportCsv}><FileSpreadsheet size={16}/>Excel</button><button disabled={!hasData} onClick={()=>announce("Gunakan fungsi cetak untuk menyimpan sebagai PDF.")}><FileText size={16}/>PDF</button><button disabled={!hasData} onClick={()=>window.print()}><Printer size={16}/>Cetak</button></footer></article>)}</section><section className="card recent"><CardHeader title="Laporan Terkini" desc="Sejarah laporan yang telah dijana"/><div className="empty-state"><i><FileText size={24}/></i><strong>Belum ada sejarah laporan</strong><p>Rekod laporan contoh telah dibuang.</p></div></section></>}

function AdminDashboard({go,announce,schools}:{go:(v:View)=>void;announce:(message:string)=>void;schools:SchoolRecord[]}){const submitted=schools.filter(s=>/hantar|sah|kunci/i.test(s.submissionStatus)).length,totalStudents=schools.reduce((sum,s)=>sum+s.studentCount,0);return <><Heading eyebrow={todayLabel()} title="Dashboard Daerah" desc="Pemantauan Pemulihan Khas · PPD Kota Tinggi"><button className="primary" onClick={()=>go("submissions")}><ClipboardCheck size={18}/>Status Penghantaran</button></Heading><AdminFilters announce={announce}/><section className="stat-grid admin"><Stat label="Jumlah Sekolah" value={schools.length} detail="Daripada Google Sheets" Icon={Building2} tone="blue"/><Stat label="Telah Hantar" value={submitted} detail="Rekod penghantaran" Icon={ClipboardCheck} tone="green"/><Stat label="Murid Pemulihan" value={totalStudents} detail="BM & Matematik" Icon={Users} tone="purple"/><Stat label="Murid Meningkat" value="—" detail="Menunggu data" Icon={TrendingUp} tone="green"/><Stat label="Menguasai" value="—" detail="Menunggu data" Icon={Award} tone="blue"/><Stat label="Perlu Intervensi" value="—" detail="Menunggu data" Icon={Activity} tone="red"/></section><section className="analysis-grid"><article className="card big-analysis"><CardHeader title="Pergerakan Headcount Daerah" desc="Purata perkembangan semua sekolah"><button className="text-btn" onClick={()=>go("headcount")}>Lihat terperinci <ArrowRight size={15}/></button></CardHeader><div className="empty-state"><i><BarChart3 size={24}/></i><strong>Belum cukup data agregat</strong><p>Graf hanya akan dipaparkan selepas penilaian sebenar direkodkan.</p></div></article><article className="card submission-chart"><CardHeader title="Status Penghantaran" desc={`${schools.length} sekolah dalam Sheets`}/><div className="etr-ring"><span><strong>{schools.length?Math.round(submitted/schools.length*100):0}%</strong><small>{submitted} / {schools.length}</small></span></div><ul><li><i className="green"/>Telah dihantar <b>{submitted}</b></li><li><i className="red"/>Belum direkod <b>{schools.length-submitted}</b></li></ul><button className="card-link" onClick={()=>go("submissions")}>Semak penghantaran <ArrowRight size={15}/></button></article></section><section className="card table-card"><CardHeader title="Senarai Sekolah" desc="Data sebenar daripada tab SEKOLAH"><button className="text-btn" onClick={()=>go("schools")}>Lihat semua sekolah <ArrowRight size={15}/></button></CardHeader>{schools.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>PENCAPAIAN</th><th>STATUS TERKINI</th><th/></tr></thead><tbody>{schools.slice(0,5).map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td>{s.achievement}%</td><td><Status text={s.submissionStatus}/></td><td><button className="icon" onClick={()=>go("schools")} aria-label="Lihat sekolah"><ChevronRight size={18}/></button></td></tr>)}</tbody></Table>:<EmptySchools/>}</section></>}
function AdminFilters({announce}:{announce?:(message:string)=>void}){return <section className="admin-filters card"><label>Tahun<select disabled><option>2026</option></select></label><label>Zon<select disabled><option>Semua zon</option></select></label><label>Mata pelajaran<select disabled><option>Semua subjek</option></select></label><label>Headcount<select disabled><option>Semua tempoh</option></select></label><button className="outline" disabled onClick={()=>announce?.("Penapis akan diaktifkan selepas data tersedia.")}><Filter size={16}/>Penapis belum tersedia</button></section>}
function SchoolCell({school}:{school:SchoolRecord}){return <div className="school-cell"><i><School size={18}/></i><span><strong>{school.name}</strong><small>{school.code}</small></span></div>}
function EmptySchools(){return <div className="empty-state"><i><Building2 size={24}/></i><strong>Belum ada sekolah dalam Google Sheets</strong><p>Tambah rekod pertama di sini atau isi tab SEKOLAH. Data contoh lama tidak lagi dipaparkan.</p></div>}

function SchoolsView({schools,loading,announce,addSchool,rotateSchoolCode,deleteSchool,clearSchools}:{schools:SchoolRecord[];loading:boolean;announce:(message:string)=>void;addSchool:(payload:{code:string;name:string;zone:string})=>Promise<SchoolRecord|undefined>;rotateSchoolCode:(school:SchoolRecord)=>Promise<string>;deleteSchool:(school:SchoolRecord)=>Promise<void>;clearSchools:(confirmation:string)=>Promise<void>}){const [dialog,setDialog]=useState<"add"|"clear"|null>(null),[target,setTarget]=useState<SchoolRecord|null>(null),[codeTarget,setCodeTarget]=useState<SchoolRecord|null>(null),[issuedCode,setIssuedCode]=useState(""),[query,setQuery]=useState("");const visible=schools.filter(s=>(s.name+" "+s.code+" "+s.zone).toLowerCase().includes(query.toLowerCase()));return <><Heading eyebrow="PENGURUSAN ORGANISASI" title="Sekolah" desc="Data langsung daripada tab SEKOLAH. Kod akses rahsia diperlukan untuk guru."><button className="primary" onClick={()=>setDialog("add")}><Plus size={18}/>Tambah Sekolah</button></Heading><section className="card table-card"><Toolbar query={query} setQuery={setQuery}><button className="outline" onClick={()=>announce("Carian merangkumi nama, kod dan zon sekolah.")}><Filter size={16}/>Semua zon</button><button className="outline" onClick={()=>{downloadCsvFile("senarai-sekolah.csv",[["Sekolah","Kod","Zon","Murid","Status Kod"],...visible.map(s=>[s.name,s.code,s.zone,s.studentCount,s.accessCodeConfigured?`••••${s.accessCodeLast4}`:"Belum dijana"])]);announce("Senarai sekolah tanpa kod rahsia penuh telah dieksport.")}}><Download size={16}/>Eksport</button><button className="outline danger-button" disabled={!schools.length} onClick={()=>setDialog("clear")}><Trash2 size={16}/>Padam Sekolah Kosong</button></Toolbar>{loading?<div className="empty-state"><strong>Memuatkan data sekolah…</strong></div>:visible.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>PENCAPAIAN</th><th>KOD AKSES GURU</th><th>STATUS</th><th/></tr></thead><tbody>{visible.map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td><div className="progress-cell"><span><i style={{width:`${s.achievement}%`}}/></span><b>{s.achievement}%</b></div></td><td><button className="outline small" onClick={async()=>{setCodeTarget(s);setIssuedCode("");try{setIssuedCode(await rotateSchoolCode(s))}catch{setCodeTarget(null)}}}>{s.accessCodeConfigured?`Tukar · ••••${s.accessCodeLast4}`:"Jana kod"}</button></td><td><Status text={s.status}/></td><td><button className="icon danger-icon" onClick={()=>setTarget(s)} aria-label={`Padam ${s.name}`} title="Padam sekolah"><Trash2 size={17}/></button></td></tr>)}</tbody></Table>:<EmptySchools/>}</section>{dialog==="add"&&<SchoolModal close={()=>setDialog(null)} save={async payload=>{const created=await addSchool(payload);setDialog(null);if(created?.accessCode){setCodeTarget(created);setIssuedCode(created.accessCode)}}}/>} {codeTarget&&issuedCode&&<AccessCodeModal school={codeTarget} code={issuedCode} close={()=>{setCodeTarget(null);setIssuedCode("")}}/>}{target&&<DeleteSchoolModal school={target} close={()=>setTarget(null)} confirm={async()=>{await deleteSchool(target);setTarget(null)}}/>}{dialog==="clear"&&<ClearSchoolsModal close={()=>setDialog(null)} confirm={async text=>{await clearSchools(text);setDialog(null)}}/>}</>}

function AdminHeadcount({schools,announce}:{schools:SchoolRecord[];announce:(message:string)=>void}){return <><Heading eyebrow="ANALISIS DAERAH" title="Headcount" desc="Ringkasan semasa mengikut sekolah daripada Google Sheets."><button className="outline" onClick={()=>{downloadCsvFile("headcount-daerah.csv",[["Sekolah","Kod","Zon","Murid","Pencapaian"],...schools.map(s=>[s.name,s.code,s.zone,s.studentCount,s.achievement])]);announce("Data headcount daerah telah dieksport.")}}><Download size={17}/>Eksport Data</button></Heading><AdminFilters announce={announce}/><section className="card table-card"><CardHeader title="Ringkasan Mengikut Sekolah" desc="Pencapaian dikira daripada penilaian terkini"/>{schools.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>PENCAPAIAN</th><th>PENGHANTARAN</th></tr></thead><tbody>{schools.map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td>{s.achievement}%</td><td><Status text={s.submissionStatus}/></td></tr>)}</tbody></Table>:<EmptySchools/>}</section></>}

function AdminInterventions({records,loading}:{records:InterventionRecord[];loading:boolean}){const now=new Date(),active=records.filter(r=>/aktif|sedang|laksana/i.test(r.status)).length,successful=records.filter(r=>/selesai|berjaya|capai/i.test(r.status+" "+r.outcome)).length,followUp=records.filter(r=>/lanjutan|susulan/i.test(r.status+" "+r.outcome)).length,overdue=records.filter(r=>r.reviewDate&&new Date(r.reviewDate)<now&&!/selesai|berjaya/i.test(r.status)).length;const methodCounts=Object.entries(records.reduce<Record<string,number>>((all,row)=>{const method=row.method.trim()||"Tidak dinyatakan";all[method]=(all[method]||0)+1;return all},{})).sort((a,b)=>b[1]-a[1]).slice(0,4);return <><Heading eyebrow="PEMANTAUAN DAERAH" title="Intervensi" desc="Analisis langsung daripada tab INTERVENSI semua sekolah."/><section className="stat-grid four"><Stat label="Intervensi Aktif" value={active} detail={`${records.length} jumlah rekod`} Icon={Activity} tone="blue"/><Stat label="Berjaya" value={successful} detail="Berdasarkan status/outcome" Icon={CheckCircle2} tone="green"/><Stat label="Lewat Semakan" value={overdue} detail="Melepasi tarikh semakan" Icon={Clock3} tone="red"/><Stat label="Intervensi Lanjutan" value={followUp} detail="Strategi susulan" Icon={RotateCcw} tone="amber"/></section>{loading?<section className="card"><div className="empty-state"><strong>Memuatkan rekod intervensi…</strong></div></section>:records.length?<><section className="analysis-grid"><article className="card ranking"><CardHeader title="Kaedah Digunakan" desc="Kekerapan kaedah dalam rekod sebenar"/>{methodCounts.map(([name,count],i)=><div key={name}><b>{i+1}</b><span><strong>{name}</strong><i><em style={{width:`${Math.round(count/records.length*100)}%`}}/></i></span><small>{count}</small></div>)}</article><article className="card intervention-chart admin"><CardHeader title="Status Keseluruhan" desc="Semua rekod dalam Google Sheets"/><div><div className="donut"><span><strong>{records.length}</strong><small>Jumlah</small></span></div><ul><li><i className="blue"/>Aktif <b>{active}</b></li><li><i className="green"/>Berjaya <b>{successful}</b></li><li><i className="amber"/>Lanjutan <b>{followUp}</b></li><li><i className="red"/>Lewat <b>{overdue}</b></li></ul></div></article></section><section className="card table-card"><CardHeader title="Rekod Intervensi" desc="Murid, sekolah, kaedah dan status sebenar"/><Table><thead><tr><th>MURID</th><th>SEKOLAH</th><th>ISU</th><th>KAEDAH</th><th>TARIKH SEMAKAN</th><th>STATUS</th></tr></thead><tbody>{records.map(row=><tr key={row.id}><td><strong>{row.studentName}</strong><small className="sub">{row.skillCode||row.studentId}</small></td><td>{row.schoolName||row.schoolId}</td><td>{row.issue||"—"}</td><td>{row.method||"—"}</td><td>{row.reviewDate?date(row.reviewDate):"—"}</td><td><Status text={row.status||"Belum ditetapkan"}/></td></tr>)}</tbody></Table></section></>:<section className="card"><div className="empty-state"><i><Activity size={24}/></i><strong>Belum ada rekod intervensi</strong><p>Tab INTERVENSI dalam Google Sheets masih kosong. Sistem tidak lagi memaparkan angka atau analisis contoh.</p></div></section>}</>}

function Submissions({schools,announce}:{schools:SchoolRecord[];announce:(m:string)=>void}){const submitted=schools.filter(s=>/hantar|sah|kunci/i.test(s.submissionStatus)).length,drafts=schools.filter(s=>/draf/i.test(s.submissionStatus)).length;return <><Heading eyebrow="PEMANTAUAN DATA" title="Status Penghantaran" desc="Status terkini yang direkodkan dalam Google Sheets."/><section className="submission-summary card"><div><strong>{submitted}</strong><small>Telah hantar</small></div><div><strong>{drafts}</strong><small>Dalam draf</small></div><div><strong>{schools.length-submitted-drafts}</strong><small>Belum mula</small></div><div><strong>{schools.filter(s=>/sah|kunci/i.test(s.submissionStatus)).length}</strong><small>Telah disahkan</small></div></section><section className="card table-card"><Toolbar><button className="outline" onClick={()=>announce("Semua status penghantaran sedang dipaparkan.")}><Filter size={16}/>Semua status</button><button className="outline" onClick={()=>{downloadCsvFile("status-penghantaran.csv",[["Sekolah","Kod","Zon","Status terkini"],...schools.map(s=>[s.name,s.code,s.zone,s.submissionStatus])]);announce("Status penghantaran telah dieksport.")}}><Download size={16}/>Eksport</button></Toolbar>{schools.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>STATUS TERKINI</th><th>TINDAKAN</th></tr></thead><tbody>{schools.map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td><Status text={s.submissionStatus}/></td><td><button className="outline small" onClick={()=>announce(`Status ${s.name}: ${s.submissionStatus}`)}><ClipboardCheck size={15}/>Semak</button></td></tr>)}</tbody></Table>:<EmptySchools/>}</section></>}

function UsersView({profile}:{profile:UserProfile}){return <><Heading eyebrow="AKSES SISTEM" title="Pengguna" desc="Admin tunggal dan akses guru berasaskan kod sekolah."/><section className="card table-card"><Table><thead><tr><th>PENGGUNA</th><th>E-MEL</th><th>PERANAN</th><th>STATUS</th></tr></thead><tbody><tr><td><div className="student-cell"><b>{initials(profile.name)||"AD"}</b><span><strong>{profile.name}</strong><small>Pemilik sistem</small></span></div></td><td>{profile.email}</td><td><span className="role-badge"><ShieldCheck size={14}/>Admin tunggal</span></td><td><Status text="Aktif"/></td></tr></tbody></Table><div className="empty-state"><i><School size={24}/></i><strong>Guru tidak memerlukan akaun pengguna</strong><p>Guru masuk melalui kod akses rahsia pada menu Sekolah dan tidak boleh membuka portal admin.</p></div></section></>}

function Audit(){return <><Heading eyebrow="JEJAK SISTEM" title="Audit Log" desc="Rekod perubahan penting dalam Google Sheets."/><section className="card"><div className="empty-state"><i><History size={24}/></i><strong>Tiada log dipaparkan</strong><p>Log contoh telah dibuang. Tab AUDIT_LOG akan mula merekod tindakan sebenar selepas backend baharu digunakan.</p></div></section></>}

function SettingsView({profile,onEdit,clearAllData}:{profile:UserProfile|null;onEdit:()=>void;clearAllData:(confirmation:string)=>Promise<void>}){const [confirming,setConfirming]=useState(false),name=profile?.name||"Pengguna",role=profile?.role==="ADMIN"?"Pentadbir Sistem":"Guru Pemulihan Khas";return <><Heading eyebrow="KONFIGURASI" title="Profil & Tetapan" desc="Urus profil dan akses sistem."/><section className="settings-grid"><article className="card profile-settings"><b>{initials(name)||"PG"}</b><span><h2>{name}</h2><p>{role}</p><small>{profile?.role==="ADMIN"?profile.email:`${profile?.schoolName||"Sekolah"} · ${profile?.schoolCode||""}`}</small></span><button className="outline" onClick={onEdit} disabled={!profile||profile.role!=="ADMIN"}>Kemas kini Profil</button></article><article className="card settings-list"><h2>Keselamatan Akses</h2><div><span><ShieldCheck size={19}/><i><strong>{profile?.role==="ADMIN"?"Admin tunggal":"Sesi guru sekolah"}</strong><small>{profile?.role==="ADMIN"?"Hanya akaun Google pemilik dibenarkan":"Akses terhad kepada data sekolah sendiri"}</small></i></span><Status text="Aktif"/></div><div><span><Lock size={19}/><i><strong>Kawalan pelayan</strong><small>Peranan dan school_id tidak boleh ditukar daripada pelayar</small></i></span><Status text="Aktif"/></div></article>{profile?.role==="ADMIN"&&<article className="card danger"><div><Trash2 size={20}/><span><strong>Kosongkan semua data operasi</strong><p>Padam murid, penilaian, sasaran, intervensi, penghantaran dan log. Sekolah, kod akses, kemahiran induk dan akaun admin dikekalkan.</p></span></div><button className="outline danger-button" onClick={()=>setConfirming(true)}>Kosongkan Data</button></article>}</section>{confirming&&<ClearAllDataModal close={()=>setConfirming(false)} confirm={async text=>{await clearAllData(text);setConfirming(false)}}/>}</>}

function StudentDrawer({student,close,intervention}:{student:Student;close:()=>void;intervention:()=>void}){return <div className="layer drawer-layer"><button className="backdrop" onClick={close}/><aside className="drawer"><header><span><small>PROFIL MURID</small><h2>{student.name}</h2><p>Tahun {student.year} · {student.className}</p></span><button className="icon" onClick={close}><X size={20}/></button></header><main><section className="profile-hero"><b>{initials(student.name)}</b><span><Status text={student.status}/><p>{student.id} · {student.subject}</p><small>Mula Pemulihan: {student.startDate?date(student.startDate):"Belum ditetapkan"}</small></span></section><section><Title title="Perkembangan Headcount" desc="Kemajuan kemahiran sepanjang 2026"><Delta n={student.skills["AR 3"]-student.skills.TOV}/></Title><div className="student-timeline">{(["TOV","AR 1","AR 2","AR 3","ETR"] as Cycle[]).map((c,i)=><div key={c} className={c==="ETR"?"target":""}><small>{c}</small><strong>{kp(student.skills[c])}</strong>{i<4&&<ArrowRight size={16}/>}</div>)}</div></section><section><Title title="Status Semasa" desc="Penilaian AR 3"/><div className="profile-stats"><div><small>Kemahiran</small><strong>{kp(student.skills["AR 3"])}</strong></div><div><small>Sasaran ETR</small><strong>{kp(student.skills.ETR)}</strong></div><div><small>Intervensi</small><Status text={student.intervention}/></div></div></section><section><Title title="Timeline Intervensi" desc="Daripada rekod Google Sheets"/><div className="empty-state"><strong>Belum ada butiran timeline</strong><p>Rekod contoh telah dibuang. Semak menu Intervensi untuk rekod sebenar.</p></div></section></main><footer><button className="outline" onClick={()=>window.print()}><FileText size={17}/>Cetak Profil</button><button className="primary" onClick={intervention}><Plus size={17}/>Rekod Intervensi</button></footer></aside></div>}
function Title({title,desc,children}:{title:string;desc:string;children?:React.ReactNode}){return <div className="section-title"><span><h3>{title}</h3><p>{desc}</p></span>{children}</div>}
function Modal({title,desc,close,children,footer}:{title:string;desc:string;close:()=>void;children:React.ReactNode;footer:React.ReactNode}){return <div className="layer modal-layer"><button className="backdrop" onClick={close}/><div className="modal"><header><span><h2>{title}</h2><p>{desc}</p></span><button className="icon" onClick={close}><X size={20}/></button></header><main>{children}</main><footer>{footer}</footer></div></div>}

function ProfileModal({profile,saving,close,save}:{profile:UserProfile;saving:boolean;close:()=>void;save:(name:string)=>void}){const [name,setName]=useState(profile.name);const valid=name.trim().length>=2;return <Modal title="Kemas kini Profil" desc="Nama disimpan dalam tab PENGGUNA. E-mel, peranan dan sekolah dikawal oleh pentadbir." close={close} footer={<><button className="outline" onClick={close} disabled={saving}>Batal</button><button className="primary" disabled={!valid||saving} onClick={()=>save(name.trim())}><Check size={17}/>{saving?"Menyimpan...":"Simpan Profil"}</button></>}><div className="form-grid"><label className="full">Nama penuh<input autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="Nama penuh pengguna"/></label><label className="full">E-mel Google<input value={profile.email} readOnly/></label><label>Peranan<input value={profile.role==="ADMIN"?"Pentadbir Sistem":"Guru Pemulihan Khas"} readOnly/></label><label>Sekolah<input value={profile.schoolName||"Akses semua sekolah"} readOnly/></label></div></Modal>}

function SchoolModal({close,save}:{close:()=>void;save:(payload:{code:string;name:string;zone:string})=>Promise<void>}){const [code,setCode]=useState(""),[name,setName]=useState(""),[zone,setZone]=useState(""),[saving,setSaving]=useState(false);const valid=code.trim().length>=3&&name.trim().length>=3&&zone.trim().length>=2;const submit=async()=>{if(!valid)return;setSaving(true);try{await save({code:code.trim(),name:name.trim(),zone:zone.trim()})}catch{}finally{setSaving(false)}};return <Modal title="Tambah Sekolah" desc="Rekod ini akan disimpan terus dalam tab SEKOLAH." close={close} footer={<><button className="outline" onClick={close} disabled={saving}>Batal</button><button className="primary" onClick={()=>void submit()} disabled={!valid||saving}><Plus size={17}/>{saving?"Menyimpan...":"Tambah Sekolah"}</button></>}><div className="form-grid"><label>Kod sekolah<input autoFocus value={code} onChange={e=>setCode(e.target.value)} placeholder="Contoh: JBA3012"/></label><label>Zon<input value={zone} onChange={e=>setZone(e.target.value)} placeholder="Contoh: Bandar"/></label><label className="full">Nama sekolah<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nama rasmi sekolah"/></label></div></Modal>}

function AccessCodeModal({school,code,close}:{school:SchoolRecord;code:string;close:()=>void}){const [copied,setCopied]=useState(false);const copy=async()=>{await navigator.clipboard.writeText(code);setCopied(true)};return <Modal title="Kod Akses Guru" desc={`Kod rahsia untuk ${school.name} hanya dipaparkan kali ini.`} close={close} footer={<><button className="outline" onClick={()=>void copy()}>{copied?<Check size={17}/>:<FileText size={17}/>} {copied?"Telah disalin":"Salin Kod"}</button><button className="primary" onClick={close}>Saya Sudah Simpan</button></>}><div className="delete-confirm"><Lock size={27}/><p>Berikan kod ini hanya kepada guru sekolah berkenaan. Jangan masukkan ke dalam fail awam.</p><input value={code} readOnly onFocus={e=>e.currentTarget.select()}/></div></Modal>}

function ClearAllDataModal({close,confirm}:{close:()=>void;confirm:(text:string)=>Promise<void>}){const phrase="KOSONGKAN SEMUA DATA",[text,setText]=useState(""),[busy,setBusy]=useState(false),valid=text===phrase;const run=async()=>{if(!valid)return;setBusy(true);try{await confirm(text)}catch{}finally{setBusy(false)}};return <Modal title="Kosongkan Semua Data Operasi?" desc="Tindakan ini tidak boleh dibuat asal. Konfigurasi sekolah dan admin akan dikekalkan." close={close} footer={<><button className="outline" onClick={close} disabled={busy}>Batal</button><button className="primary danger-primary" onClick={()=>void run()} disabled={!valid||busy}><Trash2 size={17}/>{busy?"Mengosongkan...":"Kosongkan Data"}</button></>}><div className="delete-confirm"><AlertCircle size={27}/><p>Taip tepat <strong>{phrase}</strong> untuk memadam murid, penilaian, sasaran, intervensi, penghantaran dan audit.</p><input autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder={phrase}/></div></Modal>}

function DeleteSchoolModal({school,close,confirm}:{school:SchoolRecord;close:()=>void;confirm:()=>Promise<void>}){const [text,setText]=useState(""),[busy,setBusy]=useState(false),valid=text===school.code;const run=async()=>{if(!valid)return;setBusy(true);try{await confirm()}catch{}finally{setBusy(false)}};return <Modal title="Padam Sekolah?" desc="Tindakan ini hanya dibenarkan jika sekolah tiada pengguna, murid atau penghantaran berkaitan." close={close} footer={<><button className="outline" onClick={close} disabled={busy}>Batal</button><button className="primary danger-primary" onClick={()=>void run()} disabled={!valid||busy}><Trash2 size={17}/>{busy?"Memadam...":"Padam Sekolah"}</button></>}><div className="delete-confirm"><AlertCircle size={27}/><p>Taip kod <strong>{school.code}</strong> untuk mengesahkan pemadaman <b>{school.name}</b>.</p><input autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder={school.code}/></div></Modal>}

function ClearSchoolsModal({close,confirm}:{close:()=>void;confirm:(text:string)=>Promise<void>}){const phrase="PADAM SEMUA SEKOLAH",[text,setText]=useState(""),[busy,setBusy]=useState(false),valid=text===phrase;const run=async()=>{if(!valid)return;setBusy(true);try{await confirm(text)}catch{}finally{setBusy(false)}};return <Modal title="Clear Semua Data Sekolah?" desc="Header tab SEKOLAH akan dikekalkan. Tindakan akan ditolak jika rekod masih digunakan." close={close} footer={<><button className="outline" onClick={close} disabled={busy}>Batal</button><button className="primary danger-primary" onClick={()=>void run()} disabled={!valid||busy}><Trash2 size={17}/>{busy?"Mengosongkan...":"Clear Data"}</button></>}><div className="delete-confirm"><AlertCircle size={27}/><p>Taip tepat <strong>{phrase}</strong> untuk mengesahkan.</p><input autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder={phrase}/></div></Modal>}

function AddModal({close,save}:{close:()=>void;save:(s:Student)=>void}){const [name,setName]=useState(""),[year,setYear]=useState(2),[className,setClass]=useState("2 Cekal"),[subject,setSubject]=useState<Subject>("Bahasa Melayu"),[startDate,setStartDate]=useState(todayIso());const submit=()=>name.trim()&&save({id:`ST${String(Date.now()).slice(-4)}`,name:name.trim(),year,className,subject,status:"Aktif",startDate,skills:S(1,1,1,1,1),intervention:"Tiada"});return <Modal title="Tambah Murid" desc="Masukkan maklumat asas murid Pemulihan Khas Tahun 2 hingga Tahun 6." close={close} footer={<><button className="outline" onClick={close}>Batal</button><button className="primary" disabled={!name.trim()} onClick={submit}><Plus size={17}/>Tambah Murid</button></>}><div className="form-grid"><label className="full">Nama murid<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Nama penuh murid"/></label><label>Tahun<select value={year} onChange={e=>setYear(Number(e.target.value))}>{STUDENT_YEARS.map(value=><option key={value} value={value}>Tahun {value}</option>)}</select></label><label>Kelas<input value={className} onChange={e=>setClass(e.target.value)}/></label><label className="full">Mata pelajaran<select value={subject} onChange={e=>setSubject(e.target.value as Subject)}><option>Bahasa Melayu</option><option>Matematik</option></select></label><label className="full">Tarikh mula Pemulihan<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label></div></Modal>}

function InterventionModal({students,selected,close,save}:{students:Student[];selected:Student|null;close:()=>void;save:(i:Intervention)=>void}){const [studentId,setStudentId]=useState(selected?.id||students[0]?.id||""),[issue,setIssue]=useState("Lemah membaca perkataan"),[action,setAction]=useState(""),[method,setMethod]=useState("Bimbingan individu"),[start,setStart]=useState(todayIso()),[review,setReview]=useState(todayIso());const student=students.find(s=>s.id===studentId);if(!student)return <Modal title="Rekod Intervensi" desc="Rancang tindakan berdasarkan keperluan murid." close={close} footer={<button className="outline" onClick={close}>Tutup</button>}><div className="empty-state modal-empty"><i><Users size={24}/></i><strong>Tiada murid tersedia</strong><p>Tambah atau selaraskan murid daripada Google Sheets sebelum merekod intervensi.</p></div></Modal>;return <Modal title="Rekod Intervensi" desc="Rancang tindakan berdasarkan keperluan murid." close={close} footer={<><button className="outline" onClick={close}>Batal</button><button className="primary" disabled={!action.trim()} onClick={()=>save({id:`IV${Date.now()}`,studentId,issue,action,method,start,review,status:"Sedang dilaksanakan"})}><Check size={17}/>Simpan Intervensi</button></>}><div className="intervention-form"><label>Murid<select value={studentId} onChange={e=>setStudentId(e.target.value)}>{students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="selected-summary"><b>{initials(student.name)}</b><span><strong>{student.name}</strong><small>{student.className} · Kemahiran semasa {kp(student.skills["AR 3"])}</small></span></div><label>Isu dikenal pasti<select value={issue} onChange={e=>setIssue(e.target.value)}><option>Keliru huruf</option><option>Lemah membunyikan suku kata</option><option>Lemah menggabung suku kata</option><option>Lemah membaca perkataan</option><option>Lemah menulis</option><option>Tidak mengingat kemahiran</option><option>Kurang fokus</option><option>Kehadiran</option></select></label><label>Intervensi dilaksanakan<textarea rows={3} value={action} onChange={e=>setAction(e.target.value)} placeholder="Contoh: Latihan bacaan perkataan KVK menggunakan kad imbas."/></label><div className="form-grid"><label>Kaedah<select value={method} onChange={e=>setMethod(e.target.value)}><option>Bimbingan individu</option><option>Kumpulan kecil</option><option>Latih tubi</option><option>Permainan</option><option>ABM manipulatif</option><option>Bacaan berulang</option></select></label><label>Kekerapan<select disabled><option>Direkod dalam catatan tindakan</option></select></label><label>Tarikh mula<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Tarikh semakan<input type="date" value={review} onChange={e=>setReview(e.target.value)}/></label></div></div></Modal>}

function Confirm({cycle,count,close,confirm}:{cycle:Cycle;count:number;close:()=>void;confirm:()=>void}){return <Modal title={`Hantar Data ${cycle}?`} desc="Data akan dihantar kepada admin untuk semakan." close={close} footer={<><button className="outline" onClick={close}>Kembali</button><button className="primary" disabled={!count} onClick={confirm}><Upload size={17}/>Ya, Hantar Data</button></>}><div className="confirm"><i><ClipboardCheck size={26}/></i><h3>Pastikan semua rekod telah lengkap</h3><p>Selepas admin mengesahkan dan mengunci cycle ini, data tidak boleh diubah tanpa kebenaran admin.</p><span><CheckCircle2 size={17}/>{count} rekod murid akan dihantar</span></div></Modal>}
