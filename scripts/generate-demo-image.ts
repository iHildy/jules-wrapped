#!/usr/bin/env bun

import { generateImage } from "../src/image/generator";
import type { JulesStats } from "../src/types";
import { join } from "node:path";

// Generate realistic sample data
function generateDemoStats(): JulesStats {
  const year = 2025;

  // Generate daily activity data for the whole year
  const dailyActivity = new Map<string, number>();
  const startDate = new Date(year, 0, 10);
  const endDate = new Date(year, 11, 31);

  // Create realistic activity patterns
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const dayOfWeek = d.getDay();

    // Higher activity on weekdays
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const baseChance = isWeekday ? 0.7 : 0.35;

    if (Math.random() < baseChance) {
      // Generate activity count with realistic distribution
      const count = Math.floor(Math.random() * 18) + 1;
      dailyActivity.set(dateStr, count);
    }
  }

  // Create a streak period (highlight these days)
  const maxStreakDays = new Set<string>();
  const streakStart = new Date(year, 9, 1); // October
  for (let i = 0; i < 18; i++) {
    const d = new Date(streakStart);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    maxStreakDays.add(dateStr);
  }

  // Weekday activity distribution
  const weekdayCounts: [number, number, number, number, number, number, number] = [
    102, // Sunday
    210, // Monday
    238, // Tuesday
    225, // Wednesday
    231, // Thursday
    205, // Friday
    118, // Saturday
  ];

  const maxWeekdayCount = Math.max(...weekdayCounts);
  const mostActiveWeekday = weekdayCounts.indexOf(maxWeekdayCount);
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const totalSessions = 96;
  const totalActivities = 2314;
  const totalAgentMessages = 812;
  const totalUserMessages = 476;
  const totalMessages = totalAgentMessages + totalUserMessages;
  const totalSessionCompleted = 74;
  const totalSessionFailed = 6;
  const totalPlansGenerated = 88;
  const totalPlansApproved = 73;
  const topAutomationMode = "Auto Create PR";
  const planApprovalRate = totalPlansGenerated > 0 ? (totalPlansApproved / totalPlansGenerated) * 100 : 0;

  return {
    year,
    firstSessionDate: startDate,
    daysSinceFirstSession: Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),

    totalSessions,
    totalActivities,
    totalMessages,
    totalAgentMessages,
    totalUserMessages,
    totalSources: 7,

    totalPlansGenerated,
    totalPlansApproved,
    totalProgressUpdates: 134,
    totalSessionCompleted,
    totalSessionFailed,
    topAutomationMode,
    planApprovalRate,

    totalChangeSets: 312,
    totalBashOutputs: 208,
    totalMedia: 14,
    totalPullRequests: 22,
    requirePlanApprovalCount: 54,

    topSources: [
      { id: "stellar/jules-demo", name: "stellar/jules-demo", count: 724, percentage: 31.3 },
      { id: "stellar/infra", name: "stellar/infra", count: 502, percentage: 21.7 },
      { id: "stellar/cli", name: "stellar/cli", count: 324, percentage: 14.0 },
    ],

    topActivityTypes: [
      { id: "agentMessaged", name: "Agent Message", count: 812, percentage: 35.1 },
      { id: "userMessaged", name: "User Message", count: 476, percentage: 20.6 },
      { id: "planGenerated", name: "Plan Generated", count: 88, percentage: 3.8 },
    ],

    maxStreak: 18,
    currentStreak: 6,
    maxStreakDays,

    dailyActivity,

    mostActiveDay: {
      date: "2025-10-15",
      count: 32,
      formattedDate: "Oct 15",
    },

    weekdayActivity: {
      counts: weekdayCounts,
      mostActiveDay: mostActiveWeekday,
      mostActiveDayName: weekdayNames[mostActiveWeekday],
      maxCount: maxWeekdayCount,
    },
  };
}

async function main() {
  console.log("Generating demo wrapped image...");

  const stats = generateDemoStats();
  const image = await generateImage(stats);

  const outputPath = join(import.meta.dir, "..", "assets", "images", "demo-wrapped.png");
  await Bun.write(outputPath, image.fullSize);

  console.log(`Demo image saved to: ${outputPath}`);
}

main().catch(console.error);
