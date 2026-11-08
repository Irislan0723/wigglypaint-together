// WigglyPaint/Decker by John Earnest, MIT. See public/vendor/wigglypaint/LICENSE.txt.
// The original interpreter and brush code run without a browser or network access.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {deflateSync} from 'node:zlib';
import {PAINT_PALETTE_SLOTS} from './paint-colors.js';
const html=readFileSync(new URL('./public/vendor/wigglypaint/original.html',import.meta.url),'utf8');
export const originalDeck=html.split('<script language="decker">')[1].split('</script>')[0];
const js=html.split('<script>')[1].split('</script>')[0];
const core=js.slice(0,js.indexOf('\n// Decker\n'));
const encoder=js.slice(js.indexOf('writegif='),js.indexOf('writewav='));
const setup=`
n_show=n_print=n_play=n_open=n_save=n_alert=()=>NIL;
n_panic=()=>{throw Error('Drawing interpreter stopped')};
go_notify=()=>{}; mark_dirty=()=>{}; field_notify=()=>{}; grid_notify=()=>{};
ATTR_QUOTA=1000000;
// The original brushes copy entire frames around each segment. In the worker,
// use a bulk copy for that exact case and keep Decker's clipped paths intact.
const copyRegion=image_copy, pasteRegion=image_paste;
image_copy=(image,region)=>{
 const r=region?rint(region):null, {x:width,y:height}=image.size;
 if(r&&(r.x!==0||r.y!==0||r.w!==width||r.h!==height))return copyRegion(image,region);
 const copy=image_make(rect(width,height));
 copy.pix.set(image.pix);
 return copy;
};
image_paste=(region,clip,source,destination,opaque)=>{
 const r=rint(region),{x:width,y:height}=source.size;
 if(opaque&&r.x===0&&r.y===0&&width===destination.size.x&&height===destination.size.y&&
    clip.x===0&&clip.y===0&&clip.w===width&&clip.h===height){
  destination.pix.set(source.pix);
  return;
 }
 return pasteRegion(region,clip,source,destination,opaque);
};
let deck=null;
pushstate(lmenv());
`;
export function runPaint(job,report=null){
  const context=vm.createContext({console:{log(){},table(){}},atob,btoa,Uint8Array,Uint32Array,Int32Array,Uint16Array,Int16Array,Int8Array,Float32Array,Float64Array,ArrayBuffer,TextEncoder,TextDecoder,URL,job,report});
  new vm.Script(core+'\n'+encoder+'\n'+setup).runInContext(context,{timeout:3000});
  const result=new vm.Script(`
deck=deck_read(${JSON.stringify(originalDeck)});
seed=job.state?.seed??0x12345;
const main=dget(deck.cards,lms('main')), target=dget(main.widgets,lms('target'));
const width=job.state?.width||355,height=job.state?.height||261;
iwrite(target,lms('size'),lmpair(rect(width,height)));
let frames=job.state?job.state.frames.map(image_read):Array.from({length:3},()=>image_make(rect(width,height)));
iwrite(dget(target.widgets,lms('fr')),lms('images'),lml(frames));
if(job.state?.palette)job.state.palette.forEach((color,i)=>iwrite(deck.patterns,lmn(i+32),lmn(color)));
const paletteSlots=${JSON.stringify(PAINT_PALETTE_SLOTS)};
for(const [name,color] of Object.entries(job.palette||{}))iwrite(deck.patterns,lmn(paletteSlots[name]+32),lmn(color));
const sizeOptions=ll(ifield(dget(dget(main.widgets,lms('markerSizes')).widgets,lms('o')),'images'));
target.def.script+='\\non studio_size index do\\n sh.data:image[index].map[1,0]\\n er.data:image[index]\\nend\\n';
// Install the original procedural brush definitions from the deck modules.
target.def.script+='\\non studio_draw input do\\n points:first input\\n o:input[1]\\n each x in points draw[x o fr.images] o:x end\\nend\\n';
parse(target.def.script);
const palette=Array.from({length:16},(_,i)=>ln(iindex(deck.patterns,i+32)));
const snapshot=()=>{
 frames=ll(fire_attr_sync(target,'get_frames'));
 return {width,height,frames:frames.map(image_write),palette,transparent:job.state?.transparent===true,seed};
};
const strokes=job.strokes||[];
const pointBatch=Math.max(12,Math.ceil(strokes.reduce((total,stroke)=>total+stroke.points.length,0)/24));
const strokeBatch=Math.max(1,Math.ceil(strokes.length/24));
for(const [index,stroke] of strokes.entries()){
 fire_attr_sync(target,'set_brush',lms(stroke.brush));
 fire_attr_sync(target,'studio_size',lms(image_write(sizeOptions[stroke.size??4])));
 const step=report?pointBatch:stroke.points.length;
 for(let offset=0;offset<stroke.points.length;offset+=step){
  const points=stroke.points.slice(offset,offset+step);
  const prior=stroke.points[Math.max(0,offset-1)];
  fire_attr_sync(target,'studio_draw',js_to_lil([points,prior]));
  if(report&&(offset+step<stroke.points.length||(index+1)%strokeBatch===0))report(snapshot());
 }
}
const exported=snapshot();
if(report)report(exported);
if(report){({state:exported})}else{
const colors=palette.map(x=>0xFF000000|x);
const rgba=new Uint8Array(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const p=frames[0].pix[x+y*width],index=p===0?0:p===1?15:p>=32?Math.min(15,p-32):pal_pat(deck.patterns.pal.pix,p,x,y)?15:0;
 const c=colors[index],i=4*(x+y*width);rgba[i]=c>>16;rgba[i+1]=c>>8;rgba[i+2]=c;rgba[i+3]=p===0&&exported.transparent?0:255;
}
COLORS.splice(0,16,...palette);
const gifFrames=exported.transparent?frames:frames.map(f=>{const copy=image_copy(f);for(let i=0;i<copy.pix.length;i++)if(copy.pix[i]===0)copy.pix[i]=32;return copy});
({state:exported,gif:writegif(gifFrames,[10,10,10],new Int32Array(256),0),rgba});
}
`).runInContext(context,{timeout:8000});
  const state=JSON.parse(JSON.stringify(result.state));
  return report?{state}:{state,gif:Uint8Array.from(result.gif),rgba:Uint8Array.from(result.rgba)};
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function chunk(name,data){const type=Buffer.from(name),payload=Buffer.concat([type,data]);let crc=0xffffffff;for(const b of payload)crc=crcTable[(crc^b)&255]^(crc>>>8);const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,payload,tail])}
export function encodePng(width,height,rgba){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(rows,y*(width*4+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])}
