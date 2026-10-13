import type { HelpScenario, HelpVariant } from "../types.ts";

/**
 * Installing feedme2 happens entirely in browser and OS chrome that
 * Playwright cannot drive and Driver.js cannot highlight, so there is no
 * tour here, only instructions picked by platform. Copied from gigsy's
 * `install-gigsy` with the app name changed; gigsy's notification copy
 * is dropped because feedme2 sends none, so installing is a convenience
 * (an icon, its own window) and never a requirement.
 */

const iosSafari: HelpVariant = {
  environment: "ios-safari",
  label: "iPhone or iPad (Safari)",
  steps: [
    {
      action: "external",
      externalType: "os-ui",
      title: "Open the Share sheet",
      description:
        "In Safari, tap the Share icon (the square with an arrow pointing up) in the toolbar.",
    },
    {
      action: "external",
      externalType: "os-ui",
      title: "Add to Home Screen",
      description:
        'Scroll down in the Share sheet, tap "Add to Home Screen", then tap "Add" to confirm.',
    },
    {
      action: "external",
      externalType: "os-ui",
      title: "Open feedme2 from the home screen",
      description:
        "Launch feedme2 from the new icon. It opens full screen, without Safari's address bar.",
    },
  ],
};

const androidChrome: HelpVariant = {
  environment: "android-chrome",
  label: "Android (Chrome)",
  steps: [
    {
      action: "external",
      externalType: "browser-ui",
      title: "Open Chrome's menu",
      description: "Tap the three dots in the top-right corner of Chrome.",
    },
    {
      action: "external",
      externalType: "browser-ui",
      title: "Install the app",
      description:
        'Tap "Install app" (some versions say "Add to Home screen"), then confirm. feedme2 then opens like any other app, from your home screen or app drawer.',
    },
  ],
};

const desktopChrome: HelpVariant = {
  environment: "desktop-chrome",
  label: "Desktop (Chrome)",
  steps: [
    {
      action: "external",
      externalType: "browser-ui",
      title: "Use the install icon",
      description:
        'Click the install icon at the right edge of the address bar (a small monitor with a down arrow). Don\'t see it? Open the ⋮ menu and choose "Install feedme2…" instead.',
    },
    {
      action: "external",
      externalType: "browser-ui",
      title: "Confirm",
      description:
        'Click "Install" in the dialog that appears. feedme2 then opens in its own window, separate from your browser tabs.',
    },
  ],
};

const desktopEdge: HelpVariant = {
  environment: "desktop-edge",
  label: "Desktop (Edge)",
  steps: [
    {
      action: "external",
      externalType: "browser-ui",
      title: "Use the install icon",
      description:
        'Click the app-available icon at the right edge of the address bar (a small screen with a plus). Don\'t see it? Open the ⋯ menu, choose "Apps", then "Install this site as an app".',
    },
    {
      action: "external",
      externalType: "browser-ui",
      title: "Confirm",
      description:
        'Click "Install" in the dialog that appears. feedme2 then opens in its own window, separate from your browser tabs.',
    },
  ],
};

/** A wrong (or absent) guess must still leave someone with something they
 *  can do right now, never a shrug. */
const fallback: HelpVariant = {
  environment: "fallback",
  label: "Another browser",
  steps: [
    {
      action: "external",
      externalType: "browser-ui",
      title: "Look for an install option",
      description:
        'Most current browsers can add feedme2 to your device: check the browser\'s menu for "Install app" or "Add to Home screen", or look for an install icon near the address bar.',
    },
    {
      action: "external",
      externalType: "browser-ui",
      title: "No install option? feedme2 still works",
      description:
        "Bookmark this page and keep using feedme2 in the tab. Everything works there, offline feeding included.",
    },
  ],
};

export const installApp: HelpScenario = {
  id: "install-app",
  title: "Install feedme2",
  description: "Add feedme2 to your home screen or desktop so it opens like an app.",
  category: "installation",
  executable: false,
  steps: [],
  variants: [iosSafari, androidChrome, desktopChrome, desktopEdge, fallback],
};
