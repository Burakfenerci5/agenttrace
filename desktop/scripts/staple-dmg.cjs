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
 * NO-OP until credentials are available (same options as notarize.cjs, keychain
 * profile preferred), so local `--dir` / unsigned builds keep working.
 */
const { execFileSync } = require("node:child_process");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const {
    APPLE_KEYCHAIN_PROFILE,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
  } = process.env;
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (dmgs.length === 0) return [];

  // Build the notarytool auth args once. Prefer a keychain profile so the
  // app-specific password is never passed on the command line (where it would
  // land in shell history / process listings / CI logs).
  let authArgs;
  if (APPLE_KEYCHAIN_PROFILE) {
    authArgs = ["--keychain-profile", APPLE_KEYCHAIN_PROFILE];
  } else if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    authArgs = [
      "--apple-id", APPLE_ID,
      "--password", APPLE_APP_SPECIFIC_PASSWORD,
      "--team-id", APPLE_TEAM_ID,
    ];
  } else {
    console.log(
      "  ⚠ Skipping .dmg notarization/staple — no credentials. Set " +
        "APPLE_KEYCHAIN_PROFILE (preferred) or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID.",
    );
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`  → Notarizing .dmg ${dmg} (this can take a few minutes)…`);
    execFileSync("xcrun", ["notarytool", "submit", dmg, ...authArgs, "--wait"], {
      stdio: "inherit",
    });
    console.log(`  → Stapling ${dmg}…`);
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
    console.log(`  ✓ Notarized + stapled ${dmg}.`);
  }
  return []; // no additional artifacts to register
};
