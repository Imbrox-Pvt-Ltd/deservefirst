# PLAN — the reference set, distilled

These three documents replace the raw capture material. **Read these instead of re-watching the recording
or re-crawling the admin.**

| File | What it answers | Read it when |
|---|---|---|
| `01-reference-url-and-screen-map.md` | *What are we building?* Every URL, screen, nav item, form field and list-state convention observed in the reference product (Spring '26), plus the capability deltas against our architecture spec. | designing any screen, route, or entity |
| `02-imbrox-reuse-assessment.md` | *What already exists?* A survey of the ~52k-LOC `imbrox` codebase: what to port as-is, what to rework, where its stack choices conflict with the spec. | before writing anything that might already exist |
| `03-master-build-plan.md` | *In what order?* D1–D10 decisions to lock, then Phases 0–5 with exit criteria, cross-cutting rules, non-goals and risks. | planning a sprint, or arguing about sequence |

Still authoritative, unchanged:
- `../REQUIREMENT/platform_architecture_core_auth.md` — the architecture law (§0–§36)
- `../REQUIREMENT/module_author_guide.md` — the per-module golden path

Raw sources (do not mine again unless these docs are insufficient):
- `../recording/*.mov` — 32:20, silent; frame index in `01-…§7`
- `../out/` — a **failed** crawl; see `01-…§8` before spending any time on it
- `/Users/isk/ISK/www/PROJECTS/AI/WORK/WILLIAM/imbrox` — the donor codebase

**Naming.** These are internal design documents and name the reference platform directly, per spec §33.3.
Shipped code, comments, UI and public docs must use the alias **SC** and must never contain a competitor
name — CI enforces it.

**Snapshot date.** Reference product captured 2026-08-02 (Spring '26). Documents written 2026-08-03.
Re-capture before making any parity claim.
