import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const saveScore = mutation({
  args: { playerName: v.string(), score: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("scores", {
      playerName: args.playerName,
      score: args.score,
      timestamp: Date.now(),
    });
  },
});

export const getLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("scores").order("desc").take(10); // Top 10 scores
  },
});
