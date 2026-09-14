import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const API_VERSION = "2.0.0";
const GOOGLE_CLIENT_ID = "491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com";
const ALLOWED_ORIGINS = new Set([
  "https://sihadir-headcount.geek2606.chatgpt.site",
  "https://myheadcountkt.vercel.app",
  "http://localhost:3000",
]);
const CYCLES = new Set(["TOV", "OTI 1", "AR 1", "OTI 2", "AR 2", "OTI 3", "AR 3", "ETR"]);
const SUBJECTS = new Set(["Bahasa Melayu", "Matematik"]);
const SESSION_SECONDS = 21600;

type Row = Record<string, any>;
type Actor = { user_id: string; role: "ADMIN" | "GURU"; school_id: string; email: string; nama: string; auth_type: "GOOGLE" | "SCHOOL_CODE" };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://sihadir-headcount.geek2606.chatgpt.site";
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
}
function fail(code: string, message: string, status = 400): never { throw Object.assign(new Error(message), { code, status }); }
function text(value: unknown) { return String(value ?? "").trim(); }
function lower(value: unknown) { return text(value).toLowerCase(); }
function upper(value: unknown) { return text(value).toUpperCase(); }
function required(value: unknown, label: string, max = 5000) { const valueText = text(value); if (!valueText) fail("VALIDATION_ERROR", `${label} diperlukan.`); if (valueText.length > max) fail("VALIDATION_ERROR", `${label} terlalu panjang.`); return valueText; }
function uuid() { return crypto.randomUUID(); }
function normalizeSubject(value: unknown) { const subject = text(value); if (!SUBJECTS.has(subject)) fail("INVALID_SUBJECT", "Mata pelajaran tidak sah."); return subject; }
function normalizeCycle(value: unknown) { const cycle = upper(value).replace(/OTI\s*(\d)/, "OTI $1").replace(/AR\s*(\d)/, "AR $1"); if (!CYCLES.has(cycle)) fail("INVALID_CYCLE", "Kitaran headcount tidak sah."); return cycle; }
function normalizeSkill(value: unknown) { const match = upper(value).match(/^(?:KP)?\s*(\d{1,2})$/); const number = Number(match?.[1]); if (!number || number < 1 || number > 32) fail("INVALID_SKILL", "Kemahiran mesti antara KP1 hingga KP32."); return `KP${number}`; }
function skillNumber(value: unknown) { return Number(normalizeSkill(value).slice(2)); }
function isoDate(value: unknown, label: string) { const date = text(value).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail("INVALID_DATE", `${label} tidak sah.`); return date; }
function publicError(error: any) { return { code: error?.code || "SERVER_ERROR", message: error?.message || "Ralat pelayan Supabase." }; }

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function audit(actor: Actor, tindakan: string, before: unknown, after: unknown) {
  await supabase.from("audit_logs").insert({ user_id: actor.user_id, role: actor.role, school_id: actor.school_id || null, tindakan, data_lama: before || null, data_baharu: after || null });
}
async function one(table: string, column: string, value: string) {
  const { data, error } = await supabase.from(table).select("*").eq(column, value).maybeSingle();
  if (error) fail("DATABASE_ERROR", error.message, 500);
  return data as Row | null;
}
async function verifyGoogle(input: Row): Promise<Actor> {
  const token = required(input.idToken || input.id_token || input.credential, "Token Google", 12000);
  const response = await fetch("https://oauth2.googleapis.com/tokeninfo", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ id_token: token }) });
  if (!response.ok) fail("INVALID_GOOGLE_TOKEN", "Token Google tidak sah atau telah tamat tempoh.", 401);
  const claims = await response.json() as Row;
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== GOOGLE_CLIENT_ID) fail("INVALID_TOKEN_AUDIENCE", "Token Google bukan untuk aplikasi ini.", 401);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) fail("INVALID_TOKEN_ISSUER", "Penerbit token Google tidak sah.", 401);
  if (Number(claims.exp) <= now || Number(claims.iat) > now + 300) fail("GOOGLE_TOKEN_EXPIRED", "Token Google telah tamat tempoh. Log masuk semula.", 401);
  if (claims.email_verified !== true && claims.email_verified !== "true") fail("EMAIL_NOT_VERIFIED", "E-mel Google belum disahkan.", 401);
  const email = lower(claims.email), sub = required(claims.sub, "Identiti Google", 255);
  let { data: user, error } = await supabase.from("app_users").select("*").eq("google_sub", sub).maybeSingle();
  if (error) fail("DATABASE_ERROR", error.message, 500);
  if (!user) {
    const byEmail = await supabase.from("app_users").select("*").eq("email", email).maybeSingle();
    if (byEmail.error) fail("DATABASE_ERROR", byEmail.error.message, 500);
    user = byEmail.data;
    if (!user) fail("USER_NOT_REGISTERED", "Akaun Google ini belum didaftarkan sebagai pentadbir.", 403);
    if (user.google_sub && user.google_sub !== sub) fail("GOOGLE_IDENTITY_MISMATCH", "Akaun ini telah dipautkan kepada identiti Google lain.", 403);
    const linked = await supabase.from("app_users").update({ google_sub: sub, updated_at: new Date().toISOString() }).eq("user_id", user.user_id).select("*").single();
    if (linked.error) fail("DATABASE_ERROR", linked.error.message, 500);
    user = linked.data;
  }
  if (upper(user.status) !== "AKTIF" || upper(user.role) !== "ADMIN") fail("ADMIN_ACCESS_DENIED", "Akaun ini tidak mempunyai akses pentadbir aktif.", 403);
  return { user_id: user.user_id, role: "ADMIN", school_id: "", email, nama: user.nama, auth_type: "GOOGLE" };
}
async function verifySchool(input: Row): Promise<Actor> {
  const token = required(input.schoolSessionToken || input.school_session_token || input.sessionToken || input.session_token, "Sesi sekolah", 500);
  const hash = await sha256(token);
  const { data: session, error } = await supabase.from("school_sessions").select("*, schools(*)").eq("token_hash", hash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) fail("DATABASE_ERROR", error.message, 500);
  if (!session || !session.schools || upper(session.schools.status) !== "AKTIF") fail("SCHOOL_SESSION_EXPIRED", "Sesi sekolah tamat. Masukkan kod sekolah semula.", 401);
  return { user_id: `SCHOOL-${session.school_id}`, role: "GURU", school_id: session.school_id, email: "", nama: `Guru ${session.schools.nama_sekolah}`, auth_type: "SCHOOL_CODE" };
}
async function actorFor(input: Row) { return input.schoolSessionToken || input.school_session_token || input.sessionToken || input.session_token ? verifySchool(input) : verifyGoogle(input); }
function assertAdmin(actor: Actor) { if (actor.role !== "ADMIN") fail("ADMIN_REQUIRED", "Akses pentadbir diperlukan.", 403); }
function assertGuru(actor: Actor) { if (actor.role !== "GURU") fail("ROLE_FORBIDDEN", "Tindakan ini hanya untuk guru sekolah.", 403); }

async function loginSchool(input: Row) {
  const code = upper(required(input.schoolCode || input.school_code || input.code, "Kod sekolah", 30));
  if (!/^[A-Z0-9-]+$/.test(code)) fail("INVALID_SCHOOL_CODE_FORMAT", "Kod sekolah hanya boleh mengandungi huruf, nombor dan sempang.");
  const codeHash = await sha256(code);
  const attempt = await one("login_attempts", "code_hash", codeHash);
  if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > Date.now()) fail("LOGIN_RATE_LIMITED", "Terlalu banyak cubaan. Cuba semula selepas 15 minit.", 429);
  const { data: school, error } = await supabase.from("schools").select("*").eq("kod_sekolah", code).ilike("status", "Aktif").maybeSingle();
  if (error) fail("DATABASE_ERROR", error.message, 500);
  if (!school) {
    const failures = Number(attempt?.failures || 0) + 1;
    await supabase.from("login_attempts").upsert({ code_hash: codeHash, failures, blocked_until: failures >= 5 ? new Date(Date.now() + 900000).toISOString() : null, updated_at: new Date().toISOString() });
    fail("INVALID_SCHOOL_CODE", "Kod sekolah tidak sah atau sekolah tidak aktif.", 401);
  }
  await supabase.from("login_attempts").delete().eq("code_hash", codeHash);
  const token = `${uuid()}${uuid()}`.replace(/-/g, "");
  await supabase.from("school_sessions").insert({ token_hash: await sha256(token), school_id: school.school_id, school_code: school.kod_sekolah, expires_at: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString() });
  return { session_token: token, expires_in: SESSION_SECONDS, profile: profile({ user_id: `SCHOOL-${school.school_id}`, role: "GURU", school_id: school.school_id, email: "", nama: `Guru ${school.nama_sekolah}`, auth_type: "SCHOOL_CODE" }, school) };
}

function profile(actor: Actor, school?: Row | null) { return { user_id: actor.user_id, email: actor.email, nama: actor.nama, role: actor.role, school_id: actor.school_id, school_name: school?.nama_sekolah || "", school_code: school?.kod_sekolah || "", school_zone: school?.zon || "" }; }

async function getStudents(actor: Actor) {
  let query = supabase.from("students").select("*").order("nama");
  if (actor.role === "GURU") query = query.eq("school_id", actor.school_id);
  const { data: students, error } = await query;
  if (error) fail("DATABASE_ERROR", error.message, 500);
  const ids = (students || []).map(row => row.student_id);
  if (!ids.length) return [];
  const [assessmentResult, targetResult, interventionResult] = await Promise.all([
    supabase.from("assessments").select("*").in("student_id", ids),
    supabase.from("targets").select("*").in("student_id", ids),
    supabase.from("interventions").select("student_id,status").in("student_id", ids),
  ]);
  if (assessmentResult.error || targetResult.error || interventionResult.error) fail("DATABASE_ERROR", assessmentResult.error?.message || targetResult.error?.message || interventionResult.error?.message || "Ralat membaca murid.", 500);
  const assessments = new Map<string, Row[]>(), targets = new Map<string, Row>(), interventionStatus = new Map<string, string>();
  for (const row of assessmentResult.data || []) assessments.set(row.student_id, [...(assessments.get(row.student_id) || []), row]);
  for (const row of targetResult.data || []) targets.set(row.student_id, row);
  for (const row of interventionResult.data || []) interventionStatus.set(row.student_id, row.status);
  return (students || []).map(row => ({ ...row, assessments: assessments.get(row.student_id) || [], targets: targets.get(row.student_id) || null, intervention_status: interventionStatus.get(row.student_id) || "Tiada" }));
}
async function ownedStudent(studentId: string, actor: Actor) {
  const student = await one("students", "student_id", studentId);
  if (!student) fail("STUDENT_NOT_FOUND", "Rekod murid tidak ditemui.", 404);
  if (actor.role === "GURU" && student.school_id !== actor.school_id) fail("STUDENT_ACCESS_DENIED", "Murid ini bukan di bawah sekolah anda.", 403);
  return student;
}
async function getInterventions(actor: Actor) {
  let query = supabase.from("interventions").select("*, students!inner(nama,school_id,schools(nama_sekolah))").order("tarikh_mula", { ascending: false });
  if (actor.role === "GURU") query = query.eq("students.school_id", actor.school_id);
  const { data, error } = await query;
  if (error) fail("DATABASE_ERROR", error.message, 500);
  return (data || []).map((row: Row) => ({ ...row, student_name: row.students?.nama || "", school_id: row.students?.school_id || "", school_name: row.students?.schools?.nama_sekolah || "" }));
}

async function dispatch(action: string, input: Row, actor: Actor | null): Promise<unknown> {
  if (action === "getHealth") return { status: "ok", service: "myHeadcountKT Supabase", version: API_VERSION, database_ready: true, server_time: new Date().toISOString() };
  if (action === "loginSchool") return loginSchool(input);
  if (!actor) fail("AUTH_REQUIRED", "Log masuk diperlukan.", 401);
  if (action === "logoutSchool") { const token = required(input.schoolSessionToken || input.school_session_token, "Sesi sekolah"); await supabase.from("school_sessions").delete().eq("token_hash", await sha256(token)); return { logged_out: true }; }
  if (action === "getProfile") { const school = actor.school_id ? await one("schools", "school_id", actor.school_id) : null; return profile(actor, school); }
  if (action === "saveProfile") { assertAdmin(actor); const nama = required(input.name || input.nama, "Nama", 120); const result = await supabase.from("app_users").update({ nama, updated_at: new Date().toISOString() }).eq("user_id", actor.user_id).select("*").single(); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "SAVE_PROFILE", null, result.data); return profile({ ...actor, nama }); }
  if (action === "getAdmins") { assertAdmin(actor); const { data, error } = await supabase.from("app_users").select("*").eq("role", "ADMIN").order("nama"); if (error) fail("DATABASE_ERROR", error.message, 500); return (data || []).map(row => ({ ...row, is_current: row.user_id === actor.user_id })); }
  if (action === "saveAdmin") { assertAdmin(actor); const email = lower(required(input.email, "E-mel", 254)), nama = required(input.name || input.nama, "Nama", 120); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("INVALID_EMAIL", "Masukkan alamat e-mel Google yang sah."); const count = await supabase.from("app_users").select("user_id", { count: "exact", head: true }).eq("role", "ADMIN").ilike("status", "Aktif"); const existing = await one("app_users", "email", email); if (!existing && Number(count.count || 0) >= 3) fail("ADMIN_LIMIT_REACHED", "Sistem dihadkan kepada maksimum tiga akaun pentadbir."); const record = { user_id: existing?.user_id || `ADMIN-${uuid()}`, email, nama, role: "ADMIN", school_id: null, status: "Aktif", updated_at: new Date().toISOString() }; const result = await supabase.from("app_users").upsert(record).select("*").single(); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "SAVE_ADMIN", existing, result.data); return { ...result.data, is_current: result.data.user_id === actor.user_id }; }
  if (action === "getSchoolDirectory") { const { data, error } = await supabase.from("schools").select("school_id,kod_sekolah,nama_sekolah,zon").ilike("status", "Aktif").order("nama_sekolah"); if (error) fail("DATABASE_ERROR", error.message, 500); return data; }
  if (action === "getStudents") return getStudents(actor);
  if (action === "getInterventions") return getInterventions(actor);
  if (action === "getInterventionGroups") { let query = supabase.from("intervention_groups").select("*").order("group_name"); if (actor.role === "GURU") query = query.eq("school_id", actor.school_id); const { data, error } = await query; if (error) fail("DATABASE_ERROR", error.message, 500); return (data || []).map(row => ({ ...row, student_ids_json: row.student_ids })); }
  if (action === "getTransfers") { let query = supabase.from("transfers").select("*, students(nama), from:schools!transfers_from_school_id_fkey(nama_sekolah), to:schools!transfers_to_school_id_fkey(nama_sekolah)").order("requested_at", { ascending: false }); if (actor.role === "GURU") query = query.or(`from_school_id.eq.${actor.school_id},to_school_id.eq.${actor.school_id}`); const { data, error } = await query; if (error) fail("DATABASE_ERROR", error.message, 500); return (data || []).map((row: Row) => ({ ...row, student_name: row.students?.nama || "", from_school_name: row.from?.nama_sekolah || "", to_school_name: row.to?.nama_sekolah || "" })); }
  if (action === "getSchools") { assertAdmin(actor); const [schoolResult, userResult, studentResult, assessmentResult, submissionResult] = await Promise.all([supabase.from("schools").select("*").order("nama_sekolah"), supabase.from("app_users").select("school_id,role,status"), supabase.from("students").select("student_id,school_id,status"), supabase.from("assessments").select("student_id,skill_code,tarikh").order("tarikh", { ascending: false }), supabase.from("submissions").select("*").order("submitted_at", { ascending: false })]); if (schoolResult.error) fail("DATABASE_ERROR", schoolResult.error.message, 500); return (schoolResult.data || []).map((school: Row) => { const schoolStudents = (studentResult.data || []).filter(row => row.school_id === school.school_id && upper(row.status) === "AKTIF"); const ids = new Set(schoolStudents.map(row => row.student_id)); const latest = new Map<string, number>(); for (const row of assessmentResult.data || []) if (ids.has(row.student_id) && !latest.has(row.student_id)) latest.set(row.student_id, Number(text(row.skill_code).replace("KP", "")) || 0); const achievement = latest.size ? Math.round([...latest.values()].reduce((a, b) => a + b, 0) / (latest.size * 32) * 100) : 0; const submission = (submissionResult.data || []).find(row => row.school_id === school.school_id); return { ...school, teacher_count: (userResult.data || []).filter(row => row.school_id === school.school_id && upper(row.status) === "AKTIF").length, student_count: schoolStudents.length, achievement_percent: achievement, submission_status: submission?.status || "Belum mula", access_code_configured: Boolean(school.access_code_hash), access_code_last4: school.access_code_last4 || "" }; }); }
  if (action === "saveSchool") { assertAdmin(actor); const schoolId = text(input.schoolId || input.school_id) || `SCH-${uuid()}`, existing = await one("schools", "school_id", schoolId); const record = { school_id: schoolId, kod_sekolah: upper(required(input.code || input.kod_sekolah, "Kod sekolah", 30)), nama_sekolah: required(input.name || input.nama_sekolah, "Nama sekolah", 200), zon: required(input.zone || input.zon, "Zon", 100), status: upper(input.status || "AKTIF") === "AKTIF" ? "Aktif" : "Tidak Aktif", updated_at: new Date().toISOString() }; const result = await supabase.from("schools").upsert(record).select("*").single(); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "SAVE_SCHOOL", existing, result.data); return result.data; }
  if (action === "deleteSchool") { assertAdmin(actor); const schoolId = required(input.schoolId || input.school_id, "schoolId"); const refs = await Promise.all([supabase.from("app_users").select("user_id", { count: "exact", head: true }).eq("school_id", schoolId), supabase.from("students").select("student_id", { count: "exact", head: true }).eq("school_id", schoolId), supabase.from("submissions").select("school_id", { count: "exact", head: true }).eq("school_id", schoolId)]); if (refs.some(result => Number(result.count || 0) > 0)) fail("SCHOOL_IN_USE", "Sekolah masih mempunyai pengguna, murid atau penghantaran."); const result = await supabase.from("schools").delete().eq("school_id", schoolId); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); return { deleted: true }; }
  if (action === "clearSchools") { assertAdmin(actor); if (text(input.confirmation) !== "PADAM SEMUA SEKOLAH") fail("CONFIRMATION_REQUIRED", "Taip PADAM SEMUA SEKOLAH untuk mengesahkan."); const refs = await supabase.from("students").select("student_id", { count: "exact", head: true }); if (Number(refs.count || 0)) fail("SCHOOLS_IN_USE", "Senarai sekolah masih mempunyai rekod berkaitan."); const result = await supabase.from("schools").delete().neq("school_id", ""); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); return { cleared: true }; }
  if (action === "clearAllData") { assertAdmin(actor); if (text(input.confirmation) !== "KOSONGKAN SEMUA DATA") fail("CONFIRMATION_REQUIRED", "Taip KOSONGKAN SEMUA DATA untuk mengesahkan."); const clearTargets: [string, string][] = [["audit_logs", "audit_id"], ["transfers", "transfer_id"], ["submissions", "school_id"], ["interventions", "intervention_id"], ["intervention_groups", "group_id"], ["targets", "student_id"], ["assessments", "assessment_id"], ["students", "student_id"], ["school_sessions", "token_hash"]]; for (const [table, key] of clearTargets) { const result = await supabase.from(table).delete().not(key, "is", null); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); } await supabase.from("app_users").delete().neq("role", "ADMIN"); return { cleared: true }; }
  if (action === "saveStudent") { assertGuru(actor); const subjects = Array.isArray(input.subjects) ? [...new Set(input.subjects.map(normalizeSubject))] : [normalizeSubject(input.subject)]; const studentId = text(input.studentId || input.student_id); if (studentId && subjects.length > 1) fail("VALIDATION_ERROR", "Kemas kini murid hanya untuk satu mata pelajaran."); const rows = subjects.map((subject: string) => ({ student_id: studentId || `ST-${uuid()}`, school_id: actor.school_id, nama: required(input.name || input.nama, "Nama murid", 300), tahun: Number(input.year || input.tahun), kelas: required(input.className || input.kelas, "Kelas", 100), tarikh_mula: input.startDate || input.tarikh_mula ? isoDate(input.startDate || input.tarikh_mula, "Tarikh mula") : new Date().toISOString().slice(0, 10), subject, status: text(input.status) || "Aktif", updated_at: new Date().toISOString() })); if (rows.some(row => row.tahun < 2 || row.tahun > 6)) fail("INVALID_YEAR", "Tahun murid mestilah 2 hingga 6."); const result = studentId ? await supabase.from("students").update(rows[0]).eq("student_id", studentId).eq("school_id", actor.school_id).select("*") : await supabase.from("students").insert(rows).select("*"); if (result.error) fail(result.error.code === "23505" ? "DUPLICATE_STUDENT" : "DATABASE_ERROR", result.error.code === "23505" ? "Murid yang sama sudah wujud di sekolah ini." : result.error.message, 500); for (const row of result.data || []) await audit(actor, "SAVE_STUDENT", null, row); return { saved: true, updated: Boolean(studentId), student: result.data?.[0], students: result.data || [] }; }
  if (action === "saveAssessment") { assertGuru(actor); const studentId = required(input.studentId || input.student_id, "studentId"), student = await ownedStudent(studentId, actor), subject = normalizeSubject(input.subject || student.subject), cycle = normalizeCycle(input.cycle), skillCode = normalizeSkill(input.skillCode || input.skill_code), year = Number(input.tahun_data || input.year || new Date().getFullYear()); const record = { assessment_id: uuid(), student_id: studentId, subject, tahun_data: year, cycle, skill_code: skillCode, tarikh: new Date().toISOString(), teacher_id: actor.user_id, updated_at: new Date().toISOString() }; const result = await supabase.from("assessments").upsert(record, { onConflict: "student_id,subject,tahun_data,cycle" }).select("*").single(); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "SAVE_ASSESSMENT", null, result.data); return { saved: true, ...result.data }; }
  if (action === "saveTargets") { assertGuru(actor); const studentId = required(input.studentId || input.student_id, "studentId"), student = await ownedStudent(studentId, actor), subject = normalizeSubject(input.subject || student.subject), year = Number(input.tahun_data || input.year || new Date().getFullYear()), tov = skillNumber(input.TOV || input.tov), etr = skillNumber(input.ETR || input.etr), manual = Boolean(input.manualOverride || input.manual_override); if (etr < tov) fail("INVALID_TARGET", "ETR hendaklah sama atau lebih tinggi daripada TOV."); const distance = etr - tov; const generated = [0.25, 0.5, 0.75].map(part => Math.round(tov + distance * part)); const values = manual ? [input.OTI1 || input.oti1, input.OTI2 || input.oti2, input.OTI3 || input.oti3].map(skillNumber) : generated; if (!(tov <= values[0] && values[0] <= values[1] && values[1] <= values[2] && values[2] <= etr)) fail("INVALID_TARGET_ORDER", "Pastikan TOV <= OTI1 <= OTI2 <= OTI3 <= ETR."); const now = new Date().toISOString(); const assessments = [["TOV", tov], ["ETR", etr]].map(([cycle, value]) => ({ assessment_id: uuid(), student_id: studentId, subject, tahun_data: year, cycle, skill_code: `KP${value}`, tarikh: now, teacher_id: actor.user_id, updated_at: now })); const ar = await supabase.from("assessments").upsert(assessments, { onConflict: "student_id,subject,tahun_data,cycle" }); if (ar.error) fail("DATABASE_ERROR", ar.error.message, 500); const target = { student_id: studentId, OTI1: `KP${values[0]}`, OTI2: `KP${values[1]}`, OTI3: `KP${values[2]}`, ETR: `KP${etr}`, manual_override: manual, updated_at: now }; const tr = await supabase.from("targets").upsert(target).select("*").single(); if (tr.error) fail("DATABASE_ERROR", tr.error.message, 500); await audit(actor, "SAVE_TARGETS", null, target); return { saved: true, ...target, TOV: `KP${tov}` }; }
  if (action === "saveInterventionGroup") { assertGuru(actor); const groupId = text(input.groupId || input.group_id) || `GRP-${uuid()}`, ids = [...new Set((input.studentIds || input.student_ids || []).map(String))]; if (!ids.length) fail("VALIDATION_ERROR", "Pilih sekurang-kurangnya seorang murid."); for (const id of ids) await ownedStudent(id, actor); const existing = await one("intervention_groups", "group_id", groupId); if (existing && existing.school_id !== actor.school_id) fail("GROUP_ACCESS_DENIED", "Kumpulan ini bukan di bawah sekolah anda.", 403); const record = { group_id: groupId, school_id: actor.school_id, group_name: required(input.groupName || input.group_name, "Nama kumpulan", 200), skill_code: normalizeSkill(input.skillCode || input.skill_code), skill_name: text(input.skillName || input.skill_name), student_ids: ids, created_by: existing?.created_by || actor.user_id, created_at: existing?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() }; const result = await supabase.from("intervention_groups").upsert(record).select("*").single(); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "SAVE_INTERVENTION_GROUP", existing, result.data); return { ...result.data, student_ids_json: result.data.student_ids }; }
  if (action === "deleteInterventionGroup") { assertGuru(actor); const groupId = required(input.groupId || input.group_id, "groupId"), group = await one("intervention_groups", "group_id", groupId); if (!group || group.school_id !== actor.school_id) fail("GROUP_NOT_FOUND", "Kumpulan tidak ditemui.", 404); const result = await supabase.from("intervention_groups").delete().eq("group_id", groupId).eq("school_id", actor.school_id); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "DELETE_INTERVENTION_GROUP", group, null); return { deleted: true }; }
  if (action === "saveIntervention" || action === "saveInterventionBatch") { assertGuru(actor); const requestId = text(input.request_id) || uuid(), groupId = text(input.groupId || input.group_id); let ids = Array.isArray(input.studentIds || input.student_ids) ? (input.studentIds || input.student_ids).map(String) : [required(input.studentId || input.student_id, "studentId")]; if (groupId) { const group = await one("intervention_groups", "group_id", groupId); if (!group || group.school_id !== actor.school_id) fail("GROUP_NOT_FOUND", "Kumpulan tidak ditemui.", 404); ids = group.student_ids || []; } const existing = await supabase.from("interventions").select("*").eq("request_id", requestId); if (existing.data?.length) return { saved: true, already_saved: true, request_id: requestId, batch_id: existing.data[0].batch_id, count: existing.data.length, records: existing.data }; const students = []; for (const id of ids) students.push(await ownedStudent(id, actor)); const start = isoDate(input.startDate || input.start || input.tarikh_mula, "Tarikh mula"), review = isoDate(input.reviewDate || input.review || input.tarikh_semakan, "Tarikh semakan"); if (review < start) fail("VALIDATION_ERROR", "Tarikh semakan tidak boleh lebih awal daripada tarikh mula."); const batchId = uuid(), rows = students.map(student => ({ intervention_id: uuid(), student_id: student.student_id, skill_code: normalizeSkill(input.skillCode || input.skill_code), isu: required(input.issue || input.isu, "Isu", 500), intervensi: required(input.intervensi || input.interventionText, "Intervensi", 5000), kaedah: required(input.method || input.kaedah, "Kaedah", 500), tarikh_mula: start, tarikh_semakan: review, status: text(input.status) || "Sedang dilaksanakan", teacher_id: actor.user_id, group_id: groupId || null, batch_id: batchId, request_id: requestId, catatan: text(input.notes || input.catatan), skill_name: text(input.skillName || input.skill_name) })); const result = await supabase.from("interventions").insert(rows).select("*"); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, action === "saveInterventionBatch" ? "SAVE_INTERVENTION_BATCH" : "SAVE_INTERVENTION", null, { request_id: requestId, count: rows.length }); return action === "saveInterventionBatch" ? { saved: true, already_saved: false, request_id: requestId, batch_id: batchId, count: rows.length, records: result.data } : { saved: true, intervention_id: result.data?.[0]?.intervention_id }; }
  if (action === "transferStudent") { assertGuru(actor); const studentId = required(input.studentId || input.student_id, "studentId"), student = await ownedStudent(studentId, actor), type = upper(input.transferType || input.transfer_type); if (!["DALAM_DAERAH", "LUAR_DAERAH"].includes(type)) fail("INVALID_TRANSFER_TYPE", "Jenis perpindahan tidak sah."); const toSchool = type === "DALAM_DAERAH" ? required(input.toSchoolId || input.to_school_id, "Sekolah penerima") : null; const transfer = { transfer_id: `TR-${uuid()}`, student_id: studentId, from_school_id: actor.school_id, to_school_id: toSchool, transfer_type: type, status: type === "DALAM_DAERAH" ? "Menunggu Import" : "Selesai", requested_by: actor.user_id }; const inserted = await supabase.from("transfers").insert(transfer); if (inserted.error) fail("DATABASE_ERROR", inserted.error.message, 500); const update = await supabase.from("students").update({ school_id: toSchool || actor.school_id, status: type === "DALAM_DAERAH" ? "Menunggu Import" : "Apungan", updated_at: new Date().toISOString() }).eq("student_id", studentId); if (update.error) fail("DATABASE_ERROR", update.error.message, 500); await audit(actor, "TRANSFER_STUDENT", student, transfer); return { transferred: true }; }
  if (action === "importTransferredStudent") { assertGuru(actor); const transferId = required(input.transferId || input.transfer_id, "transferId"), transfer = await one("transfers", "transfer_id", transferId); if (!transfer || transfer.to_school_id !== actor.school_id || upper(transfer.status) !== "MENUNGGU IMPORT") fail("TRANSFER_ACCESS_DENIED", "Rekod perpindahan tidak tersedia untuk sekolah anda.", 403); await supabase.from("students").update({ status: "Aktif", updated_at: new Date().toISOString() }).eq("student_id", transfer.student_id).eq("school_id", actor.school_id); await supabase.from("transfers").update({ status: "Selesai", imported_at: new Date().toISOString(), imported_by: actor.user_id }).eq("transfer_id", transferId); return { imported: true, transfer_id: transferId, student: await one("students", "student_id", transfer.student_id) }; }
  if (action === "submitCycle") { assertGuru(actor); const year = Number(input.tahun || input.year || new Date().getFullYear()), subject = normalizeSubject(input.subject), cycle = normalizeCycle(input.cycle), existing = await supabase.from("submissions").select("*").match({ school_id: actor.school_id, tahun: year, subject, cycle }).maybeSingle(); if (existing.data && ["DISAHKAN ADMIN", "DIKUNCI"].includes(upper(existing.data.status))) fail("CYCLE_LOCKED", "Kitaran ini telah disahkan atau dikunci oleh admin."); const record = { school_id: actor.school_id, tahun: year, subject, cycle, status: "Telah Dihantar", submitted_at: new Date().toISOString() }; const result = await supabase.from("submissions").upsert(record).select("*").single(); if (result.error) fail("DATABASE_ERROR", result.error.message, 500); await audit(actor, "SUBMIT_CYCLE", existing.data, result.data); return { submitted: true, ...result.data }; }
  fail("ACTION_NOT_FOUND", `Tindakan API tidak sah: ${action}`, 404);
}

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Gunakan POST." } }), { status: 405, headers });
  let input: Row = {}, action = "";
  try {
    input = await req.json();
    action = text(input.action);
    if (!action) fail("ACTION_REQUIRED", "Tindakan API diperlukan.");
    const actor = ["getHealth", "loginSchool"].includes(action) ? null : await actorFor(input);
    const data = await dispatch(action, input, actor);
    return new Response(JSON.stringify({ ok: true, data, error: null, meta: { service: "myHeadcountKT Supabase", version: API_VERSION, action, request_id: input.request_id || null, timestamp: new Date().toISOString() } }), { status: 200, headers });
  } catch (error) {
    const status = Number((error as any)?.status || 400);
    return new Response(JSON.stringify({ ok: false, data: null, error: publicError(error), meta: { service: "myHeadcountKT Supabase", version: API_VERSION, action, request_id: input.request_id || null, timestamp: new Date().toISOString() } }), { status, headers });
  }
});
