import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/*
 * The landing page's three faces, bundled as variable woff2 files in
 * public/fonts so a render never depends on reaching Google Fonts.
 * All three are SIL Open Font License.
 */

export const FONT_DISPLAY = "NoX Outfit";
export const FONT_SANS = "NoX DM Sans";
export const FONT_MONO = "NoX JetBrains Mono";

loadFont({ family: FONT_DISPLAY, url: staticFile("fonts/Outfit-Variable.woff2"), weight: "400 700" });
loadFont({ family: FONT_SANS, url: staticFile("fonts/DMSans-Variable.woff2"), weight: "400 700" });
loadFont({ family: FONT_MONO, url: staticFile("fonts/JetBrainsMono-Variable.woff2"), weight: "400 600" });

export const display = `"${FONT_DISPLAY}", system-ui, sans-serif`;
export const sans = `"${FONT_SANS}", "Helvetica Neue", sans-serif`;
export const mono = `"${FONT_MONO}", ui-monospace, monospace`;
