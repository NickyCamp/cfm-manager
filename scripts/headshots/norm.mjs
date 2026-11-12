// Name normalization shared by the headshot generator and the app (headshots.ts),
// so "Ja'Marr Chase", "JaMarr Chase" and "Ja’Marr Chase Jr." all compare equal.
export function normName(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w))
    .join(" ");
}
