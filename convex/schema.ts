import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scores: defineTable({
    playerName: v.string(),
    score: v.number(),
    timestamp: v.number(),
  })
    .index("by_score", ["score"])
    .index("by_timestamp", ["timestamp"]),
});
