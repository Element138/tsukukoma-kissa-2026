export type PosFulfillmentType = "DINE_IN" | "TAKEOUT";

// A terminal default is applied on first load or a configuration change while
// idle. An unchanged session poll must preserve the cashier's manual selection.
export function posDefaultOnSession(
  previousKey: string | null,
  actorId: string,
  configured: PosFulfillmentType,
  hasDraft: boolean,
): PosFulfillmentType | null {
  if (previousKey === `${actorId}:${configured}`) return null;
  return !hasDraft ? configured : null;
}
