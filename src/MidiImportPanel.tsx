import { useState } from "react";
import { X, FileMusic } from "lucide-react";
import { midiPartName } from "./midi.ts";
import type { MidiSong, MidiImportOptions } from "./midi.ts";
import type { Project } from "./model.ts";

type Props = {
  song: MidiSong;
  fileName: string;
  project: Project;
  onClose: () => void;
  onImport: (options: MidiImportOptions) => Promise<string[]>;
};
export function MidiImportPanel({
  song,
  fileName,
  project,
  onClose,
  onImport,
}: Props) {
  const [selected, setSelected] = useState(
    () =>
      new Set(
        song.parts
          .slice(0, Math.max(0, 32 - project.tracks.length))
          .map((p) => p.id),
      ),
  );
  const [replace, setReplace] = useState(false),
    [useTempo, setUseTempo] = useState(false),
    [startBar, setStartBar] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const capacity = replace ? 32 : 32 - project.tracks.length;
  const needsSplit = song.parts
    .filter((p) => selected.has(p.id))
    .some((p) =>
      p.notes.some(
        (n) =>
          Math.floor(n.start / 128) !==
          Math.floor((n.start + n.length - 1e-8) / 128),
      ),
    );
  const invalid =
    selected.size === 0 ||
    selected.size > capacity ||
    (!replace && startBar + Math.ceil(song.length / 16) > 64) ||
    (useTempo && (song.bpm < 40 || song.bpm > 240));
  return (
    <div
      className="modal-backdrop audio-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="modal midi-import-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Importar archivo MIDI"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            if (!busy) onClose();
          }
          if (e.key === "Tab") {
            const controls = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input:not(:disabled)",
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <button
          autoFocus
          className="modal-close icon-button"
          aria-label="Cancelar importación MIDI"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <span className="eyebrow">ARCHIVO MIDI · TIPO {song.format}</span>
        <h2>
          <FileMusic size={22} /> Importar MIDI
        </h2>
        <p>
          {fileName} · {song.parts.length} partes ·{" "}
          {Math.ceil(song.length / 16)} compases de 4/4 · {song.bpm} BPM
        </p>
        <div className="midi-import-settings">
          <label>
            <input
              type="checkbox"
              checked={replace}
              disabled={busy}
              onChange={(e) => {
                setReplace(e.target.checked);
                setUseTempo(e.target.checked);
              }}
            />{" "}
            Crear un proyecto nuevo
          </label>
          <label>
            <input
              type="checkbox"
              checked={useTempo}
              disabled={busy}
              onChange={(e) => setUseTempo(e.target.checked)}
            />{" "}
            Usar tempo del MIDI ({song.bpm} BPM)
          </label>
          <label>
            Compás de inicio
            <input
              aria-label="Compás de inicio MIDI"
              type="number"
              min={1}
              max={64}
              value={replace ? 1 : startBar + 1}
              disabled={busy || replace}
              onChange={(e) =>
                setStartBar(
                  Math.min(
                    63,
                    Math.max(0, Math.floor(Number(e.target.value) || 1) - 1),
                  ),
                )
              }
            />
          </label>
        </div>
        <div className="midi-part-heading">
          <b>
            Partes a importar ({selected.size}/{capacity} canales disponibles)
          </b>
          <button
            disabled={busy}
            onClick={() =>
              setSelected(
                new Set(song.parts.slice(0, capacity).map((p) => p.id)),
              )
            }
          >
            Seleccionar disponibles
          </button>
          <button disabled={busy} onClick={() => setSelected(new Set())}>
            Ninguna
          </button>
        </div>
        <div className="midi-parts">
          {song.parts.map((part) => (
            <label key={part.id}>
              <input
                type="checkbox"
                disabled={
                  busy || (!selected.has(part.id) && selected.size >= capacity)
                }
                checked={selected.has(part.id)}
                aria-label={`Importar ${midiPartName(part)}`}
                onChange={(e) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (e.target.checked) next.add(part.id);
                    else next.delete(part.id);
                    return next;
                  })
                }
              />
              <span>
                <strong>{midiPartName(part)}</strong>
                <small>
                  {part.notes.length} notas ·{" "}
                  {part.drumNote !== undefined
                    ? `Percusión GM ${part.drumNote}`
                    : `Programa GM ${part.program + 1}`}
                </small>
              </span>
            </label>
          ))}
        </div>
        <p className="midi-import-note">
          Cada parte crea un canal editable. Los timbres iniciales son
          aproximaciones; puedes cambiar sus instrumentos después. MIDI contiene
          notas, no el sonido ni los plugins originales.
        </p>
        {!replace && project.swing > 0 && (
          <p className="midi-import-note">
            Al añadir los canales, se aplica el swing actual del proyecto. Crear
            un proyecto nuevo conserva el ritmo del archivo sin añadir swing.
          </p>
        )}
        {needsSplit && (
          <p className="midi-warning">
            Las notas que cruzan bloques de ocho compases se dividen y vuelven a
            sonar al inicio del siguiente bloque.
          </p>
        )}
        {song.warnings.map((warning) => (
          <p className="midi-warning" key={warning}>
            {warning}
          </p>
        ))}
        {useTempo && (song.bpm < 40 || song.bpm > 240) && (
          <p role="alert">
            El tempo está fuera de 40–240 BPM. Desmarca Usar tempo del MIDI.
          </p>
        )}
        {error && (
          <p role="alert" className="midi-warning">
            {error}
          </p>
        )}
        <div className="midi-import-actions">
          <button disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={busy || invalid}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onImport({
                  parts: [...selected],
                  replace,
                  useTempo,
                  startBar,
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            {busy ? "Importando…" : "Importar partes seleccionadas"}
          </button>
        </div>
      </section>
    </div>
  );
}
