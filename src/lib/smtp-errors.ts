export const smtpErrorMessages = {
  notification_disabled: "Enable notifications before sending a test alert.",
  ntfy_configuration: "Check the ntfy topic URL, access token and encryption key.",
  ntfy_connection: "Cannot deliver to ntfy. Check the URL, network access and TLS certificate.",
  ntfy_timeout: "ntfy timed out. Try again later.",
  ntfy_rejection: "ntfy rejected the message. Check topic permissions and authentication.",
  ntfy_rate_limit: "ntfy rate limit reached. Try again later.",
  notification_delivery: "Notification delivery failed. Check the configured channels.",
  smtp_configuration: "Check the SMTP host, sender and recipient settings.",
  smtp_connection:
    "Cannot connect to SMTP. Check the hostname, port and network access.",
  smtp_timeout:
    "SMTP timed out. Check network access and the TLS mode for this port.",
  smtp_tls:
    "SMTP TLS verification failed. Check the certificate, hostname and TLS mode.",
  smtp_authentication:
    "SMTP authentication failed. Check the username and password.",
  smtp_rejection:
    "SMTP rejected the message. Check sender and recipient permissions.",
  smtp_delivery: "SMTP delivery failed. Check the mail server configuration.",
} as const;
