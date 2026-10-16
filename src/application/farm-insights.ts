import type { Database } from "../infrastructure/db/farm-event-repository";
import { listFarmEvents } from "../infrastructure/db/farm-event-repository";

export type Suggestion = {
  type: "gap" | "pattern" | "follow-up";
  text: string;
  confidence: "high" | "medium" | "low";
  relatedActivity?: string | undefined;
  relatedField?: string | undefined;
};

/**
 * Generate smart suggestions based on farm activity patterns.
 * Returns suggestions for what the farmer might want to do next.
 */
export async function generateSuggestions(
  db: Database,
  farmId: string,
  currentDate: string,
): Promise<Suggestion[]> {
  const events = await listFarmEvents(db, farmId);
  const suggestions: Suggestion[] = [];

  // Get events from last 60 days
  const sixtyDaysAgo = new Date(currentDate);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const recentEvents = events.filter((e) => {
    if (!e.eventDate) return false;
    const eventDate = new Date(e.eventDate);
    return eventDate >= sixtyDaysAgo && !e.deletedAt;
  });

  // Track last activity per field
  const fieldLastActivity = new Map<
    string,
    { activity: string; daysAgo: number }
  >();

  for (const event of recentEvents) {
    if (!event.fieldName || !event.eventDate) continue;

    const eventDate = new Date(event.eventDate);
    const currentDateObj = new Date(currentDate);
    const daysAgo = Math.floor(
      (currentDateObj.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    const key = event.fieldName.toLowerCase();
    const existing = fieldLastActivity.get(key);

    if (!existing || existing.daysAgo > daysAgo) {
      fieldLastActivity.set(key, { activity: event.activity, daysAgo });
    }
  }

  // Suggest weeding for fields not weeded in 14+ days
  for (const [field] of fieldLastActivity.entries()) {
    const weedingEvents = recentEvents.filter(
      (e) =>
        e.fieldName?.toLowerCase() === field &&
        e.activity === "weeding" &&
        !e.deletedAt,
    );

    if (weedingEvents.length > 0) {
      const lastWeeding = weedingEvents[0];
      if (!lastWeeding || !lastWeeding.eventDate) continue;

      const eventDate = new Date(lastWeeding.eventDate);
      const currentDateObj = new Date(currentDate);
      const daysSinceWeeding = Math.floor(
        (currentDateObj.getTime() - eventDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysSinceWeeding >= 14) {
        suggestions.push({
          type: "gap",
          text: `${lastWeeding.fieldName} was last weeded ${daysSinceWeeding} days ago`,
          confidence: daysSinceWeeding >= 21 ? "high" : "medium",
          relatedActivity: "weeding",
          relatedField: lastWeeding.fieldName ?? undefined,
        });
      }
    }
  }

  // Detect follow-up patterns (e.g., spray → weed)
  const sprayingEvents = recentEvents.filter(
    (e) => e.activity === "spraying" && !e.deletedAt,
  );

  if (sprayingEvents.length > 0) {
    const lastSpraying = sprayingEvents[0];
    if (lastSpraying && lastSpraying.eventDate) {
      const eventDate = new Date(lastSpraying.eventDate);
      const currentDateObj = new Date(currentDate);
      const daysSinceSpraying = Math.floor(
        (currentDateObj.getTime() - eventDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      // Check if farmer typically weeds after spraying
      // Look at historical spray events (excluding the most recent one)
      let sprayThenWeedCount = 0;
      for (let i = 1; i < sprayingEvents.length; i++) {
        const spray = sprayingEvents[i];
        if (!spray || !spray.eventDate) continue;

        const nextWeek = recentEvents.filter((e) => {
          if (
            e.activity !== "weeding" ||
            !e.fieldName ||
            !spray.fieldName ||
            !e.eventDate
          )
            return false;
          if (e.fieldName.toLowerCase() !== spray.fieldName.toLowerCase())
            return false;

          const sprayDate = new Date(spray.eventDate!);
          const eventDate = new Date(e.eventDate);
          const daysDiff = Math.floor(
            (eventDate.getTime() - sprayDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          return daysDiff > 0 && daysDiff <= 7;
        });

        if (nextWeek.length > 0) sprayThenWeedCount++;
      }

      if (
        sprayThenWeedCount >= 2 &&
        daysSinceSpraying >= 2 &&
        daysSinceSpraying <= 7 &&
        lastSpraying.fieldName
      ) {
        const hasWeededSince = recentEvents.some((e) => {
          if (
            e.activity !== "weeding" ||
            !e.fieldName ||
            !e.eventDate ||
            !lastSpraying.eventDate
          )
            return false;
          if (
            e.fieldName.toLowerCase() !== lastSpraying.fieldName?.toLowerCase()
          )
            return false;

          const eventDate = new Date(e.eventDate);
          const sprayDate = new Date(lastSpraying.eventDate);
          return eventDate > sprayDate;
        });

        if (!hasWeededSince) {
          suggestions.push({
            type: "follow-up",
            text: `You usually weed ${lastSpraying.fieldName} after spraying`,
            confidence: "medium",
            relatedActivity: "weeding",
            relatedField: lastSpraying.fieldName,
          });
        }
      }
    }
  }

  // Detect activity patterns (recurring activities)
  const activityCounts = new Map<string, number>();
  for (const event of recentEvents) {
    if (!event.fieldName || event.deletedAt) continue;
    const key = `${event.activity}:${event.fieldName.toLowerCase()}`;
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of activityCounts.entries()) {
    if (count >= 3) {
      const [activity, field] = key.split(":");
      if (!activity || !field) continue;

      // Find the typical interval
      const activityEvents = recentEvents
        .filter(
          (e) =>
            e.activity === activity &&
            e.fieldName?.toLowerCase() === field &&
            e.eventDate &&
            !e.deletedAt,
        )
        .sort(
          (a, b) =>
            new Date(b.eventDate!).getTime() - new Date(a.eventDate!).getTime(),
        );

      if (activityEvents.length >= 3) {
        const intervals: number[] = [];
        for (let i = 0; i < activityEvents.length - 1; i++) {
          const current = activityEvents[i];
          const next = activityEvents[i + 1];
          if (!current || !next || !current.eventDate || !next.eventDate)
            continue;

          const days = Math.floor(
            (new Date(current.eventDate).getTime() -
              new Date(next.eventDate).getTime()) /
              (1000 * 60 * 60 * 24),
          );
          intervals.push(days);
        }

        if (intervals.length >= 2) {
          const avgInterval =
            intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const lastEvent = activityEvents[0];
          if (!lastEvent || !lastEvent.eventDate) continue;

          const daysSinceLast = Math.floor(
            (new Date(currentDate).getTime() -
              new Date(lastEvent.eventDate).getTime()) /
              (1000 * 60 * 60 * 24),
          );

          if (daysSinceLast >= avgInterval * 0.8) {
            suggestions.push({
              type: "pattern",
              text: `You typically ${activity} ${lastEvent.fieldName} every ${Math.round(avgInterval)} days`,
              confidence: daysSinceLast >= avgInterval ? "high" : "medium",
              relatedActivity: activity,
              relatedField: lastEvent.fieldName ?? undefined,
            });
          }
        }
      }
    }
  }

  // Sort by confidence and limit
  return suggestions
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.confidence] - order[b.confidence];
    })
    .slice(0, 3);
}

/**
 * Generate a daily briefing of priority actions.
 */
export async function generateDailyBriefing(
  db: Database,
  farmId: string,
  currentDate: string,
): Promise<string> {
  const suggestions = await generateSuggestions(db, farmId, currentDate);
  const events = await listFarmEvents(db, farmId);

  // Get yesterday's activities
  const yesterday = new Date(currentDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const yesterdayEvents = events.filter(
    (e) => e.eventDate === yesterdayStr && !e.deletedAt,
  );

  let briefing = "";

  if (yesterdayEvents.length > 0) {
    const activities = yesterdayEvents
      .map((e) => `${e.activity}${e.fieldName ? ` at ${e.fieldName}` : ""}`)
      .join(", ");
    briefing += `Yesterday: ${activities}. `;
  }

  if (suggestions.length > 0) {
    const topSuggestion = suggestions[0];
    if (topSuggestion) {
      briefing += topSuggestion.text;
    }
  } else if (yesterdayEvents.length > 0) {
    briefing += "Everything's up to date!";
  }

  return briefing || "Welcome back! Tell me what happened on the farm.";
}
