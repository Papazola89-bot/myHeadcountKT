export type AnalysisImportSubject = "Bahasa Melayu" | "Matematik";

export type AnalysisImportRow = {
  name: string;
  year: number;
  className: string;
  subject: AnalysisImportSubject;
  skillCode: string;
};

export type AnalysisImportPreview = {
  schoolName: string;
  sourceActivity: string;
  pupilCount: number;
  rows: AnalysisImportRow[];
};

const YEAR_WORDS: Record<string, number> = {
  SATU: 1,
  DUA: 2,
  TIGA: 3,
  EMPAT: 4,
  LIMA: 5,
  ENAM: 6,
};

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(html: string) {
  const bodies = [...html.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)];
  const source = bodies.at(-1)?.[1] ?? html;
  return [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeHtml(cell[1])),
  );
}

function yearNumber(value: string) {
  const direct = value.match(/\b([1-6])\b/);
  if (direct) return Number(direct[1]);
  const normalized = value.toUpperCase();
  return Object.entries(YEAR_WORDS).find(([word]) => normalized.includes(word))?.[1] ?? 0;
}

function skillNumber(skill: string, mastered: string) {
  if (/\bYA\b/i.test(mastered) || /MENGUASAI/i.test(skill)) return 32;
  const match = skill.match(/KP\s*(\d{1,2})/i);
  const value = Number(match?.[1] ?? 0);
  return value >= 1 && value <= 32 ? value : 0;
}

/** Membaca eksport Analisis Keseluruhan yang disimpan sebagai fail .xls berasaskan HTML. */
export function parseAnalysisExport(content: string): AnalysisImportPreview {
  if (!/<table\b/i.test(content)) {
    throw new Error("Fail ini bukan eksport Analisis Keseluruhan yang disokong.");
  }

  const rows = tableRows(content).filter((cells) => /^\d+$/.test(cells[0] ?? "") && cells.length >= 21);
  if (!rows.length) throw new Error("Tiada rekod murid dapat dikesan dalam fail ini.");

  const imported: AnalysisImportRow[] = [];
  for (const cells of rows) {
    const name = (cells[4] ?? "").trim().replace(/\s+/g, " ");
    const year = yearNumber(cells[10] ?? "");
    if (!name || year < 2 || year > 6) continue;
    const className = `Tahun ${year}`;
    const subjects: Array<[AnalysisImportSubject, number]> = [
      ["Bahasa Melayu", skillNumber(cells[13] ?? "", cells[14] ?? "")],
      ["Matematik", skillNumber(cells[17] ?? "", cells[18] ?? "")],
    ];
    for (const [subject, skill] of subjects) {
      if (skill) imported.push({ name, year, className, subject, skillCode: `KP${skill}` });
    }
  }

  if (!imported.length) throw new Error("Nama murid ditemui tetapi tiada kemahiran yang boleh diimport.");
  const sourceActivity = content.match(/AKTIVITI PENTAKSIRAN:<\/strong><\/td><td[^>]*>([^<]+)/i)?.[1]?.trim() ?? "";
  return {
    schoolName: rows[0]?.[3] ?? "",
    sourceActivity,
    pupilCount: new Set(imported.map((row) => row.name.toUpperCase())).size,
    rows: imported,
  };
}
