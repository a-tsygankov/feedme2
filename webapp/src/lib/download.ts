/**
 * Save a Blob as a file. The CSV comes through apiFetch (it needs the bearer header), so there is no URL to link to:
 * an object URL behind a temporary <a download> is the portable way, and it is revoked once the click has started
 * the download so the Blob can be freed.
 */
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
    // Deferred: revoking synchronously cancels the download in some engines (old Safari, Firefox).
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
