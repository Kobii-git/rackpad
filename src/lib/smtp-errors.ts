export const smtpErrorMessages = {
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
