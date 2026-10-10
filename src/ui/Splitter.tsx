import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  /** 境目の名前（読み上げ用） */
  label: string;
  /** いまの幅（px） */
  value: number;
  min: number;
  max: number;
  /** 右へドラッグしたとき幅が増えるなら 1、減るなら -1（右側の枠の境目） */
  direction: 1 | -1;
  onChange: (width: number) => void;
}

/** 枠の境目。ドラッグするか、左右の矢印キーで幅を変える */
export function Splitter({ label, value, min, max, direction, onChange }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (width: number) => Math.round(Math.max(min, Math.min(max, width)));

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (start.current) onChange(clamp(start.current.width + (e.clientX - start.current.x) * direction));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // ドラッグ中に文字が選択されたり、カーソルの形が変わったりしないようにする
    document.body.classList.add("resizing");
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing");
    };
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    onChange(clamp(value + (e.key === "ArrowRight" ? 20 : -20) * direction));
  };

  return (
    <div
      className={dragging ? "splitter dragging" : "splitter"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="ドラッグで幅を変えられます"
      onMouseDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, width: value };
        setDragging(true);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
