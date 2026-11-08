import express from 'express';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaintService} from './paint-service.js';
import {JointPaintService} from './paint-joint-service.js';
import {askPartner,modelConfig} from './ai-partner.js';

const root = fileURLToPath(new URL('.',import.meta.url));
const room = 'studio';
const rooms = [{id:room,title:'画室对话'}];

export function createApp({dataDir=join(root,'.data'),config=null,fetcher=globalThis.fetch} = {}) {
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const signingPath = join(dataDir,'signing.key');
  if (!existsSync(signingPath)) writeFileSync(signingPath,randomBytes(32),{mode:0o600,flag:'wx'});
  const signingKey = readFileSync(signingPath);
  const logPath = join(dataDir,'messages.json');
  let messages = existsSync(logPath) ? JSON.parse(readFileSync(logPath,'utf8')) : [];
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const host = req.get('host') || '';
    const origin = req.get('origin');
    if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host) ||
        (origin && origin !== 'http://' + host) ||
        ['cross-site','same-site'].includes(req.get('sec-fetch-site'))) {
      return res.status(403).json({error:'此画室只接受同源的本地访问。'});
    }
    res.set('X-Content-Type-Options','nosniff');
    next();
  });
  app.use(express.json({limit:'4mb'}));
  const next = (_req,_res,done)=>done();
  const saveMessages = list => { paint.atomic(logPath,JSON.stringify(list)); messages=list; };
  const paint = new PaintService({dataDir,signingKey,readMessages:()=>messages.slice(),readConversations:()=>rooms});
  const joint = new JointPaintService({paint,readMessages:()=>messages.slice(),writeMessages:saveMessages,readConversations:()=>rooms});
  paint.install(app,next);
  joint.install(app,next);
  const frameSource = readFileSync(join(root,'public/vendor/wigglypaint/original.html'),'utf8');
  const frame = frameSource.replace(/<\/body>\s*$/i,'<script src="/paint-frame-v1.js"></script></body>\n');
  app.get('/paint-frame.html',(_req,res)=>res.type('html').send(frame));
  app.use(express.static(join(root,'public')));

  function addMessage(role,content,images=[]) {
    const item={id:randomUUID(),role,content,images,conversationId:room,createdAt:new Date().toISOString()};
    saveMessages([...messages,item]);
  }

  app.get('/api/demo',(_req,res)=>{
    const active = joint.active(room);
    res.set('Cache-Control','no-store').json({
      aiEnabled:!!config,session:active ? joint.meta(active) : null,
      messages:messages.slice(-60).map(message=>({role:message.role,content:message.content,image:message.images?.[0]}))
    });
  });

  app.post('/api/demo/share',(req,res)=>{
    const image = String(req.body?.image || '');
    const url = new URL(image,'http://localhost');
    if (!image.startsWith('/api/chat/paint-images/') || url.searchParams.get('conversationId')!==room ||
        !paint.valid(url.pathname.split('/').at(-1)+':'+room,url.searchParams.get('token'))) {
      return res.status(400).json({error:'画作分享链接无效。'});
    }
    addMessage('user',String(req.body.caption || '分享了一张画').slice(0,1000),[image]);
    res.json({ok:true});
  });

  let busy = false, demoRound = 0;
  app.post('/api/demo/turn',async(req,res)=>{
    if (busy) return res.status(409).json({error:'画伴正在处理上一轮。'});
    const text = String(req.body?.text || '').trim().slice(0,1000);
    const invitationId = String(req.body?.invitationId || '');
    const pending = joint.invites(room).find(invite=>invite.id===invitationId&&invite.status==='pending');
    const active = joint.active(room);
    if (invitationId ? !pending : (!text || !active)) return res.status(400).json({error:'请先发出有效邀请并打开共同画布。'});
    busy = true;
    const state = {conversationId:room};
    try {
      if (text) addMessage('user',text);
      let reply;
      if (config) {
        const context = pending
          ? 'A pending invitation has ID ' + pending.id + '. Accept or reject it with joint_painting before drawing.'
          : 'The active shared artwork ID is ' + active.record.id + '. Use look_painting if you need its current appearance.';
        const history = messages.filter(message=>['user','assistant'].includes(message.role)).slice(-16)
          .map(({role,content})=>({role,content}));
        reply = await askPartner({config,fetcher,context,history,run:(name,args)=>paint.tool(name,args,state,{
          store(_room,mime,data){state.previewImage='data:'+mime+';base64,'+data;return {id:'canvas-preview'};}
        }).then(result=>{
          if(name==='look_painting'&&state.previewImage)return {...result,previewImage:state.previewImage};
          return result;
        })});
      } else if (pending) {
        await paint.tool('joint_painting',{action:'accept',invitationId:pending.id},state);
        reply = '已加入。这是离线演示，发送一句话就能看到预设笔迹。';
      } else {
        const {id,state:{width,height}} = active.record;
        const x = .22+(demoRound++%4)*.16, y = .48;
        const points = Array.from({length:9},(_,i)=>{
          const angle = i*Math.PI/4;
          return [Math.round((x+Math.cos(angle)*.08)*width),Math.round((y+Math.sin(angle)*.12)*height)];
        });
        await paint.tool('draw_painting',{id,strokes:[{brush:'pen',points},{brush:'hi36',size:2,points:[points[0],points[4]]}]},state);
        reply = '已画出一组预设笔迹。';
      }
      if (reply || state.generatedImages?.length) addMessage('assistant',reply || '分享了一张画',state.generatedImages || []);
      res.json({ok:true});
    } catch (error) { res.status(502).json({error:error.message}); }
    finally { busy = false; }
  });
  app.use((_error,_req,res,_next)=>res.status(400).json({error:'请求格式无效。'}));
  return {app,paint,joint};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const {app} = createApp({config:modelConfig()});
  app.listen(port,'127.0.0.1',()=>console.log('Paint Together running at http://127.0.0.1:'+port));
}
