/* Decker image decoding adapted from John Earnest's MIT runtime; see vendor/wigglypaint/LICENSE.txt. */
const MAX_PIXELS=524288;
function lzw(src,length,min){
  if(!Number.isInteger(min)||min<2||min>8)throw Error('画布压缩格式无效');
  const out=new Uint8Array(length),prefix=new Int32Array(4096),suffix=new Int32Array(4096),stack=new Int32Array(4096),clear=1<<min;
  let size=min+1,mask=(1<<size)-1,next=clear+2,old=-1,first=0,i=0,bits=0,data=0,offset=0;
  for(let n=0;n<clear;n++)suffix[n]=n;
  while(i<src.length){
    while(bits<size){if(i>=src.length)throw Error('画布数据不完整');data+=(src[i++]&255)<<bits;bits+=8}
    let token=data&mask;data>>>=size;bits-=size;
    if(token===clear+1)break;if(token>next)throw Error('画布压缩编码无效');
    if(token===clear){size=min+1;mask=(1<<size)-1;next=clear+2;old=-1;continue}
    if(old===-1){if(token>=clear||offset>=length)throw Error('画布像素数量无效');out[offset++]=suffix[old=first=token];continue}
    let count=0,saved=token;if(token===next){stack[count++]=first;token=old}
    while(token>clear){if(count>=4095||token>=next)throw Error('画布压缩链无效');stack[count++]=suffix[token];token=prefix[token]}
    if(offset+1+count>length)throw Error('画布像素数量无效');out[offset++]=first=suffix[token];while(count)out[offset++]=stack[--count];
    if(next<4096){prefix[next]=old;suffix[next++]=first;if((next&mask)===0&&next<4096){size++;mask+=next}}old=saved;
  }
  if(offset!==length)throw Error('画布像素不完整');return out;
}
const from64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function to64(bytes){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text)}
export function decodePaintFrame(value,width,height){
  if(typeof value!=='string'||value.length>2800000||!/^%%IMG[0-3][A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('画布帧格式无效');
  const data=from64(value.slice(6));if(data.length<4)throw Error('画布帧不完整');const w=(data[0]<<8)|data[1],h=(data[2]<<8)|data[3],length=w*h;
  if(!w||!h||length>MAX_PIXELS||width!==undefined&&(w!==width||h!==height))throw Error('画布尺寸不一致');
  let out=new Uint8Array(length);const format=Number(value[5]);
  if(format===0){const stride=Math.ceil(w/8);if(data.length<4+stride*h)throw Error('画布帧不完整');for(let y=0;y<h;y++)for(let x=0;x<w;x++)out[x+y*w]=data[4+(x>>3)+y*stride]&(1<<(7-x%8))?1:0}
  else if(format===1){if(data.length!==4+length)throw Error('画布帧不完整');out=data.slice(4)}
  else if(format===2){let offset=0;for(let i=4;i<data.length;i+=2){if(i+1>=data.length||!data[i+1]||offset+data[i+1]>length)throw Error('画布帧压缩无效');out.fill(data[i],offset,offset+data[i+1]);offset+=data[i+1]}if(offset!==length)throw Error('画布像素不完整')}
  else out=lzw(data.subarray(5),length,data[4]);
  return out;
}
export function encodePaintFrame(pixels,width,height){
  if(pixels.length!==width*height||pixels.length>MAX_PIXELS)throw Error('画布尺寸无效');const data=[width>>8,width&255,height>>8,height&255];
  for(let i=0;i<pixels.length;){const color=pixels[i];let count=0;while(count<255&&i<pixels.length&&pixels[i]===color){count++;i++}data.push(color,count)}
  if(data.length>pixels.length+4){const raw=new Uint8Array(pixels.length+4);raw.set(data.slice(0,4));raw.set(pixels,4);return '%%IMG1'+to64(raw)}
  return '%%IMG2'+to64(Uint8Array.from(data));
}
export function paintStatePixels(state){return state.frames.map(value=>decodePaintFrame(value,state.width,state.height))}
export function paintPixelDiff(before,after){
  if(before.width!==after.width||before.height!==after.height)throw Error('一起画时不能改变画布尺寸');
  const a=paintStatePixels(before),b=paintStatePixels(after),frames=a.map((old,f)=>{const runs=[];for(let i=0;i<old.length;){if(old[i]===b[f][i]){i++;continue}const start=i;while(i<old.length&&old[i]!==b[f][i]&&i-start<8192)i++;runs.push([start,to64(b[f].subarray(start,i))])}return runs});
  const palette={};for(let i=0;i<16;i++)if(before.palette[i]!==after.palette[i])palette[i]=after.palette[i];
  return {frames,palette,...(before.transparent!==after.transparent?{transparent:after.transparent}:{}),seed:after.seed};
}
export function paintPatchEmpty(patch){return !patch.frames.some(r=>r.length)&&!Object.keys(patch.palette||{}).length&&patch.transparent===undefined}
export function validatePaintPatch(patch,width,height){
  if(!patch||!Array.isArray(patch.frames)||patch.frames.length!==3)throw Error('笔迹增量无效');let total=0;const length=width*height;
  const frames=patch.frames.map(runs=>{if(!Array.isArray(runs)||runs.length>length)throw Error('笔迹增量过大');let end=0;return runs.map(run=>{if(!Array.isArray(run)||run.length!==2||!Number.isInteger(run[0])||run[0]<end||typeof run[1]!=='string'||run[1].length>16000||!run[1].length||!/^[A-Za-z0-9+/]*={0,2}$/.test(run[1]))throw Error('笔迹轨迹无效');const bytes=from64(run[1]);if(!bytes.length||run[0]+bytes.length>length||bytes.some(n=>n>47))throw Error('笔迹像素无效');end=run[0]+bytes.length;total+=bytes.length;return [run[0],run[1]]})});
  if(total>length*3)throw Error('笔迹增量过大');const palette={};if(patch.palette!==undefined&&(!patch.palette||typeof patch.palette!=='object'||Array.isArray(patch.palette)))throw Error('配色增量无效');
  for(const [key,value] of Object.entries(patch.palette||{})){if(!/^(?:[0-9]|1[0-5])$/.test(key)||!Number.isInteger(value)||value<0||value>0xffffff)throw Error('配色增量无效');palette[key]=value}
  if(patch.transparent!==undefined&&typeof patch.transparent!=='boolean')throw Error('透明背景无效');
  return {frames,palette,...(patch.transparent===undefined?{}:{transparent:patch.transparent}),...(Number.isInteger(patch.seed)?{seed:patch.seed|0}:{})};
}
export function visitPaintPatch(patch,width,height,fn){const length=width*height;patch.frames.forEach((runs,f)=>{for(const [start,data] of runs){const bytes=from64(data);for(let i=0;i<bytes.length;i++)fn(f*length+start+i,bytes[i])}});for(const [slot,value] of Object.entries(patch.palette||{}))fn(length*3+Number(slot),value);if(patch.transparent!==undefined)fn(length*3+16,Number(patch.transparent))}
export function patchFromPaintCells(cells,width,height){
  const length=width*height,frames=[[],[],[]],palette={};let transparent;
  const sorted=[...cells].sort((a,b)=>a[0]-b[0]);for(let i=0;i<sorted.length;){const [index,value]=sorted[i];if(index>=length*3){if(index===length*3+16)transparent=!!value;else palette[index-length*3]=value;i++;continue}const f=Math.floor(index/length),start=index%length,values=[value];i++;while(i<sorted.length&&sorted[i][0]===f*length+start+values.length&&values.length<8192)values.push(sorted[i++][1]);frames[f].push([start,to64(Uint8Array.from(values))])}
  return {frames,palette,...(transparent===undefined?{}:{transparent})};
}
export function applyPaintPatch(state,patch,{skip=new Set()}={}){const frames=paintStatePixels(state),length=state.width*state.height,palette=state.palette.slice();let transparent=state.transparent;visitPaintPatch(patch,state.width,state.height,(index,value)=>{if(skip.has(index))return;if(index<length*3)frames[Math.floor(index/length)][index%length]=value;else if(index<length*3+16)palette[index-length*3]=value;else transparent=!!value});return {...state,frames:frames.map(p=>encodePaintFrame(p,state.width,state.height)),palette,transparent,seed:patch.seed??state.seed}}
