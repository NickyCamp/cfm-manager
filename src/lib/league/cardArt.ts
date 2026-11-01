// Card art for specific players. Players not listed here get the generic card
// (jersey number and position in team colors).
// To add art: put the image in public/card-art/<league slug>/<player id>.<ext>
// and add an entry below, e.g. ncl: { 12345: "/card-art/ncl/12345.webp" }.
// A portrait crop (5:7) works best; the image is cropped to fill the frame.
const CARD_ART: Record<string, Record<number, string>> = {
  ncl: {},
};

export function cardArt(slug: string, playerId: number): string | undefined {
  return CARD_ART[slug]?.[playerId];
}
