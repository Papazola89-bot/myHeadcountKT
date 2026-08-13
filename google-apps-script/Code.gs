/**
 * SIHADIR — adapter Google Apps Script / Google Sheets.
 * Jalankan setupDatabase() sekali dalam skrip yang terikat pada Spreadsheet.
 * Deploy sebagai Web App: execute as user accessing, akses organisasi sahaja.
 */
const TABLES = {
  SEKOLAH: ["school_id", "kod_sekolah", "nama_sekolah", "zon", "status"],
  PENGGUNA: ["user_id", "email", "nama", "role", "school_id", "status"],
  MURID: ["student_id", "school_id", "nama", "tahun", "kelas", "tarikh_mula", "subject", "status"],
  PENILAIAN: ["assessment_id", "student_id", "subject", "tahun_data", "cycle", "skill_code", "tarikh", "teacher_id", "timestamp"],
  SASARAN: ["student_id", "OTI1", "OTI2", "OTI3", "ETR"],
  INTERVENSI: ["intervention_id", "student_id", "skill_code", "isu", "intervensi", "kaedah", "tarikh_mula", "tarikh_semakan", "evidens", "outcome", "status", "teacher_id"],
  SUBMISSION: ["school_id", "tahun", "subject", "cycle", "status", "submitted_at", "verified_at", "verified_by"],
  MASTER_KEMAHIRAN: ["skill_code", "nama_kemahiran", "kategori", "subject", "turutan"],
  AUDIT_LOG: ["audit_id", "user_id", "masa", "tindakan", "data_lama", "data_baharu"],
};

function setupDatabase() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABLES).forEach(name => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.appendRow(TABLES[name]);
    sheet.setFrozenRows(1);
  });
}

function doPost(e) {
  try {
    const input = JSON.parse(e.postData.contents || "{}");
    const user = currentUser_();
    const handlers = { getStudents_, saveAssessment_, saveIntervention_, submitCycle_ };
    if (!handlers[input.action]) throw new Error("Tindakan tidak sah.");
    return json_({ ok: true, data: handlers[input.action](input, user) });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function currentUser_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Identiti Google tidak tersedia. Semak tetapan deployment.");
  const user = rows_("PENGGUNA").find(row => String(row.email).toLowerCase() === email.toLowerCase());
  if (!user || user.status !== "Aktif") throw new Error("Akaun tidak aktif atau belum didaftarkan.");
  return user;
}

function getStudents_(input, user) {
  const schoolId = user.role === "ADMIN" ? input.school_id : user.school_id;
  if (!schoolId) throw new Error("school_id diperlukan.");
  const students = rows_("MURID").filter(row => row.school_id === schoolId);
  const assessments = rows_("PENILAIAN");
  return students.map(student => ({
    ...student,
    assessments: assessments.filter(item => item.student_id === student.student_id),
  }));
}

function saveAssessment_(input, user) {
  assertSkill_(input.skillCode);
  const student = ownedStudent_(input.studentId, user);
  assertCycleOpen_(student.school_id, input.tahun_data || new Date().getFullYear(), input.subject, input.cycle);
  const sheet = SpreadsheetApp.getActive().getSheetByName("PENILAIAN");
  const existing = rows_("PENILAIAN").find(row => row.student_id === input.studentId && row.subject === input.subject && String(row.tahun_data) === String(input.tahun_data) && row.cycle === input.cycle);
  const record = [existing ? existing.assessment_id : Utilities.getUuid(), input.studentId, input.subject, input.tahun_data, input.cycle, input.skillCode, new Date(), user.user_id, new Date()];
  if (existing) sheet.getRange(existing._row, 1, 1, record.length).setValues([record]); else sheet.appendRow(record);
  audit_(user, "SAVE_ASSESSMENT", existing || null, { student_id: input.studentId, cycle: input.cycle, skill_code: input.skillCode });
  return { saved: true };
}

function saveIntervention_(input, user) {
  ownedStudent_(input.studentId, user);
  assertSkill_(input.skillCode);
  const record = [Utilities.getUuid(), input.studentId, input.skillCode, input.issue, input.action, input.method, input.startDate, input.reviewDate, input.evidence || "", input.outcome || "", input.status || "Sedang dilaksanakan", user.user_id];
  SpreadsheetApp.getActive().getSheetByName("INTERVENSI").appendRow(record);
  audit_(user, "SAVE_INTERVENTION", null, { student_id: input.studentId, status: record[10] });
  return { intervention_id: record[0] };
}

function submitCycle_(input, user) {
  if (user.role === "ADMIN") throw new Error("Penghantaran cycle ialah tindakan guru.");
  const record = [user.school_id, input.tahun || new Date().getFullYear(), input.subject, input.cycle, "Telah Dihantar", new Date(), "", ""];
  SpreadsheetApp.getActive().getSheetByName("SUBMISSION").appendRow(record);
  audit_(user, "SUBMIT_CYCLE", null, { school_id: user.school_id, cycle: input.cycle });
  return { status: "Telah Dihantar" };
}

function ownedStudent_(studentId, user) {
  const student = rows_("MURID").find(row => row.student_id === studentId);
  if (!student) throw new Error("Murid tidak ditemui.");
  if (user.role !== "ADMIN" && student.school_id !== user.school_id) throw new Error("Akses sekolah ditolak.");
  return student;
}

function assertSkill_(skillCode) {
  if (!/^KP([1-9]|[12][0-9]|3[0-2])$/.test(String(skillCode || ""))) throw new Error("Kod kemahiran tidak sah.");
}

function assertCycleOpen_(schoolId, year, subject, cycle) {
  const locked = rows_("SUBMISSION").find(row => row.school_id === schoolId && String(row.tahun) === String(year) && row.subject === subject && row.cycle === cycle && (row.status === "Dikunci" || row.status === "Disahkan Admin"));
  if (locked) throw new Error("Cycle ini telah dikunci oleh admin.");
}

function rows_(name) {
  const values = SpreadsheetApp.getActive().getSheetByName(name).getDataRange().getValues();
  const headers = values.shift() || [];
  return values.filter(row => row.some(value => value !== "")).map((row, index) => headers.reduce((object, key, column) => ({ ...object, [key]: row[column], _row: index + 2 }), {}));
}

function audit_(user, action, before, after) {
  SpreadsheetApp.getActive().getSheetByName("AUDIT_LOG").appendRow([Utilities.getUuid(), user.user_id, new Date(), action, JSON.stringify(before), JSON.stringify(after)]);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
