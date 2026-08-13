export type AssessmentContext = {
  subject: string;
  tahun_data: number;
};

export type SubmissionContext = {
  subject: string;
  tahun: number;
};

export type UserProfile = {
  userId: string;
  email: string;
  name: string;
  role: "GURU" | "ADMIN";
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  schoolZone: string;
};

export type SchoolRecord = {
  id: string;
  code: string;
  name: string;
  zone: string;
  status: "Aktif" | "Tidak Aktif";
  teacherCount: number;
  studentCount: number;
  achievement: number;
  submissionStatus: string;
};

export type InterventionRecord = {
  id: string;
  studentId: string;
  studentName: string;
  schoolId: string;
  schoolName: string;
  skillCode: string;
  issue: string;
  action: string;
  method: string;
  startDate: string;
  reviewDate: string;
  outcome: string;
  status: string;
};

export type DataService<T> = {
  getProfile(): Promise<UserProfile>;
  saveProfile(name: string): Promise<UserProfile>;
  getStudents(): Promise<T[]>;
  getSchools(): Promise<SchoolRecord[]>;
  getInterventions(): Promise<InterventionRecord[]>;
  saveStudents(students: T[]): Promise<void>;
  saveStudent(payload: Record<string, unknown>): Promise<void>;
  saveSchool(payload: Record<string, unknown>): Promise<SchoolRecord>;
  deleteSchool(schoolId: string): Promise<void>;
  clearSchools(confirmation: string): Promise<void>;
  saveAssessment(
    studentId: string,
    cycle: string,
    skillCode: string,
    context: AssessmentContext,
  ): Promise<void>;
  saveIntervention(payload: Record<string, unknown>): Promise<void>;
  submitCycle(cycle: string, context: SubmissionContext): Promise<void>;
};

type JsonRecord = Record<string, unknown>;

export type NormalizedAppsScriptStudent = {
  id: string;
  name: string;
  year: number;
  className: string;
  subject: "Bahasa Melayu" | "Matematik";
  status: "Aktif" | "Pelepasan";
  startDate: string;
  skills: Record<string, number>;
  intervention: "Tiada" | "Aktif" | "Selesai" | "Perlu susulan";
};

const CYCLES = ["TOV", "OTI 1", "AR 1", "OTI 2", "AR 2", "OTI 3", "AR 3", "ETR"];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalizeUserProfile(value: unknown): UserProfile {
  const row = asRecord(value);
  const rawRole = String(row.role ?? "GURU").toUpperCase();
  return {
    userId: String(row.user_id ?? row.userId ?? ""),
    email: String(row.email ?? ""),
    name: String(row.nama ?? row.name ?? "Pengguna"),
    role: rawRole === "ADMIN" ? "ADMIN" : "GURU",
    schoolId: String(row.school_id ?? row.schoolId ?? ""),
    schoolName: String(row.school_name ?? row.schoolName ?? ""),
    schoolCode: String(row.school_code ?? row.schoolCode ?? ""),
    schoolZone: String(row.school_zone ?? row.schoolZone ?? ""),
  };
}

function normalizeSchool(value: unknown): SchoolRecord {
  const row = asRecord(value);
  const rawStatus = String(row.status ?? "Aktif").toLowerCase();
  return {
    id: String(row.school_id ?? row.schoolId ?? row.id ?? ""),
    code: String(row.kod_sekolah ?? row.schoolCode ?? row.code ?? ""),
    name: String(row.nama_sekolah ?? row.schoolName ?? row.name ?? "Tanpa nama"),
    zone: String(row.zon ?? row.schoolZone ?? row.zone ?? "-"),
    status: rawStatus === "aktif" ? "Aktif" : "Tidak Aktif",
    teacherCount: Number(row.teacher_count ?? row.teacherCount ?? 0),
    studentCount: Number(row.student_count ?? row.studentCount ?? 0),
    achievement: Number(row.achievement_percent ?? row.achievement ?? 0),
    submissionStatus: String(row.submission_status ?? row.submissionStatus ?? "Belum mula"),
  };
}

function normalizeIntervention(value: unknown): InterventionRecord {
  const row = asRecord(value);
  return {
    id: String(row.intervention_id ?? row.interventionId ?? row.id ?? ""),
    studentId: String(row.student_id ?? row.studentId ?? ""),
    studentName: String(row.student_name ?? row.studentName ?? "Tanpa nama"),
    schoolId: String(row.school_id ?? row.schoolId ?? ""),
    schoolName: String(row.school_name ?? row.schoolName ?? ""),
    skillCode: String(row.skill_code ?? row.skillCode ?? ""),
    issue: String(row.isu ?? row.issue ?? ""),
    action: String(row.intervensi ?? row.action ?? ""),
    method: String(row.kaedah ?? row.method ?? ""),
    startDate: String(row.tarikh_mula ?? row.startDate ?? "").slice(0, 10),
    reviewDate: String(row.tarikh_semakan ?? row.reviewDate ?? "").slice(0, 10),
    outcome: String(row.outcome ?? ""),
    status: String(row.status ?? ""),
  };
}

function skillNumber(value: unknown): number | undefined {
  const match = String(value ?? "").trim().match(/^(?:KP)?\s*(\d{1,2})$/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  return number >= 1 && number <= 32 ? number : undefined;
}

/** Menukar nama lajur Google Sheets dan rekod PENILAIAN kepada bentuk murid UI. */
export function normalizeAppsScriptStudent(value: unknown): NormalizedAppsScriptStudent {
  const row = asRecord(value);
  const directSkills = asRecord(row.skills);
  const skills: Record<string, number> = {};

  CYCLES.forEach((cycle) => {
    const direct = skillNumber(directSkills[cycle] ?? row[cycle]);
    if (direct !== undefined) skills[cycle] = direct;
  });

  const assessments = Array.isArray(row.assessments) ? row.assessments : [];
  assessments.forEach((assessment) => {
    const item = asRecord(assessment);
    const cycle = String(item.cycle ?? "").trim();
    const skill = skillNumber(item.skill_code ?? item.skillCode);
    if (CYCLES.includes(cycle) && skill !== undefined) skills[cycle] = skill;
  });

  // Isi cycle kosong dengan pencapaian terakhir supaya komponen analisis tidak menerima NaN.
  let lastSkill = skills.TOV ?? 1;
  CYCLES.forEach((cycle) => {
    if (skills[cycle] === undefined) skills[cycle] = lastSkill;
    lastSkill = skills[cycle];
  });

  const rawSubject = String(row.subject ?? row.subjek ?? "Bahasa Melayu").toLowerCase();
  const rawStatus = String(row.status ?? "Aktif").toLowerCase();
  const rawIntervention = String(
    row.intervention ?? row.intervensi ?? row.intervention_status ?? "Tiada",
  ).toLowerCase();
  const intervention = rawIntervention.includes("susulan")
    ? "Perlu susulan"
    : rawIntervention.includes("selesai") || rawIntervention.includes("berjaya")
      ? "Selesai"
      : rawIntervention === "tiada" || rawIntervention === ""
        ? "Tiada"
        : "Aktif";

  const rawDate = row.tarikh_mula ?? row.startDate ?? "";
  const startDate = String(rawDate).slice(0, 10);

  return {
    id: String(row.student_id ?? row.id ?? ""),
    name: String(row.nama ?? row.name ?? "Tanpa nama"),
    year: Number(row.tahun ?? row.year ?? 1),
    className: String(row.kelas ?? row.className ?? "-"),
    subject: rawSubject.includes("matematik") ? "Matematik" : "Bahasa Melayu",
    status: rawStatus.includes("pelepasan") ? "Pelepasan" : "Aktif",
    startDate,
    skills,
    intervention,
  };
}

/** Storan cache/demo setempat. Data domain Google Sheets menggunakan adapter di bawah. */
export function createLocalDataService<T>(key: string): DataService<T> {
  return {
    async getProfile() {
      throw new Error("Profil pengguna tidak tersedia dalam mod lokal.");
    },
    async saveProfile() {
      throw new Error("Profil pengguna tidak boleh disimpan dalam mod lokal.");
    },
    async getStudents() {
      if (typeof window === "undefined") return [];
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    },
    async getSchools() {
      return [];
    },
    async getInterventions() {
      return [];
    },
    async saveStudents(students) {
      window.localStorage.setItem(key, JSON.stringify(students));
    },
    async saveStudent() {},
    async saveSchool() {
      throw new Error("Sekolah tidak boleh disimpan dalam mod lokal.");
    },
    async deleteSchool() {
      throw new Error("Sekolah tidak boleh dipadam dalam mod lokal.");
    },
    async clearSchools() {
      throw new Error("Senarai sekolah tidak boleh dikosongkan dalam mod lokal.");
    },
    async saveAssessment() {},
    async saveIntervention() {},
    async submitCycle() {},
  };
}

export function createAppsScriptDataService<T>(
  endpoint: string,
  normalizeStudent: (value: unknown) => T = (value) => value as T,
  getIdToken: () => string = () => "",
): DataService<T> {
  const request = async (action: string, payload: JsonRecord = {}): Promise<unknown> => {
    const idToken = getIdToken().trim();
    if (!idToken) {
      throw new Error("Sila log masuk dengan Google sebelum mengakses Google Sheets.");
    }
    const requestId = globalThis.crypto.randomUUID();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload, request_id: requestId, idToken }),
    });
    const text = await response.text();
    let result: JsonRecord;
    try {
      result = asRecord(JSON.parse(text));
    } catch {
      throw new Error("Pelayan Google Apps Script tidak memulangkan JSON yang sah.");
    }
    if (!response.ok) throw new Error("Permintaan ke pelayan tidak berjaya.");
    if (result.ok !== true) {
      const serverError = asRecord(result.error);
      throw new Error(String(serverError.message ?? result.error ?? "Google Apps Script menolak permintaan."));
    }
    return result.data;
  };

  return {
    async getProfile() {
      return normalizeUserProfile(await request("getProfile"));
    },
    async saveProfile(name) {
      return normalizeUserProfile(await request("saveProfile", { name }));
    },
    async getStudents() {
      const data = await request("getStudents");
      if (!Array.isArray(data)) throw new Error("Senarai murid daripada Google Sheets tidak sah.");
      return data.map(normalizeStudent);
    },
    async getSchools() {
      const data = await request("getSchools");
      if (!Array.isArray(data)) throw new Error("Senarai sekolah daripada Google Sheets tidak sah.");
      return data.map(normalizeSchool);
    },
    async getInterventions() {
      const data = await request("getInterventions");
      if (!Array.isArray(data)) throw new Error("Senarai intervensi daripada Google Sheets tidak sah.");
      return data.map(normalizeIntervention);
    },
    // MURID diurus melalui helaian; cache UI disimpan oleh adapter setempat.
    async saveStudents() {},
    async saveStudent(payload) {
      await request("saveStudent", payload);
    },
    async saveSchool(payload) {
      return normalizeSchool(await request("saveSchool", payload));
    },
    async deleteSchool(schoolId) {
      await request("deleteSchool", { schoolId });
    },
    async clearSchools(confirmation) {
      await request("clearSchools", { confirmation });
    },
    async saveAssessment(studentId, cycle, skillCode, context) {
      await request("saveAssessment", { studentId, cycle, skillCode, ...context });
    },
    async saveIntervention(payload) {
      await request("saveIntervention", payload);
    },
    async submitCycle(cycle, context) {
      await request("submitCycle", { cycle, ...context });
    },
  };
}
