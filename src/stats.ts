import type { JulesStats, RankedStat, WeekdayActivity } from "./types";
import { collectJulesUsageSummary, type ActivityKind, type JulesClientConfig } from "./collector";
import { formatDateKey } from "./utils/dates";

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  agentMessaged: "Agent Message",
  userMessaged: "User Message",
  planGenerated: "Plan Generated",
  planApproved: "Plan Approved",
  progressUpdated: "Progress Update",
  sessionCompleted: "Session Completed",
  sessionFailed: "Session Failed",
  unknown: "Other",
};

export async function calculateStats(year: number, config: JulesClientConfig): Promise<JulesStats> {
  const summary = await collectJulesUsageSummary(year, config);

  const dailyActivity = summary.dailyActivity;
  const weekdayCounts: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];

  for (const [date, count] of dailyActivity.entries()) {
    const weekday = new Date(date).getDay();
    weekdayCounts[weekday] += count;
  }

  const mostActiveDay = findMostActiveDay(dailyActivity);
  const weekdayActivity = buildWeekdayActivity(weekdayCounts);

  const totalActivities = summary.totalActivities;

  const topSources = buildRankedStats(summary.sourceCounts, totalActivities);
  const topActivityTypes = buildRankedStats(summary.activityTypeCounts, totalActivities, ACTIVITY_LABELS);

  const { maxStreak, currentStreak, maxStreakDays } = calculateStreaks(dailyActivity, year);

  const totalFinished = summary.totalSessionCompleted + summary.totalSessionFailed;
  const planApprovalRate =
    summary.totalPlansGenerated > 0 ? (summary.totalPlansApproved / summary.totalPlansGenerated) * 100 : 0;

  let topAutomationMode: string | null = null;
  let maxModeCount = 0;
  for (const [mode, count] of summary.automationModeCounts.entries()) {
    if (count > maxModeCount) {
      maxModeCount = count;
      topAutomationMode = mode;
    }
  }

  // Clean up mode names (e.g., "AUTOMATION_MODE_UNSPECIFIED" -> "Unspecified")
  if (topAutomationMode) {
    topAutomationMode = topAutomationMode
      .replace(/^AUTOMATION_MODE_/, "")
      .replace(/_/g, " ")
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  const firstSessionDate = summary.firstSessionDate ?? new Date();
  const daysSinceFirstSession = Math.floor((Date.now() - firstSessionDate.getTime()) / (1000 * 60 * 60 * 24));

  return {
    year,
    firstSessionDate,
    daysSinceFirstSession,
    totalSessions: summary.totalSessions,
    totalActivities,
    totalMessages: summary.totalMessages,
    totalAgentMessages: summary.totalAgentMessages,
    totalUserMessages: summary.totalUserMessages,
    totalSources: summary.sourceCounts.size,
    totalTokensEstimated: summary.totalTokensEstimated,
    totalPlansGenerated: summary.totalPlansGenerated,
    totalPlansApproved: summary.totalPlansApproved,
    totalProgressUpdates: summary.totalProgressUpdates,
    totalSessionCompleted: summary.totalSessionCompleted,
    totalSessionFailed: summary.totalSessionFailed,
    topAutomationMode,
    planApprovalRate,
    totalChangeSets: summary.totalChangeSets,
    totalBashOutputs: summary.totalBashOutputs,
    totalMedia: summary.totalMedia,
    totalPullRequests: summary.totalPullRequests,
    requirePlanApprovalCount: summary.requirePlanApprovalCount,
    topSources,
    topActivityTypes,
    maxStreak,
    currentStreak,
    maxStreakDays,
    dailyActivity,
    mostActiveDay,
    weekdayActivity,
  };
}

function buildRankedStats(
  map: Map<string, number>,
  total: number,
  labelOverrides?: Record<string, string>
): RankedStat[] {
  const entries = Array.from(map.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const denominator = total > 0 ? total : entries.reduce((sum, [, count]) => sum + count, 0);

  return entries.map(([id, count]) => ({
    id,
    name: labelOverrides?.[id] ?? id,
    count,
    percentage: denominator > 0 ? (count / denominator) * 100 : 0,
  }));
}

function calculateStreaks(
  dailyActivity: Map<string, number>,
  year: number
): { maxStreak: number; currentStreak: number; maxStreakDays: Set<string> } {
  // Get all active dates sorted
  const activeDates = Array.from(dailyActivity.keys())
    .filter((date) => date.startsWith(String(year)))
    .sort();

  if (activeDates.length === 0) {
    return { maxStreak: 0, currentStreak: 0, maxStreakDays: new Set() };
  }

  let maxStreak = 1;
  let tempStreak = 1;
  let tempStreakStart = 0;
  let maxStreakStart = 0;
  let maxStreakEnd = 0;

  for (let i = 1; i < activeDates.length; i++) {
    const prevDate = new Date(activeDates[i - 1]);
    const currDate = new Date(activeDates[i]);

    // Calculate difference in days
    const diffTime = currDate.getTime() - prevDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      tempStreak++;
      if (tempStreak > maxStreak) {
        maxStreak = tempStreak;
        maxStreakStart = tempStreakStart;
        maxStreakEnd = i;
      }
    } else {
      tempStreak = 1;
      tempStreakStart = i;
    }
  }

  // Build the set of max streak days
  const maxStreakDays = new Set<string>();
  for (let i = maxStreakStart; i <= maxStreakEnd; i++) {
    maxStreakDays.add(activeDates[i]);
  }

  // Calculate current streak (from today or yesterday backwards)
  const today = formatDateKey(new Date());
  const yesterday = formatDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const currentStreak = dailyActivity.has(today)
    ? countStreakBackwards(dailyActivity, new Date())
    : dailyActivity.has(yesterday)
    ? countStreakBackwards(dailyActivity, new Date(Date.now() - 24 * 60 * 60 * 1000))
    : 0;

  return { maxStreak, currentStreak, maxStreakDays };
}

/** Count consecutive days with activity going backwards from startDate (inclusive) */
function countStreakBackwards(dailyActivity: Map<string, number>, startDate: Date): number {
  let streak = 1;
  let checkDate = new Date(startDate);

  while (true) {
    checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
    if (dailyActivity.has(formatDateKey(checkDate))) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function findMostActiveDay(
  dailyActivity: Map<string, number>
): { date: string; count: number; formattedDate: string } | null {
  if (dailyActivity.size === 0) {
    return null;
  }

  let maxDate = "";
  let maxCount = 0;

  for (const [date, count] of dailyActivity.entries()) {
    if (count > maxCount) {
      maxCount = count;
      maxDate = date;
    }
  }

  if (!maxDate) {
    return null;
  }

  // Parse date string (YYYY-MM-DD) and format as "Mon D"
  const [year, month, day] = maxDate.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formattedDate = `${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}`;

  return {
    date: maxDate,
    count: maxCount,
    formattedDate,
  };
}

function buildWeekdayActivity(counts: [number, number, number, number, number, number, number]): WeekdayActivity {
  const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  let mostActiveDay = 0;
  let maxCount = 0;
  for (let i = 0; i < 7; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      mostActiveDay = i;
    }
  }

  return {
    counts,
    mostActiveDay,
    mostActiveDayName: WEEKDAY_NAMES_FULL[mostActiveDay],
    maxCount,
  };
}
