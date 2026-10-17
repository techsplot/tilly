import type { FarmEvent } from "./farm-event";

type Activity = Exclude<FarmEvent["activity"], "other">;

const ACTIVITY_WORDS: Record<Activity, RegExp> = {
  planting: /\b(plant(ed|ing|s)?|sow(ed|n|ing|s)?|transplant(ed|ing|s)?)\b/i,
  fertilizing: /\b(fertili[sz](e|ed|er|ing)|manure[ds]?|npk|urea)\b/i,
  weeding: /\bweed(ed|ing|s)?\b/i,
  spraying: /\bspray(ed|ing|s)?\b/i,
  harvesting: /\b(harvest(ed|ing|s)?|reap(ed|ing)?)\b/i,
  inspection: /\b(inspect(ed|ing|ion|s)?)\b/i,
  irrigation: /\b(irrigat(e|ed|ing|ion)|water(ed|ing))\b/i,
};

/** The farm activities a message names in words. */
export function mentionedActivities(text: string): Set<Activity> {
  const found = new Set<Activity>();
  for (const [activity, pattern] of Object.entries(ACTIVITY_WORDS) as Array<
    [Activity, RegExp]
  >) {
    if (pattern.test(text)) found.add(activity);
  }
  return found;
}

/**
 * Whether a reply to "which crop?" (or similar) names an activity other
 * than the one being asked about, as in "I sprayed": then it is a new
 * note, not an answer.
 */
export function namesAnotherActivity(
  reply: string,
  pendingActivity: FarmEvent["activity"],
  originalMessage: string,
): boolean {
  const known = mentionedActivities(originalMessage);
  for (const activity of mentionedActivities(reply)) {
    if (activity !== pendingActivity && !known.has(activity)) return true;
  }
  return false;
}
