export const APP_VERSION = __APP_VERSION__;
export const APP_VERSION_TAG = `v${APP_VERSION}`;
export const APP_RELEASE_CHANNEL = APP_VERSION.toLowerCase().includes("beta")
  ? "beta"
  : "stable";
export const APP_IS_BETA = APP_RELEASE_CHANNEL === "beta";
export const APP_VERSION_LABEL = APP_IS_BETA
  ? `${APP_VERSION_TAG} ${APP_RELEASE_CHANNEL}`
  : APP_VERSION_TAG;
