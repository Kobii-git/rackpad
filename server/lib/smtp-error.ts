export const SMTP_ERRORS = {
  configuration: "Check the SMTP host, sender and recipient settings.",
  connection:
    "Cannot connect to SMTP. Check the hostname, port and network access.",
  timeout:
    "SMTP timed out. Check network access and the TLS mode for this port.",
  tls: "SMTP TLS verification failed. Check the certificate, hostname and TLS mode.",
  authentication:
    "SMTP authentication failed. Check the username and password.",
  rejection:
    "SMTP rejected the message. Check sender and recipient permissions.",
  delivery: "SMTP delivery failed. Check the mail server configuration.",
} as const;

export class SmtpDeliveryError extends Error {
  constructor(readonly category: keyof typeof SMTP_ERRORS) {
    super(SMTP_ERRORS[category]);
    this.name = "SmtpDeliveryError";
  }
}

/** Never retain provider messages, credentials, response text or a raw cause. */
export function smtpDeliveryError(error: unknown): SmtpDeliveryError {
  if (error instanceof SmtpDeliveryError) return error;
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const codes = [value.code, value.originalCode, value.errno].filter(
    (code): code is string => typeof code === "string",
  );
  const has = (...choices: string[]) =>
    codes.some((code) => choices.includes(code));
  if (has("ETIMEDOUT", "ESOCKETTIMEDOUT"))
    return new SmtpDeliveryError("timeout");
  if (
    has("ETLS") ||
    codes.some((code) =>
      /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/.test(
        code,
      ),
    )
  )
    return new SmtpDeliveryError("tls");
  if (has("EAUTH")) return new SmtpDeliveryError("authentication");
  if (
    has("EENVELOPE", "EMESSAGE") ||
    (typeof value.responseCode === "number" && value.responseCode >= 400)
  )
    return new SmtpDeliveryError("rejection");
  if (
    has(
      "EDNS",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNECTION",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ESOCKET",
    )
  )
    return new SmtpDeliveryError("connection");
  return new SmtpDeliveryError("delivery");
}
