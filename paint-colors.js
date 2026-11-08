// The same five palette slots exposed by the original WigglyPaint options page.
export const PAINT_PALETTE_SLOTS=Object.freeze({background:0,foreground:15,pink:4,cyan:7,yellow:1});
export function parsePaintPalette(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('palette 必须是颜色对象，例如 {"foreground":"#273C32","pink":"F08DA8"}');
  const entries=Object.entries(value);
  if(!entries.length)throw Error('palette 至少需要一个调色槽');
  return Object.fromEntries(entries.map(([key,color])=>{
    if(!Object.hasOwn(PAINT_PALETTE_SLOTS,key))throw Error('未知调色槽：请使用 foreground、background、pink、cyan、yellow');
    if(typeof color!=='string'||!/^#?[0-9a-f]{6}$/i.test(color))throw Error('颜色码需为六位 RRGGBB 或 #RRGGBB，例如 #A3C98F');
    return [key,parseInt(color.replace(/^#/,''),16)];
  }));
}
export function paintPaletteHex(colors){return Object.fromEntries(Object.entries(PAINT_PALETTE_SLOTS).map(([key,index])=>[key,'#'+colors[index].toString(16).padStart(6,'0').toUpperCase()]))}
