# Smart Planter: software brief

I want a loose design (not code yet) for the software side of a small smart hydroponic planter. Please read the whole brief, then produce the design described in the last section. Ask me questions if something is unclear.

## Context

- I'm presenting this to a group of computer science students on **9 October 2026**. The software is the main focus of the talk, so it should be clear, demonstrable and easy to explain on a slide.
- Time is short (about 19 days). Feature freeze around **4 October**, and I'll record a backup demo video before then. Scope decisions should favour simplicity and finishing.
- I'm comfortable with **React, TypeScript and Node**. I'd like TypeScript throughout.
- I'm building the software before the hardware arrives, so a **simulator** is central.
- The demo runs entirely on my laptop. The planter and my phone connect over my phone's hotspot. Don't assume venue Wi-Fi or a cloud deployment.

## The hardware (for context)

A small 3D-printed hydroponic tower, based on an existing open design, with one real unit for the talk.

- **ESP32-C3** running **ESPHome**, powered over USB-C, always on. No deep sleep, so it's reachable live.
- **Sensors:** DS18B20 water temperature, BH1750 light level, and a float switch for low water (a binary signal only, not a level reading).
- **Pump:** a small submersible pump driven by an MX1508 driver with PWM speed. The existing firmware schedules it with two settings: an interval in hours and a runtime in minutes. There's also a master enable and a "run now" switch.
- **pH is manual.** I measure with a pH pen, and the app prompts me to enter the reading.
- **Not in this iteration:** grow-light control, an automatic pH sensor, and a flow sensor.
- Flow ("water pressure") is an **estimate** derived from pump speed via a calibration curve, and should be labelled as an estimate in the UI.

## Three ideas to make visible in the talk

Design so each of these is easy to point at and explain:

1. **Desired versus reported state.** The app sets a configuration and the device confirms when it has applied it. The UI shows "syncing" until they match.
2. **QR claim flow.** Each planter has a QR code carrying its ID and a one-time pairing token. Scanning it claims the device into my app. There's a real security trade-off to discuss.
3. **Deterministic rules with AI at the edges.** The pH advice is a plain rules engine. AI is used only to draft presets, and deterministic code validates them before anything reaches a device.

## Proposed architecture (challenge it if you have a better idea)

```
ESP32 (ESPHome) <-> MQTT broker <-> Node/TS backend (SQLite) <-> WebSocket or SSE <-> React PWA
Simulator (Node) ---^
```

- A TypeScript monorepo with `shared` (zod schemas and types), `backend`, `simulator` and `web` packages.
- Mosquitto as the local MQTT broker.
- SQLite for storage. No accounts or login (single household), and I'll say so in the talk.

## Device contract

The real device uses ESPHome's MQTT integration, so use its default topic layout (state and command topics per entity, plus an online/offline availability topic). I'll provide the `esphome.yaml` so you can align names. The simulator must publish and accept exactly the same topics.

| Entity | Direction | Notes |
|---|---|---|
| Water temperature (°C) | device → app | telemetry |
| Light level (lux) | device → app | telemetry |
| Water OK (float switch) | device → app | binary, low-water alert |
| Pump state and speed (%) | both | speed is settable |
| Pump interval (hours) | both | settable |
| Pump runtime (minutes) | both | settable |
| Pump master enable | both | switch |
| Run pump now | app → device | switch |
| Availability | device → app | online or offline |

## Features

### Must have (the demo spine)

1. **Multi-planter home screen.** One card per planter with name, current plant, and status chips (online, water OK, pH check due).
2. **Live dashboard for one planter.** Water temperature, light level, water OK, pump state, and estimated flow rate, updating in real time.
3. **History charts.** Temperature and light over time, plus pump runs.
4. **Presets.** Pick a preset (basil, mint, lettuce and so on) and push it to the planter as desired state, with the syncing then confirmed indicator.
5. **Manual pH check-in.** The app prompts on a schedule, I enter the reading, and the rules engine returns advice.
6. **Alerts.** Low water, planter offline, water temperature out of range, and light too low for the chosen plant. In-app banners are enough.
7. **QR claim flow.** Scan the planter's QR code on a phone, claim it, and see it appear on the home screen.

### Should have

- Simulated second and third planters that behave like real ones.
- An event timeline (pump ran, preset changed, low water, pH check-in).
- A custom preset editor.
- Installable as a PWA on my phone.

### Stretch: AI preset builder

Someone in the audience names any plant. The app returns a proposed preset for it.

- The backend calls the Claude API (the key stays server-side, never in the browser) and asks for output as JSON matching the preset schema.
- The response is validated against the schema and **hard safety bounds** (pump interval, runtime and speed limits, plausible pH ranges). Out-of-bounds values are rejected or clamped, with a warning shown.
- The model can also return "unsuitable for this system" with a reason (for example root vegetables or trees).
- The UI shows the proposal, including a short rationale from the model, and requires my confirmation before anything is pushed to the planter. It should be labelled AI-suggested.
- Include a **cached fallback**: pre-generate presets for about ten plants, so the demo still works if the network fails.

## Preset schema (loose)

A preset holds:

- name and plant type
- pump: interval hours, runtime minutes, speed percent
- light: minimum lux (used for advice and alerts only)
- water temperature: min and max °C
- pH: target min and max, and a check-in interval in days
- nutrients: a strength multiplier relative to the product label (for example 0.5x or 1x) and a schedule in days. Do not store absolute doses, since those depend on the product.

Starting values, to sanity-check and tune on the real tower: basil pH 5.5 to 6.2, and around 5.5 to 6.5 for mint and lettuce. Illustrative pump example: basil every 4 hours for 3 minutes.

## pH rules engine

A pure function, easy to unit test and easy to show on a slide.

- **Input:** the latest reading, the active preset's pH range, and how old the reading is.
- **Output:** a status (in range, too low, too high), a short piece of advice, and an action (add pH down, add pH up, or none).
- Advice is always small increments, mix, and retest. Never give specific quantities beyond "follow the product label".
- Reject impossible readings and never recommend both directions.
- Nutrient advice comes from the preset's schedule, not from the pH reading.

## QR claim flow

- Each planter has a device ID and a one-time pairing token. The QR code encodes a claim URL containing both.
- Scanning it on a phone opens the app, which claims the device and consumes the token.
- Please propose how the token and ID get onto the device and into the backend registry, and the security trade-offs (single use, expiry, and the fact that a printed QR is a shared secret). This is an open design question I want to discuss in the talk.

## Simulator

A Node script that behaves like N planters: publishes realistic telemetry, accepts the same commands, and reports state back.

- Supports time acceleration.
- Supports injecting faults (low water, sensor dropout, going offline) so I can demonstrate alerts on demand.

## Non-goals

User accounts and login, cloud deployment, native apps, machine-learning anomaly detection, light control, an automatic pH sensor.

## What I want back

A **loose design, not an implementation**:

1. Architecture diagram (Mermaid is fine).
2. MQTT topic and message contract.
3. Data model (SQLite tables).
4. Backend API surface, and the real-time channel to the UI.
5. Shared types and zod schemas outline, including the preset schema and its safety bounds.
6. UI screens at wireframe level.
7. A build order with milestones across the ~19 days, with the feature-freeze date marked, and the AI preset builder scheduled last.
8. Key risks and open questions, especially the QR token design.

Keep it small. If a simpler approach than the one I proposed would serve the demo better, say so.
