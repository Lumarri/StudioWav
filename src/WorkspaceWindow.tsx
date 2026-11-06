import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, PointerEvent } from "react";
import { Maximize2, Minus, Minimize2, X } from "lucide-react";

type Rect = { x: number; y: number; width: number; height: number };
export type WindowId = "playlist" | "rack" | "piano" | "mixer";
const defaults: Record<WindowId, Rect> = {
  playlist: { x: 0, y: 0, width: 1100, height: 780 },
  rack: { x: 20, y: 38, width: 960, height: 356 },
  piano: { x: 34, y: 58, width: 1040, height: 560 },
  mixer: { x: 16, y: 350, width: 1090, height: 400 },
};
const key = (id: WindowId) => `studiowav.window.${id}.v1`;
function initial(id: WindowId) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(id)) ?? "null");
    if (
      saved &&
      Object.values(saved).length === 4 &&
      [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)
    ) {
      return {
        x: Math.max(0, saved.x),
        y: Math.max(0, saved.y),
        width: Math.max(480, saved.width),
        height: Math.max(240, saved.height),
      } as Rect;
    }
  } catch {
    /* A stale layout must not block startup. */
  }
  return defaults[id];
}

export function WorkspaceWindow({
  id,
  title,
  icon,
  open,
  zIndex,
  active,
  onFocus,
  onClose,
  children,
  resetVersion,
}: {
  id: WindowId;
  title: string;
  icon: ReactNode;
  open: boolean;
  active: boolean;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
  resetVersion: number;
}) {
  const [rect, setRect] = useState<Rect>(() => initial(id));
  const [maximized, setMaximized] = useState(id === "playlist");
  const element = useRef<HTMLElement>(null);
  const drag = useRef<{
    rect: Rect;
    x: number;
    y: number;
    kind: "move" | "resize";
  } | null>(null);
  const resetRef = useRef(resetVersion);
  function fit(value: Rect): Rect {
    const parent = element.current?.parentElement;
    if (!parent) return value;
    const width = Math.min(Math.max(480, value.width), parent.clientWidth);
    const height = Math.min(Math.max(240, value.height), parent.clientHeight);
    return {
      width,
      height,
      x: Math.max(0, Math.min(value.x, parent.clientWidth - width)),
      y: Math.max(0, Math.min(value.y, parent.clientHeight - height)),
    };
  }
  useEffect(() => {
    const parent = element.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() =>
      setRect((previous) => fit(previous)),
    );
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key(id), JSON.stringify(rect));
    } catch {
      /* Optional UI preference. */
    }
  }, [id, rect]);
  useEffect(() => {
    if (resetRef.current === resetVersion) return;
    resetRef.current = resetVersion;
    setRect(fit(defaults[id]));
    setMaximized(id === "playlist");
  }, [resetVersion, id]);
  function begin(event: PointerEvent<HTMLElement>, kind: "move" | "resize") {
    if (
      event.button !== 0 ||
      maximized ||
      (event.target as HTMLElement).closest("button, input, select")
    )
      return;
    event.preventDefault();
    drag.current = { rect, x: event.clientX, y: event.clientY, kind };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    setRect(
      fit(
        start.kind === "move"
          ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
          : {
              ...start.rect,
              width: start.rect.width + dx,
              height: start.rect.height + dy,
            },
      ),
    );
  }
  return (
    <section
      ref={element}
      hidden={!open}
      data-window={id}
      aria-label={title}
      className={`daw-window ${maximized ? "maximized" : ""} ${active ? "focused" : ""}`}
      style={
        {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          zIndex,
        } as CSSProperties
      }
      onPointerDownCapture={onFocus}
    >
      <header
        className="window-titlebar"
        onPointerDown={(event) => begin(event, "move")}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button"))
            setMaximized(!maximized);
        }}
      >
        <span className="window-title">
          {icon}
          {title}
        </span>
        <div className="window-buttons">
          <button
            aria-label={`Minimizar ${title}`}
            title="Ocultar ventana"
            onClick={onClose}
          >
            <Minus size={12} />
          </button>
          <button
            aria-label={`Maximizar ${id}`}
            title="Maximizar / restaurar"
            onClick={() => setMaximized(!maximized)}
          >
            {maximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button
            aria-label={`Cerrar ${id}`}
            title="Cerrar ventana"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
      </header>
      {open && <div className="window-content">{children}</div>}
      {!maximized && (
        <div
          className="window-resize"
          aria-hidden="true"
          onPointerDown={(event) => begin(event, "resize")}
          onPointerMove={move}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      )}
    </section>
  );
}
