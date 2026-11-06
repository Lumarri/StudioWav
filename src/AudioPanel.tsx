import { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  SlidersHorizontal,
  Mic,
  Plug,
  GitBranch,
  Activity,
} from "lucide-react";
import type {
  AudioEngine,
  DeviceList,
  FoundPlugin,
} from "./audio/desktop-engine.ts";
import {
  createTrack,
  emptyPattern,
  id,
  validateMixer,
  clamp,
} from "./model.ts";
import type { Project, Track, Mode, AutomationTarget } from "./model.ts";
import { SampleEditor } from "./SampleEditor.tsx";
import { insertPlugin, isPluginInstrument } from "./plugins.ts";

type Props = {
  initialTab?: "devices" | "routing" | "plugins" | "automation" | "sample";
  engine: AudioEngine;
  project: Project;
  track: Track;
  mode: Mode;
  patternId: string;
  step: number;
  onChange: (p: Project) => void;
  notify: (message: string) => void;
  onClose: () => void;
  onRecord: (data: string) => Promise<void>;
};
const ranges: Record<AutomationTarget, [number, number, number]> = {
  gain: [0, 1, 0.01],
  pan: [-1, 1, 0.01],
  cutoff: [80, 20000, 10],
  send: [0, 0.6, 0.01],
};
const labels: Record<AutomationTarget, string> = {
  gain: "Volumen",
  pan: "Panorama",
  cutoff: "Filtro",
  send: "Envío al delay",
};
export function AudioPanel({
  initialTab = "devices",
  engine,
  project,
  track,
  mode,
  patternId,
  step,
  onChange,
  notify,
  onClose,
  onRecord,
}: Props) {
  const [tab, setTab] = useState<
    "devices" | "routing" | "plugins" | "automation" | "sample"
  >(initialTab);
  const [devices, setDevices] = useState<DeviceList | null>(null);
  const [settings, setSettings] = useState({
    type: "",
    output: "",
    input: "",
    sampleRate: 48000,
    bufferSize: 256,
  });
  const [busy, setBusy] = useState(false),
    [plugins, setPlugins] = useState<FoundPlugin[]>([]),
    [source, setSource] = useState("input");
  const [parameterPlugin, setParameterPlugin] = useState(""),
    [parameters, setParameters] = useState<
      {
        index: number;
        name: string;
        value: number;
        text: string;
        label: string;
      }[]
    >([]);
  const [, tick] = useState(0);
  const [target, setTarget] = useState<AutomationTarget>("gain");
  const [pointStep, setPointStep] = useState(0);
  const [pointValue, setPointValue] = useState(track.gain);
  const mounted = useRef(true);
  const discovery = useRef(0);
  const status = engine.status;
  async function task(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh() {
    await engine.request("init");
    const d = await engine.request<DeviceList>("devices");
    if (mounted.current) {
      setDevices(d);
      setSettings({
        type: d.type,
        output: d.output,
        input: d.input,
        sampleRate: d.sampleRate || 48000,
        bufferSize: d.bufferSize || 256,
      });
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (engine.native) void task(refresh);
    const timer = setInterval(() => tick((n) => n + 1), 150);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (tab !== "plugins" || !engine.native) return;
    let active = true;
    const generation = ++discovery.current;
    void Promise.allSettled([
      engine.request<FoundPlugin[]>("bundledPlugins"),
      engine.request<FoundPlugin[]>("pluginCatalog"),
    ]).then((results) => {
      if (!active || generation !== discovery.current) return;
      setPlugins(
        results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
      );
      for (const result of results)
        if (result.status === "rejected") notify(result.reason.message);
    });
    return () => {
      active = false;
    };
  }, [tab, engine]);
  function edit(change: (p: Project, t: Track) => void) {
    try {
      const next = structuredClone(project);
      change(next, next.tracks.find((t) => t.id === track.id)!);
      validateMixer(next);
      onChange(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }
  async function accepted(change: (p: Project, t: Track) => void) {
    const next = structuredClone(project);
    change(next, next.tracks.find((t) => t.id === track.id)!);
    validateMixer(next);
    await engine.update(next, mode, patternId);
    onChange(next);
  }
  const selectedType = devices?.types.find((t) => t.name === settings.type);
  const points = track.automation?.[target] ?? [];
  const [min, max, increment] = ranges[target];
  return (
    <div className="modal-backdrop audio-backdrop" onClick={onClose}>
      <section
        className="audio-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Estudio de audio"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">STUDIOWAV · AUDIO</span>
            <h2>Tu estudio, conectado</h2>
          </div>
          <button aria-label="Cerrar estudio de audio" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <nav className="audio-tabs">
          {(
            [
              ["devices", "Dispositivos", Mic],
              ["routing", "Rutas y buses", GitBranch],
              ["plugins", "Efectos VST3", Plug],
              ["automation", "Automatización", Activity],
              ["sample", "Muestras", SlidersHorizontal],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
        <div className="audio-panel-body" aria-busy={busy}>
          {status.warning && (
            <p className="audio-hint" role="alert">
              {status.warning}
            </p>
          )}
          {tab === "devices" && (
            <>
              <div className="audio-stats">
                <span>
                  <b>{engine.native ? "NATIVO" : "WEB AUDIO"}</b>
                  {status.device || "Salida del sistema"}
                </span>
                <span>
                  <b>
                    {status.sampleRate
                      ? `${status.sampleRate / 1000} kHz`
                      : "—"}
                  </b>
                  {status.bufferSize || "—"} muestras
                </span>
                <span>
                  <b>{((status.cpu ?? 0) * 100).toFixed(1)}% CPU</b>
                  {status.overruns ?? 0} bloques perdidos / tarde
                </span>
                <span>
                  <b>
                    {status.sampleRate
                      ? (
                          (((status.inputLatency ?? 0) +
                            (status.outputLatency ?? 0)) /
                            status.sampleRate) *
                          1000
                        ).toFixed(1)
                      : "—"}{" "}
                    ms
                  </b>
                  Entrada + salida
                </span>
              </div>
              {!engine.native ? (
                <p className="audio-hint">
                  Abre StudioWav para Windows para seleccionar ASIO/WASAPI,
                  grabar entradas, conectar MIDI y cargar VST3.
                </p>
              ) : (
                <>
                  <div className="audio-form-grid">
                    <label>
                      Controlador
                      <select
                        aria-label="Controlador de audio"
                        disabled={busy || status.recording}
                        value={settings.type}
                        onChange={(e) => {
                          const type = devices?.types.find(
                            (t) => t.name === e.target.value,
                          );
                          setSettings({
                            ...settings,
                            type: e.target.value,
                            output: type?.outputs[0] ?? "",
                            input: "",
                          });
                        }}
                      >
                        {devices?.types.map((t) => (
                          <option key={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Salida
                      <select
                        aria-label="Salida de audio"
                        value={settings.output}
                        onChange={(e) =>
                          setSettings({ ...settings, output: e.target.value })
                        }
                      >
                        {selectedType?.outputs.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Entrada
                      <select
                        aria-label="Entrada de audio"
                        value={settings.input}
                        onChange={(e) =>
                          setSettings({ ...settings, input: e.target.value })
                        }
                      >
                        <option value="">Sin entrada</option>
                        {selectedType?.inputs.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Frecuencia
                      <select
                        aria-label="Frecuencia de muestreo"
                        value={settings.sampleRate}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sampleRate: +e.target.value,
                          })
                        }
                      >
                        {[
                          ...new Set([
                            44100,
                            48000,
                            88200,
                            96000,
                            ...(devices?.sampleRates ?? []),
                          ]),
                        ]
                          .sort((a, b) => a - b)
                          .map((n) => (
                            <option key={n} value={n}>
                              {n} Hz
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Búfer
                      <select
                        aria-label="Tamaño de búfer"
                        value={settings.bufferSize}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            bufferSize: +e.target.value,
                          })
                        }
                      >
                        {[
                          ...new Set([
                            64,
                            128,
                            256,
                            512,
                            1024,
                            2048,
                            ...(devices?.bufferSizes ?? []),
                          ]),
                        ]
                          .sort((a, b) => a - b)
                          .map((n) => (
                            <option key={n} value={n}>
                              {n} muestras
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      MIDI
                      <select
                        aria-label="Entrada MIDI"
                        value={devices?.midiDevice ?? ""}
                        onChange={(e) =>
                          void task(async () => {
                            await engine.request("midi", {
                              deviceId: e.target.value,
                            });
                            await refresh();
                          })
                        }
                      >
                        <option value="">Desconectado</option>
                        {devices?.midiInputs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="audio-actions">
                    <button
                      className="primary"
                      disabled={busy || status.recording}
                      onClick={() =>
                        void task(async () => {
                          await engine.request("configure", settings);
                          await refresh();
                          notify("Dispositivo de audio actualizado.");
                        })
                      }
                    >
                      Aplicar dispositivo
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void task(async () => {
                          await engine.request("controlPanel");
                        })
                      }
                    >
                      Panel del controlador
                    </button>
                    <button onClick={() => void task(refresh)} disabled={busy}>
                      Actualizar dispositivos
                    </button>
                  </div>
                  <p className="audio-hint">
                    Los nombres y tamaños disponibles dependen del controlador
                    instalado. La compensación del mezclador es de{" "}
                    {status.pdcSamples ?? 0} muestras; la latencia del
                    dispositivo se muestra por separado.
                  </p>
                  <div className="record-card">
                    <div>
                      <h3>Grabar audio</h3>
                      <p>
                        {status.recording
                          ? `Grabando · ${(status.recordedSeconds ?? 0).toFixed(1)} s`
                          : "La toma se añadirá como una muestra en una pista nueva."}
                      </p>
                    </div>
                    <select
                      aria-label="Fuente de grabación"
                      disabled={status.recording}
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="input">Entrada / micrófono</option>
                      <option value="master">Mezcla master</option>
                    </select>
                    <button
                      className={
                        status.recording ? "recording-button" : "primary"
                      }
                      disabled={busy}
                      onClick={() =>
                        void task(async () => {
                          if (status.recording) {
                            const r = await engine.request<{
                              data: string | null;
                              drops: number;
                              warning?: string;
                            }>("recordStop");
                            if (r.data) {
                              await onRecord(r.data);
                              notify(
                                r.drops
                                  ? "Toma guardada; hubo bloques perdidos durante la grabación."
                                  : "Toma grabada y añadida al proyecto.",
                              );
                            } else
                              notify(
                                r.warning ??
                                  "La toma se conserva en tus grabaciones.",
                              );
                          } else {
                            await engine.prepare(project);
                            await engine.request("recordStart", { source });
                          }
                        })
                      }
                    >
                      <Mic size={15} />
                      {status.recording ? "Finalizar toma" : "Grabar"}
                    </button>
                  </div>
                  <p className="audio-hint">
                    También se conserva el WAV original de cada toma.{" "}
                    <button
                      onClick={() => void window.studioNative?.openRecordings()}
                    >
                      Abrir grabaciones
                    </button>
                  </p>
                  <label className="audio-check">
                    <input
                      type="checkbox"
                      checked={Boolean(track.monitorInput)}
                      onChange={(e) =>
                        edit((_p, t) => {
                          t.monitorInput = e.target.checked;
                        })
                      }
                    />
                    Escuchar la entrada en {track.name} (usa auriculares)
                  </label>
                  <div className="input-meter">
                    <span
                      style={{
                        width: `${Math.min(1, status.inputLevel ?? 0) * 100}%`,
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}
          {tab === "routing" && (
            <>
              <div className="audio-section-heading">
                <div>
                  <span className="eyebrow">CANAL SELECCIONADO</span>
                  <h3>{track.name}</h3>
                </div>
                <button
                  disabled={project.tracks.length >= 32}
                  onClick={() =>
                    edit((p) => {
                      const bus = createTrack("keys");
                      bus.name = `Bus ${p.tracks.filter((t) => t.kind === "bus").length + 1}`;
                      bus.kind = "bus";
                      bus.color = "#70c0ff";
                      bus.send = 0;
                      p.tracks.push(bus);
                      for (const pattern of p.patterns)
                        pattern.channels[bus.id] = {
                          steps: Array(pattern.length).fill(0),
                          notes: [],
                        };
                    })
                  }
                >
                  <Plus size={14} />
                  Añadir bus
                </button>
              </div>
              <div className="audio-form-grid">
                <label>
                  Salida principal
                  <select
                    aria-label="Salida del canal"
                    value={track.outputId ?? "master"}
                    onChange={(e) =>
                      edit((_p, t) => {
                        t.outputId = e.target.value;
                      })
                    }
                  >
                    <option value="master">Master</option>
                    {project.tracks
                      .filter((t) => t.id !== track.id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.kind === "bus" ? " · Bus" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Retardo del canal (muestras)
                  <input
                    aria-label="Retardo del canal"
                    type="number"
                    min="0"
                    max="96000"
                    step="1"
                    value={track.delaySamples ?? 0}
                    onChange={(e) =>
                      edit((_p, t) => {
                        t.delaySamples = Math.round(
                          clamp(+e.target.value, 0, 96000),
                        );
                      })
                    }
                  />
                </label>
              </div>
              <p className="audio-hint">
                El retardo se aplica al audio de este canal. El motor nativo
                alinea automáticamente las rutas usando ese retardo y la
                latencia declarada por los VST3. Los envíos se toman después del
                volumen y el panorama.
              </p>
              <h3>Envíos a otros canales</h3>
              {(track.sends ?? []).map((send, index) => (
                <div className="send-row" key={send.trackId}>
                  <span>
                    {project.tracks.find((t) => t.id === send.trackId)?.name}
                  </span>
                  <input
                    aria-label={`Nivel del envío ${index + 1}`}
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={send.gain}
                    onChange={(e) =>
                      edit((_p, t) => {
                        t.sends![index].gain = +e.target.value;
                      })
                    }
                  />
                  <b>{Math.round(send.gain * 100)}%</b>
                  <button
                    aria-label={`Eliminar envío ${index + 1}`}
                    onClick={() =>
                      edit((_p, t) => {
                        t.sends = t.sends?.filter((_, i) => i !== index);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <label className="add-send">
                Añadir envío
                <select
                  aria-label="Nuevo envío"
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      edit((_p, t) => {
                        t.sends = [
                          ...(t.sends ?? []),
                          { trackId: e.target.value, gain: 0.25 },
                        ];
                      });
                  }}
                >
                  <option value="">Selecciona un canal…</option>
                  {project.tracks
                    .filter(
                      (t) =>
                        t.id !== track.id &&
                        !track.sends?.some((s) => s.trackId === t.id),
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="routing-list">
                {project.tracks.map((t) => (
                  <div key={t.id}>
                    <i style={{ background: t.color }} />
                    <span>{t.name}</span>
                    <span>→</span>
                    <b>
                      {project.tracks.find((dest) => dest.id === t.outputId)
                        ?.name ?? "Master"}
                    </b>
                    {t.kind === "bus" && <small>BUS</small>}
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "plugins" && (
            <>
              <div className="audio-section-heading">
                <div>
                  <span className="eyebrow">CADENA DE EFECTOS</span>
                  <h3>{track.name}</h3>
                </div>
                <span>
                  {(track.plugins ?? []).length}/8 ranuras ·{" "}
                  {status.trackLatencies?.[track.id] ?? 0} muestras
                </span>
              </div>
              {!engine.native && (
                <p className="audio-hint">
                  Los VST3 se cargan en la aplicación de Windows.
                </p>
              )}
              {(track.plugins ?? []).map((slot, index) => (
                <div className="plugin-slot" key={slot.id}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{slot.name}</strong>
                    <small>{slot.bypassed ? "Desactivado" : "Activo"}</small>
                  </div>
                  <button
                    disabled={!engine.native || busy}
                    onClick={() =>
                      void task(async () => {
                        await engine.request("editor", {
                          trackId: track.id,
                          pluginId: slot.id,
                        });
                      })
                    }
                  >
                    Abrir
                  </button>
                  <button
                    aria-pressed={!slot.bypassed}
                    disabled={busy}
                    onClick={() =>
                      void task(() =>
                        accepted((_p, t) => {
                          t.plugins![index].bypassed = !slot.bypassed;
                        }),
                      )
                    }
                  >
                    {slot.bypassed ? "Activar" : "Bypass"}
                  </button>
                  <button
                    aria-label={`Subir ${slot.name}`}
                    disabled={busy || index === 0}
                    onClick={() =>
                      void task(() =>
                        accepted((_p, t) => {
                          [t.plugins![index - 1], t.plugins![index]] = [
                            t.plugins![index],
                            t.plugins![index - 1],
                          ];
                        }),
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Eliminar ${slot.name}`}
                    disabled={busy}
                    onClick={() =>
                      void task(() =>
                        accepted((_p, t) => {
                          t.plugins = t.plugins!.filter(
                            (p) => p.id !== slot.id,
                          );
                        }),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="audio-actions">
                <button
                  disabled={!engine.native || busy}
                  onClick={() =>
                    void task(async () => {
                      discovery.current++;
                      setPlugins(await engine.request<FoundPlugin[]>("scan"));
                    })
                  }
                >
                  <Plug size={14} />
                  Buscar VST3 instalados
                </button>
                <button
                  disabled={!engine.native || busy}
                  onClick={() =>
                    void task(async () => {
                      const folder =
                        await window.studioNative?.pickPluginFolder();
                      if (folder) {
                        discovery.current++;
                        setPlugins(
                          await engine.request<FoundPlugin[]>("scan", {
                            paths: [folder],
                          }),
                        );
                      }
                    })
                  }
                >
                  Elegir carpeta
                </button>
              </div>
              {(track.plugins ?? []).length > 0 && engine.native && (
                <label>
                  Parámetros del plugin
                  <select
                    aria-label="Plugin para ajustar parámetros"
                    value={parameterPlugin}
                    onChange={(e) => {
                      setParameterPlugin(e.target.value);
                      if (e.target.value)
                        void task(async () =>
                          setParameters(
                            await engine.request("parameters", {
                              trackId: track.id,
                              pluginId: e.target.value,
                            }),
                          ),
                        );
                      else setParameters([]);
                    }}
                  >
                    <option value="">Selecciona un plugin…</option>
                    {track.plugins?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {parameters.length > 0 && (
                <div className="plugin-parameters">
                  {parameters
                    .filter(
                      (parameter) => !/^MIDI CC \d+\|\d+$/.test(parameter.name),
                    )
                    .map((parameter) => (
                      <label key={parameter.index}>
                        <span>
                          {parameter.name}{" "}
                          <b>
                            {parameter.text} {parameter.label}
                          </b>
                        </span>
                        <input
                          aria-label={`Parámetro ${parameter.name}`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.001"
                          value={parameter.value}
                          onChange={(e) => {
                            const value = +e.target.value;
                            setParameters((items) =>
                              items.map((p) =>
                                p.index === parameter.index
                                  ? { ...p, value, text: value.toFixed(3) }
                                  : p,
                              ),
                            );
                            void engine
                              .request("parameter", {
                                trackId: track.id,
                                pluginId: parameterPlugin,
                                index: parameter.index,
                                value,
                              })
                              .catch((error) => notify(error.message));
                          }}
                        />
                      </label>
                    ))}
                </div>
              )}
              {busy && <p className="audio-hint">Preparando plugins…</p>}
              <div className="plugin-results">
                {plugins.map((plugin, index) => (
                  <button
                    key={index}
                    disabled={
                      busy ||
                      (plugin.instrument && track.kind === "bus") ||
                      ((track.plugins ?? []).length >= 8 &&
                        !(
                          plugin.instrument &&
                          track.plugins?.some(isPluginInstrument)
                        ))
                    }
                    onClick={() =>
                      void task(async () => {
                        await accepted((_p, t) => {
                          insertPlugin(t, plugin);
                        });
                        notify(`${plugin.name} añadido al canal.`);
                      })
                    }
                  >
                    <Plug size={18} />
                    <span>
                      <b>{plugin.name}</b>
                      <small>
                        {plugin.manufacturer} ·{" "}
                        {plugin.instrument ? "Instrumento" : "Efecto"}
                      </small>
                    </span>
                    <Plus size={15} />
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === "automation" && (
            <>
              <div className="audio-section-heading">
                <div>
                  <span className="eyebrow">MOVIMIENTO DEL SONIDO</span>
                  <h3>{track.name}</h3>
                </div>
                <select
                  aria-label="Parámetro de automatización"
                  value={target}
                  onChange={(e) => {
                    const next = e.target.value as AutomationTarget;
                    setTarget(next);
                    setPointValue(track[next]);
                  }}
                >
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="audio-hint">
                Los puntos se interpolan linealmente. En modo canción, la
                posición recorre todo el arreglo; en modo patrón vuelve al
                principio cada dos compases.
              </p>
              <svg
                className="automation-curve"
                viewBox="0 0 760 160"
                role="img"
                aria-label={`Curva de ${labels[target]}`}
              >
                <defs>
                  <pattern
                    id="automationGrid"
                    width="47.5"
                    height="40"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 47.5 0 L 0 0 0 40"
                      fill="none"
                      stroke="#303642"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect width="760" height="160" fill="url(#automationGrid)" />
                {points.length > 0 && (
                  <polyline
                    points={points
                      .map(
                        (p) =>
                          `${(p.step / (mode === "song" ? project.bars * 16 : project.patterns.find((p) => p.id === patternId)!.length)) * 760},${150 - ((p.value - min) / (max - min)) * 140}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke={track.color}
                    strokeWidth="3"
                  />
                )}
                {points.map((p) => (
                  <circle
                    key={p.step}
                    cx={
                      (p.step /
                        (mode === "song"
                          ? project.bars * 16
                          : project.patterns.find((p) => p.id === patternId)!
                              .length)) *
                      760
                    }
                    cy={150 - ((p.value - min) / (max - min)) * 140}
                    r="5"
                    fill={track.color}
                  />
                ))}
              </svg>
              <div className="automation-add">
                <label>
                  Paso (desde 1)
                  <input
                    aria-label="Paso de automatización"
                    type="number"
                    min="1"
                    max={project.bars * 16 + 1}
                    value={pointStep + 1}
                    onChange={(e) =>
                      setPointStep(
                        clamp(+e.target.value - 1, 0, project.bars * 16),
                      )
                    }
                  />
                </label>
                <label>
                  {labels[target]}
                  <input
                    aria-label="Valor de automatización"
                    type="number"
                    min={min}
                    max={max}
                    step={increment}
                    value={pointValue}
                    onChange={(e) =>
                      setPointValue(clamp(+e.target.value, min, max))
                    }
                  />
                </label>
                <button
                  onClick={() =>
                    edit((_p, t) => {
                      t.automation = {
                        ...t.automation,
                        [target]: [
                          ...(t.automation?.[target] ?? []).filter(
                            (p) => p.step !== pointStep,
                          ),
                          { step: pointStep, value: pointValue },
                        ].sort((a, b) => a.step - b.step),
                      };
                    })
                  }
                >
                  <Plus size={14} />
                  Guardar punto
                </button>
                <button onClick={() => setPointStep(step)}>
                  Usar posición actual
                </button>
              </div>
              <div className="automation-points">
                {points.map((p) => (
                  <div key={p.step}>
                    <span>
                      Compás {Math.floor(p.step / 16) + 1}, paso{" "}
                      {(p.step % 16) + 1}
                    </span>
                    <b>{p.value.toFixed(target === "cutoff" ? 0 : 2)}</b>
                    <button
                      aria-label={`Eliminar punto ${p.step + 1}`}
                      onClick={() =>
                        edit((_p, t) => {
                          t.automation![target] = t.automation![target]!.filter(
                            (point) => point.step !== p.step,
                          );
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {points.length > 0 && (
                <button
                  onClick={() =>
                    edit((_p, t) => {
                      delete t.automation?.[target];
                    })
                  }
                >
                  Quitar automatización de {labels[target].toLowerCase()}
                </button>
              )}
            </>
          )}
          {tab === "sample" && (
            <SampleEditor
              project={project}
              track={track}
              onChange={onChange}
              notify={notify}
            />
          )}
        </div>
        <footer>
          <span>
            <SlidersHorizontal size={14} />
            {track.name}
          </span>
          <span>
            {busy ? "Procesando…" : "Los cambios se guardan con el proyecto"}
          </span>
        </footer>
      </section>
    </div>
  );
}
