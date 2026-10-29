"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

export type MenuChoice = "records" | "farms" | "voice";

const MENU_ITEMS: Array<{ choice: MenuChoice; label: string }> = [
  { choice: "records", label: "My records" },
  { choice: "farms", label: "Farms" },
  { choice: "voice", label: "Voice settings" },
];

export default function ChatHeader({
  farmName,
  menuButtonRef,
  onChoose,
}: {
  farmName: string;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onChoose: (choice: MenuChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        ) ?? [],
      );
    items()[0]?.focus();

    function close(returnFocus: boolean) {
      setOpen(false);
      if (returnFocus) menuButtonRef.current?.focus();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === "Tab") {
        close(false);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const list = items();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !menuButtonRef.current?.contains(target)
      ) {
        close(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, menuButtonRef]);

  return (
    <header className="chat-header">
      <span className="avatar" aria-hidden="true">
        {farmName.charAt(0).toUpperCase()}
      </span>
      <div className="chat-title">
        <h1>{farmName}</h1>
        <p>Tilly · your farm&apos;s memory</p>
      </div>
      <div className="menu-anchor">
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button header-menu-button"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="19" r="2" fill="currentColor" />
          </svg>
        </button>
        {open && (
          <div ref={menuRef} className="menu" role="menu" aria-label="Menu">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.choice}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onChoose(item.choice);
                }}
              >
                {item.label}
              </button>
            ))}
            <p className="menu-note">
              Private by design. Your records are tied to this browser; clearing
              browser data starts a new farm.
            </p>
          </div>
        )}
      </div>
    </header>
  );
}
