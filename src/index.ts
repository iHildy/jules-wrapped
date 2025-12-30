#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { checkJulesDataExists, type JulesClientConfig } from "./collector";
import { calculateStats } from "./stats";
import { generateImage } from "./image/generator";
import { displayInTerminal, getTerminalName } from "./terminal/display";
import { copyImageToClipboard } from "./clipboard";
import { isWrappedAvailable } from "./utils/dates";
import { formatNumber, formatNumberFull } from "./utils/format";
import type { JulesStats } from "./types";

const VERSION = "1.0.0";

function printHelp() {
  console.log(`
jules-wrapped v${VERSION}

Generate your Jules year in review stats card.

USAGE:
  jules-wrapped [OPTIONS]

OPTIONS:
  --year <YYYY>       Generate wrapped for a specific year (default: current year)
  --api-key <KEY>     Jules API key (you will be prompted if omitted)
  --base-url <URL>    Override API base URL
  --sample            Use bundled sample data (no API key required)
  --hide-top-repos    Hide Top Worked Repos in the image
  --no-clipboard      Skip copying the image to your clipboard
  --no-save           Skip saving the image to disk
  --no-share          Skip share prompt / browser open
  --help, -h          Show this help message
  --version, -v       Show version number

EXAMPLES:
  jules-wrapped                 # Generate current year wrapped
  jules-wrapped --year 2025     # Generate 2025 wrapped
  jules-wrapped --sample        # Demo with sample data
`);
}

async function main() {
  // Parse command line arguments
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      year: { type: "string", short: "y" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
      sample: { type: "boolean" },
      "hide-top-repos": { type: "boolean" },
      "no-clipboard": { type: "boolean" },
      "no-save": { type: "boolean" },
      "no-share": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(`jules-wrapped v${VERSION}`);
    process.exit(0);
  }

  p.intro("jules wrapped");

  const requestedYear = values.year ? parseInt(values.year, 10) : new Date().getFullYear();

  const envApiKey = typeof process.env.JULES_API_KEY === "string" ? process.env.JULES_API_KEY : "";
  const apiKey = typeof values["api-key"] === "string" ? values["api-key"] : envApiKey;
  const baseUrl =
    typeof values["base-url"] === "string" ? values["base-url"] : process.env.JULES_API_BASE_URL || "";
  const config: JulesClientConfig = {
    apiKey: apiKey.trim() === "" ? undefined : apiKey.trim(),
    baseUrl: baseUrl.trim() === "" ? undefined : baseUrl.trim(),
    useSampleData: Boolean(values.sample),
  };

  const skipClipboard = Boolean(values["no-clipboard"]);
  const skipSave = Boolean(values["no-save"]);
  const skipShare = Boolean(values["no-share"]);
  const showTopRepos = !Boolean(values["hide-top-repos"]);

  const availability = isWrappedAvailable(requestedYear);
  if (!availability.available) {
    if (Array.isArray(availability.message)) {
      availability.message.forEach((line) => p.log.warn(line));
    } else {
      p.log.warn(availability.message || "Wrapped not available yet.");
    }
    p.cancel();
    process.exit(0);
  }

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!config.useSampleData && !config.apiKey) {
    if (!isInteractive) {
      p.cancel("Jules API key not provided. Use --api-key or --sample for non-interactive runs.");
      process.exit(0);
    }

    const apiKeyInput = await p.password({
      message: "Enter your Jules API key",
      mask: "*",
    });

    if (p.isCancel(apiKeyInput) || !apiKeyInput || apiKeyInput.trim() === "") {
      p.cancel("Jules API key is required to fetch sessions.");
      process.exit(0);
    }

    config.apiKey = apiKeyInput.trim();
  }

  const dataExists = await checkJulesDataExists(config);
  if (!dataExists) {
    p.cancel("Jules API key not found. Use --api-key or --sample.");
    process.exit(0);
  }

  const spinner = p.spinner();
  const baseSpinnerMessage = config.useSampleData ? "Loading sample Jules data..." : "Fetching your Jules sessions...";
  let isSleepingForRateLimit = false;
  config.onRateLimit = (event) => {
    if (!isInteractive) {
      // Avoid emitting extra lines in non-interactive mode.
      return;
    }

    if (event.type === "sleep") {
      isSleepingForRateLimit = true;
      spinner.message(`${baseSpinnerMessage} (sleeping for ratelimits)`);
      return;
    }
    if (event.type === "resume") {
      if (isSleepingForRateLimit) {
        isSleepingForRateLimit = false;
        spinner.message(baseSpinnerMessage);
      }
      return;
    }
    // Ignore other rate-limit events to avoid extra output.
  };
  spinner.start(baseSpinnerMessage);

  let stats;
  try {
    stats = await calculateStats(requestedYear, config);
  } catch (error) {
    spinner.stop("Failed to collect stats");
    p.cancel(`Error: ${error}`);
    process.exit(1);
  }

  if (stats.totalActivities === 0) {
    spinner.stop("No data found");
    p.cancel(`No Jules activity found for ${requestedYear}`);
    process.exit(0);
  }

  spinner.stop("Found your stats!");

  // Display summary
  const summaryLines = [
    `Sessions:      ${formatNumber(stats.totalSessions)}`,
    `Activities:    ${formatNumber(stats.totalActivities)}`,
    `Messages:      ${formatNumber(stats.totalMessages)}`,
    `Total Tokens (est.): ${formatNumber(stats.totalTokensEstimated)}`,
    `Streak:        ${stats.maxStreak} days`,
    `Favorite Mode: ${stats.topAutomationMode ?? "Manual"}`,
    stats.mostActiveDay && `Most Active:   ${stats.mostActiveDay.formattedDate}`,
  ].filter(Boolean);

  p.note(summaryLines.join("\n"), `Your ${requestedYear} in Jules`);

  // Generate image
  spinner.start("Generating your wrapped image...");

  let image: { fullSize: Buffer; displaySize: Buffer };
  try {
    image = await generateImage(stats, { showTopRepos });
  } catch (error) {
    spinner.stop("Failed to generate image");
    p.cancel(`Error generating image: ${error}`);
    process.exit(1);
  }

  spinner.stop("Image generated!");

  const displayed = await displayInTerminal(image.displaySize);
  if (!displayed) {
    p.log.info(`Terminal (${getTerminalName()}) doesn't support inline images`);
  }

  const filename = `jules-wrapped-${requestedYear}.png`;

  if (!skipClipboard) {
    const { success, error } = await copyImageToClipboard(image.fullSize, filename);

    if (success) {
      p.log.success("Automatically copied image to clipboard!");
    } else {
      p.log.warn(`Clipboard unavailable: ${error}`);
      p.log.info("You can save the image to disk instead.");
    }
  }

  const defaultPath = join(process.env.HOME || "~", filename);

  if (!isInteractive) {
    if (!skipSave) {
      const saveResult = await saveImageFile(defaultPath, filename, image.fullSize);
      if (saveResult.path) {
        p.log.success(`Saved to ${saveResult.path}`);
      } else {
        p.log.error(`Failed to save: ${saveResult.error}`);
      }
    }
    p.outro("Share your wrapped!");
    process.exit(0);
  }

  if (!skipSave) {
    const shouldSave = await p.confirm({
      message: `Save image to ~/${filename}?`,
      initialValue: true,
    });

    if (p.isCancel(shouldSave)) {
      p.outro("Cancelled");
      process.exit(0);
    }

    if (shouldSave) {
      const saveResult = await saveImageFile(defaultPath, filename, image.fullSize);
      if (saveResult.path) {
        p.log.success(`Saved to ${saveResult.path}`);
      } else {
        p.log.error(`Failed to save: ${saveResult.error}`);
      }
    }
  }

  if (!skipShare) {
    const shouldShare = await p.confirm({
      message: "Share on X (Twitter)? Don't forget to attach your image!",
      initialValue: true,
    });

    if (!p.isCancel(shouldShare) && shouldShare) {
      const tweetUrl = generateTweetUrl(stats, { includeTopRepos: showTopRepos });
      const opened = await openUrl(tweetUrl);
      if (opened) {
        p.log.success("Opened X in your browser.");
      } else {
        p.log.warn("Couldn't open browser. Copy this URL:");
        p.log.info(tweetUrl);
      }
      p.log.info("Press CMD / CTRL + V to paste the image.");
    }
  }

  p.outro("Share your wrapped!");
  process.exit(0);
}

function generateTweetUrl(stats: JulesStats, options: { includeTopRepos?: boolean } = {}): string {
  const { includeTopRepos = true } = options;
  const lines: string[] = [];
  lines.push(`Jules Wrapped ${stats.year}`);
  lines.push("");
  lines.push(`Total Activities: ${formatNumberFull(stats.totalActivities)}`);
  lines.push(`Total Messages: ${formatNumberFull(stats.totalMessages)}`);
  lines.push(`Total Sessions: ${formatNumberFull(stats.totalSessions)}`);
  lines.push("");
  lines.push(`Longest Streak: ${stats.maxStreak} days`);
  if (includeTopRepos) {
    lines.push(`Top Worked Repos: ${stats.topSources[0]?.name ?? "N/A"}`);
  }
  lines.push(`Plans Approved: ${formatNumberFull(stats.totalPlansApproved)}`);
  lines.push(`Favorite Mode: ${stats.topAutomationMode ?? "Manual"}`);
  lines.push("");
  lines.push("Get yours: npx jules-wrapped");
  lines.push("");
  lines.push("Credit: @nummanali @moddi3io");
  lines.push("");
  lines.push("(Paste Image Stats with CMD / CTRL + V)");

  const text = lines.join("\n");

  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", text);
  return url.toString();
}

async function saveImageFile(
  primaryPath: string,
  filename: string,
  pngBuffer: Buffer
): Promise<{ path?: string; error?: string }> {
  try {
    await Bun.write(primaryPath, pngBuffer);
    return { path: primaryPath };
  } catch (error) {
    const fallbackPath = join(process.cwd(), filename);
    if (fallbackPath !== primaryPath) {
      try {
        await Bun.write(fallbackPath, pngBuffer);
        return { path: fallbackPath };
      } catch (fallbackError) {
        return {
          error: `${formatError(error)} | ${formatError(fallbackError)}`,
        };
      }
    }
    return { error: formatError(error) };
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function openUrl(url: string): Promise<boolean> {
  const platform = process.platform;
  let command: string;

  if (platform === "darwin") {
    command = "open";
  } else if (platform === "win32") {
    command = "start";
  } else {
    command = "xdg-open";
  }

  try {
    const proc = Bun.spawn([command, url], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
