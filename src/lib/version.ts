export const APP_VERSION = __APP_VERSION__;
export const APP_VERSION_TAG = `v${APP_VERSION}`;
export const APP_BUILD_CHANNEL = __APP_BUILD_CHANNEL__.trim().toLowerCase();

function inferReleaseChannel(version: string, buildChannel: string) {
  if (["dev", "development"].includes(buildChannel) || buildChannel.startsWith("dev-")) {
    return "dev";
  }
  if (buildChannel.includes("beta") || version.toLowerCase().includes("beta")) {
    return "beta";
  }
  return "stable";
}

export const APP_RELEASE_CHANNEL = inferReleaseChannel(
  APP_VERSION,
  APP_BUILD_CHANNEL,
);
export const APP_IS_BETA = APP_RELEASE_CHANNEL === "beta";
export const APP_IS_DEV = APP_RELEASE_CHANNEL === "dev";
export const APP_CHANNEL_LABEL =
  APP_RELEASE_CHANNEL === "stable" ? "" : APP_RELEASE_CHANNEL;
export const APP_VERSION_LABEL = APP_CHANNEL_LABEL
  ? `${APP_VERSION_TAG} ${APP_CHANNEL_LABEL}`
  : APP_VERSION_TAG;
