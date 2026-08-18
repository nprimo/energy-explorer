# E-REDES authentication flow

This document summarizes the investigation into replacing the `EREDES_AAT` and
`EREDES_CPE` environment variables with a user-managed E-REDES connection flow.

## Current situation

The application currently:

- reads `EREDES_AAT` and `EREDES_CPE` from the environment;
- creates a process-wide E-REDES client in `src/lib/server/runtime.ts`;
- sends the AAT value as part of the E-REDES cookie/header request;
- returns HTTP 401 when E-REDES authentication fails;
- requires manually copying the `aat` cookie from browser developer tools into `.env`.

This is suitable for initial local development, but not for a user-managed
connection flow. A process-wide client and environment credential cannot
represent different users or connections.

## Domain terminology

- **App user** — the person authenticated in the application.
- **E-REDES connection** — an authorization held by the app for one E-REDES account.
- **Credential bundle** — AAT plus any required session cookies.
- **Meter point** — the CPE associated with a connection.
- **Connection status** — connected, expired, invalid, or reauthentication-required.
- **Reading cache** — consumption data already pulled into the database.
- **Authorization** — permission to access E-REDES, separate from cached readings.

A reading cache is not a credential store.

## Findings about E-REDES

The current E-REDES web application does not provide an obvious supported way
for an unrelated web application to read its cookies.

- Cookies are scoped to `balcaodigital.e-redes.pt` and cannot be read by the
  Energy Explore origin.
- An iframe is not currently viable. The E-REDES login response includes
  `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options:
SAMEORIGIN`.
- Direct browser calls from Energy Explore are not currently viable. The data
  endpoint allows credentials but restricts CORS to the E-REDES origin rather
  than arbitrary application origins.
- A redirect can only provide a clean integration if E-REDES supports OAuth/OIDC
  or another authorization callback protocol.
- A bookmarklet can only read `aat` if that cookie is accessible to JavaScript.
  It cannot read an `HttpOnly` cookie.
- A browser extension can potentially read `HttpOnly` cookies through the
  browser cookie API, but requires sensitive host permissions and user
  installation.
- Server-side login automation is not recommended because of CAPTCHA,
  MFA/security controls, fragility, and possible terms-of-service issues.

The public E-REDES API portal should be investigated before relying on private
web endpoints:

- [E-REDES API Developer Portal](https://apiportal.e-redes.pt/public/)
- [Using our APIs](https://apiportal.e-redes.pt/public/node/3)
- [Ler o meu consumo discussion](https://apiportal.e-redes.pt/public/node/562)

There does not currently appear to be an obvious public residential personal-consumption API in the public catalog, but this should be confirmed directly with E-REDES.

## Findings from `mrfyda/ha-eredes`

Repository: [github.com/mrfyda/ha-eredes](https://github.com/mrfyda/ha-eredes)

The integration's advertised “Automatic re-authentication flow” does **not** automatically log in to E-REDES or refresh the JWT. It implements automatic authentication-error detection followed by a manual credential replacement flow.

### Implemented flow

1. The integration polls E-REDES.
2. A failed credential results in `ERedesAuthenticationError`.
3. The coordinator raises Home Assistant's `ConfigEntryAuthFailed`.
4. Home Assistant opens its built-in reauthentication flow.
5. The user logs into E-REDES separately and manually copies a new AAT value.
6. The user enters the new value into the Home Assistant form.
7. The integration validates it with a real E-REDES request.
8. Home Assistant updates the config entry and reloads the integration.

Relevant files:

- [`config_flow.py`](https://github.com/mrfyda/ha-eredes/blob/main/custom_components/eredes/config_flow.py)
- [`coordinator.py`](https://github.com/mrfyda/ha-eredes/blob/main/custom_components/eredes/coordinator.py)
- [`eredes_api/client.py`](https://github.com/mrfyda/ha-eredes/blob/main/custom_components/eredes/eredes_api/client.py)
- [`0001-manual-token-paste-auth.md`](https://github.com/mrfyda/ha-eredes/blob/main/docs/adr/0001-manual-token-paste-auth.md)
- [`0003-authorization-request-is-the-recaptcha-slot.md`](https://github.com/mrfyda/ha-eredes/blob/main/docs/adr/0003-authorization-request-is-the-recaptcha-slot.md)

### Token lifetime and renewal

The repository's investigation reports that:

- the AAT lifetime is approximately 91 minutes;
- the AAT is not renewed by normal API requests;
- `PHPSESSID` may be rotated, but that is not equivalent to refreshing AAT;
- token/login endpoints are protected by CAPTCHA;
- no usable refresh-token flow was found.

Therefore the process is credential replacement, not token refresh:

```text
AAT expires
  -> application detects 401
  -> user logs in to E-REDES manually
  -> user supplies a new credential bundle
  -> application validates and stores it
```

### 401 and 403 distinction

The E-REDES gateway can use 403 for CAPTCHA/bot-gate challenges as well as
authorization problems. The Home Assistant integration currently treats both 401
and 403 as authentication failures, which may trigger reauthentication
unnecessarily.

Energy Explore should distinguish at least:

```text
401
  -> credential is expired or invalid
  -> connection becomes reauthentication-required

403 with a CAPTCHA/bot-gate indication
  -> provider challenge or transient failure
  -> do not automatically assume the credential is expired
```

## Candidate flows for Energy Explore

### Option A: official authorization flow

Preferred if E-REDES supports it:

```text
Energy Explore -> E-REDES authorization page
User logs in at E-REDES
E-REDES -> Energy Explore callback with short-lived authorization code
Energy Explore server exchanges the code and stores the resulting credential
```

The raw credential should never be placed in a URL.

### Option B: manual import UI

Best first fallback and simplest implementation:

1. App detects 401 and displays “Reconnect E-REDES”.
2. User opens E-REDES in another tab and logs in.
3. User pastes the AAT or full cookie header into a password-style input.
4. The server validates it against the user's CPE.
5. The server encrypts and stores it.
6. The old credential is replaced only after validation succeeds.

This removes the need to edit `.env` or restart the app, while preserving a
fallback for all users.

### Option C: bookmarklet

A bookmarklet could remove the developer-tools step if `aat` is
JavaScript-readable. It could transfer the credential to the waiting application
tab through a tightly validated `postMessage`, or copy it to the clipboard.

Limitations:

- it cannot read `HttpOnly` cookies;
- it requires users to install a bookmarklet;
- it is awkward for non-technical users and mobile users;
- it gives a bookmarklet access to a sensitive bearer credential;
- it should not be treated as a long-term general-user authentication solution.

A bookmarklet is reasonable as an optional convenience for a personal project or
technical beta users, not as the foundation of the authentication architecture.

### Option D: browser extension

A narrowly scoped extension could read the E-REDES cookie bundle using browser
cookie APIs after an explicit user action and send it to a pending Energy
Explore connection.

Required safeguards:

- explicit user action;
- host permission restricted to E-REDES;
- one-time, short-lived connection request;
- HTTPS-only transfer;
- no extension logging or persistence;
- no raw credential in URLs;
- strict origin and request validation on the application side.

This is more capable than a bookmarklet, including for `HttpOnly` cookies, but
adds installation and maintenance costs.

## Recommended domain and persistence model

Credential-related `.env` values should be removed once the SQLite-backed
connection flow is implemented. `.env` may remain temporarily as a migration
fallback, but it should no longer be the normal source of `EREDES_AAT` or
`EREDES_CPE`.

A small `User` model is reasonable if we want to prepare for multiple users, but
it should not be confused with a complete authentication system. A user row
alone does not protect the application; hosted deployments will still need
application authentication and authorization.

The credential should belong to an **E-REDES connection**, rather than being
stored directly on the user. This allows one user to have multiple CPEs and
allows each connection to be reauthenticated independently.

The target model is:

```text
User
  -> E-REDES connection
       -> CPE
       -> encrypted credential bundle
       -> token validity metadata
       -> connection status
```

For a single-user local application, a single automatically-created local user
is sufficient. We do not need to build a full user registration/login system
yet.

A minimal schema could be:

```sql
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE eredes_connections (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  cpe                   TEXT NOT NULL,
  encrypted_credentials BLOB NOT NULL,
  token_issued_at       TEXT,
  token_expires_at      TEXT,
  last_validated_at     TEXT,
  status                TEXT NOT NULL DEFAULT 'unknown',
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,

  UNIQUE (user_id, cpe)
);
```

The exact schema can evolve, but it should support a credential bundle rather
than assuming that the AAT is the only relevant cookie.

### Validity metadata

If AAT is a JWT, `token_expires_at` can be derived from its `exp` claim and used
to warn the user before the next expected 401. This is an estimate, not proof of
validity. E-REDES responses remain authoritative.

Useful initial metadata includes:

- `token_issued_at`;
- `token_expires_at`;
- `last_validated_at`;
- `status`;
- `last_error`.

The application should still handle an unexpected 401 even when the stored
expiry estimate says the credential is valid.

### Credential security

Treat AAT and related session cookies as a **credential bundle**, not merely as
a JWT.

The raw value should not be stored in:

- `localStorage` or `sessionStorage`;
- a normal browser cookie;
- URLs or query parameters;
- SvelteKit page data;
- logs, traces, analytics, or error messages.

A password-style input is useful for visual masking but is not encryption. For
SQLite, encrypt the credential bundle at the application level with
authenticated encryption and keep the encryption key outside the database. A
local OS keychain or production KMS is preferable to storing the key beside the
database.

Removing AAT from `.env` does not eliminate the key-management problem. A local
encryption key may initially be provided through a deployment secret or a
separate environment variable such as `EREDES_CREDENTIAL_ENCRYPTION_KEY`; the
actual AAT should not be stored there.

## Proposed connection lifecycle

```text
Normal request
  -> resolve app user
  -> resolve active E-REDES connection
  -> use its credential bundle

E-REDES returns 401
  -> mark connection reauthentication-required
  -> preserve cached readings
  -> show reconnect action

User reconnects
  -> receive candidate credential bundle
  -> validate against CPE
  -> encrypt and persist candidate
  -> replace old credential atomically
  -> mark connection connected
  -> retry the requested operation
```

Do not overwrite a valid existing credential until the replacement has been validated.

## Migration from `.env`

The transition should not require users to re-enter an existing credential unnecessarily:

1. Detect `EREDES_AAT` and `EREDES_CPE` if present.
2. Create the initial local user and E-REDES connection.
3. Validate the credential.
4. Store it in SQLite.
5. Inform the user that the environment variables can be removed.
   . Eventually remove support for the credential-related environment variables.

A first-run setup screen can be used instead for a clean installation.

## Changes likely needed in Energy Explore

- Replace process-wide `EREDES_AAT` usage with a connection lookup scoped to the
  app user/request.
- Move `EREDES_CPE` from environment-only configuration to the E-REDES connection.
- Add `users` and `eredes_connections` migrations.
- Add a connection status and reauthentication-required state.
- Add a manual import endpoint and UI first.
- Validate imported credentials before persistence.
- Store the credential bundle encrypted.
- Ensure credentials never appear in logs or OpenTelemetry attributes.
- Update pull/backfill/refresh routes to use the selected connection rather than
  a global environment token.
- Keep cached readings available when a credential expires.
- Add app authentication and ownership checks before supporting multiple users.
- Distinguish 401 credential failures from CAPTCHA/bot-gate 403 responses.

The current readings table is keyed by CPE. That is sufficient for the initial
single-user flow, but readings will eventually need explicit connection/user
scoping if multiple users or shared CPEs are supported.

## Current recommendation

For the next implementation step:

1. Remove `EREDES_AAT` and `EREDES_CPE` as normal runtime configuration, while
   keeping temporary migration support.
2. Add a small `users` table and automatically create one local user.
3. Add an `eredes_connections` table owned by that user.
4. Store CPE and an encrypted credential bundle in the connection.
5. Store optional token expiry and validation metadata.
6. Implement manual credential import and server-side validation.
7. Add the reauthentication-required UI state.
8. Replace the process-wide environment-based E-REDES client with a
   connection-based client lookup.
9. Investigate whether the AAT cookie is JavaScript-readable before considering
   a bookmarklet.
10. Continue investigating an official E-REDES authorization/API flow.
11. Consider a browser extension only if manual import remains too inconvenient.
