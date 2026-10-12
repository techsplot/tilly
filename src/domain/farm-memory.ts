export type MemoryField = {
  id: string;
  name: string;
};

export type MemoryEvent = {
  id: string;
  activity: string;
  crop: string | null;
  field: string | null;
  eventDate: string | null;
};

export type FarmMemory = {
  fields: MemoryField[];
  recentEvents: MemoryEvent[];
};

export type MemoryResolution = {
  field?: "field";
  crop?: "crop";
  eventId: string;
};

export type MemoryVerification = {
  event: {
    field: string | null;
    crop: string | null;
    fieldSource?: "message" | "memory" | null;
    cropSource?: "message" | "memory" | null;
    memoryEventIds: string[];
  };
  resolvedFromMemory: MemoryResolution[];
  unresolvedReferences: string[];
};

export function normalizeMemoryFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function verifyMemoryReferences(
  event: MemoryVerification["event"],
  memory: FarmMemory,
): MemoryVerification {
  const knownEventIds = new Set(memory.recentEvents.map((item) => item.id));
  const memoryEventIds = event.memoryEventIds.filter((id) =>
    knownEventIds.has(id),
  );
  const unresolvedReferences: string[] = [];
  const resolvedFromMemory: MemoryResolution[] = [];
  let field = event.field;
  let crop = event.crop;

  if (event.fieldSource === "memory") {
    const matchingFields = memory.fields.filter(
      (item) =>
        field !== null &&
        normalizeMemoryFieldName(item.name) === normalizeMemoryFieldName(field),
    );
    const citedFields = new Set(
      memory.recentEvents
        .filter((item) => memoryEventIds.includes(item.id) && item.field)
        .map((item) => normalizeMemoryFieldName(item.field!)),
    );
    const eligibleFields = matchingFields.filter((item) =>
      citedFields.size === 0
        ? true
        : citedFields.has(normalizeMemoryFieldName(item.name)),
    );
    if (eligibleFields.length === 1) {
      field = eligibleFields[0]!.name;
      resolvedFromMemory.push({ field: "field", eventId: memoryEventIds[0]! });
    } else {
      field = null;
      unresolvedReferences.push("field");
    }
  }

  if (event.cropSource === "memory") {
    const matchingEvent = memory.recentEvents.find(
      (item) =>
        memoryEventIds.includes(item.id) &&
        item.crop !== null &&
        crop !== null &&
        item.crop.toLowerCase() === crop.toLowerCase(),
    );
    if (matchingEvent) {
      crop = matchingEvent.crop;
      resolvedFromMemory.push({ crop: "crop", eventId: matchingEvent.id });
    } else {
      crop = null;
      unresolvedReferences.push("crop");
    }
  }

  return {
    event: { ...event, field, crop, memoryEventIds },
    resolvedFromMemory,
    unresolvedReferences,
  };
}
