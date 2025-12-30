import type { JulesActivity, JulesSession, JulesSource } from "./collector";

export const sampleSources: JulesSource[] = [
  {
    name: "sources/github/stellar/jules-demo",
    id: "github/stellar/jules-demo",
    githubRepo: {
      owner: "stellar",
      repo: "jules-demo",
      isPrivate: false,
      defaultBranch: { displayName: "main" },
    },
  },
  {
    name: "sources/github/stellar/infra",
    id: "github/stellar/infra",
    githubRepo: {
      owner: "stellar",
      repo: "infra",
      isPrivate: true,
      defaultBranch: { displayName: "main" },
    },
  },
];

export const sampleSessions: JulesSession[] = [
  {
    name: "sessions/1001",
    id: "1001",
    title: "Refactor pipelines",
    prompt: "Refactor the build pipeline for faster tests.",
    requirePlanApproval: true,
    automationMode: "AUTO_CREATE_PR",
    createTime: "2025-02-14T15:12:00Z",
    updateTime: "2025-02-14T16:05:00Z",
    state: "COMPLETED",
    sourceContext: {
      source: "sources/github/stellar/jules-demo",
      githubRepoContext: { startingBranch: "main" },
    },
    outputs: [
      {
        pullRequest: {
          url: "https://github.com/stellar/jules-demo/pull/42",
          title: "Refactor pipeline for speed",
          description: "Batch steps and reduce redundant builds.",
        },
      },
    ],
  },
  {
    name: "sessions/1002",
    id: "1002",
    title: "Investigate flaky CI",
    prompt: "Track down intermittent CI failures.",
    requirePlanApproval: false,
    automationMode: "AUTOMATION_MODE_UNSPECIFIED",
    createTime: "2025-06-03T10:30:00Z",
    updateTime: "2025-06-03T11:00:00Z",
    state: "FAILED",
    sourceContext: {
      source: "sources/github/stellar/infra",
      githubRepoContext: { startingBranch: "main" },
    },
  },
  {
    name: "sessions/2001",
    id: "2001",
    title: "January maintenance",
    prompt: "Apply the January maintenance checklist.",
    requirePlanApproval: true,
    automationMode: "AUTO_CREATE_PR",
    createTime: "2024-11-20T09:20:00Z",
    updateTime: "2025-01-05T12:00:00Z",
    state: "COMPLETED",
    sourceContext: {
      source: "sources/github/stellar/jules-demo",
      githubRepoContext: { startingBranch: "release" },
    },
  },
];

export const sampleActivitiesBySession: Record<string, JulesActivity[]> = {
  "sessions/1001": [
    {
      name: "sessions/1001/activities/1",
      createTime: "2025-02-14T15:12:30Z",
      originator: "user",
      userMessaged: { userMessage: "Please speed up CI." },
    },
    {
      name: "sessions/1001/activities/2",
      createTime: "2025-02-14T15:13:00Z",
      originator: "agent",
      planGenerated: { plan: { id: "plan-1001" } },
    },
    {
      name: "sessions/1001/activities/3",
      createTime: "2025-02-14T15:14:00Z",
      originator: "user",
      planApproved: { planId: "plan-1001" },
    },
    {
      name: "sessions/1001/activities/4",
      createTime: "2025-02-14T15:16:00Z",
      originator: "agent",
      agentMessaged: { agentMessage: "Kicking off changes." },
    },
    {
      name: "sessions/1001/activities/5",
      createTime: "2025-02-14T15:30:00Z",
      originator: "agent",
      progressUpdated: { title: "Tests reduced", description: "Parallelized integration steps." },
    },
    {
      name: "sessions/1001/activities/6",
      createTime: "2025-02-14T15:50:00Z",
      originator: "agent",
      agentMessaged: { agentMessage: "Updated pipeline config." },
      artifacts: [
        {
          changeSet: {
            source: "sources/github/stellar/jules-demo",
            gitPatch: {
              unidiffPatch: "diff --git a/pipeline.yml b/pipeline.yml\n",
              baseCommitId: "abc123",
              suggestedCommitMessage: "Refactor pipeline",
            },
          },
        },
        {
          bashOutput: {
            command: "bun test",
            output: "All tests passed",
            exitCode: 0,
          },
        },
      ],
    },
    {
      name: "sessions/1001/activities/7",
      createTime: "2025-02-14T16:05:00Z",
      originator: "system",
      sessionCompleted: {},
    },
  ],
  "sessions/1002": [
    {
      name: "sessions/1002/activities/1",
      createTime: "2025-06-03T10:31:00Z",
      originator: "user",
      userMessaged: { userMessage: "Find flaky test cause." },
    },
    {
      name: "sessions/1002/activities/2",
      createTime: "2025-06-03T10:32:00Z",
      originator: "agent",
      planGenerated: { plan: { id: "plan-1002" } },
    },
    {
      name: "sessions/1002/activities/3",
      createTime: "2025-06-03T10:45:00Z",
      originator: "agent",
      agentMessaged: { agentMessage: "Captured logs." },
      artifacts: [
        {
          media: {
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
            mimeType: "image/png",
          },
        },
      ],
    },
    {
      name: "sessions/1002/activities/4",
      createTime: "2025-06-03T11:00:00Z",
      originator: "system",
      sessionFailed: { reason: "Permission denied" },
    },
  ],
  "sessions/2001": [
    {
      name: "sessions/2001/activities/1",
      createTime: "2025-01-05T11:05:00Z",
      originator: "user",
      userMessaged: { userMessage: "Apply maintenance checklist." },
    },
    {
      name: "sessions/2001/activities/2",
      createTime: "2025-01-05T11:45:00Z",
      originator: "agent",
      agentMessaged: { agentMessage: "Checklist completed." },
      artifacts: [
        {
          changeSet: {
            source: "sources/github/stellar/jules-demo",
            gitPatch: {
              unidiffPatch: "diff --git a/README.md b/README.md\n",
              baseCommitId: "def456",
              suggestedCommitMessage: "Update maintenance notes",
            },
          },
        },
      ],
    },
  ],
};
