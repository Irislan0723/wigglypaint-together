import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {deflateSync,inflateSync} from 'node:zlib';
import {validatePaintStrokes} from './paint-service.js';
import {parsePaintPalette} from './paint-colors.js';
import {paintPixelDiff,paintPatchEmpty,validatePaintPatch,paintStatePixels,encodePaintFrame,visitPaintPatch,patchFromPaintCells} from './public/paint-pixels-v1.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const now=()=>new Date().toISOString();
const pack=value=>deflateSync(Buffer.from(JSON.stringify(value)),{level:1}).toString('base64');
const unpack=value=>JSON.parse(inflateSync(Buffer.from(value,'base64'),{maxOutputLength:32000000}).toString('utf8'));
export class JointPaintService{
  constructor({paint,readMessages,writeMessages,readConversations}){
    this.paint=paint;this.messages=readMessages;this.writeMessages=writeMessages;this.rooms=readConversations;this.folder=join(paint.root,'invites');mkdirSync(this.folder,{recursive:true,mode:0o700});this.live=new Map();this.watchers=new Map();this.inviteLocks=new Set();paint.joint=this;
  }
  room(room){if(typeof room!=='string'||!this.rooms().some(c=>c.id===room))throw Error('聊天房间不存在');return room}
  invitePath(id){if(!UUID.test(String(id)))throw Error('绘画邀请不存在');return join(this.folder,id+'.json')}
  invite(id){try{return JSON.parse(readFileSync(this.invitePath(id),'utf8'))}catch{throw Error('绘画邀请不存在')}}
  saveInvite(invite){this.paint.atomic(this.invitePath(invite.id),JSON.stringify(invite))}
  invites(room){return readdirSync(this.folder).filter(n=>n.endsWith('.json')).map(name=>{try{return JSON.parse(readFileSync(join(this.folder,name),'utf8'))}catch{return null}}).filter(i=>i&&i.room===room&&this.messages().some(m=>m.id===i.messageId&&m.conversationId===room&&!m.recalled)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30)}
  publicInvite(invite){let sessionStatus=null;if(invite.sessionId)try{sessionStatus=this.get(invite.sessionId,invite.room,false).record.joint.status}catch{}return {id:invite.id,messageId:invite.messageId,room:invite.room,status:invite.status,title:invite.title,sessionId:invite.sessionId||null,sessionStatus,createdAt:invite.createdAt,respondedAt:invite.respondedAt||null}}
  messageMeta(message){if(!message?.coPaintId||message.recalled)return null;try{const i=this.invite(message.coPaintId);if(i.messageId!==message.id||i.room!==message.conversationId)return null;return this.publicInvite(i)}catch{return null}}
  messageContext(message){const i=this.messageMeta(message);if(!i)return String(message?.content||'');if(i.status==='pending')return `[用户邀请你一起画画，invitationId=${i.id}。请自主决定接受或拒绝，并调用 joint_painting(action=accept/reject, invitationId)，仅在正文说同意不会开始会话]`;if(i.status==='accepted')return `[一起画${i.sessionStatus==='active'?'进行中':'已结束'}，共同作品 id=${i.sessionId}。用户和你编辑同一张画布；按聊天内容用 draw_painting 画、look_painting 查看，不需要强制轮流]`;return `[一起画邀请${i.status==='declined'?'已拒绝':'已取消'}]`}
  createInvite(room,title='我们的小画'){
    this.room(room);const active=this.active(room);if(active)throw Error('这个房间已经在一起画，可以继续打开画板');const pending=this.invites(room).find(i=>i.status==='pending');if(pending)return this.messages().find(m=>m.id===pending.messageId);
    const at=now(),invite={id:randomUUID(),messageId:randomUUID(),room,title:String(title||'我们的小画').trim().slice(0,80)||'我们的小画',status:'pending',createdAt:at};
    const message={id:invite.messageId,conversationId:room,replyGroupId:randomUUID(),role:'user',systemType:'joint_paint_invitation',coPaintId:invite.id,content:'邀请你一起画一张画',favorite:false,createdAt:at,updatedAt:at};
    this.saveInvite(invite);const messages=this.messages();messages.push(message);this.writeMessages(messages);this.emit(room,{type:'invitation',invitation:this.publicInvite(invite)});return message;
  }
  active(room){for(const live of this.live.values())if(live.record.room===room&&live.record.joint.status==='active')return live;for(const file of readdirSync(join(this.paint.root,'works'))){if(!file.endsWith('.json'))continue;let r;try{r=this.paint.read(file.slice(0,-5))}catch{continue}if(r.owner==='joint'&&r.room===room&&r.joint?.status==='active')return this.get(r.id,room,false)}return null}
  get(id,room,edit=true){
    this.room(room);let live=this.live.get(id);const record=live?.record||this.paint.read(id);if(record.owner!=='joint'||record.room!==room||!record.joint)throw Error('这张共同作品不属于当前房间');
    if(edit&&(record.joint.status!=='active'||live?.ending))throw Error('一起画已经结束，只能查看或复制');
    if(!live){
      const count=record.joint.status==='active'?record.state.width*record.state.height*3+17:0;let machine=record.joint.machine?unpack(record.joint.machine):null;
      const writers=new Uint32Array(count);if(machine?.writers){const b=Buffer.from(machine.writers,'base64');if(b.length!==writers.byteLength)throw Error('共同画布记录损坏');new Uint8Array(writers.buffer).set(b)}
      live={record,writers,undo:(machine?.undo||[]).map(g=>({...g,cells:new Map(g.cells.map(c=>[c[0],c]))})),redo:(machine?.redo||[]).map(g=>({...g,cells:new Map(g.cells.map(c=>[c[0],c]))})),seen:new Map(machine?.seen||[]),rate:new Map(),previewTimer:null};if(record.joint.status==='active')this.live.set(id,live);
    }return live;
  }
  meta(live){return {...this.paint.meta(live.record),status:live.record.joint.status,sequence:live.record.joint.sequence||0,invitationId:live.record.joint.invitationId,endedAt:live.record.joint.endedAt||null,canUndo:live.record.joint.status==='active'&&live.undo.some(g=>g.actor==='user'),canRedo:live.record.joint.status==='active'&&live.redo.some(g=>g.actor==='user')}}
  snapshot(live){return {...this.meta(live),state:live.record.state,knownOperations:[...live.seen.keys()].slice(-2000)}}
  store(live){
    const groups=list=>list.map(g=>({...g,cells:[...g.cells.values()]}));const machine={...(live.record.joint.status==='active'?{writers:Buffer.from(live.writers.buffer).toString('base64'),undo:groups(live.undo),redo:groups(live.redo)}:{}),seen:[...live.seen.entries()].slice(-2000)};
    live.record.joint.machine=pack(machine);try{this.paint.write(live.record)}catch(error){clearTimeout(live.previewTimer);this.live.delete(live.record.id);throw error}
  }
  trim(live){let cells=live.undo.reduce((n,g)=>n+g.cells.size,0);while(live.undo.length>30||cells>600000&&live.undo.length>1)cells-=live.undo.shift().cells.size;while(live.redo.length>12)live.redo.shift();while(live.seen.size>2000)live.seen.delete(live.seen.keys().next().value)}
  async respond(id,room,decision){
    this.room(room);if(!['accept','reject','cancel'].includes(decision))throw Error('邀请回复无效');if(this.inviteLocks.has(id))throw Error('邀请正在处理，请稍后再试');this.inviteLocks.add(id);
    try{
      const invite=this.invite(id);if(invite.room!==room||!this.messages().some(m=>m.id===invite.messageId&&m.conversationId===room&&!m.recalled))throw Error('邀请不属于当前房间或已撤回');
      if(invite.status!=='pending'){if(invite.status==='accepted'&&decision==='accept')return {invitation:this.publicInvite(invite),session:this.snapshot(this.get(invite.sessionId,room,false))};throw Error('这张邀请已经处理过了')}
      if(decision==='accept'){
        if(this.active(room))throw Error('房间已存在正在进行的共同画布');const record=await this.paint.create({owner:'joint',room,name:invite.title});record.joint={status:'active',sequence:0,invitationId:invite.id,startedAt:now()};this.paint.write(record);invite.status='accepted';invite.sessionId=record.id;
      }else invite.status=decision==='reject'?'declined':'cancelled';
      invite.respondedAt=now();this.saveInvite(invite);const result={invitation:this.publicInvite(invite),session:invite.sessionId?this.snapshot(this.get(invite.sessionId,room,false)):null};this.emit(room,{type:'invitation',...result});return result;
    }finally{this.inviteLocks.delete(id)}
  }
  apply(id,room,{operationId,clientId,groupId,patch},actor='user'){
    if(!UUID.test(String(operationId))||!UUID.test(String(clientId))||!UUID.test(String(groupId)))throw Error('笔迹编号无效');const live=this.get(id,room),r=live.record;if(live.seen.has(operationId))return {duplicate:true,operationId,...this.meta(live)};
    if(actor==='user'){
      const rate=live.rate.get(clientId)||[];const recent=rate.filter(t=>Date.now()-t<1000);if(recent.length>=20)throw Error('落笔太快，正在同步，请稍后再试');recent.push(Date.now());live.rate.set(clientId,recent);if(live.rate.size>128)for(const [key,times] of live.rate)if(!times.some(t=>Date.now()-t<1000))live.rate.delete(key);
    }
    patch=validatePaintPatch(patch,r.state.width,r.state.height);if(paintPatchEmpty(patch))return {operationId,empty:true,...this.meta(live)};
    const pixels=paintStatePixels(r.state),length=r.state.width*r.state.height,seq=(r.joint.sequence||0)+1;
    let group=live.undo.find(g=>g.id===groupId&&g.actor===actor);if(!group){group={id:groupId,actor,cells:new Map()};live.undo.push(group)}
    const palette=r.state.palette.slice();let transparent=r.state.transparent;
    visitPaintPatch(patch,r.state.width,r.state.height,(index,value)=>{
      const before=index<length*3?pixels[Math.floor(index/length)][index%length]:index<length*3+16?palette[index-length*3]:Number(transparent);const previous=group.cells.get(index);group.cells.set(index,[index,previous?previous[1]:before,value,previous?previous[3]:live.writers[index],seq]);live.writers[index]=seq;
      if(index<length*3)pixels[Math.floor(index/length)][index%length]=value;else if(index<length*3+16)palette[index-length*3]=value;else transparent=!!value;
    });
    r.state={...r.state,frames:pixels.map(p=>encodePaintFrame(p,r.state.width,r.state.height)),palette,transparent,seed:patch.seed??r.state.seed};r.version++;r.joint.sequence=seq;r.updatedAt=now();live.redo=live.redo.filter(g=>g.actor!==actor);live.seen.set(operationId,seq);this.trim(live);this.store(live);
    const event={type:'patch',sessionId:id,operationId,clientId,actor,patch,...this.meta(live)};this.emit(room,event);this.preview(live);return {operationId,...this.meta(live)};
  }
  undo(id,room,actor='user',redo=false){
    const live=this.get(id,room),r=live.record,from=redo?live.redo:live.undo,to=redo?live.undo:live.redo;let index=from.length-1;while(index>=0&&from[index].actor!==actor)index--;if(index<0)throw Error(redo?'没有自己可重做的笔画':'没有自己可撤回的笔画');const group=from.splice(index,1)[0],pixels=paintStatePixels(r.state),length=r.state.width*r.state.height,palette=r.state.palette.slice(),changes=[];let transparent=r.state.transparent;
    const seq=(r.joint.sequence||0)+1,next={id:group.id,actor,cells:new Map()};
    for(const cell of group.cells.values()){
      const [i,before,after,previous,last]=cell;if(live.writers[i]!==last)continue;const value=redo?after:before;
      if(i<length*3)pixels[Math.floor(i/length)][i%length]=value;else if(i<length*3+16)palette[i-length*3]=value;else transparent=!!value;
      changes.push([i,value]);if(redo){next.cells.set(i,[i,before,after,live.writers[i],seq]);live.writers[i]=seq}else{live.writers[i]=previous;next.cells.set(i,[i,before,after,previous,previous])}
    }
    to.push(next);r.state={...r.state,frames:pixels.map(p=>encodePaintFrame(p,r.state.width,r.state.height)),palette,transparent};r.version++;r.joint.sequence=seq;r.updatedAt=now();this.trim(live);this.store(live);const patch=patchFromPaintCells(changes,r.state.width,r.state.height);this.emit(room,{type:'patch',sessionId:id,actor,patch,operationId:randomUUID(),clientId:null,...this.meta(live)});this.preview(live);return this.meta(live);
  }
  clear(id,room){const live=this.get(id,room),state=live.record.state,next={...state,frames:state.frames.map(()=>encodePaintFrame(new Uint8Array(state.width*state.height),state.width,state.height))};return this.apply(id,room,{operationId:randomUUID(),clientId:randomUUID(),groupId:randomUUID(),patch:paintPixelDiff(state,next)},'user')}
  preview(live){clearTimeout(live.previewTimer);if(live.record.joint.status!=='active')return;live.previewTimer=setTimeout(()=>{this.materialize(live).catch(()=>{})},650);live.previewTimer.unref?.()}
  async materialize(live){
    const version=live.record.version,state=live.record.state,result=await this.paint.render({state});if(this.live.get(live.record.id)===live&&live.record.version===version){this.paint.atomic(join(this.paint.root,'works',live.record.id+'.png'),Buffer.from(result.png));this.paint.atomic(join(this.paint.root,'works',live.record.id+'.gif'),Buffer.from(result.gif))}return {version,result};
  }
  async share(id,room,targetRoom){const live=this.get(id,room,false),record={...live.record},result=await this.paint.render({state:record.state});return this.paint.share(record,targetRoom,result)}
  async finish(id,room,actor='user'){
    const live=this.get(id,room,false);if(live.record.joint.status==='ended')return this.meta(live);if(live.ending)throw Error('正在保存共同作品');
    if(live.drawing)throw Error('TA 正在画，画完后再结束一起画');
    live.ending=true;
    try{clearTimeout(live.previewTimer);await this.materialize(live);live.record.joint.status='ended';live.record.joint.endedAt=now();live.record.joint.endedBy=actor;live.record.version++;live.record.updatedAt=now();this.store(live);this.emit(room,{type:'ended',session:this.snapshot(live)});this.live.delete(id);return this.meta(live)}finally{live.ending=false}
  }
  async rename(id,room,title,version){const live=this.get(id,room,false);if(version!==live.record.version)throw Error('作品已更新，请重新打开作品集');if(typeof title!=='string'||title.trim().length>80)throw Error('作品名称最多 80 字');live.record.title=title.trim()||'未命名作品';live.record.version++;live.record.updatedAt=now();this.store(live);this.emit(room,{type:'metadata',session:this.meta(live)});return this.paint.meta(live.record)}
  async paintTool(name,args,state,imageStore){
    const id=(args.id??args.paintingId)?.trim().toLowerCase(),room=state.conversationId,live=this.get(id,room,name!=='look_painting'&&name!=='share_painting');
    if(name==='look_painting'){const {version,result}=await this.materialize(live),image=imageStore.store(room,'image/png',Buffer.from(result.png).toString('base64'));(state.pendingToolImages||=[]).push(image.id);return {id,version,title:live.record.title,content:[{type:'image',attachmentId:image.id,mimeType:'image/png',note:'当前共同画布，包含用户和你的笔迹'}]}}
    if(name==='share_painting'){if((state.generatedImages||[]).length)throw Error('本轮已经发过图片，请下轮再分享');const share=await this.share(id,room,room);(state.generatedImages||=[]).push(share.image);return {ok:true,id,title:live.record.title}}
    if(live.drawing&&(name==='draw_painting'||name==='manage_painting'&&args.action==='undo'))throw Error('上一批笔迹仍在同步');
    if(name==='manage_painting'&&args.action==='undo')return this.undo(id,room,'ai');
    if(name==='manage_painting'&&args.action==='rename')return this.rename(id,room,args.title,live.record.version);
    if(name!=='draw_painting')throw Error('共同画布操作无效');if(args.strokes===undefined&&args.palette===undefined)throw Error('请至少传 strokes 或 palette');
    const base=live.record.state,job={state:base,strokes:args.strokes===undefined?[]:validatePaintStrokes(args.strokes,base),...(args.palette===undefined?{}:{palette:parsePaintPalette(args.palette)})};
    const clientId=randomUUID(),groupId=randomUUID();
    let queue=Promise.resolve(),result,failure,streamed=false,lastSent=0;
    const enqueue=patch=>{
      streamed=true;
      queue=queue.then(async()=>{
        if(failure)return;
        // Give the open canvas time to paint between consecutive updates.
        const delay=75-(Date.now()-lastSent);
        if(delay>0&&this.watchers.get(room)?.size)await wait(delay);
        result=this.apply(id,room,{operationId:randomUUID(),clientId,groupId,patch},'ai');
        lastSent=Date.now();
      }).catch(error=>{failure=error});
    };
    live.drawing=true;
    try{
      const rendered=await this.paint.render(job,enqueue);
      if(!streamed)enqueue(paintPixelDiff(base,rendered.state));
      await queue;
      if(failure)throw failure;
      return result;
    }catch(error){
      await queue;
      if(result&&!result.empty)throw Error(error.message+'。已显示的笔迹已保存，可以撤销这批笔迹。');
      throw error;
    }finally{await queue;live.drawing=false}
  }
  async tool(args,state){
    const room=this.room(state.conversationId);if(args.action==='status'){const active=this.active(room);return {session:active?this.meta(active):null,invitations:this.invites(room).filter(i=>i.status==='pending').map(i=>this.publicInvite(i))}}
    if(['accept','reject'].includes(args.action)){const result=await this.respond(args.invitationId,room,args.action);return {invitation:result.invitation,session:result.session?this.meta(this.get(result.session.id,room,false)):null}}
    if(args.action==='finish')return this.finish(args.id,room,'ai');throw Error('一起画操作无效');
  }
  emit(room,event){for(const response of this.watchers.get(room)||[])response.write('data: '+JSON.stringify(event)+'\n\n')}
  install(app,auth){
    const route=fn=>async(q,r)=>{try{await fn(q,r)}catch(error){r.status(400).json({error:error.message})}};
    app.post('/api/paint/joint/invitations',auth,route((q,r)=>{const message=this.createInvite(q.body?.room,q.body?.title);r.status(201).json({...message,coPaint:this.messageMeta(message)})}));
    app.post('/api/paint/joint/invitations/:id/cancel',auth,route(async(q,r)=>r.json(await this.respond(q.params.id,q.body?.room,'cancel'))));
    app.get('/api/paint/joint/active',auth,route((q,r)=>{const room=this.room(q.query.room),active=this.active(room);r.set('Cache-Control','no-store').json({session:active?this.snapshot(active):null,invitations:this.invites(room).map(i=>this.publicInvite(i))})}));
    app.get('/api/paint/joint/sessions/:id',auth,route((q,r)=>r.set('Cache-Control','no-store').json(this.snapshot(this.get(q.params.id,q.query.room,false)))));
    app.post('/api/paint/joint/sessions/:id/operations',auth,route((q,r)=>r.json(this.apply(q.params.id,q.body?.room,q.body,'user'))));
    app.post('/api/paint/joint/sessions/:id/actions',auth,route(async(q,r)=>{const room=q.body?.room;let result;if(q.body?.action==='undo'||q.body?.action==='redo')result=this.undo(q.params.id,room,'user',q.body.action==='redo');else if(q.body?.action==='clear')result=this.clear(q.params.id,room);else if(q.body?.action==='finish')result=await this.finish(q.params.id,room);else throw Error('共同画布操作无效');r.json(result)}));
    app.get('/api/paint/joint/events',auth,(q,r)=>{
      let room;try{room=this.room(q.query.room)}catch{return r.status(404).end()}const clients=this.watchers.get(room)||new Set();if(clients.size>=12)return r.status(429).json({error:'画板窗口太多，请关闭暂时不用的窗口'});this.watchers.set(room,clients);clients.add(r);
      r.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});r.flushHeaders?.();const active=this.active(room);r.write('data: '+JSON.stringify({type:'snapshot',session:active?this.snapshot(active):null,invitations:this.invites(room).map(i=>this.publicInvite(i))})+'\n\n');const timer=setInterval(()=>r.write(': ping\n\n'),15000);timer.unref?.();q.on('close',()=>{clearInterval(timer);clients.delete(r);if(!clients.size)this.watchers.delete(room)});
    });
  }
}
