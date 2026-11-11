export type Equalizer = {
  enabled: boolean;
  low: number;
  mid: number;
  high: number;
  midHz: number;
};
export type Compressor = {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  makeup: number;
};
export type ChannelEffects = { eq: Equalizer; compressor: Compressor };

export const effectRanges = {
  low: [-18, 18, 0.5],
  mid: [-18, 18, 0.5],
  high: [-18, 18, 0.5],
  midHz: [160, 6000, 10],
  threshold: [-60, 0, 0.5],
  ratio: [1, 20, 0.1],
  attack: [0.1, 200, 0.1],
  release: [10, 2000, 10],
  makeup: [0, 24, 0.5],
} as const;

export function defaultChannelEffects(): ChannelEffects {
  return {
    eq: { enabled: false, low: 0, mid: 0, high: 0, midHz: 1000 },
    compressor: {
      enabled: false,
      threshold: -18,
      ratio: 4,
      attack: 10,
      release: 150,
      makeup: 0,
    },
  };
}

export const effectPresets: Record<
  string,
  { name: string; settings: ChannelEffects }
> = {
  neutral: { name: "Sin procesar", settings: defaultChannelEffects() },
  bass: {
    name: "Bajo definido",
    settings: {
      eq: { enabled: true, low: 3, mid: -2, high: 0, midHz: 350 },
      compressor: {
        enabled: true,
        threshold: -20,
        ratio: 4,
        attack: 25,
        release: 180,
        makeup: 2,
      },
    },
  },
  drums: {
    name: "Batería compacta",
    settings: {
      eq: { enabled: true, low: 2, mid: -1.5, high: 2, midHz: 500 },
      compressor: {
        enabled: true,
        threshold: -18,
        ratio: 3,
        attack: 20,
        release: 100,
        makeup: 1,
      },
    },
  },
  gentle: {
    name: "Compresión suave",
    settings: {
      eq: { enabled: false, low: 0, mid: 0, high: 0, midHz: 1000 },
      compressor: {
        enabled: true,
        threshold: -16,
        ratio: 2,
        attack: 30,
        release: 250,
        makeup: 1,
      },
    },
  },
};

export function validateChannelEffects(
  effects: unknown,
): asserts effects is ChannelEffects {
  if (!effects || typeof effects !== "object" || Array.isArray(effects))
    throw new Error("Efectos de canal inválidos.");
  for (const [section, names] of [
    ["eq", ["low", "mid", "high", "midHz"]],
    ["compressor", ["threshold", "ratio", "attack", "release", "makeup"]],
  ] as const) {
    const config = (effects as Record<string, unknown>)[section];
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      typeof (config as Record<string, unknown>).enabled !== "boolean"
    )
      throw new Error("Configuración de efectos de canal inválida.");
    for (const name of names) {
      const value = (config as Record<string, unknown>)[name],
        [min, max] = effectRanges[name];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      )
        throw new Error(`Parámetro de efectos fuera de rango: ${name}.`);
    }
  }
}
