# Apps

The app platform: third-party software a merchant installs into their store.

## Why this is not a module

A module is something the platform ships. An app is something somebody else
ships, and the difference shows up everywhere that matters — it is authorised
by a merchant rather than enabled by an operator, its code never runs in this
process, and its reach is a grant that can be taken back. Those are platform
concerns, so this sits beside `auth` rather than under `modules/`.

## The shape

`domain/app.ts` holds the rules — redirect matching, code single-use, what a
token's scopes actually are. They are in the domain rather than the service
because every one of them is a one-line change away from being an
authentication hole, and the service is where hurried changes go.

Two vocabularies meet here. Apps ask for **scopes** (`read_products`), which is
the right granularity for a consent screen. Staff hold **permissions**
(`catalog.products.read`), which is the right granularity for a role. A scope
declares the permissions it grants, and an app's token carries those
permissions past the edge — so nothing downstream knows or cares that the
caller is an app, and there is one authorisation mechanism rather than two that
drift.

## The gates

Installing is the merchant's decision and only the merchant's. An app declares
what it wants; the merchant answers; the answer is frozen on the installation.
An app that later wants more triggers re-consent rather than a wider token.
Uninstalling stops live tokens on the next request, not when they expire.
