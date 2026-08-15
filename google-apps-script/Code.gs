/**
 * myHeadcountKT - Google Apps Script / Google Sheets backend.
 *
 * Persediaan sekali sahaja:
 * 1. Ikat projek Apps Script ini kepada satu Google Spreadsheet.
 * 2. Jalankan setupDatabase() daripada editor Apps Script.
 * 3. Deploy sebagai Web App yang dijalankan sebagai pemilik skrip. Pentadbir
 *    menggunakan Google ID token; guru menggunakan kod akses rahsia sekolah.
 *
 * Untuk projek Apps Script standalone, jalankan:
 * setupDatabase("SPREADSHEET_ID_ANDA");
 *
 * Keselamatan penting: semua tindakan data mendapatkan school_id daripada
 * identiti pelayan. school_id dan role yang dihantar oleh klien tidak dipercayai.
 */

var API_NAME = "myHeadcountKT";
var API_VERSION = "1.4.0";
var DATABASE_ID_PROPERTY = "DATABASE_SPREADSHEET_ID";
var OWNER_ADMIN_EMAIL_PROPERTY = "OWNER_ADMIN_EMAIL";
var SCHOOL_SESSION_EPOCH_PROPERTY = "SCHOOL_SESSION_EPOCH";
var GOOGLE_CLIENT_ID = "491720020946-9f6ifkrt5nrrpu4a7dsqeunv9iu0ell6.apps.googleusercontent.com";
var GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
var ID_TOKEN_CACHE_SECONDS = 300;
var ID_TOKEN_CLOCK_SKEW_SECONDS = 300;
var ID_TOKEN_MAX_AGE_SECONDS = 7200;
var SCHOOL_SESSION_SECONDS = 21600;
var SCHOOL_ACCESS_CODE_MIN_LENGTH = 12;
var SCHOOL_LOGIN_MAX_FAILURES = 5;
var SCHOOL_LOGIN_LOCK_SECONDS = 900;
var MAX_ADMIN_ACCOUNTS = 3;

var TABLES = {
  SEKOLAH: [
    "school_id", "kod_sekolah", "nama_sekolah", "zon", "status",
    "access_code_hash", "access_code_salt", "access_code_last4", "access_code_updated_at"
  ],
  PENGGUNA: ["user_id", "google_sub", "email", "nama", "role", "school_id", "status"],
  MURID: ["student_id", "school_id", "nama", "tahun", "kelas", "tarikh_mula", "subject", "status"],
  PENILAIAN: ["assessment_id", "student_id", "subject", "tahun_data", "cycle", "skill_code", "tarikh", "teacher_id", "timestamp"],
  SASARAN: ["student_id", "OTI1", "OTI2", "OTI3", "ETR"],
  INTERVENSI: ["intervention_id", "student_id", "skill_code", "isu", "intervensi", "kaedah", "tarikh_mula", "tarikh_semakan", "evidens", "outcome", "status", "teacher_id"],
  SUBMISSION: ["school_id", "tahun", "subject", "cycle", "status", "submitted_at", "verified_at", "verified_by"],
  PERPINDAHAN: [
    "transfer_id", "student_id", "student_name", "from_school_id", "to_school_id",
    "transfer_type", "status", "requested_at",
    "imported_at", "requested_by", "imported_by"
  ],
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
  if (!PropertiesService.getScriptProperties().getProperty(SCHOOL_SESSION_EPOCH_PROPERTY)) {
    PropertiesService.getScriptProperties().setProperty(SCHOOL_SESSION_EPOCH_PROPERTY, "1");
  }

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

/** Data demo dinyahaktifkan supaya pangkalan data produksi kekal kosong. */
function seedDemoData() {
  throw apiError_("DEMO_DISABLED", "Data demo telah dinyahaktifkan untuk sistem produksi.");
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
      loginSchool: loginSchool_,
      logoutSchool: logoutSchool_,
      getProfile: getProfile_,
      saveProfile: saveProfile_,
      getAdmins: getAdmins_,
      saveAdmin: saveAdmin_,
      getSchoolDirectory: getSchoolDirectory_,
      getTransfers: getTransfers_,
      transferStudent: transferStudent_,
      importTransferredStudent: importTransferredStudent_,
      getStudents: getStudents_,
      saveStudent: saveStudent_,
      getSchools: getSchools_,
      saveSchool: saveSchool_,
      deleteSchool: deleteSchool_,
      clearSchools: clearSchools_,
      clearAllData: clearAllData_,
      getInterventions: getInterventions_,
      saveAssessment: saveAssessment_,
      saveIntervention: saveIntervention_,
      submitCycle: submitCycle_
    };

    if (!Object.prototype.hasOwnProperty.call(handlers, action)) {
      throw apiError_("ACTION_NOT_FOUND", "Tindakan API tidak sah: " + action);
    }

    // Hanya health dan pertukaran kod sekolah kepada sesi boleh dibuat tanpa sesi.
    var publicActions = { getHealth: true, loginSchool: true };
    var user = publicActions[action] ? null : currentUser_(input);
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

/**
 * Tukar kod akses rahsia sekolah kepada sesi guru berjangka pendek.
 * Kod tidak pernah disimpan atau dipulangkan semula selepas konfigurasi.
 */
function loginSchool_(input) {
  var accessCode = upper_(requiredText_(
    input.schoolCode || input.school_code || input.accessCode || input.access_code || input.code,
    "schoolCode",
    30
  ));
  if (!/^[A-Z0-9-]+$/.test(accessCode)) {
    throw apiError_("INVALID_SCHOOL_CODE_FORMAT", "Kod sekolah hanya boleh mengandungi huruf, nombor dan tanda sempang.");
  }
  var cache = CacheService.getScriptCache();
  var attemptKey = "school-login-fail:" + tokenHash_(accessCode);
  var failures = Number(cache.get(attemptKey) || 0);
  if (failures >= SCHOOL_LOGIN_MAX_FAILURES) {
    throw apiError_("LOGIN_RATE_LIMITED", "Terlalu banyak cubaan. Cuba semula selepas 15 minit.");
  }

  var school = null;
  rows_("SEKOLAH").some(function (candidate) {
    if (upper_(candidate.status) !== "AKTIF") return false;
    if (!same_(candidate.kod_sekolah, accessCode)) return false;
    school = candidate;
    return true;
  });

  if (!school) {
    cache.put(attemptKey, String(failures + 1), SCHOOL_LOGIN_LOCK_SECONDS);
    throw apiError_("INVALID_SCHOOL_CODE", "Kod sekolah tidak sah atau sekolah tidak aktif.");
  }

  cache.remove(attemptKey);
  var session = createSchoolSession_(school);
  return {
    session_token: session.token,
    expires_in: SCHOOL_SESSION_SECONDS,
    profile: publicUserProfile_(session.user)
  };
}

function logoutSchool_(input, user) {
  if (!user || user._auth_type !== "SCHOOL_CODE") {
    throw apiError_("INVALID_AUTH_METHOD", "Log keluar sesi sekolah memerlukan sesi kod sekolah.");
  }
  var token = schoolSessionTokenFromInput_(input);
  CacheService.getScriptCache().remove(schoolSessionCacheKey_(token));
  return { logged_out: true };
}

function getProfile_(input, user) {
  return publicUserProfile_(user);
}

function saveProfile_(input, user) {
  if (user && user._auth_type === "SCHOOL_CODE") {
    throw apiError_("PROFILE_NOT_AVAILABLE", "Sesi kod sekolah tidak mempunyai profil guru peribadi.");
  }
  var name = requiredText_(input.name || input.nama, "name", 120);
  return withWriteLock_(function () {
    var existing = findRow_("PENGGUNA", function (row) {
      return same_(row.user_id, user.user_id);
    });
    if (!existing) throw apiError_("USER_NOT_FOUND", "Rekod pengguna tidak ditemui.");

    var before = publicRow_(existing);
    updateRecord_("PENGGUNA", existing._row, { nama: name });
    existing.nama = name;
    audit_(user, "SAVE_PROFILE", before, publicRow_(existing));
    return publicUserProfile_(existing);
  });
}

/** Senarai maksimum tiga pentadbir Google yang mempunyai akses penuh. */
function getAdmins_(input, user) {
  assertAdmin_(user);
  return rows_("PENGGUNA")
    .filter(function (row) { return upper_(row.role) === "ADMIN"; })
    .map(function (row) { return publicAdminRecord_(row, user); })
    .sort(function (left, right) { return left.nama.localeCompare(right.nama); });
}

/**
 * Daftarkan e-mel Google sebagai pentadbir akses penuh. google_sub dibiarkan
 * kosong sehingga log masuk pertama dan kemudiannya dipautkan oleh pelayan.
 */
function saveAdmin_(input, user) {
  assertAdmin_(user);
  var email = lower_(requiredText_(input.email, "email", 254));
  var name = optionalText_(input.name || input.nama, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw apiError_("INVALID_EMAIL", "Masukkan alamat e-mel Google yang sah.");
  }

  return withWriteLock_(function () {
    var users = rows_("PENGGUNA");
    var matches = users.filter(function (row) { return lower_(row.email) === email; });
    if (matches.length > 1) {
      throw apiError_("DUPLICATE_USER", "Lebih daripada satu rekod pengguna menggunakan e-mel yang sama.");
    }

    var existing = matches[0] || null;
    var activeAdmins = users.filter(function (row) {
      return upper_(row.role) === "ADMIN" && upper_(row.status) === "AKTIF";
    });
    var alreadyActiveAdmin = existing && upper_(existing.role) === "ADMIN" && upper_(existing.status) === "AKTIF";
    if (!alreadyActiveAdmin && activeAdmins.length >= MAX_ADMIN_ACCOUNTS) {
      throw apiError_("ADMIN_LIMIT_REACHED", "Sistem ini dihadkan kepada maksimum tiga akaun pentadbir.");
    }

    if (existing) {
      var before = publicRow_(existing);
      var changes = {
        nama: name || text_(existing.nama) || email,
        role: "ADMIN",
        school_id: "",
        status: "Aktif"
      };
      updateRecord_("PENGGUNA", existing._row, changes);
      existing = mergeRecord_(existing, changes);
      audit_(user, "SAVE_ADMIN", before, publicRow_(existing));
      return publicAdminRecord_(existing, user);
    }

    var record = {
      user_id: Utilities.getUuid(),
      google_sub: "",
      email: email,
      nama: name || email,
      role: "ADMIN",
      school_id: "",
      status: "Aktif"
    };
    appendRecord_("PENGGUNA", record);
    audit_(user, "SAVE_ADMIN", null, publicRow_(record));
    return publicAdminRecord_(record, user);
  });
}

function publicAdminRecord_(admin, currentUser) {
  return {
    user_id: text_(admin.user_id),
    email: lower_(admin.email),
    nama: text_(admin.nama) || lower_(admin.email),
    role: "ADMIN",
    status: upper_(admin.status) === "AKTIF" ? "Aktif" : "Tidak Aktif",
    is_current: Boolean(currentUser && same_(admin.user_id, currentUser.user_id))
  };
}

/** Direktori sekolah aktif untuk borang pindah murid. */
function getSchoolDirectory_(input, user) {
  if (!user) throw apiError_("AUTH_REQUIRED", "Log masuk diperlukan.");
  return rows_("SEKOLAH").filter(function (school) {
    return upper_(school.status) === "AKTIF";
  }).map(function (school) {
    return {
      school_id: text_(school.school_id),
      school_code: text_(school.kod_sekolah),
      school_name: text_(school.nama_sekolah),
      zone: text_(school.zon)
    };
  }).sort(function (left, right) { return left.school_name.localeCompare(right.school_name); });
}

function publicUserProfile_(user) {
  var schoolId = text_(user.school_id);
  var school = schoolId
    ? findRow_("SEKOLAH", function (row) { return same_(row.school_id, schoolId); })
    : null;
  return {
    user_id: text_(user.user_id),
    email: lower_(user.email),
    nama: text_(user.nama) || lower_(user.email),
    role: normalizeRole_(user.role),
    school_id: schoolId,
    school_name: school ? text_(school.nama_sekolah) : "",
    school_code: school ? text_(school.kod_sekolah) : "",
    school_zone: school ? text_(school.zon) : "",
    auth_method: text_(user._auth_type) || "GOOGLE"
  };
}

function getStudents_(input, user) {
  var requestedSchoolId = optionalText_(input.school_id || input.schoolId, 100);
  var students = authorizedStudentRows_(user, requestedSchoolId).filter(function (row) {
    if (upper_(row.status) === "APUNGAN" || upper_(row.status) === "MENUNGGU IMPORT") return false;
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

/** Senarai organisasi sebenar untuk portal admin, termasuk kiraan berkaitan. */
function getSchools_(input, user) {
  assertAdmin_(user);
  var schools = rows_("SEKOLAH");
  var users = rows_("PENGGUNA");
  var students = rows_("MURID");
  var assessments = rows_("PENILAIAN");
  var submissions = rows_("SUBMISSION");
  var latestAssessment = {};

  assessments.forEach(function (assessment) {
    var id = text_(assessment.student_id);
    if (!id) return;
    var current = latestAssessment[id];
    if (!current || dateMillis_(assessment.timestamp || assessment.tarikh) >= dateMillis_(current.timestamp || current.tarikh)) {
      latestAssessment[id] = assessment;
    }
  });

  return schools.map(function (school) {
    var schoolId = text_(school.school_id);
    var schoolStudents = students.filter(function (student) {
      return same_(student.school_id, schoolId) && upper_(student.status) !== "APUNGAN" && upper_(student.status) !== "MENUNGGU IMPORT";
    });
    var achieved = schoolStudents.filter(function (student) {
      return normalizeSkillNumber_(latestAssessment[text_(student.student_id)] && latestAssessment[text_(student.student_id)].skill_code) >= 32;
    }).length;
    var schoolSubmissions = submissions.filter(function (submission) { return same_(submission.school_id, schoolId); });
    schoolSubmissions.sort(function (a, b) {
      return dateMillis_(b.verified_at || b.submitted_at) - dateMillis_(a.verified_at || a.submitted_at);
    });
    return {
      school_id: schoolId,
      kod_sekolah: text_(school.kod_sekolah),
      nama_sekolah: text_(school.nama_sekolah),
      zon: text_(school.zon),
      status: text_(school.status) || "Aktif",
      teacher_count: users.filter(function (account) {
        return same_(account.school_id, schoolId) && normalizeRole_(account.role) === "GURU" && upper_(account.status) === "AKTIF";
      }).length,
      student_count: schoolStudents.length,
      achievement_percent: schoolStudents.length ? Math.round(achieved / schoolStudents.length * 100) : 0,
      submission_status: schoolSubmissions.length ? text_(schoolSubmissions[0].status) : "Belum mula",
      access_code_configured: Boolean(text_(school.access_code_hash) && text_(school.access_code_salt)),
      access_code_last4: text_(school.access_code_last4)
    };
  });
}

function saveSchool_(input, user) {
  assertAdmin_(user);
  var schoolId = optionalText_(input.schoolId || input.school_id, 100);
  var code = requiredText_(input.code || input.kod_sekolah, "code", 30);
  var name = requiredText_(input.name || input.nama_sekolah, "name", 200);
  var zone = requiredText_(input.zone || input.zon, "zone", 100);
  var status = upper_(input.status || "AKTIF") === "AKTIF" ? "Aktif" : "Tidak Aktif";

  return withWriteLock_(function () {
    var existing = schoolId ? findRow_("SEKOLAH", function (row) { return same_(row.school_id, schoolId); }) : null;
    if (schoolId && !existing) throw apiError_("SCHOOL_NOT_FOUND", "Sekolah tidak ditemui.");
    var duplicate = findRow_("SEKOLAH", function (row) {
      return lower_(row.kod_sekolah) === lower_(code) && (!existing || !same_(row.school_id, existing.school_id));
    });
    if (duplicate) throw apiError_("DUPLICATE_SCHOOL", "Kod sekolah ini sudah wujud.");

    var record = {
      school_id: existing ? existing.school_id : (schoolId || "SCH-" + Utilities.getUuid()),
      kod_sekolah: code,
      nama_sekolah: name,
      zon: zone,
      status: status
    };
    if (existing) updateRecord_("SEKOLAH", existing._row, record);
    else appendRecord_("SEKOLAH", record);
    var savedRecord = existing ? mergeRecord_(existing, record) : record;
    audit_(user, "SAVE_SCHOOL", publicSchoolRecord_(existing), publicSchoolRecord_(savedRecord));
    var response = publicSchoolRecord_(savedRecord);
    return response;
  });
}

function rotateSchoolAccessCode_(input, user) {
  assertAdmin_(user);
  var schoolId = requiredText_(input.schoolId || input.school_id, "schoolId", 100);
  var requested = optionalText_(input.accessCode || input.access_code, 100);
  return withWriteLock_(function () {
    var school = findRow_("SEKOLAH", function (row) { return same_(row.school_id, schoolId); });
    if (!school) throw apiError_("SCHOOL_NOT_FOUND", "Sekolah tidak ditemui.");
    var issuedAccessCode = requested ? normalizeSchoolAccessCode_(requested) : generateSchoolAccessCode_();
    assertSchoolAccessCodeAvailable_(issuedAccessCode, schoolId);
    var fields = schoolAccessCodeFields_(issuedAccessCode);
    updateRecord_("SEKOLAH", school._row, fields);
    audit_(user, "ROTATE_SCHOOL_ACCESS_CODE", {
      school_id: schoolId,
      access_code_last4: text_(school.access_code_last4)
    }, {
      school_id: schoolId,
      access_code_last4: fields.access_code_last4
    });
    return {
      school_id: schoolId,
      access_code: issuedAccessCode,
      access_code_last4: fields.access_code_last4,
      access_code_updated_at: fields.access_code_updated_at
    };
  });
}

function deleteSchool_(input, user) {
  assertAdmin_(user);
  var schoolId = requiredText_(input.schoolId || input.school_id, "schoolId", 100);
  return withWriteLock_(function () {
    var school = findRow_("SEKOLAH", function (row) { return same_(row.school_id, schoolId); });
    if (!school) throw apiError_("SCHOOL_NOT_FOUND", "Sekolah tidak ditemui.");
    assertSchoolUnused_(schoolId);
    audit_(user, "DELETE_SCHOOL", publicSchoolRecord_(school), null);
    deleteRecord_("SEKOLAH", school._row);
    return { deleted: true, school_id: schoolId };
  });
}

function clearSchools_(input, user) {
  assertAdmin_(user);
  if (text_(input.confirmation) !== "PADAM SEMUA SEKOLAH") {
    throw apiError_("CONFIRMATION_REQUIRED", "Taip PADAM SEMUA SEKOLAH untuk mengesahkan tindakan ini.");
  }
  return withWriteLock_(function () {
    var schools = rows_("SEKOLAH");
    if (!schools.length) return { cleared: true, deleted_count: 0 };
    var dependentCount = rows_("PENGGUNA").filter(function (row) { return text_(row.school_id); }).length +
      rows_("MURID").filter(function (row) { return text_(row.school_id); }).length +
      rows_("SUBMISSION").filter(function (row) { return text_(row.school_id); }).length;
    if (dependentCount) {
      throw apiError_("SCHOOLS_IN_USE", "Senarai sekolah tidak boleh dikosongkan kerana masih mempunyai pengguna, murid atau penghantaran berkaitan.");
    }
    audit_(user, "CLEAR_SCHOOLS", { deleted_count: schools.length }, null);
    clearDataRows_("SEKOLAH");
    return { cleared: true, deleted_count: schools.length };
  });
}

/**
 * Kosongkan semua data operasi tanpa memadam konfigurasi sistem.
 * Dikekalkan: SEKOLAH, MASTER_KEMAHIRAN dan semua akaun pentadbir.
 * Semua sesi kod sekolah sedia ada dibatalkan melalui epoch.
 */
function clearAllData_(input, user) {
  assertAdmin_(user);
  if (text_(input.confirmation) !== "KOSONGKAN SEMUA DATA") {
    throw apiError_("CONFIRMATION_REQUIRED", "Taip KOSONGKAN SEMUA DATA untuk mengesahkan tindakan ini.");
  }

  return withWriteLock_(function () {
    var adminRecords = rows_("PENGGUNA").filter(function (row) {
      return upper_(row.role) === "ADMIN";
    }).map(function (row) {
      return {
        user_id: text_(row.user_id) || Utilities.getUuid(),
        google_sub: text_(row.google_sub),
        email: lower_(row.email),
        nama: text_(row.nama) || lower_(row.email),
        role: "ADMIN",
        school_id: "",
        status: upper_(row.status) === "AKTIF" ? "Aktif" : "Tidak Aktif"
      };
    });
    var clearedTables = ["MURID", "PENILAIAN", "SASARAN", "INTERVENSI", "SUBMISSION", "PERPINDAHAN", "AUDIT_LOG"];
    var deleted = {};

    clearedTables.forEach(function (name) {
      deleted[name] = rows_(name).length;
      clearDataRows_(name);
    });
    deleted.PENGGUNA = rows_("PENGGUNA").length - adminRecords.length;
    clearDataRows_("PENGGUNA");
    adminRecords.forEach(function (adminRecord) { appendRecord_("PENGGUNA", adminRecord); });
    bumpSchoolSessionEpoch_();

    audit_(user, "CLEAR_ALL_DATA", {
      deleted: deleted
    }, {
      preserved: ["SEKOLAH", "MASTER_KEMAHIRAN", "ADMIN_ACCOUNTS"]
    });
    return {
      cleared: true,
      deleted: deleted,
      preserved: {
        schools: rows_("SEKOLAH").length,
        master_skills: rows_("MASTER_KEMAHIRAN").length,
        admin_accounts: adminRecords.map(function (admin) { return admin.email; })
      },
      school_sessions_revoked: true
    };
  });
}

function assertSchoolUnused_(schoolId) {
  var usedByUser = findRow_("PENGGUNA", function (row) { return same_(row.school_id, schoolId); });
  var usedByStudent = findRow_("MURID", function (row) { return same_(row.school_id, schoolId); });
  var usedBySubmission = findRow_("SUBMISSION", function (row) { return same_(row.school_id, schoolId); });
  if (usedByUser || usedByStudent || usedBySubmission) {
    throw apiError_("SCHOOL_IN_USE", "Sekolah tidak boleh dipadam kerana masih mempunyai pengguna, murid atau penghantaran berkaitan.");
  }
}

function normalizeSkillNumber_(value) {
  var match = upper_(value).match(/^KP([1-9]|[12][0-9]|3[0-2])$/);
  return match ? Number(match[1]) : 0;
}

/** Rekod intervensi sebenar. Admin melihat semua; guru hanya murid sekolah sendiri. */
function getInterventions_(input, user) {
  var requestedSchoolId = optionalText_(input.school_id || input.schoolId, 100);
  var studentsById = {};
  authorizedStudentRows_(user, requestedSchoolId).forEach(function (student) {
    studentsById[text_(student.student_id)] = student;
  });
  var schoolsById = {};
  rows_("SEKOLAH").forEach(function (school) { schoolsById[text_(school.school_id)] = school; });

  return rows_("INTERVENSI").filter(function (row) {
    return Boolean(studentsById[text_(row.student_id)]);
  }).map(function (row) {
    var student = studentsById[text_(row.student_id)];
    var school = schoolsById[text_(student.school_id)];
    var result = publicRow_(row);
    result.student_name = text_(student.nama);
    result.school_id = text_(student.school_id);
    result.school_name = school ? text_(school.nama_sekolah) : "";
    return result;
  });
}

/** Senarai perpindahan: admin melihat semua, guru melihat rekod keluar/masuk sekolahnya. */
function getTransfers_(input, user) {
  var records = rows_("PERPINDAHAN");
  if (normalizeRole_(user.role) !== "ADMIN") {
    records = records.filter(function (row) {
      return same_(row.from_school_id, user.school_id) || same_(row.to_school_id, user.school_id);
    });
  }
  var schools = {};
  rows_("SEKOLAH").forEach(function (school) { schools[text_(school.school_id)] = school; });
  return records.map(function (row) {
    var result = publicRow_(row);
    result.from_school_name = schools[text_(row.from_school_id)] ? text_(schools[text_(row.from_school_id)].nama_sekolah) : "";
    result.to_school_name = schools[text_(row.to_school_id)] ? text_(schools[text_(row.to_school_id)].nama_sekolah) : "";
    return result;
  }).sort(function (left, right) { return dateMillis_(right.requested_at) - dateMillis_(left.requested_at); });
}

/** Pindah dalam daerah ke senarai import, atau apungkan murid yang keluar daerah/negeri. */
function transferStudent_(input, user) {
  if (normalizeRole_(user.role) === "ADMIN") {
    throw apiError_("ROLE_FORBIDDEN", "Perpindahan murid dimulakan oleh guru pemilik rekod.");
  }
  var studentId = requiredText_(input.studentId || input.student_id, "studentId", 100);
  var student = ownedStudent_(studentId, user);
  var transferType = upper_(requiredText_(input.transferType || input.transfer_type, "transferType", 30));
  if (transferType !== "DALAM_DAERAH" && transferType !== "LUAR_DAERAH") {
    throw apiError_("INVALID_TRANSFER_TYPE", "Jenis pindah mesti DALAM_DAERAH atau LUAR_DAERAH.");
  }
  var destinationSchoolId = transferType === "DALAM_DAERAH"
    ? requiredText_(input.toSchoolId || input.to_school_id, "toSchoolId", 100)
    : "";
  if (destinationSchoolId) {
    if (same_(destinationSchoolId, student.school_id)) {
      throw apiError_("SAME_SCHOOL_TRANSFER", "Pilih sekolah penerima yang berbeza.");
    }
    assertSchoolActive_(destinationSchoolId);
  }

  return withWriteLock_(function () {
    var current = ownedStudent_(studentId, user);
    var pending = findRow_("PERPINDAHAN", function (row) {
      return same_(row.student_id, studentId) && upper_(row.status) === "MENUNGGU IMPORT";
    });
    if (pending) throw apiError_("TRANSFER_ALREADY_PENDING", "Murid ini sudah menunggu import oleh sekolah penerima.");
    var now = new Date();
    var transfer = {
      transfer_id: "TRF-" + Utilities.getUuid(),
      student_id: studentId,
      student_name: text_(current.nama),
      from_school_id: text_(current.school_id),
      to_school_id: destinationSchoolId,
      transfer_type: transferType,
      status: transferType === "DALAM_DAERAH" ? "Menunggu Import" : "Apungan",
      requested_at: now,
      imported_at: "",
      requested_by: text_(user.user_id),
      imported_by: ""
    };
    var studentChanges = transferType === "DALAM_DAERAH"
      ? { school_id: destinationSchoolId, status: "Menunggu Import" }
      : { school_id: "", status: "Apungan" };
    updateRecord_("MURID", current._row, studentChanges);
    appendRecord_("PERPINDAHAN", transfer);
    audit_(user, "TRANSFER_STUDENT", publicRow_(current), mergeRecord_(publicRow_(current), studentChanges));
    return publicRow_(transfer);
  });
}

/** Sekolah penerima mengimport rekod murid bersama semua sejarah headcountnya. */
function importTransferredStudent_(input, user) {
  if (normalizeRole_(user.role) === "ADMIN") {
    throw apiError_("ROLE_FORBIDDEN", "Import murid mesti dilakukan oleh guru sekolah penerima.");
  }
  var transferId = requiredText_(input.transferId || input.transfer_id, "transferId", 100);
  return withWriteLock_(function () {
    var transfer = findRow_("PERPINDAHAN", function (row) { return same_(row.transfer_id, transferId); });
    if (!transfer) throw apiError_("TRANSFER_NOT_FOUND", "Rekod perpindahan tidak ditemui.");
    if (upper_(transfer.status) !== "MENUNGGU IMPORT") {
      throw apiError_("TRANSFER_NOT_AVAILABLE", "Rekod ini tidak lagi tersedia untuk import.");
    }
    if (!same_(transfer.to_school_id, user.school_id)) {
      throw apiError_("TRANSFER_ACCESS_DENIED", "Murid ini bukan untuk sekolah anda.");
    }
    var student = findRow_("MURID", function (row) { return same_(row.student_id, transfer.student_id); });
    if (!student || upper_(student.status) !== "MENUNGGU IMPORT" || !same_(student.school_id, user.school_id)) {
      throw apiError_("TRANSFER_STUDENT_MISMATCH", "Status murid tidak sepadan dengan rekod perpindahan.");
    }
    var now = new Date();
    var studentChanges = { status: "Aktif" };
    updateRecord_("MURID", student._row, studentChanges);
    updateRecord_("PERPINDAHAN", transfer._row, {
      status: "Selesai",
      imported_at: now,
      imported_by: text_(user.user_id)
    });
    audit_(user, "IMPORT_TRANSFERRED_STUDENT", publicRow_(student), mergeRecord_(publicRow_(student), studentChanges));
    return {
      imported: true,
      transfer_id: transferId,
      student: mergeRecord_(publicRow_(student), studentChanges)
    };
  });
}

/**
 * Tambah atau kemas kini seorang murid.
 * Pendua ditentukan dalam school_id yang sama berdasarkan nama + tahun +
 * kelas + mata pelajaran. Sesi guru tidak boleh memilih school_id lain.
 */
function saveStudent_(input, user) {
  if (normalizeRole_(user.role) === "ADMIN") {
    throw apiError_("ROLE_FORBIDDEN", "Murid mesti didaftarkan melalui akaun guru yang memiliki rekod tersebut.");
  }
  var studentId = optionalText_(input.studentId || input.student_id || input.id, 100);
  var existingStudent = studentId ? ownedStudent_(studentId, user) : null;
  var schoolId = existingStudent ? text_(existingStudent.school_id) : authorizedSchoolScope_(user, "", false);
  var name = requiredText_(input.name || input.nama, "name", 300);
  var year = normalizeStudentYear_(input.tahun || input.year);
  var className = requiredText_(input.className || input.kelas, "className", 100);
  var subject = normalizeSubject_(input.subject);
  var startDateInput = input.startDate || input.tarikh_mula;
  var status = normalizeStudentStatus_(input.status || "Aktif");

  return withWriteLock_(function () {
    var existing = studentId ? ownedStudent_(studentId, user) : null;

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
      student_id: existing ? existing.student_id : "ST-" + Utilities.getUuid(),
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
  if (hasSchoolSessionToken_(input)) {
    return verifySchoolSession_(input);
  }

  var identity = verifyGoogleIdToken_(input);
  var user = findUserByGoogleIdentity_(identity);
  if (upper_(user.status) !== "AKTIF") {
    throw apiError_("USER_INACTIVE", "Akaun pengguna tidak aktif.");
  }

  user.role = normalizeRole_(user.role);
  user._auth_type = "GOOGLE";
  user._identity_email = identity.email;
  // Google hanya pintu masuk pentadbir berdaftar. Guru menggunakan kod rasmi
  // sekolah dan school_id sentiasa ditentukan semula pada pelayan.
  assertAdminIdentity_(user);
  user.role = "ADMIN";
  user.school_id = "";
  return user;
}

function hasSchoolSessionToken_(input) {
  return Boolean(input && (input.schoolSessionToken || input.school_session_token || input.sessionToken || input.session_token));
}

function schoolSessionTokenFromInput_(input) {
  return requiredText_(
    input && (input.schoolSessionToken || input.school_session_token || input.sessionToken || input.session_token),
    "session_token",
    500
  );
}

function schoolSessionCacheKey_(token) {
  return "school-session:" + tokenHash_(token);
}

function createSchoolSession_(school) {
  var token = tokenHash_(Utilities.getUuid() + ":" + Utilities.getUuid() + ":" + new Date().getTime());
  var now = new Date().getTime();
  var payload = {
    school_id: text_(school.school_id),
    epoch: schoolSessionEpoch_(),
    school_code: text_(school.kod_sekolah),
    issued_at: now,
    expires_at: now + SCHOOL_SESSION_SECONDS * 1000
  };
  CacheService.getScriptCache().put(
    schoolSessionCacheKey_(token),
    JSON.stringify(payload),
    SCHOOL_SESSION_SECONDS
  );
  return { token: token, user: schoolSessionUser_(school) };
}

function verifySchoolSession_(input) {
  var token = schoolSessionTokenFromInput_(input);
  var cache = CacheService.getScriptCache();
  var cacheKey = schoolSessionCacheKey_(token);
  var raw = cache.get(cacheKey);
  if (!raw) throw apiError_("SCHOOL_SESSION_EXPIRED", "Sesi sekolah tamat. Masukkan semula kod sekolah.");

  var payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    cache.remove(cacheKey);
    throw apiError_("INVALID_SCHOOL_SESSION", "Sesi sekolah tidak sah.");
  }
  if (!payload || Number(payload.expires_at) <= new Date().getTime() || Number(payload.epoch) !== schoolSessionEpoch_()) {
    cache.remove(cacheKey);
    throw apiError_("SCHOOL_SESSION_EXPIRED", "Sesi sekolah tamat. Masukkan semula kod sekolah.");
  }

  var school = findRow_("SEKOLAH", function (row) { return same_(row.school_id, payload.school_id); });
  if (!school || upper_(school.status) !== "AKTIF") {
    cache.remove(cacheKey);
    throw apiError_("SCHOOL_INACTIVE", "Sekolah ini tidak aktif.");
  }
  if (!same_(school.kod_sekolah, payload.school_code)) {
    cache.remove(cacheKey);
    throw apiError_("SCHOOL_SESSION_REVOKED", "Kod sekolah telah berubah. Masukkan kod sekolah semula.");
  }
  return schoolSessionUser_(school);
}

function schoolSessionUser_(school) {
  return {
    user_id: "SCHOOL-" + text_(school.school_id),
    google_sub: "",
    email: "",
    nama: "Guru " + (text_(school.nama_sekolah) || text_(school.kod_sekolah)),
    role: "GURU",
    school_id: text_(school.school_id),
    status: "Aktif",
    _auth_type: "SCHOOL_CODE"
  };
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

function normalizeSchoolAccessCode_(value) {
  var code = upper_(requiredText_(value, "schoolCode", 100));
  if (code.length < SCHOOL_ACCESS_CODE_MIN_LENGTH || !/[A-Z]/.test(code) || !/[0-9]/.test(code)) {
    throw apiError_(
      "WEAK_SCHOOL_CODE",
      "Kod akses sekolah mesti sekurang-kurangnya " + SCHOOL_ACCESS_CODE_MIN_LENGTH + " aksara serta mengandungi huruf dan nombor."
    );
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    throw apiError_("INVALID_SCHOOL_CODE_FORMAT", "Kod akses sekolah hanya boleh mengandungi huruf, nombor dan tanda sempang.");
  }
  return code;
}

function generateSchoolAccessCode_() {
  return "KT-" + Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase();
}

function hashSchoolAccessCode_(code, salt) {
  return tokenHash_(text_(salt) + ":" + normalizeSchoolAccessCode_(code));
}

function schoolAccessCodeFields_(code) {
  var normalized = normalizeSchoolAccessCode_(code);
  var salt = tokenHash_(Utilities.getUuid() + ":" + new Date().getTime());
  return {
    access_code_hash: hashSchoolAccessCode_(normalized, salt),
    access_code_salt: salt,
    access_code_last4: normalized.slice(-4),
    access_code_updated_at: new Date()
  };
}

function assertSchoolAccessCodeAvailable_(code, ownSchoolId) {
  var normalized = normalizeSchoolAccessCode_(code);
  var duplicate = rows_("SEKOLAH").some(function (school) {
    if (same_(school.school_id, ownSchoolId)) return false;
    var salt = text_(school.access_code_salt);
    var expected = text_(school.access_code_hash);
    return Boolean(salt && expected && constantTimeEquals_(hashSchoolAccessCode_(normalized, salt), expected));
  });
  if (duplicate) throw apiError_("DUPLICATE_SCHOOL_ACCESS_CODE", "Kod akses ini sudah digunakan oleh sekolah lain.");
}

function constantTimeEquals_(left, right) {
  var a = text_(left);
  var b = text_(right);
  var mismatch = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var i = 0; i < length; i += 1) {
    mismatch |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  }
  return mismatch === 0;
}

function publicSchoolRecord_(school) {
  if (!school || typeof school !== "object") return school;
  return {
    school_id: text_(school.school_id),
    kod_sekolah: text_(school.kod_sekolah),
    nama_sekolah: text_(school.nama_sekolah),
    zon: text_(school.zon),
    status: text_(school.status) || "Aktif",
    access_code_configured: Boolean(text_(school.access_code_hash) && text_(school.access_code_salt)),
    access_code_last4: text_(school.access_code_last4),
    access_code_updated_at: school.access_code_updated_at || ""
  };
}

function schoolSessionEpoch_() {
  var properties = PropertiesService.getScriptProperties();
  var epoch = Number(properties.getProperty(SCHOOL_SESSION_EPOCH_PROPERTY) || 1);
  if (!Number.isFinite(epoch) || epoch < 1) epoch = 1;
  properties.setProperty(SCHOOL_SESSION_EPOCH_PROPERTY, String(epoch));
  return epoch;
}

function bumpSchoolSessionEpoch_() {
  var next = schoolSessionEpoch_() + 1;
  PropertiesService.getScriptProperties().setProperty(SCHOOL_SESSION_EPOCH_PROPERTY, String(next));
  return next;
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

/** Admin boleh melihat semua sekolah; guru sentiasa dihadkan kepada sekolah sendiri. */
function authorizedStudentRows_(user, requestedSchoolId) {
  var schoolId = authorizedSchoolScope_(user, requestedSchoolId, true);
  return rows_("MURID").filter(function (student) {
    if (schoolId && !same_(student.school_id, schoolId)) return false;
    if (normalizeRole_(user.role) === "ADMIN") return true;
    return same_(student.school_id, user.school_id);
  });
}

function ownedStudent_(studentId, user) {
  var student = findRow_("MURID", function (row) { return same_(row.student_id, studentId); });
  if (!student) throw apiError_("STUDENT_NOT_FOUND", "Murid tidak ditemui.");

  if (
    normalizeRole_(user.role) !== "ADMIN" &&
    !same_(student.school_id, user.school_id)
  ) {
    throw apiError_("STUDENT_ACCESS_DENIED", "Murid ini bukan di bawah sekolah anda.");
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

function deleteRecord_(name, rowNumber, spreadsheet) {
  var ss = spreadsheet || database_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw apiError_("TABLE_NOT_FOUND", "Tab " + name + " belum diwujudkan.");
  if (!rowNumber || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw apiError_("INVALID_ROW", "Baris untuk dipadam tidak sah.");
  }
  sheet.deleteRow(rowNumber);
}

function clearDataRows_(name, spreadsheet) {
  var ss = spreadsheet || database_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw apiError_("TABLE_NOT_FOUND", "Tab " + name + " belum diwujudkan.");
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
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
  var properties = PropertiesService.getScriptProperties();
  var email = String(properties.getProperty(OWNER_ADMIN_EMAIL_PROPERTY) || Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
  if (!email) return { created: false, reason: "effective_user_email_unavailable" };
  properties.setProperty(OWNER_ADMIN_EMAIL_PROPERTY, email);
  var existing = findRow_("PENGGUNA", function (row) { return lower_(row.email) === email; }, ss);
  if (existing) {
    updateRecord_("PENGGUNA", existing._row, { role: "ADMIN", school_id: "", status: "Aktif" }, ss);
    return { created: false, email: email, reason: "already_exists" };
  }

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

function assertAdmin_(user) {
  if (!user || normalizeRole_(user.role) !== "ADMIN") {
    throw apiError_("ROLE_FORBIDDEN", "Tindakan ini hanya dibenarkan untuk pentadbir.");
  }
  assertAdminIdentity_(user);
}

function assertAdminIdentity_(user) {
  if (
    !user ||
    text_(user._auth_type) !== "GOOGLE" ||
    normalizeRole_(user.role) !== "ADMIN" ||
    upper_(user.status) !== "AKTIF" ||
    lower_(user.email) !== lower_(user._identity_email)
  ) {
    throw apiError_("ADMIN_ACCESS_DENIED", "Akses admin hanya dibenarkan kepada akaun Google pentadbir yang aktif dan berdaftar.");
  }
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

function mergeRecord_(base, changes) {
  var result = {};
  [base || {}, changes || {}].forEach(function (source) {
    Object.keys(source).forEach(function (key) { result[key] = source[key]; });
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
