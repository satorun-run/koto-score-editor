// キー割り当て。SPEC.md 6.2・6.5 に対応する。
// キーは配列に左右されない物理位置（KeyboardEvent.code）で持ち、表示用の文字を別に持つ。

export interface KeyBinding {
  code: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** 表示用のキー名 */
  label: string;
}

export interface ActionDef {
  id: string;
  label: string;
  group: string;
}

export type Keymap = Record<string, KeyBinding | null>;
export type Preset = "jis" | "us";

const STRING_NAMES = ["壱", "弐", "三", "四", "五", "六", "七", "八", "九", "十", "斗", "為", "巾"];
export const SUP_MARKS = ["2", "3", "ヒ", "オ", "ヲ", "ツ", "ユ", "ハ"];
export const ABOVE_MARKS = [
  { id: "左", label: "左（左弾き）" },
  { id: "打", label: "打（打ち爪）" },
  { id: "甲", label: "甲音の点" },
  { id: "fermata", label: "フェルマータ" },
];
export const SIGNS = [
  { id: "ワ", label: "ワ（輪連）" },
  { id: "ス", label: "ス（すくい爪）" },
];

export const ACTIONS: ActionDef[] = [
  ...STRING_NAMES.map((name, i) => ({ id: `string.${i + 1}`, label: `絃 ${name}`, group: "絃の入力" })),
  { id: "rest", label: "休符", group: "絃の入力" },
  { id: "dot.event", label: "付点を1つの音符として入れる（次の拍に入る付点）", group: "絃の入力" },
  ...STRING_NAMES.map((name, i) => ({ id: `chord.${i + 1}`, label: `合せ爪に ${name} を足す`, group: "合せ爪" })),
  { id: "chord.next", label: "次に押す絃を手前の音符に重ねる", group: "合せ爪" },
  { id: "chord.style", label: "合せ爪の囲みを切り替え", group: "合せ爪" },

  { id: "lines.more", label: "音価線を増やす（短く）", group: "音価" },
  { id: "lines.less", label: "音価線を減らす（長く）", group: "音価" },
  { id: "dots", label: "付点（なし→1→2）", group: "音価" },
  { id: "join.prev", label: "音価線を前の音符とつなぐ／切る", group: "音価" },
  { id: "join.next", label: "音価線を次の音符とつなぐ／切る", group: "音価" },
  { id: "pattern.dotted", label: "手前の2音を「付点八分＋十六分」にする", group: "音価" },

  { id: "press", label: "押し手（なし→一重→二重→三重）", group: "奏法記号" },
  { id: "prefix.kaki", label: "かき爪", group: "奏法記号" },
  { id: "prefix.wari", label: "わり爪", group: "奏法記号" },
  ...SUP_MARKS.map((m) => ({ id: `sup.${m}`, label: `右肩記号 ${m}`, group: "奏法記号" })),
  ...ABOVE_MARKS.map((m) => ({ id: `above.${m.id}`, label: `上記号 ${m.label}`, group: "奏法記号" })),
  ...SIGNS.map((s) => ({ id: `sign.${s.id}`, label: `記号音符 ${s.label}`, group: "奏法記号" })),

  { id: "move.left", label: "前の音符へ", group: "移動" },
  { id: "move.right", label: "次の音符へ", group: "移動" },
  { id: "measure.next", label: "次の小節へ", group: "移動" },
  { id: "measure.prev", label: "前の小節へ", group: "移動" },
  { id: "part.up", label: "上のパートへ", group: "移動" },
  { id: "part.down", label: "下のパートへ", group: "移動" },

  { id: "select.mark", label: "手前の音符をスパンの始点にする", group: "編集" },
  { id: "delete.back", label: "手前の音符を削除", group: "編集" },
  { id: "delete.forward", label: "次の音符を削除", group: "編集" },
  { id: "undo", label: "取り消し", group: "編集" },
  { id: "redo", label: "やり直し", group: "編集" },

  { id: "measure.insertAfter", label: "後ろに小節を挿入", group: "小節" },
  { id: "measure.insertBefore", label: "前に小節を挿入", group: "小節" },
  { id: "measure.delete", label: "小節を削除", group: "小節" },
  { id: "measure.repeat", label: "前小節くり返しに切り替え", group: "小節" },
  { id: "fill.rest", label: "残りを休符で埋めて次の小節へ", group: "小節" },
  { id: "measure.copyPrev", label: "前の小節の内容を写す", group: "小節" },
  { id: "measure.copy", label: "小節をコピー", group: "小節" },
  { id: "measure.paste", label: "コピーした小節を貼り付け", group: "小節" },
];

const key = (code: string, label: string, mods: Partial<KeyBinding> = {}): KeyBinding => ({ code, label, ...mods });

/** 絃はテンキーで入れる。壱〜九 = 1〜9、十 = 0、斗 = /、為 = *、巾 = - */
const STRING_KEYS: [string, string][] = [
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d): [string, string] => [`Numpad${d}`, `テンキー${d}`]),
  ["NumpadDivide", "テンキー/"],
  ["NumpadMultiply", "テンキー*"],
  ["NumpadSubtract", "テンキー-"],
];

export function defaultKeymap(preset: Preset): Keymap {
  const map: Keymap = {};
  for (const action of ACTIONS) map[action.id] = null;

  STRING_KEYS.forEach(([code, label], i) => {
    map[`string.${i + 1}`] = key(code, label);
  });
  // JISでは [ ] のキーの物理位置がUSと1つずれる
  const [open, close] = preset === "jis" ? ["BracketRight", "Backslash"] : ["BracketLeft", "BracketRight"];
  Object.assign(map, {
    // テンキーだけで音符・休符・付点・合せ爪まで打てるようにする
    rest: key("NumpadEnter", "テンキーEnter"),
    dots: key("NumpadDecimal", "テンキー."),
    "dot.event": key("Period", "."),
    "chord.next": key("NumpadAdd", "テンキー+"),
    "chord.style": key("KeyC", "C"),

    "lines.more": key("ArrowDown", "↓"),
    "lines.less": key("ArrowUp", "↑"),
    "join.prev": key(open!, "["),
    "join.next": key(close!, "]"),
    "pattern.dotted": key("KeyQ", "Q"),

    press: key("KeyP", "P"),
    "prefix.kaki": key("KeyK", "K"),
    "prefix.wari": key("KeyW", "W"),
    "sup.2": key("Digit2", "2"),
    "sup.3": key("Digit3", "3"),
    "sup.ヒ": key("KeyH", "H"),
    "sup.オ": key("KeyO", "O"),
    "sup.ヲ": key("KeyO", "O", { shift: true }),
    "sup.ツ": key("KeyT", "T"),
    "sup.ユ": key("KeyY", "Y"),
    "sup.ハ": key("KeyA", "A"),
    "above.左": key("KeyL", "L"),
    "above.打": key("KeyU", "U"),
    "above.甲": key("KeyN", "N"),
    "above.fermata": key("KeyF", "F"),
    "sign.ワ": key("KeyR", "R"),
    "sign.ス": key("KeyS", "S"),

    "move.left": key("ArrowLeft", "←"),
    "move.right": key("ArrowRight", "→"),
    "measure.next": key("Tab", "Tab"),
    "measure.prev": key("Tab", "Tab", { shift: true }),
    "part.up": key("ArrowUp", "↑", { ctrl: true }),
    "part.down": key("ArrowDown", "↓", { ctrl: true }),
    "select.mark": key("KeyM", "M"),
    "delete.back": key("Backspace", "Backspace"),
    "delete.forward": key("Delete", "Delete"),
    undo: key("KeyZ", "Z", { ctrl: true }),
    redo: key("KeyY", "Y", { ctrl: true }),

    "fill.rest": key("Enter", "Enter"),
    "measure.insertAfter": key("Enter", "Enter", { ctrl: true }),
    "measure.copyPrev": key("KeyD", "D", { ctrl: true }),
    "measure.copy": key("KeyC", "C", { ctrl: true }),
    "measure.paste": key("KeyV", "V", { ctrl: true }),
  } satisfies Keymap);
  return map;
}

export interface KeyLike {
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;
const NUMPAD_SYMBOLS: Record<string, string> = { Divide: "/", Multiply: "*", Subtract: "-", Add: "+", Decimal: "." };
const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", " ": "Space",
};

/** 押されたキーを割り当てに変換する。修飾キーだけなら null */
export function bindingFromEvent(e: KeyLike): KeyBinding | null {
  if (MODIFIER_CODES.test(e.code) || e.code === "") return null;
  const numpad = /^Numpad(.+)$/.exec(e.code)?.[1];
  const label = numpad
    ? `テンキー${NUMPAD_SYMBOLS[numpad] ?? numpad}`
    : (KEY_LABELS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key));
  const binding: KeyBinding = { code: e.code, label };
  if (e.shiftKey) binding.shift = true;
  if (e.ctrlKey || e.metaKey) binding.ctrl = true;
  if (e.altKey) binding.alt = true;
  return binding;
}

export function sameBinding(a: KeyBinding, b: KeyBinding): boolean {
  return a.code === b.code && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt;
}

export function formatBinding(binding: KeyBinding | null | undefined): string {
  if (!binding) return "";
  return [binding.ctrl && "Ctrl", binding.alt && "Alt", binding.shift && "Shift", binding.label].filter(Boolean).join("+");
}

export function findAction(keymap: Keymap, e: KeyLike): string | null {
  const pressed = bindingFromEvent(e);
  if (!pressed) return null;
  for (const [action, binding] of Object.entries(keymap)) {
    if (binding && sameBinding(binding, pressed)) return action;
  }
  return null;
}

/** 同じキーがすでに割り当てられている操作。なければ null */
export function findConflict(keymap: Keymap, binding: KeyBinding, exceptAction: string): string | null {
  for (const [action, other] of Object.entries(keymap)) {
    if (action !== exceptAction && other && sameBinding(other, binding)) return action;
  }
  return null;
}

/** 割り当てる。同じキーを使っていた操作からは外す */
export function assignKey(keymap: Keymap, action: string, binding: KeyBinding | null): Keymap {
  const next = { ...keymap };
  if (binding) {
    for (const [other, b] of Object.entries(next)) {
      if (b && sameBinding(b, binding)) next[other] = null;
    }
  }
  next[action] = binding;
  return next;
}

export function actionLabel(id: string): string {
  return ACTIONS.find((a) => a.id === id)?.label ?? id;
}

// 初期値を作り直したときは末尾の番号を上げ、古い保存分を引き継がないようにする
const STORAGE_KEY = "koto-score-editor.keymap.v2";

/** 保存済みの割り当てを読む。後から増えた操作は初期値で補う */
export function loadKeymap(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Keymap {
  const base = defaultKeymap("jis");
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved ? normalizeKeymap(JSON.parse(saved), base) : base;
  } catch {
    return base;
  }
}

export function saveKeymap(keymap: Keymap, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(keymap));
  } catch {
    // 保存できなくても編集は続けられる
  }
}

/** 外から読んだデータを割り当てとして整える。知らない操作は捨て、欠けた操作は base で補う */
export function normalizeKeymap(data: unknown, base: Keymap): Keymap {
  const next = { ...base };
  if (typeof data !== "object" || data === null) return next;
  for (const [action, value] of Object.entries(data)) {
    if (!(action in base)) continue;
    if (value === null) next[action] = null;
    else if (typeof value === "object" && typeof (value as KeyBinding).code === "string") {
      const b = value as KeyBinding;
      next[action] = { code: b.code, label: String(b.label ?? b.code), ...(b.shift && { shift: true }), ...(b.ctrl && { ctrl: true }), ...(b.alt && { alt: true }) };
    }
  }
  return next;
}
