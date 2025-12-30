// Types for Jules Wrapped

export interface RankedStat {
  id: string;
  name: string;
  count: number;
  percentage: number;
}

export interface JulesStats {
  year: number;

  // Time-based
  firstSessionDate: Date;
  daysSinceFirstSession: number;

  // Counts
  totalSessions: number;
  totalActivities: number;
  totalMessages: number;
  totalAgentMessages: number;
  totalUserMessages: number;
  totalSources: number;
  totalTokensEstimated: number;

  // Activity breakdown
  totalPlansGenerated: number;
  totalPlansApproved: number;
  totalProgressUpdates: number;
  totalSessionCompleted: number;
  totalSessionFailed: number;
  topAutomationMode: string | null;
  planApprovalRate: number; // 0-100

  // Artifacts
  totalChangeSets: number;
  totalBashOutputs: number;
  totalMedia: number;
  totalPullRequests: number;

  // Session settings
  requirePlanApprovalCount: number;

  // Rankings
  topSources: RankedStat[];
  topActivityTypes: RankedStat[];

  // Streak
  maxStreak: number;
  currentStreak: number;
  maxStreakDays: Set<string>; // Days that form the max streak (for heatmap highlighting)

  // Activity heatmap (for the year)
  dailyActivity: Map<string, number>; // "2025-01-15" -> count

  // Most active day
  mostActiveDay: {
    date: string;
    count: number;
    formattedDate: string;
  } | null;

  // Weekday activity distribution (0=Sunday, 6=Saturday)
  weekdayActivity: WeekdayActivity;
}

export interface WeekdayActivity {
  counts: [number, number, number, number, number, number, number];
  mostActiveDay: number;
  mostActiveDayName: string;
  maxCount: number;
}

export interface CliArgs {
  year?: number;
  help?: boolean;
}
