/**
 * myHeadcountKT - Google Apps Script / Google Sheets backend.
 *
 * Persediaan sekali sahaja:
 * 1. Ikat projek Apps Script ini kepada satu Google Spreadsheet.
 * 2. Jalankan setupDatabase() daripada editor Apps Script.
 * 3. Deploy sebagai Web App yang dijalankan sebagai pemilik skrip. Akses data
 *    tetap memerlukan Google ID token dan rekod aktif dalam PENGGUNA.
 *
 * Untuk projek Apps Script standalone, jalankan:
 * setupDatabase("SPREADSHEET_ID_ANDA");
 *
 * Keselamatan penting: semua tindakan data mendapatkan school_id daripada
 * rekod PENGGUNA di pelayan. school_id yang dihantar oleh guru tidak dipercayai.
 */

var API_NAME = "myHeadcountKT";
var API_VERSION = "1.0.0";
var DATABASE_ID_PROPERTY = "DATABASE_SPREADSHEET_ID";
var GOOGLE_CLIENT_ID = "491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com";
var GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
var ID_TOKEN_CACHE_SECONDS = 300;
var ID_TOKEN_CLOCK_SKEW_SECONDS = 300;
var ID_TOKEN_MAX_AGE_SECONDS = 7200;

var TABLES = {
  SEKOLAH: ["school_id", "kod_sekolah", "nama_sekolah", "zon", "status"],
  PENGGUNA: ["user_id", "google_sub", "email", "nama", "role", "school_id", "status"],
  MURID: ["student_id", "school_id", "nama", "tahun", "kelas", "tarikh_mula", "subject", "status"],
  PENILAIAN: ["assessment_id", "student_id", "subject", "tahun_data", "cycle", "skill_code", "tarikh", "teacher_id", "timestamp"],
  SASARAN: ["student_id", "OTI1", "OTI2", "OTI3", "ETR"],
  INTERVENSI: ["intervention_id", "student_id", "skill_code", "isu", "intervensi", "kaedah", "tarikh_mula", "tarikh_semakan", "evidens", "outcome", "status", "teacher_id"],
  SUBMISSION: ["school_id", "tahun", "subject", "cycle", "status", "submitted_at", "verified_at", "verified_by"],
  MASTER_KEMAHIRAN: ["skill_code", "nama_kemahiran", "kategori", "subject", "turutan"],
  AUDIT_LOG: ["audit_id", "user_id", "masa", "tindakan", "data_lama", "data_baharu"]
};

var VALID_SUBJECTS = ["Bahasa Melayu", "Matematik"];
var VALID_CYCLES = ["TOV", "OTI 1", "AR 1", "OTI 2", "AR 2", "OTI 3", "AR 3", "ETR"];
var LOCKED_SUBMISSION_STATUSES = ["DISAHKAN ADMIN", "DIKUNCI"];

/**
 * Cipta/naik taraf semua tab central database dan simpan Spreadsheet ID.
 * Pengguna yang menjalankan fungsi ini akan dijadikan ADMIN jika e-melnya
 * tersedia dan belum wujud dalam PENGGUNA.
 */
function setupDatabase(spreadsheetId) {
  var ss = spreadsheetId
    ? SpreadsheetApp.openById(String(spreadsheetId).trim())
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw apiError_(
      "DATABASE_NOT_SELECTED",
      "Tiada Spreadsheet aktif. Ikat skrip kepada Google Sheet atau panggil setupDatabase(\"SPREADSHEET_ID\")."
    );
  }

  PropertiesService.getScriptProperties().setProperty(DATABASE_ID_PROPERTY, ss.getId());

  Object.keys(TABLES).forEach(function (name) {
    ensureSheet_(ss, name, TABLES[name]);
  });

  var skillsAdded = seedMasterSkills_(ss);
  var bootstrap = seedBootstrapAdmin_(ss);
  var result = {
    ok: true,
    service: API_NAME,
    version: API_VERSION,
    spreadsheet_name: ss.getName(),
    tables: Object.keys(TABLES),
    master_skills_added: skillsAdded,
    bootstrap_admin: bootstrap
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * Data contoh pilihan. Jalankan secara manual selepas setupDatabase().
 * Fungsi ini idempoten: rekod yang sama tidak akan digandakan.
 * Tetapkan Script Property DEMO_GURU_EMAIL jika mahu mencipta akaun guru demo.
 */
function seedDemoData() {
  var ss = database_();
  var schoolId = "SCH-DEMO";
  var added = { schools: 0, users: 0, students: 0 };

  if (!findRow_("SEKOLAH", function (row) { return same_(row.school_id, schoolId); }, ss)) {
    appendRecord_("SEKOLAH", {
      school_id: schoolId,
      kod_sekolah: "JBA3012",
      nama_sekolah: "SK Semangar (Demo)",
      zon: "Bandar",
      status: "Aktif"
    }, ss);
    added.schools += 1;
  }

  var demoStudents = [
    { student_id: "ST-DEMO-001", nama: "Nur Mira Sofea", tahun: 2, kelas: "2 Bijak", subject: "Bahasa Melayu", skill: "KP10" },
    { student_id: "ST-DEMO-002", nama: "Muhammad Ali Haziq", tahun: 2, kelas: "2 Bijak", subject: "Bahasa Melayu", skill: "KP6" },
    { student_id: "ST-DEMO-003", nama: "Daniel Lee Jun Wei", tahun: 2, kelas: "2 Bestari", subject: "Matematik", skill: "KP25" }
  ];

  demoStudents.forEach(function (student) {
    if (!findRow_("MURID", function (row) { return same_(row.student_id, student.student_id); }, ss)) {
      appendRecord_("MURID", {
        student_id: student.student_id,
        school_id: schoolId,
        nama: student.nama,
        tahun: student.tahun,
        kelas: student.kelas,
        tarikh_mula: new Date(),
        subject: student.subject,
        status: "Aktif"
      }, ss);
      appendRecord_("PENILAIAN", {
        assessment_id: Utilities.getUuid(),
        student_id: student.student_id,
        subject: student.subject,
        tahun_data: new Date().getFullYear(),
        cycle: "TOV",
        skill_code: student.skill,
        tarikh: new Date(),
        teacher_id: "SEED",
        timestamp: new Date()
      }, ss);
      added.students += 1;
    }
  });

  var demoEmail = String(PropertiesService.getScriptProperties().getProperty("DEMO_GURU_EMAIL") || "").trim().toLowerCase();
  if (demoEmail && !findRow_("PENGGUNA", function (row) { return lower_(row.email) === demoEmail; }, ss)) {
    appendRecord_("PENGGUNA", {
      user_id: Utilities.getUuid(),
      email: demoEmail,
      nama: "Guru Demo",
      role: "GURU",
      school_id: schoolId,
      status: "Aktif"
    }, ss);
    added.users += 1;
  }

  Logger.log(JSON.stringify({ ok: true, added: added }));
  return { ok: true, added: added };
}

/** Health check awam. Tidak memulangkan data sekolah atau pengguna. */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action
    ? String(e.parameter.action).trim().toLowerCase()
    : "health";

  if (action !== "health") {
    return errorResponse_(apiError_("ACTION_NOT_FOUND", "Tindakan GET tidak disokong."), "health");
  }

  return successResponse_(getHealth_(), "health");
}

/** Endpoint JSON utama. Gunakan Content-Type text/plain untuk elak CORS preflight. */
function doPost(e) {
  var action = "unknown";
  var requestId = Utilities.getUuid();

  try {
    var input = parseRequest_(e);
    action = requiredText_(input.action, "action", 50);
    requestId = action === "getHealth"
      ? (optionalText_(input.request_id, 100) || requestId)
      : normalizeRequestId_(input.request_id);

    // Nama tindakan sengaja eksplisit. Versi lama mendaftarkan getStudents_
    // sebagai kekunci dan menyebabkan action "getStudents" sentiasa ditolak.
    var handlers = {
      getHealth: getHealth_,
      getStudents: getStudents_,
      saveStudent: saveStudent_,
      saveAssessment: saveAssessment_,
      saveIntervention: saveIntervention_,
      submitCycle: submitCycle_
    };

    if (!Object.prototype.hasOwnProperty.call(handlers, action)) {
      throw apiError_("ACTION_NOT_FOUND", "Tindakan API tidak sah: " + action);
    }

    // Health check tidak membaca data domain dan boleh dipanggil sebelum login.
    var user = action === "getHealth" ? null : currentUser_(input);
    var data = handlers[action](input, user);
    return successResponse_(data, action, requestId);
  } catch (error) {
    return errorResponse_(error, action, requestId);
  }
}

function getHealth_() {
  var databaseReady = false;
  var missingTables = [];
  try {
    var ss = database_();
    missingTables = Object.keys(TABLES).filter(function (name) {
      return !ss.getSheetByName(name);
    });
    databaseReady = missingTables.length === 0;
  } catch (error) {
    databaseReady = false;
  }

  return {
    status: databaseReady ? "ok" : "configuration_required",
    service: API_NAME,
    version: API_VERSION,
    database_ready: databaseReady,
    missing_tables: missingTables,
    server_time: new Date()
  };
}

function getStudents_(input, user) {
  var requestedSchoolId = optionalText_(input.school_id || input.schoolId, 100);
  var schoolId = authorizedSchoolScope_(user, requestedSchoolId, true);
  var students = rows_("MURID").filter(function (row) {
    if (schoolId && !same_(row.school_id, schoolId)) return false;
    if (input.subject && !same_(row.subject, input.subject)) return false;
    if (input.tahun && !same_(row.tahun, input.tahun)) return false;
    if (input.status && !same_(row.status, input.status)) return false;
    return true;
  });

  var studentIds = {};
  students.forEach(function (student) { studentIds[text_(student.student_id)] = true; });

  var assessmentsByStudent = groupByStudent_(rows_("PENILAIAN"), studentIds);
  var interventionsByStudent = groupByStudent_(rows_("INTERVENSI"), studentIds);
  var targetsByStudent = {};
  rows_("SASARAN").forEach(function (target) {
    var id = text_(target.student_id);
    if (studentIds[id]) targetsByStudent[id] = publicRow_(target);
  });

  return students.map(function (student) {
    var id = text_(student.student_id);
    var result = publicRow_(student);
    result.assessments = (assessmentsByStudent[id] || []).map(publicRow_);
    result.interventions = (interventionsByStudent[id] || []).map(publicRow_);
    result.targets = targetsByStudent[id] || null;
    return result;
  });
}

/**
 * Tambah atau kemas kini seorang murid.
 * Pendua ditentukan dalam school_id yang sama berdasarkan nama + tahun +
 * kelas + mata pelajaran. Guru tidak boleh memilih school_id lain.
 */
function saveStudent_(input, user) {
  var requestedSchoolId = optionalText_(input.school_id || input.schoolId, 100);
  var studentId = optionalText_(input.studentId || input.student_id || input.id, 100);
  var schoolId = studentId
    ? ownedStudent_(studentId, user).school_id
    : authorizedSchoolScope_(user, requestedSchoolId, false);
  var name = requiredText_(input.name || input.nama, "name", 300);
  var year = normalizeStudentYear_(input.tahun || input.year);
  var className = requiredText_(input.className || input.kelas, "className", 100);
  var subject = normalizeSubject_(input.subject);
  var startDateInput = input.startDate || input.tarikh_mula;
  var status = normalizeStudentStatus_(input.status || "Aktif");

  return withWriteLock_(function () {
    var existing = studentId
      ? findRow_("MURID", function (row) { return same_(row.student_id, studentId); })
      : null;
    if (studentId && !existing) throw apiError_("STUDENT_NOT_FOUND", "Murid tidak ditemui.");
    if (existing && normalizeRole_(user.role) !== "ADMIN" && !same_(existing.school_id, user.school_id)) {
      throw apiError_("SCHOOL_ACCESS_DENIED", "Akses kepada data sekolah ini ditolak.");
    }

    var duplicate = findRow_("MURID", function (row) {
      return same_(row.school_id, schoolId) &&
        lower_(row.nama) === lower_(name) &&
        same_(row.tahun, year) &&
        lower_(row.kelas) === lower_(className) &&
        same_(row.subject, subject) &&
        (!existing || !same_(row.student_id, existing.student_id));
    });
    if (duplicate) {
      throw apiError_(
        "DUPLICATE_STUDENT",
        "Murid dengan nama, tahun, kelas dan mata pelajaran yang sama sudah wujud di sekolah ini."
      );
    }

    var record = {
      student_id: existing ? existing.student_id : (studentId || "ST-" + Utilities.getUuid()),
      school_id: schoolId,
      nama: name,
      tahun: year,
      kelas: className,
      tarikh_mula: startDateInput
        ? requiredDate_(startDateInput, "startDate")
        : (existing && existing.tarikh_mula ? existing.tarikh_mula : new Date()),
      subject: subject,
      status: status
    };

    if (existing) updateRecord_("MURID", existing._row, record);
    else appendRecord_("MURID", record);

    audit_(user, "SAVE_STUDENT", existing || null, record);
    return {
      saved: true,
      updated: Boolean(existing),
      student: publicRow_(record)
    };
  });
}

function saveAssessment_(input, user) {
  var studentId = requiredText_(input.studentId || input.student_id, "studentId", 100);
  var student = ownedStudent_(studentId, user);
  var subject = normalizeSubject_(input.subject || student.subject);
  var year = normalizeYear_(input.tahun_data || input.year || new Date().getFullYear());
  var cycle = normalizeCycle_(input.cycle);
  var skillCode = normalizeSkill_(input.skillCode || input.skill_code);

  if (student.subject && !same_(student.subject, subject)) {
    throw apiError_("SUBJECT_MISMATCH", "Mata pelajaran tidak sepadan dengan rekod murid.");
  }
  assertSkill_(skillCode, subject);
  assertCycleOpen_(student.school_id, year, subject, cycle);

  return withWriteLock_(function () {
    // Periksa sekali lagi selepas lock untuk mengelakkan perlumbaan submit/save.
    assertCycleOpen_(student.school_id, year, subject, cycle);
    var existing = findRow_("PENILAIAN", function (row) {
      return same_(row.student_id, studentId) &&
        same_(row.subject, subject) &&
        same_(row.tahun_data, year) &&
        same_(row.cycle, cycle);
    });
    var now = new Date();
    var record = {
      assessment_id: existing ? existing.assessment_id : Utilities.getUuid(),
      student_id: studentId,
      subject: subject,
      tahun_data: year,
      cycle: cycle,
      skill_code: skillCode,
      tarikh: now,
      teacher_id: user.user_id,
      timestamp: now
    };

    if (existing) updateRecord_("PENILAIAN", existing._row, record);
    else appendRecord_("PENILAIAN", record);

    audit_(user, "SAVE_ASSESSMENT", existing || null, record);
    return {
      saved: true,
      updated: Boolean(existing),
      assessment_id: record.assessment_id,
      student_id: studentId,
      school_id: student.school_id,
      subject: subject,
      tahun_data: year,
      cycle: cycle,
      skill_code: skillCode,
      saved_at: now
    };
  });
}

function saveIntervention_(input, user) {
  var studentId = requiredText_(input.studentId || input.student_id, "studentId", 100);
  var student = ownedStudent_(studentId, user);
  var interventionId = optionalText_(input.interventionId || input.intervention_id || input.id, 100);
  var skillCode = optionalText_(input.skillCode || input.skill_code, 20);
  var subject = normalizeSubject_(input.subject || student.subject);

  if (!skillCode) skillCode = latestSkillForStudent_(studentId, subject);
  skillCode = normalizeSkill_(skillCode);
  assertSkill_(skillCode, subject);

  var startDate = requiredDate_(input.startDate || input.start || input.tarikh_mula, "startDate");
  var reviewDate = requiredDate_(input.reviewDate || input.review || input.tarikh_semakan, "reviewDate");
  if (reviewDate.getTime() < startDate.getTime()) {
    throw apiError_("VALIDATION_ERROR", "Tarikh semakan tidak boleh lebih awal daripada tarikh mula.");
  }

  var record = {
    intervention_id: interventionId || Utilities.getUuid(),
    student_id: studentId,
    skill_code: skillCode,
    isu: requiredText_(input.issue || input.isu, "issue", 500),
    intervensi: requiredText_(input.action || input.intervensi, "action", 5000),
    kaedah: requiredText_(input.method || input.kaedah, "method", 500),
    tarikh_mula: startDate,
    tarikh_semakan: reviewDate,
    evidens: optionalText_(input.evidence || input.evidens, 5000),
    outcome: optionalText_(input.outcome, 2000),
    status: optionalText_(input.status, 100) || "Sedang dilaksanakan",
    teacher_id: user.user_id
  };

  return withWriteLock_(function () {
    var existing = interventionId
      ? findRow_("INTERVENSI", function (row) { return same_(row.intervention_id, interventionId); })
      : null;

    if (interventionId && !existing) {
      throw apiError_("INTERVENTION_NOT_FOUND", "Rekod intervensi tidak ditemui.");
    }
    if (existing) {
      var existingStudent = ownedStudent_(existing.student_id, user);
      if (!same_(existingStudent.student_id, studentId)) {
        throw apiError_("STUDENT_MISMATCH", "Intervensi ini milik murid yang berbeza.");
      }
      updateRecord_("INTERVENSI", existing._row, record);
    } else {
      appendRecord_("INTERVENSI", record);
    }

    audit_(user, "SAVE_INTERVENTION", existing || null, record);
    return {
      saved: true,
      updated: Boolean(existing),
      intervention_id: record.intervention_id,
      student_id: studentId,
      school_id: student.school_id,
      status: record.status
    };
  });
}

function submitCycle_(input, user) {
  if (normalizeRole_(user.role) === "ADMIN") {
    throw apiError_("ROLE_FORBIDDEN", "Penghantaran cycle ialah tindakan guru.");
  }

  var schoolId = authorizedSchoolScope_(user, input.school_id || input.schoolId, false);
  var year = normalizeYear_(input.tahun || input.year || new Date().getFullYear());
  var subject = input.subject
    ? normalizeSubject_(input.subject)
    : inferSingleSubjectForSchool_(schoolId);
  var cycle = normalizeCycle_(input.cycle);

  return withWriteLock_(function () {
    var existing = findRow_("SUBMISSION", function (row) {
      return same_(row.school_id, schoolId) &&
        same_(row.tahun, year) &&
        same_(row.subject, subject) &&
        same_(row.cycle, cycle);
    });

    if (existing && isLockedStatus_(existing.status)) {
      throw apiError_("CYCLE_LOCKED", "Cycle ini telah disahkan atau dikunci oleh admin.");
    }

    if (existing && upper_(existing.status) === "TELAH DIHANTAR") {
      return {
        submitted: true,
        already_submitted: true,
        school_id: schoolId,
        tahun: year,
        subject: subject,
        cycle: cycle,
        status: existing.status,
        submitted_at: existing.submitted_at
      };
    }

    var now = new Date();
    var record = {
      school_id: schoolId,
      tahun: year,
      subject: subject,
      cycle: cycle,
      status: "Telah Dihantar",
      submitted_at: now,
      verified_at: "",
      verified_by: ""
    };

    if (existing) updateRecord_("SUBMISSION", existing._row, record);
    else appendRecord_("SUBMISSION", record);

    audit_(user, "SUBMIT_CYCLE", existing || null, record);
    return {
      submitted: true,
      already_submitted: false,
      school_id: schoolId,
      tahun: year,
      subject: subject,
      cycle: cycle,
      status: record.status,
      submitted_at: now
    };
  });
}

function currentUser_(input) {
  var identity = verifyGoogleIdToken_(input);
  var user = findUserByGoogleIdentity_(identity);
  if (upper_(user.status) !== "AKTIF") {
    throw apiError_("USER_INACTIVE", "Akaun pengguna tidak aktif.");
  }

  user.role = normalizeRole_(user.role);
  if (user.role === "GURU") {
    user.school_id = requiredText_(user.school_id, "school_id pengguna", 100);
    assertSchoolActive_(user.school_id);
  }
  return user;
}

/**
 * google_sub ialah identiti utama dan stabil. Fallback e-mel hanya digunakan
 * sekali untuk memautkan rekod lama yang google_sub-nya masih kosong.
 */
function findUserByGoogleIdentity_(identity) {
  var users = rows_("PENGGUNA");
  var subMatches = users.filter(function (row) {
    return text_(row.google_sub) === identity.sub;
  });
  if (subMatches.length > 1) {
    throw apiError_("DUPLICATE_GOOGLE_IDENTITY", "Identiti Google dipautkan kepada lebih daripada satu pengguna.");
  }
  if (subMatches.length === 1) return subMatches[0];

  // Link di dalam lock supaya dua permintaan pertama tidak boleh memautkan
  // identiti yang sama kepada dua baris secara serentak.
  return withWriteLock_(function () {
    var lockedUsers = rows_("PENGGUNA");
    var lockedSubMatches = lockedUsers.filter(function (row) {
      return text_(row.google_sub) === identity.sub;
    });
    if (lockedSubMatches.length > 1) {
      throw apiError_("DUPLICATE_GOOGLE_IDENTITY", "Identiti Google dipautkan kepada lebih daripada satu pengguna.");
    }
    if (lockedSubMatches.length === 1) return lockedSubMatches[0];

    var emailMatches = lockedUsers.filter(function (row) {
      return lower_(row.email) === identity.email;
    });
    if (emailMatches.length === 0) {
      throw apiError_("USER_NOT_REGISTERED", "Akaun Google ini belum didaftarkan dalam PENGGUNA.");
    }
    if (emailMatches.length > 1) {
      throw apiError_("DUPLICATE_USER", "Lebih daripada satu rekod pengguna menggunakan e-mel yang sama.");
    }

    var user = emailMatches[0];
    var linkedSub = text_(user.google_sub);
    if (linkedSub && linkedSub !== identity.sub) {
      throw apiError_("GOOGLE_IDENTITY_MISMATCH", "Akaun pengguna telah dipautkan kepada identiti Google yang lain.");
    }
    if (!linkedSub) {
      updateRecord_("PENGGUNA", user._row, { google_sub: identity.sub });
      user.google_sub = identity.sub;
    }
    return user;
  });
}

/**
 * Sahkan credential Google Identity Services melalui endpoint tokeninfo Google.
 * Cache menggunakan hash token (bukan token mentah) dan tidak melebihi baki
 * hayat token. Semua tuntutan keselamatan tetap diperiksa selepas cache dibaca.
 */
function verifyGoogleIdToken_(input) {
  var token = optionalText_(input && (input.idToken || input.id_token || input.credential), 10000);
  if (!token) {
    throw apiError_("AUTH_REQUIRED", "Token Google Identity Services diperlukan.");
  }
  var cache = CacheService.getScriptCache();
  var cacheKey = "gis:" + tokenHash_(token);
  var cached = cache.get(cacheKey);
  var claims;

  if (cached) {
    try {
      claims = JSON.parse(cached);
    } catch (error) {
      cache.remove(cacheKey);
      cached = null;
    }
  }

  if (!claims) {
    var response;
    try {
      response = UrlFetchApp.fetch(GOOGLE_TOKENINFO_URL, {
        method: "post",
        contentType: "application/x-www-form-urlencoded",
        payload: "id_token=" + encodeURIComponent(token),
        muteHttpExceptions: true,
        followRedirects: false,
        validateHttpsCertificates: true
      });
    } catch (error) {
      throw apiError_("AUTH_SERVICE_UNAVAILABLE", "Pengesahan Google tidak dapat dihubungi. Cuba semula.");
    }

    if (response.getResponseCode() !== 200) {
      throw apiError_("INVALID_ID_TOKEN", "Token Google tidak sah atau telah tamat tempoh.");
    }
    try {
      claims = JSON.parse(response.getContentText());
    } catch (error) {
      throw apiError_("INVALID_ID_TOKEN_RESPONSE", "Respons pengesahan Google tidak sah.");
    }
  }

  var identity = validateGoogleClaims_(claims);
  if (!cached) {
    var nowSeconds = Math.floor(new Date().getTime() / 1000);
    var remainingSeconds = Math.max(1, Number(claims.exp) - nowSeconds);
    cache.put(cacheKey, JSON.stringify(claims), Math.min(ID_TOKEN_CACHE_SECONDS, remainingSeconds));
  }
  return identity;
}

function validateGoogleClaims_(claims) {
  if (!claims || Object.prototype.toString.call(claims) !== "[object Object]") {
    throw apiError_("INVALID_ID_TOKEN", "Tuntutan token Google tidak sah.");
  }
  if (text_(claims.aud) !== GOOGLE_CLIENT_ID) {
    throw apiError_("INVALID_TOKEN_AUDIENCE", "Token Google bukan untuk aplikasi ini.");
  }
  var issuer = lower_(claims.iss);
  if (issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") {
    throw apiError_("INVALID_TOKEN_ISSUER", "Penerbit token Google tidak sah.");
  }

  var expiresAt = Number(claims.exp);
  var issuedAt = Number(claims.iat);
  var nowSeconds = Math.floor(new Date().getTime() / 1000);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    throw apiError_("ID_TOKEN_EXPIRED", "Token Google telah tamat tempoh.");
  }
  if (!Number.isFinite(issuedAt)) {
    throw apiError_("INVALID_TOKEN_ISSUED_AT", "Masa token Google dikeluarkan tidak sah.");
  }
  if (issuedAt > nowSeconds + ID_TOKEN_CLOCK_SKEW_SECONDS) {
    throw apiError_("TOKEN_ISSUED_IN_FUTURE", "Masa token Google dikeluarkan berada terlalu jauh pada masa hadapan.");
  }
  if (nowSeconds - issuedAt > ID_TOKEN_MAX_AGE_SECONDS) {
    throw apiError_("ID_TOKEN_TOO_OLD", "Token Google terlalu lama. Sila log masuk semula.");
  }
  if (claims.email_verified !== true && lower_(claims.email_verified) !== "true") {
    throw apiError_("EMAIL_NOT_VERIFIED", "E-mel Google belum disahkan.");
  }

  var email = lower_(requiredText_(claims.email, "email token", 320));
  var subject = requiredText_(claims.sub, "sub token", 255);
  return { email: email, sub: subject, exp: expiresAt, iat: issuedAt };
}

function tokenHash_(token) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
}

/** Guru sentiasa dipaksa kepada school_id sendiri; admin boleh memilih sekolah. */
function authorizedSchoolScope_(user, requestedSchoolId, allowAdminAll) {
  if (normalizeRole_(user.role) !== "ADMIN") {
    var ownSchoolId = requiredText_(user.school_id, "school_id pengguna", 100);
    assertSchoolActive_(ownSchoolId);
    return ownSchoolId;
  }

  var requested = optionalText_(requestedSchoolId, 100);
  if (requested) {
    assertSchoolActive_(requested);
    return requested;
  }
  if (allowAdminAll) return "";
  throw apiError_("SCHOOL_REQUIRED", "school_id diperlukan untuk tindakan admin ini.");
}

function ownedStudent_(studentId, user) {
  var student = findRow_("MURID", function (row) { return same_(row.student_id, studentId); });
  if (!student) throw apiError_("STUDENT_NOT_FOUND", "Murid tidak ditemui.");

  if (normalizeRole_(user.role) !== "ADMIN" && !same_(student.school_id, user.school_id)) {
    throw apiError_("SCHOOL_ACCESS_DENIED", "Akses kepada data sekolah ini ditolak.");
  }
  assertSchoolActive_(student.school_id);
  return student;
}

function assertSchoolActive_(schoolId) {
  var school = findRow_("SEKOLAH", function (row) { return same_(row.school_id, schoolId); });
  if (!school) throw apiError_("SCHOOL_NOT_FOUND", "Sekolah pengguna tidak ditemui.");
  if (upper_(school.status) !== "AKTIF") throw apiError_("SCHOOL_INACTIVE", "Sekolah ini tidak aktif.");
}

function assertSkill_(skillCode, subject) {
  if (!/^KP([1-9]|[12][0-9]|3[0-2])$/.test(skillCode)) {
    throw apiError_("INVALID_SKILL", "Kod kemahiran mesti antara KP1 hingga KP32.");
  }

  var masterRows = rows_("MASTER_KEMAHIRAN");
  if (masterRows.length && !masterRows.some(function (row) {
    return same_(row.skill_code, skillCode) && same_(row.subject, subject);
  })) {
    throw apiError_("SKILL_NOT_FOUND", "Kod kemahiran tidak wujud untuk mata pelajaran ini.");
  }
}

function assertCycleOpen_(schoolId, year, subject, cycle) {
  var locked = findRow_("SUBMISSION", function (row) {
    return same_(row.school_id, schoolId) &&
      same_(row.tahun, year) &&
      same_(row.subject, subject) &&
      same_(row.cycle, cycle) &&
      isLockedStatus_(row.status);
  });
  if (locked) throw apiError_("CYCLE_LOCKED", "Cycle ini telah disahkan atau dikunci oleh admin.");
}

function isLockedStatus_(status) {
  return LOCKED_SUBMISSION_STATUSES.indexOf(upper_(status)) !== -1;
}

function latestSkillForStudent_(studentId, subject) {
  var records = rows_("PENILAIAN").filter(function (row) {
    return same_(row.student_id, studentId) && same_(row.subject, subject);
  });
  records.sort(function (a, b) {
    return dateMillis_(b.timestamp || b.tarikh) - dateMillis_(a.timestamp || a.tarikh) || b._row - a._row;
  });
  if (!records.length) {
    throw apiError_("SKILL_REQUIRED", "skillCode diperlukan kerana murid belum mempunyai rekod penilaian.");
  }
  return records[0].skill_code;
}

function inferSingleSubjectForSchool_(schoolId) {
  var seen = {};
  rows_("MURID").forEach(function (row) {
    if (same_(row.school_id, schoolId) && row.subject) seen[text_(row.subject)] = true;
  });
  var subjects = Object.keys(seen);
  if (subjects.length !== 1) {
    throw apiError_("SUBJECT_REQUIRED", "subject diperlukan apabila sekolah mempunyai sifar atau lebih daripada satu mata pelajaran.");
  }
  return normalizeSubject_(subjects[0]);
}

function groupByStudent_(records, allowedStudentIds) {
  var grouped = {};
  records.forEach(function (record) {
    var id = text_(record.student_id);
    if (!allowedStudentIds[id]) return;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(record);
  });
  return grouped;
}

function parseRequest_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== "string") {
    throw apiError_("INVALID_REQUEST", "Badan permintaan JSON diperlukan.");
  }
  try {
    var parsed = JSON.parse(e.postData.contents || "{}");
    if (!parsed || Object.prototype.toString.call(parsed) !== "[object Object]") {
      throw new Error("Badan bukan objek JSON.");
    }
    return parsed;
  } catch (error) {
    throw apiError_("INVALID_JSON", "Badan permintaan bukan JSON yang sah.");
  }
}

function database_() {
  var spreadsheetId = String(PropertiesService.getScriptProperties().getProperty(DATABASE_ID_PROPERTY) || "").trim();
  if (!spreadsheetId) {
    throw apiError_("DATABASE_NOT_CONFIGURED", "Jalankan setupDatabase() sekali sebelum menggunakan API.");
  }
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw apiError_("DATABASE_UNAVAILABLE", "Google Spreadsheet tidak dapat dibuka. Semak ID dan kebenaran skrip.");
  }
}

function ensureSheet_(ss, name, requiredHeaders) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
  } else {
    var lastColumn = Math.max(sheet.getLastColumn(), 1);
    var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(text_);
    var missing = requiredHeaders.filter(function (header) { return headers.indexOf(header) === -1; });
    if (missing.length) {
      sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold").setBackground("#dbeff5");
  return sheet;
}

function rows_(name, spreadsheet) {
  var ss = spreadsheet || database_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw apiError_("TABLE_NOT_FOUND", "Tab " + name + " belum diwujudkan. Jalankan setupDatabase().");
  if (sheet.getLastRow() < 2) return [];

  var values = sheet.getDataRange().getValues();
  var headers = values.shift().map(text_);
  return values.map(function (row, index) {
    return { values: row, sheetRow: index + 2 };
  }).filter(function (entry) {
    return entry.values.some(function (value) { return value !== ""; });
  }).map(function (entry) {
    var object = { _row: entry.sheetRow };
    headers.forEach(function (key, column) {
      if (key) object[key] = entry.values[column];
    });
    return object;
  });
}

function findRow_(name, predicate, spreadsheet) {
  var records = rows_(name, spreadsheet);
  for (var i = 0; i < records.length; i += 1) {
    if (predicate(records[i])) return records[i];
  }
  return null;
}

function appendRecord_(name, record, spreadsheet) {
  var ss = spreadsheet || database_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw apiError_("TABLE_NOT_FOUND", "Tab " + name + " belum diwujudkan.");
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(text_);
  var row = headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? sheetValue_(record[header]) : "";
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateRecord_(name, rowNumber, record, spreadsheet) {
  var ss = spreadsheet || database_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw apiError_("TABLE_NOT_FOUND", "Tab " + name + " belum diwujudkan.");
  if (!rowNumber || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw apiError_("INVALID_ROW", "Baris kemas kini tidak sah.");
  }
  var lastColumn = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(text_);
  var row = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(record, header)) row[index] = sheetValue_(record[header]);
  });
  sheet.getRange(rowNumber, 1, 1, lastColumn).setValues([row]);
}

function audit_(user, action, before, after) {
  appendRecord_("AUDIT_LOG", {
    audit_id: Utilities.getUuid(),
    user_id: user.user_id,
    masa: new Date(),
    tindakan: action,
    data_lama: JSON.stringify(publicRow_(before)),
    data_baharu: JSON.stringify(publicRow_(after))
  });
}

function seedBootstrapAdmin_(ss) {
  var email = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
  if (!email) return { created: false, reason: "effective_user_email_unavailable" };
  var existing = findRow_("PENGGUNA", function (row) { return lower_(row.email) === email; }, ss);
  if (existing) return { created: false, email: email, reason: "already_exists" };

  appendRecord_("PENGGUNA", {
    user_id: Utilities.getUuid(),
    email: email,
    nama: "Pentadbir Sistem",
    role: "ADMIN",
    school_id: "",
    status: "Aktif"
  }, ss);
  return { created: true, email: email };
}

function seedMasterSkills_(ss) {
  var existing = {};
  rows_("MASTER_KEMAHIRAN", ss).forEach(function (row) {
    existing[text_(row.subject) + "|" + text_(row.skill_code)] = true;
  });
  var added = 0;
  VALID_SUBJECTS.forEach(function (subject) {
    for (var i = 1; i <= 32; i += 1) {
      var code = "KP" + i;
      var key = subject + "|" + code;
      if (existing[key]) continue;
      appendRecord_("MASTER_KEMAHIRAN", {
        skill_code: code,
        nama_kemahiran: "Kemahiran Pemulihan " + code,
        kategori: skillCategory_(i),
        subject: subject,
        turutan: i
      }, ss);
      existing[key] = true;
      added += 1;
    }
  });
  return added;
}

function skillCategory_(number) {
  if (number <= 5) return "KP1-KP5";
  if (number <= 12) return "KP6-KP12";
  if (number <= 19) return "KP13-KP19";
  if (number <= 27) return "KP20-KP27";
  return "KP28-KP32";
}

function withWriteLock_(callback) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_("SERVER_BUSY", "Pelayan sedang sibuk. Cuba semula sebentar lagi.");
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function normalizeRole_(value) {
  var role = upper_(value);
  if (role !== "ADMIN" && role !== "GURU") {
    throw apiError_("INVALID_ROLE", "Peranan pengguna mesti ADMIN atau GURU.");
  }
  return role;
}

function normalizeSubject_(value) {
  var subject = requiredText_(value, "subject", 100);
  var match = VALID_SUBJECTS.filter(function (candidate) { return lower_(candidate) === lower_(subject); })[0];
  if (!match) throw apiError_("INVALID_SUBJECT", "Mata pelajaran mesti Bahasa Melayu atau Matematik.");
  return match;
}

function normalizeCycle_(value) {
  var compact = upper_(requiredText_(value, "cycle", 20)).replace(/\s+/g, "");
  var match = VALID_CYCLES.filter(function (candidate) {
    return candidate.replace(/\s+/g, "") === compact;
  })[0];
  if (!match) throw apiError_("INVALID_CYCLE", "Cycle headcount tidak sah.");
  return match;
}

function normalizeSkill_(value) {
  return upper_(requiredText_(value, "skillCode", 20)).replace(/\s+/g, "");
}

function normalizeYear_(value) {
  var year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw apiError_("INVALID_YEAR", "Tahun data tidak sah.");
  }
  return year;
}

function normalizeStudentYear_(value) {
  var year = Number(value);
  if (!Number.isInteger(year) || year < 1 || year > 6) {
    throw apiError_("INVALID_STUDENT_YEAR", "Tahun murid mesti antara 1 hingga 6.");
  }
  return year;
}

function normalizeStudentStatus_(value) {
  var status = lower_(requiredText_(value, "status", 100));
  var statuses = {
    "aktif": "Aktif",
    "pelepasan": "Pelepasan",
    "tidak aktif": "Tidak Aktif"
  };
  if (!Object.prototype.hasOwnProperty.call(statuses, status)) {
    throw apiError_("INVALID_STUDENT_STATUS", "Status murid mesti Aktif, Pelepasan atau Tidak Aktif.");
  }
  return statuses[status];
}

function normalizeRequestId_(value) {
  var requestId = requiredText_(value, "request_id", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw apiError_("INVALID_REQUEST_ID", "request_id mesti UUID yang sah.");
  }
  return requestId.toLowerCase();
}

function requiredDate_(value, fieldName) {
  var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!value || isNaN(date.getTime())) {
    throw apiError_("VALIDATION_ERROR", fieldName + " diperlukan dan mesti tarikh yang sah.");
  }
  return date;
}

function requiredText_(value, fieldName, maxLength) {
  var result = String(value === undefined || value === null ? "" : value).trim();
  if (!result) throw apiError_("VALIDATION_ERROR", fieldName + " diperlukan.");
  if (maxLength && result.length > maxLength) {
    throw apiError_("VALIDATION_ERROR", fieldName + " melebihi " + maxLength + " aksara.");
  }
  return result;
}

function optionalText_(value, maxLength) {
  if (value === undefined || value === null) return "";
  var result = String(value).trim();
  if (maxLength && result.length > maxLength) {
    throw apiError_("VALIDATION_ERROR", "Nilai melebihi " + maxLength + " aksara.");
  }
  return result;
}

function sheetValue_(value) {
  if (typeof value !== "string") return value === undefined || value === null ? "" : value;
  // Elak input pengguna ditafsir sebagai formula Google Sheets.
  return /^[=+@]/.test(value) ? "'" + value : value;
}

function publicRow_(row) {
  if (!row || typeof row !== "object") return row;
  var result = {};
  Object.keys(row).forEach(function (key) {
    if (key !== "_row") result[key] = row[key];
  });
  return result;
}

function same_(left, right) {
  return text_(left) === text_(right);
}

function text_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function lower_(value) {
  return text_(value).toLowerCase();
}

function upper_(value) {
  return text_(value).toUpperCase();
}

function dateMillis_(value) {
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

function apiError_(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function successResponse_(data, action, requestId) {
  return json_({
    ok: true,
    data: data,
    error: null,
    meta: {
      service: API_NAME,
      version: API_VERSION,
      action: action || null,
      request_id: requestId || null,
      timestamp: new Date()
    }
  });
}

function errorResponse_(error, action, requestId) {
  var code = error && error.code ? String(error.code) : "INTERNAL_ERROR";
  var message = error && error.message ? String(error.message) : "Ralat pelayan tidak diketahui.";
  console.error("[" + code + "] " + message);
  return json_({
    ok: false,
    data: null,
    error: { code: code, message: message },
    meta: {
      service: API_NAME,
      version: API_VERSION,
      action: action || null,
      request_id: requestId || null,
      timestamp: new Date()
    }
  });
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
