export const SPECIFIED_ALLERGENS = [
  { key: "EGG", label: "卵" },
  { key: "MILK", label: "乳" },
  { key: "WHEAT", label: "小麦" },
  { key: "SHRIMP", label: "えび" },
  { key: "CRAB", label: "かに" },
  { key: "WALNUT", label: "くるみ" },
  { key: "PEANUT", label: "落花生" },
  { key: "BUCKWHEAT", label: "そば" },
] as const;

export type SpecifiedAllergenKey = (typeof SPECIFIED_ALLERGENS)[number]["key"];

const ALLERGEN_LABEL_MAP = new Map(
  SPECIFIED_ALLERGENS.map((row) => [row.key, row.label] as const),
);
const ALLERGEN_KEY_SET = new Set(SPECIFIED_ALLERGENS.map((row) => row.key));

export function isSpecifiedAllergenKey(
  value: unknown,
): value is SpecifiedAllergenKey {
  return (
    typeof value === "string" &&
    ALLERGEN_KEY_SET.has(value as SpecifiedAllergenKey)
  );
}

export function normalizeSpecifiedAllergens(
  values: unknown,
): SpecifiedAllergenKey[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set<SpecifiedAllergenKey>();
  for (const value of values) {
    if (isSpecifiedAllergenKey(value)) {
      unique.add(value);
    }
  }
  return SPECIFIED_ALLERGENS.map((row) => row.key).filter((key) =>
    unique.has(key),
  );
}

export function allergenLabelOf(key: SpecifiedAllergenKey) {
  return ALLERGEN_LABEL_MAP.get(key) ?? key;
}

export function formatAllergenNotice(allergens: SpecifiedAllergenKey[]) {
  if (allergens.length === 0) {
    return "特定原材料なし";
  }
  return `${allergens.map((key) => allergenLabelOf(key)).join("、")}を含む`;
}
