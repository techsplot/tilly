// The sample farm a judge can open from an empty farm. Plain constants:
// `daysAgo` is counted back from the farmer's today when the farm is
// created, so the records never go stale.

export const SAMPLE_FARM_NAME = "Sample Farm";

export type SampleRecord = {
  daysAgo: number;
  activity:
    | "planting"
    | "fertilizing"
    | "weeding"
    | "spraying"
    | "harvesting"
    | "inspection"
    | "irrigation";
  crop: string | null;
  field: string | null;
  quantity: number | null;
  unit: string | null;
  timeOfDay: "morning" | "afternoon" | "evening" | null;
  sourceText: string;
  // Saved incomplete: the farmer did not say which field.
  gap?: true;
  // Saved as said, then corrected, leaving a correction in its history.
  correctedTo?: { field: string };
};

export const SAMPLE_RECORDS: SampleRecord[] = [
  {
    daysAgo: 20,
    activity: "planting",
    crop: "maize",
    field: "North Field",
    quantity: 4,
    unit: "bags of seed",
    timeOfDay: "morning",
    sourceText: "Planted 4 bags of maize seed in the north field this morning",
  },
  {
    daysAgo: 19,
    activity: "planting",
    crop: "cassava",
    field: "River Plot",
    quantity: 200,
    unit: "stems",
    timeOfDay: null,
    sourceText: "Planted 200 cassava stems at the river plot",
  },
  {
    daysAgo: 18,
    activity: "irrigation",
    crop: null,
    field: "North Field",
    quantity: null,
    unit: null,
    timeOfDay: "evening",
    sourceText: "Watered the north field in the evening",
  },
  {
    daysAgo: 17,
    activity: "planting",
    crop: "tomatoes",
    field: "Back Garden",
    quantity: 60,
    unit: "seedlings",
    timeOfDay: "morning",
    sourceText: "Transplanted 60 tomato seedlings in the back garden",
  },
  {
    daysAgo: 15,
    activity: "fertilizing",
    crop: "maize",
    field: "North Field",
    quantity: 2,
    unit: "bags of NPK",
    timeOfDay: null,
    sourceText: "Applied 2 bags of NPK on the maize in the north field",
  },
  {
    daysAgo: 13,
    activity: "weeding",
    crop: "cassava",
    field: "River Plot",
    quantity: null,
    unit: null,
    timeOfDay: "morning",
    sourceText: "Weeded the cassava at the river plot",
  },
  {
    daysAgo: 12,
    activity: "spraying",
    crop: "tomatoes",
    field: "North Field",
    quantity: 1,
    unit: "knapsack",
    timeOfDay: "afternoon",
    sourceText: "Sprayed the tomatoes against blight, one knapsack",
    correctedTo: { field: "Back Garden" },
  },
  {
    daysAgo: 10,
    activity: "weeding",
    crop: "maize",
    field: "North Field",
    quantity: null,
    unit: null,
    timeOfDay: null,
    sourceText: "Weeded the maize in the north field",
  },
  {
    daysAgo: 9,
    activity: "inspection",
    crop: "tomatoes",
    field: "Back Garden",
    quantity: null,
    unit: null,
    timeOfDay: "morning",
    sourceText: "Checked the tomatoes, first flowers showing",
  },
  {
    daysAgo: 7,
    activity: "spraying",
    crop: "maize",
    field: null,
    quantity: 2,
    unit: "knapsacks",
    timeOfDay: null,
    sourceText: "Sprayed the maize for armyworm, two knapsacks",
    gap: true,
  },
  {
    daysAgo: 6,
    activity: "fertilizing",
    crop: "tomatoes",
    field: "Back Garden",
    quantity: 1,
    unit: "bag of compost",
    timeOfDay: "evening",
    sourceText: "Put a bag of compost on the tomatoes",
  },
  {
    daysAgo: 5,
    activity: "irrigation",
    crop: null,
    field: "Back Garden",
    quantity: null,
    unit: null,
    timeOfDay: "morning",
    sourceText: "Watered the back garden",
  },
  {
    daysAgo: 3,
    activity: "weeding",
    crop: "tomatoes",
    field: "Back Garden",
    quantity: null,
    unit: null,
    timeOfDay: "afternoon",
    sourceText: "Weeded around the tomatoes",
  },
  {
    daysAgo: 2,
    activity: "harvesting",
    crop: "tomatoes",
    field: "Back Garden",
    quantity: 3,
    unit: "baskets",
    timeOfDay: "morning",
    sourceText: "Harvested 3 baskets of tomatoes",
  },
  {
    daysAgo: 1,
    activity: "spraying",
    crop: "cassava",
    field: "River Plot",
    quantity: 1,
    unit: "knapsack",
    timeOfDay: null,
    sourceText: "Sprayed herbicide between the cassava rows",
  },
];
