import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {PAINT_PALETTE_SLOTS,parsePaintPalette,paintPaletteHex} from './paint-colors.js';
import {JOINT_PAINT_TOOL} from './paint-joint-tools.js';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PAINT_BRUSHES=['pencil','pen','Blobby','StippleTiny','SoftLrg','hi36','hi39','hi33','hi32','eraser'];
const id={type:'string',description:'字段名为 id，值为 create/list 返回的完整作品 UUID 字符串；不是标题。兼容旧调用的 paintingId 字段。'},str={type:'string'};
const tool=(name,description,properties,required=[])=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false}});
const paletteSchema={type:'object',description:'原版五个调色槽，可只传要修改的槽；值为六位 RRGGBB 或 #RRGGBB。改槽会同时改变该槽已有笔迹；不是每条笔画的独立颜色。',properties:Object.fromEntries(Object.keys(PAINT_PALETTE_SLOTS).map(key=>[key,{type:'string',pattern:'^#?[0-9a-fA-F]{6}$',description:({foreground:'pen/pencil/Blobby/StippleTiny/SoftLrg 的颜色',background:'背景及 hi32 的颜色',pink:'hi36 彩色笔的颜色',cyan:'hi39 彩色笔的颜色',yellow:'hi33 彩色笔的颜色'})[key]}])),minProperties:1,additionalProperties:false};
export const PAINT_TOOLS=[
  tool('manage_painting','管理原版抖动画室作品。create 新建自己的画、list 列出自己的及用户在本房间分享的作品、undo 撤销自己的上一批笔画、rename 改标题。例 {"action":"create","title":"给你的花"}。用户个人作品只能看，可新建自己的画回应；已接受的一起画作品可由双方编辑，直接使用共同作品 id，不要另建画布。',{action:{...str,enum:['create','list','undo','rename']},id,title:{...str,maxLength:80}},['action']),
  tool('draw_painting','用 WigglyPaint 原版笔刷批量画线或改配色，strokes 与 palette 至少传一项。坐标默认 355×261，左上角 [0,0]。pen/pencil/Blobby/StippleTiny/SoftLrg 用 foreground；hi36/hi39/hi33 分别用 pink/cyan/yellow，hi32 用 background，eraser 擦除。palette 用六位颜色码，可带 #，未传的槽保持；改槽也会改变该槽已有笔迹。size 为0~26档位，默认4，仅彩色笔和橡皮有效。每批最多 60 条笔画、2000 个轨迹点，每条最多 500 点。每条 points 是连续轨迹，可闭合；复杂图可在同一画布分批接着画。画后 look，再 share。例 {"id":"作品id","palette":{"foreground":"#273C32","pink":"F08DA8"},"strokes":[{"brush":"pen","points":[[20,20],[60,60]]}]}。',{id,palette:paletteSchema,strokes:{type:'array',minItems:1,maxItems:60,items:{type:'object',properties:{brush:{...str,enum:PAINT_BRUSHES},size:{type:'integer',minimum:0,maximum:26},points:{type:'array',minItems:1,maxItems:500,items:{type:'array',minItems:2,maxItems:2,items:{type:'number'}}}},required:['brush','points'],additionalProperties:false}}},['id']),
  tool('look_painting','查看作品当前画面，返回 PNG 给你看，不自动发给用户。可看自己的画、本房间共同画布或用户分享的画。例 {"id":"作品id"}。',{id},['id']),
  tool('share_painting','把自己的作品或本房间共同画布作为抖动 GIF 发到当前聊天，一轮最多一张图。分享保存当时的快照，后续修改不会改变已发送图片。界面自动显示分享人和作品名；作品 id 只用于工具，不要写进聊天正文。例 {"id":"作品id"}。',{id},['id']),
  JOINT_PAINT_TOOL
];
let rendering=0;
export async function renderPainting(job,onProgress){
  if(rendering>=2)throw Error('画室正在处理其他作品，请稍后再试');
  rendering++;let worker,timer;
  try{return await new Promise((resolve,reject)=>{
    worker=new Worker(new URL('./paint-worker.js',import.meta.url),{workerData:{...job,progress:!!onProgress},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128}});
    timer=setTimeout(()=>reject(Error('画布处理超时，请减少笔画后重试')),15000);
    worker.on('message',r=>{
      if(r.progress){try{onProgress?.(r.progress)}catch(error){reject(error)}}
      else if(r.ok)resolve(r);
      else reject(Error(r.error));
    });
    worker.once('error',()=>reject(Error('画室暂时无法处理这幅作品')));
    worker.once('exit',()=>reject(Error('画布处理进程已结束')));
  })}finally{clearTimeout(timer);await worker?.terminate();rendering--}
}
export function validatePaintState(raw){
  if(!raw||!Number.isInteger(raw.width)||!Number.isInteger(raw.height)||raw.width<8||raw.height<8||raw.width>1024||raw.height>1024||raw.width*raw.height>524288)throw Error('画布尺寸无效，最长边 1024 像素');
  if(!Array.isArray(raw.frames)||raw.frames.length!==3)throw Error('作品必须包含三帧');
  const frames=raw.frames.map(value=>{
    if(typeof value!=='string'||value.length>800000||!/^%%IMG[0-3][A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('画布数据无效');
    const bytes=Buffer.from(value.slice(6),'base64');
    if(bytes.length<4||bytes.readUInt16BE(0)!==raw.width||bytes.readUInt16BE(2)!==raw.height)throw Error('画布帧尺寸不一致');
    return value;
  });
  if(!Array.isArray(raw.palette)||raw.palette.length!==16||raw.palette.some(c=>!Number.isInteger(c)||c<0||c>0xffffff))throw Error('画布配色无效');
  return {width:raw.width,height:raw.height,frames,palette:raw.palette.slice(),transparent:raw.transparent===true,seed:Number.isInteger(raw.seed)?raw.seed|0:0x12345};
}
function title(value){if(typeof value!=='string'||value.trim().length>80)throw Error('作品标题最多 80 字');return value.trim()||'未命名作品'}
export function validatePaintStrokes(value,state){
  if(!Array.isArray(value)||!value.length||value.length>60)throw Error('每批需要 1~60 条笔画');let count=0;
  return value.map(s=>{
    if(!s||!PAINT_BRUSHES.includes(s.brush)||s.size!==undefined&&(!Number.isInteger(s.size)||s.size<0||s.size>26)||!Array.isArray(s.points)||!s.points.length||s.points.length>500)throw Error('笔刷或笔画格式无效');
    const points=s.points.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n))||p[0]<0||p[1]<0||p[0]>=state.width||p[1]>=state.height)throw Error(`坐标需在 0~${state.width-1}、0~${state.height-1} 范围内`);return p.map((n,i)=>Math.min((i?state.height:state.width)-1,Math.round(n)))});
    count+=points.length;if(count>2000)throw Error('每批最多 2000 个轨迹点');return {brush:s.brush,size:s.size??4,points};
  });
}
export class PaintService{
  constructor({dataDir,signingKey,readMessages=()=>[],readConversations=()=>[],render=renderPainting}){this.root=join(dataDir,'paintings');this.secret=signingKey;this.messages=readMessages;this.rooms=readConversations;this.render=render;this.locks=new Set();for(const d of ['works','shares'])mkdirSync(join(this.root,d),{recursive:true,mode:0o700})}
  path(id){if(!ID.test(String(id)))throw Error('作品不存在');return join(this.root,'works',id+'.json')}
  read(id){try{return JSON.parse(readFileSync(this.path(id),'utf8'))}catch{throw Error('作品不存在')}}
  atomic(path,bytes){writeFileSync(path+'.tmp',bytes,{mode:0o600});renameSync(path+'.tmp',path)}
  write(record){this.atomic(this.path(record.id),JSON.stringify(record))}
  sign(value){return createHmac('sha256',this.secret).update('paint:'+value).digest('hex')}
  valid(value,token){return /^[0-9a-f]{64}$/.test(String(token||''))&&timingSafeEqual(Buffer.from(this.sign(value),'hex'),Buffer.from(token,'hex'))}
  readShare(id,room){if(!ID.test(id))throw Error('分享不存在');const share=JSON.parse(readFileSync(join(this.root,'shares',id+'.json'),'utf8'));if(share.room!==room||!this.messages().some(m=>m.conversationId===room&&!m.recalled&&[...(m.images||[]),m.image].some(u=>typeof u==='string'&&u.startsWith('/api/chat/paint-images/'+id+'?'))))throw Error('分享未在本房间发送或已撤回');return share}
  imageForChat(value,room){if(!String(value).startsWith('/api/chat/paint-images/'))return value;const url=new URL(value,'http://local'),id=url.pathname.split('/').pop();if(url.searchParams.get('conversationId')!==room||!this.valid(id+':'+room,url.searchParams.get('token')))throw Error('画作分享不可用');this.readShare(id,room);return 'data:image/png;base64,'+readFileSync(join(this.root,'shares',id+'.png')).toString('base64')}
  latestShare(id,room){for(const m of [...this.messages()].reverse()){if(m.conversationId!==room||m.recalled)continue;for(const value of [...(m.images||[]),m.image]){if(typeof value!=='string'||!value.startsWith('/api/chat/paint-images/'))continue;try{const share=this.readShare(new URL(value,'http://local').pathname.split('/').pop(),room);if(share.workId===id)return {...share,image:value}}catch{}}}return null}
  meta(r){return {id:r.id,title:r.title,owner:r.owner,room:r.room,version:r.version,width:r.state.width,height:r.state.height,palette:paintPaletteHex(r.state.palette),createdAt:r.createdAt,updatedAt:r.updatedAt,...(r.owner==='joint'?{joint:{sessionId:r.id,status:r.joint?.status||'active'}}:{}),preview:`/api/paint/works/${r.id}/preview?version=${r.version}&token=${this.sign(r.id+':'+r.version)}`}}
  messageShare(message){
    if(message?.recalled)return null;
    for(const value of [...(message?.images||[]),message?.image]){
      if(typeof value!=='string'||!value.startsWith('/api/chat/paint-images/'))continue;
      try{const url=new URL(value,'http://local'),id=url.pathname.split('/').pop(),room=message.conversationId;if(!ID.test(id)||url.searchParams.get('conversationId')!==room||!this.valid(id+':'+room,url.searchParams.get('token')))continue;const share=JSON.parse(readFileSync(join(this.root,'shares',id+'.json'),'utf8'));if(share.room!==room)continue;return {workId:share.workId,title:/^未命名作品$/.test(String(share.title||'').trim())?'':String(share.title||'').trim()}}catch{}
    }return null;
  }
  visibleMessageContent(message){const text=String(message?.content||'');return /^【绘画作品】[^\n]*\r?\n作品编号[:：]\s*[0-9a-f-]{36}\s*$/i.test(text)?'':text}
  messageContext(message){const share=this.messageShare(message);if(!share)return String(message?.content||'');return [this.visibleMessageContent(message).trim(),`[${message.role==='iris'?'用户':'AI'}分享了一张画${share.title?' · '+share.title:''}]`,`[画作引用，仅供工具使用：${JSON.stringify({id:share.workId})}；可用 look_painting 查看已分享画面]`].filter(Boolean).join('\n\n')}
  sharedIn(id,room){return !!this.latestShare(id,room)}
  allowAI(r,room,edit=false){if(!room||!this.rooms().some(c=>c.id===room))throw Error('聊天房间不存在');if(r.owner==='ai'&&r.room===room)return;if(!edit&&this.sharedIn(r.id,room))return;throw Error('作品未在本房间分享，或不属于你的画室')}
  list(room='',ai=false){const works=readdirSync(join(this.root,'works')).filter(n=>ID.test(n.slice(0,-5))&&n.endsWith('.json')).map(n=>{try{return JSON.parse(readFileSync(join(this.root,'works',n),'utf8'))}catch{return null}}).filter(Boolean);return works.filter(r=>ai?(r.owner==='ai'||r.owner==='joint')&&r.room===room||this.sharedIn(r.id,room):r.owner==='user'||room&&r.room===room).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100).map(r=>{if(!ai)return this.meta(r);const shared=r.owner==='ai'&&r.room===room?null:this.latestShare(r.id,room);return {id:r.id,title:shared?.title||r.title,owner:r.owner,width:shared?.width||r.state.width,height:shared?.height||r.state.height,version:shared?.version||r.version,...(shared?shared.palette?{palette:shared.palette}:{}:{palette:paintPaletteHex(r.state.palette)}),updatedAt:shared?.createdAt||r.updatedAt}})}
  async create({owner='user',room='',name='未命名作品',state}={}){if(readdirSync(join(this.root,'works')).filter(n=>n.endsWith('.json')).length>=1000)throw Error('画室作品已达上限，请先整理');const r=await this.render(state?{state:validatePaintState(state)}:{}),at=new Date().toISOString(),record={id:randomUUID(),owner,room,title:title(name),version:1,state:r.state,history:[],createdAt:at,updatedAt:at};this.persist(record,r);return record}
  persist(record,result){this.atomic(join(this.root,'works',record.id+'.png'),Buffer.from(result.png));this.atomic(join(this.root,'works',record.id+'.gif'),Buffer.from(result.gif));this.write(record)}
  async update(id,fn){if(this.locks.has(id))throw Error('这幅画正在保存，请稍后再试');this.locks.add(id);try{return await fn(this.read(id))}finally{this.locks.delete(id)}}
  async save(id,{state,version,name}){return this.update(id,async r=>{if(r.owner!=='user')throw Error('这是 TA 的作品，可以复制后再画');if(version!==r.version)throw Error('作品已在其他窗口更新，请先保留草稿再重新打开');const result=await this.render({state:validatePaintState(state)});r.history=[r.state,...r.history].slice(0,5);r.state=result.state;r.title=title(name??r.title);r.version++;r.updatedAt=new Date().toISOString();this.persist(r,result);return r})}
  collection(owner='user',room=''){if(!['user','ai','joint'].includes(owner))throw Error('作品类型无效');return readdirSync(join(this.root,'works')).filter(n=>n.endsWith('.json')&&ID.test(n.slice(0,-5))).map(n=>{try{return JSON.parse(readFileSync(join(this.root,'works',n),'utf8'))}catch{return null}}).filter(r=>r&&r.owner===owner&&(!room||owner==='user'||r.room===room)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100).map(r=>({...this.meta(r),roomTitle:this.rooms().find(c=>c.id===r.room)?.title||''}))}
  async renameSaved(id,name,version){const existing=this.read(id);if(existing.owner==='joint')return this.joint.rename(id,existing.room,name,version);return this.update(id,r=>{if(version!==r.version)throw Error('作品已更新，请重新打开作品集');r.title=title(name);r.version++;r.updatedAt=new Date().toISOString();this.write(r);return this.meta(r)})}
  async removeSaved(id,version){const existing=this.read(id);if(existing.owner==='joint'&&existing.joint?.status==='active')throw Error('请先结束一起画，再删除共同作品');return this.update(id,r=>{if(version!==r.version)throw Error('作品已更新，请重新打开作品集');const folder=join(this.root,'trash',r.id+'-'+Date.now());mkdirSync(folder,{recursive:true,mode:0o700});const moved=[];try{for(const extension of ['png','gif','json']){const name=r.id+'.'+extension;renameSync(join(this.root,'works',name),join(folder,name));moved.push(name)}}catch(error){for(const name of moved.reverse())renameSync(join(folder,name),join(this.root,'works',name));throw error}if(r.owner==='joint')this.joint?.live.delete(r.id);return {ok:true,id:r.id}})}
  share(r,room,rendered=null){if(!this.rooms().some(c=>c.id===room))throw Error('请先选择聊天房间');const id=randomUUID(),share={id,workId:r.id,title:r.title,owner:r.owner,room,version:r.version,width:r.state.width,height:r.state.height,palette:paintPaletteHex(r.state.palette),createdAt:new Date().toISOString()};for(const format of ['gif','png'])writeFileSync(join(this.root,'shares',id+'.'+format),rendered?Buffer.from(rendered[format]):readFileSync(join(this.root,'works',r.id+'.'+format)),{flag:'wx',mode:0o600});writeFileSync(join(this.root,'shares',id+'.json'),JSON.stringify(share),{flag:'wx',mode:0o600});return {image:`/api/chat/paint-images/${id}?conversationId=${encodeURIComponent(room)}&token=${this.sign(id+':'+room)}`,content:'',workId:r.id}}
  async tool(name,args,state,toolImageStore){
    const room=state.conversationId;
    if(!room||!this.rooms().some(c=>c.id===room))throw Error('聊天房间不存在');
    if(name==='joint_painting')return this.joint.tool(args,state);
    if(name==='manage_painting'&&args.action==='list')return {works:this.list(room,true)};
    if(name==='manage_painting'&&args.action==='create'){const r=await this.create({owner:'ai',room,name:args.title||'未命名作品'});return {...this.meta(r),brushes:PAINT_BRUSHES,notice:'画布已新建。批量画笔画→look 检查→share 发给用户。'}}
    if(args.id!==undefined&&args.paintingId!==undefined&&args.id!==args.paintingId)throw Error('id 与 paintingId 不一致，请使用 create/list 返回的同一个作品 id');
    const requestedId=args.id??args.paintingId;
    if(requestedId===undefined||requestedId===null||requestedId==='')throw Error('缺少作品 id：请传 {"id":"create/list 返回的作品 UUID"}，不需要重新新建画布');
    if(typeof requestedId!=='string'||!ID.test(requestedId.trim().toLowerCase()))throw Error('作品 id 格式无效：请使用 create/list 返回的完整 UUID 字符串，不是作品标题');
    let r=this.read(requestedId.trim().toLowerCase());if(r.owner==='joint'&&r.room===room)return this.joint.paintTool(name,args,state,toolImageStore);this.allowAI(r,room,name!=='look_painting');
    if(name==='look_painting'){const share=r.owner==='ai'&&r.room===room?null:this.latestShare(r.id,room),bytes=readFileSync(share?join(this.root,'shares',share.id+'.png'):join(this.root,'works',r.id+'.png')),image=toolImageStore.store(room,'image/png',bytes.toString('base64'));(state.pendingToolImages||=[]).push(image.id);return {id:r.id,title:share?.title||r.title,version:share?.version||r.version,...(share?share.palette?{palette:share.palette}:{}:{palette:paintPaletteHex(r.state.palette)}),content:[{type:'image',attachmentId:image.id,mimeType:'image/png',note:share?'用户在本房间分享的画面':'当前画布，请查看后再决定下一笔'}]}}
    if(name==='share_painting'){if((state.generatedImages||[]).length)throw Error('本轮已经发过图片，请下轮再分享');const shared=this.share(r,room);(state.generatedImages||=[]).push(shared.image);return {ok:true,id:r.id,title:r.title,notice:'GIF 快照已附在聊天中，系统会显示分享提示；无需在正文复述作品编号'}}
    return this.update(r.id,async r=>{
      if(name==='manage_painting'&&args.action==='rename'){r.title=title(args.title);r.updatedAt=new Date().toISOString();this.write(r);return this.meta(r)}
      let result;
      if(name==='manage_painting'&&args.action==='undo'){if(!r.history.length)throw Error('没有可撤销的笔画');result=await this.render({state:r.history[0]});r.history=r.history.slice(1)}
      else if(name==='draw_painting'){
        if(args.strokes===undefined&&args.palette===undefined)throw Error('请至少传 strokes 笔画或 palette 配色');
        const valid=args.strokes===undefined?[]:validatePaintStrokes(args.strokes,r.state),palette=args.palette===undefined?undefined:parsePaintPalette(args.palette);
        result=await this.render({state:r.state,strokes:valid,palette});r.history=[r.state,...r.history].slice(0,5);
      }
      else throw Error('绘画操作无效');
      r.state=result.state;r.version++;r.updatedAt=new Date().toISOString();this.persist(r,result);return {...this.meta(r),notice:'画布已更新，可 look 查看或继续画；完成后 share 分享'};
    });
  }
  install(app,auth){
    const route=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){res.status(400).json({error:e.message})}};
    app.get('/api/paint/works',auth,route((q,r)=>r.json({works:q.query.owner?this.collection(String(q.query.owner),String(q.query.room||'')):this.list(String(q.query.room||''))})));
    app.get('/api/paint/rooms',auth,(_q,r)=>r.json({rooms:this.rooms().map(c=>({id:c.id,title:c.title||'聊天'}))}));
    app.post('/api/paint/works',auth,route(async(q,r)=>r.status(201).json(this.meta(await this.create({name:q.body?.title||'未命名作品',state:q.body?.state})))));
    app.get('/api/paint/works/:id',auth,route((q,r)=>{const work=this.read(q.params.id);r.set('Cache-Control','no-store').json({...this.meta(work),state:work.state,readOnly:work.owner!=='user'})}));
    app.put('/api/paint/works/:id',auth,route(async(q,r)=>r.json(this.meta(await this.save(q.params.id,q.body)))));
    app.patch('/api/paint/works/:id',auth,route(async(q,r)=>r.json(await this.renameSaved(q.params.id,q.body?.title,q.body?.version))));
    app.delete('/api/paint/works/:id',auth,route(async(q,r)=>r.json(await this.removeSaved(q.params.id,q.body?.version))));
    app.post('/api/paint/works/:id/share',auth,route(async(q,r)=>{const work=this.read(q.params.id),room=String(q.body?.room||'');r.json(work.owner==='joint'?await this.joint.share(work.id,work.room,room):this.share(work,room))}));
    app.get('/api/paint/works/:id/download',auth,route((q,r)=>{const work=this.read(q.params.id);r.json({url:this.meta(work).preview+'&format=gif&download=1'})}));
    app.get('/api/paint/works/:id/preview',(q,r)=>{try{const work=this.read(q.params.id);if(!this.valid(work.id+':'+work.version,q.query.token))return r.status(404).end();const format=q.query.format==='gif'?'gif':'png';r.set('Cache-Control','private, no-store');if(q.query.download==='1')r.set('Content-Disposition',`attachment; filename="painting.${format}"; filename*=UTF-8''${encodeURIComponent(work.title+'.'+format)}`);r.type(format).send(readFileSync(join(this.root,'works',work.id+'.'+format)))}catch{r.status(404).end()}});
    app.get('/api/chat/paint-images/:id',(q,r)=>{const id=q.params.id,room=String(q.query.conversationId||'');if(!ID.test(id)||!this.valid(id+':'+room,q.query.token))return r.status(404).end();try{const share=JSON.parse(readFileSync(join(this.root,'shares',id+'.json'),'utf8'));if(share.room!==room||!this.messages().some(m=>m.conversationId===room&&!m.recalled&&[...(m.images||[]),m.image].some(u=>typeof u==='string'&&u.startsWith('/api/chat/paint-images/'+id+'?'))))return r.status(404).end();r.set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff');if(q.query.info==='1')return r.json(share);const format=q.query.format==='png'?'png':'gif';r.type(format).send(readFileSync(join(this.root,'shares',id+'.'+format)))}catch{r.status(404).end()}});
  }
}
