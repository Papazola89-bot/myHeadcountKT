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
  createLocalDataService,
  normalizeAppsScriptStudent,
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
const skillOptions = Array.from({length:32},(_,i)=>i+1);
const S=(TOV:number,AR1:number,AR2:number,AR3:number,ETR:number):Record<Cycle,number>=>({TOV,"OTI 1":Math.max(TOV,AR1-1),"AR 1":AR1,"OTI 2":Math.max(AR1,AR2-1),"AR 2":AR2,"OTI 3":Math.max(AR2,AR3-1),"AR 3":AR3,ETR});
const seed:Student[]=[
  {id:"ST001",name:"Nur Mira Sofea",year:2,className:"2 Bijak",subject:"Bahasa Melayu",status:"Aktif",startDate:"2026-01-12",skills:S(5,7,8,10,16),intervention:"Aktif"},
  {id:"ST002",name:"Muhammad Ali Haziq",year:2,className:"2 Bijak",subject:"Bahasa Melayu",status:"Aktif",startDate:"2026-01-12",skills:S(4,5,6,6,12),intervention:"Perlu susulan"},
  {id:"ST003",name:"Siti Aisyah Hana",year:3,className:"3 Amanah",subject:"Bahasa Melayu",status:"Aktif",startDate:"2025-03-03",skills:S(8,9,10,11,18),intervention:"Aktif"},
  {id:"ST004",name:"Amin Danish",year:3,className:"3 Amanah",subject:"Bahasa Melayu",status:"Aktif",startDate:"2025-03-03",skills:S(15,18,21,24,27),intervention:"Tiada"},
  {id:"ST005",name:"Puteri Balqis",year:1,className:"1 Cekal",subject:"Bahasa Melayu",status:"Aktif",startDate:"2026-02-02",skills:S(2,4,6,9,14),intervention:"Selesai"},
  {id:"ST006",name:"Daniel Lee Jun Wei",year:2,className:"2 Bestari",subject:"Matematik",status:"Aktif",startDate:"2026-01-12",skills:S(10,14,19,25,28),intervention:"Tiada"},
  {id:"ST007",name:"Ariff Iman",year:1,className:"1 Cekal",subject:"Bahasa Melayu",status:"Aktif",startDate:"2026-02-02",skills:S(1,3,4,5,10),intervention:"Aktif"},
  {id:"ST008",name:"Kavitha Nair",year:3,className:"3 Bestari",subject:"Bahasa Melayu",status:"Pelepasan",startDate:"2025-05-10",skills:S(20,25,29,32,32),intervention:"Selesai"},
  {id:"ST009",name:"Chong Jia En",year:2,className:"2 Bestari",subject:"Matematik",status:"Aktif",startDate:"2026-01-12",skills:S(7,10,14,18,22),intervention:"Tiada"},
  {id:"ST010",name:"Ahmad Rayyan",year:1,className:"1 Cekal",subject:"Bahasa Melayu",status:"Aktif",startDate:"2026-02-02",skills:S(3,5,5,6,11),intervention:"Perlu susulan"},
  {id:"ST011",name:"Izzah Humaira",year:3,className:"3 Amanah",subject:"Bahasa Melayu",status:"Aktif",startDate:"2025-03-03",skills:S(17,21,25,29,31),intervention:"Tiada"},
  {id:"ST012",name:"Harith Zikri",year:2,className:"2 Bijak",subject:"Bahasa Melayu",status:"Aktif",startDate:"2026-01-12",skills:S(6,8,11,15,19),intervention:"Tiada"},
];
const initialInterventions:Intervention[]=[
  {id:"IV001",studentId:"ST001",issue:"Lemah membaca perkataan",action:"Latihan perkataan KVK menggunakan kad imbas dan padanan gambar.",method:"Kumpulan kecil",start:"2026-08-03",review:"2026-08-17",status:"Sedang dilaksanakan"},
  {id:"IV002",studentId:"ST002",issue:"Tidak mengingat kemahiran",action:"Bacaan berulang dan latih tubi perkataan KVKV.",method:"Bimbingan individu",start:"2026-07-20",review:"2026-08-10",status:"Intervensi lanjutan"},
  {id:"IV003",studentId:"ST003",issue:"Lemah menggabung suku kata",action:"Bina perkataan dengan kad suku kata berwarna.",method:"ABM manipulatif",start:"2026-08-01",review:"2026-08-15",status:"Sedang dilaksanakan"},
  {id:"IV004",studentId:"ST007",issue:"Keliru huruf",action:"Aktiviti diskriminasi visual dan multisensori huruf.",method:"Permainan",start:"2026-08-06",review:"2026-08-20",status:"Sedang dilaksanakan"},
];
const GOOGLE_CLIENT_ID=(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID||"491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com").trim();
const GOOGLE_GIS_SRC="https://accounts.google.com/gsi/client";
const appsScriptEndpoint=(process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL||"https://script.google.com/macros/s/AKfycbxxplK0PDUs2sS0_CkVes8RB9c42dSX8ptP7ZMMXmGDJl1Nt_rO7fOMS99YN2SFChvY/exec").trim();
const localService=createLocalDataService<Student>("myHeadcountKT-demo-v1");
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
const kp=(v:number)=>v>=32?"Menguasai":`KP${v}`;
const initials=(n:string)=>n.split(" ").slice(0,2).map(p=>p[0]).join("");
const date=(d:string)=>new Intl.DateTimeFormat("ms-MY",{day:"numeric",month:"short",year:"numeric"}).format(new Date(d));
const range=(v:number)=>v<=5?"KP1–KP5":v<=12?"KP6–KP12":v<=19?"KP13–KP19":v<=27?"KP20–KP27":v<32?"KP28–KP32":"Menguasai";
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
  const [role,setRole]=useState<Role>("guru"),[view,setView]=useState<View>("dashboard"),[students,setStudents]=useState(seed);
  const [schools,setSchools]=useState<SchoolRecord[]>([]),[schoolsLoading,setSchoolsLoading]=useState(false);
  const [interventions,setInterventions]=useState(initialInterventions),[cycle,setCycle]=useState<Cycle>("AR 3"),[subject,setSubject]=useState<Subject|"Semua">("Bahasa Melayu");
  const [year,setYear]=useState("Semua tahun"),[query,setQuery]=useState(""),[selected,setSelected]=useState<Student|null>(null),[modal,setModal]=useState<"add"|"intervention"|"submit"|"profile"|null>(null);
  const [mobile,setMobile]=useState(false),[toast,setToast]=useState(""),[saved,setSaved]=useState("Disimpan 9:42 pagi"),[undo,setUndo]=useState<Student[]|null>(null);
  const [submission,setSubmission]=useState<Record<string,string>>({TOV:"Disahkan Admin","AR 1":"Disahkan Admin","AR 2":"Telah Dihantar","AR 3":"Draf"});
  const [idToken,setIdToken]=useState(""),[googleEmail,setGoogleEmail]=useState(""),[authStatus,setAuthStatus]=useState<AuthStatus>("loading"),[sheetStatus,setSheetStatus]=useState<SheetStatus>("idle"),[gisReady,setGisReady]=useState(false);
  const [profile,setProfile]=useState<UserProfile|null>(null),[profileSaving,setProfileSaving]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false),[notificationsRead,setNotificationsRead]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),googleButton=useRef<HTMLDivElement|null>(null);
  const announce=(m:string)=>{setToast(m);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(""),3600)};
  const appsScriptService=useMemo(()=>appsScriptEndpoint&&idToken?createAppsScriptDataService<Student>(appsScriptEndpoint,normalizeStudent,()=>validSessionToken(idToken)?idToken:""):null,[idToken]);

  useEffect(()=>{
    let active=true;
    const acceptCredential=(response:GoogleCredentialResponse)=>{
      const token=response.credential||"",claims=validSessionToken(token);
      if(!active||!claims){setAuthStatus("error");announce("Token Google tidak sah atau telah tamat tempoh.");return}
      // ID token hanya berada dalam memori React dan hilang apabila halaman dimuat semula.
      setIdToken(token);setGoogleEmail(claims.email);setProfile({userId:"",email:claims.email,name:claims.name,role:"GURU",schoolId:"",schoolName:"",schoolCode:"",schoolZone:""});setAuthStatus("signed-in");
      announce(`Log masuk Google berjaya sebagai ${claims.email}.`);
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
    if(!gisReady||authStatus==="signed-in"||!googleButton.current||!window.google)return;
    googleButton.current.replaceChildren();
    window.google.accounts.id.renderButton(googleButton.current,{theme:"filled_blue",size:"large",text:"signin_with",shape:"rectangular",width:300});
  },[authStatus,gisReady]);

  useEffect(()=>{
    if(!idToken)return;
    const claims=validSessionToken(idToken);
    if(!claims){setIdToken("");setGoogleEmail("");setAuthStatus("signed-out");return}
    const expiryTimer=window.setTimeout(()=>{setIdToken("");setGoogleEmail("");setAuthStatus("signed-out");setSheetStatus("idle");announce("Sesi Google telah tamat. Sila log masuk semula.")},Math.max(claims.exp*1000-Date.now(),0));
    return()=>window.clearTimeout(expiryTimer);
  },[idToken]);

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      if(authStatus==="loading")return;
      if(!appsScriptService){
        const cached=await localService.getStudents();
        if(active&&cached.length)setStudents(cached);
        if(active){setSheetStatus("idle");setSaved(authStatus==="signed-in"?"Endpoint Google Sheets belum dikonfigurasi":"Log masuk Google untuk menyambung Sheets")}
        return;
      }
      setSheetStatus("connecting");setSaved("Menyambung ke Google Sheets...");
      try{
        const remote=await appsScriptService.getStudents();
        if(!active)return;
        setStudents(remote);await localService.saveStudents(remote);
        try{
          const currentProfile=await appsScriptService.getProfile();
          if(active){setProfile(currentProfile);setRole(currentProfile.role==="ADMIN"?"admin":"guru")}
          if(currentProfile.role==="ADMIN"){
            setSchoolsLoading(true);
            const remoteSchools=await appsScriptService.getSchools();
            if(active)setSchools(remoteSchools);
          }
        }catch{
          // Kekalkan nama daripada token Google untuk serasi dengan deployment backend sebelumnya.
        }finally{if(active)setSchoolsLoading(false)}
        setSheetStatus("connected");setSaved("Google Sheets disambungkan");
      }catch(error){
        const cached=await localService.getStudents();
        if(!active)return;
        if(cached.length)setStudents(cached);
        setSheetStatus("fallback");setSaved("Mod demo lokal · Google Sheets gagal");
        announce(`Google Sheets tidak dapat dicapai. Data demo lokal digunakan. ${error instanceof Error?error.message:""}`.trim());
      }
    };
    void load();
    return()=>{active=false};
  },[appsScriptService,authStatus]);
  const signOutGoogle=()=>{window.google?.accounts.id.disableAutoSelect();setIdToken("");setGoogleEmail("");setProfile(null);setAuthStatus("signed-out");setSheetStatus("idle");setSaved("Log masuk Google untuk menyambung Sheets");setRole("guru");setView("dashboard");setSelected(null);setModal(null);setMobile(false);setNotificationsOpen(false);setNotificationsRead(false);announce("Anda telah log keluar daripada sesi myHeadcountKT.")};
  const persist=(next:Student[],previous?:Student[])=>{if(previous)setUndo(previous);setStudents(next);localService.saveStudents(next).catch(()=>announce("Cache lokal tidak dapat disimpan."));setSaved(`Disimpan lokal ${new Intl.DateTimeFormat("ms-MY",{hour:"numeric",minute:"2-digit"}).format(new Date())}`)};
  const localOnlyMessage=!idToken?"Log masuk Google untuk menyimpan ke Sheets. Data kini disimpan pada peranti sahaja.":"Google Sheets belum tersedia. Data kini disimpan pada peranti sahaja.";
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
      setSheetStatus("fallback");setSaved("Disimpan lokal · Google Sheets gagal");
      announce(`Penilaian disimpan pada peranti sahaja. ${error instanceof Error?error.message:""}`.trim());
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
      setSheetStatus("fallback");announce(`Intervensi disimpan pada peranti sahaja. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const saveStudent=async(student:Student)=>{
    persist([...students,student],students);setModal(null);
    if(!appsScriptService){announce(localOnlyMessage);return}
    try{
      await appsScriptService.saveStudent({studentId:student.id,name:student.name,year:student.year,className:student.className,subject:student.subject,status:student.status,startDate:student.startDate});
      setSheetStatus("connected");announce("Murid baharu berjaya disimpan ke Google Sheets.");
    }catch(error){
      setSheetStatus("fallback");announce(`Murid disimpan pada peranti sahaja. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const submitCurrentCycle=async()=>{
    if(!appsScriptService){setModal(null);announce(!idToken?"Log masuk Google dahulu untuk menghantar data kepada admin.":"Google Sheets belum tersedia; data kekal sebagai draf.");return}
    try{
      await appsScriptService.submitCycle(cycle,{subject:subject==="Semua"?"Bahasa Melayu":subject,tahun:2026});
      setSheetStatus("connected");setSubmission(current=>({...current,[cycle]:"Telah Dihantar"}));setModal(null);announce(`Data ${cycle} telah dihantar dan direkodkan dalam Google Sheets.`);
    }catch(error){
      setSheetStatus("fallback");setModal(null);announce(`Penghantaran gagal; data kekal sebagai draf. ${error instanceof Error?error.message:""}`.trim());
    }
  };
  const saveProfileName=async(name:string)=>{
    if(!appsScriptService){announce("Log masuk Google untuk mengemas kini profil.");return}
    setProfileSaving(true);
    try{
      const updated=await appsScriptService.saveProfile(name);
      setProfile(updated);setModal(null);announce("Profil berjaya dikemas kini dalam Google Sheets.");
    }catch(error){
      announce(`Profil tidak dapat dikemas kini. ${error instanceof Error?error.message:""}`.trim());
    }finally{setProfileSaving(false)}
  };
  const addSchool=async(payload:{code:string;name:string;zone:string})=>{
    if(!appsScriptService){announce("Google Sheets belum tersedia.");return}
    try{
      const created=await appsScriptService.saveSchool(payload);
      setSchools(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name,"ms")));
      announce(`${created.name} berjaya ditambah ke Google Sheets.`);
    }catch(error){announce(`Sekolah tidak dapat ditambah. ${error instanceof Error?error.message:""}`.trim());throw error}
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
  const userName=profile?.name||googleEmail.split("@")[0]||"Pengguna Google",userInitials=initials(userName)||"PG";
  const userRoleLabel=profile?.role==="ADMIN"?"Pentadbir Sistem":"Guru Pemulihan Khas";
  const notifications=role==="admin"?[
    {title:"Penghantaran AR 3 perlu disemak",detail:"Beberapa sekolah masih dalam status draf.",time:"Hari ini",view:"submissions" as View,Icon:ClipboardCheck,tone:"amber"},
    {title:"Intervensi lewat semakan",detail:"Semak tindakan susulan peringkat daerah.",time:"Hari ini",view:"interventions" as View,Icon:Clock3,tone:"red"},
    {title:"Data headcount telah dikemas kini",detail:"Paparan analisis daerah sedia untuk semakan.",time:"Semalam",view:"headcount" as View,Icon:TrendingUp,tone:"blue"},
  ]:[
    {title:"Semakan intervensi diperlukan",detail:"Semak rekod murid yang melepasi tarikh semakan.",time:"Hari ini",view:"interventions" as View,Icon:Activity,tone:"red"},
    {title:cycle+" masih dalam draf",detail:"Lengkapkan headcount sebelum dihantar kepada admin.",time:"Hari ini",view:"headcount" as View,Icon:FileSpreadsheet,tone:"amber"},
    {title:"Profil dan Google Sheets disambungkan",detail:"Maklumat akaun anda sedia untuk digunakan.",time:"Semalam",view:"settings" as View,Icon:CheckCircle2,tone:"blue"},
  ];
  const schoolName=profile?.schoolName||(profile?.role==="ADMIN"?"Pentadbir sistem":"Sekolah belum dipadankan");
  const schoolMeta=profile?.schoolCode?[profile.schoolCode,profile.schoolZone&&`Zon ${profile.schoolZone}`].filter(Boolean).join(" · "):(profile?.role==="ADMIN"?"Akses semua sekolah":"Semak tab PENGGUNA");
  const props={students:filtered,allStudents:students,cycle,setCycle,subject,setSubject,year,setYear,query,setQuery,go,setSelected,announce,exportCsv,userName};
  const sheetLabel=sheetStatus==="connected"?"Sheets disambungkan":sheetStatus==="connecting"?"Menyambung Sheets":sheetStatus==="fallback"?"Sheets gagal · demo lokal":"Sheets belum disambungkan";
  if(authStatus!=="signed-in")return <LoginScreen authStatus={authStatus} gisReady={gisReady} googleButton={googleButton} toast={toast}/>;
  return <div className="app-shell">
    <aside className={`sidebar ${mobile?"open":""}`}>
      <div className="brand"><b><GraduationCap size={23}/></b><span><strong>myHeadcountKT</strong><small>Headcount & Intervensi</small></span><button onClick={()=>setMobile(false)}><X size={20}/></button></div>
      <div className="school-card"><i><School size={20}/></i><span><small>{profile?.role==="ADMIN"?"Pentadbir sistem":"Sekolah anda"}</small><strong>{schoolName}</strong><em>{schoolMeta}</em></span></div>
      <nav><p>MENU UTAMA</p>{menu.map(([key,label,Icon])=><button key={key} className={view===key?"active":""} onClick={()=>go(key)}><Icon size={19}/><span>{label}</span>{key==="interventions"&&<em>{role==="guru"?4:18}</em>}</button>)}</nav>
      <div className="side-bottom"><button onClick={()=>go("settings")}><Settings size={19}/>Profil & Tetapan</button><button onClick={()=>announce("Bantuan: hubungi pentadbir sekolah atau PPD Kota Tinggi untuk sokongan akses.")}><HelpCircle size={19}/>Bantuan</button><div><b className="avatar">{userInitials}</b><span><strong>{userName}</strong><small>{userRoleLabel}</small></span><button className="side-logout" onClick={signOutGoogle} aria-label="Log keluar Google" title="Log keluar"><LogOut size={17}/></button></div></div>
    </aside>{mobile&&<button className="backdrop nav" onClick={()=>setMobile(false)}/>}
    <main><header className="topbar"><div><button className="menu-btn" onClick={()=>setMobile(true)}><Menu size={21}/></button><span><small>{role==="guru"?"PORTAL GURU":"PORTAL ADMIN"}</small><strong>{menu.find(x=>x[0]===view)?.[1]||"Tetapan"}</strong></span></div><div>{profile?.role==="ADMIN"&&<span className="role-toggle"><button className={role==="guru"?"active":""} onClick={()=>{setRole("guru");go("dashboard")}}>Guru</button><button className={role==="admin"?"active":""} onClick={()=>{setRole("admin");go("dashboard")}}>Admin</button></span>}<div className={`google-session ${authStatus} ${sheetStatus}`}><span className="connection-state"><i/><b>{authStatus==="signed-in"?"Google telah dilog masuk":authStatus==="loading"?"Memeriksa sesi Google":authStatus==="error"?"Log masuk Google gagal":"Belum log masuk Google"}</b><small>{authStatus==="signed-in"?`${googleEmail} · ${sheetLabel}`:"Log masuk diperlukan untuk Google Sheets"}</small></span>{authStatus==="signed-in"?<button className="google-signout" onClick={signOutGoogle} title="Log keluar Google"><LogOut size={15}/>Log keluar</button>:<div className="google-signin" ref={googleButton}>{!gisReady&&<small>{authStatus==="error"?"Muat semula halaman untuk cuba lagi":"Memuat butang Google..."}</small>}</div>}</div><button className={"bell "+(notificationsOpen?"active":"")} onClick={()=>setNotificationsOpen(open=>!open)} aria-label={notificationsOpen?"Tutup notifikasi":"Buka notifikasi"} aria-expanded={notificationsOpen}><Bell size={20}/>{!notificationsRead&&<i/>}</button>{notificationsOpen&&<><button className="notification-scrim" onClick={()=>setNotificationsOpen(false)} aria-label="Tutup notifikasi"/><aside className="notifications-panel"><header><span><strong>Notifikasi</strong><small>{notificationsRead?"Semua telah dibaca":notifications.length+" notifikasi baharu"}</small></span><button onClick={()=>setNotificationsRead(true)} disabled={notificationsRead}>Tandakan semua dibaca</button></header><div>{notifications.map(({title,detail,time,view:target,Icon,tone})=><button className="notification-item" key={title} onClick={()=>{setNotificationsRead(true);go(target)}}><i className={tone}><Icon size={17}/></i><span><strong>{title}</strong><small>{detail}</small><em>{time}</em></span>{!notificationsRead&&<b/>}</button>)}</div><footer><ShieldCheck size={14}/>Notifikasi sistem myHeadcountKT</footer></aside></>}<button className="profile" onClick={()=>go("settings")}><b className="avatar">{userInitials}</b><span>{userName}</span><ChevronDown size={15}/></button></div></header>
      <div className="page">
        {role==="guru"?<>
          {view==="dashboard"&&<GuruDashboard {...props}/>} {view==="students"&&<StudentsView {...props} onAdd={()=>setModal("add")} onIntervention={(s:Student)=>{setSelected(s);setModal("intervention")}}/>}
          {view==="headcount"&&<Headcount {...props} saved={saved} updateSkill={updateSkill} undo={()=>{if(undo){const now=students;persist(undo);setUndo(now);announce("Perubahan terakhir dibatalkan.")}}} canUndo={!!undo} submission={submission} onSubmit={()=>setModal("submit")}/>} 
          {view==="interventions"&&<Interventions students={students} interventions={interventions} setSelected={setSelected} onAdd={()=>setModal("intervention")} announce={announce}/>} {view==="analysis"&&<Analysis students={students} exportCsv={exportCsv}/>} {view==="reports"&&<Reports role={role} exportCsv={exportCsv} announce={announce}/>} {view==="settings"&&<SettingsView profile={profile} onEdit={()=>profile?setModal("profile"):announce("Log masuk Google untuk mengemas kini profil.")} reset={()=>{persist(seed,students);announce("Data demo dipulihkan.")}}/>}
        </>:<>
          {view==="dashboard"&&<AdminDashboard go={go} announce={announce} schools={schools}/>} {view==="schools"&&<SchoolsView schools={schools} loading={schoolsLoading} announce={announce} addSchool={addSchool} deleteSchool={deleteSchool} clearSchools={clearSchools}/>} {view==="headcount"&&<AdminHeadcount schools={schools} announce={announce}/>} {view==="interventions"&&<AdminInterventions/>} {view==="submissions"&&<Submissions schools={schools} announce={announce}/>} {view==="reports"&&<Reports role={role} exportCsv={exportCsv} announce={announce}/>} {view==="users"&&<UsersView announce={announce}/>} {view==="audit"&&<Audit announce={announce}/>} {view==="settings"&&<SettingsView profile={profile} onEdit={()=>profile?setModal("profile"):announce("Log masuk Google untuk mengemas kini profil.")} reset={()=>{persist(seed,students);announce("Data demo dipulihkan.")}}/>}
        </>}
      </div>
    </main>
    {selected&&!modal&&<StudentDrawer student={selected} close={()=>setSelected(null)} intervention={()=>setModal("intervention")}/>} 
    {modal==="add"&&<AddModal close={()=>setModal(null)} save={s=>{void saveStudent(s)}}/>}
    {modal==="intervention"&&<InterventionModal students={students} selected={selected} close={()=>{setModal(null);setSelected(null)}} save={i=>{void saveIntervention(i)}}/>}
    {modal==="submit"&&<Confirm cycle={cycle} close={()=>setModal(null)} confirm={()=>{void submitCurrentCycle()}}/>}
    {modal==="profile"&&profile&&<ProfileModal profile={profile} saving={profileSaving} close={()=>setModal(null)} save={name=>{void saveProfileName(name)}}/>}
    {toast&&<div className="toast"><CheckCircle2 size={19}/>{toast}</div>}
  </div>
}

function LoginScreen({authStatus,gisReady,googleButton,toast}:{authStatus:AuthStatus;gisReady:boolean;googleButton:React.RefObject<HTMLDivElement|null>;toast:string}){
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
      <div className="login-preview" aria-hidden="true"><span><small>RINGKASAN KEMAJUAN</small><strong>Headcount semasa</strong></span><div><b><em>72%</em><small>Murid meningkat</small></b><i><span style={{height:"44%"}}/><span style={{height:"68%"}}/><span style={{height:"56%"}}/><span style={{height:"84%"}}/><span style={{height:"72%"}}/></i></div></div>
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
        <span className="login-card-label">PORTAL PENGGUNA</span>
        <h2>Log masuk ke myHeadcountKT</h2>
        <p>Akses dashboard, data murid dan rekod intervensi menggunakan akaun Google anda.</p>
        <div className={`login-google ${authStatus}`} ref={googleButton}>{!gisReady&&<span className="login-loading"><i/><small>{status}</small></span>}</div>
        {gisReady&&<small className="login-help">{status}</small>}
        <div className="login-divider"><span>AKSES SELAMAT</span></div>
        <ul><li><CheckCircle2 size={16}/>Identiti Google disahkan</li><li><CheckCircle2 size={16}/>Sekolah dan peranan dipadankan automatik</li><li><CheckCircle2 size={16}/>Data murid tidak dipaparkan sebelum login</li></ul>
        <aside><ShieldCheck size={18}/><span><strong>Privasi anda dilindungi</strong><small>myHeadcountKT tidak menyimpan kata laluan Google anda.</small></span></aside>
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
function LineChart(){return <div className="line-chart"><div className="chart-grid"><i/><i/><i/><i/></div><div className="line"><i/><i/><i/><i/><i/></div><div className="line-labels"><span>TOV</span><span>AR 1</span><span>AR 2</span><span>AR 3</span><span>Semasa</span></div></div>}

type CommonProps={students:Student[];allStudents:Student[];cycle:Cycle;setCycle:(v:Cycle)=>void;subject:Subject|"Semua";setSubject:(v:Subject|"Semua")=>void;year:string;setYear:(v:string)=>void;query:string;setQuery:(v:string)=>void;go:(v:View)=>void;setSelected:(s:Student|null)=>void;announce:(m:string)=>void;exportCsv:()=>void;userName:string};

function GuruDashboard(p:CommonProps){
  const scope=p.students.length?p.students:p.allStudents,stats={total:scope.length,up:scope.filter(s=>s.skills[p.cycle]>s.skills.TOV).length,same:scope.filter(s=>s.skills[p.cycle]===s.skills.TOV).length,intervention:scope.filter(s=>s.intervention==="Aktif"||s.intervention==="Perlu susulan").length,master:scope.filter(s=>s.skills[p.cycle]>=32||s.status==="Pelepasan").length};
  const labels=["KP1–KP5","KP6–KP12","KP13–KP19","KP20–KP27","KP28–KP32","Menguasai"],values=labels.map(l=>scope.filter(s=>range(s.skills[p.cycle])===l).length),max=Math.max(...values,1);
  const attention=p.allStudents.filter(s=>s.intervention==="Aktif"||s.intervention==="Perlu susulan"||s.skills["AR 3"]<=s.skills["AR 2"]).slice(0,5);
  return <>
    <Heading eyebrow="KHAMIS, 13 OGOS 2026" title={`Selamat datang, ${p.userName}.`} desc="Ini ringkasan perkembangan murid Pemulihan Khas anda."><button className="primary" onClick={()=>p.go("headcount")}><FileSpreadsheet size={18}/> Rekod Headcount</button></Heading>
    <section className="action-strip"><div><i><AlertCircle size={20}/></i><span><strong>Perlu tindakan hari ini</strong><small>3 perkara memerlukan perhatian anda</small></span></div><nav><button onClick={()=>p.go("interventions")}><i className="red"/>2 intervensi lewat disemak<ChevronRight size={17}/></button><button onClick={()=>p.go("headcount")}><i className="blue"/>AR 3 masih dalam draf<ChevronRight size={17}/></button><button onClick={()=>p.go("students")}><i className="amber"/>3 murid tiada perkembangan<ChevronRight size={17}/></button></nav></section>
    <section className="filters"><label className="search"><Search size={17}/><input value={p.query} onChange={e=>p.setQuery(e.target.value)} placeholder="Cari nama murid"/></label><label><span>Tahun data</span><select><option>2026</option><option>2027</option></select></label><label><span>Mata pelajaran</span><select value={p.subject} onChange={e=>p.setSubject(e.target.value as Subject|"Semua")}><option>Bahasa Melayu</option><option>Matematik</option><option>Semua</option></select></label><label><span>Tahun murid</span><select value={p.year} onChange={e=>p.setYear(e.target.value)}><option>Semua tahun</option><option>Tahun 1</option><option>Tahun 2</option><option>Tahun 3</option></select></label><label><span>Tempoh</span><select value={p.cycle} onChange={e=>p.setCycle(e.target.value as Cycle)}>{["TOV","AR 1","AR 2","AR 3"].map(x=><option key={x}>{x}</option>)}</select></label><button className="outline" onClick={()=>p.announce("Gunakan pilihan tahun, subjek, murid dan tempoh untuk menapis data.")}><Filter size={17}/>Penapis <b>3</b></button></section>
    <section className="stat-grid"><Stat label="Jumlah Murid" value={stats.total} detail="Murid aktif" Icon={Users} tone="blue"/><Stat label="Meningkat" value={stats.up} detail={`${stats.total?Math.round(stats.up/stats.total*100):0}% daripada murid`} Icon={TrendingUp} tone="green"/><Stat label="Tidak Berubah" value={stats.same} detail="Perlu perhatian" Icon={ArrowRight} tone="amber"/><Stat label="Perlu Intervensi" value={stats.intervention} detail="2 lewat semakan" Icon={Activity} tone="red"/><Stat label="Menguasai" value={stats.master} detail="Layak pelepasan" Icon={Award} tone="purple"/></section>
    <section className="dashboard-grid">
      <article className="card distribution"><CardHeader title="Kedudukan Semasa Murid" desc={`Taburan kemahiran bagi ${p.cycle}`}><button className="text-btn" onClick={()=>p.go("analysis")}>Lihat analisis <ArrowRight size={15}/></button></CardHeader><div className="bars">{values.map((v,i)=><div key={labels[i]}><b>{v}</b><span><i style={{height:`${Math.max(v/max*100,v?12:2)}%`}}/></span><small>{labels[i]}</small></div>)}</div><footer><span><i/> {scope.length} murid dianalisis</span><span>Kemas kini terakhir: Hari ini, 9:42 pagi</span></footer></article>
      <article className="card progress"><CardHeader title="Perkembangan Headcount" desc="Purata kemahiran murid"><button className="icon" onClick={()=>p.go("analysis")} aria-label="Lihat analisis perkembangan"><MoreHorizontal size={19}/></button></CardHeader><div className="metric"><span><small>Purata semasa</small><strong>KP12.4</strong></span><em><TrendingUp size={14}/>+4.6 KP</em></div><LineChart/><footer><span><strong>18</strong><small>Meningkat</small></span><span><strong>5</strong><small>Kekal</small></span><span><strong>7</strong><small>Capai ETR</small></span></footer></article>
      <article className="card intervention-chart"><CardHeader title="Status Intervensi" desc="Kes aktif dan selesai"/><div><div className="donut"><span><strong>9</strong><small>Jumlah</small></span></div><ul><li><i className="blue"/>Sedang intervensi <b>4</b></li><li><i className="green"/>Berjaya <b>3</b></li><li><i className="gray"/>Selesai <b>1</b></li><li><i className="red"/>Perlu susulan <b>1</b></li></ul></div><button className="card-link" onClick={()=>p.go("interventions")}>Urus semua intervensi <ArrowRight size={15}/></button></article>
    </section>
    <section className="card table-card"><CardHeader title="Murid Perlu Tindakan" desc="Disusun mengikut tahap keutamaan"><button className="text-btn" onClick={()=>p.go("students")}>Lihat semua murid <ArrowRight size={15}/></button></CardHeader><Table><thead><tr><th>MURID</th><th>KELAS</th><th>TOV</th><th>{p.cycle}</th><th>PERUBAHAN</th><th>STATUS</th><th/></tr></thead><tbody>{attention.map(s=><tr key={s.id}><td><StudentCell s={s} onClick={()=>p.setSelected(s)}/></td><td>{s.className}</td><td><b className="kp neutral">{kp(s.skills.TOV)}</b></td><td><b className="kp">{kp(s.skills[p.cycle])}</b></td><td><Delta n={s.skills[p.cycle]-s.skills.TOV}/></td><td><Status text={s.intervention==="Perlu susulan"?"Segera":s.intervention==="Aktif"?"Intervensi aktif":"Perlu perhatian"}/></td><td><button className="icon" onClick={()=>p.setSelected(s)}><ChevronRight size={18}/></button></td></tr>)}</tbody></Table></section>
  </>
}

function Table({children}:{children:React.ReactNode}){return <div className="table-wrap"><table>{children}</table></div>}
function Toolbar({query,setQuery,children}:{query?:string;setQuery?:(v:string)=>void;children?:React.ReactNode}){return <div className="toolbar"><label className="search"><Search size={17}/><input value={query} onChange={e=>setQuery?.(e.target.value)} placeholder="Cari nama, ID atau sekolah"/></label>{children}</div>}

function StudentsView(p:CommonProps&{onAdd:()=>void;onIntervention:(s:Student)=>void}){const downloadTemplate=()=>{downloadCsvFile("template-murid-myHeadcountKT.csv",[["ID","Nama","Tahun","Kelas","Subjek","Status","Tarikh Mula"]]);p.announce("Template murid telah dimuat turun.")};return <>
  <Heading eyebrow="PENGURUSAN MURID" title="Murid Saya" desc="Urus profil, rekod penilaian dan perkembangan murid."><div className="heading-actions"><button className="outline" onClick={p.exportCsv}><Download size={17}/>Eksport</button><button className="primary" onClick={p.onAdd}><Plus size={18}/>Tambah Murid</button></div></Heading>
  <section className="card table-card"><Toolbar query={p.query} setQuery={p.setQuery}><select value={p.year} onChange={e=>p.setYear(e.target.value)}><option>Semua tahun</option><option>Tahun 1</option><option>Tahun 2</option><option>Tahun 3</option></select><select value={p.subject} onChange={e=>p.setSubject(e.target.value as Subject|"Semua")}><option>Semua</option><option>Bahasa Melayu</option><option>Matematik</option></select><button className="outline" onClick={()=>p.announce("Import pukal belum diaktifkan. Gunakan Tambah Murid atau muat turun template dahulu.")}><Upload size={16}/>Import CSV / Excel</button></Toolbar><div className="table-meta"><span><strong>{p.students.length}</strong> murid ditemui</span><button onClick={downloadTemplate}><Download size={15}/>Muat turun template</button></div><Table><thead><tr><th>MURID</th><th>TAHUN / KELAS</th><th>SUBJEK</th><th>TOV</th><th>AR 1</th><th>AR 2</th><th>AR 3</th><th>ETR</th><th>INTERVENSI</th><th/></tr></thead><tbody>{p.students.map(s=><tr key={s.id}><td><StudentCell s={s} onClick={()=>p.setSelected(s)}/></td><td><strong>Tahun {s.year}</strong><small className="sub">{s.className}</small></td><td><b className="subject">{s.subject==="Bahasa Melayu"?"BM":"MT"}</b></td>{(["TOV","AR 1","AR 2","AR 3","ETR"] as Cycle[]).map(c=><td key={c}><b className={`kp ${c==="TOV"?"neutral":c==="ETR"?"target":""}`}>{kp(s.skills[c])}</b></td>)}<td><Status text={s.intervention}/></td><td><div className="row-actions"><button onClick={()=>p.onIntervention(s)}><Plus size={17}/></button><button onClick={()=>p.setSelected(s)}><ChevronRight size={18}/></button></div></td></tr>)}</tbody></Table><div className="pagination"><span>Menunjukkan 1–{p.students.length} daripada {p.students.length}</span><div><button disabled><ChevronLeft size={17}/></button><button className="active" disabled aria-current="page">1</button><button disabled><ChevronRight size={17}/></button></div></div></section>
  </>}

function Headcount(p:CommonProps&{saved:string;updateSkill:(id:string,v:number)=>void;undo:()=>void;canUndo:boolean;submission:Record<string,string>;onSubmit:()=>void}){
  const state=p.submission[p.cycle]||"Belum Mula",locked=state==="Dikunci"||state==="Disahkan Admin";
  return <><Heading eyebrow="REKOD PENILAIAN" title="Headcount Murid" desc="Kemas kini kemahiran murid dengan pantas. Setiap perubahan disimpan automatik."><div className="heading-actions"><span className="saved"><Check size={15}/>{p.saved}</span><button className="outline" disabled={!p.canUndo} onClick={p.undo}><RotateCcw size={16}/>Undo</button><button className="primary" disabled={locked} onClick={p.onSubmit}><Upload size={17}/>Hantar Data</button></div></Heading>
    <section className="card headcount-top"><div><i><BookOpen size={21}/></i><label><small>Mata pelajaran</small><select value={p.subject} onChange={e=>p.setSubject(e.target.value as Subject|"Semua")}><option>Bahasa Melayu</option><option>Matematik</option></select></label></div><span><small>Status {p.cycle}</small><Status text={state}/>{locked&&<Lock size={15}/>}</span></section>
    <div className="cycle-tabs">{cycles.map(c=><button key={c} className={c===p.cycle?"active":""} onClick={()=>p.setCycle(c)}>{c}{p.submission[c]==="Disahkan Admin"?<CheckCircle2 size={14}/>:p.submission[c]==="Draf"?<i/>:null}</button>)}</div>
    {locked&&<div className="locked"><Lock size={18}/><span><strong>Data {p.cycle} telah disahkan dan dikunci</strong><small>Hubungi admin daerah jika perubahan diperlukan.</small></span></div>}
    <section className="card sheet"><CardHeader title={`${p.cycle} · ${p.subject}`} desc={`${p.students.length} murid · Tahun data 2026`}><div><button className="outline" onClick={()=>p.announce("Kemas kini pukal belum diaktifkan. Gunakan pilihan kemahiran setiap murid untuk kemas kini yang selamat.")}><WandSparkles size={16}/>Bulk Update</button><button className="outline" onClick={p.exportCsv}><Download size={16}/>Eksport</button></div></CardHeader><Table><thead><tr><th>#</th><th>NAMA MURID</th><th>KELAS</th><th>KEMAHIRAN {p.cycle}</th><th>KATEGORI</th><th>PERUBAHAN DARI TOV</th><th>STATUS</th></tr></thead><tbody>{p.students.map((s,i)=>{const d=s.skills[p.cycle]-s.skills.TOV;return <tr key={s.id}><td>{String(i+1).padStart(2,"0")}</td><td><StudentCell s={s}/></td><td>{s.className}</td><td><label className={`skill-select ${locked?"disabled":""}`}><select value={s.skills[p.cycle]} disabled={locked} onChange={e=>p.updateSkill(s.id,Number(e.target.value))}>{skillOptions.map(v=><option key={v} value={v}>{kp(v)}</option>)}</select><ChevronDown size={15}/></label></td><td><span className="range">{range(s.skills[p.cycle])}</span></td><td><Delta n={d}/></td><td>{s.skills[p.cycle]>=s.skills.ETR?<Status text="Capai ETR"/>:d===0?<Status text="Perlu perhatian"/>:<Status text="Meningkat"/>}</td></tr>})}</tbody></Table><footer className="autosave"><span><CheckCircle2 size={16}/>Semua perubahan telah disimpan</span><span>Simpan Draf aktif secara automatik</span></footer></section>
  </>}

function Interventions({students,interventions,setSelected,onAdd,announce}:{students:Student[];interventions:Intervention[];setSelected:(s:Student)=>void;onAdd:()=>void;announce:(message:string)=>void}){const visible=interventions.filter(item=>students.some(student=>student.id===item.studentId));const active=visible.filter(item=>item.status.toLowerCase().includes("sedang")).length,overdue=visible.filter(item=>new Date(item.review)<new Date("2026-08-13")).length,successful=visible.filter(item=>/selesai|berjaya/i.test(item.status)).length,followUp=visible.filter(item=>/lanjutan|susulan/i.test(item.status)).length;return <><Heading eyebrow="TINDAKAN SUSULAN" title="Intervensi" desc="Rancang, laksana dan nilai intervensi murid secara berstruktur."><button className="primary" onClick={onAdd} disabled={!students.length}><Plus size={18}/>Rekod Intervensi</button></Heading><section className="stat-grid four"><Stat label="Sedang Dilaksana" value={active} detail="Intervensi aktif" Icon={Activity} tone="blue"/><Stat label="Perlu Disemak" value={overdue} detail="Melepasi tarikh semakan" Icon={Clock3} tone="amber"/><Stat label="Berjaya" value={successful} detail="Sasaran dicapai" Icon={CheckCircle2} tone="green"/><Stat label="Perlu Susulan" value={followUp} detail="Strategi baharu" Icon={AlertCircle} tone="red"/></section><section className="card intervention-list"><Toolbar><button className="outline" onClick={()=>announce("Semua status intervensi sedang dipaparkan.")}><Filter size={16}/>Semua status</button><button className="outline" onClick={()=>announce("Intervensi disusun mengikut tarikh semakan.")}><CalendarDays size={16}/>Tarikh semakan</button></Toolbar>{visible.length?visible.map(item=>{const s=students.find(x=>x.id===item.studentId);if(!s)return null;const isOverdue=new Date(item.review)<new Date("2026-08-13");return <article key={item.id} className={isOverdue?"urgent":""}><i/><StudentCell s={s} onClick={()=>setSelected(s)}/><div><small>ISU DIKENAL PASTI</small><strong>{item.issue}</strong><p>{item.action}</p></div><div><small>KAEDAH</small><strong>{item.method}</strong><em>Mula {date(item.start)}</em></div><div className={isOverdue?"overdue":""}><small>TARIKH SEMAKAN</small><strong><CalendarDays size={15}/>{date(item.review)}</strong>{isOverdue&&<em>Lewat disemak</em>}</div><div><Status text={item.status==="Sedang dilaksanakan"?"Intervensi aktif":item.status}/><button className="outline small" onClick={()=>setSelected(s)}>Semak <ChevronRight size={15}/></button></div></article>}):<div className="empty-state"><i><Activity size={24}/></i><strong>Belum ada intervensi untuk murid semasa</strong><p>Rekod demo yang tidak sepadan dengan murid Google Sheets telah diketepikan dengan selamat.</p></div>}</section></>}

function Analysis({students,exportCsv}:{students:Student[];exportCsv:()=>void}){const vals=[students.filter(s=>s.skills["AR 3"]<=5).length,students.filter(s=>s.skills["AR 3"]>=6&&s.skills["AR 3"]<=12).length,students.filter(s=>s.skills["AR 3"]>=13&&s.skills["AR 3"]<=19).length,students.filter(s=>s.skills["AR 3"]>=20&&s.skills["AR 3"]<=27).length,students.filter(s=>s.skills["AR 3"]>=28).length];return <><Heading eyebrow="CERAPAN DATA" title="Analisis Sekolah" desc="Kenal pasti pola perkembangan dan jurang kemahiran murid."><button className="outline" onClick={exportCsv}><Download size={17}/>Eksport Analisis</button></Heading><section className="analysis-grid"><article className="card big-analysis"><CardHeader title="Pergerakan Kemahiran" desc="Purata KP bagi setiap tempoh penilaian"/><div className="metric"><span><small>Peningkatan purata</small><strong>+7.3 KP</strong></span><em><TrendingUp size={14}/>18 murid meningkat</em></div><LineChart/></article><article className="card etr"><CardHeader title="Pencapaian ETR" desc="Status sasaran individu"/><div className="etr-ring"><span><strong>68%</strong><small>Capai sasaran</small></span></div><ul><li><i className="green"/>Telah mencapai <b>17</b></li><li><i className="amber"/>Hampir mencapai <b>5</b></li><li><i className="red"/>Belum mencapai <b>3</b></li></ul></article></section><section className="card horizontal"><CardHeader title="Taburan Murid Mengikut Julat Kemahiran" desc="Perbandingan TOV dengan AR 3"/>{["KP1–KP5","KP6–KP12","KP13–KP19","KP20–KP27","KP28–KP32"].map((label,i)=><div key={label}><span>{label}</span><b><i style={{width:`${[50,72,42,26,12][i]}%`}}/><em style={{width:`${Math.max(vals[i]*15,8)}%`}}/></b><strong>{vals[i]}</strong></div>)}<footer><span><i/>TOV</span><span><i/>AR 3</span></footer></section></>}

function Reports({role,exportCsv,announce}:{role:Role;exportCsv:()=>void;announce:(m:string)=>void}){const items=role==="guru"?[["Laporan Headcount Sekolah","Ringkasan headcount mengikut tempoh dan kemahiran",FileSpreadsheet],["Perkembangan Murid","Perbandingan TOV, AR dan pencapaian ETR",TrendingUp],["Laporan Intervensi","Rekod intervensi, semakan dan hasil tindakan",Activity],["Profil Individu Murid","Laporan lengkap bagi seorang murid",UserRound]]:[["Laporan Headcount Daerah","Analisis keseluruhan sekolah dan zon",FileSpreadsheet],["Analisis Sekolah","Perbandingan prestasi antara sekolah",Building2],["Status Penghantaran","Pemantauan penghantaran setiap cycle",ClipboardCheck],["Analisis Intervensi","Keberkesanan intervensi peringkat daerah",Activity]];return <><Heading eyebrow="PUSAT LAPORAN" title="Laporan" desc="Jana, cetak dan eksport laporan berdasarkan data semasa."/><section className="report-grid">{items.map(([title,desc,Icon])=><article className="card report" key={title as string}><i><Icon size={23}/></i><div><h2>{title as string}</h2><p>{desc as string}</p></div><footer><button onClick={exportCsv}><FileSpreadsheet size={16}/>Excel</button><button onClick={()=>announce("Pratonton PDF disediakan untuk cetakan.")}><FileText size={16}/>PDF</button><button onClick={()=>window.print()}><Printer size={16}/>Cetak</button></footer></article>)}</section><section className="card recent"><CardHeader title="Laporan Terkini" desc="Sejarah laporan yang telah dijana"/><div><FileText size={19}/><span><strong>Laporan Headcount AR 2 · Bahasa Melayu</strong><small>Dijana pada 3 Ogos 2026, 11:20 pagi</small></span><Status text="Sedia"/><button className="icon" onClick={exportCsv} aria-label="Muat turun laporan"><Download size={17}/></button></div><div><FileSpreadsheet size={19}/><span><strong>Senarai Murid Mengikut Kemahiran</strong><small>Dijana pada 28 Julai 2026, 2:15 petang</small></span><Status text="Sedia"/><button className="icon" onClick={exportCsv} aria-label="Muat turun laporan"><Download size={17}/></button></div></section></>}

function AdminDashboard({go,announce,schools}:{go:(v:View)=>void;announce:(message:string)=>void;schools:SchoolRecord[]}){const submitted=schools.filter(s=>/hantar|sah|kunci/i.test(s.submissionStatus)).length,totalStudents=schools.reduce((sum,s)=>sum+s.studentCount,0);return <><Heading eyebrow="KHAMIS, 13 OGOS 2026" title="Dashboard Daerah" desc="Pemantauan Pemulihan Khas · PPD Kota Tinggi"><button className="primary" onClick={()=>go("submissions")}><ClipboardCheck size={18}/>Status Penghantaran</button></Heading><AdminFilters announce={announce}/><section className="stat-grid admin"><Stat label="Jumlah Sekolah" value={schools.length} detail="Daripada Google Sheets" Icon={Building2} tone="blue"/><Stat label="Telah Hantar" value={submitted} detail="Rekod penghantaran" Icon={ClipboardCheck} tone="green"/><Stat label="Murid Pemulihan" value={totalStudents} detail="BM & Matematik" Icon={Users} tone="purple"/><Stat label="Murid Meningkat" value="—" detail="Menunggu agregat" Icon={TrendingUp} tone="green"/><Stat label="Menguasai" value="—" detail="Menunggu agregat" Icon={Award} tone="blue"/><Stat label="Perlu Intervensi" value="—" detail="Menunggu agregat" Icon={Activity} tone="red"/></section><section className="analysis-grid"><article className="card big-analysis"><CardHeader title="Pergerakan Headcount Daerah" desc="Purata perkembangan Bahasa Melayu"><button className="text-btn" onClick={()=>go("headcount")}>Lihat terperinci <ArrowRight size={15}/></button></CardHeader><div className="metric"><span><small>Data organisasi</small><strong>{schools.length} sekolah</strong></span><em><TrendingUp size={14}/>Sumber Google Sheets</em></div><LineChart/></article><article className="card submission-chart"><CardHeader title="Status Penghantaran AR 3" desc={`${schools.length} sekolah dalam Sheets`}/><div className="etr-ring"><span><strong>{schools.length?Math.round(submitted/schools.length*100):0}%</strong><small>{submitted} / {schools.length}</small></span></div><ul><li><i className="green"/>Telah dihantar <b>{submitted}</b></li><li><i className="red"/>Belum direkod <b>{schools.length-submitted}</b></li></ul><button className="card-link" onClick={()=>go("submissions")}>Semak penghantaran <ArrowRight size={15}/></button></article></section><section className="card table-card"><CardHeader title="Senarai Sekolah" desc="Data sebenar daripada tab SEKOLAH"><button className="text-btn" onClick={()=>go("schools")}>Lihat semua sekolah <ArrowRight size={15}/></button></CardHeader>{schools.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>PENCAPAIAN</th><th>AR TERKINI</th><th/></tr></thead><tbody>{schools.slice(0,5).map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td>{s.achievement}%</td><td><Status text={s.submissionStatus}/></td><td><button className="icon" onClick={()=>go("schools")} aria-label="Lihat sekolah"><ChevronRight size={18}/></button></td></tr>)}</tbody></Table>:<EmptySchools/>}</section></>}
function AdminFilters({announce}:{announce?:(message:string)=>void}){return <section className="admin-filters card"><label>Tahun<select><option>2026</option></select></label><label>Zon<select><option>Semua zon</option><option>Bandar</option><option>Sedili</option></select></label><label>Mata pelajaran<select><option>Bahasa Melayu</option><option>Matematik</option></select></label><label>Headcount<select><option>AR 3</option><option>AR 2</option></select></label><button className="outline" onClick={()=>announce?.("Gunakan pilihan tahun, zon, mata pelajaran dan tempoh untuk menapis data.")}><Filter size={16}/>Lagi penapis</button></section>}
function SchoolCell({school}:{school:SchoolRecord}){return <div className="school-cell"><i><School size={18}/></i><span><strong>{school.name}</strong><small>{school.code}</small></span></div>}
function EmptySchools(){return <div className="empty-state"><i><Building2 size={24}/></i><strong>Belum ada sekolah dalam Google Sheets</strong><p>Tambah rekod pertama di sini atau isi tab SEKOLAH. Data contoh lama tidak lagi dipaparkan.</p></div>}

function SchoolsView({schools,loading,announce,addSchool,deleteSchool,clearSchools}:{schools:SchoolRecord[];loading:boolean;announce:(message:string)=>void;addSchool:(payload:{code:string;name:string;zone:string})=>Promise<void>;deleteSchool:(school:SchoolRecord)=>Promise<void>;clearSchools:(confirmation:string)=>Promise<void>}){const [dialog,setDialog]=useState<"add"|"clear"|null>(null),[target,setTarget]=useState<SchoolRecord|null>(null),[query,setQuery]=useState("");const visible=schools.filter(s=>(s.name+" "+s.code+" "+s.zone).toLowerCase().includes(query.toLowerCase()));return <><Heading eyebrow="PENGURUSAN ORGANISASI" title="Sekolah" desc="Data langsung daripada tab SEKOLAH dalam Google Sheets."><button className="primary" onClick={()=>setDialog("add")}><Plus size={18}/>Tambah Sekolah</button></Heading><section className="card table-card"><Toolbar query={query} setQuery={setQuery}><button className="outline" onClick={()=>announce("Carian merangkumi nama, kod dan zon sekolah.")}><Filter size={16}/>Semua zon</button><button className="outline" onClick={()=>{downloadCsvFile("senarai-sekolah.csv",[["Sekolah","Kod","Zon","Guru","Murid","Pencapaian","Status"],...visible.map(s=>[s.name,s.code,s.zone,s.teacherCount,s.studentCount,s.achievement,s.status])]);announce("Senarai sekolah telah dieksport.")}}><Download size={16}/>Eksport</button><button className="outline danger-button" disabled={!schools.length} onClick={()=>setDialog("clear")}><Trash2 size={16}/>Clear Data</button></Toolbar>{loading?<div className="empty-state"><strong>Memuatkan data sekolah…</strong></div>:visible.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>GURU</th><th>MURID</th><th>PENCAPAIAN</th><th>STATUS</th><th/></tr></thead><tbody>{visible.map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.teacherCount} guru</td><td>{s.studentCount}</td><td><div className="progress-cell"><span><i style={{width:`${s.achievement}%`}}/></span><b>{s.achievement}%</b></div></td><td><Status text={s.status}/></td><td><button className="icon danger-icon" onClick={()=>setTarget(s)} aria-label={`Padam ${s.name}`} title="Padam sekolah"><Trash2 size={17}/></button></td></tr>)}</tbody></Table>:<EmptySchools/>}</section>{dialog==="add"&&<SchoolModal close={()=>setDialog(null)} save={async payload=>{await addSchool(payload);setDialog(null)}}/>}{target&&<DeleteSchoolModal school={target} close={()=>setTarget(null)} confirm={async()=>{await deleteSchool(target);setTarget(null)}}/>}{dialog==="clear"&&<ClearSchoolsModal close={()=>setDialog(null)} confirm={async text=>{await clearSchools(text);setDialog(null)}}/>}</>}

function AdminHeadcount({schools,announce}:{schools:SchoolRecord[];announce:(message:string)=>void}){return <><Heading eyebrow="ANALISIS DAERAH" title="Headcount" desc="Ringkasan semasa mengikut sekolah daripada Google Sheets."><button className="outline" onClick={()=>{downloadCsvFile("headcount-daerah.csv",[["Sekolah","Kod","Zon","Murid","Pencapaian"],...schools.map(s=>[s.name,s.code,s.zone,s.studentCount,s.achievement])]);announce("Data headcount daerah telah dieksport.")}}><Download size={17}/>Eksport Data</button></Heading><AdminFilters announce={announce}/><section className="card table-card"><CardHeader title="Ringkasan Mengikut Sekolah" desc="Pencapaian dikira daripada penilaian terkini"/>{schools.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>PENCAPAIAN</th><th>PENGHANTARAN</th></tr></thead><tbody>{schools.map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td>{s.achievement}%</td><td><Status text={s.submissionStatus}/></td></tr>)}</tbody></Table>:<EmptySchools/>}</section></>}

function AdminInterventions(){return <><Heading eyebrow="PEMANTAUAN DAERAH" title="Intervensi" desc="Analisis status dan keberkesanan intervensi semua sekolah."/><section className="stat-grid four"><Stat label="Intervensi Aktif" value={168} detail="42 sekolah" Icon={Activity} tone="blue"/><Stat label="Berjaya" value={94} detail="56% keberkesanan" Icon={CheckCircle2} tone="green"/><Stat label="Lewat Semakan" value={23} detail="Perlu tindakan guru" Icon={Clock3} tone="red"/><Stat label="Intervensi Lanjutan" value={31} detail="Strategi baharu" Icon={RotateCcw} tone="amber"/></section><section className="analysis-grid"><article className="card ranking"><CardHeader title="Kaedah Paling Berkesan" desc="Berdasarkan hasil intervensi"/>{[["Bimbingan individu",82],["Bacaan berulang",74],["ABM manipulatif",68],["Kumpulan kecil",61]].map(([n,v],i)=><div key={n as string}><b>{i+1}</b><span><strong>{n as string}</strong><i><em style={{width:`${v}%`}}/></i></span><small>{v}%</small></div>)}</article><article className="card intervention-chart admin"><CardHeader title="Status Keseluruhan" desc="Semua rekod tahun 2026"/><div><div className="donut"><span><strong>262</strong><small>Jumlah</small></span></div><ul><li><i className="blue"/>Aktif <b>168</b></li><li><i className="green"/>Berjaya <b>94</b></li><li><i className="amber"/>Lanjutan <b>31</b></li><li><i className="red"/>Lewat <b>23</b></li></ul></div></article></section></>}

function Submissions({schools,announce}:{schools:SchoolRecord[];announce:(m:string)=>void}){const submitted=schools.filter(s=>/hantar|sah|kunci/i.test(s.submissionStatus)).length,drafts=schools.filter(s=>/draf/i.test(s.submissionStatus)).length;return <><Heading eyebrow="PEMANTAUAN DATA" title="Status Penghantaran" desc="Status terkini yang direkodkan dalam Google Sheets."><button className="outline" onClick={()=>announce("Tarikh tutup penghantaran AR 3 ialah 21 Ogos 2026.")}><CalendarDays size={17}/>Tarikh Tutup: 21 Ogos</button></Heading><section className="submission-summary card"><div><strong>{submitted}</strong><small>Telah hantar</small></div><div><strong>{drafts}</strong><small>Dalam draf</small></div><div><strong>{schools.length-submitted-drafts}</strong><small>Belum mula</small></div><div><strong>{schools.filter(s=>/sah|kunci/i.test(s.submissionStatus)).length}</strong><small>Telah disahkan</small></div></section><section className="card table-card"><Toolbar><button className="outline" onClick={()=>announce("Semua status penghantaran sedang dipaparkan.")}><Filter size={16}/>Semua status</button><button className="outline" onClick={()=>{downloadCsvFile("status-penghantaran.csv",[["Sekolah","Kod","Zon","Status terkini"],...schools.map(s=>[s.name,s.code,s.zone,s.submissionStatus])]);announce("Status penghantaran telah dieksport.")}}><Download size={16}/>Eksport</button></Toolbar>{schools.length?<Table><thead><tr><th>SEKOLAH</th><th>ZON</th><th>MURID</th><th>STATUS TERKINI</th><th>TINDAKAN</th></tr></thead><tbody>{schools.map(s=><tr key={s.id}><td><SchoolCell school={s}/></td><td>{s.zone}</td><td>{s.studentCount}</td><td><Status text={s.submissionStatus}/></td><td><button className="outline small" onClick={()=>announce(`Status ${s.name}: ${s.submissionStatus}`)}><ClipboardCheck size={15}/>Semak</button></td></tr>)}</tbody></Table>:<EmptySchools/>}</section></>}

function UsersView({announce}:{announce:(message:string)=>void}){const data=[["Guru Contoh","guru@moe-dl.edu.my","SK Semangar","Guru"],["Farah Nabila","farah@moe-dl.edu.my","SK Sedili Kecil","Guru"],["Mohd Azlan","azlan@moe-dl.edu.my","PPD Kota Tinggi","Admin"],["Siti Rafidah","rafidah@moe-dl.edu.my","SK Teluk Ramunia","Guru"]];return <><Heading eyebrow="AKSES SISTEM" title="Pengguna" desc="Urus akaun, peranan dan sekolah bagi setiap pengguna."><button className="primary" onClick={()=>announce("Tambah pengguna baharu melalui tab PENGGUNA dalam Google Sheets buat masa ini.")}><Plus size={18}/>Tambah Pengguna</button></Heading><section className="card table-card"><Toolbar><button className="outline" onClick={()=>announce("Semua peranan pengguna sedang dipaparkan.")}><Filter size={16}/>Semua peranan</button></Toolbar><Table><thead><tr><th>PENGGUNA</th><th>E-MEL</th><th>SEKOLAH / ORGANISASI</th><th>PERANAN</th><th>STATUS</th><th/></tr></thead><tbody>{data.map(([name,email,school,userRole])=><tr key={email}><td><div className="student-cell"><b>{initials(name)}</b><span><strong>{name}</strong><small>Log masuk 2 hari lalu</small></span></div></td><td>{email}</td><td>{school}</td><td><span className="role-badge">{userRole==="Admin"?<ShieldCheck size={14}/>:<UserRound size={14}/>} {userRole}</span></td><td><Status text="Aktif"/></td><td><button className="icon" onClick={()=>announce("Urus akaun pengguna melalui tab PENGGUNA dalam Google Sheets.")} aria-label="Pilihan pengguna"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></Table></section></>}

function Audit({announce}:{announce:(message:string)=>void}){const data=[["Mohd Azlan","Mengesahkan penghantaran AR 3","SK Bandar Penawar 2","Hari ini, 10:34 pagi"],["Guru Contoh","Mengemas kini kemahiran murid","ST001 · KP9 → KP10","Hari ini, 9:42 pagi"],["Siti Rafidah","Menghantar data AR 3","SK Teluk Ramunia","Semalam, 4:32 petang"],["Mohd Azlan","Membuka semula cycle AR 2","SK Sedili Kecil","11 Ogos, 2:05 petang"]];return <><Heading eyebrow="JEJAK SISTEM" title="Audit Log" desc="Rekod semua perubahan dan tindakan penting dalam sistem."><button className="outline" onClick={()=>{downloadCsvFile("audit-log.csv",[["Pengguna","Tindakan","Konteks","Masa"],...data]);announce("Audit log telah dieksport.")}}><Download size={17}/>Eksport Log</button></Heading><section className="card audit"><Toolbar><button className="outline" onClick={()=>announce("Paparan audit ditetapkan kepada 30 hari terakhir.")}><CalendarDays size={16}/>30 hari terakhir</button></Toolbar>{data.map(([user,action,context,time],i)=><article key={time}><i className={`a${i}`}><History size={17}/></i><span><strong>{action}</strong><p><b>{user}</b> · {context}</p></span><small>{time}</small><button className="icon" onClick={()=>announce(action+" · "+context)} aria-label="Butiran audit"><ChevronRight size={17}/></button></article>)}</section></>}

function SettingsView({profile,onEdit,reset}:{profile:UserProfile|null;onEdit:()=>void;reset:()=>void}){const name=profile?.name||"Pengguna Google",role=profile?.role==="ADMIN"?"Pentadbir Sistem":"Guru Pemulihan Khas";return <><Heading eyebrow="KONFIGURASI" title="Profil & Tetapan" desc="Urus profil, pilihan sistem dan data demo."/><section className="settings-grid"><article className="card profile-settings"><b>{initials(name)||"PG"}</b><span><h2>{name}</h2><p>{role}</p><small>{profile?.email||"Log masuk Google untuk memuatkan profil"}</small></span><button className="outline" onClick={onEdit} disabled={!profile}>Kemas kini Profil</button></article><article className="card settings-list"><h2>Tetapan Sistem</h2><div><span><Bell size={19}/><i><strong>Notifikasi tarikh semakan</strong><small>Terima peringatan intervensi yang perlu disemak</small></i></span><label className="switch"><input type="checkbox" defaultChecked/><i/></label></div><div><span><CheckCircle2 size={19}/><i><strong>Autosave</strong><small>Simpan perubahan penilaian secara automatik</small></i></span><label className="switch"><input type="checkbox" defaultChecked/><i/></label></div><div><span><CalendarDays size={19}/><i><strong>Tahun data aktif</strong><small>Tahun semasa bagi paparan sistem</small></i></span><select><option>2026</option><option>2027</option></select></div></article><article className="card danger"><div><RotateCcw size={20}/><span><strong>Pulihkan data demo</strong><p>Kembalikan semua data murid kepada keadaan asal prototaip.</p></span></div><button className="outline" onClick={reset}>Pulihkan Data</button></article></section></>}

function StudentDrawer({student,close,intervention}:{student:Student;close:()=>void;intervention:()=>void}){return <div className="layer drawer-layer"><button className="backdrop" onClick={close}/><aside className="drawer"><header><span><small>PROFIL MURID</small><h2>{student.name}</h2><p>Tahun {student.year} · {student.className}</p></span><button className="icon" onClick={close}><X size={20}/></button></header><main><section className="profile-hero"><b>{initials(student.name)}</b><span><Status text={student.status}/><p>{student.id} · {student.subject}</p><small>Mula Pemulihan: {date(student.startDate)}</small></span></section><section><Title title="Perkembangan Headcount" desc="Kemajuan kemahiran sepanjang 2026"><Delta n={student.skills["AR 3"]-student.skills.TOV}/></Title><div className="student-timeline">{(["TOV","AR 1","AR 2","AR 3","ETR"] as Cycle[]).map((c,i)=><div key={c} className={c==="ETR"?"target":""}><small>{c}</small><strong>{kp(student.skills[c])}</strong>{i<4&&<ArrowRight size={16}/>}</div>)}</div></section><section><Title title="Status Semasa" desc="Penilaian AR 3"/><div className="profile-stats"><div><small>Kemahiran</small><strong>{kp(student.skills["AR 3"])}</strong></div><div><small>Sasaran ETR</small><strong>{kp(student.skills.ETR)}</strong></div><div><small>Intervensi</small><Status text={student.intervention}/></div></div></section><section><Title title="Timeline Intervensi" desc="Hubungan intervensi dengan pencapaian"/><div className="mini-timeline"><div><i/><span><strong>12 Mac 2026</strong><p>Intervensi bacaan suku kata KV</p></span></div><div><i/><span><strong>25 Mac 2026</strong><p><b>KP4 → KP6</b> · Meningkat</p></span></div><div><i/><span><strong>10 April 2026</strong><p>Intervensi perkataan KVK</p></span></div></div></section></main><footer><button className="outline" onClick={()=>window.print()}><FileText size={17}/>Cetak Profil</button><button className="primary" onClick={intervention}><Plus size={17}/>Rekod Intervensi</button></footer></aside></div>}
function Title({title,desc,children}:{title:string;desc:string;children?:React.ReactNode}){return <div className="section-title"><span><h3>{title}</h3><p>{desc}</p></span>{children}</div>}
function Modal({title,desc,close,children,footer}:{title:string;desc:string;close:()=>void;children:React.ReactNode;footer:React.ReactNode}){return <div className="layer modal-layer"><button className="backdrop" onClick={close}/><div className="modal"><header><span><h2>{title}</h2><p>{desc}</p></span><button className="icon" onClick={close}><X size={20}/></button></header><main>{children}</main><footer>{footer}</footer></div></div>}

function ProfileModal({profile,saving,close,save}:{profile:UserProfile;saving:boolean;close:()=>void;save:(name:string)=>void}){const [name,setName]=useState(profile.name);const valid=name.trim().length>=2;return <Modal title="Kemas kini Profil" desc="Nama disimpan dalam tab PENGGUNA. E-mel, peranan dan sekolah dikawal oleh pentadbir." close={close} footer={<><button className="outline" onClick={close} disabled={saving}>Batal</button><button className="primary" disabled={!valid||saving} onClick={()=>save(name.trim())}><Check size={17}/>{saving?"Menyimpan...":"Simpan Profil"}</button></>}><div className="form-grid"><label className="full">Nama penuh<input autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="Nama penuh pengguna"/></label><label className="full">E-mel Google<input value={profile.email} readOnly/></label><label>Peranan<input value={profile.role==="ADMIN"?"Pentadbir Sistem":"Guru Pemulihan Khas"} readOnly/></label><label>Sekolah<input value={profile.schoolName||"Akses semua sekolah"} readOnly/></label></div></Modal>}

function SchoolModal({close,save}:{close:()=>void;save:(payload:{code:string;name:string;zone:string})=>Promise<void>}){const [code,setCode]=useState(""),[name,setName]=useState(""),[zone,setZone]=useState(""),[saving,setSaving]=useState(false);const valid=code.trim().length>=3&&name.trim().length>=3&&zone.trim().length>=2;const submit=async()=>{if(!valid)return;setSaving(true);try{await save({code:code.trim(),name:name.trim(),zone:zone.trim()})}catch{}finally{setSaving(false)}};return <Modal title="Tambah Sekolah" desc="Rekod ini akan disimpan terus dalam tab SEKOLAH." close={close} footer={<><button className="outline" onClick={close} disabled={saving}>Batal</button><button className="primary" onClick={()=>void submit()} disabled={!valid||saving}><Plus size={17}/>{saving?"Menyimpan...":"Tambah Sekolah"}</button></>}><div className="form-grid"><label>Kod sekolah<input autoFocus value={code} onChange={e=>setCode(e.target.value)} placeholder="Contoh: JBA3012"/></label><label>Zon<input value={zone} onChange={e=>setZone(e.target.value)} placeholder="Contoh: Bandar"/></label><label className="full">Nama sekolah<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nama rasmi sekolah"/></label></div></Modal>}

function DeleteSchoolModal({school,close,confirm}:{school:SchoolRecord;close:()=>void;confirm:()=>Promise<void>}){const [text,setText]=useState(""),[busy,setBusy]=useState(false),valid=text===school.code;const run=async()=>{if(!valid)return;setBusy(true);try{await confirm()}catch{}finally{setBusy(false)}};return <Modal title="Padam Sekolah?" desc="Tindakan ini hanya dibenarkan jika sekolah tiada pengguna, murid atau penghantaran berkaitan." close={close} footer={<><button className="outline" onClick={close} disabled={busy}>Batal</button><button className="primary danger-primary" onClick={()=>void run()} disabled={!valid||busy}><Trash2 size={17}/>{busy?"Memadam...":"Padam Sekolah"}</button></>}><div className="delete-confirm"><AlertCircle size={27}/><p>Taip kod <strong>{school.code}</strong> untuk mengesahkan pemadaman <b>{school.name}</b>.</p><input autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder={school.code}/></div></Modal>}

function ClearSchoolsModal({close,confirm}:{close:()=>void;confirm:(text:string)=>Promise<void>}){const phrase="PADAM SEMUA SEKOLAH",[text,setText]=useState(""),[busy,setBusy]=useState(false),valid=text===phrase;const run=async()=>{if(!valid)return;setBusy(true);try{await confirm(text)}catch{}finally{setBusy(false)}};return <Modal title="Clear Semua Data Sekolah?" desc="Header tab SEKOLAH akan dikekalkan. Tindakan akan ditolak jika rekod masih digunakan." close={close} footer={<><button className="outline" onClick={close} disabled={busy}>Batal</button><button className="primary danger-primary" onClick={()=>void run()} disabled={!valid||busy}><Trash2 size={17}/>{busy?"Mengosongkan...":"Clear Data"}</button></>}><div className="delete-confirm"><AlertCircle size={27}/><p>Taip tepat <strong>{phrase}</strong> untuk mengesahkan.</p><input autoFocus value={text} onChange={e=>setText(e.target.value)} placeholder={phrase}/></div></Modal>}

function AddModal({close,save}:{close:()=>void;save:(s:Student)=>void}){const [name,setName]=useState(""),[year,setYear]=useState(1),[className,setClass]=useState("1 Cekal"),[subject,setSubject]=useState<Subject>("Bahasa Melayu");const submit=()=>name.trim()&&save({id:`ST${String(Date.now()).slice(-4)}`,name:name.trim(),year,className,subject,status:"Aktif",startDate:"2026-08-13",skills:S(1,1,1,1,10),intervention:"Tiada"});return <Modal title="Tambah Murid" desc="Masukkan maklumat asas murid Pemulihan Khas." close={close} footer={<><button className="outline" onClick={close}>Batal</button><button className="primary" disabled={!name.trim()} onClick={submit}><Plus size={17}/>Tambah Murid</button></>}><div className="form-grid"><label className="full">Nama murid<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Nama penuh murid"/></label><label>Tahun<select value={year} onChange={e=>setYear(Number(e.target.value))}><option value="1">Tahun 1</option><option value="2">Tahun 2</option><option value="3">Tahun 3</option></select></label><label>Kelas<input value={className} onChange={e=>setClass(e.target.value)}/></label><label className="full">Mata pelajaran<select value={subject} onChange={e=>setSubject(e.target.value as Subject)}><option>Bahasa Melayu</option><option>Matematik</option></select></label><label className="full">Tarikh mula Pemulihan<input type="date" defaultValue="2026-08-13"/></label></div></Modal>}

function InterventionModal({students,selected,close,save}:{students:Student[];selected:Student|null;close:()=>void;save:(i:Intervention)=>void}){const [studentId,setStudentId]=useState(selected?.id||students[0]?.id||""),[issue,setIssue]=useState("Lemah membaca perkataan"),[action,setAction]=useState(""),[method,setMethod]=useState("Bimbingan individu");const student=students.find(s=>s.id===studentId);if(!student)return <Modal title="Rekod Intervensi" desc="Rancang tindakan berdasarkan keperluan murid." close={close} footer={<button className="outline" onClick={close}>Tutup</button>}><div className="empty-state modal-empty"><i><Users size={24}/></i><strong>Tiada murid tersedia</strong><p>Tambah atau selaraskan murid daripada Google Sheets sebelum merekod intervensi.</p></div></Modal>;return <Modal title="Rekod Intervensi" desc="Rancang tindakan berdasarkan keperluan murid." close={close} footer={<><button className="outline" onClick={close}>Batal</button><button className="primary" disabled={!action.trim()} onClick={()=>save({id:`IV${Date.now()}`,studentId,issue,action,method,start:"2026-08-13",review:"2026-08-27",status:"Sedang dilaksanakan"})}><Check size={17}/>Simpan Intervensi</button></>}><div className="intervention-form"><label>Murid<select value={studentId} onChange={e=>setStudentId(e.target.value)}>{students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="selected-summary"><b>{initials(student.name)}</b><span><strong>{student.name}</strong><small>{student.className} · Kemahiran semasa {kp(student.skills["AR 3"])}</small></span></div><label>Isu dikenal pasti<select value={issue} onChange={e=>setIssue(e.target.value)}><option>Keliru huruf</option><option>Lemah membunyikan suku kata</option><option>Lemah menggabung suku kata</option><option>Lemah membaca perkataan</option><option>Lemah menulis</option><option>Tidak mengingat kemahiran</option><option>Kurang fokus</option><option>Kehadiran</option></select></label><label>Intervensi dilaksanakan<textarea rows={3} value={action} onChange={e=>setAction(e.target.value)} placeholder="Contoh: Latihan bacaan perkataan KVK menggunakan kad imbas."/></label><div className="form-grid"><label>Kaedah<select value={method} onChange={e=>setMethod(e.target.value)}><option>Bimbingan individu</option><option>Kumpulan kecil</option><option>Latih tubi</option><option>Permainan</option><option>ABM manipulatif</option><option>Bacaan berulang</option></select></label><label>Kekerapan<select><option>3 kali seminggu</option><option>2 kali seminggu</option><option>Setiap hari</option></select></label><label>Tarikh mula<input type="date" defaultValue="2026-08-13"/></label><label>Tarikh semakan<input type="date" defaultValue="2026-08-27"/></label></div><label className="upload"><Upload size={20}/><span><strong>Muat naik evidens</strong><small>Gambar atau PDF, maksimum 10MB</small></span><input type="file" accept="image/*,.pdf"/></label></div></Modal>}

function Confirm({cycle,close,confirm}:{cycle:Cycle;close:()=>void;confirm:()=>void}){return <Modal title={`Hantar Data ${cycle}?`} desc="Data akan dihantar kepada admin untuk semakan." close={close} footer={<><button className="outline" onClick={close}>Kembali</button><button className="primary" onClick={confirm}><Upload size={17}/>Ya, Hantar Data</button></>}><div className="confirm"><i><ClipboardCheck size={26}/></i><h3>Pastikan semua rekod telah lengkap</h3><p>Selepas admin mengesahkan dan mengunci cycle ini, data tidak boleh diubah tanpa kebenaran admin.</p><span><CheckCircle2 size={17}/>25 rekod murid lengkap</span><span><CheckCircle2 size={17}/>Tiada kemahiran tidak sah</span></div></Modal>}
