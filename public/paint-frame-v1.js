/* Fixed data bridge for the unmodified, locally hosted WigglyPaint engine. */
(()=>{
  'use strict';
  const MUTE_KEY='paint-together-paint-muted-v1';let muted=false,soundGain=null;try{muted=localStorage.getItem(MUTE_KEY)==='1'}catch{}
  function routeSound(){if(!audio||soundGain)return;soundGain=audio.createGain();soundGain.gain.value=muted?0:1;soundGain.connect(audio.destination);const create=audio.createBufferSource.bind(audio);audio.createBufferSource=(...args)=>{const source=create(...args),connect=source.connect.bind(source);source.connect=(destination,...rest)=>connect(destination===audio.destination?soundGain:destination,...rest);return source}}
  const originalInitAudio=initaudio;initaudio=(...args)=>{const result=originalInitAudio(...args);routeSound();return result};routeSound();
  const main=()=>dget(deck.cards,lms('main')),target=()=>dget(main().widgets,lms('target'));
  function snapshot(){const t=target(),size=getpair(ifield(t,'size'));return {width:size.x,height:size.y,frames:ll(ifield(t,'frames')).map(image_write),palette:Array.from({length:16},(_,i)=>ln(iindex(deck.patterns,i+32))),transparent:ls(ifield(t,'show'))==='transparent',seed}}
  function exportGif(){const state=snapshot(),colors=COLORS.slice();try{COLORS.splice(0,16,...state.palette);const frames=state.frames.map(image_read).map(f=>{if(state.transparent)return f;const copy=image_copy(f);for(let i=0;i<copy.pix.length;i++)if(copy.pix[i]===0)copy.pix[i]=32;return copy});return Uint8Array.from(writegif(frames,[10,10,10],new Int32Array(256),0))}finally{COLORS.splice(0,COLORS.length,...colors)}}
  let baseline='',loading=false,readOnlyMode=false,timer,lastState=null,undoStates=[],redoStates=[];
  let jointMode=false,jointCodec=null,drawing=false,jointGroup=crypto.randomUUID(),jointPending=new Map();
  const codecReady=()=>jointCodec?Promise.resolve(jointCodec):import('./paint-pixels-v1.js').then(module=>jointCodec=module);
  const slots={background:0,foreground:15,pink:4,cyan:7,yellow:1},key=state=>JSON.stringify({...state,seed:0});
  function toolInfo(){const p=snapshot(),t=target(),brush=ls(ifield(dget(t.widgets,lms('br')),'text'));let sizes={};try{sizes=JSON.parse(ls(ifield(dget(main().widgets,lms('toolProps')),'text')))}catch{}return {muted,brush,size:sizes[brush==='eraser'?'eraser':'marker']??4,canUndo:undoStates.length>0,canRedo:redoStates.length>0,readOnly:readOnlyMode,palette:Object.fromEntries(Object.entries(slots).map(([name,i])=>[name,'#'+p.palette[i].toString(16).padStart(6,'0').toUpperCase()])),transparent:p.transparent}}
  function recordCurrent(){if(loading)return;const state=snapshot();if(key(state)!==baseline){
    if(jointMode&&jointCodec&&lastState){const patch=jointCodec.paintPixelDiff(lastState,state);if(!jointCodec.paintPatchEmpty(patch)){const operation={operationId:crypto.randomUUID(),groupId:jointGroup,patch};jointPending.set(operation.operationId,operation);parent.postMessage({type:'paint-together:paint-joint-edit',operation},location.origin)}}
    else{if(lastState)undoStates.push(lastState);undoStates=undoStates.slice(-30);redoStates=[];parent.postMessage({type:'paint-together:paint-change',state,tools:toolInfo()},location.origin)}
    lastState=state;baseline=key(state);
  }}
  function applyEdit(state){const before=lastState;load(state,readOnlyMode,true);if(jointMode){lastState=before;baseline=key(before);recordCurrent()}else{lastState=snapshot();baseline=key(lastState);parent.postMessage({type:'paint-together:paint-change',state:lastState,tools:toolInfo()},location.origin)}}
  function command(action,args={}){
    if(action==='mute'){muted=args.muted===true;if(soundGain)soundGain.gain.value=muted?0:1;try{localStorage.setItem(MUTE_KEY,muted?'1':'0')}catch{}return toolInfo()}
    recordCurrent();if(action==='info')return toolInfo();if(readOnlyMode)throw Error('预览中的作品不能修改，请先复制');
    const before=snapshot();
    if(action==='undo'||action==='redo'){const from=action==='undo'?undoStates:redoStates,to=action==='undo'?redoStates:undoStates;if(from.length){to.push(before);applyEdit(from.pop())}return toolInfo()}
    if(action==='clear'||action==='palette'||action==='transparent'){
      if(jointMode)jointGroup=crypto.randomUUID();
      const next=JSON.parse(JSON.stringify(before));
      if(action==='clear')next.frames=next.frames.map(value=>{const image=image_read(value);image.pix.fill(0);return image_write(image)});
      if(action==='palette'){if(!Object.keys(args.palette||{}).length)throw Error('请选择颜色');for(const [name,value] of Object.entries(args.palette)){if(!(name in slots)||typeof value!=='string'||!/^#?[0-9a-f]{6}$/i.test(value))throw Error('请输入六位颜色码');next.palette[slots[name]]=parseInt(value.replace('#',''),16)}if(typeof args.transparent==='boolean')next.transparent=args.transparent}
      if(action==='transparent')next.transparent=args.value===true;
      if(key(next)!==key(before)){undoStates.push(before);undoStates=undoStates.slice(-30);redoStates=[];applyEdit(next)}return toolInfo();
    }
    if(action==='brush'){
      const names=['pencil','pen','Blobby','StippleTiny','SoftLrg','hi36','hi39','hi33','hi32','eraser'],name=String(args.brush||'');if(!names.includes(name))throw Error('画笔无效');
      fire_attr_sync(target(),'set_brush',lms(name));for(const widget of main().widgets.v)if(contraption_is(widget)&&ls(ifield(widget.def,'name'))==='popOut')iwrite(widget,lms('value'),lmn(ls(ifield(widget,'name'))===name?0:1));
      iwrite(dget(main().widgets,lms('sizeLabel')),lms('text'),lms(name==='eraser'?'eraser size':'marker size'));
    }else if(action!=='size')throw Error('画室工具无效');
    if(args.size!==undefined||action==='size'){
      const sizes=ll(ifield(dget(dget(main().widgets,lms('markerSizes')).widgets,lms('o')),'images')),index=Number(args.size);if(!Number.isInteger(index)||index<0||index>=sizes.length)throw Error('笔刷大小无效');const brush=ls(ifield(dget(target().widgets,lms('br')),'text'));
      fire_attr_sync(target(),brush==='eraser'?'set_ershape':'set_hishape',lms(image_write(sizes[index])));
      const props=dget(main().widgets,lms('toolProps'));let value={};try{value=JSON.parse(ls(ifield(props,'text')))}catch{}value[brush==='eraser'?'eraser':'marker']=index;iwrite(props,lms('text'),lms(JSON.stringify(value)));iwrite(dget(main().widgets,lms('markerSizes')),lms('valueIndex'),lmn(index));
    }
    msg.next_view=1;sync();return toolInfo();
  }
  // Fit the entire original card to its frame, including fractional desktop zoom.
  const originalResize=resize;
  resize=()=>{originalResize();zoom=Math.min(innerWidth/fb.size.x,innerHeight/fb.size.y);tzoom=0;const canvas=document.getElementById('display');canvas.width=Math.floor(fb.size.x*zoom);canvas.height=Math.floor(fb.size.y*zoom)};
  document.body.style.background='transparent';
  resize();sync();
  for(const type of ['mousedown','mouseup','mousemove','touchstart','touchmove','touchend','keydown','keyup'])document.addEventListener(type,event=>{if(readOnlyMode){event.preventDefault();event.stopImmediatePropagation()}},{capture:true,passive:false});
  function changed(){clearTimeout(timer);timer=setTimeout(()=>{try{recordCurrent()}catch{}},180)}
  function load(state,readOnly,keepHistory=false){
    loading=true;
    try{
      const t=target(),frames=state.frames.map(image_read);
      iwrite(t,lms('size'),lmpair(rect(state.width,state.height)));
      const dims=dget(main().widgets,lms('dims')),pos=getpair(ifield(dims,'pos')),size=getpair(ifield(dims,'size'));
      iwrite(t,lms('pos'),lmpair(rect(pos.x+(size.x-state.width)/2,pos.y+(size.y-state.height)/2)));
      iwrite(dget(t.widgets,lms('fr')),lms('images'),lml(frames));
      iwrite(dget(main().widgets,lms('history')),lms('images'),lml(frames.map(image_copy)));
      state.palette.forEach((c,i)=>iwrite(deck.patterns,lmn(i+32),lmn(c)));
      seed=state.seed??0x12345;
      iwrite(t,lms('show'),lms(state.transparent?'transparent':'solid'));
      iwrite(deck,lms('card'),lms('main'));setmode('interact');
      // setmode clears the queued view when it is already in interact mode.
      // Initialize brush artwork before exposing the frame, then run the normal card view.
      for(const widget of main().widgets.v)if(contraption_is(widget)&&ls(ifield(widget.def,'name'))==='popOut')fire_attr_sync(widget,'view');
      msg.next_view=1;
      resize();sync();
      baseline=key(snapshot());lastState=snapshot();if(!keepHistory){undoStates=[];redoStates=[]}
      readOnlyMode=readOnly===true;
      parent.postMessage({type:'paint-together:paint-loaded',tools:toolInfo()},location.origin);
    }finally{loading=false}
  }
  function mergeJoint(patch){
    const skip=new Set();for(const op of jointPending.values())jointCodec.visitPaintPatch(op.patch,lastState.width,lastState.height,index=>skip.add(index));
    const state=jointCodec.applyPaintPatch(snapshot(),patch,{skip}),frames=ll(ifield(target(),'frames'));
    state.frames.map(image_read).forEach((image,i)=>frames[i].pix.set(image.pix));state.palette.forEach((color,i)=>iwrite(deck.patterns,lmn(i+32),lmn(color)));iwrite(target(),lms('show'),lms(state.transparent?'transparent':'solid'));seed=state.seed??seed;lastState=snapshot();baseline=key(lastState);sync();
  }
  window.addEventListener('message',async event=>{
    if(event.origin!==location.origin||event.source!==parent)return;const m=event.data;
    try{
      if(m?.type==='paint-together:paint-joint-reset'){
        await codecReady();if(jointMode&&!readOnlyMode)recordCurrent();jointMode=true;const known=new Set(m.knownOperations||[]),pending=new Map([...(m.pending||[]).map(op=>[op.operationId,op]),...jointPending]);for(const id of known)pending.delete(id);jointPending=pending;
        let state=m.state;for(const op of jointPending.values())state=jointCodec.applyPaintPatch(state,op.patch);load(state,m.readOnly===true);lastState=snapshot();baseline=key(lastState);parent.postMessage({type:'paint-together:paint-joint-ready'},location.origin);
      }else if(m?.type==='paint-together:paint-joint-patch'&&jointMode){
        if(jointPending.has(m.operationId)){jointPending.delete(m.operationId);return}if(!readOnlyMode)recordCurrent();mergeJoint(m.patch);
      }else if(m?.type==='paint-together:paint-joint-ack'&&jointMode)jointPending.delete(m.operationId);
      else if(m?.type==='paint-together:paint-joint-flush'&&jointMode){recordCurrent();parent.postMessage({type:'paint-together:paint-joint-flushed',requestId:m.requestId},location.origin)}
    }catch(error){parent.postMessage({type:'paint-together:paint-joint-error',error:error.message},location.origin)}
  });
  function nativeJointControl(event){
    if(!jointMode||readOnlyMode)return;const e=event.touches?.[0]||event,box=document.getElementById('display').getBoundingClientRect(),x=(e.clientX-box.left)/zoom,y=(e.clientY-box.top)/zoom;
    for(const [name,action] of [['button3','undo'],['button2','unsupported']]){const widget=dget(main().widgets,lms(name)),pos=getpair(ifield(widget,'pos')),size=getpair(ifield(widget,'size'));if(x>=pos.x&&x<pos.x+size.x&&y>=pos.y&&y<pos.y+size.y){event.preventDefault();event.stopImmediatePropagation();recordCurrent();parent.postMessage({type:'paint-together:paint-joint-action',action},location.origin);return}}
  }
  for(const type of ['mousedown','touchstart'])document.addEventListener(type,nativeJointControl,{capture:true,passive:false});
  document.addEventListener('keydown',event=>{if(jointMode&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopImmediatePropagation();recordCurrent();parent.postMessage({type:'paint-together:paint-joint-action',action:event.shiftKey?'redo':'undo'},location.origin)}},{capture:true});
  window.addEventListener('pointerdown',()=>{if(!jointMode)return;drawing=true;jointGroup=crypto.randomUUID()},{capture:true});
  window.addEventListener('pointerup',()=>{if(jointMode)recordCurrent();drawing=false},{capture:true});
  const jointTimer=setInterval(()=>{if(jointMode&&drawing&&!readOnlyMode&&!document.hidden)try{recordCurrent()}catch(error){parent.postMessage({type:'paint-together:paint-joint-error',error:error.message},location.origin)}},120);
  window.addEventListener('pagehide',()=>clearInterval(jointTimer),{once:true});
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent)return;const m=event.data;if(m?.type==='paint-together:paint-load')try{load(m.state,m.readOnly)}catch{parent.postMessage({type:'paint-together:paint-error'},location.origin)}else if(m?.type==='paint-together:paint-capture')parent.postMessage({type:'paint-together:paint-state',requestId:m.requestId,state:snapshot()},location.origin);else if(m?.type==='paint-together:paint-command')try{parent.postMessage({type:'paint-together:paint-result',requestId:m.requestId,result:command(m.action,m.args)},location.origin)}catch(error){parent.postMessage({type:'paint-together:paint-command-error',requestId:m.requestId,error:error.message},location.origin)}else if(m?.type==='paint-together:paint-export')try{const gif=exportGif();parent.postMessage({type:'paint-together:paint-gif',requestId:m.requestId,gif:gif.buffer},location.origin,[gif.buffer])}catch{parent.postMessage({type:'paint-together:paint-export-error',requestId:m.requestId},location.origin)}});
  for(const type of ['pointerup','touchend','keyup','change'])window.addEventListener(type,changed,{passive:true});
  window.PaintTogetherPaintFrame={snapshot};
  parent.postMessage({type:'paint-together:paint-ready'},location.origin);
})();
