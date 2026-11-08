const $ = id => document.getElementById(id);
const room = 'studio';
const frame = $('studio-frame');
let mode = 'studio';
let board = null;
let busy = false;
let modelEnabled = false;

async function request(path, {body, ...options} = {}) {
  if (!path.startsWith('/api/')) throw new Error('请求路径无效');
  const response = await fetch(path, {
    ...options,
    ...(body === undefined ? {} : {body:JSON.stringify(body), headers:{'Content-Type':'application/json'}})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本地服务请求失败');
  return data;
}

async function subscribe(path, onEvent, {signal} = {}) {
  if (!path.startsWith('/api/paint/joint/events?')) throw new Error('事件路径无效');
  const response = await fetch(path, {signal});
  if (!response.ok || !response.body) throw new Error('画板连接暂不可用');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value,{stream:true});
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0,boundary);
        buffer = buffer.slice(boundary+2);
        if (event.startsWith('data: ')) onEvent(JSON.parse(event.slice(6)));
      }
    }
  } finally { reader.releaseLock(); }
}

function feedback(message = '') { $('feedback').textContent = message; }
function showBoard(id) {
  if (board === id && frame.getAttribute('src')) return;
  board = id;
  frame.src = 'paint.html?' + new URLSearchParams({room, ...(id ? {joint:id} : {})});
}
function setMode(value) {
  mode = value;
  $('partner').hidden = mode !== 'together';
  for (const tab of ['studio','together']) $(tab).setAttribute('aria-pressed',String(tab === mode));
  if (mode === 'studio') showBoard(null);
  else void refresh().catch(error => feedback(error.message));
}
function renderMessages(messages) {
  const items = messages.map(message => {
    const item = document.createElement('li');
    const author = {user:'你',assistant:modelEnabled?'AI':'本地演示',system:'画室'}[message.role] || '画室';
    item.textContent = author + ' · ' + message.content;
    if (message.image?.startsWith('/api/chat/paint-images/')) {
      const image = document.createElement('img');
      image.src = message.image; image.alt = '分享的作品'; item.append(image);
    }
    return item;
  });
  $('messages').replaceChildren(...items);
  $('messages').scrollTop = $('messages').scrollHeight;
}
async function refresh() {
  const data = await request('/api/demo');
  modelEnabled = data.aiEnabled;
  $('mode').textContent = modelEnabled ? 'AI 模式 · 对话与画布预览可能发往你配置的模型服务' : '离线演示 · 由预设笔迹模拟画伴';
  renderMessages(data.messages);
  $('invite').disabled = busy || !!data.session;
  $('invite').textContent = data.session ? '一起画进行中' : '发出一起画邀请';
  $('prompt').hidden = !data.session;
  if (mode === 'together' && data.session) showBoard(data.session.id);
  if (mode === 'together' && !frame.getAttribute('src')) showBoard(null);
}
async function act(fn) {
  if (busy) return;
  busy = true; feedback('画伴正在处理…');
  $('invite').disabled = $('prompt').querySelector('button').disabled = true;
  try { await fn(); feedback(); }
  catch (error) { feedback(error.message); }
  finally { busy = false; $('prompt').querySelector('button').disabled = false; await refresh().catch(error => feedback(error.message)); }
}

window.PaintTogetherPaintRequest = request;
window.PaintTogetherPaintSubscribe = subscribe;
window.PaintTogetherPaintSend = (_room, value) => request('/api/demo/share', {method:'POST',body:value});
window.PaintTogetherPaintGoToRoom = () => setMode('together');
window.openPaintStudio = ({joint} = {}) => { setMode(joint?'together':'studio'); if(joint)showBoard(joint); };

$('studio').onclick = () => setMode('studio');
$('together').onclick = () => setMode('together');
$('invite').onclick = () => act(async () => {
  const {coPaint} = await request('/api/paint/joint/invitations',{method:'POST',body:{room}});
  await request('/api/demo/turn',{method:'POST',body:{invitationId:coPaint.id}});
});
$('prompt').onsubmit = event => {
  event.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  void act(async () => { await request('/api/demo/turn',{method:'POST',body:{text}}); $('text').value = ''; });
};
setMode(new URLSearchParams(location.search).get('view') === 'together' ? 'together' : 'studio');
const events = '/api/paint/joint/events?room=' + encodeURIComponent(room);
async function watch() {
  try {
    await subscribe(events,event=>{
      if (mode==='together' && event.type==='invitation' && event.session) showBoard(event.session.id);
      if (event.type==='ended') void refresh().catch(()=>{});
    });
  } catch {}
  setTimeout(watch,1500);
}
void watch();
