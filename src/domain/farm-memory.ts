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
  activity: string;
  eventDate: string | null;
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
    const citedFields = memory.recentEvents.filter(
      (item) => memoryEventIds.includes(item.id) && item.field,
    );
    const distinctCitedFields = new Set(
      citedFields.map((item) => normalizeMemoryFieldName(item.field!)),
    );
    const matchingField = memory.fields.find(
      (item) =>
        field !== null &&
        normalizeMemoryFieldName(item.name) === normalizeMemoryFieldName(field),
    );
    if (matchingField && distinctCitedFields.size === 1) {
      const source = citedFields[0]!;
      field = matchingField.name;
      resolvedFromMemory.push({
        field: "field",
        eventId: source.id,
        activity: source.activity,
        eventDate: source.eventDate,
      });
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
      resolvedFromMemory.push({
        crop: "crop",
        eventId: matchingEvent.id,
        activity: matchingEvent.activity,
        eventDate: matchingEvent.eventDate,
      });
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
