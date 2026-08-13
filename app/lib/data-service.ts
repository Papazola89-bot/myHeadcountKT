export type DataService<T> = {
  getStudents(): Promise<T[]>;
  saveStudents(students: T[]): Promise<void>;
  saveAssessment(studentId: string, cycle: string, skillCode: string): Promise<void>;
  saveIntervention(payload: Record<string, unknown>): Promise<void>;
  submitCycle(cycle: string): Promise<void>;
};

/** Adapter demo. Tukar kepada createAppsScriptDataService apabila endpoint tersedia. */
export function createLocalDataService<T>(key: string): DataService<T> {
  return {
    async getStudents() {
      if (typeof window === "undefined") return [];
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    },
    async saveStudents(students) {
      window.localStorage.setItem(key, JSON.stringify(students));
    },
    async saveAssessment() {},
    async saveIntervention() {},
    async submitCycle() {},
  };
}

export function createAppsScriptDataService<T>(endpoint: string): DataService<T> {
  const request = async (action: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) throw new Error("Permintaan ke pelayan tidak berjaya.");
    return response.json();
  };
  return {
    async getStudents() { return (await request("getStudents")) as T[]; },
    async saveStudents(students) { await request("saveStudents", { students }); },
    async saveAssessment(studentId, cycle, skillCode) { await request("saveAssessment", { studentId, cycle, skillCode }); },
    async saveIntervention(payload) { await request("saveIntervention", payload); },
    async submitCycle(cycle) { await request("submitCycle", { cycle }); },
  };
}
