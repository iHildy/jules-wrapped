// Font loader for Satori

import type { Font } from "satori";

import regularFontPath from "../../assets/fonts/RobotoMono-Regular.ttf";
import mediumFontPath from "../../assets/fonts/RobotoMono-Medium.ttf";
import semiboldFontPath from "../../assets/fonts/RobotoMono-SemiBold.ttf";
import boldFontPath from "../../assets/fonts/RobotoMono-Bold.ttf";

export async function loadFonts(): Promise<Font[]> {
  const [regularFont, mediumFont, semiboldFont, boldFont] = await Promise.all([
    Bun.file(regularFontPath).arrayBuffer(),
    Bun.file(mediumFontPath).arrayBuffer(),
    Bun.file(semiboldFontPath).arrayBuffer(),
    Bun.file(boldFontPath).arrayBuffer(),
  ]);

  return [
    {
      name: "Roboto Mono",
      data: regularFont,
      weight: 400,
      style: "normal",
    },
    {
      name: "Roboto Mono",
      data: mediumFont,
      weight: 500,
      style: "normal",
    },
    {
      name: "Roboto Mono",
      data: semiboldFont,
      weight: 600,
      style: "normal",
    },
    {
      name: "Roboto Mono",
      data: boldFont,
      weight: 700,
      style: "normal",
    },
  ];
}
