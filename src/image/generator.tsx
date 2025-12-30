import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { WrappedTemplate } from "./template";
import type { JulesStats } from "../types";
import { loadFonts } from "./fonts";
import { layout } from "./design-tokens";

export interface GeneratedImage {
  /** Full resolution PNG buffer for saving/clipboard */
  fullSize: Buffer;
  /** Scaled PNG buffer for terminal display (80% of full size) */
  displaySize: Buffer;
}

export interface GenerateImageOptions {
  showTopRepos?: boolean;
}

export async function generateImage(
  stats: JulesStats,
  options: GenerateImageOptions = {}
): Promise<GeneratedImage> {
  await initWasm(Bun.file(resvgWasm).arrayBuffer());
  const { showTopRepos = true } = options;

  const svg = await satori(<WrappedTemplate stats={stats} showTopRepos={showTopRepos} />, {
    width: layout.canvas.width,
    height: layout.canvas.height,
    fonts: await loadFonts(),
  });

  const [fullSize, displaySize] = [1, 0.75].map((v) => {
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: "zoom",
        value: v,
      },
    });
    return Buffer.from(resvg.render().asPng());
  });

  return { fullSize, displaySize };
}
