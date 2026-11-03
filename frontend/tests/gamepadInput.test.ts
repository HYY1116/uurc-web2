import { describe, expect, it } from "vitest";

import {
  createGamepadInputSampler,
  formatGamepadStatus,
  isGamepadApiSupported,
  readSupportedGamepads,
  type BrowserGamepadLike,
} from "../src/remote/gamepadInput.js";

function gamepad(input: Partial<BrowserGamepadLike> = {}): BrowserGamepadLike {
  return {
    index: 0,
    id: "Xbox Wireless Controller",
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 4 }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 100,
    connected: true,
    ...input,
  };
}

describe("gamepadInput", () => {
  it("detects Gamepad API support and formats coarse UI status", () => {
    expect(isGamepadApiSupported(null)).toBe(false);
    expect(isGamepadApiSupported({ getGamepads: () => [] })).toBe(true);
    expect(formatGamepadStatus({ supported: false, active: false })).toBe("浏览器不支持手柄 API");
    expect(formatGamepadStatus({ supported: true, active: false })).toBe("未检测到手柄");
    expect(formatGamepadStatus({ supported: true, active: false, connectedName: "Xbox" })).toBe("已连接手柄：Xbox");
    expect(formatGamepadStatus({ supported: true, active: true, connectedName: "Xbox" })).toBe("手柄透传中：Xbox");
  });

  it("reads only standard or Xbox-like gamepads", () => {
    expect(
      readSupportedGamepads([
        gamepad({ id: "Generic USB Pad", mapping: "" }),
        gamepad({ index: 1, id: "Microsoft XInput Controller", mapping: "" }),
        gamepad({ index: 2, id: "Standard Pad", mapping: "standard" }),
        gamepad({ index: 3, connected: false }),
        null,
      ]).map((item) => item.index),
    ).toEqual([1, 2]);
  });

  it("normalizes axes and buttons with deadzone and clamp", () => {
    expect(
      readSupportedGamepads([
        gamepad({
          axes: [0.04, -0.5, 1.5, Number.NaN],
          buttons: [
            { pressed: true, touched: true, value: 2 },
            { pressed: false, value: -0.5 },
          ],
          timestamp: 123.9,
        }),
      ]),
    ).toEqual([
      {
        index: 0,
        id: "Xbox Wireless Controller",
        mapping: "standard",
        axes: [0, -0.5, 1, 0],
        buttons: [
          { pressed: true, touched: true, value: 1 },
          { pressed: false, touched: false, value: 0 },
        ],
        timestamp: 123,
      },
    ]);
  });

  it("emits first samples, button edges, analog changes past epsilon, and disconnect reset", () => {
    const sampler = createGamepadInputSampler({ axisEpsilon: 0.05, buttonEpsilon: 0.05 });

    expect(sampler.poll([gamepad()])).toHaveLength(1);
    expect(sampler.poll([gamepad({ axes: [0.01, 0, 0, 0] })])).toEqual([]);

    const moved = sampler.poll([gamepad({ axes: [0.25, 0, 0, 0] })]);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.axes[0]).toBe(0.25);

    const pressed = sampler.poll([
      gamepad({ axes: [0.25, 0, 0, 0], buttons: [{ pressed: true, touched: true, value: 1 }] }),
    ]);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.buttons[0]).toEqual({ pressed: true, touched: true, value: 1 });

    const reset = sampler.poll([]);
    expect(reset).toHaveLength(1);
    expect(reset[0]?.reset).toBe(true);
    expect(reset[0]?.axes).toEqual([0, 0, 0, 0]);
    expect(reset[0]?.buttons.every((button) => !button.pressed && !button.touched && button.value === 0)).toBe(true);
    expect(sampler.poll([])).toEqual([]);
  });

  it("resends held state at the App-compatible 50 ms cadence", () => {
    let now = 100;
    const sampler = createGamepadInputSampler({ maxUpdateIntervalMs: 50, now: () => now });

    expect(sampler.poll([gamepad({ axes: [0.5, 0, 0, 0] })])).toHaveLength(1);
    now = 149;
    expect(sampler.poll([gamepad({ axes: [0.5, 0, 0, 0] })])).toEqual([]);
    now = 150;
    expect(sampler.poll([gamepad({ axes: [0.5, 0, 0, 0] })])).toHaveLength(1);
  });

  it("disconnects only the missing gamepad when another remains connected", () => {
    const sampler = createGamepadInputSampler();
    sampler.poll([
      gamepad({ index: 0, id: "Pad 1" }),
      gamepad({ index: 1, id: "Pad 2" }),
    ]);

    const samples = sampler.poll([null, gamepad({ index: 1, id: "Pad 2", axes: [0.5, 0, 0, 0] })]);

    expect(samples).toHaveLength(2);
    expect(samples.find((sample) => sample.index === 0)?.reset).toBe(true);
    expect(samples.find((sample) => sample.index === 1)?.reset).toBeUndefined();
    expect(sampler.getActiveGamepads().map((sample) => sample.index)).toEqual([1]);
  });

  it("resets active gamepads explicitly", () => {
    const sampler = createGamepadInputSampler();
    sampler.poll([gamepad({ axes: [0.4, 0, 0, 0] })]);

    const reset = sampler.reset();

    expect(reset).toHaveLength(1);
    expect(reset[0]?.reset).toBe(true);
    expect(sampler.reset()).toEqual([]);
  });
});
