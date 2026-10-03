# Smart Planter: UI handoff

Reference for building the `web` package. The screenshots in `design/screens/` are the visual source of truth for layout. This file holds what screenshots can't show: tokens, routes, states and behaviour. If this file conflicts with `DESIGN.md` on data, the contract or safety limits, `DESIGN.md` wins.

## Screens

| Screenshot | Route | Notes |
|---|---|---|
| Home | `/` | One card per planter: name, preset, real or simulated, status chips, three readouts. "Add planter" opens the instructions screen. |
| Add a planter | `/add` | Instructions only: open the phone camera, scan the QR, tap the link. No in-app scanner. |
| Claim: confirm | `/claim?d=…&t=…` | Shows the planter ID, a name field, a preset select and one Claim button. |
| Claim: done | after claim | Connected and Sensors reporting rows, then per-field sync chips that clear one at a time. |
| Claim: code expired | `/claim` (expired token) | Loud error. A consumed token opens the planter instead of erroring. Unknown device gets a similar error screen (not drawn). |
| Planter detail | `/planters/:id` | Four stacked sections, no tabs: Live, Config, History, Timeline. |

> **Superseded 3 Oct:** the light sensor was cut when the electronics were
> finalised. The artboards still draw a Light level stat card, a lux readout on
> the home cards and a light series in the History chart. The built app has none
> of these — Live has three cards, History has one chart, and there is no
> "too dim" alert. Treat those parts of the canvas as out of date.
| Presets | `/planters/:id/preset` | Grid of built-in presets plus a "Create with AI" card. |
| AI preset builder | `/planters/:id/ai` | Proposal table, amber warning row for anything clamped, rationale, safety checks, Apply and Discard. A carrot-style "unsuitable" card is also drawn. A cached-fallback label ("cached, no network") is not drawn. |
| pH check | `/planters/:id/ph` | Full screen on phone, modal on desktop. Number stepper, scale with target band, advice card. |

### Behaviour the screenshots don't show

- **Config table:** each row shows Wanted, Reported and Status. A row not confirmed within 10 seconds turns amber ("Not confirmed after 10 s") with a Retry button. Fields clear one at a time.
- **Estimated flow** is always labelled as an estimate (`≈ 1.2 L/min (estimated)`).
- **Pump runs on the hour,** matching the firmware (12:00, 16:00, 20:00). "Next run" is derived from that.
- **Alerts** are derived, not stored. One combined list covers connection, water
  level, water temperature, pH and nutrients at three severities: critical (red),
  warning (amber), info (grey). The Live section shows a banner for each, or a
  green "No active alerts" strip.
- **Range toggle** (1 h, 6 h, 24 h) redraws the three stacked charts on one shared time axis.
- **Home cards** show a small syncing or stale chip when a planter has unconfirmed settings. The full desired and reported table is on the detail screen only.

## Tokens

**Colour**

| Role | Value |
|---|---|
| Page background | `#EEF1EA` |
| Card | `#FBFCF9`, border `#D3DACD`, hairline `#E1E6DB` |
| Ink | `#16241B` |
| Muted text | `#55645A` |
| Primary green | `#2F7A4B` (hover `#215A37`) |
| Green chip | bg `#DDEBDD`, text `#1D5A36`, dot `#2F7A4B` |
| Amber chip | bg `#F6E7C8`, text `#7A4E08`, dot `#B7791F` (body text on amber `#3B2704`) |
| Red chip | bg `#F5DAD5`, text `#8C2A1C`, dot `#B3402F` |
| Grey chip | bg `#E3E7DF`, text `#45524A`, dot `#7B887F` |
| AI panel | bg `#E6F0E3`, 2px dashed `#2F7A4B` |

Charts: water temperature in green, pump-run bars in green. (The amber light
series is gone with the sensor.)

**Type:** Bricolage Grotesque (600/700) for headings and readout numbers. Figtree (400/500/600) for everything else, from Google Fonts. Sizes on desktop: page title 44 to 52, section heading 30, readouts 64, card titles 22 to 28, body 16 to 18, small 14 to 15. Home-card readouts are 26.

**Layout:** desktop artboards are 1280 wide with 56px page padding. Phone artboards are 390 wide with 24px padding. Cards have a 1px border, 16px radius and 24 to 28px padding. Grid gaps are 20 to 24. Buttons are 48px tall (52 on phone) with a 12px radius. The primary button is solid green with white text, and the secondary has a 1.5px ink border. Touch targets are at least 44px.

**Chips:** pill shape with an 8 to 9px dot and a text label. Colour is never the only signal.

**Motion:** the per-field sync chips clear one at a time. Respect `prefers-reduced-motion`.

**Copy:** UK English, short plain sentences, no exclamation marks.

## Sample data

Every reading, preset value and event in the screenshots is illustrative. Use the real preset schema and `SAFETY` constants from `DESIGN.md`, not the numbers on screen. Built-in preset values are starting points to tune.

## Not drawn yet

Dev drawer (fault toggles and time-scale slider), presenter mode (larger type, dev drawer hidden), empty state (no planters), and the unknown-device error. Design them to the same tokens and ask if a layout is unclear.
