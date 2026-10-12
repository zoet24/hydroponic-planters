# Smart Planter: style guide for presentation slides

Everything here is taken from `packages/web/src/index.css`, which is itself
token-driven from the design canvas. Values are the app's actual values, not
approximations — so a slide built from this file sits next to a screenshot of
the app without clashing.

Where slides genuinely need something the app doesn't have (a title slide, a
dark section break), that is called out as an **extension** rather than quietly
invented.

---

## 1. Fonts

Two typefaces, both SIL Open Font License 1.1 and both on Google Fonts.

| Role | Family | Weights available |
|---|---|---|
| Display — headings, every number | **Bricolage Grotesque** | 600, 700 **only** |
| Body — everything else | **Figtree** | 400, 500, 600 **only** |

Bricolage Grotesque is a quirky, slightly condensed **grotesque sans**, not a
serif. It carries the personality; Figtree is the quiet one.

**Do not** ask for weights outside those lists — the app ships only those
files, and a deck using Figtree 300 or Bricolage 800 will not match. If a
heading needs more presence, make it bigger rather than heavier.

CSS for a deck:

```css
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Figtree:wght@400;500;600&display=swap');

--display: 'Bricolage Grotesque', sans-serif;
--body: 'Figtree', system-ui, sans-serif;
```

Headings are always display, weight 700, with **negative letter-spacing of
-0.02em** and a tight line-height of **1.05–1.1**. Body text is Figtree 400 at
a line-height of 1.45–1.5. Numbers are always display 700 — this is the single
most recognisable thing about the design.

---

## 2. Colour

A warm, desaturated sage palette. Light only — **the app has no dark mode**, so
a dark deck would be an invention.

### Core

| Role | Hex | Notes |
|---|---|---|
| Page background | `#EEF1EA` | Pale sage. Never pure white. |
| Card / surface | `#FBFCF9` | Barely-warm off-white, sits just above the page |
| Card border | `#D3DACD` | 1px |
| Hairline (row dividers) | `#E1E6DB` | 1px, inside cards |
| Ink (all text, dark fills) | `#16241B` | Near-black with a green cast |
| Muted text | `#55645A` | Labels, captions, secondary |
| Primary green | `#2F7A4B` | Buttons, links, accents |
| Primary green hover | `#215A37` | |
| White | `#FFFFFF` | Input fields, chart cards, segmented controls |

The page background and the card are only a few points apart. That low
contrast is deliberate — resist the urge to deepen the background to make
cards "pop".

### Status chips — four sets, each with background, text and dot

| Status | Background | Text | Dot |
|---|---|---|---|
| Green (good) | `#DDEBDD` | `#1D5A36` | `#2F7A4B` |
| Amber (warning) | `#F6E7C8` | `#7A4E08` | `#B7791F` |
| Red (critical) | `#F5DAD5` | `#8C2A1C` | `#B3402F` |
| Grey (unknown) | `#E3E7DF` | `#45524A` | `#7B887F` |

Longer body text on an amber field uses `#3B2704`, and on red `#3B1108` — the
chip text colours are tuned for short labels and go muddy in a paragraph.

### Charts and accents

| Role | Hex |
|---|---|
| Water temperature line, pump bars | `#2F7A4B` (the primary green) |
| pH line | `#6B4FBB` (violet — the one colour outside the sage palette) |
| Nutrient markers | `#8A5A00` |
| Target-range band | primary green at **8% opacity** |
| AI / experimental panel | background `#E6F0E3`, 2px **dashed** `#2F7A4B` |
| Tooltips | `#16241B` background, white text |
| Modal backdrop | `rgb(22 36 27 / 40%)` |

---

## 3. Type scale

Desktop values, in px. The app sizes everything in px from the artboards.

| Element | Size | Family / weight | Detail |
|---|---|---|---|
| Hero number (the signature) | **64** | display 700 | line-height 1, ls -0.02em |
| Unit beside a hero number | 28 | body 600, muted | |
| Page title (h1) | 48 | display 700 | lh 1.05, ls -0.02em |
| Section heading (h2) | 30 | display 700 | |
| Large ID / code | 36 | display 700 | ls **+**0.02em |
| Card title | 26 | display 700 | lh 1.1 |
| Small readout number | 26 | display 700 | |
| Wordmark | 22 | display 700 | ls -0.01em |
| Lede / intro paragraph | 18 | body 400, muted | |
| Table row, list row | 17–20 | body 400 | |
| Body | 16 | body 400 | |
| Label above a stat | 17 | body 500, muted | |
| Chip / pill label | 14–15 | body 600 | |
| Caption, fine print | 13–14 | body 400, muted | |
| Overline tag (uppercase) | 12 | body 700, ls 0.04em, uppercase | |

On a phone, h1 drops to 34 and the hero number to 44. For slides, use the
desktop column or larger.

**Slide extension:** a 16:9 slide at 1920px can carry a title at 72–88px and
still look like this design, as long as it stays display 700 with -0.02em
tracking. Scale the hero number up to 120–160px for a single-statistic slide —
oversized numbers in Bricolage are exactly the house style.

---

## 4. Shape and depth

**Corner radii** — a small, consistent set:

- `999px` — chips, pills, badges
- `16px` — cards, modals, large panels
- `12px` — buttons, inputs, banners, segmented controls
- `10px` — small buttons, icon buttons, tooltips
- `50%` — status dots, timeline dots, hero badges

**Borders** carry the structure, not shadows:

- `1px` — card edges, hairline dividers
- `1.5px` — anything interactive: button outlines, input fields, segmented
  controls. This is the most distinctive measurement in the design.
- `2px` — a selected card, or the dashed AI panel

**Shadows are almost absent.** Only three exist in the whole app:

```css
/* tooltip */    box-shadow: 0 6px 18px rgb(22 36 27 / 22%);
/* drawer */     box-shadow: 0 -8px 24px rgb(22 36 27 / 10%);
/* card ring */  box-shadow: inset 0 0 0 1px #D3DACD;
```

Note the shadow colour is the ink green, never neutral black. **Do not add drop
shadows to slide cards** — flat surfaces with 1px borders is the look.

---

## 5. Spacing

An 8px-ish rhythm, with 4px steps where needed.

| Context | Value |
|---|---|
| Page padding (desktop) | 40px vertical, 56px horizontal |
| Gap between page sections | 32px (44px on the dense detail page) |
| Card padding | 24px (28px for wide data cards) |
| Gap inside a card | 20px |
| Gap within a group (heading → content) | 16px |
| Grid gap between cards | 24px |
| Gap between buttons in a row | 12px |
| Label → value | 10px |
| Chip → chip | 8px |
| Max content width | 1280px |
| Phone screen max width | 460px |

Control heights: buttons **48px** desktop (52px phone), small buttons 40px,
input fields 52px, touch targets never under 44px.

---

## 6. The signature components

If a deck reproduces only three things from this design, make them these.

### The status chip

A pill with a filled dot on the left. Unmissable in every screenshot.

```css
display: inline-flex; align-items: center; gap: 6px;
padding: 4px 12px 4px 10px;   /* note: tighter on the dot side */
border-radius: 999px;
font-size: 14px; font-weight: 600;
/* dot */ width: 8px; height: 8px; border-radius: 50%;
```

The asymmetric padding is intentional — the dot needs less room than the text.

### The stat card

Card surface, 24px padding. Then, stacked with a 10px gap: a 17px muted label,
a **64px display-weight number** with a 28px muted unit beside it, a status
chip, and a 15px muted note underneath. The jump from a small quiet label to an
enormous number is the whole idea.

### The hairline table

No zebra striping, no vertical rules, no outer border on rows. Rows are
separated by a single `1px #E1E6DB` line, 16px of padding above and below, and
the first row has no top border. Column headers are 15px body 600 in muted,
not uppercase.

### Also characteristic

- **Segmented control:** inline-flex, 1.5px ink border, 12px radius, white
  segments divided by 1.5px ink lines; the active segment inverts to ink
  background with white text.
- **Filter tags:** pills with a 1.5px border that invert to ink-on-white when
  active.
- **Numbered step dots:** 32px green-chip circle, display 700 number inside.
- **Hero badge:** 96px circle, solid green with a white icon.

---

## 7. Voice, for slide copy

Worth matching, since the UI copy will be on screen in the screenshots.

- Sentence case everywhere. The only uppercase is the 12px overline tag.
- Plain and specific: "Last seen 2 minutes ago", not "Connectivity status:
  nominal".
- Units always shown and always spaced: `21.4 °C`, `pH 6.1`, `Every 4 h`,
  `≈ 1.2 L/min (estimated)`.
- An estimate is always labelled as one.
- Relative time for recency ("Added 22 h ago"), absolute for records.
- Status words are short: OK, Online, Offline, Overdue, Syncing, Unknown.

---

## 8. Honest caveats

- **No dark mode exists.** If the deck wants dark section breaks, that's a
  deliberate extension — the safest version is ink `#16241B` as the field with
  `#EEF1EA` text and the green lifted to roughly `#4F9E6B` for contrast.
- **The pH violet `#6B4FBB` is the odd one out** and the only non-sage hue.
  It's set in the code as a fallback on an undefined custom property, so treat
  it as data-visualisation colour, not a brand colour. Don't build a slide
  theme on it.
- **There is no icon set documented here.** The app uses small inline SVG
  strokes; no icon library is pinned.
- **No gradients, no glass, no blur** anywhere in the app.
- Presenter mode simply applies `zoom: 1.35` to the whole page, because every
  size is in px. That's why screenshots taken during the demo will look
  slightly larger than these values.

---

## 9. Paste-ready token block

```css
:root {
  /* surfaces */
  --bg:       #EEF1EA;
  --card:     #FBFCF9;
  --border:   #D3DACD;
  --hairline: #E1E6DB;

  /* text */
  --ink:   #16241B;
  --muted: #55645A;

  /* brand */
  --green:       #2F7A4B;
  --green-hover: #215A37;

  /* status */
  --chip-green-bg: #DDEBDD; --chip-green-text: #1D5A36; --chip-green-dot: #2F7A4B;
  --chip-amber-bg: #F6E7C8; --chip-amber-text: #7A4E08; --chip-amber-dot: #B7791F;
  --chip-red-bg:   #F5DAD5; --chip-red-text:   #8C2A1C; --chip-red-dot:   #B3402F;
  --chip-grey-bg:  #E3E7DF; --chip-grey-text:  #45524A; --chip-grey-dot:  #7B887F;

  /* data */
  --series-temp: #2F7A4B;
  --series-ph:   #6B4FBB;
  --series-feed: #8A5A00;

  /* type */
  --display: 'Bricolage Grotesque', sans-serif;  /* 600, 700 only */
  --body:    'Figtree', system-ui, sans-serif;   /* 400, 500, 600 only */

  /* shape */
  --r-pill: 999px;
  --r-card: 16px;
  --r-ctrl: 12px;
  --r-sm:   10px;
}
```
