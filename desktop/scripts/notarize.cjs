/**
 * electron-builder `afterSign` hook: notarize the macOS app with Apple.
 *
 * This is a NO-OP until Apple credentials are present in the environment, so
 * the local `.dmg` build keeps working today (the app is signed with an Apple
 * Development cert, which runs on this machine but cannot be notarized). Once
 * you have a paid Apple Developer account and a "Developer ID Application"
 * certificate, set these env vars and the release build will notarize itself:
 *
 *   APPLE_ID=you@example.com
 *   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com → App-Specific Passwords
 *   APPLE_TEAM_ID=XXXXXXXXXX                          # 10-char team id
 *
 * Notarization also requires the app to be signed with a Developer ID cert and
 * the hardened runtime enabled (see build.mac in package.json + entitlements).
 */
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      "  ⚠ Skipping notarization — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, " +
        "APPLE_TEAM_ID to notarize. The build is signed but NOT notarized " +
        "(fine for local use; Gatekeeper will warn other users).",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`  → Notarizing ${appName} with Apple (this can take a few minutes)…`);

  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log(`  ✓ Notarized ${appName}.`);
};
