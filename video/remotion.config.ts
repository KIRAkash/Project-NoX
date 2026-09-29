/**
 * Studio and CLI render settings. The Node.js render APIs don't read this
 * file; pass the same options to them directly.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
// Tag the encode BT.709 so browsers and players show the palette as designed.
Config.setColorSpace("bt709");
// The light leak on the reveal is a WebGL2 effect.
Config.setChromiumOpenGlRenderer("angle");
