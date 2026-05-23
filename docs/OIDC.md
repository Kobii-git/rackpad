# OIDC Login

Rackpad can use an OpenID Connect provider such as Authentik, Pocket ID,
Authelia, Keycloak, or another IdP that supports the authorization-code flow.
OIDC is optional; the local Rackpad user login still works.

## Environment

Set these values on the Rackpad container:

```bash
OIDC_ENABLED=1
OIDC_LABEL=Authentik
OIDC_ISSUER_URL=https://authentik.example.com/application/o/rackpad
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_URI=https://rackpad.example.com/api/auth/oidc/callback
OIDC_DEFAULT_ROLE=viewer
OIDC_ADMIN_GROUPS=admin
OIDC_EDITOR_GROUPS=
OIDC_VIEWER_GROUPS=
OIDC_ADMIN_USERS=
OIDC_EDITOR_USERS=
OIDC_VIEWER_USERS=
```

`OIDC_ISSUER_URL` must be the issuer URL. It is not the authorize endpoint, token
endpoint, or the IdP admin page. Rackpad fetches:

```text
OIDC_ISSUER_URL/.well-known/openid-configuration
```

If Rackpad is behind a reverse proxy, set `APP_URL` or `OIDC_REDIRECT_URI` to
the public HTTPS URL users will access.

## Authentik Example

In Authentik:

- Create or open the Rackpad OAuth2/OpenID provider.
- Set the redirect URI to `https://rackpad.example.com/api/auth/oidc/callback`.
- Assign a signing key to the provider/application.
- Use the application/provider issuer path as `OIDC_ISSUER_URL`, for example
  `https://authentik.example.com/application/o/rackpad`.

For a private single-admin deployment you can set:

```bash
OIDC_DEFAULT_ROLE=admin
OIDC_ADMIN_GROUPS=admin
```

For shared installs, keep `OIDC_DEFAULT_ROLE=viewer` and map admin/editor groups
explicitly.

## Debugging

Temporarily enable:

```bash
OIDC_DEBUG=1
```

Then restart Rackpad and try a login. The logs will include the discovery URL,
redirect URI, token endpoint status, and JWKS URL used during sign-in.

If login returns:

```json
{"error":"OIDC provider request failed with HTTP 404."}
```

test the discovery URL directly:

```bash
curl https://authentik.example.com/application/o/rackpad/.well-known/openid-configuration
```

A 404 there usually means the issuer is wrong. For Authentik, use the
application/provider issuer path rather than only the IdP root domain.

Turn `OIDC_DEBUG` off again after setup, because it adds extra authentication
diagnostics to the logs.
