/**
 * electron-builder `afterSign` hook: notarize the macOS app with Apple.
 *
 * NO-OP unless notarization credentials are available, so a local build keeps
 * working without secrets.
 *
 * CREDENTIALS — two ways, in order of preference:
 *
 *   1. Keychain profile (RECOMMENDED — the secret never touches the shell or
 *      env, so it can't leak into shell history or CI logs). Create it once:
 *
 *        xcrun notarytool store-credentials agenttrace-notary \
 *          --apple-id you@example.com --team-id XXXXXXXXXX
 *        # (prompts for the app-specific password; stores it in the login keychain)
 *
 *      Then just set the profile name (no secret in the env):
 *
 *        export APPLE_KEYCHAIN_PROFILE=agenttrace-notary
 *
 *   2. Env vars (fallback — avoid on shared machines; DON'T `export ...=<value>`
 *      inline, that lands in shell history):
 *
 *        APPLE_ID=you@example.com
 *        APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com → App-Specific Passwords
 *        APPLE_TEAM_ID=XXXXXXXXXX
 *
 * Notarization also requires the app to be signed with a Developer ID cert and
 * the hardened runtime enabled (see build.mac in package.json + entitlements).
 */
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const {
    APPLE_KEYCHAIN_PROFILE,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
  } = process.env;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const appBundleId = context.packager.appInfo.id;

  // Preferred: keychain profile — no secret in env.
  if (APPLE_KEYCHAIN_PROFILE) {
    console.log(
      `  → Notarizing ${appName} via keychain profile "${APPLE_KEYCHAIN_PROFILE}"…`,
    );
    await notarize({ appBundleId, appPath, keychainProfile: APPLE_KEYCHAIN_PROFILE });
    console.log(`  ✓ Notarized ${appName}.`);
    return;
  }

  // Fallback: explicit env credentials.
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    console.log(`  → Notarizing ${appName} with Apple (env credentials)…`);
    await notarize({
      appBundleId,
      appPath,
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID,
    });
    console.log(`  ✓ Notarized ${appName}.`);
    return;
  }

  console.log(
    "  ⚠ Skipping notarization — no credentials. Set APPLE_KEYCHAIN_PROFILE " +
      "(preferred) or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID. " +
      "The build is signed but NOT notarized (fine for local use; Gatekeeper " +
      "will warn other users).",
  );
};
