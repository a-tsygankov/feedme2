/**
 * Save a Blob as a file. The CSV comes through apiFetch (it needs the bearer header), so there is no URL to link to:
 * an object URL behind a temporary <a download> is the portable way, and it is revoked later so the Blob can be freed.
 */
const REVOKE_AFTER_MS = 10_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Late, not on the next tick: revoking before the engine has started reading the Blob cancels the download, and
    // some engines (old Safari, Firefox) have not started it after a 0 ms timeout. 10 s is ample for a local Blob and
    // only holds the CSV in memory that long.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
