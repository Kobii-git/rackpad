import {
  optionalInteger,
  optionalEnum,
  ValidationError,
} from "./validation.js";

export interface ServiceEndpoint {
  networkPort: number | null;
  transportProtocol: "tcp" | "udp" | null;
}

/** Shared by API writes and logical restore; omitted PATCH fields retain state. */
export function parseServiceEndpoint(
  body: Record<string, unknown>,
  existing: ServiceEndpoint = { networkPort: null, transportProtocol: null },
): ServiceEndpoint {
  const port = optionalInteger(body, "networkPort", { min: 1, max: 65535 });
  const protocol = optionalEnum(body, "transportProtocol", [
    "tcp",
    "udp",
  ] as const);
  const networkPort = port === undefined ? existing.networkPort : port;
  if (networkPort === null) {
    if (protocol != null)
      throw new ValidationError(
        "A network port is required for a transport protocol.",
      );
    return { networkPort: null, transportProtocol: null };
  }
  return {
    networkPort,
    transportProtocol: protocol ?? existing.transportProtocol ?? "tcp",
  };
}
