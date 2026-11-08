import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {createApp} from '../server.js';
import {modelConfig} from '../ai-partner.js';
import {paintStatePixels} from '../public/paint-pixels-v1.js';

async function launch(t,options={}) {
  const tempRoot=resolve(tmpdir());
  const dataDir=await mkdtemp(join(tempRoot,'paint-together-test-'));
  const {app,paint}=createApp({dataDir,...options});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.equal(dirname(resolve(dataDir)),tempRoot);
    assert(basename(dataDir).startsWith('paint-together-test-'));
    await rm(dataDir,{recursive:true,force:true});
  });
  const origin='http://127.0.0.1:'+server.address().port;
  const request=async(path,body,method=body?'POST':'GET')=>{
    const response=await fetch(origin+path,{method,...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{})});
    assert(response.ok,await response.clone().text());
    return response.json();
  };
  return {origin,request,paint};
}

test('local studio saves artwork and serves the original canvas bridge',async t=>{
  const {origin,request}=await launch(t);
  assert.match(await (await fetch(origin+'/paint-frame.html')).text(),/script src="\/paint-frame-v1.js"/);
  assert.equal((await fetch(origin+'/api/demo',{headers:{Origin:'https://other.invalid'}})).status,403);
  const work=await request('/api/paint/works',{title:'Test artwork'});
  assert.equal((await request('/api/paint/works/'+work.id)).title,work.title);
  assert.equal((await fetch(origin+work.preview+'&format=gif')).headers.get('content-type'),'image/gif');
});

test('offline partner accepts a real invitation and adds shared strokes',async t=>{
  const {request}=await launch(t);
  const invite=await request('/api/paint/joint/invitations',{room:'studio'});
  await request('/api/demo/turn',{invitationId:invite.coPaint.id});
  const {session,aiEnabled}=await request('/api/demo');
  assert.equal(aiEnabled,false);
  await request('/api/demo/turn',{text:'画一点示例'});
  const board=await request('/api/paint/joint/sessions/'+session.id+'?room=studio');
  assert(board.sequence>=2);
  assert(paintStatePixels(board.state)[0].some(Boolean));
});

test('configured model sees tools and can accept, draw and inspect the same canvas',async t=>{
  const config=modelConfig({AI_BASE_URL:'https://model.invalid/v1',AI_MODEL:'test',AI_API_KEY:'fixture'});
  let turn=0,sessionId,invitationId;
  const fetcher=async(url,options)=>{
    assert.equal(url.href,'https://model.invalid/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer fixture');
    const {messages,tools}=JSON.parse(options.body);
    assert(tools.some(tool=>tool.function.name==='draw_painting'));
    assert(tools.some(tool=>tool.function.name==='joint_painting'));
    const call=(id,name,args)=>({tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    const step=turn++;
    let message;
    if(step===0){
      assert(messages[0].content.includes(invitationId));
      message=call('accept','joint_painting',{action:'accept',invitationId});
    }else if(step===1){
      sessionId=JSON.parse(messages.at(-1).content).session.id;
      message={content:'Joined'};
    }else if(step===2){
      assert(messages[0].content.includes(sessionId));
      message=call('draw','draw_painting',{id:sessionId,strokes:[{brush:'pen',points:[[20,25],[80,90]]}]});
    }else if(step===3){
      assert(JSON.parse(messages.at(-1).content).sequence>0);
      message=call('look','look_painting',{id:sessionId});
    }else{
      assert(messages.at(-1).content.some(item=>item.image_url?.url.startsWith('data:image/png;base64,')));
      message={content:'Drawn'};
    }
    return Response.json({choices:[{message}]});
  };
  const {request}=await launch(t,{config,fetcher});
  const invite=await request('/api/paint/joint/invitations',{room:'studio'});
  invitationId=invite.coPaint.id;
  await request('/api/demo/turn',{invitationId});
  await request('/api/demo/turn',{text:'Add a line'});
  const {messages,session,aiEnabled}=await request('/api/demo');
  assert.equal(aiEnabled,true);
  assert.equal(messages.at(-1).content,'Drawn');
  assert.equal(session.id,sessionId);
  assert(session.sequence>0);
});
