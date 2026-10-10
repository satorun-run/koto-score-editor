import { useEffect, useRef, useState } from "react";
import { downloadText } from "../editor/files";
import {
  ACTIONS, actionLabel, assignKey, bindingFromEvent, defaultKeymap, findConflict, formatBinding, normalizeKeymap,
  type KeyBinding, type Keymap, type Preset,
} from "../editor/keymap";

interface Props {
  keymap: Keymap;
  onChange: (keymap: Keymap) => void;
  onClose: () => void;
}

interface Pending {
  action: string;
  binding: KeyBinding;
  conflict: string;
}

/** キー割り当ての設定。SPEC.md 6.5 */
export function KeymapDialog({ keymap, onChange, onClose }: Props) {
  const [capturing, setCapturing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(null);
        return;
      }
      const binding = bindingFromEvent(e);
      if (!binding) return;
      const conflict = findConflict(keymap, binding, capturing);
      if (conflict) setPending({ action: capturing, binding, conflict });
      else onChange(assignKey(keymap, capturing, binding));
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, keymap, onChange]);

  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  const reset = (preset: Preset) => {
    setPending(null);
    onChange(defaultKeymap(preset));
  };
  const importFile = async (file: File) => {
    try {
      onChange(normalizeKeymap(JSON.parse(await file.text()), defaultKeymap("jis")));
    } catch {
      window.alert("キー設定ファイルを読めませんでした。");
    }
  };

  return (
    <div className="dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !capturing) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="キー割り当て">
        <header>
          <h1>キー割り当て</h1>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="dialog-tools">
          <button type="button" onClick={() => reset("jis")}>初期値に戻す（JIS配列）</button>
          <button type="button" onClick={() => reset("us")}>初期値に戻す（US配列）</button>
          <button type="button" onClick={() => downloadText("koto-keymap.json", JSON.stringify(keymap, null, 2), "application/json")}>ファイルに書き出す</button>
          <button type="button" onClick={() => fileRef.current?.click()}>ファイルから読み込む</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
        </div>
        {pending && (
          <div className="conflict">
            <p>
              「{formatBinding(pending.binding)}」は「{actionLabel(pending.conflict)}」に割り当て済みです。
              「{actionLabel(pending.action)}」に割り当て直しますか（元の操作からは外れます）。
            </p>
            <button type="button" onClick={() => { onChange(assignKey(keymap, pending.action, pending.binding)); setPending(null); }}>割り当て直す</button>
            <button type="button" onClick={() => setPending(null)}>やめる</button>
          </div>
        )}
        <div className="dialog-body">
          {groups.map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              <table className="keys">
                <tbody>
                  {ACTIONS.filter((a) => a.group === group).map((action) => (
                    <tr key={action.id}>
                      <th>{action.label}</th>
                      <td>
                        <button
                          type="button"
                          className={capturing === action.id ? "key capturing" : "key"}
                          onClick={() => { setPending(null); setCapturing(action.id); }}
                        >
                          {capturing === action.id ? "キーを押してください（Escで中止）" : formatBinding(keymap[action.id]) || "未設定"}
                        </button>
                      </td>
                      <td>
                        <button type="button" disabled={!keymap[action.id]} onClick={() => onChange(assignKey(keymap, action.id, null))}>解除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
