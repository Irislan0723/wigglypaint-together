/* A shared-canvas controller. Requests carry normal site auth; SSE never uses an API key in a URL. */
export function attachJointCanvas({frame,id,room,request,subscribe,onState=()=>{},onTools=()=>{},onError=()=>{}}){
  const clientId=crypto.randomUUID(),draftKey='paint-together-joint-pending-'+id,pending=new Map(),waiters=new Map();let session=null,ready=false,jointReady=false,disposed=false,sending=false,retryTimer,streamAbort,streamTimer,queued=[],inflight=null,tools=null,previewing=false;
  try{for(const op of JSON.parse(localStorage.getItem(draftKey)||'[]'))pending.set(op.operationId,{...op,clientId})}catch{}
  const post=message=>frame.contentWindow?.postMessage(message,location.origin);
  function persist(){try{if(pending.size)localStorage.setItem(draftKey,JSON.stringify([...pending.values()]));else localStorage.removeItem(draftKey)}catch{onError('本机草稿空间不足，请保持窗口打开直到同步完成')}}
  function notify(){onState(session,{pending:pending.size,connected:!!streamAbort&&!streamAbort.signal.aborted});if(tools)onTools({...tools,canUndo:!!session?.canUndo,canRedo:!!session?.canRedo,readOnly:previewing||session?.status!=='active'})}
  function reset(value){if(!value||value.id!==id)return;session=value;for(const opId of value.knownOperations||[])pending.delete(opId);persist();if(!previewing){jointReady=false;if(ready)post({type:'paint-together:paint-joint-reset',state:value.state,readOnly:value.status!=='active',knownOperations:value.knownOperations,pending:[...pending.values()]})}notify()}
  function event(value){
    if(disposed)return;
    if(value.type==='snapshot'){if(value.session?.id===id)reset(value.session);return}
    if(value.type==='invitation'&&value.session?.id===id){reset(value.session);return}
    if(value.type==='ended'&&value.session?.id===id){reset(value.session);if(pending.size)onError('一起画已结束，尚未同步的笔迹已保存在本机，可以复制后继续画');return}
    if(value.type==='metadata'&&value.session?.id===id){session={...session,...value.session};notify();return}
    if(value.type!=='patch'||value.sessionId!==id)return;
    if(session&&value.sequence<=session.sequence){if(pending.delete(value.operationId)){post({type:'paint-together:paint-joint-ack',operationId:value.operationId});persist();notify()}return}
    if(session&&value.sequence!==session.sequence+1){void reload();return}
    if(session)session={...session,...value};if(pending.delete(value.operationId))persist();
    if(!previewing){if(jointReady)post({type:'paint-together:paint-joint-patch',patch:value.patch,operationId:value.operationId});else queued.push(value)}notify();
  }
  async function reload(){try{const value=await request('/api/paint/joint/sessions/'+id+'?room='+encodeURIComponent(room));if(!disposed){queued=[];reset(value)}}catch(error){if(!disposed)onError(error.message)}}
  async function pump(){
    if(sending||disposed||!session||session.status!=='active'||!pending.size)return;sending=true;
    try{
      while(pending.size&&!disposed&&session.status==='active'){
        const op=pending.values().next().value;inflight=op.operationId;const result=await request('/api/paint/joint/sessions/'+id+'/operations',{method:'POST',body:{...op,room}});
        if(disposed)break;pending.delete(op.operationId);persist();post({type:'paint-together:paint-joint-ack',operationId:op.operationId});if(result.empty)notify();
      }
    }catch(error){if(!disposed){onError('连接中断，笔迹已保存在本机，正在重试');clearTimeout(retryTimer);retryTimer=setTimeout(()=>{void reload().then(pump)},1800)}}
    finally{sending=false;inflight=null;notify()}
  }
  function connect(){
    if(disposed)return;streamAbort=new AbortController();subscribe('/api/paint/joint/events?room='+encodeURIComponent(room),event,{signal:streamAbort.signal}).catch(error=>{if(!disposed&&error.name!=='AbortError')onError('实时连接正在恢复')}).finally(()=>{if(!disposed){streamAbort=null;notify();streamTimer=setTimeout(connect,1500)}});
  }
  async function frameRequest(type,payload={}){if(!ready)throw Error('画板正在载入');const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(requestId);reject(Error('读取画板超时'))},6000);waiters.set(requestId,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});post({type,requestId,...payload})})}
  async function flush(){
    if(jointReady)await frameRequest('paint-together:paint-joint-flush');await pump();const started=Date.now();while(pending.size||sending){if(session?.status!=='active')throw Error('一起画已结束，未同步笔迹仍保留在本机');if(Date.now()-started>15000)throw Error('暂时无法同步，笔迹已保存在本机');await new Promise(r=>setTimeout(r,100));await pump()}
  }
  async function tool(action,args={}){
    if(['undo','redo','clear','finish'].includes(action)){await flush();const result=await request('/api/paint/joint/sessions/'+id+'/actions',{method:'POST',body:{room,action}});session={...session,...result};notify();return {...tools,canUndo:session.canUndo,canRedo:session.canRedo}}
    const result=await frameRequest('paint-together:paint-command',{action,args});tools=result;notify();return result;
  }
  function message(event){
    if(event.origin!==location.origin||event.source!==frame.contentWindow||disposed)return;const value=event.data;
    if(value?.type==='paint-together:paint-ready'){ready=true;if(session)reset(session)}
    else if(value?.type==='paint-together:paint-loaded'){tools=value.tools;notify()}
    else if(value?.type==='paint-together:paint-joint-ready'){jointReady=true;for(const op of queued.splice(0))post({type:'paint-together:paint-joint-patch',patch:op.patch,operationId:op.operationId});void pump()}
    else if(value?.type==='paint-together:paint-joint-edit'){
      if(session?.status!=='active')return;const op={...value.operation,clientId};pending.set(op.operationId,op);persist();notify();void pump();
    }else if(value?.type==='paint-together:paint-joint-action'){if(value.action==='unsupported')onError('一起画时保持画布尺寸一致，配色和笔刷可用下方快捷工具调整');else void tool(value.action).catch(e=>onError(e.message))}
    else if(value?.type==='paint-together:paint-joint-error')onError(value.error);
    else if(value?.type==='paint-together:paint-state'||value?.type==='paint-together:paint-result'||value?.type==='paint-together:paint-gif'||value?.type==='paint-together:paint-joint-flushed'){const task=waiters.get(value.requestId);if(task){waiters.delete(value.requestId);task.resolve(value.state??value.result??value.gif??true)}}
    else if(value?.type==='paint-together:paint-command-error'){const task=waiters.get(value.requestId);waiters.delete(value.requestId);task?.reject(Error(value.error))}
  }
  window.addEventListener('message',message);frame.src='paint-frame.html';void reload().then(()=>{connect();void pump()});
  return {flush,tool,reload,get session(){return session},async preview(state){if(state){await flush();previewing=true;post({type:'paint-together:paint-joint-reset',state,readOnly:true,pending:[],knownOperations:[]});notify()}else{previewing=false;queued=[];await reload()}},capture:()=>frameRequest('paint-together:paint-capture'),async download(){await flush();return frameRequest('paint-together:paint-export')},destroy(){disposed=true;clearTimeout(retryTimer);clearTimeout(streamTimer);streamAbort?.abort();window.removeEventListener('message',message);for(const waiter of waiters.values())waiter.reject(Error('画板已关闭'));waiters.clear();persist()}};
}
