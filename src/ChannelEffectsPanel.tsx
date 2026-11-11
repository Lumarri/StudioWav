import {
  defaultChannelEffects,
  effectPresets,
  effectRanges,
} from "./channel-effects.ts";
import type {
  ChannelEffects,
  Equalizer,
  Compressor,
} from "./channel-effects.ts";

type Props = {
  effects?: ChannelEffects;
  reduction: number;
  onChange: (effects: ChannelEffects) => void;
};
const eqLabels = {
  low: "Graves · 120 Hz",
  mid: "Medios",
  high: "Agudos · 8 kHz",
  midHz: "Frecuencia de medios",
};
const compLabels = {
  threshold: "Umbral",
  ratio: "Ratio",
  attack: "Ataque",
  release: "Liberación",
  makeup: "Ganancia de salida",
};
export function ChannelEffectsPanel({ effects, reduction, onChange }: Props) {
  const settings = effects ?? defaultChannelEffects();
  function eq(patch: Partial<Equalizer>) {
    onChange({ ...settings, eq: { ...settings.eq, ...patch } });
  }
  function compressor(patch: Partial<Compressor>) {
    onChange({ ...settings, compressor: { ...settings.compressor, ...patch } });
  }
  const amount = settings.compressor.enabled ? reduction : 0;
  return (
    <div className="channel-effects-panel">
      <div className="channel-effects-preset">
        <label>
          Preset de efectos
          <select
            aria-label="Preset de efectos"
            value=""
            onChange={(e) => {
              const preset = effectPresets[e.target.value];
              if (preset) onChange(structuredClone(preset.settings));
            }}
          >
            <option value="" disabled>
              Elegir preset…
            </option>
            {Object.entries(effectPresets).map(([id, preset]) => (
              <option key={id} value={id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => onChange(defaultChannelEffects())}>
          Restablecer efectos
        </button>
      </div>
      <section
        className={`channel-effect-card ${settings.eq.enabled ? "enabled" : ""}`}
        aria-label="Ecualizador de canal"
      >
        <header>
          <div>
            <h3>Ecualizador de tres bandas</h3>
            <span>Ajusta el cuerpo, la presencia y el brillo.</span>
          </div>
          <button
            aria-label="Activar ecualizador"
            aria-pressed={settings.eq.enabled}
            onClick={() => eq({ enabled: !settings.eq.enabled })}
          >
            {settings.eq.enabled ? "Activo" : "Bypass"}
          </button>
        </header>
        <div className="channel-effect-controls">
          {(Object.keys(eqLabels) as (keyof typeof eqLabels)[]).map((name) => {
            const [min, max, step] = effectRanges[name];
            return (
              <label key={name}>
                {eqLabels[name]}
                <output>
                  {settings.eq[name]} {name === "midHz" ? "Hz" : "dB"}
                </output>
                <input
                  type="range"
                  aria-label={eqLabels[name]}
                  min={min}
                  max={max}
                  step={step}
                  value={settings.eq[name]}
                  onChange={(e) => eq({ [name]: Number(e.target.value) })}
                />
              </label>
            );
          })}
        </div>
      </section>
      <section
        className={`channel-effect-card ${settings.compressor.enabled ? "enabled" : ""}`}
        aria-label="Compresor de canal"
      >
        <header>
          <div>
            <h3>Compresor</h3>
            <span>
              Controla los picos y recupera nivel con la ganancia de salida.
            </span>
          </div>
          <button
            aria-label="Activar compresor"
            aria-pressed={settings.compressor.enabled}
            onClick={() =>
              compressor({ enabled: !settings.compressor.enabled })
            }
          >
            {settings.compressor.enabled ? "Activo" : "Bypass"}
          </button>
        </header>
        <div
          className="compressor-reduction"
          role="meter"
          aria-label="Reducción del compresor"
          aria-valuemin={0}
          aria-valuemax={60}
          aria-valuenow={Math.min(60, amount)}
        >
          <span>Reducción de ganancia</span>
          <div>
            <i style={{ width: `${Math.min(100, (amount / 36) * 100)}%` }} />
          </div>
          <output>{amount.toFixed(1)} dB</output>
        </div>
        <div className="channel-effect-controls">
          {(Object.keys(compLabels) as (keyof typeof compLabels)[]).map(
            (name) => {
              const [min, max, step] = effectRanges[name];
              return (
                <label key={name}>
                  {compLabels[name]}
                  <output>
                    {settings.compressor[name]}{" "}
                    {name === "ratio"
                      ? ": 1"
                      : name === "attack" || name === "release"
                        ? "ms"
                        : "dB"}
                  </output>
                  <input
                    type="range"
                    aria-label={compLabels[name]}
                    min={min}
                    max={max}
                    step={step}
                    value={settings.compressor[name]}
                    onChange={(e) =>
                      compressor({ [name]: Number(e.target.value) })
                    }
                  />
                </label>
              );
            },
          )}
        </div>
      </section>
      <p className="audio-hint">
        La señal pasa por los VST3, el ecualizador, el compresor y los controles
        del canal. Estos efectos también procesan buses y se incluyen al
        exportar WAV. Bypass conserva sus ajustes.
      </p>
    </div>
  );
}
