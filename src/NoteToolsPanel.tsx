import { useMemo, useState } from "react";
import { X, Play, RotateCcw } from "lucide-react";
import { defaultToolOptions, transformNotes } from "./music-tools.ts";
import type { NoteTool } from "./music-tools.ts";
import type { Note } from "./model.ts";
import { noteName } from "./model.ts";

export const toolNames: Record<NoteTool, string> = {
  quantize: "Cuantizador",
  arpeggio: "Arpegiador",
  legato: "Articulador",
  chop: "Trocear notas",
  flip: "Invertir notas",
  chord: "Insertar acorde",
};
export function NoteToolsPanel({
  tool,
  notes,
  selected,
  length,
  onClose,
  onApply,
  onListen,
}: {
  tool: NoteTool;
  notes: Note[];
  selected: ReadonlySet<string>;
  length: number;
  onClose: () => void;
  onApply: (notes: Note[]) => void;
  onListen: (notes: Note[]) => void;
}) {
  const [options, setOptions] = useState(defaultToolOptions);
  const result = useMemo(() => {
    try {
      return {
        notes: transformNotes(notes, selected, tool, options, length),
        error: "",
      };
    } catch (error) {
      return {
        notes: [],
        error: error instanceof Error ? error.message : "Operación no válida",
      };
    }
  }, [notes, selected, tool, options, length]);
  const change = (patch: Partial<typeof options>) =>
    setOptions((o) => ({ ...o, ...patch }));
  const low = Math.min(48, ...result.notes.map((n) => n.pitch)),
    high = Math.max(72, ...result.notes.map((n) => n.pitch));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal note-tools"
        role="dialog"
        aria-modal="true"
        aria-label={toolNames[tool]}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Cerrar herramienta"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">
          PIANO ROLL ·{" "}
          {selected.size ? `${selected.size} seleccionadas` : "CANAL COMPLETO"}
        </span>
        <h2>{toolNames[tool]}</h2>
        <div className="note-tool-controls">
          {["quantize", "arpeggio", "chop", "chord"].includes(tool) && (
            <label>
              Rejilla / intervalo
              <select
                aria-label="Rejilla de herramienta"
                value={options.grid}
                onChange={(e) => change({ grid: Number(e.target.value) })}
              >
                {[
                  [0.25, "1/64"],
                  [0.5, "1/32"],
                  [1, "1/16"],
                  [2, "1/8"],
                  [4, "1/4"],
                  [8, "1/2"],
                  [16, "1 compás"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tool === "quantize" && (
            <label>
              Fuerza · {Math.round(options.strength * 100)}%
              <input
                aria-label="Fuerza de cuantización"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={options.strength}
                onChange={(e) => change({ strength: Number(e.target.value) })}
              />
            </label>
          )}
          {["arpeggio", "legato", "chop"].includes(tool) && (
            <label>
              Duración / gate · {Math.round(options.gate * 100)}%
              <input
                aria-label="Gate de notas"
                type="range"
                min=".1"
                max="1"
                step=".05"
                value={options.gate}
                onChange={(e) => change({ gate: Number(e.target.value) })}
              />
            </label>
          )}
          {tool === "arpeggio" && (
            <>
              <label>
                Recorrido
                <select
                  aria-label="Dirección del arpegio"
                  value={options.direction}
                  onChange={(e) =>
                    change({
                      direction: e.target.value as typeof options.direction,
                    })
                  }
                >
                  <option value="up">Ascendente</option>
                  <option value="down">Descendente</option>
                  <option value="alternate">Alternado</option>
                </select>
              </label>
              <label>
                Octavas
                <input
                  aria-label="Octavas del arpegio"
                  type="number"
                  min="1"
                  max="4"
                  value={options.octaves}
                  onChange={(e) => change({ octaves: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          {tool === "flip" && (
            <>
              <label>
                <input
                  aria-label="Invertir tiempo"
                  type="checkbox"
                  checked={options.horizontal}
                  onChange={(e) => change({ horizontal: e.target.checked })}
                />{" "}
                Tiempo: espejo horizontal
              </label>
              <label>
                <input
                  aria-label="Invertir alturas"
                  type="checkbox"
                  checked={options.vertical}
                  onChange={(e) => change({ vertical: e.target.checked })}
                />{" "}
                Alturas: espejo vertical
              </label>
            </>
          )}
          {tool === "chord" && (
            <>
              <label>
                Nota raíz
                <select
                  aria-label="Raíz del acorde"
                  value={options.root}
                  onChange={(e) => change({ root: Number(e.target.value) })}
                >
                  {Array.from({ length: 49 }, (_, i) => 36 + i).map((pitch) => (
                    <option key={pitch} value={pitch}>
                      {noteName(pitch)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Acorde
                <select
                  aria-label="Tipo de acorde"
                  value={options.chord}
                  onChange={(e) =>
                    change({ chord: e.target.value as typeof options.chord })
                  }
                >
                  <option value="major">Mayor</option>
                  <option value="minor">Menor</option>
                  <option value="seventh">Séptima dominante</option>
                  <option value="minor7">Menor séptima</option>
                </select>
              </label>
            </>
          )}
        </div>
        <svg
          className="note-tool-preview"
          viewBox="0 0 600 150"
          aria-label="Previsualización de notas"
        >
          {result.notes.map((n) => (
            <rect
              key={n.id}
              x={(n.start / length) * 600}
              y={140 - ((n.pitch - low) / (high - low)) * 130}
              width={Math.max(1, (n.length / length) * 600)}
              height="4"
            />
          ))}
        </svg>
        <p className="tool-result" role="status">
          {result.error ||
            `${notes.length} → ${result.notes.length} notas. Aceptar crea un paso de deshacer; cancelar conserva el original.`}
        </p>
        <div className="note-tool-actions">
          <button onClick={() => setOptions(defaultToolOptions)}>
            <RotateCcw size={14} />
            Restablecer
          </button>
          <button
            disabled={Boolean(result.error) || !result.notes.length}
            onClick={() => onListen(result.notes)}
          >
            <Play size={14} />
            Escuchar resultado
          </button>
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary-button"
            disabled={Boolean(result.error)}
            onClick={() => onApply(result.notes)}
          >
            Aceptar herramienta
          </button>
        </div>
      </section>
    </div>
  );
}
