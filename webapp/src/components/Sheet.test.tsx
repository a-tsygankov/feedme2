// @vitest-environment jsdom
// No testing-library in this repo: drive the real DOM with react-dom/client inside act().
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let appRoot: HTMLElement;
let opener: HTMLButtonElement;
let mount: Root;

beforeEach(() => {
  appRoot = document.createElement("div");
  appRoot.id = "root";
  opener = document.createElement("button");
  opener.textContent = "open";
  appRoot.append(opener);
  document.body.append(appRoot);
  opener.focus();
  const host = document.createElement("div");
  document.body.append(host);
  mount = createRoot(host);
});

afterEach(() => {
  act(() => mount.unmount());
  document.body.innerHTML = "";
  document.body.className = "";
});

const show = (node: ReactNode) => act(() => mount.render(node));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });

describe("Sheet", () => {
  it("is a labelled modal dialog in a portal on body", () => {
    show(<Sheet title="Feed Mochi" onClose={() => {}}><input /></Sheet>);
    const d = dialog();
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(d.getAttribute("aria-labelledby")!)?.textContent).toBe("Feed Mochi");
    expect(appRoot.contains(d)).toBe(false);
  });

  it("moves focus in, makes the app inert and locks scroll; closing restores all three", () => {
    show(<Sheet title="t" onClose={() => {}}><input data-testid="first" /></Sheet>);
    expect(document.activeElement).toBe(document.querySelector('[data-testid="first"]'));
    expect(appRoot.hasAttribute("inert")).toBe(true);
    expect(document.body.classList.contains("overflow-hidden")).toBe(true);
    show(<p>closed</p>);
    expect(appRoot.hasAttribute("inert")).toBe(false);
    expect(document.body.classList.contains("overflow-hidden")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("Escape and the backdrop close it, unless dismissable is false", () => {
    const onClose = vi.fn();
    show(<Sheet title="t" onClose={onClose}>x</Sheet>);
    esc();
    document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(2);
    onClose.mockClear();
    show(<Sheet title="t" onClose={onClose} dismissable={false}>x</Sheet>);
    esc();
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls the latest onClose without re-binding the listener or stealing focus on re-render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const add = vi.spyOn(window, "addEventListener");
    show(<Sheet title="t" onClose={first}><input data-testid="a" /><input data-testid="b" /></Sheet>);
    const bound = (add.mock.calls as unknown[][]).filter(([type]) => type === "keydown").length;
    act(() => document.querySelector<HTMLElement>('[data-testid="b"]')!.focus());
    show(<Sheet title="t" onClose={second}><input data-testid="a" /><input data-testid="b" /></Sheet>);
    expect((add.mock.calls as unknown[][]).filter(([type]) => type === "keydown").length).toBe(bound);
    expect(document.activeElement).toBe(document.querySelector('[data-testid="b"]'));
    esc();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });

  it("only removes the body scroll lock if this sheet was the one that added it", () => {
    // Another owner (a second sheet, a menu) already locked scroll: closing this sheet must not unlock it.
    document.body.classList.add("overflow-hidden");
    show(<Sheet title="t" onClose={() => {}}>x</Sheet>);
    show(<p>closed</p>);
    expect(document.body.classList.contains("overflow-hidden")).toBe(true);
  });
});
