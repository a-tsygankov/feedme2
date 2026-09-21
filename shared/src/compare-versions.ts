/**
 * Semver-style compare without the dependency. Mirrors
 * firmware/src/domain/Version.h exactly: per-segment numeric compare
 * when both sides are digits; a non-numeric tail ("1.4.2-rc1") sorts
 * BEFORE the bare numeric form. Used by the update bar to compare the
 * served webapp version with the running one, and later by the OTA
 * advisory.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const aNum = /^\d+$/.test(sa);
    const bNum = /^\d+$/.test(sb);
    if (aNum && bNum) {
      const na = Number(sa);
      const nb = Number(sb);
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? 1 : -1;
    } else {
      // Ordinal, not localeCompare: the C++ mirror uses std::string::compare
      // and locale-aware ordering is not stable across Node, CI and workerd.
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}
