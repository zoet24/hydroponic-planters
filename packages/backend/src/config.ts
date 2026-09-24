export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0', // the phone reaches us over the hotspot
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  dbPath: process.env.DB_PATH ?? 'data/planter.db',
  /** Gates the simulator control endpoints. Off in anything resembling production. */
  simEnabled: process.env.SIM_ENABLED !== 'false',
  /** At most one row per planter per metric per this interval. */
  readingThrottleMs: 10_000,
  /** Readings older than this are pruned on startup. */
  readingRetentionDays: 7,
} as const;
