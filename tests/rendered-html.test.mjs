import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the myHeadcountKT product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /myHeadcountKT/);
  assert.match(html, /Headcount &amp; Intervensi/);
  assert.match(html, /Log masuk ke myHeadcountKT/);
  assert.match(html, /Data sekolah lain tidak boleh dicapai/);
  assert.match(html, /Kod sekolah/);
  assert.match(html, /Contoh: JBA3012/);
  assert.match(html, /Masuk sebagai Guru/);
  assert.match(html, /\/logos\/ppd-kota-tinggi\.png/);
  assert.match(html, /\/logos\/spb-ppdkt\.png/);
  assert.match(html, /\/logos\/m3p-johor\.png/);
  assert.doesNotMatch(html, /PORTAL GURU|Selamat datang, Pengguna Google/);
  assert.doesNotMatch(html, /Cikgu Aina|Nur Aina Binti Ahmad/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("loads and updates the authenticated Google Sheets profile", async () => {
  const [appSource, serviceSource, backendSource, stylesSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /ProfileModal/);
  assert.match(appSource, /saveProfileName/);
  assert.match(appSource, /authStatus!=="signed-in"/);
  assert.match(appSource, /function LoginScreen/);
  assert.match(appSource, /if\(!s\)return null/);
  assert.match(appSource, /students\[0\]\?\.id\|\|""/);
  assert.doesNotMatch(appSource, /students\.find\(x=>x\.id===item\.studentId\)!/);
  assert.match(appSource, /aria-label=\{notificationsOpen\?"Tutup notifikasi":"Buka notifikasi"\}/);
  assert.match(appSource, /Tandakan semua dibaca/);
  assert.match(appSource, /className="notifications-panel"/);
  assert.doesNotMatch(stylesSource, /\.topbar \.bell\{display:none\}/);
  assert.doesNotMatch(appSource, /Cikgu Aina|Nur Aina Binti Ahmad/);
  assert.match(serviceSource, /getProfile/);
  assert.match(serviceSource, /saveProfile/);
  assert.match(backendSource, /getProfile: getProfile_/);
  assert.match(backendSource, /saveProfile: saveProfile_/);
});

test("all enabled portal buttons expose an action", async () => {
  const source = await readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("headcount-app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inert = [];
  const walk = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (opening.tagName.getText(file) === "button") {
        const attrs = opening.attributes.properties;
        const hasClick = attrs.some((attr) => ts.isJsxAttribute(attr) && attr.name.text === "onClick");
        const disabled = attrs.some((attr) => ts.isJsxAttribute(attr) && attr.name.text === "disabled");
        if (!hasClick && !disabled) inert.push(opening.getText(file));
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  assert.deepEqual(inert, []);
  assert.match(source, /className="side-logout" onClick=\{signOut\}/);
});

test("school-code sessions are isolated from Google admin sessions", async () => {
  const [appSource, serviceSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /authMethod==="school"\?\{\.\.\.currentProfile,role:"GURU"/);
  assert.match(appSource, /currentProfile\.role!=="ADMIN"/);
  assert.match(serviceSource, /action: "loginSchool"/);
  assert.match(serviceSource, /schoolSessionToken/);
  assert.match(serviceSource, /session_token/);
});

test("three full-access admins and official school-code login are enforced", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /KOSONGKAN SEMUA DATA/);
  assert.match(appSource, /kod rasmi sekolah sendiri/i);
  assert.doesNotMatch(appSource, /rotateSchoolCode|rotateTeacherAccessCode|Tambah Guru/);
  assert.doesNotMatch(appSource, /Guru Contoh|Farah Nabila|Mohd Azlan|Siti Rafidah/);
  assert.doesNotMatch(appSource, /KP12\.4|\+7\.3 KP|Laporan Headcount AR 2/);
  assert.doesNotMatch(serviceSource, /rotateSchoolAccessCode|rotateTeacherAccessCode|loginTeacher/);
  assert.match(serviceSource, /request\("clearAllData"/);
  assert.match(appSource, /function AdminModal/);
  assert.match(appSource, /Tambah Admin/);
  assert.match(appSource, /Akses penuh/);
  assert.match(serviceSource, /request\("getAdmins"/);
  assert.match(serviceSource, /request\("saveAdmin"/);
  assert.match(backendSource, /MAX_ADMIN_ACCOUNTS = 3/);
  assert.match(backendSource, /getAdmins: getAdmins_/);
  assert.match(backendSource, /saveAdmin: saveAdmin_/);
  assert.match(backendSource, /assertAdminIdentity_\(user\)/);
  assert.doesNotMatch(backendSource, /assertOwnerAdminIdentity_/);
  assert.match(backendSource, /KOSONGKAN SEMUA DATA/);
  assert.match(backendSource, /preserved: \["SEKOLAH", "MASTER_KEMAHIRAN", "ADMIN_ACCOUNTS"\]/);
  assert.match(backendSource, /same_\(candidate\.kod_sekolah, accessCode\)/);
  assert.doesNotMatch(backendSource, /loginTeacher:|saveTeacher:|rotateTeacherAccessCode:/);
});

test("school administration uses Google Sheets rather than hardcoded demo rows", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(appSource, /const schools=\[/);
  assert.match(appSource, /appsScriptService\.getSchools\(\)/);
  assert.match(appSource, /ClearSchoolsModal/);
  assert.match(serviceSource, /request\("getSchools"\)/);
  assert.match(serviceSource, /request\("deleteSchool"/);
  assert.match(serviceSource, /request\("clearSchools"/);
  assert.match(backendSource, /getSchools: getSchools_/);
  assert.match(backendSource, /deleteSchool: deleteSchool_/);
  assert.match(backendSource, /clearSchools: clearSchools_/);
  assert.match(backendSource, /assertSchoolUnused_/);
  assert.match(backendSource, /PADAM SEMUA SEKOLAH/);
});

test("student intake offers Year 2 through Year 6 only", async () => {
  const [appSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /const STUDENT_YEARS=\[2,3,4,5,6\] as const/);
  assert.match(appSource, /\[year,setYear\]=useState\(2\)/);
  assert.match(appSource, /Pemulihan Khas Tahun 2 hingga Tahun 6/);
  assert.doesNotMatch(appSource, /<option value="1">Tahun 1<\/option>/);
  assert.doesNotMatch(appSource, /saveStudent\(\{studentId:student\.id/);
  assert.match(backendSource, /student_id: existing \? existing\.student_id : "ST-" \+ Utilities\.getUuid\(\)/);
});

test("student transfers preserve history, support school import, and retain Apungan", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /Pindahkan Murid/);
  assert.match(appSource, /Import Murid/);
  assert.match(appSource, /Perpindahan & Apungan/);
  assert.match(serviceSource, /request\("transferStudent"/);
  assert.match(serviceSource, /request\("importTransferredStudent"/);
  assert.match(backendSource, /PERPINDAHAN/);
  assert.match(backendSource, /Menunggu Import/);
  assert.match(backendSource, /Apungan/);
  assert.match(backendSource, /IMPORT_TRANSFERRED_STUDENT/);
  assert.match(backendSource, /same_\(row\.from_school_id, user\.school_id\) \|\| same_\(row\.to_school_id, user\.school_id\)/);
});

test("intervention dashboards use Google Sheets and contain no seeded admin totals", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(appSource, /const initialInterventions/);
  assert.doesNotMatch(appSource, /value=\{168\}|value=\{94\}|value=\{23\}|value=\{31\}|<strong>262<\/strong>/);
  assert.match(appSource, /appsScriptService\.getInterventions\(\)/);
  assert.match(appSource, /Belum ada rekod intervensi/);
  assert.match(serviceSource, /request\("getInterventions"\)/);
  assert.match(backendSource, /getInterventions: getInterventions_/);
  assert.match(backendSource, /function getInterventions_/);
});

test("includes product-specific social metadata", async () => {
  const html = await (await render()).text();
  assert.match(html, /og:image/);
  assert.match(html, /og\.png/);
  assert.match(html, /Isi sekali\. Fahami perkembangan\. Bertindak tepat\./);
});
