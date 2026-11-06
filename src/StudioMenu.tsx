import { useEffect, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  shortcut?: string;
  action: () => void;
  checked?: boolean;
  disabled?: boolean;
};
export function StudioMenu({
  menus,
}: {
  menus: { label: string; items: MenuItem[] }[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open === null) return;
    function dismiss(event: globalThis.PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <nav
      className="studio-menu"
      ref={root}
      aria-label="Menú principal"
      role="menubar"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(null);
          root.current
            ?.querySelectorAll<HTMLButtonElement>(".menu-trigger")
            [open ?? 0]?.focus();
        }
        if (["ArrowDown", "ArrowUp"].includes(event.key) && open !== null) {
          event.preventDefault();
          const buttons = [
            ...root.current!.querySelectorAll<HTMLButtonElement>(
              ".menu-popup button:not(:disabled)",
            ),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
        if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          const index =
            (open ??
              menus.findIndex(
                (m) => m.label === (event.target as HTMLElement).textContent,
              )) + (event.key === "ArrowRight" ? 1 : -1);
          const next = (index + menus.length) % menus.length;
          if (open !== null) setOpen(next);
          root.current
            ?.querySelectorAll<HTMLButtonElement>(".menu-trigger")
            [next]?.focus();
        }
      }}
    >
      {menus.map((menu, index) => (
        <div className="menu-group" key={menu.label}>
          <button
            role="menuitem"
            className={`menu-trigger ${open === index ? "active" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === index}
            onClick={() => setOpen(open === index ? null : index)}
            onPointerEnter={() => {
              if (open !== null) setOpen(index);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && open === null) {
                event.preventDefault();
                setOpen(index);
              }
            }}
          >
            {menu.label}
          </button>
          {open === index && (
            <div className="menu-popup" role="menu" aria-label={menu.label}>
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                  }
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(null);
                    item.action();
                  }}
                >
                  <span className="menu-check">{item.checked ? "✓" : ""}</span>
                  <span>{item.label}</span>
                  <kbd>{item.shortcut}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
