# Identity (auth)

Users, organizations, business entities, stores, memberships and roles. A
first-class sibling of `core/` (§3) rather than a product module, because every
request depends on it.

## Bounded context

Who someone is, which stores they may reach, and what they may do there. It owns
authentication and authorisation; it owns no merchant data.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **User** | A person. One global row per email, never duplicated per store. |
| **Organization** | The management and grouping layer that owns stores. |
| **Business entity** | A legal entity, per country. Stores bill and pay tax under one. |
| **Store** | The canonical tenant boundary. All merchant data hangs off it. |
| **Membership** | A user's access to one store. Many per user, many per store. |
| **Role** | A named permission set, scoped by *category*. |
| **Role category** | Which permission tree a role may draw from: organization, store, point-of-sale or partner. |
| **Login flow** | One authentication attempt, correlated end to end by its `rid`. |

## Aggregates

| Aggregate root | Contains | Notes |
|---|---|---|
| `User` | credentials, MFA secret, recovery codes | credentials never leave this module |
| `Organization` | business entities, stores, roles | |
| `Store` | memberships | the tenant boundary |

## Entity scopes

Identity is the exception to "everything is store-scoped":

| Scope | Tables |
|---|---|
| platform | `users`, `organizations`, `sessions`, `login_flows` |
| organization | `business_entities`, `stores`, `memberships`, `roles`, `role_assignments` |

Declaring this honestly is what keeps the query guard enforcing a real boundary.
Forcing a `store_id` onto `users` would break every login and teach the guard to
demand something meaningless.

## Published contracts

`contracts/` publishes `UserSummary`, `StoreSummary` and the event names. Services,
repositories and anything credential-shaped stay internal.

## Security notes

- Passwords: scrypt, N=2^16, parameters stored with the hash so cost can be raised
  without a forced reset. Verification is constant-time.
- Session and one-time tokens are stored hashed; a database disclosure yields no
  usable credential.
- Refresh tokens rotate on every use. A hash that matches but fails the compare
  revokes the session and raises a critical audit event.
- `returnPath` is sanitised against open redirects before it is ever honoured.
- The login flow may only advance along declared steps, so MFA cannot be skipped
  by posting straight to completion.

## Not yet built

Passkeys/WebAuthn, SSO/OAuth providers, invitations, the partner actor, and the
account and organization screens (Phase 3 UI).
