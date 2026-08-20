import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#${Date.now()}`);
}

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
  assert.match(appSource, /const initialStudent=selected\|\|students\[0\]/);
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

test("blocks the portal while Google Sheets syncs and shows explicit results", async () => {
  const [appSource, stylesSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /function SyncLoadingScreen/);
  assert.match(appSource, /function SyncResultScreen/);
  assert.match(appSource, /sheetStatus==="connecting"\|\|sheetStatus==="idle"/);
  assert.match(appSource, /Menyelaraskan data Google Sheets/);
  assert.match(appSource, /Data berjaya diselaraskan/);
  assert.match(appSource, /Cuba Semula/);
  assert.match(appSource, /Masuk ke Portal/);
  assert.match(appSource, /Tiada data kosong atau lama dipaparkan/);
  assert.match(stylesSource, /\.sync-page/);
  assert.match(stylesSource, /@keyframes sync-spin/);
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

test("generates fixed OTI targets from TOV and ETR and reports AR progress", async () => {
  const { generateOtiTargets, validateManualTargets, arProgress } = await importTypeScript("../app/lib/headcount.ts");
  assert.deepEqual(generateOtiTargets(4, 16), { oti1: 7, oti2: 10, oti3: 13 });
  assert.deepEqual(generateOtiTargets(20, 32), { oti1: 23, oti2: 26, oti3: 29 });
  assert.deepEqual(generateOtiTargets(8, 8), { oti1: 8, oti2: 8, oti3: 8 });
  assert.throws(() => generateOtiTargets(12, 8), /ETR hendaklah sama atau lebih tinggi/);
  for (let tov = 1; tov <= 28; tov += 1) {
    const targets = generateOtiTargets(tov, tov + 4);
    assert.ok(tov < targets.oti1 && targets.oti1 < targets.oti2 && targets.oti2 < targets.oti3 && targets.oti3 <= tov + 4);
  }
  assert.equal(validateManualTargets(4, { oti1: 7, oti2: 6, oti3: 13 }, 16), "Pastikan TOV ≤ OTI 1 ≤ OTI 2 ≤ OTI 3 ≤ ETR.");
  assert.deepEqual(arProgress(6, 7, 16), { status: "BELUM MENCAPAI SASARAN", tone: "amber", comparison: "Kurang 1 KP daripada sasaran", remainder: "Baki ke ETR: 10 KP" });
  assert.equal(arProgress(17, 13, 16).status, "MELEBIHI ETR");
  assert.equal(arProgress(6, 0, 0).status, "SASARAN BELUM DITETAPKAN");
});

test("reads SASARAN without inventing missing AR values", async () => {
  const { normalizeAppsScriptStudent } = await importTypeScript("../app/lib/data-service.ts");
  const student = normalizeAppsScriptStudent({
    student_id: "ST-1", nama: "Murid Ujian", tahun: 4, kelas: "4 Cekal", subject: "Bahasa Melayu", status: "Aktif",
    assessments: [{ cycle: "TOV", skill_code: "KP4" }, { cycle: "AR 1", skill_code: "KP6" }],
    targets: { OTI1: "KP7", OTI2: "KP10", OTI3: "KP13", ETR: "KP16", manual_override: true },
  });
  assert.equal(student.skills.TOV, 4);
  assert.equal(student.skills["OTI 2"], 10);
  assert.equal(student.skills["AR 1"], 6);
  assert.equal(student.skills["AR 2"], 0);
  assert.equal(student.manualOti, true);
});

test("supports atomic BM and Mathematics intake plus persistent targets", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /Bahasa Melayu &amp; Matematik/);
  assert.match(appSource, /subject==="Bahasa Melayu & Matematik"\?\["Bahasa Melayu","Matematik"\]/);
  assert.match(appSource, /Tetapkan OTI secara manual/);
  assert.match(appSource, /Perubahan AR tidak akan mengubah sasaran asal/);
  assert.match(serviceSource, /request\("saveTargets"/);
  assert.match(serviceSource, /request\("saveStudent", payload\)/);
  assert.match(backendSource, /saveTargets: saveTargets_/);
  assert.match(backendSource, /function calculateOtiTargets_/);
  assert.match(backendSource, /students: savedStudents/);
  assert.doesNotThrow(() => new Function(backendSource));
  const backendTargets = new Function(`${backendSource}; return calculateOtiTargets_;`)();
  assert.deepEqual(backendTargets(4, 16), [7, 10, 13]);
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

test("intervention groups preserve membership references and use one idempotent batch write", async () => {
  const [appSource, serviceSource, backendSource] = await Promise.all([
    readFile(new URL("../app/headcount-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /Intervensi Individu/);
  assert.match(appSource, /Intervensi Berkumpulan/);
  assert.match(appSource, /Cipta Kumpulan/);
  assert.match(appSource, /Lihat Ahli/);
  assert.match(appSource, /Belum Berkumpulan/);
  assert.match(appSource, /if\(savingRef\.current\|\|!validTarget\|\|!action\.trim\(\)\)return/);
  assert.match(appSource, /Data borang masih dikekalkan/);
  assert.doesNotMatch(appSource, /saveInterventionBatch\([^\n]*onChange/);
  assert.doesNotMatch(appSource, /saveIntervention=async[\s\S]{0,1500}setSheetStatus\("fallback"\)/);
  assert.match(serviceSource, /request\("saveInterventionBatch", payload, requestId\)/);
  assert.match(backendSource, /KUMPULAN_INTERVENSI/);
  assert.match(backendSource, /history_preserved: true/);
  assert.match(backendSource, /same_\(row\.request_id, requestId\)/);
  assert.match(backendSource, /appendRecords_\("INTERVENSI", records\)/);
  assert.match(backendSource, /setValues\(values\)/);
  assert.doesNotThrow(() => new Function(backendSource));
});

test("individual and four-member group intervention each issue one frontend request", async () => {
  const { createAppsScriptDataService } = await importTypeScript("../app/lib/data-service.ts");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const ids = body.studentIds ?? ["ST-1", "ST-2", "ST-3", "ST-4"];
    return new Response(JSON.stringify({
      ok: true,
      data: {
        count: ids.length,
        request_id: body.request_id,
        already_saved: false,
        records: ids.map((studentId, index) => ({
          intervention_id: `IV-${index + 1}`,
          student_id: studentId,
          skill_code: "KP8",
          isu: "Lemah membaca perkataan",
          intervensi: "Latihan KVK",
          kaedah: "Kumpulan kecil",
          tarikh_mula: "2026-08-20",
          tarikh_semakan: "2026-08-27",
          status: "Sedang dilaksanakan",
        })),
      },
    }), { status: 200 });
  };
  try {
    const service = createAppsScriptDataService("https://example.test/exec", (value) => value, () => ({ schoolSessionToken: "session" }));
    const individualId = "11111111-1111-4111-8111-111111111111";
    const individual = await service.saveInterventionBatch({ studentIds: ["ST-1"], skillCode: "KP8", action: "Latihan KVK" }, individualId);
    assert.equal(individual.count, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request_id, individualId);
    const groupId = "22222222-2222-4222-8222-222222222222";
    const grouped = await service.saveInterventionBatch({ groupId: "GRP-1", skillCode: "KP8", action: "Latihan KVK" }, groupId);
    assert.equal(grouped.count, 4);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].action, "saveInterventionBatch");
    assert.equal(calls[1].request_id, groupId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed intervention sync rejects without creating a retry request id", async () => {
  const { createAppsScriptDataService } = await importTypeScript("../app/lib/data-service.ts");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: false, error: { message: "Simulasi Sheets gagal" } }), { status: 200 });
  };
  try {
    const service = createAppsScriptDataService("https://example.test/exec", (value) => value, () => ({ schoolSessionToken: "session" }));
    const requestId = "33333333-3333-4333-8333-333333333333";
    await assert.rejects(() => service.saveInterventionBatch({ studentIds: ["ST-1"] }, requestId), /Simulasi Sheets gagal/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request_id, requestId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editing a group changes only its student id references", async () => {
  const { createAppsScriptDataService } = await importTypeScript("../app/lib/data-service.ts");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return new Response(JSON.stringify({ ok: true, data: {
      group_id: body.groupId,
      school_id: "SCH-1",
      group_name: body.groupName,
      skill_code: body.skillCode,
      skill_name: body.skillName,
      student_ids: body.studentIds,
    } }), { status: 200 });
  };
  try {
    const service = createAppsScriptDataService("https://example.test/exec", (value) => value, () => ({ schoolSessionToken: "session" }));
    const updated = await service.saveInterventionGroup({ groupId: "GRP-1", groupName: "Kumpulan KVK 1", skillCode: "KP8", skillName: "Perkataan KVK", studentIds: ["ST-1", "ST-3", "ST-4", "ST-5"] });
    assert.deepEqual(updated.studentIds, ["ST-1", "ST-3", "ST-4", "ST-5"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "saveInterventionGroup");
    assert.equal(calls[0].groupId, "GRP-1");
    assert.equal("student" in calls[0], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("includes product-specific social metadata", async () => {
  const html = await (await render()).text();
  assert.match(html, /og:image/);
  assert.match(html, /og\.png/);
  assert.match(html, /Isi sekali\. Fahami perkembangan\. Bertindak tepat\./);
});
