# Services and email alerts

## Documenting a service

Open a device's **Services** tab. **Physical port** links the service to an
inventory interface. **Network port** is an optional numeric TCP or UDP port,
from 1 through 65535. A new port defaults to TCP; select UDP where appropriate.
The service summary shows the protocol and number separately from its URL and
notes. Clearing the number removes the documented network endpoint.

Use separate service entries for multiple endpoints. Recording a port does not
start a listener, probe the service or create a monitor. Existing monitor links
remain independent.

**Open service** opens an absolute HTTP/HTTPS URL in a separate tab. URLs with
embedded credentials, other schemes or invalid syntax remain plain text.
Rackpad does not infer a link from the device address or documented port.

Service endpoints are included in logical and native backups. Older logical
backups without endpoint fields restore with no network port. After upgrading
the database, rollback requires the previous image with its matching pre-upgrade
snapshot, rather than opening the migrated database in an older version.

## Testing SMTP

In **Admin → Alerting**, enter the mail provider's hostname, port, sender,
recipients and credentials when required. Enable **Implicit TLS** for a provider
using TLS immediately on connection, usually port 465. Leave it off for STARTTLS,
usually port 587. The switch does not rewrite the port. Save before sending a test.

TLS certificate verification stays enabled. Use the certificate's hostname and
ensure the server provides a trusted certificate chain. Do not disable
verification to bypass a certificate error.

Test failures distinguish connection, timeout, TLS, authentication, message
rejection and configuration problems. Responses and SMTP audit/log diagnostics
use sanitized categories instead of raw provider responses or credentials.
Inspect the alert history and mail server logs for further troubleshooting; share
only redacted evidence. A successful test confirms that configured delivery
completed, not that an external recipient has read or received it in an inbox.
