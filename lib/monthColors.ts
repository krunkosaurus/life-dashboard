export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type MonthAccent = {
  name: (typeof MONTHS)[number];
  solid: string;
  soft: string;
  surface: string;
  border: string;
  text: string;
};

export const MONTH_ACCENTS: MonthAccent[] = [
  { name: "Jan", solid: "#60a5fa", soft: "#1f3552", surface: "#101a28", border: "#2f5f9c", text: "#93c5fd" },
  { name: "Feb", solid: "#f472b6", soft: "#4b1f38", surface: "#25111e", border: "#8b3a67", text: "#f9a8d4" },
  { name: "Mar", solid: "#34d399", soft: "#163f33", surface: "#0d211c", border: "#287b60", text: "#86efac" },
  { name: "Apr", solid: "#fbbf24", soft: "#4a3710", surface: "#241b0b", border: "#8a681b", text: "#fde68a" },
  { name: "May", solid: "#a78bfa", soft: "#302852", surface: "#191529", border: "#5e50a4", text: "#c4b5fd" },
  { name: "Jun", solid: "#22d3ee", soft: "#143f47", surface: "#0c2227", border: "#217988", text: "#67e8f9" },
  { name: "Jul", solid: "#fb7185", soft: "#4a2029", surface: "#261216", border: "#914151", text: "#fda4af" },
  { name: "Aug", solid: "#fb923c", soft: "#4a2a14", surface: "#24150b", border: "#8d4f22", text: "#fdba74" },
  { name: "Sep", solid: "#84cc16", soft: "#2f3f12", surface: "#171f0b", border: "#5f8421", text: "#bef264" },
  { name: "Oct", solid: "#c084fc", soft: "#392453", surface: "#1d1329", border: "#704ba4", text: "#d8b4fe" },
  { name: "Nov", solid: "#38bdf8", soft: "#16394b", surface: "#0d1d27", border: "#27759c", text: "#7dd3fc" },
  { name: "Dec", solid: "#f87171", soft: "#4a2020", surface: "#261212", border: "#944141", text: "#fca5a5" },
];

export function getMonthAccent(monthIndex: number): MonthAccent {
  return MONTH_ACCENTS[((monthIndex % 12) + 12) % 12];
}
