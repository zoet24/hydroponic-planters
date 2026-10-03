# Firmware

ESPHome config for the tower. `esphome.yaml` is the live one;
`esphome.original.yaml` is what the board shipped with, kept for reference.

> **Compiles clean** on ESPHome 2026.9.0 — flash 60.6%, RAM 34.8%. The lambdas
> and component options are therefore verified. What is *not* verified is
> anything needing the physical board: GPIO choices, float-switch polarity, and
> that the sensors are wired where the config says they are.

## What changed from the original

The original scheduled a pump and nothing else. Added here:

- **MQTT**, with `topic_prefix` from a substitution so the planter's identity to
  the app is separate from the ESPHome node name.
- **DS18B20 water temperature** and **BH1750 light level**.
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
   I²C on 6/7, one-wire on 5 and the float switch on 10, with the motor driver
   already on 3/4. Avoid 2, 8 and 9 — they are strapping pins.
3. **Check the float switch polarity on the bench, with a glass of water.** The
   pin is configured `inverted: true`, which assumes the switch closes when the
   float rises. Backwards, the interlock blocks a full tank and permits a dry
   one — and it will look like working code.

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

Compare what appears against the table in DESIGN.md §2. If anything differs,
fix `packages/shared/src/topics.ts` — every topic string in the codebase is
built there, and `topics.firmware.test.ts` cross-checks this file against it.
