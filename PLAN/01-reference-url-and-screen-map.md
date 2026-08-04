# Reference URL & Screen Map — extracted from the capture set (v1)

> **Why this file exists.** It replaces the 32-minute screen recording, the `out/` capture, and the raw
> URL evidence. Everything observed in those sources is transcribed here. **Read this instead of
> re-watching the video.** If a URL or screen is not in this file, it was not in the capture set — say so
> rather than inventing it.
>
> **Naming rule.** Per architecture spec §33.3, this is an *internal* design document and therefore names
> the reference platform directly for clarity. **Shipped code, comments, UI, and public docs must never do
> so** — use the alias **SC**. Every URL below is evidence, quoted verbatim; when you port it, substitute
> our own hostnames and keep the *shape*.
>
> **Provenance.** Reference product version **Spring '26**, captured 2026-08-02 from the real org
> *Deservefirst Pvt. Ltd.* (partners org `5085509`, dev dashboard org `228964463`, 4 stores).
> Sources: `recording/*.mov` (32:20, silent, frame-sampled), `out/html/admin/home/*.html`,
> `out/screenshots/**`, `out/state.json`.

---

## 0. How to re-derive this (if you ever need a frame back)

```bash
# the filename contains U+202F (narrow no-break space) — always glob, never type it
cd recording && ln -sf "$PWD"/*.mov /tmp/rec.mov
ffmpeg -ss <seconds> -i /tmp/rec.mov -frames:v 1 -q:v 2 /tmp/frame.jpg   # ~0.3s, input seek
```
The recording has **no audio track**. Section 7 below is the timestamp index.

---

## 1. The actor & scope model (this drives every URL)

The reference product separates **five** scopes. Getting this right is more important than any single URL,
because it decides which hostname a screen lives on and what its context resolution does.

| Scope | What it owns | Where it lives |
|---|---|---|
| **Person (account)** | identity, password, 2FA, passkeys, sessions/devices, personal locale & timezone | `accounts.<host>` |
| **Organization** | org name, **business entities**, users, roles, org security policy, the store list | `admin.<host>/organization/{orgId}/...` *and* mirrored into the store settings overlay |
| **Business entity** | a *legal* entity per country (US / India / …), typed (e.g. "Public company"), active/archived — owns tax & legal identity, referenced by stores | under Organization |
| **Store (tenant)** | all merchant data, per-store settings, staff assignment | `admin.<host>/store/{handle}/...` |
| **Partner** | agency/dev org: client stores, apps, API clients, leads, payouts | `partners.<host>/{partnerId}/...` |

**Two facts the architecture spec (§4.2) does not yet model** — carry them into the identity design:
1. **Business entity** sits between Organization and Store. Our model is `User / Tenant / Membership /
   Role / PartnerAccount` and has no legal-entity layer. Tax, invoicing and multi-country compliance need it.
2. **Organization is a first-class settings scope**, above the store, with its own Users / Roles / Security.
   Spec §8.4 has person, store and partner hosts but no organization section.

A third scope exists for developers: the **dev dashboard** (`dev.<host>/dashboard/{orgId}/...`), which owns
apps, dev stores and catalogs. It is org-scoped, not partner-scoped — the reference product split app
development *out of* the partner dashboard.

---

## 2. Hostnames observed

| Host | Purpose | Evidence |
|---|---|---|
| `accounts.<host>` | the person — profile, security, 2FA, devices | `accounts.shopify.com/accounts/{accountId}/personal` |
| `admin.<host>` | authenticated app — org scope + one store at a time | `admin.shopify.com/store/{handle}` |
| `dev.<host>` | dev dashboard — apps, dev stores, catalogs | `dev.shopify.com/dashboard/{orgId}/apps` |
| `partners.<host>` | partner dashboard — leads, payouts, API clients | `partners.shopify.com/{partnerId}/apps` |
| `apps.<host>` | app store / app auth entry | `apps.shopify.com/login/authenticate?shop=…&login_hint=…` |
| `themes.<host>` | theme store submission | `themes.shopify.com/services/v2/themes/submission/new` |
| `{token}-{id}.<preview-host>` | storefront preview | `…shopifypreview.com/products_preview?preview_key=…` |

Our spec (§8.4) plans four hosts. The capture shows **seven**. At minimum add `dev.` — separating app
development from the partner dashboard is a deliberate, correct split, because app devs and agencies are
different audiences with different auth.

---

## 3. Complete verified URL map

Every path below was observed. `{h}` = store handle, `{orgId}` = organization id, `{id}` = resource id.

### 3.1 Person — `accounts.<host>`
```
/accounts/{accountId}/personal          # name, email (verified badge), phone, login services,
                                        #   stores list, programs/resources, preferred language
/accounts/{accountId}/security          # password, secondary email, 2FA methods, backup methods,
                                        #   recovery codes, devices ("Logged in" list), log out all
/accounts/{accountId}/security#enroll_tfa   # 2FA enrolment — deep-linked by fragment
/accounts/{uuid}/redirect               # post-auth bounce
```
Security screen sub-flows seen: **Authenticator app** (primary), **Add another method**, **Regenerate
codes**, **Add new security key** → dialog offering *Security key · Mobile prompts · SMS*, **Generate a
temporary login code**, per-device rows with *This device* badge and individual **Log out**.

### 3.2 Auth & verification — `admin.<host>`
```
/login?login_hint={email}&returnPath={urlencoded}     # returnPath round-trips the deep link
/challenges/user_verification?token={jwt}             # step-up verification, token in URL
```
`state.json` additionally records the login chain: `accounts/lookup?rid=…&verify=…` →
`accounts/login?rid=…` → `accounts/login/two-factor/app?rid=…&send_code=true` → `partners/organizations`.
**`rid` is a login-request correlation id threaded through every step** — copy that pattern; it makes the
whole flow resumable and auditable.

### 3.3 Organization — `admin.<host>/organization/{orgId}`
```
/settings/organization-details                    # org name, business entities, stores
/settings/organization-account                    # users list
/settings/organization-account?from=dev           # entry-point provenance preserved in the URL
/settings/organization-account?search=&sort=LAST_NAME%20asc&selectedTab=all&start=&end=
/settings/organization-account/new                # add user
/settings/organization-account/{userId}           # user detail: roles, permission summary, secure sign-in
/settings/organization-account/roles              # roles list
/settings/organization-account/roles/new          # add role
/settings/organization-account/security           # org security policy
/store-create/organization/{orgId}                # create store wizard
```
**Note the list-state convention:** `?search=&sort=LAST_NAME%20asc&selectedTab=all&start=&end=` — search,
sort, tab and a date range, all in query params, all emitted even when empty. This is exactly our §8.5
rule, confirmed in the wild.

### 3.4 Store admin — `admin.<host>/store/{h}`

**Left nav (Spring '26), in order:** Home · Orders · Products · Customers · Growth · Discounts · Content ·
Markets · Finance · Analytics — then **Sales channels** (Online Store, **Agentic**) — then **Apps** — then
**Add** — with **Settings** pinned bottom-left and **Sidekick conversations** above it.

> `Growth` and `Finance` are top-level sections absent from our spec's §8.4 map. Add them.

Sub-nav appears inline under the active section:
- Orders → **Drafts · Shipping labels · Abandoned checkouts**
- Products → **Collections · Inventory · Purchase orders · Transfers · Gift cards**

```
/store/{h}                                  # home / overview
/store/{h}/orders                           /store/{h}/orders/{id}?newlyCreated=true
/store/{h}/draft_orders/new                 /store/{h}/draft_orders/{id}
/store/{h}/shipping_labels?kind=fulfillment&order=SHIPPING_LABEL_PURCHASE_SESSION_ID&orderDirection=DESCENDING
/store/{h}/products                         /store/{h}/products/new      /store/{h}/products/{id}
/store/{h}/products/inventory?location_id={id}   # nests inside /products/:id — see note below
/store/{h}/collections/new
/store/{h}/purchase_orders/new
/store/{h}/transfers
/store/{h}/customers                        /store/{h}/customers/new
/store/{h}/customers/segments/{id}
/store/{h}/companies/new                    # B2B
/store/{h}/growth
/store/{h}/discounts
/store/{h}/content/metaobjects
/store/{h}/pages/new
/store/{h}/markets
/store/{h}/analytics
/store/{h}/themes                           /store/{h}/themes?appLoadId={uuid}
/store/{h}/apps/agentic?appLoadId={uuid}    # embedded app surface — see §5
/store/{h}/bulk/customer?resource_name=Customer&edit=firstName%2ClastName%2Ctags%2Cemail%2CacceptsMarketing&return_to=%2Fstore%2F…
/store/{h}/sms_templates/order_confirmation/preview
```

**The two most instructive URLs in the whole capture:**

1. **Saved views + list state**
   ```
   /store/{h}/products?savedViewId=2172477178142
                      &query=vendor%3A"Hydrogen+Vendor"
                      &order=created_at+desc
                      &selectedColumns=IMAGE%2CTITLE%2C…
   ```
   Saved view id, a **filter-token query string** (`vendor:"Hydrogen Vendor"`), sort, *and the visible
   column set* — all in the URL. Our §12.6 promises exactly this; here is the concrete encoding to copy.

2. **The bulk editor is a route, not a mode**
   ```
   /store/{h}/bulk/customer?resource_name=Customer&edit={comma-separated fields}&return_to={encoded}
   ```
   A generic `/bulk/{entity}` screen parameterised by which fields are editable, with an explicit
   `return_to`. One implementation serves every entity — build it once in the Entity Toolkit.

> **Declared precedence, not a deviation.** We serve inventory at the captured
> `/store/{h}/products/inventory`. It nests inside `/store/{h}/products/:id`,
> which the catalog module owns, and our route-collision rule refuses
> cross-module shadowing — because normally *neither author has said which
> should win*, so reachability depends on discovery order.
>
> The inventory manifest therefore declares it:
>
> ```ts
> { path: '/store/:handle/products/inventory', …, shadows: ['/store/:handle/products/:id'] }
> ```
>
> The rule accepts an overlap only when the more specific route names the one it
> covers, and `composeScreenRoutes` emits declared shadows first so the router
> applies the precedence the author chose rather than its own default. A stale
> declaration — naming a path no module owns — is itself a violation, so this
> cannot rot into a comment that protects nothing.
>
> An earlier revision of this plan moved inventory to a top-level `/inventory`
> to dodge the overlap. That silenced the rule without answering its question,
> and cost a URL the reference product deliberately nests.

### 3.5 Store settings — `admin.<host>/store/{h}/settings`

Settings renders as a **full-screen overlay above the admin** (the store page stays mounted behind it;
an ✕ closes back to it) while still owning a real URL. This is our §8.5 "modals are nested routes" rule
validated by the reference product — implement it the same way.

Both org-scoped and store-scoped sections live in one settings tree:
```
# --- org scope (mirrored here from /organization/{orgId}) ---
/settings/organization-details
/settings/organization-account                  /settings/organization-account/{userId}

# --- store scope ---
/settings                                       # index
/settings/general                               # store name, contact, address, dev-store banner,
                                                #   store defaults, order ID format, order processing
/settings/general/store-contact-details
/settings/general/branding
/settings/plan                                  /settings/subscribe/select-plan
/settings/billing
/settings/payments
/settings/checkout
/settings/customer_accounts
/settings/shipping                              /settings/shipping/profiles/{id}
/settings/taxes
/settings/locations
/settings/markets
/settings/apps
/settings/sales_channels
/settings/domains                               /settings/domains/connect
/settings/domains/verifications/{id}
/settings/customer_events                       /settings/customer_events/pixels/custom/{id}
/settings/notifications                         /settings/notifications/customer
/settings/custom_data                           # metafields & metaobjects hub
/settings/custom_data/{entity}/metafields       # e.g. .../product/metafields
/settings/custom_data/{entity}/metafields/create
/settings/languages
/settings/privacy                               # customer privacy / GDPR
/settings/policies
/settings/legal/cancel-return-rules/{id}        # return & cancellation default rules
```
Settings left-rail order, verbatim: **General · Plan · Billing · Payments · Checkout · Customer accounts ·
Shipping and delivery · Taxes and duties · Locations · Markets · Apps · Sales channels · Domains ·
Customer events · Notifications · Metafields and metaobjects · Languages · Customer privacy · Policies.**

`/settings/custom_data/{entity}/metafields` is the key one for us: **the metafield-definition screen is
generic over entity**, which is precisely the Entity Toolkit (§12.1) surfaced as UI. Entities carrying
definitions: Products, Variants, Collections, Customers, Orders, Draft orders, Companies, Company
locations, Locations, Transfers, Pages, Blogs, Blog posts, Markets, Shop.

### 3.6 Dev dashboard — `dev.<host>/dashboard/{orgId}`
```
/stores                       /stores?store_type=dev        /stores?store_type=client_transfer
/catalogs
/apps                         /apps/new
/apps/{appId}/versions/new?new_app_created=true
/apps/{appId}/settings
/apps/{appId}/logs
/apps/{appId}/monitoring/api_health
/apps/{appId}/monitoring/webhooks
/apps/{appId}/monitoring/function
```
Store list columns: Store · Type · Status · Owner · **Plan** · **Feature preview** · Created.
Store types seen: **Dev**, **Client transfer**. Tabs: Dev / Client transfer / Collaborations.

**App settings screen contains** (all portable requirements): Client ID + Client secret (with rotate),
API contact email, **Google Cloud Pub/Sub** webhook delivery, **Amazon EventBridge** webhook delivery,
Navigation bar ("static navigation supported until December 2026"), **Storefront API** (custom apps only),
**App automation token** (CI/CD), App icon (PNG/JPG, 1200×1200, 1 MB), Delete app.

**App version screen contains:** App URLs (app URL, *embed app in admin* toggle, preferences URL),
redirect URLs (comma-separated), **Webhooks API version** (`2026-07`), **API access scopes** picker,
Optional scopes, "use legacy install flow", **POS** (embed in POS), **App proxy** (subpath prefix,
subpath, proxy URL), then **Release this new version** (version name + message).

**Scope picker** is grouped `API family → feature → scope`, e.g. `Admin API · Analytics ·
read_analytics`; `Admin API · Cart Transform API · read_cart_transforms / write_cart_transforms /
read_all_cart_transforms`. Counter reads `4 / 30`. Footer: *"Some scopes require permission before you
can include them in a version — Request access."* → **scopes are themselves gated resources**, not a
free-for-all. Copy that.

**Monitoring** tabs: All · **API health** (surfaces *deprecated API calls*) · Admin performance ·
Webhooks · Functions. **Logs** filter by: All · Webhook · Function · App event · App billing event ·
GraphQL request · REST request · UI extension error · Sidekick event. Range picker `Last 7 days`.

> `/monitoring/api_health` + the Logs event taxonomy *is* the "API health / deprecation surfacing" item
> our §23.2 lists as a gap. It is real, it is shipped, and the event taxonomy above is the spec for ours.

### 3.7 Partner dashboard — `partners.<host>/{partnerId}`
```
/{partnerId}                                        # business overview: pending payout, active
                                                    #   referrals, lifetime revenue, changelog feed
/{partnerId}/apps
/{partnerId}/ads
/{partnerId}/payments
/{partnerId}/partner_leads                          /{partnerId}/partner_leads/plus
/{partnerId}/referral_history
/{partnerId}/settings
/{partnerId}/settings/partner_api_clients/new
/{partnerId}/settings/partner_api_clients/{id}
/{partnerId}/settings/partner_api_clients/graphiql?partnerApiClient={id}&apiVersion=2026-07
```
Partner left nav: Home · Stores · Sales · App distribution · Catalogs · Themes — then **Payouts** ·
**Partner settings**. Settings screen: Taxes (tax ID per region) · Invoices · Billing · **Partner API
clients** · **CLI Token**.

**The partner API has its own GraphiQL console, versioned by date, bound to a specific API client.**
That is our §26.5 "dogfood" principle made concrete — ship an explorer against the real schema.

### 3.8 Storefront preview
```
{token}-{id}.<preview-host>/products_preview?preview_key={key}
```
Signed, tokenised, per-resource preview on a throwaway host. Needed for §34 (SSR/SEO) and for any
"preview before publish" flow.

---

## 4. Screen inventory — what each screen must contain

Only screens actually observed. Template names refer to spec §8.3.

### 4.1 ListScreen — canonical example: Products (16:00–16:15)
Header actions: **Export · Import · More actions · Add product**. Tabs = saved views (`All`, custom) with
a `+`. Search box + filter chips (`Vendor`, `Category`, `Gift Cards`) + **Save** (persists the view) +
`Edit`/`View as` column control. Columns: checkbox · Product (image+title) · Status badge · Inventory
("50 in stock", "50 in stock for 2 variants") · Category · Channels · Catalogs · Product type · Vendor.
Row-hover reveals inline actions. Bulk selection → floating bulk bar. Footer "Learn more about products".

**Every one of those affordances is generic.** Build it once (§12.6) and every entity inherits it.

### 4.2 DetailScreen — canonical example: Add product (16:30–21:15)
Two-column Polaris layout. Left column: Title · rich-text Description (full toolbar) · **Media** (upload,
select existing, drag-drop, **Generate image** with AI + follow-up prompt) · **Category** (taxonomy
picker → *"Determines tax rates and adds metafields to improve search, filters, and cross-channel
sales"*) · Price / Compare-at / **Cost per item → Profit & Margin auto-computed** / Charge tax ·
**Inventory** (track quantity, per-location quantities, SKU, barcode, continue selling when out of
stock) · **Shipping** (physical product, package/size, weight, country of origin, HS code) · **Variants**
(add options like Color/Fabric, per-variant price + per-location inventory, group-by, bulk edit) ·
**Purchase options** (one-time / subscriptions / pre-orders) · **Category metafields** (auto-attached
from the taxonomy category — Color, Fabric, Sleeve length type…) · **Product metafields** (custom
definitions) · **Search engine listing** (editable title/URL/description preview).
Right column: **Status** (Active/Draft) · **Publishing** → *Manage publishing* modal listing Sales
Channels (Online Store, Point of Sale, Shop) and **Markets** with per-channel toggles · Product
organization (Type, Vendor, Collections, Tags) · **Theme template** selector.
Chrome: contextual save bar with **Discard / Save**, "Unsaved changes" banner.

### 4.3 CreateScreen with rules — Collections (21:45–23:00)
Manual vs **Automated**: condition builder (`Tag / includes / …`, add condition, All vs Any) **plus an
`Exclude` rule set** and a "Select products to exclude" picker. Collection items grid, manual sort,
theme template, SEO listing.

### 4.4 Order / Draft order (13:45–15:45)
Create order: product picker + **custom item**, per-line quantity/price, discounts, shipping,
**Estimated tax "Not calculated"**, Notes, Customer, Contact/Shipping/Billing address, **Markets**,
**Currency**, Tags. Actions: **Send invoice**, **Collect payment**, **Share checkout link** (modal with
*Product prices locked* and *Discount codes* toggles). Order detail: payment-status badges
(`Payment pending`, `Unfulfilled`), Timeline with comment box, Conversion summary, "Send gift card".

### 4.5 Settings screens
Two-pane: left rail = section list; right = cards. Every settings screen is inside the overlay and
deep-linkable. `General` cards: Store details · Store contact details · Store address · Development-store
notice with *View release notes* · **Store defaults** (Currency display → Markets, **Backup Region**,
Unit system, Default weight unit, **Time zone** with "sets the time for when orders and analytics are
recorded" and a link out to *account settings* for the user-level timezone) · **Order ID format**
(prefix/suffix, live preview `#1001`) · Order processing.

> That timezone card is the clearest possible statement of our §15.1 three-layer rule: **store timezone ≠
> user timezone**, and the UI links between them explicitly. Copy the copy.

### 4.6 Roles & permissions (02:00–02:45, 10:00–11:15)
`Add role`: Name, Description, then **Permissions** gated by a *role category* selector — **Organization ·
Store · Point of Sale · Partner** — where the category determines which permission tree is available.
POS category shows: `Grant manager approval` (staff approve others via PIN) + groups
`Checkout 0/5 · Discounts 0/2 · Orders 0/12 · Customers 0/8 · Inventory 0/1 · Apps 0/2 · Analytics 0/1 ·
Register 0/6`. Organization category shows: `Organization · Stores · Point of Sale · Partner`, plus
`Marketing and referrals · Finance (View financials, Manage credits and refunds) · Distribution (Submit
and manage partner directory listings) · App store (Submit apps, Manage app listing) · Theme store`.
User detail screen shows an aggregated **Permission summary** across all assigned roles, and a
**Secure sign-in method** toggle (org-wide passkey/2FA requirement).

> Our §4.2 `Role.permissions[]` is flat. Add: **role category**, **aggregate permission summary**, and an
> **approval** primitive.

---

## 5. Agentic commerce — the capability our spec has no chapter for

`/store/{h}/apps/agentic?appLoadId={uuid}` — an **Agentic** entry under *Sales channels*.

Screen: *"Agentic Storefronts aren't live — but your products may still be surfacing in AI agents."*
- **Get ready** checklist: "Make sure catalog access is enabled — allow your products to be searchable by
  AI agents" (✅) · "Update policies so AI agents can read them" (→ `/pages/re…` Review).
- **Allow platform to manage for me** master toggle, then per-channel: **ChatGPT · Microsoft Copilot ·
  Other channels · Shop**.
- **Sources** "used by AI agents to recommend your products": **Catalog** (`0 products in Catalog`) and
  **Knowledge Base** (installable).
- Link: *"Review how your product data is sent to the Catalog for Agentic Storefronts."*

Separately, **Sidekick** — an in-admin AI assistant — owns a persistent *Sidekick conversations* list in
the left nav, and `Sidekick event` is a first-class app-log type.

**Assessment.** Our spec reserves an `ai` manifest key (§31.2) and defers the AI engine (§36.3). But §34
argues at length that being *findable* matters as much as being *manageable* — and the reference product
says the 2026 form of findable is **agent-discoverability**: a machine-readable catalog + policies, per-
agent channel consent, and a knowledge-base source. That is a product decision to take deliberately, not
one to inherit by deferral. See `03-master-build-plan.md` §Phase 4.

---

## 6. Everything else the capture shows that our spec does not model

| Observed | Where | Our spec's position |
|---|---|---|
| **Business entities** (legal entity per country, typed, archivable) | org settings | absent from §4.2 |
| **Organization** as a settings scope with own users/roles/security | `/organization/{orgId}/…` | one mention in §12.2, no URL |
| **Role categories** + permission summary + PIN approval | roles UI | §4.2 flat permissions |
| **Webhook delivery via Pub/Sub & EventBridge** | app settings | §31.9 assumes HTTP only |
| **App automation token** (CI/CD) | app settings | absent |
| **Scope-level access gating** ("request access") | scope picker | absent |
| **API health / deprecated-call monitoring** per app | `/monitoring/api_health` | listed as gap §23.2 — confirmed real |
| **App log taxonomy** (webhook, function, app event, billing event, GraphQL, REST, UI-extension error, Sidekick) | app logs | §28 has no app-facing stream |
| **`Growth` and `Finance`** top-level admin sections | left nav | absent from §8.4 |
| **Purchase orders · Transfers** | products sub-nav | absent |
| **Companies** (B2B) as first-class entity | `/companies/new` | deferred to §25 phase 4 |
| **Customer segments** | `/customers/segments/{id}` | absent |
| **Store type `client_transfer`** | dev dashboard | §12.3 has live/dev/password-protected |
| **Per-store feature previews + release notes** | store settings | validates §36.2 flags≠entitlements |
| **Category metafields** from taxonomy | product form | §12.1 has metafields, not taxonomy-driven ones |
| **Generic `/bulk/{entity}` editor route** | bulk edit | §12.1 says "bulk editor", no route shape |
| **Backup Region**, **Order ID prefix/suffix** | settings/general | absent |
| **Cancellation & return default rules** | `/settings/legal/cancel-return-rules/{id}` | absent |
| **Custom pixels** | `/settings/customer_events/pixels/custom/{id}` | absent |
| **Partner leads / referral history / payouts** | partners | §8.4.8 has payouts only |
| **Partner API + GraphiQL console, dated** | partner settings | §13 has no partner API surface |
| **CLI Token** issued from the dashboard | partner settings | §18 CLI has no auth story |

---

## 7. Recording timestamp index

Use only if you need a frame this document does not describe.

| Time | Content |
|---|---|
| 00:00–01:30 | Partners overview · dev dashboard stores · create-store wizard |
| 01:30 | Catalogs (dev dashboard) — config + search preview |
| 01:45–02:45 | Org users / roles / add role / permission tree / org details |
| 03:00–04:45 | Personal account: profile, security, 2FA, recovery codes, devices, security keys |
| 05:15–05:45 | Partner leads (Plus / POS / B2B), referral income |
| 06:00–09:45 | App lifecycle: create → version → scopes → release → logs → monitoring |
| 10:00–11:45 | Org user add/assign, permission summary · app ads · theme store submission |
| 12:00–13:15 | Partner settings, API clients, tokens, **GraphiQL** |
| 13:30–15:45 | Store onboarding · draft orders · create order · customer · checkout link · order detail |
| 16:00–21:30 | Products: list, add, media, AI image, variants, metafields, SEO, storefront preview |
| 21:45–23:00 | Collections: manual, automated conditions, exclusions |
| 23:15–24:45 | Inventory CSV import · purchase orders · transfers · customers · companies (B2B) |
| 25:00–25:30 | Metaobjects · pages · **Agentic** |
| 25:45–32:15 | Full settings sweep → org, general, payments, customer accounts, notifications, custom data, languages, domains (**onatru.com** via Namecheap), privacy/GA, policies, return rules, shipping |

---

## 8. What the `out/` capture is worth

Near nothing, and you should not spend time on it. `manifest.json` is `{pages:[],flows:[],skipped:[]}`;
`urls.csv` and `skipped.csv` are header-only; `all-urls.txt` is empty; `index.html` self-reports
*"0 pages · 0 screen templates · 0 flows"*. Several `state.json` login steps show heading
**"You are offline"**, which is why the crawl produced nothing.

Salvageable: `state.json` (the login-flow chain, §3.2 above), 11 login screenshots, 3 admin-home
screenshots + ~30 interaction shots, and 3 saved HTML files (`admin.html` 183 KB) — from which the nav
hrefs in §3.4 were extracted. **If broader screen coverage is ever needed, re-run the crawler; do not
mine this dataset further.**
