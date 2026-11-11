import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  Activity,
  AudioLines,
  AudioWaveform,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  FolderOpen,
  Grid2X2,
  Headphones,
  KeyboardMusic,
  Layers3,
  ListMusic,
  LoaderCircle,
  Music2,
  Mic,
  Pause,
  Piano,
  Play,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import { AudioEngine } from "./audio/desktop-engine.ts";
import { WorkspaceWindow } from "./WorkspaceWindow.tsx";
import type { WindowId } from "./WorkspaceWindow.tsx";
import { StudioMenu } from "./StudioMenu.tsx";
import { Knob } from "./Knob.tsx";
import { MixerEffects } from "./MixerEffects.tsx";
import { NoteToolsPanel, toolNames } from "./NoteToolsPanel.tsx";
import {
  transformNotes,
  defaultToolOptions,
  resizePattern,
  makeClipUnique,
  splitPatternChannels,
  patternOverview,
} from "./music-tools.ts";
import type { NoteTool } from "./music-tools.ts";
import { AudioPanel } from "./AudioPanel.tsx";
import { InstrumentLibrary } from "./InstrumentLibrary.tsx";
import { MidiImportPanel } from "./MidiImportPanel.tsx";
import { readMidi, writeMidi, importMidi, MIDI_MAX_BYTES } from "./midi.ts";
import type { MidiSong, MidiImportOptions } from "./midi.ts";
import { addPluginTrack } from "./plugins.ts";
import type { FoundPlugin } from "./audio/desktop-engine.ts";
import { dataUrlBytes } from "./audio/data.ts";
import {
  clamp,
  createProject,
  createTrack,
  emptyPattern,
  id,
  isMelodic,
  noteName,
  presets,
  playlistLanes,
  validateProject,
} from "./model.ts";
import type {
  Channel,
  Instrument,
  Mode,
  Note,
  Project,
  Track,
} from "./model.ts";

const engine = new AudioEngine();
const STORAGE_KEY = "studiowav.project.v1";
const BAR_WIDTH = 56;
const PITCH_HEIGHT = 18;
const tint = (track: { color: string }): CSSProperties =>
  ({ "--track-color": track.color }) as CSSProperties;
const decibels = (gain: number) =>
  gain < 0.005 ? "−∞" : `${(20 * Math.log10(gain)).toFixed(1)}`;

function loadInitial(): Project {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return validateProject(JSON.parse(saved));
  } catch {
    /* A corrupt autosave never prevents startup. */
  }
  return createProject();
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function ClipArt({
  channel,
  length = 32,
}: {
  channel?: Channel;
  length?: number;
}) {
  return (
    <svg
      className="clip-art"
      viewBox="0 0 128 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {channel?.steps.map((velocity, index) =>
        velocity ? (
          <rect
            key={index}
            x={(index / length) * 128 + 1}
            y={24 - velocity * 18}
            width="2"
            height={velocity * 18}
            rx="0.6"
          />
        ) : null,
      )}
      {channel?.notes.map((note) => (
        <rect
          key={note.id}
          x={(note.start / length) * 128}
          y={20 - ((note.pitch % 24) / 24) * 18}
          width={Math.max(2, (note.length / length) * 128 - 1)}
          height="2"
          rx="0.6"
        />
      ))}
    </svg>
  );
}

function App() {
  const [project, setProject] = useState<Project>(loadInitial);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [activeTrackId, setActiveTrackId] = useState(project.tracks[0].id);
  const [patternId, setPatternId] = useState(project.patterns[0].id);
  const patternRef = useRef(patternId);
  patternRef.current = patternId;
  const [mode, setMode] = useState<Mode>("song");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [editor, setEditor] = useState<"rack" | "piano" | "mixer">("rack");
  const [windows, setWindows] = useState<Record<WindowId, boolean>>({
    playlist: true,
    rack: true,
    piano: false,
    mixer: false,
  });
  const [windowOrder, setWindowOrder] = useState<WindowId[]>([
    "playlist",
    "mixer",
    "piano",
    "rack",
  ]);
  const [browserVisible, setBrowserVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [ghostNotes, setGhostNotes] = useState(true);
  const [playlistSnap, setPlaylistSnap] = useState(1);
  const [audioTab, setAudioTab] = useState<
    "devices" | "routing" | "plugins" | "automation" | "sample"
  >("devices");
  const [context, setContext] = useState<{
    x: number;
    y: number;
    trackId: string;
  } | null>(null);
  const channelClipboard = useRef<Channel | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [modal, setModal] = useState<
    "instrument" | "help" | "new" | "audio" | "rename" | "notes" | null
  >(null);
  const [message, setMessage] = useState("");
  const [patternName, setPatternName] = useState("");
  const [saved, setSaved] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [keyboard, setKeyboard] = useState(true);
  const [recordMidi, setRecordMidi] = useState(false);
  const midiHeld = useRef(
    new Map<
      number,
      {
        id: string;
        trackId: string;
        patternId: string;
        start: number;
        absolute: number;
      }
    >(),
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteSelection, setNoteSelection] = useState<Set<string>>(new Set());
  const [noteTool, setNoteTool] = useState<NoteTool>("quantize");
  const [pianoSnap, setPianoSnap] = useState(1);
  const [pianoOffset, setPianoOffset] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [activeLaneId, setActiveLaneId] = useState(
    playlistLanes(project)[0].id,
  );
  const noteClipboard = useRef<Note[]>([]);
  const previewingNotes = useRef(false);
  const [noteLength, setNoteLength] = useState(2);
  const [pianoLow, setPianoLow] = useState(48);
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const midiInput = useRef<HTMLInputElement>(null);
  const [pendingMidi, setPendingMidi] = useState<{
    song: MidiSong;
    name: string;
  } | null>(null);
  const pianoScroll = useRef<HTMLDivElement>(null);
  const pianoDrag = useRef<{
    id: string;
    x: number;
    y: number;
    start: number;
    pitch: number;
    length: number;
    kind: "move" | "resize" | "draw";
    members?: Note[];
  } | null>(null);
  const heldKeys = useRef(new Set<string>());
  const resumeStep = useRef(0);

  const track =
    project.tracks.find((t) => t.id === activeTrackId) ?? project.tracks[0];
  const pattern =
    project.patterns.find((p) => p.id === patternId) ?? project.patterns[0];
  const channel = pattern.channels[track.id];
  const PIANO_WIDTH = pattern.length * 28;
  const lanes = playlistLanes(project);
  const selectedClip = project.clips.find((c) => c.id === selectedClipId);
  const selectedNote = channel.notes.find((n) => n.id === selectedNoteId);
  const selectedPresets = presets.filter(
    (p) =>
      (category === "all" ||
        (category === "drums"
          ? !isMelodic(p.instrument)
          : isMelodic(p.instrument))) &&
      `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const localStep = step % pattern.length;
  useEffect(() => {
    setNoteSelection(new Set());
    setSelectedNoteId(null);
  }, [patternId, activeTrackId]);

  function notify(text: string) {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 5000);
  }

  function commit(change: (project: Project) => Project, remember = true) {
    const previous = projectRef.current;
    const next = change(structuredClone(previous));
    if (remember) {
      undoStack.current = [...undoStack.current.slice(-49), previous];
      redoStack.current = [];
      setHistoryVersion((v) => v + 1);
    }
    projectRef.current = next;
    setProject(next);
    setSaved(false);
  }

  function patchTrack(
    patch: Partial<Track>,
    target = track.id,
    remember = true,
  ) {
    commit((p) => {
      const t = p.tracks.find((t) => t.id === target);
      if (t) Object.assign(t, patch);
      return p;
    }, remember);
  }

  function patchChannel(
    change: (channel: Channel) => void,
    target = track.id,
    remember = true,
  ) {
    commit((p) => {
      const selected = p.patterns.find((p) => p.id === pattern.id);
      if (selected?.channels[target]) change(selected.channels[target]);
      return p;
    }, remember);
  }

  function stop() {
    engine.stop();
    resumeStep.current = 0;
    setPlaying(false);
    setStep(0);
  }
  async function togglePlayback() {
    if (playing) {
      resumeStep.current = engine.pause();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    try {
      await engine.start(
        () => projectRef.current,
        () => modeRef.current,
        () => patternRef.current,
        resumeStep.current,
      );
    } catch (error) {
      stop();
      notify(
        `No se pudo iniciar el audio: ${error instanceof Error ? error.message : "revisa tu dispositivo"}`,
      );
    }
  }

  function focusWindow(target: WindowId) {
    setWindowOrder((previous) =>
      previous.at(-1) === target
        ? previous
        : [...previous.filter((id) => id !== target), target],
    );
    if (target !== "playlist") setEditor(target);
  }
  function showWindow(target: WindowId, toggle = false) {
    if (toggle && windows[target] && windowOrder.at(-1) === target) {
      setWindows((previous) => ({ ...previous, [target]: false }));
    } else {
      setWindows((previous) => ({ ...previous, [target]: true }));
      focusWindow(target);
    }
  }
  function activateEditor(target: "rack" | "piano" | "mixer") {
    showWindow(target);
  }
  function resetLayout() {
    setLayoutVersion((v) => v + 1);
    setWindows({ playlist: true, rack: true, piano: false, mixer: false });
    setWindowOrder(["playlist", "mixer", "piano", "rack"]);
    setBrowserVisible(true);
    setInspectorVisible(false);
    setEditor("rack");
  }
  function editNotes(
    action: "octaveUp" | "octaveDown" | "quantize" | "select",
  ) {
    if (action === "select") {
      setNoteSelection(new Set(channel.notes.map((n) => n.id)));
      setSelectedNoteId(channel.notes[0]?.id ?? null);
      return;
    }
    patchChannel((c) => {
      if (action === "quantize")
        c.notes = transformNotes(
          c.notes,
          noteSelection,
          "quantize",
          { ...defaultToolOptions, grid: pianoSnap },
          pattern.length,
        );
      else
        for (const n of c.notes)
          if (!noteSelection.size || noteSelection.has(n.id))
            n.pitch = clamp(
              n.pitch + (action === "octaveUp" ? 12 : -12),
              0,
              127,
            );
    });
  }
  function selectTrack(target: Track, openPiano = false) {
    setActiveTrackId(target.id);
    setNoteSelection(new Set());
    setSelectedNoteId(null);
    setPianoLow(target.instrument === "bass" ? 24 : 48);
    if (openPiano) activateEditor("piano");
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(projectRef.current);
    projectRef.current = previous;
    setProject(previous);
    setSaved(false);
    setHistoryVersion((v) => v + 1);
  }
  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(projectRef.current);
    projectRef.current = next;
    setProject(next);
    setSaved(false);
    setHistoryVersion((v) => v + 1);
  }
  void historyVersion;

  async function saveProject() {
    try {
      const snapshot = await engine.capture(projectRef.current);
      download(
        new Blob([JSON.stringify(snapshot)], {
          type: "application/json",
        }),
        `${projectRef.current.name || "StudioWav"}.studiowav`,
      );
      notify("Proyecto guardado. Incluye los patrones y el audio importado.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el proyecto.",
      );
    }
  }

  async function openProject(file?: File) {
    if (!file) return;
    try {
      if (file.size > 250_000_000)
        throw new Error("El proyecto supera el límite de 250 MB.");
      const loaded = validateProject(JSON.parse(await file.text()));
      stop();
      if (engine.native)
        await engine.update(loaded, mode, loaded.patterns[0].id, true);
      else await engine.prepare(loaded);
      commit(() => loaded);
      setActiveTrackId(loaded.tracks[0].id);
      setPatternId(loaded.patterns[0].id);
      setSelectedNoteId(null);
      notify(`Proyecto abierto: ${loaded.name}`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "No se pudo abrir el proyecto.",
      );
    }
  }

  async function loadMidi(file?: File) {
    if (!file) return;
    try {
      if (file.size > MIDI_MAX_BYTES)
        throw new Error("El archivo MIDI supera 8 MB.");
      const song = readMidi(new Uint8Array(await file.arrayBuffer()));
      stop();
      setModal(null);
      setPendingMidi({
        song,
        name: file.name.replace(/\.(mid|midi)$/i, "").slice(0, 60) || "MIDI",
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "No se pudo leer el MIDI.",
      );
    }
  }

  async function acceptMidi(options: MidiImportOptions) {
    if (!pendingMidi) throw new Error("No hay un archivo MIDI seleccionado.");
    stop();
    const snapshot = projectRef.current;
    const captured = options.replace
      ? snapshot
      : await engine.capture(snapshot);
    const result = importMidi(
      captured,
      pendingMidi.song,
      options,
      pendingMidi.name,
    );
    if (engine.native)
      await engine.update(result.project, "song", result.patternId, true);
    else await engine.prepare(result.project);
    if (projectRef.current !== snapshot) {
      if (engine.native)
        await engine.update(
          projectRef.current,
          modeRef.current,
          patternRef.current,
        );
      throw new Error("El proyecto cambió. Repite la importación.");
    }
    commit(() => result.project);
    setPatternId(result.patternId);
    setActiveTrackId(result.trackId);
    setMode("song");
    setPendingMidi(null);
    setSelectedNoteId(null);
    showWindow("playlist");
    notify(`MIDI importado: ${pendingMidi.name}. ${result.warnings.join(" ")}`);
    return result.warnings;
  }

  function exportMidi(scope: Mode) {
    try {
      const result = writeMidi(projectRef.current, scope, patternRef.current);
      download(
        new Blob([new Uint8Array(result.bytes)], { type: "audio/midi" }),
        `${projectRef.current.name || "StudioWav"}${scope === "pattern" ? ` - ${pattern.name}` : ""}.mid`,
      );
      notify(
        `MIDI exportado: ${result.notes} notas en ${result.tracks} canales. ${result.warnings.join(" ")}`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "No se pudo exportar MIDI.",
      );
    }
  }

  async function importAudio(files: File[]) {
    stop();
    for (const file of files) {
      try {
        if (projectRef.current.tracks.length >= 32)
          throw new Error("El proyecto admite hasta 32 pistas.");
        if (file.size > 100_000_000)
          throw new Error("Cada archivo de audio puede tener hasta 100 MB.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const next = structuredClone(projectRef.current);
        const t = createTrack("sample", file.name.replace(/\.[^.]+$/, ""));
        const sampleId = id();
        t.sampleId = sampleId;
        const decoder = new AudioContext();
        let sampleDuration = 0;
        try {
          const decoded = await decoder.decodeAudioData(
            await file.arrayBuffer(),
          );
          sampleDuration = decoded.duration;
        } finally {
          await decoder.close();
        }
        if (sampleDuration > 600)
          throw new Error("La muestra puede durar hasta diez minutos.");
        next.samples.push({
          id: sampleId,
          name: file.name,
          data,
          duration: sampleDuration,
        });
        next.tracks.push(t);
        next.patterns.forEach((p) => {
          p.channels[t.id] = { steps: Array(p.length).fill(0), notes: [] };
          p.channels[t.id].steps[0] = 0.8;
        });
        const audioBars = Math.min(
          64,
          Math.max(2, Math.ceil((sampleDuration * next.bpm) / 240)),
        );
        next.bars = Math.max(
          next.bars,
          [8, 16, 32, 64].find((b) => b >= audioBars) ?? 64,
        );
        next.lanes = [
          ...playlistLanes(next).filter((l) => l.id !== t.id),
          { id: t.id, name: t.name, color: t.color, muted: false },
        ];
        next.clips.push({
          id: id(),
          trackId: t.id,
          patternId: next.patterns[0].id,
          startBar: 0,
          lengthBars: audioBars,
        });
        await engine.prepare(next);
        commit(() => next);
        selectTrack(t);
        setInspectorVisible(true);
        showWindow("playlist");
        notify(`Audio importado: ${file.name}`);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Formato de audio no compatible.",
        );
      }
    }
  }

  function addInstrument(instrument: Instrument) {
    if (project.tracks.length >= 32) {
      notify("El proyecto admite hasta 32 pistas.");
      return;
    }
    stop();
    const t = createTrack(instrument);
    commit((p) => {
      p.tracks.push(t);
      p.patterns.forEach((pat) => {
        pat.channels[t.id] = { steps: Array(pat.length).fill(0), notes: [] };
      });
      return p;
    });
    selectTrack(t, isMelodic(instrument));
    setModal(null);
    notify(`${t.name} añadido al proyecto.`);
  }

  async function addVstInstrument(plugin: FoundPlugin) {
    stop();
    const snapshot = projectRef.current;
    const next = structuredClone(await engine.capture(snapshot));
    const added = addPluginTrack(next, plugin);
    await engine.update(next, modeRef.current, patternRef.current);
    if (projectRef.current !== snapshot) {
      await engine.update(
        projectRef.current,
        modeRef.current,
        patternRef.current,
      );
      throw new Error("El proyecto cambió. Añade el instrumento de nuevo.");
    }
    commit(() => next);
    selectTrack(added, added.instrument !== "kick");
    if (added.instrument === "kick") activateEditor("rack");
    setModal(null);
    notify(`${plugin.name} listo. Edita sus notas en el rack o piano roll.`);
  }

  async function preview(target = track, pitch?: number) {
    try {
      await engine.preview(
        projectRef.current,
        target,
        pitch ?? (target.instrument === "bass" ? 36 : 60),
      );
    } catch {
      notify("No se pudo reproducir este instrumento.");
    }
  }

  function addPattern(duplicate = false) {
    if (project.patterns.length >= 64) {
      notify("El proyecto admite hasta 64 patrones.");
      return;
    }
    const next = duplicate
      ? {
          ...structuredClone(pattern),
          id: id(),
          name: `${pattern.name} · copia`,
        }
      : emptyPattern(
          project.tracks,
          `Patrón ${String(project.patterns.length + 1).padStart(2, "0")}`,
        );
    commit((p) => {
      p.patterns.push(next);
      return p;
    });
    setPatternId(next.id);
    setSelectedNoteId(null);
  }

  function placeClip(
    trackId: string,
    bar: number,
    movingId?: string,
    sourcePatternId = pattern.id,
  ) {
    if (!movingId && project.clips.length >= 2048) {
      notify("El proyecto admite 2048 clips.");
      return;
    }
    const moving = project.clips.find((c) => c.id === movingId);
    const source = project.patterns.find((p) => p.id === sourcePatternId)!;
    const length =
      moving?.lengthBars ??
      (moving
        ? project.patterns.find((p) => p.id === moving.patternId)!.length / 16
        : source.length / 16);
    if (length > project.bars) {
      notify("Amplía el arreglo para colocar este patrón.");
      return;
    }
    const startBar = clamp(
      Math.floor(bar / playlistSnap) * playlistSnap,
      0,
      project.bars - length,
    );
    if (
      project.clips.some(
        (c) =>
          (c.laneId ?? c.trackId) === trackId &&
          c.startBar === startBar &&
          c.id !== movingId,
      )
    )
      return;
    commit((p) => {
      const clip = p.clips.find((c) => c.id === movingId);
      if (clip) {
        clip.startBar = startBar;
        clip.laneId = trackId;
      } else
        p.clips.push({
          id: id(),
          trackId: track.id,
          laneId: trackId,
          scope: "pattern",
          loop: true,
          patternId: sourcePatternId,
          startBar,
        });
      return p;
    });
  }
  function addPlaylistLane() {
    if (lanes.length >= 32) {
      notify("La Playlist admite 32 pistas.");
      return;
    }
    const lane = {
      id: id(),
      name: `Pista ${lanes.length + 1}`,
      color: "#8bb6df",
      muted: false,
    };
    commit((p) => ({ ...p, lanes: [...playlistLanes(p), lane] }));
    setActiveLaneId(lane.id);
  }
  function uniqueClip() {
    try {
      const next = makeClipUnique(project, selectedClipId ?? "");
      commit(() => next);
      setPatternId(next.clips.find((c) => c.id === selectedClipId)!.patternId);
      notify("Clip independiente: editarlo ya no cambia las otras copias.");
    } catch (error) {
      notify((error as Error).message);
    }
  }
  function repeatClip(extend = false) {
    if (!selectedClip) return;
    if (!extend && project.clips.length >= 2048) {
      notify("El proyecto admite 2048 clips.");
      return;
    }
    const length =
      selectedClip.lengthBars ??
      project.patterns.find((p) => p.id === selectedClip.patternId)!.length /
        16;
    if (selectedClip.startBar + length * 2 > project.bars) {
      notify("No hay espacio para repetir; amplía el arreglo.");
      return;
    }
    commit((p) => {
      const clip = p.clips.find((c) => c.id === selectedClip.id)!;
      if (extend) {
        clip.lengthBars = length * 2;
        clip.loop = true;
      } else
        p.clips.push({
          ...structuredClone(clip),
          id: id(),
          startBar: clip.startBar + length,
        });
      return p;
    });
  }
  function openNoteTool(tool: NoteTool) {
    setNoteTool(tool);
    setModal("notes");
  }
  function closeNoteTool() {
    previewingNotes.current = false;
    stop();
    setModal(null);
    void engine
      .update(projectRef.current, mode, patternId)
      .catch((error) => notify(String(error)));
  }
  function noteCommand(
    action: "copy" | "cut" | "paste" | "duplicate" | "delete",
  ) {
    const selected = channel.notes.filter(
      (n) => !noteSelection.size || noteSelection.has(n.id),
    );
    if (action === "copy" || action === "cut")
      noteClipboard.current = structuredClone(selected);
    if (action === "copy") {
      notify(`${selected.length} notas copiadas.`);
      return;
    }
    if (action === "cut" || action === "delete") {
      const ids = new Set(selected.map((n) => n.id));
      patchChannel((c) => {
        c.notes = c.notes.filter((n) => !ids.has(n.id));
      });
      setNoteSelection(new Set());
      setSelectedNoteId(null);
      return;
    }
    const source = action === "duplicate" ? selected : noteClipboard.current;
    if (!source.length) return;
    const min = Math.min(...source.map((n) => n.start)),
      max = Math.max(...source.map((n) => n.start + n.length));
    const at =
      action === "duplicate"
        ? max
        : Math.floor(localStep / pianoSnap) * pianoSnap;
    if (
      max - min + at > pattern.length ||
      channel.notes.length + source.length > 2048
    ) {
      notify("Las notas no caben en el patrón; amplía su longitud.");
      return;
    }
    const copies = source.map((n) => ({
      ...n,
      id: id(),
      start: n.start - min + at,
    }));
    patchChannel((c) => c.notes.push(...copies));
    setNoteSelection(new Set(copies.map((n) => n.id)));
    setSelectedNoteId(copies[0].id);
  }

  function beginNote(event: ReactPointerEvent<HTMLDivElement>, pitch: number) {
    if (event.button !== 0 || track.kind === "bus") return;
    const start = clamp(
      (event.clientX - event.currentTarget.getBoundingClientRect().left) /
        (PIANO_WIDTH / pattern.length),
      0,
      pattern.length - pianoSnap,
    );
    const snappedStart = Math.floor(start / pianoSnap) * pianoSnap;
    const note: Note = {
      id: id(),
      pitch,
      start: snappedStart,
      length: Math.min(noteLength, pattern.length - snappedStart),
      velocity: 0.72,
    };
    patchChannel((c) => c.notes.push(note));
    setSelectedNoteId(note.id);
    setNoteSelection(new Set([note.id]));
    void preview(track, pitch);
    pianoDrag.current = {
      id: note.id,
      x: event.clientX,
      y: event.clientY,
      start: snappedStart,
      pitch,
      length: note.length,
      kind: "draw",
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNote(event: ReactPointerEvent) {
    const drag = pianoDrag.current;
    if (!drag) return;
    const delta =
      Math.round((event.clientX - drag.x) / 28 / pianoSnap) * pianoSnap;
    if (drag.kind === "draw" && delta === 0) return;
    patchChannel(
      (c) => {
        const note = c.notes.find((n) => n.id === drag.id);
        if (!note) return;
        if (drag.kind === "move") {
          if (drag.members?.length) {
            const dx = clamp(
              delta,
              -Math.min(...drag.members.map((n) => n.start)),
              pattern.length -
                Math.max(...drag.members.map((n) => n.start + n.length)),
            );
            const dy = clamp(
              -Math.round((event.clientY - drag.y) / PITCH_HEIGHT),
              -Math.min(...drag.members.map((n) => n.pitch)),
              127 - Math.max(...drag.members.map((n) => n.pitch)),
            );
            for (const original of drag.members) {
              const member = c.notes.find((n) => n.id === original.id);
              if (member) {
                member.start = original.start + dx;
                member.pitch = original.pitch + dy;
              }
            }
            return;
          }
          note.start = clamp(
            drag.start + delta,
            0,
            pattern.length - note.length,
          );
          note.pitch = clamp(
            drag.pitch - Math.round((event.clientY - drag.y) / PITCH_HEIGHT),
            pianoLow,
            pianoLow + 35,
          );
        } else
          note.length = clamp(
            drag.kind === "draw" ? delta + pianoSnap : drag.length + delta,
            pianoSnap,
            pattern.length - note.start,
          );
      },
      track.id,
      false,
    );
  }

  async function exportAudio() {
    if (rendering) return;
    setRendering(true);
    try {
      const snapshot = structuredClone(projectRef.current);
      const wav = await engine.export(snapshot, mode, pattern.id);
      download(
        wav,
        `${snapshot.name || "StudioWav"}${mode === "pattern" ? ` - ${pattern.name}` : ""}.wav`,
      );
      notify("WAV estéreo exportado · 44,1 kHz / 16 bits.");
    } catch (error) {
      notify(
        `No se pudo exportar: ${error instanceof Error ? error.message : "error de audio"}`,
      );
    } finally {
      setRendering(false);
    }
  }

  useEffect(() => {
    engine.onStep = setStep;
    engine.onTransport = setPlaying;
    engine.onError = (error) => {
      setPlaying(false);
      notify(
        error instanceof Error
          ? error.message
          : "El motor de audio se detuvo. Vuelve a pulsar reproducir.",
      );
    };
    const interval = setInterval(() => setLevels(engine.levels()), 90);
    return () => {
      clearInterval(interval);
      engine.stop();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (previewingNotes.current) return;
      void engine
        .update(project, mode, patternId)
        .catch((error) =>
          notify(error instanceof Error ? error.message : String(error)),
        );
    }, 150);
    return () => clearTimeout(timer);
  }, [project, mode, patternId]);
  useEffect(() => {
    if (engine.native)
      void engine.request("focus", { trackId: activeTrackId }).catch(() => {});
  }, [activeTrackId]);
  useEffect(() => {
    engine.onMidi = (event) => {
      if (!recordMidi || !engine.status.playing || previewingNotes.current)
        return;
      const current = projectRef.current,
        pat =
          current.patterns.find((p) => p.id === patternRef.current) ??
          current.patterns[0];
      if (event.on) {
        const local = Math.round(event.step) % pat.length;
        const noteId = id();
        midiHeld.current.set(event.note, {
          id: noteId,
          trackId: activeTrackId,
          patternId: pat.id,
          start: local,
          absolute: event.step,
        });
        commit((p) => {
          const c = p.patterns.find((pattern) => pattern.id === pat.id)
            ?.channels[activeTrackId];
          if (c)
            c.notes.push({
              id: noteId,
              pitch: event.note,
              start: local,
              length: 1,
              velocity: event.velocity,
            });
          return p;
        });
      } else {
        const held = midiHeld.current.get(event.note);
        if (!held) return;
        midiHeld.current.delete(event.note);
        let elapsed = event.step - held.absolute;
        if (elapsed < 0)
          elapsed +=
            modeRef.current === "song" ? current.bars * 16 : pat.length;
        commit((p) => {
          const note = p.patterns
            .find((pattern) => pattern.id === held.patternId)
            ?.channels[held.trackId]?.notes.find((n) => n.id === held.id);
          if (note)
            note.length = clamp(Math.round(elapsed), 1, 32 - held.start);
          return p;
        });
      }
    };
    return () => {
      engine.onMidi = () => {};
    };
  }, [recordMidi, activeTrackId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSaved(true);
      } catch {
        setSaved(false);
        notify(
          "El audio supera el guardado local. Guarda el proyecto en un archivo para conservarlo.",
        );
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!engine.native) return;
    const timer = setInterval(() => {
      const snapshot = projectRef.current;
      if (!snapshot.tracks.some((t) => t.plugins?.length)) return;
      void engine
        .capture(snapshot)
        .then((saved) => {
          if (snapshot !== projectRef.current) return;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
            setSaved(true);
          } catch {
            setSaved(false);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function closingState(event: Event) {
      const states = (event as CustomEvent<Record<string, string>>).detail;
      const next = {
        ...projectRef.current,
        tracks: projectRef.current.tracks.map((track) => ({
          ...track,
          plugins: track.plugins?.map((plugin) => ({
            ...plugin,
            state:
              typeof states?.[plugin.id] === "string"
                ? states[plugin.id]
                : plugin.state,
          })),
        })),
      };
      projectRef.current = next;
      setProject(next);
    }
    function flush() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projectRef.current));
      } catch {
        /* Explicit file save remains available. */
      }
    }
    window.addEventListener("beforeunload", flush);
    window.addEventListener("studiowav:plugin-states", closingState);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("studiowav:plugin-states", closingState);
    };
  }, []);

  useEffect(() => {
    if (editor === "piano" && pianoScroll.current) {
      const highest = Math.max(
        pianoLow + 12,
        ...channel.notes.map((n) => n.pitch),
      );
      pianoScroll.current.scrollTop = Math.max(
        0,
        (pianoLow + 35 - highest - 2) * PITCH_HEIGHT,
      );
    }
  }, [editor, windows.piano, activeTrackId, patternId, pianoLow]);

  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (modal) {
        if (event.code === "Escape") {
          event.preventDefault();
          if (modal === "notes") closeNoteTool();
          else setModal(null);
        }
        if (event.code === "Tab") {
          const focusable = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[role="dialog"] button:not(:disabled), [role="dialog"] input, [role="dialog"] select',
            ),
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      const windowKey: Record<string, WindowId> = {
        F5: "playlist",
        F6: "rack",
        F7: "piano",
        F9: "mixer",
      };
      if (windowKey[event.code]) {
        event.preventDefault();
        if (!event.repeat) {
          if (
            event.code === "F7" &&
            !isMelodic(track.instrument) &&
            !channel.notes.length
          )
            selectTrack(
              project.tracks.find((t) => isMelodic(t.instrument)) ?? track,
            );
          showWindow(windowKey[event.code], true);
        }
        return;
      }
      if (event.code === "F8") {
        event.preventDefault();
        setModal("instrument");
        return;
      }
      if (event.code === "F1") {
        event.preventDefault();
        setModal("help");
        return;
      }
      if (
        windowOrder.at(-1) === "piano" &&
        windows.piano &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        const toolKey: Record<string, NoteTool> = {
          KeyQ: "quantize",
          KeyA: "arpeggio",
          KeyL: "legato",
          KeyU: "chop",
          KeyY: "flip",
        };
        if (event.altKey && toolKey[event.code]) {
          event.preventDefault();
          openNoteTool(toolKey[event.code]);
          return;
        }
        if (modifier && event.code === "KeyL") {
          event.preventDefault();
          patchChannel((c) => {
            c.notes = transformNotes(
              c.notes,
              noteSelection,
              "legato",
              defaultToolOptions,
              pattern.length,
            );
          });
          return;
        }
        if (modifier && event.code === "KeyA") {
          event.preventDefault();
          editNotes("select");
          return;
        }
        if (modifier && ["KeyC", "KeyX", "KeyV", "KeyB"].includes(event.code)) {
          event.preventDefault();
          noteCommand(
            (
              {
                KeyC: "copy",
                KeyX: "cut",
                KeyV: "paste",
                KeyB: "duplicate",
              } as const
            )[event.code as "KeyC" | "KeyX" | "KeyV" | "KeyB"],
          );
          return;
        }
      }
      if (modifier && event.code === "KeyL") {
        event.preventDefault();
        stop();
        setMode(mode === "song" ? "pattern" : "song");
        return;
      }
      if (modifier && event.code === "KeyE") {
        event.preventDefault();
        void exportAudio();
        return;
      }
      if (modifier && event.code === "KeyN") {
        event.preventDefault();
        setModal("new");
        return;
      }
      if (modifier && event.code === "KeyT") {
        event.preventDefault();
        setKeyboard((v) => !v);
        return;
      }
      if (event.code === "F10") {
        event.preventDefault();
        setAudioTab("devices");
        setModal("audio");
        return;
      }
      if (modifier && event.code === "KeyS") {
        event.preventDefault();
        saveProject();
        return;
      }
      if (modifier && event.code === "KeyO") {
        event.preventDefault();
        openInput.current?.click();
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (modifier && event.code === "KeyZ") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (modifier && event.code === "KeyY") {
        event.preventDefault();
        redo();
        return;
      }
      if (
        windowOrder.at(-1) === "piano" &&
        windows.piano &&
        modifier &&
        ["ArrowUp", "ArrowDown", "KeyQ"].includes(event.code)
      ) {
        event.preventDefault();
        editNotes(
          event.code === "KeyQ"
            ? "quantize"
            : event.code === "ArrowUp"
              ? "octaveUp"
              : "octaveDown",
        );
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) void togglePlayback();
        return;
      }
      if (event.code === "Escape") {
        stop();
        return;
      }
      if (
        event.code === "Delete" &&
        selectedNoteId &&
        windowOrder.at(-1) === "piano" &&
        windows.piano
      ) {
        noteCommand("delete");
        return;
      }
      if (
        modifier ||
        event.altKey ||
        !keyboard ||
        heldKeys.current.has(event.code)
      )
        return;
      const keyCodes = [
        "KeyA",
        "KeyW",
        "KeyS",
        "KeyE",
        "KeyD",
        "KeyF",
        "KeyT",
        "KeyG",
        "KeyY",
        "KeyH",
        "KeyU",
        "KeyJ",
        "KeyK",
      ];
      const index = keyCodes.indexOf(event.code);
      if (index >= 0) {
        event.preventDefault();
        heldKeys.current.add(event.code);
        void preview(track, (track.instrument === "bass" ? 36 : 60) + index);
      }
    }
    const up = (event: KeyboardEvent) => heldKeys.current.delete(event.code);
    const blur = () => heldKeys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
    return () => previous?.focus();
  }, [modal]);

  useEffect(() => {
    if (!context) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".channel-context"))
        setContext(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        setContext(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape, true);
    };
  }, [context]);

  function editorToolbar(editor: "rack" | "piano" | "mixer") {
    return (
      <div className="pattern-toolbar">
        <span className="pattern-label">
          {editor === "mixer" ? (
            <>
              <SlidersHorizontal size={13} /> CANALES
            </>
          ) : (
            <>
              <Layers3 size={13} /> PATRÓN
            </>
          )}
        </span>
        {editor !== "mixer" && (
          <>
            <select
              aria-label={
                editor === "rack" ? "Patrón activo" : "Patrón del Piano Roll"
              }
              value={pattern.id}
              onChange={(event) => {
                setPatternId(event.target.value);
                setSelectedNoteId(null);
              }}
            >
              {project.patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              onClick={() => addPattern()}
              title="Nuevo patrón"
              aria-label={
                editor === "rack"
                  ? "Nuevo patrón"
                  : "Nuevo patrón desde Piano Roll"
              }
            >
              <Plus size={14} />
            </button>
            <button
              className="icon-button"
              onClick={() => addPattern(true)}
              title="Duplicar patrón"
              aria-label={
                editor === "rack"
                  ? "Duplicar patrón"
                  : "Duplicar patrón desde Piano Roll"
              }
            >
              <Copy size={13} />
            </button>
          </>
        )}
        {editor !== "mixer" && (
          <select
            aria-label={`Longitud del patrón ${editor}`}
            value={pattern.length}
            onChange={(e) => {
              try {
                commit(() =>
                  resizePattern(project, pattern.id, Number(e.target.value)),
                );
              } catch (error) {
                notify((error as Error).message);
              }
            }}
          >
            {[16, 32, 64, 128].map((n) => (
              <option key={n} value={n}>
                {n / 16} {n === 16 ? "compás" : "compases"}
              </option>
            ))}
          </select>
        )}
        <span className="toolbar-spacer" />
        {editor === "piano" ? (
          <>
            <select
              aria-label="Herramienta de notas"
              value=""
              onChange={(e) => {
                if (e.target.value) openNoteTool(e.target.value as NoteTool);
              }}
            >
              <option value="">Herramientas…</option>
              {Object.entries(toolNames).map(([tool, name]) => (
                <option key={tool} value={tool}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Ajuste del Piano Roll"
              value={pianoSnap}
              onChange={(e) => setPianoSnap(Number(e.target.value))}
            >
              {[0.25, 0.5, 1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  Snap 1/{16 / n}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              onClick={() => setPianoLow(clamp(pianoLow - 12, 0, 84))}
              aria-label="Bajar octava"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="octave-label">
              {noteName(pianoLow)}–{noteName(pianoLow + 35)}
            </span>
            <button
              className="icon-button"
              onClick={() => setPianoLow(clamp(pianoLow + 12, 0, 84))}
              aria-label="Subir octava"
            >
              <ChevronRight size={15} />
            </button>
            <select
              aria-label="Duración de nueva nota"
              value={noteLength}
              onChange={(event) => setNoteLength(Number(event.target.value))}
            >
              {[0.25, 0.5, 1, 2, 4, 8, 16].map((length) => (
                <option key={length} value={length}>
                  {length < 1
                    ? `1/${16 / length}`
                    : length === 1
                      ? "1/16"
                      : length === 2
                        ? "1/8"
                        : length === 4
                          ? "1/4"
                          : length === 8
                            ? "1/2"
                            : "1 compás"}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="pattern-length">
            {editor === "mixer"
              ? "ESTÉREO · 44,1 kHz AL EXPORTAR"
              : `${pattern.length} PASOS · ${pattern.length / 16} COMPASES`}
          </span>
        )}
        {editor !== "mixer" && (
          <button
            className="icon-button"
            onClick={() => {
              patchChannel((c) => {
                c.steps.fill(0);
                c.notes = [];
              });
              setSelectedNoteId(null);
            }}
            title="Vaciar el canal seleccionado"
            aria-label={
              editor === "rack"
                ? "Vaciar canal"
                : "Vaciar canal desde Piano Roll"
            }
          >
            <Eraser size={14} />
          </button>
        )}
      </div>
    );
  }

  const viewItems = [
    {
      label: "Playlist",
      shortcut: "F5",
      checked: windows.playlist,
      action: () => showWindow("playlist", true),
    },
    {
      label: "Channel Rack",
      shortcut: "F6",
      checked: windows.rack,
      action: () => showWindow("rack", true),
    },
    {
      label: "Piano Roll",
      shortcut: "F7",
      checked: windows.piano,
      action: () => showWindow("piano", true),
    },
    {
      label: "Mezclador",
      shortcut: "F9",
      checked: windows.mixer,
      action: () => showWindow("mixer", true),
    },
    {
      label: "Navegador",
      checked: browserVisible,
      action: () => setBrowserVisible((v) => !v),
    },
    {
      label: "Ajustes del canal",
      checked: inspectorVisible,
      action: () => setInspectorVisible((v) => !v),
    },
    { label: "Restablecer ventanas", action: resetLayout },
  ];
  return (
    <div
      className="studio fl-workspace"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          const files = [...event.dataTransfer.files];
          const midi = files.find((file) => /\.(mid|midi)$/i.test(file.name));
          if (midi) {
            if (files.length !== 1)
              notify("Arrastra un solo archivo MIDI para elegir sus partes.");
            else void loadMidi(midi);
          } else void importAudio(files);
        }
      }}
    >
      <div className="menu-row">
        <span className="menu-app-name">
          <AudioWaveform size={16} /> STUDIOWAV
        </span>
        <StudioMenu
          menus={[
            {
              label: "ARCHIVO",
              items: [
                {
                  label: "Nuevo proyecto",
                  shortcut: "Ctrl+N",
                  action: () => setModal("new"),
                },
                {
                  label: "Abrir proyecto…",
                  shortcut: "Ctrl+O",
                  action: () => openInput.current?.click(),
                },
                {
                  label: "Guardar proyecto",
                  shortcut: "Ctrl+S",
                  action: () => {
                    void saveProject();
                  },
                },
                {
                  label: "Importar audio…",
                  action: () => audioInput.current?.click(),
                },
                {
                  label: "Importar MIDI…",
                  action: () => midiInput.current?.click(),
                },
                {
                  label: "Exportar patrón MIDI…",
                  action: () => exportMidi("pattern"),
                },
                {
                  label: "Exportar canción MIDI…",
                  action: () => exportMidi("song"),
                },
                {
                  label: "Exportar WAV…",
                  shortcut: "Ctrl+E",
                  action: () => {
                    void exportAudio();
                  },
                  disabled: rendering,
                },
              ],
            },
            {
              label: "EDITAR",
              items: [
                {
                  label: "Deshacer",
                  shortcut: "Ctrl+Z",
                  action: undo,
                  disabled: !undoStack.current.length,
                },
                {
                  label: "Rehacer",
                  shortcut: "Ctrl+Y",
                  action: redo,
                  disabled: !redoStack.current.length,
                },
                {
                  label: "Vaciar canal del patrón",
                  action: () =>
                    patchChannel((c) => {
                      c.steps.fill(0);
                      c.notes = [];
                    }),
                },
              ],
            },
            {
              label: "AÑADIR",
              items: [
                {
                  label: "Instrumento…",
                  shortcut: "F8",
                  action: () => setModal("instrument"),
                },
                {
                  label: "Muestra de audio…",
                  action: () => audioInput.current?.click(),
                },
                {
                  label: "Bus y rutas…",
                  action: () => {
                    setAudioTab("routing");
                    setModal("audio");
                  },
                },
              ],
            },
            {
              label: "PATRONES",
              items: [
                { label: "Nuevo patrón", action: () => addPattern() },
                {
                  label: "Separar por canales",
                  action: () => {
                    try {
                      const result = splitPatternChannels(project, pattern.id);
                      commit(() => result.project);
                      setPatternId(result.patternId);
                    } catch (error) {
                      notify((error as Error).message);
                    }
                  },
                },
                {
                  label: "Clonar patrón",
                  action: () => addPattern(true),
                },
                {
                  label: "Renombrar patrón…",
                  action: () => {
                    setPatternName(pattern.name);
                    setModal("rename");
                  },
                },
              ],
            },
            { label: "VISTA", items: viewItems },
            {
              label: "OPCIONES",
              items: [
                {
                  label: "Configuración de audio y MIDI…",
                  shortcut: "F10",
                  action: () => {
                    setAudioTab("devices");
                    setModal("audio");
                  },
                },
                {
                  label: "Teclado musical",
                  shortcut: "Ctrl+T",
                  checked: keyboard,
                  action: () => setKeyboard((v) => !v),
                },
                {
                  label: "Notas fantasma",
                  checked: ghostNotes,
                  action: () => setGhostNotes((v) => !v),
                },
              ],
            },
            {
              label: "HERRAMIENTAS",
              items: [
                ...Object.entries(toolNames).map(([tool, label]) => ({
                  label: `${label}…`,
                  action: () => openNoteTool(tool as NoteTool),
                })),
                {
                  label: "Cuantizar notas a la rejilla",
                  shortcut: "Ctrl+Q",
                  action: () => editNotes("quantize"),
                },
                {
                  label: "Subir una octava",
                  shortcut: "Ctrl+↑",
                  action: () => editNotes("octaveUp"),
                },
                {
                  label: "Bajar una octava",
                  shortcut: "Ctrl+↓",
                  action: () => editNotes("octaveDown"),
                },
                {
                  label: "Automatización…",
                  action: () => {
                    setAudioTab("automation");
                    setModal("audio");
                  },
                },
              ],
            },
            {
              label: "AYUDA",
              items: [
                {
                  label: "Atajos y guía",
                  shortcut: "F1",
                  action: () => setModal("help"),
                },
              ],
            },
          ]}
        />
        <span className="menu-project-name">
          {project.name}
          {saved ? "" : " *"}
        </span>
      </div>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <AudioWaveform size={24} strokeWidth={2.3} />
          </div>
          <span>
            studio<span className="brand-light">wav</span>
            <small>DESKTOP STUDIO</small>
          </span>
        </div>
        <div className="file-actions">
          <button
            onClick={() => setModal("new")}
            title="Nuevo proyecto"
            aria-label="Nuevo proyecto"
          >
            <FilePlus2 size={16} />
          </button>
          <button
            onClick={() => openInput.current?.click()}
            title="Abrir proyecto · Ctrl+O"
            aria-label="Abrir proyecto"
          >
            <FolderOpen size={17} />
          </button>
          <button
            onClick={saveProject}
            title="Guardar archivo · Ctrl+S"
            aria-label="Guardar proyecto"
          >
            <Save size={16} />
          </button>
          <i />
          <button
            onClick={undo}
            disabled={!undoStack.current.length}
            title="Deshacer · Ctrl+Z"
            aria-label="Deshacer"
          >
            <Undo2 size={16} />
          </button>
          <button
            onClick={redo}
            disabled={!redoStack.current.length}
            title="Rehacer · Ctrl+Y"
            aria-label="Rehacer"
          >
            <Redo2 size={16} />
          </button>
        </div>
        <div className="project-heading">
          <input
            aria-label="Nombre del proyecto"
            value={project.name}
            maxLength={80}
            onChange={(event) =>
              commit((p) => ({ ...p, name: event.target.value }))
            }
          />
          <span>
            <span className={`status-dot ${saved ? "" : "pending"}`} />
            {saved ? "Guardado local" : "Sin guardar"}
          </span>
        </div>
        <div className="header-right">
          <span className="version-tag">
            DESKTOP <b>0.4</b>
          </span>
          <button
            className="audio-settings-button"
            onClick={() => setModal("audio")}
            aria-label="Estudio de audio"
          >
            <Settings2 size={16} />
            Audio
          </button>
          <button
            className="icon-button"
            onClick={() => setModal("help")}
            title="Ayuda y atajos"
            aria-label="Ayuda"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>

      <div className="transport">
        <div className="transport-left">
          <div className="mode-switch">
            <button
              className={mode === "song" ? "active" : ""}
              onClick={() => {
                stop();
                setMode("song");
              }}
            >
              CANCIÓN
            </button>
            <button
              className={mode === "pattern" ? "active" : ""}
              onClick={() => {
                stop();
                setMode("pattern");
              }}
            >
              PATRÓN
            </button>
          </div>
          <button
            className="stop-button"
            onClick={stop}
            aria-label="Detener"
            title="Detener · Esc"
          >
            <Square size={17} fill="currentColor" />
          </button>
          <button
            className={`play-button ${playing ? "playing" : ""}`}
            onClick={() => void togglePlayback()}
            aria-label={playing ? "Pausar" : "Reproducir"}
            title="Reproducir / detener · Espacio"
          >
            {playing ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
        </div>
        <label className="tempo-box">
          <input
            aria-label="Tempo BPM"
            type="number"
            min="40"
            max="240"
            value={project.bpm}
            onChange={(event) =>
              commit((p) => ({
                ...p,
                bpm: clamp(Number(event.target.value) || 40, 40, 240),
              }))
            }
          />
          <span>BPM</span>
        </label>
        <div className="time-box">
          <span>
            {String(Math.floor(step / 16) + 1).padStart(3, "0")}
            <b>:</b>
            {String(Math.floor((step % 16) / 4) + 1).padStart(2, "0")}
            <b>:</b>
            {String((step % 4) + 1).padStart(2, "0")}
          </span>
          <small>
            COMPÁS <i /> TIEMPO <i /> PASO
          </small>
        </div>
        <div className="transport-options">
          <button
            className={`midi-record-button ${recordMidi ? "armed" : ""}`}
            disabled={!engine.native}
            aria-label="Grabar MIDI"
            aria-pressed={recordMidi}
            title="Grabar notas MIDI en el patrón seleccionado"
            onClick={() => {
              setRecordMidi(!recordMidi);
              midiHeld.current.clear();
              notify(
                recordMidi
                  ? "Grabación MIDI desarmada."
                  : "MIDI armado. Reproduce para grabar en el patrón seleccionado.",
              );
            }}
          >
            <Mic size={16} />
          </button>
          <div className="time-signature">
            <span>4/4</span>
            <small>COMPÁS</small>
          </div>
          <label className="swing-control">
            <span>
              SWING <b>{Math.round(project.swing * 100)}%</b>
            </span>
            <input
              aria-label="Swing"
              type="range"
              min="0"
              max="0.6"
              step="0.01"
              value={project.swing}
              onChange={(event) =>
                commit((p) => ({ ...p, swing: Number(event.target.value) }))
              }
            />
          </label>
          <button
            className={`keyboard-button ${keyboard ? "active" : ""}`}
            onClick={() => setKeyboard(!keyboard)}
            title="Activar teclado musical A–K"
            aria-label="Teclado musical"
            aria-pressed={keyboard}
          >
            <KeyboardMusic size={20} />
          </button>
        </div>
        <div className="master-compact">
          <Headphones size={16} />
          <div className="mini-master">
            <span
              style={{ width: `${Math.max(2, (levels.master ?? 0) * 100)}%` }}
            />
          </div>
          <span>{playing ? "AUDIO ACTIVO" : "LISTO"}</span>
        </div>
        <button
          className="export-button"
          onClick={() => void exportAudio()}
          disabled={rendering}
        >
          {rendering ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Download size={16} />
          )}
          <span>{rendering ? "Renderizando…" : "Exportar WAV"}</span>
        </button>
      </div>

      <div className="workspace-tools">
        <div className="window-shortcuts" role="tablist" aria-label="Editores">
          <button
            role="tab"
            aria-selected={
              windowOrder.at(-1) === "playlist" && windows.playlist
            }
            onClick={() => showWindow("playlist")}
            title="Playlist · F5"
          >
            <ListMusic size={16} />
            <span>Playlist</span>
            <kbd>F5</kbd>
          </button>
          <button
            role="tab"
            aria-selected={windowOrder.at(-1) === "rack" && windows.rack}
            onClick={() => showWindow("rack")}
            title="Channel Rack · F6"
          >
            <Grid2X2 size={16} />
            <span>Secuenciador</span>
            <kbd>F6</kbd>
          </button>
          <button
            role="tab"
            aria-selected={windowOrder.at(-1) === "piano" && windows.piano}
            onClick={() => {
              if (!isMelodic(track.instrument) && !channel.notes.length)
                selectTrack(
                  project.tracks.find((t) => isMelodic(t.instrument)) ?? track,
                );
              showWindow("piano");
            }}
            title="Piano Roll · F7"
          >
            <Piano size={16} />
            <span>Piano roll</span>
            <kbd>F7</kbd>
          </button>
          <button
            role="tab"
            aria-selected={windowOrder.at(-1) === "mixer" && windows.mixer}
            onClick={() => showWindow("mixer")}
            title="Mezclador · F9"
          >
            <SlidersHorizontal size={16} />
            <span>Mezclador</span>
            <kbd>F9</kbd>
          </button>
        </div>
        <button
          className={`tool-toggle ${browserVisible ? "active" : ""}`}
          aria-label="Mostrar navegador"
          aria-pressed={browserVisible}
          onClick={() => setBrowserVisible((v) => !v)}
        >
          <FolderOpen size={16} />
        </button>
        <button
          className={`tool-toggle ${inspectorVisible ? "active" : ""}`}
          aria-label="Ajustes del canal"
          aria-pressed={inspectorVisible}
          onClick={() => setInspectorVisible((v) => !v)}
        >
          <Settings2 size={16} />
        </button>
        <span className="hint-bar">
          {track.name} · {pattern.name} · {playing ? "Reproduciendo" : "Listo"}
        </span>
        <button className="layout-reset" onClick={resetLayout}>
          Restablecer ventanas
        </button>
      </div>
      <div className="studio-body">
        <aside className="browser" hidden={!browserVisible}>
          <div className="browser-heading">
            <span>BIBLIOTECA</span>
            <Waves size={16} />
          </div>
          <label className="search-box">
            <Search size={14} />
            <input
              aria-label="Buscar sonidos"
              placeholder="Buscar un sonido…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>⌕</kbd>
          </label>
          <details className="browser-project" open>
            <summary>
              <FolderOpen size={13} /> Proyecto actual
            </summary>
            <button onClick={() => showWindow("playlist")}>
              <ListMusic size={12} /> Playlist{" "}
              <small>{project.clips.length}</small>
            </button>
            <button onClick={() => showWindow("mixer")}>
              <SlidersHorizontal size={12} /> Efectos y mezcla
            </button>
            <button
              onClick={() => {
                setAudioTab("automation");
                setModal("audio");
              }}
            >
              <Activity size={12} /> Automatización
            </button>
          </details>
          <details className="browser-patterns" open>
            <summary>
              <Layers3 size={13} /> Patrones{" "}
              <button
                aria-label="Nuevo patrón desde navegador"
                onClick={(e) => {
                  e.preventDefault();
                  addPattern();
                }}
              >
                <Plus size={12} />
              </button>
            </summary>
            {project.patterns.map((p, i) => (
              <button
                key={p.id}
                draggable
                className={p.id === pattern.id ? "active" : ""}
                aria-label={`Seleccionar patrón ${p.name}`}
                onClick={() => setPatternId(p.id)}
                onDoubleClick={() => showWindow("rack")}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "application/studiowav-pattern",
                    p.id,
                  )
                }
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <Layers3 size={12} />
                {p.name}
                <small>↗</small>
              </button>
            ))}
          </details>
          <div className="library-nav">
            <button
              className={category === "all" ? "active" : ""}
              onClick={() => setCategory("all")}
            >
              <Layers3 size={16} />
              Todos los sonidos <span>08</span>
            </button>
            <button
              className={category === "drums" ? "active" : ""}
              onClick={() => setCategory("drums")}
            >
              <Grid2X2 size={16} />
              Batería
            </button>
            <button
              className={category === "synth" ? "active" : ""}
              onClick={() => setCategory("synth")}
            >
              <Piano size={16} />
              Sintetizadores
            </button>
          </div>
          <div className="library-label">
            STUDIO ESSENTIALS <span>VOL. 01</span>
          </div>
          <div className="preset-list">
            {selectedPresets.map((preset, index) => (
              <div
                key={preset.instrument}
                className="preset-item"
                style={{ "--track-color": preset.color } as CSSProperties}
              >
                <button
                  className="preset-preview"
                  onClick={() => {
                    const existing = project.tracks.find(
                      (t) => t.instrument === preset.instrument,
                    );
                    if (existing) {
                      selectTrack(existing);
                      void preview(existing);
                    } else addInstrument(preset.instrument);
                  }}
                  title={`Escuchar ${preset.name}`}
                >
                  <span className="sample-wave">
                    {Array.from({ length: 11 }, (_, n) => (
                      <i
                        key={n}
                        style={{
                          height: `${5 + Math.abs(Math.sin(n * 1.8 + index)) * 16}px`,
                        }}
                      />
                    ))}
                  </span>
                </button>
                <button
                  className="preset-name"
                  onClick={() => {
                    const existing = project.tracks.find(
                      (t) => t.instrument === preset.instrument,
                    );
                    existing
                      ? selectTrack(existing, isMelodic(existing.instrument))
                      : addInstrument(preset.instrument);
                  }}
                >
                  <span>{preset.name}</span>
                  <small>{preset.tag} · SYNTH</small>
                </button>
                <button
                  className="preset-add"
                  aria-label={`Añadir ${preset.name}`}
                  title={`Añadir ${preset.name}`}
                  onClick={() => addInstrument(preset.instrument)}
                >
                  <Plus size={12} />
                </button>
              </div>
            ))}
            {!selectedPresets.length && (
              <div className="empty-search">No hay sonidos con ese nombre.</div>
            )}
          </div>
          <button
            className="import-zone"
            onClick={() => audioInput.current?.click()}
          >
            <Upload size={22} />
            <strong>Trae tu propio sonido</strong>
            <span>Arrastra audio o haz clic aquí</span>
            <small>WAV · MP3 · OGG · FLAC</small>
          </button>
          <div className="browser-bottom">
            <span className="local-badge">
              <span />
              TODO EN TU EQUIPO
            </span>
            <p>
              Un espacio para encontrar
              <br />
              tu próximo sonido.
            </p>
          </div>
        </aside>

        <main className="workspace">
          <WorkspaceWindow
            id="playlist"
            title={`Playlist — ${project.name}`}
            icon={<ListMusic size={14} />}
            open={windows.playlist}
            active={windowOrder.at(-1) === "playlist"}
            zIndex={windowOrder.indexOf("playlist") + 1}
            onFocus={() => focusWindow("playlist")}
            onClose={() => setWindows((p) => ({ ...p, playlist: false }))}
            resetVersion={layoutVersion}
          >
            <section className="arrangement" aria-label="Arreglo musical">
              <div className="section-heading">
                <div>
                  <ListMusic size={17} />
                  <h1>Arreglo</h1>
                  <span className="playlist-subtitle">Playlist</span>
                  <span className="subtle-tag">{project.bars} COMPASES</span>
                </div>
                <div className="arrangement-tools">
                  <button
                    className="clip-action"
                    disabled={!selectedClip}
                    onClick={uniqueClip}
                  >
                    Hacer único
                  </button>
                  <button
                    className="clip-action"
                    disabled={!selectedClip}
                    onClick={() => repeatClip()}
                  >
                    Duplicar clip
                  </button>
                  <button
                    className="clip-action"
                    disabled={!selectedClip}
                    onClick={() => repeatClip(true)}
                  >
                    Extender bucle
                  </button>
                  <button
                    className="clip-action"
                    disabled={!selectedClip}
                    onClick={() =>
                      commit((p) => {
                        p.clips.find((c) => c.id === selectedClipId)!.muted =
                          !selectedClip?.muted;
                        return p;
                      })
                    }
                  >
                    Silenciar clip
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Añadir pista de Playlist"
                    onClick={addPlaylistLane}
                  >
                    <Plus size={13} />
                  </button>
                  <span className="snap-tag">
                    <Grid2X2 size={12} />
                    <select
                      aria-label="Ajuste de Playlist"
                      value={playlistSnap}
                      onChange={(e) => setPlaylistSnap(Number(e.target.value))}
                    >
                      <option value={1}>1 compás</option>
                      <option value={2}>2 compases</option>
                    </select>
                  </span>
                  <select
                    aria-label="Duración del arreglo"
                    value={project.bars}
                    onChange={(event) =>
                      commit((p) => ({
                        ...p,
                        bars: Number(event.target.value),
                        clips: p.clips.filter(
                          (clip) =>
                            clip.startBar + (clip.lengthBars ?? 2) <=
                            Number(event.target.value),
                        ),
                      }))
                    }
                  >
                    {[8, 16, 32, 64].map((n) => (
                      <option key={n} value={n}>
                        {n} compases
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    onClick={() => setModal("help")}
                    title="Cómo editar el arreglo"
                    aria-label="Ayuda del arreglo"
                  >
                    <CircleHelp size={14} />
                  </button>
                </div>
              </div>
              <div className="playlist-scroll">
                <div
                  className="playlist"
                  style={{ width: 144 + project.bars * BAR_WIDTH }}
                >
                  <div className="timeline">
                    <div className="timeline-corner">
                      <Layers3 size={12} />
                      <span>PISTAS</span>
                    </div>
                    <div className="timeline-bars">
                      {Array.from({ length: project.bars }, (_, i) => (
                        <div
                          key={i}
                          style={{ width: BAR_WIDTH }}
                          className={i % 4 === 0 ? "phrase" : ""}
                        >
                          <span>{String(i + 1).padStart(2, "0")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="playlist-lanes">
                    {lanes.map((t, index) => (
                      <div
                        className={`playlist-row ${activeLaneId === t.id ? "selected" : ""}`}
                        key={t.id}
                        style={tint(t)}
                      >
                        <div className="playlist-track">
                          <span className="track-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <button
                            className="track-title"
                            onClick={() => setActiveLaneId(t.id)}
                            onDoubleClick={() => setActiveLaneId(t.id)}
                          >
                            <span className="track-color" />
                            <span>{t.name}</span>
                          </button>
                          <button
                            className={`track-led ${t.muted ? "off" : ""}`}
                            title={
                              t.muted
                                ? `Activar ${t.name}`
                                : `Silenciar ${t.name}`
                            }
                            aria-label={`Silenciar ${t.name}`}
                            aria-pressed={t.muted}
                            onClick={() =>
                              commit((p) => ({
                                ...p,
                                lanes: playlistLanes(p).map((l) =>
                                  l.id === t.id ? { ...l, muted: !l.muted } : l,
                                ),
                              }))
                            }
                          />
                        </div>
                        <div
                          className="clip-lane"
                          style={{ width: project.bars * BAR_WIDTH }}
                          onClick={(event) =>
                            placeClip(
                              t.id,
                              Math.floor(
                                (event.clientX -
                                  event.currentTarget.getBoundingClientRect()
                                    .left) /
                                  BAR_WIDTH,
                              ),
                            )
                          }
                          onDragOver={(event) => {
                            if (!event.dataTransfer.types.includes("Files"))
                              event.preventDefault();
                          }}
                          onDrop={(event) => {
                            const clipId = event.dataTransfer.getData(
                              "application/studiowav-clip",
                            );
                            const sourcePattern = event.dataTransfer.getData(
                              "application/studiowav-pattern",
                            );
                            if (
                              sourcePattern &&
                              project.patterns.some(
                                (p) => p.id === sourcePattern,
                              )
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              placeClip(
                                t.id,
                                Math.floor(
                                  (event.clientX -
                                    event.currentTarget.getBoundingClientRect()
                                      .left) /
                                    BAR_WIDTH,
                                ),
                                undefined,
                                sourcePattern,
                              );
                              return;
                            }
                            if (clipId) {
                              event.preventDefault();
                              event.stopPropagation();
                              placeClip(
                                t.id,
                                Math.floor(
                                  (event.clientX -
                                    event.currentTarget.getBoundingClientRect()
                                      .left) /
                                    BAR_WIDTH,
                                ),
                                clipId,
                              );
                            }
                          }}
                        >
                          {project.clips
                            .filter(
                              (clip) => (clip.laneId ?? clip.trackId) === t.id,
                            )
                            .map((clip) => {
                              const pat = project.patterns.find(
                                (p) => p.id === clip.patternId,
                              )!;
                              return (
                                <button
                                  key={clip.id}
                                  className={`pattern-clip ${clip.muted ? "muted-clip" : ""} ${selectedClipId === clip.id ? "selected-clip" : ""}`}
                                  draggable
                                  style={{
                                    left: clip.startBar * BAR_WIDTH + 2,
                                    width:
                                      (clip.lengthBars ?? pat.length / 16) *
                                        BAR_WIDTH -
                                      4,
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPatternId(pat.id);
                                    setSelectedClipId(clip.id);
                                    setActiveLaneId(t.id);
                                    if (clip.scope !== "pattern")
                                      selectTrack(
                                        project.tracks.find(
                                          (v) => v.id === clip.trackId,
                                        )!,
                                      );
                                  }}
                                  onDoubleClick={() => {
                                    setPatternId(pat.id);
                                    if (clip.scope === "pattern")
                                      showWindow("rack");
                                    else
                                      selectTrack(
                                        project.tracks.find(
                                          (v) => v.id === clip.trackId,
                                        )!,
                                        true,
                                      );
                                  }}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    commit((p) => ({
                                      ...p,
                                      clips: p.clips.filter(
                                        (c) => c.id !== clip.id,
                                      ),
                                    }));
                                  }}
                                  onDragStart={(event) =>
                                    event.dataTransfer.setData(
                                      "application/studiowav-clip",
                                      clip.id,
                                    )
                                  }
                                  aria-label={`${t.name}, ${pat.name}, compás ${clip.startBar + 1}`}
                                >
                                  <span>{pat.name}</span>
                                  <ClipArt
                                    channel={
                                      clip.scope === "pattern"
                                        ? patternOverview(pat)
                                        : pat.channels[clip.trackId]
                                    }
                                    length={pat.length}
                                  />
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {playing && mode === "song" && (
                    <div
                      className="playhead playlist-playhead"
                      style={{ left: 144 + (step / 16) * BAR_WIDTH }}
                    >
                      <span />
                    </div>
                  )}
                </div>
              </div>
              <div className="playlist-footer">
                <span>
                  <span className="accent-dot" />
                  {project.clips.length} clips <i />
                  {project.tracks.length} pistas
                </span>
                <span>
                  Clic: añadir · Arrastrar: mover · Clic derecho: borrar
                </span>
              </div>
            </section>
          </WorkspaceWindow>
          <WorkspaceWindow
            id="rack"
            title="Channel Rack"
            icon={<Grid2X2 size={14} />}
            open={windows.rack}
            active={windowOrder.at(-1) === "rack"}
            zIndex={windowOrder.indexOf("rack") + 1}
            onFocus={() => focusWindow("rack")}
            onClose={() => setWindows((p) => ({ ...p, rack: false }))}
            resetVersion={layoutVersion}
          >
            <section className="editor editor-rack">
              {editorToolbar("rack")}

              <div className="rack-scroll">
                <div
                  className="rack-beats"
                  style={{
                    minWidth: 248 + pattern.length * 20,
                    gridTemplateColumns: `248px repeat(${pattern.length / 4},minmax(0,1fr))`,
                  }}
                >
                  <span />
                  {Array.from({ length: pattern.length / 4 }, (_, index) => (
                    <div key={index}>
                      {(index % 4) + 1}
                      <small>{index < 4 ? "A" : "B"}</small>
                    </div>
                  ))}
                </div>
                <div
                  className="rack"
                  style={{ minWidth: 248 + pattern.length * 20 }}
                >
                  {project.tracks.map((t, index) => (
                    <div
                      key={t.id}
                      className={`rack-row ${track.id === t.id ? "selected" : ""}`}
                      style={tint(t)}
                    >
                      <div className="rack-track">
                        <button
                          className={`rack-mute ${t.muted ? "off" : ""}`}
                          onClick={() => patchTrack({ muted: !t.muted }, t.id)}
                          aria-label={`Activar canal ${t.name}`}
                        />
                        <Knob
                          label={`Rack, panorama de ${t.name}`}
                          value={t.pan}
                          min={-1}
                          max={1}
                          reset={0}
                          onGrab={() => commit((p) => p)}
                          onChange={(pan) => patchTrack({ pan }, t.id, false)}
                        />
                        <Knob
                          label={`Rack, volumen de ${t.name}`}
                          value={t.gain}
                          reset={0.8}
                          onGrab={() => commit((p) => p)}
                          onChange={(gain) => patchTrack({ gain }, t.id, false)}
                        />
                        <button
                          className="rack-preview"
                          onClick={() => void preview(t)}
                          title={`Escuchar ${t.name}`}
                          aria-label={`Escuchar ${t.name}`}
                        >
                          <Play size={10} fill="currentColor" />
                        </button>
                        <button
                          className="rack-name"
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setContext({
                              x: event.clientX,
                              y: event.clientY,
                              trackId: t.id,
                            });
                          }}
                          onClick={() => selectTrack(t)}
                          onDoubleClick={() => selectTrack(t, true)}
                        >
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          {t.name}
                        </button>
                      </div>
                      {isMelodic(t.instrument) ||
                      pattern.channels[t.id].notes.length > 0 ? (
                        <button
                          className={`rack-melody ${playing ? "running" : ""}`}
                          onClick={() => selectTrack(t, true)}
                          aria-label={`Editar notas de ${t.name}`}
                        >
                          <ClipArt
                            channel={pattern.channels[t.id]}
                            length={pattern.length}
                          />
                          {playing && (
                            <span
                              className="rack-cursor"
                              style={{
                                left: `${(localStep / pattern.length) * 100}%`,
                              }}
                            />
                          )}
                        </button>
                      ) : (
                        <div
                          className="step-buttons"
                          style={{
                            gridTemplateColumns: `repeat(${pattern.length},minmax(0,1fr))`,
                          }}
                        >
                          {pattern.channels[t.id].steps.map(
                            (velocity, index) => (
                              <button
                                key={index}
                                className={`step-button ${Math.floor(index / 4) % 2 ? "alternate" : ""} ${velocity > 0 ? "on" : ""} ${playing && index === localStep ? "current" : ""}`}
                                aria-label={`${t.name}, paso ${index + 1}`}
                                aria-pressed={velocity > 0}
                                onClick={() => {
                                  selectTrack(t);
                                  patchChannel((c) => {
                                    c.steps[index] = c.steps[index] ? 0 : 0.8;
                                  }, t.id);
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  patchChannel((c) => {
                                    c.steps[index] = 0;
                                  }, t.id);
                                }}
                              >
                                <span />
                              </button>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </WorkspaceWindow>
          <WorkspaceWindow
            id="piano"
            title={`Piano Roll — ${track.name}`}
            icon={<Piano size={14} />}
            open={windows.piano}
            active={windowOrder.at(-1) === "piano"}
            zIndex={windowOrder.indexOf("piano") + 1}
            onFocus={() => focusWindow("piano")}
            onClose={() => setWindows((p) => ({ ...p, piano: false }))}
            resetVersion={layoutVersion}
          >
            <section className="editor editor-piano">
              {editorToolbar("piano")}

              <div className="piano-editor">
                {track.kind !== "bus" ? (
                  <>
                    <div className="piano-note-heading">
                      <span style={{ color: track.color }}>
                        <span className="accent-dot" />
                        {track.name}
                      </span>
                      <span>
                        {channel.notes.length} notas <i />
                        Arrastra para mover · Borde derecho: duración · Supr:
                        borrar
                      </span>
                    </div>
                    <div
                      className="piano-scroller"
                      ref={pianoScroll}
                      onScroll={(e) =>
                        setPianoOffset(e.currentTarget.scrollLeft)
                      }
                    >
                      <div
                        className="piano-content"
                        style={{
                          height: 36 * PITCH_HEIGHT,
                          width: 60 + PIANO_WIDTH,
                        }}
                      >
                        <div className="piano-keys">
                          {Array.from(
                            { length: 36 },
                            (_, index) => pianoLow + 35 - index,
                          ).map((pitch) => (
                            <button
                              key={pitch}
                              className={
                                [1, 3, 6, 8, 10].includes(pitch % 12)
                                  ? "black-key"
                                  : "white-key"
                              }
                              onClick={() => void preview(track, pitch)}
                              aria-label={`Tocar ${noteName(pitch)}`}
                            >
                              {pitch % 12 === 0 ? noteName(pitch) : ""}
                            </button>
                          ))}
                        </div>
                        <div
                          className="piano-grid"
                          style={{
                            height: 36 * PITCH_HEIGHT,
                            width: PIANO_WIDTH,
                            minWidth: PIANO_WIDTH,
                            flexBasis: PIANO_WIDTH,
                          }}
                          onPointerMove={moveNote}
                          onPointerUp={() => {
                            pianoDrag.current = null;
                          }}
                          onPointerCancel={() => {
                            pianoDrag.current = null;
                          }}
                        >
                          {Array.from(
                            { length: 36 },
                            (_, index) => pianoLow + 35 - index,
                          ).map((pitch) => (
                            <div
                              className={`piano-lane ${[1, 3, 6, 8, 10].includes(pitch % 12) ? "dark" : ""}`}
                              key={pitch}
                              data-pitch={pitch}
                              onPointerDown={(event) => beginNote(event, pitch)}
                              onPointerMove={moveNote}
                              onPointerUp={() => {
                                pianoDrag.current = null;
                              }}
                            />
                          ))}
                          {ghostNotes &&
                            project.tracks
                              .filter((t) => t.id !== track.id)
                              .flatMap((t) => pattern.channels[t.id].notes)
                              .filter(
                                (n) =>
                                  n.pitch >= pianoLow &&
                                  n.pitch < pianoLow + 36,
                              )
                              .map((n, index) => (
                                <span
                                  className="ghost-note"
                                  key={index}
                                  style={{
                                    left:
                                      (n.start / pattern.length) * PIANO_WIDTH,
                                    top:
                                      (pianoLow + 35 - n.pitch) * PITCH_HEIGHT +
                                      2,
                                    width:
                                      (n.length / pattern.length) *
                                        PIANO_WIDTH -
                                      1,
                                  }}
                                />
                              ))}
                          {channel.notes
                            .filter(
                              (n) =>
                                n.pitch >= pianoLow && n.pitch < pianoLow + 36,
                            )
                            .map((note) => (
                              <button
                                key={note.id}
                                className={`piano-note ${noteSelection.has(note.id) ? "selected" : ""}`}
                                style={{
                                  left:
                                    (note.start / pattern.length) * PIANO_WIDTH,
                                  top:
                                    (pianoLow + 35 - note.pitch) *
                                      PITCH_HEIGHT +
                                    2,
                                  width:
                                    (note.length / pattern.length) *
                                      PIANO_WIDTH -
                                    1,
                                  background: track.color,
                                }}
                                aria-label={`Nota ${noteName(note.pitch)}, paso ${note.start + 1}`}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (event.button !== 0) return;
                                  if (event.ctrlKey || event.shiftKey) {
                                    setNoteSelection((previous) => {
                                      const next = new Set(previous);
                                      next.has(note.id)
                                        ? next.delete(note.id)
                                        : next.add(note.id);
                                      return next;
                                    });
                                    setSelectedNoteId(note.id);
                                    return;
                                  }
                                  const members = channel.notes.filter((n) =>
                                    noteSelection.has(n.id),
                                  );
                                  if (!noteSelection.has(note.id))
                                    setNoteSelection(new Set([note.id]));
                                  setSelectedNoteId(note.id);
                                  void preview(track, note.pitch);
                                  commit((p) => p);
                                  pianoDrag.current = {
                                    id: note.id,
                                    members: noteSelection.has(note.id)
                                      ? structuredClone(members)
                                      : [structuredClone(note)],
                                    x: event.clientX,
                                    y: event.clientY,
                                    start: note.start,
                                    pitch: note.pitch,
                                    length: note.length,
                                    kind: (event.target as HTMLElement).dataset
                                      .resize
                                      ? "resize"
                                      : "move",
                                  };
                                  event.currentTarget.setPointerCapture(
                                    event.pointerId,
                                  );
                                }}
                                onPointerMove={moveNote}
                                onPointerUp={() => {
                                  pianoDrag.current = null;
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  patchChannel((c) => {
                                    c.notes = c.notes.filter(
                                      (n) => n.id !== note.id,
                                    );
                                  });
                                }}
                              >
                                <span>{noteName(note.pitch)}</span>
                                <i data-resize="true" />
                              </button>
                            ))}
                          {playing && (
                            <div
                              className="playhead piano-playhead"
                              style={{
                                left:
                                  (localStep / pattern.length) * PIANO_WIDTH,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="velocity-lane">
                      <span>VELOCIDAD</span>
                      <div
                        style={{
                          width: PIANO_WIDTH,
                          minWidth: PIANO_WIDTH,
                          gridTemplateColumns: `repeat(${pattern.length},1fr)`,
                          transform: `translateX(-${pianoOffset}px)`,
                        }}
                      >
                        {Array.from({ length: pattern.length }, (_, index) => (
                          <input
                            key={index}
                            type="range"
                            aria-label={`Velocidad del paso ${index + 1}`}
                            min="0.05"
                            max="1"
                            step="0.01"
                            disabled={
                              !channel.notes.some(
                                (n) => Math.floor(n.start) === index,
                              )
                            }
                            value={Math.max(
                              0.05,
                              ...channel.notes
                                .filter((n) => Math.floor(n.start) === index)
                                .map((n) => n.velocity),
                            )}
                            onChange={(event) =>
                              patchChannel((c) => {
                                for (const n of c.notes)
                                  if (Math.floor(n.start) === index)
                                    n.velocity = Number(event.target.value);
                              })
                            }
                            style={
                              {
                                "--velocity": `${Math.max(0, ...channel.notes.filter((n) => Math.floor(n.start) === index).map((n) => n.velocity)) * 100}%`,
                              } as CSSProperties
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="editor-empty">
                    <Piano size={28} />
                    <strong>Elige un instrumento melódico</strong>
                    <span>
                      Añade un bajo, unas teclas o un pad para escribir notas.
                    </span>
                    <button onClick={() => setModal("instrument")}>
                      Añadir instrumento
                    </button>
                  </div>
                )}
              </div>
            </section>
          </WorkspaceWindow>
          <WorkspaceWindow
            id="mixer"
            title={`Mezclador — ${track.name}`}
            icon={<SlidersHorizontal size={14} />}
            open={windows.mixer}
            active={windowOrder.at(-1) === "mixer"}
            zIndex={windowOrder.indexOf("mixer") + 1}
            onFocus={() => focusWindow("mixer")}
            onClose={() => setWindows((p) => ({ ...p, mixer: false }))}
            resetVersion={layoutVersion}
          >
            <section className="editor editor-mixer">
              {editorToolbar("mixer")}

              <div className="mixer-layout">
                <div className="mixer">
                  <div className="mixer-strip master-strip">
                    <span className="mixer-number">OUT</span>
                    <strong>Master</strong>
                    <div className="mixer-controls">
                      <input
                        className="vertical-fader"
                        aria-label="Volumen master"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={project.master}
                        onChange={(event) =>
                          commit((p) => ({
                            ...p,
                            master: Number(event.target.value),
                          }))
                        }
                      />
                      <div className="level-meter">
                        <span
                          style={{ transform: `scaleY(${levels.master ?? 0})` }}
                        />
                      </div>
                    </div>
                    <span className="db-label">
                      {decibels(project.master)} <small>dB</small>
                    </span>
                    <Headphones size={14} />
                  </div>
                  {project.tracks.map((t, index) => (
                    <div
                      key={t.id}
                      className={`mixer-strip ${track.id === t.id ? "selected" : ""}`}
                      style={tint(t)}
                      onClick={() => selectTrack(t)}
                    >
                      <span className="mixer-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong title={t.name}>{t.name}</strong>
                      <div className="mixer-controls">
                        <input
                          className="vertical-fader"
                          aria-label={`Mezclador, volumen de ${t.name}`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={t.gain}
                          onChange={(event) =>
                            patchTrack(
                              { gain: Number(event.target.value) },
                              t.id,
                            )
                          }
                        />
                        <div className="level-meter">
                          <span
                            style={{
                              transform: `scaleY(${levels[t.id] ?? 0})`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="db-label">
                        {decibels(t.gain)} <small>dB</small>
                      </span>
                      <div className="mixer-switches">
                        <button
                          className={t.muted ? "muted" : ""}
                          aria-label={`Mute ${t.name}`}
                          aria-pressed={t.muted}
                          onClick={() => patchTrack({ muted: !t.muted }, t.id)}
                        >
                          M
                        </button>
                        <button
                          className={t.solo ? "solo" : ""}
                          aria-label={`Solo ${t.name}`}
                          aria-pressed={t.solo}
                          onClick={() => patchTrack({ solo: !t.solo }, t.id)}
                        >
                          S
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <MixerEffects
                  track={track}
                  project={project}
                  engine={engine}
                  onPlugins={() => {
                    setAudioTab("plugins");
                    setModal("audio");
                  }}
                  onRouting={() => {
                    setAudioTab("routing");
                    setModal("audio");
                  }}
                  onBypass={(index) =>
                    patchTrack({
                      plugins: track.plugins?.map((p, i) =>
                        i === index ? { ...p, bypassed: !p.bypassed } : p,
                      ),
                    })
                  }
                  notify={notify}
                />
              </div>
            </section>
          </WorkspaceWindow>
        </main>

        <aside
          className="inspector"
          hidden={!inspectorVisible}
          style={tint(track)}
        >
          <div className="inspector-heading">
            <Settings2 size={15} />
            <span>AJUSTES DEL CANAL</span>
            <button
              className="icon-button"
              aria-label="Cerrar ajustes del canal"
              onClick={() => setInspectorVisible(false)}
            >
              <X size={12} />
            </button>
            <span className="inspector-number">
              {String(project.tracks.indexOf(track) + 1).padStart(2, "0")}
            </span>
          </div>
          <button
            className="inspector-audio-button"
            onClick={() => setModal("audio")}
          >
            <SlidersHorizontal size={14} />
            Rutas, efectos y grabación
          </button>
          <div className="instrument-card">
            <div className="instrument-symbol">
              {isMelodic(track.instrument) ? (
                <Piano size={27} />
              ) : (
                <AudioLines size={27} />
              )}
            </div>
            <span className="instrument-type">
              {track.instrument === "sample"
                ? "SAMPLER"
                : isMelodic(track.instrument)
                  ? "SINTETIZADOR"
                  : "DRUM SYNTH"}
            </span>
            <input
              aria-label="Nombre de la pista"
              value={track.name}
              maxLength={40}
              onChange={(event) => patchTrack({ name: event.target.value })}
            />
            <button className="audition-button" onClick={() => void preview()}>
              <Play size={11} fill="currentColor" />
              Escuchar sonido
            </button>
          </div>
          <div className="inspector-section">
            <div className="inspector-section-title">
              CANAL{" "}
              <div>
                <button
                  className={track.muted ? "muted" : ""}
                  onClick={() => patchTrack({ muted: !track.muted })}
                  aria-label="Silenciar pista seleccionada"
                  aria-pressed={track.muted}
                >
                  M
                </button>
                <button
                  className={track.solo ? "solo" : ""}
                  onClick={() => patchTrack({ solo: !track.solo })}
                  aria-label="Solo de pista seleccionada"
                  aria-pressed={track.solo}
                >
                  S
                </button>
              </div>
            </div>
            <label className="control-label">
              <span>
                Volumen <b>{decibels(track.gain)} dB</b>
              </span>
              <input
                aria-label="Volumen de pista"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={track.gain}
                onChange={(event) =>
                  patchTrack({ gain: Number(event.target.value) })
                }
              />
            </label>
            <label className="control-label">
              <span>
                Panorama{" "}
                <b>
                  {track.pan === 0
                    ? "Centro"
                    : `${Math.round(Math.abs(track.pan) * 100)}${track.pan < 0 ? " L" : " R"}`}
                </b>
              </span>
              <input
                aria-label="Panorama de pista"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={track.pan}
                onDoubleClick={() => patchTrack({ pan: 0 })}
                onChange={(event) =>
                  patchTrack({ pan: Number(event.target.value) })
                }
              />
            </label>
            <div className="pan-labels">
              <span>L</span>
              <span>R</span>
            </div>
          </div>
          <div className="inspector-section">
            <div className="inspector-section-title">
              COLOR DEL SONIDO <Activity size={13} />
            </div>
            <label className="control-label">
              <span>
                Filtro paso bajo{" "}
                <b>
                  {track.cutoff >= 1000
                    ? `${(track.cutoff / 1000).toFixed(1)} kHz`
                    : `${track.cutoff} Hz`}
                </b>
              </span>
              <input
                aria-label="Filtro paso bajo"
                type="range"
                min="80"
                max="20000"
                step="10"
                value={track.cutoff}
                onChange={(event) =>
                  patchTrack({ cutoff: Number(event.target.value) })
                }
              />
            </label>
            <div className="filter-display">
              <svg viewBox="0 0 180 42">
                <path
                  d={`M 0 10 L ${Math.max(8, (track.cutoff / 20000) * 135)} 10 Q ${Math.max(15, (track.cutoff / 20000) * 135 + 12)} 10 ${Math.max(25, (track.cutoff / 20000) * 135 + 23)} 37 L 180 37`}
                />
              </svg>
              <span>LOW PASS · 12 dB</span>
            </div>
            <label className="control-label">
              <span>
                Envío al delay <b>{Math.round((track.send / 0.6) * 100)}%</b>
              </span>
              <input
                aria-label="Envío al delay"
                type="range"
                min="0"
                max="0.6"
                step="0.01"
                value={track.send}
                onChange={(event) =>
                  patchTrack({ send: Number(event.target.value) })
                }
              />
            </label>
          </div>
          {selectedNote && editor === "piano" && (
            <div className="inspector-section">
              <div className="inspector-section-title">
                NOTA · {noteName(selectedNote.pitch)}
              </div>
              <label className="control-label">
                <span>
                  Velocidad <b>{Math.round(selectedNote.velocity * 127)}</b>
                </span>
                <input
                  aria-label="Velocidad de nota"
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={selectedNote.velocity}
                  onChange={(event) =>
                    patchChannel((c) => {
                      const n = c.notes.find((n) => n.id === selectedNote.id);
                      if (n) n.velocity = Number(event.target.value);
                    })
                  }
                />
              </label>
            </div>
          )}
          <div className="inspector-bottom">
            <button
              onClick={() => {
                if (project.tracks.length === 1) return;
                stop();
                commit((p) => {
                  p.tracks = p.tracks.filter((t) => t.id !== track.id);
                  for (const target of p.tracks) {
                    if (target.outputId === track.id)
                      target.outputId = "master";
                    target.sends = target.sends?.filter(
                      (s) => s.trackId !== track.id,
                    );
                  }
                  p.clips = p.clips
                    .filter(
                      (c) => c.scope === "pattern" || c.trackId !== track.id,
                    )
                    .map((c) =>
                      c.scope === "pattern" && c.trackId === track.id
                        ? { ...c, trackId: p.tracks[0].id }
                        : c,
                    );
                  p.patterns.forEach((pat) => {
                    delete pat.channels[track.id];
                  });
                  const used = new Set(p.tracks.map((t) => t.sampleId));
                  p.samples = p.samples.filter((s) => used.has(s.id));
                  return p;
                });
                setActiveTrackId(
                  project.tracks.find((t) => t.id !== track.id)!.id,
                );
              }}
              disabled={project.tracks.length === 1}
            >
              <Trash2 size={13} />
              Eliminar pista
            </button>
            <div className="inspector-tip">
              <KeyboardMusic size={15} />
              <span>
                Prueba tus sonidos
                <br />
                con las teclas <b>A–K</b>
              </span>
            </div>
          </div>
        </aside>
      </div>
      <footer className="status-bar">
        <span>
          <span className="status-dot" />
          {engine.status.recording
            ? "● Grabando audio"
            : playing
              ? "Reproduciendo"
              : "Motor de audio listo"}
          <i />
          {mode === "song" ? "Modo canción" : "Modo patrón"}
        </span>
        <span className="status-center">
          {engine.native ? "MOTOR NATIVO" : "WEB AUDIO"} ·{" "}
          {project.tracks.length} canales · {project.patterns.length} patrones
        </span>
        <span>
          <KeyboardMusic size={12} /> Espacio: reproducir <i /> Ctrl+S: guardar
        </span>
      </footer>
      {context && (
        <div
          className="channel-context menu-popup"
          role="menu"
          aria-label="Opciones del canal"
          style={{
            left: Math.min(context.x, window.innerWidth - 240),
            top: Math.min(context.y, window.innerHeight - 330),
          }}
        >
          <div className="context-caption">
            {project.tracks.find((t) => t.id === context.trackId)?.name}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              const t = project.tracks.find((t) => t.id === context.trackId)!;
              selectTrack(t, true);
              setContext(null);
            }}
          >
            Piano Roll <kbd>F7</kbd>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              selectTrack(
                project.tracks.find((t) => t.id === context.trackId)!,
              );
              setInspectorVisible(true);
              setContext(null);
            }}
          >
            Ajustes del canal
          </button>
          {[2, 4, 8].map((every) => (
            <button
              key={every}
              role="menuitem"
              onClick={() => {
                patchChannel((c) => {
                  c.steps = c.steps.map((_, i) => (i % every === 0 ? 0.8 : 0));
                }, context.trackId);
                setContext(null);
              }}
            >
              Rellenar cada {every} pasos
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              channelClipboard.current = structuredClone(
                pattern.channels[context.trackId],
              );
              setContext(null);
            }}
          >
            Copiar canal
          </button>
          <button
            role="menuitem"
            disabled={!channelClipboard.current}
            onClick={() => {
              const copied = channelClipboard.current!;
              patchChannel((c) => {
                c.steps = [...copied.steps];
                c.notes = copied.notes.map((n) => ({ ...n, id: id() }));
              }, context.trackId);
              setContext(null);
            }}
          >
            Pegar canal
          </button>
          <button
            role="menuitem"
            onClick={() => {
              patchChannel((c) => {
                c.steps.fill(0);
                c.notes = [];
              }, context.trackId);
              setContext(null);
            }}
          >
            Vaciar canal
          </button>
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <span className="status-dot" />
          {message}
          <button aria-label="Cerrar aviso" onClick={() => setMessage("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <input
        hidden
        ref={openInput}
        type="file"
        accept=".studiowav,.json"
        onChange={(event) => {
          void openProject(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={audioInput}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
        multiple
        onChange={(event) => {
          void importAudio([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={midiInput}
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        onChange={(event) => {
          void loadMidi(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {pendingMidi && (
        <MidiImportPanel
          song={pendingMidi.song}
          fileName={pendingMidi.name}
          project={project}
          onClose={() => setPendingMidi(null)}
          onImport={acceptMidi}
        />
      )}
      {modal === "notes" && (
        <NoteToolsPanel
          tool={noteTool}
          notes={channel.notes}
          selected={noteSelection}
          length={pattern.length}
          onClose={closeNoteTool}
          onApply={(notes) => {
            previewingNotes.current = false;
            stop();
            patchChannel((c) => {
              c.notes = notes;
            });
            setModal(null);
            setNoteSelection(new Set());
          }}
          onListen={(notes) => {
            stop();
            previewingNotes.current = true;
            const temporary = structuredClone(project);
            temporary.patterns.find((p) => p.id === patternId)!.channels[
              track.id
            ].notes = notes;
            setPlaying(true);
            void engine
              .start(
                () => temporary,
                () => "pattern",
                () => patternId,
              )
              .catch((error) => {
                stop();
                notify(String(error));
              });
          }}
        />
      )}
      {modal === "audio" && (
        <AudioPanel
          engine={engine}
          initialTab={audioTab}
          project={project}
          track={track}
          mode={mode}
          patternId={patternId}
          step={step}
          onClose={() => setModal(null)}
          onChange={(next) => commit(() => next)}
          notify={notify}
          onRecord={async (data) => {
            const before = projectRef.current.tracks.length;
            await importAudio([
              new File([dataUrlBytes(data)], `Toma ${Date.now()}.wav`, {
                type: "audio/wav",
              }),
            ]);
            if (projectRef.current.tracks.length === before)
              throw new Error(
                "La toma se conserva en la carpeta de grabaciones; no se pudo añadir al proyecto.",
              );
          }}
        />
      )}
      {modal && modal !== "audio" && modal !== "notes" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div
            className={`modal ${modal === "instrument" ? "instrument-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "rename"
                ? "Renombrar patrón"
                : modal === "instrument"
                  ? "Añadir instrumento"
                  : modal === "new"
                    ? "Nuevo proyecto"
                    : "Ayuda"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setModal(null)}
              aria-label="Cerrar ventana"
            >
              <X size={19} />
            </button>
            <span className="eyebrow">STUDIOWAV</span>
            {modal === "rename" ? (
              <form
                className="rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!patternName.trim()) return;
                  commit((p) => {
                    p.patterns.find((v) => v.id === pattern.id)!.name =
                      patternName.trim().slice(0, 60);
                    return p;
                  });
                  setModal(null);
                }}
              >
                <h2>Renombrar patrón</h2>
                <input
                  autoFocus
                  aria-label="Nombre del patrón"
                  value={patternName}
                  maxLength={60}
                  onChange={(event) => setPatternName(event.target.value)}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!patternName.trim()}
                >
                  Guardar nombre
                </button>
              </form>
            ) : modal === "instrument" ? (
              <>
                <h2>Encuentra tu siguiente sonido.</h2>
                {engine.native && (
                  <InstrumentLibrary
                    engine={engine}
                    onAdd={addVstInstrument}
                    notify={notify}
                  />
                )}
                <p>
                  Instrumentos sintetizados en tu equipo, listos para tocar.
                </p>
                <div className="instrument-options">
                  {presets.map((preset) => (
                    <button
                      key={preset.instrument}
                      style={{ "--track-color": preset.color } as CSSProperties}
                      onClick={() => addInstrument(preset.instrument)}
                    >
                      <span>
                        {isMelodic(preset.instrument) ? (
                          <Piano size={22} />
                        ) : (
                          <AudioLines size={22} />
                        )}
                      </span>
                      <div>
                        <strong>{preset.name}</strong>
                        <small>{preset.description}</small>
                      </div>
                      <Plus size={17} />
                    </button>
                  ))}
                </div>
                <button
                  className="modal-import"
                  onClick={() => {
                    setModal(null);
                    audioInput.current?.click();
                  }}
                >
                  <Upload size={16} />
                  Importar un archivo de audio
                </button>
              </>
            ) : modal === "new" ? (
              <>
                <h2>Todo empieza con una idea.</h2>
                <p>
                  El proyecto actual seguirá disponible en Deshacer. Guárdalo
                  como archivo si quieres conservar una copia.
                </p>
                <div className="new-project-options">
                  <button
                    onClick={() => {
                      stop();
                      const p = createProject(false);
                      commit(() => p);
                      setPatternId(p.patterns[0].id);
                      setActiveTrackId(p.tracks[0].id);
                      setModal(null);
                    }}
                  >
                    <Plus size={24} />
                    <strong>Proyecto vacío</strong>
                    <span>Un lienzo para empezar desde cero.</span>
                  </button>
                  <button
                    onClick={() => {
                      stop();
                      const p = createProject();
                      commit(() => p);
                      setPatternId(p.patterns[0].id);
                      setActiveTrackId(p.tracks[0].id);
                      setModal(null);
                    }}
                  >
                    <Music2 size={24} />
                    <strong>Midnight session</strong>
                    <span>Explora el proyecto de demostración.</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Tu estudio, a tu ritmo.</h2>
                <p>
                  Programa una batería, escribe notas y convierte tus patrones
                  en una canción.
                </p>
                <div className="help-grid">
                  <div>
                    <kbd>F5 / F6 / F7 / F9</kbd>
                    <span>
                      Playlist · Channel Rack · Piano Roll · Mezclador
                    </span>
                  </div>
                  <div>
                    <kbd>F10</kbd>
                    <span>Audio y MIDI</span>
                  </div>
                  <div>
                    <kbd>Ctrl + L</kbd>
                    <span>Alternar canción / patrón</span>
                  </div>
                  <div>
                    <kbd>Ctrl + Q</kbd>
                    <span>Cuantizar notas a la rejilla del Piano Roll</span>
                  </div>
                  <div>
                    <kbd>Espacio</kbd>
                    <span>Reproducir o detener</span>
                  </div>
                  <div>
                    <kbd>A–K</kbd>
                    <span>Tocar el instrumento seleccionado</span>
                  </div>
                  <div>
                    <kbd>Ctrl + S</kbd>
                    <span>Guardar proyecto con sus muestras</span>
                  </div>
                  <div>
                    <kbd>Ctrl + O</kbd>
                    <span>Abrir un proyecto</span>
                  </div>
                  <div>
                    <kbd>Ctrl + Z</kbd>
                    <span>Deshacer · Ctrl+Y para rehacer</span>
                  </div>
                  <div>
                    <kbd>Supr</kbd>
                    <span>Borrar la nota seleccionada</span>
                  </div>
                </div>
                <div className="help-note">
                  <strong>Arreglo</strong>
                  <p>
                    Haz clic en un espacio vacío para colocar el patrón activo.
                    Arrastra los clips para moverlos. Un doble clic abre las
                    notas y el clic derecho borra un clip.
                  </p>
                  <strong>Piano roll</strong>
                  <p>
                    Haz clic para crear notas. Arrastra una nota para moverla o
                    su borde derecho para cambiar la duración. Ajusta su
                    velocidad en el inspector.
                  </p>
                  <strong>Exportación</strong>
                  <p>
                    Exportar WAV renderiza el modo seleccionado: toda la canción
                    o el patrón activo. El escritorio utiliza el motor C++, con
                    ASIO/WASAPI, instrumentos propios, muestras y efectos VST3.
                    Abre Audio para grabar, configurar MIDI, rutas y
                    automatización.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
