import { Activity, GitBranch, Plug } from "lucide-react";
import type { AudioEngine } from "./audio/desktop-engine.ts";
import type { Project, Track } from "./model.ts";

export function MixerEffects({
  track,
  project,
  engine,
  onPlugins,
  onRouting,
  onBypass,
  notify,
}: {
  track: Track;
  project: Project;
  engine: AudioEngine;
  onPlugins: () => void;
  onRouting: () => void;
  onBypass: (index: number) => void;
  notify: (message: string) => void;
}) {
  return (
    <aside className="mixer-effects" aria-label={`Efectos de ${track.name}`}>
      <div className="mixer-effects-title">
        <Plug size={12} />
        <strong>{track.name}</strong>
        <span>FX</span>
      </div>
      <button className="mixer-route" onClick={onRouting}>
        <GitBranch size={12} />
        <span>
          Salida:{" "}
          {project.tracks.find((t) => t.id === track.outputId)?.name ??
            "Master"}
        </span>
      </button>
      <div className="mixer-effect-slots">
        {Array.from({ length: 8 }, (_, index) => {
          const plugin = track.plugins?.[index];
          return (
            <div
              className={`mixer-effect-slot ${plugin ? "loaded" : ""}`}
              key={plugin?.id ?? index}
            >
              <span>{index + 1}</span>
              <button
                aria-label={
                  plugin
                    ? `Abrir efecto ${plugin.name}`
                    : `Añadir efecto en ranura ${index + 1}`
                }
                onClick={async () => {
                  if (!plugin) {
                    onPlugins();
                    return;
                  }
                  try {
                    await engine.request("editor", {
                      trackId: track.id,
                      pluginId: plugin.id,
                    });
                  } catch (error) {
                    notify(
                      error instanceof Error
                        ? error.message
                        : "No se pudo abrir el efecto.",
                    );
                  }
                }}
              >
                {plugin?.name ?? `Ranura ${index + 1}`}
              </button>
              <button
                className={`effect-led ${plugin && !plugin.bypassed ? "on" : ""}`}
                disabled={!plugin}
                aria-label={`Activar efecto ${index + 1}`}
                aria-pressed={Boolean(plugin && !plugin.bypassed)}
                onClick={() => onBypass(index)}
              />
            </div>
          );
        })}
      </div>
      <div className="mixer-response">
        <Activity size={12} />
        <span>Filtro · {(track.cutoff / 1000).toFixed(1)} kHz</span>
        <svg viewBox="0 0 180 50" aria-hidden="true">
          <path
            d={`M0 10 H${(track.cutoff / 20000) * 125 + 10} Q${(track.cutoff / 20000) * 125 + 25} 10 ${(track.cutoff / 20000) * 125 + 40} 45 H180`}
          />
        </svg>
      </div>
      <button className="mixer-route" onClick={onRouting}>
        Rutas, envíos y compensación →
      </button>
    </aside>
  );
}
