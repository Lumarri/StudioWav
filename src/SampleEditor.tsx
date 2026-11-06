import { useEffect, useState } from "react";
import { encodeWav } from "./audio/wav.ts";
import { id } from "./model.ts";
import type { Project, Track } from "./model.ts";
import { dataUrlBytes } from "./audio/data.ts";
export function SampleEditor({
  project,
  track,
  onChange,
  notify,
}: {
  project: Project;
  track: Track;
  onChange: (p: Project) => void;
  notify: (s: string) => void;
}) {
  const sample = project.samples.find((s) => s.id === track.sampleId);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null),
    [peaks, setPeaks] = useState<number[]>([]),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(1),
    [reverse, setReverse] = useState(false),
    [normalize, setNormalize] = useState(false),
    [fadeIn, setFadeIn] = useState(0.005),
    [fadeOut, setFadeOut] = useState(0.01),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const context = new AudioContext();
    setBuffer(null);
    if (sample)
      void context
        .decodeAudioData(dataUrlBytes(sample.data).buffer)
        .then((audio) => {
          if (!active) return;
          setBuffer(audio);
          setStart(0);
          setEnd(audio.duration);
          const source = audio.getChannelData(0);
          const width = Math.ceil(source.length / 512);
          setPeaks(
            Array.from({ length: 512 }, (_, index) => {
              let max = 0;
              for (
                let j = index * width;
                j < Math.min(source.length, (index + 1) * width);
                j++
              )
                max = Math.max(max, Math.abs(source[j]));
              return max;
            }),
          );
        })
        .catch((e) => {
          if (active) notify(`No se pudo leer la muestra: ${e.message}`);
        });
    return () => {
      active = false;
      void context.close();
    };
  }, [sample?.data]);
  async function apply() {
    if (!buffer || !sample) return;
    setBusy(true);
    try {
      const a = Math.floor(start * buffer.sampleRate),
        b = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
      if (b <= a) throw new Error("El final debe estar después del inicio.");
      const channels = [0, 1].map((c) => {
        const original = buffer.getChannelData(
          Math.min(c, buffer.numberOfChannels - 1),
        );
        return original.slice(a, b);
      });
      let peak = 0;
      for (const channel of channels)
        for (const v of channel) peak = Math.max(peak, Math.abs(v));
      const gain = normalize && peak > 0 ? 0.98 / peak : 1;
      for (const channel of channels) {
        if (reverse) channel.reverse();
        for (let i = 0; i < channel.length; i++)
          channel[i] *=
            gain *
            Math.min(
              1,
              fadeIn > 0 ? i / (fadeIn * buffer.sampleRate) : 1,
              fadeOut > 0
                ? (channel.length - 1 - i) / (fadeOut * buffer.sampleRate)
                : 1,
            );
      }
      const blob = new Blob([encodeWav(channels, buffer.sampleRate)], {
        type: "audio/wav",
      });
      if (blob.size > 100000000)
        throw new Error("La muestra editada supera 100 MB.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const next = structuredClone(project),
        sampleId = id();
      next.samples.push({
        id: sampleId,
        name: `${sample.name.replace(/\.[^.]+$/, "")} edit.wav`,
        data,
        duration: (b - a) / buffer.sampleRate,
      });
      next.tracks.find((t) => t.id === track.id)!.sampleId = sampleId;
      const used = new Set(next.tracks.map((t) => t.sampleId));
      next.samples = next.samples.filter((s) => used.has(s.id));
      onChange(next);
      setReverse(false);
      setNormalize(false);
      notify("Muestra editada. Puedes deshacer para recuperar la anterior.");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!sample)
    return (
      <p className="audio-hint">
        Selecciona una pista de audio importado o una toma grabada para editar
        su forma de onda.
      </p>
    );
  return (
    <div className="sample-editor">
      <h3>{sample.name}</h3>
      <p className="audio-hint">
        Recorta, invierte, normaliza y aplica fundidos. Aplicar crea una nueva
        muestra que se guarda dentro del proyecto.
      </p>
      <svg
        viewBox="0 0 760 160"
        className="sample-waveform"
        aria-label="Forma de onda de la muestra"
        role="img"
      >
        <path
          d={peaks
            .map(
              (p, i) => `M ${(i / 512) * 760} ${80 - p * 70} V ${80 + p * 70}`,
            )
            .join(" ")}
          stroke={track.color}
          strokeWidth="1.5"
        />
        <rect
          x={buffer ? (start / buffer.duration) * 760 : 0}
          width={buffer ? ((end - start) / buffer.duration) * 760 : 760}
          height="160"
          fill="#ffffff10"
          stroke="#ffffff70"
        />
      </svg>
      {buffer && (
        <>
          <div className="audio-form-grid">
            <label>
              Inicio (segundos)
              <input
                aria-label="Inicio del recorte"
                type="number"
                min="0"
                max={buffer.duration}
                step="0.01"
                value={start}
                onChange={(e) =>
                  setStart(
                    Math.max(0, Math.min(buffer.duration, +e.target.value)),
                  )
                }
              />
            </label>
            <label>
              Final (segundos)
              <input
                aria-label="Final del recorte"
                type="number"
                min="0"
                max={buffer.duration}
                step="0.01"
                value={end}
                onChange={(e) =>
                  setEnd(
                    Math.max(0, Math.min(buffer.duration, +e.target.value)),
                  )
                }
              />
            </label>
            <label>
              Fundido de entrada (s)
              <input
                aria-label="Fundido de entrada"
                type="number"
                min="0"
                max="10"
                step="0.001"
                value={fadeIn}
                onChange={(e) =>
                  setFadeIn(Math.max(0, Math.min(10, +e.target.value)))
                }
              />
            </label>
            <label>
              Fundido de salida (s)
              <input
                aria-label="Fundido de salida"
                type="number"
                min="0"
                max="10"
                step="0.001"
                value={fadeOut}
                onChange={(e) =>
                  setFadeOut(Math.max(0, Math.min(10, +e.target.value)))
                }
              />
            </label>
          </div>
          <label className="audio-check">
            <input
              type="checkbox"
              checked={reverse}
              onChange={(e) => setReverse(e.target.checked)}
            />
            Invertir audio
          </label>
          <label className="audio-check">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
            />
            Normalizar pico a −0,18 dBFS
          </label>
          <button
            className="primary"
            disabled={busy || end <= start}
            onClick={() => void apply()}
          >
            {busy ? "Procesando…" : "Aplicar edición a la muestra"}
          </button>
          <p className="audio-hint">
            {buffer.sampleRate} Hz · {buffer.numberOfChannels} canales ·{" "}
            {buffer.duration.toFixed(2)} s
          </p>
        </>
      )}
    </div>
  );
}
