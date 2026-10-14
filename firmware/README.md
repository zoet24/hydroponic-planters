# Firmware

ESPHome config for the tower. `esphome.yaml` is the live one;
`esphome.original.yaml` is what the board shipped with, kept for reference.

> **Verified on hardware** (ESPHome 2026.9.0, flash 60.6%, RAM 34.8%). Flashed
> and run on the real tower: the temperature probe reads, the float switch and
> interlock behave, and the pump moves water. The pin assignments below reflect
> that build, including the deliberate motor-pin swap.

## What changed from the original

The original scheduled a pump and nothing else. Added here:

- **MQTT**, with `topic_prefix` from a substitution so the planter's identity to
  the app is separate from the ESPHome node name.
- **DS18B20 water temperature**.
- **Float switch** as `Water OK`, with a low-water interlock that refuses to
  start the pump *and* cuts a run already in progress.
- **Pump Enable** master switch, and a **Pump Blocked** sensor so the interlock
  is visible in the app rather than inferred.
- **Wi-Fi station credentials** — the original was access-point only and could
  never have joined your hotspot.
- The interval number now **publishes back the value it snapped to**. It was
  reporting the requested value while running a different schedule.

Two removals worth knowing about:

- **`api:` is gone.** It reboots the board after 15 minutes with no API client
  connected, and nothing connects to it now that the app speaks MQTT.
- **`mqtt.reboot_timeout: 0s`** — the broker is a laptop and will be restarted
  often. Rebooting the board does not help and costs several seconds.

## Before you flash

1. `cp secrets.yaml.example secrets.yaml` and fill it in.
2. **Confirm the GPIOs against your ESP32-C3 Super Mini pinout.** The config uses
   one-wire on 5, the float switch on 10 and the motor driver on 3/4. Avoid 2, 8
   and 9 — they are strapping pins.
3. **Check the float switch polarity on the bench, with a glass of water.** The
   pin is **not** inverted. The switch sits between GPIO10 and ground, so water
   present leaves it open, the internal pull-up reads HIGH, and ESPHome publishes
   that as ON. Wire it the other way and the interlock blocks a full tank and
   permits a dry one — and it will look like working code.
4. **Expect to check the pump direction.** GPIO03 and GPIO04 are swapped in the
   `output:` block relative to the obvious reading of the wiring, because the
   motor leads are reversed at the driver on this build. If yours hums without
   moving water, swap them back.

## Commands

ESPHome needs Python 3.11 or newer.

```bash
pipx install esphome
```

```bash
esphome compile firmware/esphome.yaml
```

```bash
esphome run firmware/esphome.yaml
```

## Verify the topics against the real board

The topic names are verified against the ESPHome 2026.9.0 source — including
that text sensors publish under `sensor/`, not `text_sensor/`, and that the
fan's speed sub-topic is `speed_level`. Still worth one look, because none of
that proves the board flashed and wired up correctly.

```bash
mosquitto_sub -h localhost -v -t 'planter-001/#'
```

Compare what appears against `packages/shared/src/topics.ts` — every topic
string in the codebase is built there, and `topics.firmware.test.ts`
cross-checks this file against it.
