/**
 * electron-builder `afterAllArtifactBuild` hook: notarize + staple the .dmg
 * containers themselves.
 *
 * The `afterSign` hook (notarize.cjs) notarizes the .app, but electron-builder
 * builds the .dmg *after* signing, so the DMG container ships un-notarized and
 * `spctl -t install` rejects it on download. This hook closes that gap: it
 * submits each freshly-built .dmg to Apple and staples the ticket, so a
 * downloaded .dmg verifies offline with no Gatekeeper warning.
 *
 * NO-OP until Apple credentials are present (same env vars as notarize.cjs), so
 * local `--dir` / unsigned builds keep working.
 */
const { execFileSync } = require("node:child_process");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) return [];

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("  ⚠ Skipping .dmg notarization/staple — Apple credentials not set.");
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`  → Notarizing .dmg ${dmg} (this can take a few minutes)…`);
    execFileSync(
      "xcrun",
      [
        "notarytool", "submit", dmg,
        "--apple-id", APPLE_ID,
        "--password", APPLE_APP_SPECIFIC_PASSWORD,
        "--team-id", APPLE_TEAM_ID,
        "--wait",
      ],
      { stdio: "inherit" },
    );
    console.log(`  → Stapling ${dmg}…`);
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
    console.log(`  ✓ Notarized + stapled ${dmg}.`);
  }
  return []; // no additional artifacts to register
};
