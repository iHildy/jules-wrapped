// Data collector - reads Jules API sessions and activities

import { formatDateKey } from "./utils/dates";
import { estimateGeminiTokensFromImage, estimateGeminiTokensFromText } from "./utils/tokens";
import { sampleActivitiesBySession, sampleSessions, sampleSources } from "./sample-data";

const DEFAULT_BASE_URL = "https://jules.googleapis.com/v1alpha";
const API_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15000;
const ACTIVITY_CONCURRENCY = 3;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 90;
const RATE_LIMIT_BUFFER_RATIO = 0.9;

export interface JulesClientConfig {
  apiKey?: string;
  baseUrl?: string;
  useSampleData?: boolean;
  onRateLimit?: (event: RateLimitEvent) => void;
}

export type RateLimitEvent =
  | { type: "sleep"; waitMs: number; count: number }
  | { type: "resume" }
  | { type: "notice"; message: string }
  | { type: "retry"; message: string };

export type ActivityKind =
  | "agentMessaged"
  | "userMessaged"
  | "planGenerated"
  | "planApproved"
  | "progressUpdated"
  | "sessionCompleted"
  | "sessionFailed"
  | "unknown";

export interface JulesSession {
  name?: string;
  id?: string;
  prompt?: string;
  title?: string;
  requirePlanApproval?: boolean;
  automationMode?: string;
  createTime?: string;
  updateTime?: string;
  state?: string;
  url?: string;
  sourceContext?: {
    source?: string;
    githubRepoContext?: {
      startingBranch?: string;
    };
  };
  outputs?: Array<{
    pullRequest?: {
      url?: string;
      title?: string;
      description?: string;
    };
  }>;
}

export interface JulesSource {
  name?: string;
  id?: string;
  githubRepo?: {
    owner?: string;
    repo?: string;
    isPrivate?: boolean;
    defaultBranch?: { displayName?: string };
    branches?: Array<{ displayName?: string }>;
  };
}

export interface JulesArtifact {
  changeSet?: {
    source?: string;
    gitPatch?: {
      unidiffPatch?: string;
      baseCommitId?: string;
      suggestedCommitMessage?: string;
    };
  };
  media?: {
    data?: string;
    mimeType?: string;
  };
  bashOutput?: {
    command?: string;
    output?: string;
    exitCode?: number;
  };
}

export interface JulesActivity {
  name?: string;
  id?: string;
  description?: string;
  createTime?: string;
  originator?: string;
  artifacts?: JulesArtifact[];
  agentMessaged?: { agentMessage?: string };
  userMessaged?: { userMessage?: string };
  planGenerated?: { plan?: { id?: string } };
  planApproved?: { planId?: string };
  progressUpdated?: { title?: string; description?: string };
  sessionCompleted?: Record<string, never>;
  sessionFailed?: { reason?: string };
}

export interface JulesUsageSummary {
  totalSessions: number;
  totalActivities: number;
  totalMessages: number;
  totalAgentMessages: number;
  totalUserMessages: number;
  totalPlansGenerated: number;
  totalPlansApproved: number;
  totalProgressUpdates: number;
  totalSessionCompleted: number;
  totalSessionFailed: number;
  totalChangeSets: number;
  totalBashOutputs: number;
  totalMedia: number;
  totalPullRequests: number;
  totalTokensEstimated: number;
  requirePlanApprovalCount: number;
  firstSessionDate: Date | null;
  dailyActivity: Map<string, number>;
  activityTypeCounts: Map<ActivityKind, number>;
  sourceCounts: Map<string, number>;
  automationModeCounts: Map<string, number>;
}

const ACTIVITY_KIND_ORDER: ActivityKind[] = [
  "agentMessaged",
  "userMessaged",
  "planGenerated",
  "planApproved",
  "progressUpdated",
  "sessionCompleted",
  "sessionFailed",
];

let rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE;
let minIntervalMs = Math.ceil(60_000 / rateLimitPerMinute);
let lastRequestAt = 0;
let rateLimitUntil = 0;
let rateLimitQueue: Promise<void> = Promise.resolve();
let rateLimitNoticeShown = false;
let rateLimitSleepCount = 0;
let lastRateLimitLogAt = 0;

export async function checkJulesDataExists(config: JulesClientConfig): Promise<boolean> {
  if (config.useSampleData) return true;
  return typeof config.apiKey === "string" && config.apiKey.trim() !== "";
}

export async function collectJulesUsageSummary(year: number, config: JulesClientConfig): Promise<JulesUsageSummary> {
  const [sessions, sources] = await Promise.all([listAllSessions(config), listAllSources(config)]);
  const sourceNameMap = buildSourceNameMap(sources);

  let firstSessionDate: Date | null = null;
  for (const session of sessions) {
    const created = parseTime(session.createTime);
    if (!created) continue;
    if (!firstSessionDate || created < firstSessionDate) {
      firstSessionDate = created;
    }
  }

  const sessionsInYear = sessions.filter((session) => isInYear(parseTime(session.createTime), year));
  const sessionsOverlappingYear = sessions.filter((session) => sessionOverlapsYear(session, year));

  const dailyActivity = new Map<string, number>();
  const activityTypeCounts = new Map<ActivityKind, number>();
  const sourceCounts = new Map<string, number>();
  const automationModeCounts = new Map<string, number>();
  const sessionSource = new Map<string, string>();

  let totalPullRequests = 0;
  let requirePlanApprovalCount = 0;
  let totalTokensEstimated = 0;

  const addTextTokens = (text?: string | null) => {
    totalTokensEstimated += estimateGeminiTokensFromText(text);
  };

  const addImageTokens = () => {
    totalTokensEstimated += estimateGeminiTokensFromImage();
  };

  for (const session of sessionsInYear) {
    if (session.automationMode) {
      automationModeCounts.set(
        session.automationMode,
        (automationModeCounts.get(session.automationMode) || 0) + 1
      );
    }
    if (session.requirePlanApproval) {
      requirePlanApprovalCount += 1;
    }
    addTextTokens(session.title);
    addTextTokens(session.prompt);
    for (const output of session.outputs ?? []) {
      if (output.pullRequest) {
        totalPullRequests += 1;
        addTextTokens(output.pullRequest.title);
        addTextTokens(output.pullRequest.description);
      }
    }
  }

  for (const session of sessionsOverlappingYear) {
    const sourceId = session.sourceContext?.source;
    const sourceLabel = resolveSourceLabel(sourceId, sourceNameMap);
    if (sourceLabel && session.name) {
      sessionSource.set(session.name, sourceLabel);
    }
  }

  let totalActivities = 0;
  let totalMessages = 0;
  let totalAgentMessages = 0;
  let totalUserMessages = 0;
  let totalPlansGenerated = 0;
  let totalPlansApproved = 0;
  let totalProgressUpdates = 0;
  let totalSessionCompleted = 0;
  let totalSessionFailed = 0;
  let totalChangeSets = 0;
  let totalBashOutputs = 0;
  let totalMedia = 0;

  await runWithConcurrency(sessionsOverlappingYear, ACTIVITY_CONCURRENCY, async (session) => {
    if (!session.name) return;
    const activities = await listAllActivities(session.name, config);
    for (const activity of activities) {
      const created = parseTime(activity.createTime);
      if (!isInYear(created, year)) continue;

      totalActivities += 1;

      if (created) {
        const dateKey = formatDateKey(created);
        dailyActivity.set(dateKey, (dailyActivity.get(dateKey) || 0) + 1);
      }

      const kind = getActivityKind(activity);
      activityTypeCounts.set(kind, (activityTypeCounts.get(kind) || 0) + 1);

      if (kind === "agentMessaged") {
        totalMessages += 1;
        totalAgentMessages += 1;
        addTextTokens(activity.agentMessaged?.agentMessage);
      } else if (kind === "userMessaged") {
        totalMessages += 1;
        totalUserMessages += 1;
        addTextTokens(activity.userMessaged?.userMessage);
      } else if (kind === "planGenerated") {
        totalPlansGenerated += 1;
      } else if (kind === "planApproved") {
        totalPlansApproved += 1;
      } else if (kind === "progressUpdated") {
        totalProgressUpdates += 1;
        addTextTokens(activity.progressUpdated?.title);
        addTextTokens(activity.progressUpdated?.description);
      } else if (kind === "sessionCompleted") {
        totalSessionCompleted += 1;
      } else if (kind === "sessionFailed") {
        totalSessionFailed += 1;
        addTextTokens(activity.sessionFailed?.reason);
      }

      addTextTokens(activity.description);

      for (const artifact of activity.artifacts ?? []) {
        if (artifact.changeSet) {
          totalChangeSets += 1;
          addTextTokens(artifact.changeSet.source);
          addTextTokens(artifact.changeSet.gitPatch?.unidiffPatch);
          addTextTokens(artifact.changeSet.gitPatch?.suggestedCommitMessage);
        }
        if (artifact.media) {
          totalMedia += 1;
          addImageTokens();
        }
        if (artifact.bashOutput) {
          totalBashOutputs += 1;
          addTextTokens(artifact.bashOutput.command);
          addTextTokens(artifact.bashOutput.output);
        }
      }

      const sourceLabel = sessionSource.get(session.name);
      if (sourceLabel) {
        sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);
      }
    }
  });

  // Ensure consistent order for missing activity kinds
  for (const kind of ACTIVITY_KIND_ORDER) {
    if (!activityTypeCounts.has(kind)) {
      activityTypeCounts.set(kind, 0);
    }
  }

  return {
    totalSessions: sessionsInYear.length,
    totalActivities,
    totalMessages,
    totalAgentMessages,
    totalUserMessages,
    totalPlansGenerated,
    totalPlansApproved,
    totalProgressUpdates,
    totalSessionCompleted,
    totalSessionFailed,
    totalChangeSets,
    totalBashOutputs,
    totalMedia,
    totalPullRequests,
    totalTokensEstimated,
    requirePlanApprovalCount,
    firstSessionDate,
    dailyActivity,
    activityTypeCounts,
    sourceCounts,
    automationModeCounts,
  };
}

async function listAllSessions(config: JulesClientConfig): Promise<JulesSession[]> {
  if (config.useSampleData) {
    return sampleSessions;
  }

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const sessions: JulesSession[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `${baseUrl}/sessions?${params.toString()}`;
    const response = await fetchJson(url, config);
    const pageSessions = Array.isArray(response.sessions) ? response.sessions : [];
    sessions.push(...pageSessions);
    pageToken = response.nextPageToken || undefined;
  } while (pageToken);

  return sessions;
}

async function listAllSources(config: JulesClientConfig): Promise<JulesSource[]> {
  if (config.useSampleData) {
    return sampleSources;
  }

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const sources: JulesSource[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `${baseUrl}/sources?${params.toString()}`;
    const response = await fetchJson(url, config);
    const pageSources = Array.isArray(response.sources) ? response.sources : [];
    sources.push(...pageSources);
    pageToken = response.nextPageToken || undefined;
  } while (pageToken);

  return sources;
}

async function listAllActivities(sessionName: string, config: JulesClientConfig): Promise<JulesActivity[]> {
  if (config.useSampleData) {
    return sampleActivitiesBySession[sessionName] ?? [];
  }

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const activities: JulesActivity[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `${baseUrl}/${sessionName}/activities?${params.toString()}`;
    const response = await fetchJson(url, config);
    const pageActivities = Array.isArray(response.activities) ? response.activities : [];
    activities.push(...pageActivities);
    pageToken = response.nextPageToken || undefined;
  } while (pageToken);

  return activities;
}

async function fetchJson(url: string, config: JulesClientConfig): Promise<any> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers["X-Goog-Api-Key"] = config.apiKey;
  }

  let lastError: Error | null = null;
  let transientAttempts = 0;
  let rateLimitHits = 0;

  const emit = (event: RateLimitEvent) => {
    if (config.onRateLimit) {
      config.onRateLimit(event);
      return;
    }
    if (event.type === "sleep") {
      console.warn(`Sleeping for rate limits #${event.count} (${Math.ceil(event.waitMs / 1000)}s)`);
      return;
    }
    if (event.type === "notice" || event.type === "retry") {
      console.warn(event.message);
    }
  };

  while (true) {
    try {
      await scheduleRequest(config);
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!response.ok) {
        const bodyText = await response.text();

        if (response.status === 429) {
          rateLimitHits += 1;
          updateRateLimitFromError(bodyText);
          const delayMs = getRetryDelayMs(response, rateLimitHits - 1);
          rateLimitUntil = Math.max(rateLimitUntil, Date.now() + delayMs);
          if (!rateLimitNoticeShown) {
            rateLimitNoticeShown = true;
            emit({
              type: "notice",
              message: "Jules API rate limits detected — this may take a while, continuing automatically.",
            });
          }
          emit({
            type: "retry",
            message: `Rate limit hit (still working). Retrying in ${Math.ceil(delayMs / 1000)}s`,
          });
          continue;
        }

        if (shouldRetry(response.status)) {
          transientAttempts += 1;
          const delayMs = getRetryDelayMs(response, transientAttempts - 1);
          emit({
            type: "retry",
            message: `Jules API ${response.status} (retrying). Sleeping ${Math.ceil(delayMs / 1000)}s (attempt ${transientAttempts})`,
          });
          await sleep(delayMs);
          continue;
        }

        throw new Error(`Jules API error (${response.status}): ${bodyText || response.statusText}`);
      }

      const text = await response.text();
      if (!text) return {};

      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      transientAttempts += 1;
      const delayMs = getFallbackDelayMs(transientAttempts - 1);
      emit({
        type: "retry",
        message: `Jules API request failed. Retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${transientAttempts})`,
      });
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error("Jules API request failed.");
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isInYear(date: Date | null, year: number): boolean {
  if (!date) return false;
  return date.getFullYear() === year;
}

function sessionOverlapsYear(session: JulesSession, year: number): boolean {
  const created = parseTime(session.createTime);
  if (!created) return false;
  const updated = parseTime(session.updateTime) ?? created;

  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);

  return created <= end && updated >= start;
}

function getActivityKind(activity: JulesActivity): ActivityKind {
  if (!activity || typeof activity !== "object") return "unknown";

  for (const kind of ACTIVITY_KIND_ORDER) {
    if ((activity as Record<string, unknown>)[kind] !== undefined) {
      return kind;
    }
  }
  return "unknown";
}

function formatSourceLabel(source?: string): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (!trimmed) return null;

  const githubPrefix = "sources/github/";
  if (trimmed.startsWith(githubPrefix)) {
    return trimmed.slice(githubPrefix.length);
  }

  if (trimmed.startsWith("sources/")) {
    return trimmed.slice("sources/".length);
  }

  return trimmed;
}

function buildSourceNameMap(sources: JulesSource[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    const name = source.name;
    if (!name) continue;
    const repo = source.githubRepo;
    if (repo?.owner && repo.repo) {
      map.set(name, `${repo.owner}/${repo.repo}`);
      continue;
    }
    const fallback = formatSourceLabel(name);
    if (fallback) {
      map.set(name, fallback);
    }
  }
  return map;
}

function resolveSourceLabel(sourceId: string | undefined, map: Map<string, string>): string | null {
  if (!sourceId) return null;
  return map.get(sourceId) ?? formatSourceLabel(sourceId);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) break;
      const item = items[currentIndex];
      await worker(item);
    }
  });

  await Promise.all(runners);
}

async function scheduleRequest(config: JulesClientConfig): Promise<void> {
  const scheduled = rateLimitQueue.then(async () => {
    const now = Date.now();
    const waitForCooldown = Math.max(0, rateLimitUntil - now);
    const waitForSpacing = Math.max(0, lastRequestAt + minIntervalMs - now);
    const wait = Math.max(waitForCooldown, waitForSpacing);
    if (wait > 0) {
      const shouldLog = waitForCooldown > 0 || Date.now() - lastRateLimitLogAt >= 1000;
      if (config.onRateLimit || shouldLog) {
        rateLimitSleepCount += 1;
        if (config.onRateLimit) {
          config.onRateLimit({ type: "sleep", waitMs: wait, count: rateLimitSleepCount });
        } else {
          console.warn(`Sleeping for rate limits #${rateLimitSleepCount} (${Math.ceil(wait / 1000)}s)`);
        }
        lastRateLimitLogAt = Date.now();
      }
      await sleep(wait);
      if (config.onRateLimit) {
        config.onRateLimit({ type: "resume" });
      }
    }
    lastRequestAt = Date.now();
  });

  rateLimitQueue = scheduled.catch(() => {});
  await scheduled;
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const retryAfterMs = parseRetryAfter(retryAfter);
    if (retryAfterMs != null) {
      return clampDelay(retryAfterMs);
    }
  }

  return getFallbackDelayMs(attempt);
}

function getFallbackDelayMs(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 + 0.85;
  return clampDelay(base * jitter);
}

function updateRateLimitFromError(bodyText: string): void {
  if (!bodyText) return;
  let parsed: any;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return;
  }

  const quotaLimitValue = findQuotaLimitValue(parsed);
  if (!quotaLimitValue || !Number.isFinite(quotaLimitValue)) {
    return;
  }

  const safeLimit = Math.max(1, Math.floor(quotaLimitValue * RATE_LIMIT_BUFFER_RATIO));
  if (safeLimit < rateLimitPerMinute) {
    rateLimitPerMinute = safeLimit;
    minIntervalMs = Math.ceil(60_000 / rateLimitPerMinute);
  }
}

function findQuotaLimitValue(payload: any): number | null {
  const details = payload?.error?.details;
  if (!Array.isArray(details)) return null;

  for (const item of details) {
    const value = item?.metadata?.quota_limit_value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function parseRetryAfter(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds)) {
    return asSeconds * 1000;
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function clampDelay(delayMs: number): number {
  const bounded = Math.min(Math.max(delayMs, BASE_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
  return Math.round(bounded);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
