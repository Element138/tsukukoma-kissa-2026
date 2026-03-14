export const AGE_GROUPS = [
  { key: "infant", label: "乳幼児", csvColumn: "age_乳幼児" },
  { key: "elementary", label: "小学生", csvColumn: "age_小学生" },
  { key: "juniorSeniorHigh", label: "中高生", csvColumn: "age_中高生" },
  { key: "age18to29", label: "18～29歳", csvColumn: "age_18_29" },
  { key: "age30to49", label: "30～49歳", csvColumn: "age_30_49" },
  { key: "age50to64", label: "50～64歳", csvColumn: "age_50_64" },
  { key: "age65Plus", label: "65歳以上", csvColumn: "age_65_plus" },
] as const;

export type AgeGroupKey = (typeof AGE_GROUPS)[number]["key"];
export type AgeGroupLabel = (typeof AGE_GROUPS)[number]["label"];

export type AgeGroupCounts = Record<AgeGroupKey, number>;

export const EMPTY_AGE_GROUP_COUNTS: AgeGroupCounts = {
  infant: 0,
  elementary: 0,
  juniorSeniorHigh: 0,
  age18to29: 0,
  age30to49: 0,
  age50to64: 0,
  age65Plus: 0,
};

const AGE_GROUP_ALIAS_TO_KEY: Record<string, AgeGroupKey> = {
  "乳幼児": "infant",
  "0-6歳": "infant",
  "0～6歳": "infant",
  "0~6歳": "infant",
  "小学生": "elementary",
  "7-12歳": "elementary",
  "7～12歳": "elementary",
  "7~12歳": "elementary",
  "中高生": "juniorSeniorHigh",
  "13-19歳": "juniorSeniorHigh",
  "13～19歳": "juniorSeniorHigh",
  "13~19歳": "juniorSeniorHigh",
  "18～29歳": "age18to29",
  "18-29歳": "age18to29",
  "18~29歳": "age18to29",
  "30～49歳": "age30to49",
  "30-49歳": "age30to49",
  "30~49歳": "age30to49",
  "50～64歳": "age50to64",
  "50-64歳": "age50to64",
  "50~64歳": "age50to64",
  "65歳以上": "age65Plus",
  "65+": "age65Plus",
  "65歳+": "age65Plus",
  "20-64歳": "age30to49",
  "20～64歳": "age30to49",
  "20~64歳": "age30to49",
};

export function createEmptyAgeGroupCounts(): AgeGroupCounts {
  return { ...EMPTY_AGE_GROUP_COUNTS };
}

export function ageGroupCountsToRanges(counts: AgeGroupCounts): AgeGroupLabel[] {
  return AGE_GROUPS.flatMap((group) =>
    Array.from({ length: Math.max(0, counts[group.key] ?? 0) }, () => group.label),
  );
}

export function parseAgeRangesToCounts(raw: unknown): AgeGroupCounts {
  const counts = createEmptyAgeGroupCounts();
  if (!Array.isArray(raw)) {
    return counts;
  }

  for (const value of raw) {
    if (typeof value !== "string") {
      continue;
    }
    const key = AGE_GROUP_ALIAS_TO_KEY[value.trim()];
    if (!key) {
      continue;
    }
    counts[key] += 1;
  }

  return counts;
}
