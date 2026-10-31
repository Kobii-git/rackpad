import {
  buildIntegrationUrl,
  integrationHttpRequest,
  parseIntegrationJson,
} from "./http.js";
import {
  ExternalProviderError,
  externalErrorCategory,
  type ExternalCollectionContext,
} from "./external-health-types.js";
import type { IntegrationConnectionSecrets } from "./types.js";

/** Read-only HTTP transport with one deadline shared by every page/resource. */
export function externalHttp(
  connection: IntegrationConnectionSecrets,
  headers: Record<string, string>,
  context: ExternalCollectionContext = {},
) {
  const deadline = Date.now() + 15000;
  async function get(path: string) {
    if (context.isCurrent && !context.isCurrent())
      throw new ExternalProviderError("configuration_changed");
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new ExternalProviderError("timeout");
    try {
      const response = await integrationHttpRequest(
        {
          url: buildIntegrationUrl(connection.baseUrl, path),
          headers,
          verifyTls: connection.verifyTls,
          timeoutMs,
          deadlineMs:deadline,
        },
        "External provider",
      );
      if (context.isCurrent && !context.isCurrent())
        throw new ExternalProviderError("configuration_changed");
      if (response.status === 401 || response.status === 403)
        throw new ExternalProviderError("authentication");
      if (response.status === 429)
        throw new ExternalProviderError("rate_limited");
      if (response.status < 200 || response.status >= 300)
        throw new ExternalProviderError(
          response.status === 404 ? "incompatible" : "unavailable",
        );
      return response;
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      throw new ExternalProviderError(externalErrorCategory(error));
    }
  }
  return {
    get,
    json: async (path: string): Promise<unknown> => {
      try {
        return parseIntegrationJson(await get(path), "External provider");
      } catch (error) {
        if (error instanceof ExternalProviderError) throw error;
        throw new ExternalProviderError("invalid_response");
      }
    },
  };
}
export function basicAuthorization(id: string, secret: string) {
  return `Basic ${Buffer.from(`${id}:${secret}`, "utf8").toString("base64")}`;
}
