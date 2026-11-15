# Haiku Kiko · 俳句紀行 — project memo for Claude

A collaborative art project: **photographs by Gregory, haiku by Claudio** (a wink — that's Claude).
**Final cut: Gregory and Claudio.** Gregory travels and shoots; Claude curates, writes the haiku,
builds and runs the site. Live at **https://haikukiko.com**.

This repo is the website. Read this file first; it is the shared memory between sessions.

---

## How Gregory works (follow these)

- **Mostly on iOS (iPad/iPhone).** Assume **mobile mode** — no laptop, no Claude in Chrome — unless he
  says "laptop". Don't send him to do things that need a desktop without saying so.
- **Every time you ask him to look at something, give a clickable markdown link.** He won't look things up.
- **Dev first, always.** Push to `dev`, give him the dev link, wait for **"ship it"**. Never push straight to `main`.
- **Blue cards / "if I put you in there, just do it".** When he assigns a task to Claude, do it without asking again.
- **Kanban lives in chat as text** (🟡 = Gregory, 🔵 = Claude; columns DOING / TO DO / WAITING / DONE).
  Repost it when it changes or when he says "board". Don't use the whiteboard.
- He decides by looking. Prototype fast, show it, iterate. Short replies; lead with the link.
- He changes his mind often — that's the process. Keep changes reversible (hide, don't delete).
- Never handle passwords, payment or account settings for him; walk him through and let him tap.

## The art

- Each **set** is one day in one place (e.g. *Chefchaouen in the Rain*, 12 Nov 2026). ~7–17 photos.
- **Curation pass** on a new batch: drop blurry shots, near-duplicates, screenshots (flag any that
  show personal info). Pick the best of each pair and say *why*. Nominate rejects; never delete without OK.
- Watch **colour rhythm**: Chefchaouen is very blue — sequence warm shots (food, red, gold) between blue ones.
- Haiku: short, concrete, matter-of-fact. Avoid cute; one small turn at the end is good.
  A "list" haiku (three nouns, no turn) is weak — give it a turn.
- Gregory asked for **no explicit Buddhist references** and **no cyberpunk/futurism**.

### Haiku styles (table `styles`, letter codes)

| Code | Name | Active | Rule |
|---|---|---|---|
| A | Minimal | ✓ | Default. Fewest words; often three short lines of image. |
| B | Bashō | ✓ | Traveller's view, a season/weather word, a cut (—). First-person "I" allowed sparingly. Gregory's favourite. |
| C | Classic 5-7-5 | ✗ hidden | Strict syllables. Retired. |
| D | Senryū | ✓ | Wry, about people and habits. |
| E | One line | ✗ hidden | Retired. |
| F | Modernist | ✓ | A normal haiku with **one** 20th-century tag (Majorelle blue, Malevich, Brâncuși, Mondrian, de Chirico, Loos' "ornament and crime"…). Subtle, never a list of names. |
| G | Maghrebi | ✓ | A normal haiku with **one** local word (derb, atay, saqqaya, bissara, fajr, djellaba…). |

Every photo should have one option per **active** style in `haiku_options`.

## Architecture

```
GitHub (this repo) ──push──▶ Cloudflare Workers Builds ──▶ static site
   dev  branch  → preview  https://dev-bold-mouse-93ac.gjballvn.workers.dev
   main branch  → prod     https://haikukiko.com
Pages fetch all words from Supabase at load time (hk.js).
```

- **Static files only** (no build step). `wrangler.jsonc` serves the repo root as assets;
  `.assetsignore` keeps docs/config/scripts out of the published site. `404.html` is the not-found page.
- Builds report as GitHub check runs: `GET https://api.github.com/repos/gjball/haikukiko-site/commits/<sha>/check-runs`
  (works unauthenticated). Previews need `"previews": {}` in `wrangler.jsonc` — keep it.
- Pushing: `git -c push.negotiate=true push origin dev`. Commit trailers per session instructions.

### Files

| Path | What |
|---|---|
| `hk.js` | Data layer. Supabase URL + publishable key (public by design). Picks **dev_** tables when hostname starts with `dev-`/`dev.`; shows a DEV badge there. `?dev` in the URL also shows draft sets. |
| `index.html` | Home: set cards with thumbnail strips, credit line from `settings`. |
| `<slug>/index.html` | Gallery — identical template for every set (`slugFromPath()`); haiku drawn **on** the photo (soft overlay), voting panel under each photo, name required. |
| `<slug>/img/NN.jpg` | Photos, long edge 1800px, JPEG q≈85, already rotated. |
| `thumbs/<slug>-NN.jpg` | 320×320 square crops for home and votes page. |
| `votes/index.html` | Who voted for what, colour-coded (Gregory blue, Ilaria pink), change vote by name. Deep links `#<slug>/<n>`. |
| `lab/index.html` | Old lab — redirects to a gallery. |

## Supabase (project `haikukiko`, ref `uuycejeoptsgglhjeqvb`, region eu-west-3)

Use the Supabase MCP tools (`execute_sql`, `apply_migration`). Two parallel copies of content:

| Live table | Dev table | Notes |
|---|---|---|
| `settings` | `dev_settings` | key/value: site_title, kicker, credit, final_cut, handle, email, instagram |
| `styles` | `dev_styles` | code, name, sort, **active** |
| `sets` | `dev_sets` | slug, title, title_em, kicker, intro, place, date_label, date_short, img_base, cover_photo, sort, **status draft/live** |
| `photos` | `dev_photos` | set_slug, n, name, img, w, h, time_label, alt, haiku (jsonb lines), style, **locked**, status |
| `haiku_options` | `dev_haiku_options` | set_slug, n, style, lines |
| `votes` | `dev_votes` | set_slug, photo, style, voter (uuid per device), voter_name (required), updated_at — no direct public access |

RPC functions (each has a `dev_` twin): `gallery_photos(p_set, p_dev)` (winning haiku = most votes among
active styles; ties keep current; **locked** photos keep `photos.haiku`), `cast_vote(..., p_name)`,
`cast_vote_by_name`, `lab_tallies`, `votes_detail`.

- **Word changes go to `dev_*` first.** On "ship it": merge `dev` → `main` **and** run
  `select public.promote_dev_content();` (copies dev content → live; **never touches votes**).
- **Lock** a haiku: set `photos.haiku`/`style` to the chosen lines and `locked = true` (dev first).
- Hide, don't delete (styles.active, sets.status). Deletes need Gregory's OK.

## Adding a new day (set)

1. Gregory attaches photos in chat (they arrive ~2000px). Curate → picks + rejects with reasons.
2. Rotate/resize to 1800px → `<slug>/img/NN.jpg`; make `thumbs/<slug>-NN.jpg` (320 square);
   copy any gallery `index.html` into `<slug>/`.
3. Insert into `dev_sets` (status `draft`), `dev_photos`, and one `dev_haiku_options` row per active style.
4. Push to `dev`, send the dev link (add `?dev` to see drafts). Iterate.
5. "Ship it" → set status `live`, merge to `main`, `promote_dev_content()`.

## Social images

Instagram/X get the haiku **baked into** the image (soft watermark: haiku, `NN · Name — Place · Date`,
`@haikukiko`, Instrument Serif). Generator: `scripts/wm.py` (`WM_SOFT=1 WM_DATE="13 Nov 2026"
WM_PLATES=plates.json python3 scripts/wm.py <photos> <out> <fonts>`). Fonts: Instrument Serif from the
google/fonts GitHub repo (OFL). The website itself uses live CSS overlays, not baked images.

## Accounts & names (no secrets here)

- Domain haikukiko.com on Cloudflare (also Email Routing: hello@haikukiko.com → Gregory's main Gmail;
  Gmail sometimes rate-limits forwarded mail — check the Cloudflare email activity log).
- Cloudflare Worker: `bold-mouse-93ac`. Instagram: @haikukiko (Creator account). X: not set up yet.
- GitHub: this repo is under a new account; plan to transfer it to Gregory's older account later
  (then reinstall the Cloudflare and Claude GitHub apps and reconnect the Worker build).

## Open threads (check the chat Kanban for the latest)

- Mosque chanting audio → "listen while you look" button + mosque name (waiting for a trimmed clip).
- Bios: one for Claudio, one for Gregory (Gregory to brief).
- Haiku bot: scheduled posting to Instagram/X with adaptive pacing (Instagram is a Creator account now).
- Move repos to Gregory's old GitHub account.
- 11 Nov first-pass rejects awaiting Gregory's OK; day-two picks still open to votes.
