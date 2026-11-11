import { useEffect, useState } from "react";
import { Piano, AudioLines, Plus, Search } from "lucide-react";
import type { AudioEngine, FoundPlugin } from "./audio/desktop-engine.ts";

type Props = {
  engine: AudioEngine;
  onAdd: (plugin: FoundPlugin, program?: number) => Promise<void>;
  notify: (message: string) => void;
};
export function InstrumentLibrary({ engine, onAdd, notify }: Props) {
  const [plugins, setPlugins] = useState<FoundPlugin[]>([]);
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState("");
  const [programs, setPrograms] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    Promise.allSettled([
      engine.request<FoundPlugin[]>("bundledPlugins"),
      engine.request<FoundPlugin[]>("pluginCatalog"),
    ]).then((results) => {
      if (!active) return;
      const found = results.flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      setPlugins(found.filter((p) => p.instrument));
      setBusy(false);
      for (const r of results)
        if (r.status === "rejected") notify(r.reason.message);
    });
    return () => {
      active = false;
    };
  }, [engine]);
  async function task(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function scan(folder?: string) {
    const found = await engine.request<FoundPlugin[]>(
      "scan",
      folder ? { paths: [folder] } : {},
    );
    setPlugins((previous) => [
      ...previous.filter((p) => p.bundledId),
      ...found.filter((p) => p.instrument),
    ]);
    notify(
      `${found.filter((p) => p.instrument).length} instrumentos VST3 encontrados.`,
    );
  }
  return (
    <section className="instrument-library" aria-label="Biblioteca VST3">
      <h3>Instrumentos VST3</h3>
      <p>Piano, Kick, Triple, FM y Pluck · 40 presets originales incluidos.</p>
      <div className="library-search">
        <Search size={14} />
        <input
          aria-label="Buscar instrumento VST3"
          placeholder="Buscar piano, kick o plugin…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="library-actions">
        <button disabled={busy} onClick={() => void task(() => scan())}>
          Buscar VST3 instalados
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void task(async () => {
              const folder = await window.studioNative?.pickPluginFolder();
              if (folder) await scan(folder);
            })
          }
        >
          Elegir carpeta VST3
        </button>
      </div>
      <div
        className="instrument-options vst-instrument-options"
        aria-busy={busy}
      >
        {plugins
          .filter((p) =>
            `${p.name} ${p.manufacturer}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((p) => (
            <div className="library-instrument" key={p.description}>
              <button
                disabled={busy}
                aria-label={`Añadir ${p.name}`}
                onClick={() => void task(() => onAdd(p, programs[p.name] ?? 0))}
              >
                {p.bundledId === "kick" ? (
                  <AudioLines size={21} />
                ) : (
                  <Piano size={21} />
                )}
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.bundledId
                      ? `${p.category} · ${p.presetNames?.length ?? 0} presets`
                      : p.manufacturer}
                  </small>
                </div>
                <Plus size={16} />
              </button>
              {p.presetNames && (
                <label className="library-preset">
                  Preset
                  <select
                    aria-label={`Preset de ${p.name}`}
                    disabled={busy}
                    value={programs[p.name] ?? 0}
                    onChange={(e) =>
                      setPrograms((previous) => ({
                        ...previous,
                        [p.name]: Number(e.target.value),
                      }))
                    }
                  >
                    {p.presetNames.map((name, index) => (
                      <option key={name} value={index}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ))}
      </div>
      {busy && <p role="status">Preparando instrumentos…</p>}
      <p className="library-note">
        Los VST3 externos se usan desde su carpeta instalada. FL Keys y Fruit
        Kick son plugins nativos de FL Studio y requieren su propio host.
      </p>
    </section>
  );
}
