import type { BuildStreamerGamepadInputMessageInput } from "@uurc/shared/streamerProtocol";

export type BrowserGamepadInput = BuildStreamerGamepadInputMessageInput;

export interface BrowserGamepadButtonLike {
  pressed: boolean;
  touched?: boolean;
  value: number;
}

export interface BrowserGamepadLike {
  index: number;
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly BrowserGamepadButtonLike[];
  timestamp?: number;
  connected?: boolean;
}

export interface GamepadInputSamplerOptions {
  deadzone?: number;
  axisEpsilon?: number;
  buttonEpsilon?: number;
  maxUpdateIntervalMs?: number;
  now?: () => number;
}

export interface GamepadInputSampler {
  poll(gamepads: readonly (BrowserGamepadLike | null | undefined)[]): BrowserGamepadInput[];
  pollFromNavigator(navigatorLike?: Pick<Navigator, "getGamepads"> | null): BrowserGamepadInput[];
  reset(): BrowserGamepadInput[];
  getActiveGamepads(): BrowserGamepadInput[];
}

const DEFAULT_DEADZONE = 0.08;
const DEFAULT_AXIS_EPSILON = 0.01;
const DEFAULT_BUTTON_EPSILON = 0.01;
const DEFAULT_MAX_UPDATE_INTERVAL_MS = 50;
const DEFAULT_GAMEPAD_AXIS_COUNT = 4;
const DEFAULT_GAMEPAD_BUTTON_COUNT = 17;
const XBOX_LIKE_ID_PATTERN = /(xbox|xinput|microsoft|x-box)/i;

export function isGamepadApiSupported(navigatorLike: Pick<Navigator, "getGamepads"> | null | undefined = globalThis.navigator): boolean {
  return typeof navigatorLike?.getGamepads === "function";
}

export function createGamepadInputSampler(options: GamepadInputSamplerOptions = {}): GamepadInputSampler {
  return new DefaultGamepadInputSampler({
    deadzone: options.deadzone ?? DEFAULT_DEADZONE,
    axisEpsilon: options.axisEpsilon ?? DEFAULT_AXIS_EPSILON,
    buttonEpsilon: options.buttonEpsilon ?? DEFAULT_BUTTON_EPSILON,
    maxUpdateIntervalMs: options.maxUpdateIntervalMs ?? DEFAULT_MAX_UPDATE_INTERVAL_MS,
    now: options.now ?? (() => globalThis.performance?.now?.() ?? Date.now()),
  });
}

export function readSupportedGamepads(
  gamepads: readonly (BrowserGamepadLike | null | undefined)[],
  options: Pick<Required<GamepadInputSamplerOptions>, "deadzone"> = { deadzone: DEFAULT_DEADZONE },
): BrowserGamepadInput[] {
  return gamepads.filter(isSupportedGamepad).map((gamepad) => normalizeGamepadInput(gamepad, options.deadzone));
}

export function readSupportedGamepadsFromNavigator(
  navigatorLike: Pick<Navigator, "getGamepads"> | null | undefined = globalThis.navigator,
  options: Pick<Required<GamepadInputSamplerOptions>, "deadzone"> = { deadzone: DEFAULT_DEADZONE },
): BrowserGamepadInput[] {
  if (!navigatorLike || typeof navigatorLike.getGamepads !== "function") return [];
  return readSupportedGamepads(Array.from(navigatorLike.getGamepads()), options);
}

export function isSupportedGamepad(gamepad: BrowserGamepadLike | null | undefined): gamepad is BrowserGamepadLike {
  if (!gamepad || gamepad.connected === false) return false;
  if (gamepad.mapping === "standard") return true;
  return XBOX_LIKE_ID_PATTERN.test(gamepad.id);
}

export function formatGamepadStatus(input: { supported: boolean; active: boolean; connectedName?: string }): string {
  if (!input.supported) return "浏览器不支持手柄 API";
  if (!input.connectedName) return "未检测到手柄";
  return input.active ? `手柄透传中：${input.connectedName}` : `已连接手柄：${input.connectedName}`;
}

class DefaultGamepadInputSampler implements GamepadInputSampler {
  private readonly previousByIndex = new Map<number, BrowserGamepadInput>();
  private readonly lastSentAtByIndex = new Map<number, number>();

  constructor(private readonly options: Required<GamepadInputSamplerOptions>) {}

  poll(gamepads: readonly (BrowserGamepadLike | null | undefined)[]): BrowserGamepadInput[] {
    const current = readSupportedGamepads(gamepads, this.options);
    const seen = new Set<number>();
    const samples: BrowserGamepadInput[] = [];

    for (const input of current) {
      seen.add(input.index);
      const previous = this.previousByIndex.get(input.index);
      const sampledAt = this.options.now();
      const lastSentAt = this.lastSentAtByIndex.get(input.index);
      const updateIntervalElapsed =
        lastSentAt !== undefined && sampledAt >= lastSentAt + this.options.maxUpdateIntervalMs;
      if (!previous || updateIntervalElapsed || hasMeaningfulGamepadChange(previous, input, this.options)) {
        samples.push(input);
        this.lastSentAtByIndex.set(input.index, sampledAt);
      }
      this.previousByIndex.set(input.index, input);
    }

    for (const [index, previous] of this.previousByIndex) {
      if (seen.has(index)) continue;
      samples.push(buildNeutralGamepadInput(previous));
      this.previousByIndex.delete(index);
      this.lastSentAtByIndex.delete(index);
    }

    return samples;
  }

  pollFromNavigator(navigatorLike: Pick<Navigator, "getGamepads"> | null | undefined = globalThis.navigator): BrowserGamepadInput[] {
    if (!navigatorLike || typeof navigatorLike.getGamepads !== "function") return [];
    return this.poll(Array.from(navigatorLike.getGamepads()));
  }

  reset(): BrowserGamepadInput[] {
    const samples = [...this.previousByIndex.values()].map(buildNeutralGamepadInput);
    this.previousByIndex.clear();
    this.lastSentAtByIndex.clear();
    return samples;
  }

  getActiveGamepads(): BrowserGamepadInput[] {
    return [...this.previousByIndex.values()];
  }
}

function normalizeGamepadInput(gamepad: BrowserGamepadLike, deadzone: number): BrowserGamepadInput {
  return {
    index: Math.max(0, Math.trunc(gamepad.index)),
    id: gamepad.id,
    mapping: gamepad.mapping,
    axes: gamepad.axes.map((axis) => normalizeAxis(axis, deadzone)),
    buttons: gamepad.buttons.map((button) => ({
      pressed: Boolean(button.pressed),
      touched: Boolean(button.touched),
      value: normalizeButtonValue(button.value),
    })),
    timestamp: gamepad.timestamp === undefined ? undefined : Math.max(0, Math.trunc(gamepad.timestamp)),
  };
}

function buildNeutralGamepadInput(previous: BrowserGamepadInput): BrowserGamepadInput {
  const axisCount = Math.max(DEFAULT_GAMEPAD_AXIS_COUNT, previous.axes.length);
  const buttonCount = Math.max(DEFAULT_GAMEPAD_BUTTON_COUNT, previous.buttons.length);
  return {
    index: previous.index,
    id: previous.id,
    mapping: previous.mapping,
    axes: Array.from({ length: axisCount }, () => 0),
    buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: previous.timestamp,
    reset: true,
  };
}

function hasMeaningfulGamepadChange(
  previous: BrowserGamepadInput,
  current: BrowserGamepadInput,
  options: Required<GamepadInputSamplerOptions>,
): boolean {
  if (previous.id !== current.id || previous.mapping !== current.mapping) return true;
  if (previous.axes.length !== current.axes.length || previous.buttons.length !== current.buttons.length) return true;
  for (let index = 0; index < current.axes.length; index += 1) {
    if (Math.abs((previous.axes[index] ?? 0) - current.axes[index]) > options.axisEpsilon) return true;
  }
  for (let index = 0; index < current.buttons.length; index += 1) {
    const before = previous.buttons[index];
    const after = current.buttons[index];
    if (!before || before.pressed !== after.pressed || Boolean(before.touched) !== Boolean(after.touched)) return true;
    if (Math.abs(before.value - after.value) > options.buttonEpsilon) return true;
  }
  return false;
}

function normalizeAxis(value: number, deadzone: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(1, Math.max(-1, value));
  if (Math.abs(clamped) < Math.max(0, deadzone)) return 0;
  return roundGamepadValue(clamped);
}

function normalizeButtonValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundGamepadValue(Math.min(1, Math.max(0, value)));
}

function roundGamepadValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}
