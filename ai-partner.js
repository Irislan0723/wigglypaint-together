import {PAINT_TOOLS} from './paint-service.js';

export function modelConfig(env = process.env) {
  const base = String(env.AI_BASE_URL || '').trim();
  const model = String(env.AI_MODEL || '').trim();
  if (!base && !model && !env.AI_API_KEY) return null;
  if (!base || !model) throw new Error('Set both AI_BASE_URL and AI_MODEL.');
  const endpoint = new URL(base.replace(/\/+$/, '') + '/chat/completions');
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('AI_BASE_URL must be an HTTP(S) API base without credentials or a query.');
  }
  return {endpoint, model, key:String(env.AI_API_KEY || '')};
}

export async function askPartner({config, fetcher, context, history, run}) {
  const tools = PAINT_TOOLS.map(tool => ({type:'function',function:tool}));
  const messages = [
    {role:'system',content:'You are a drawing partner. Reply in the user’s language. Use tools for actual drawing. Draw with WigglyPaint stroke coordinates and the current shared artwork ID. Do not claim a change succeeded unless the tool did so. ' + context},
    ...history
  ];
  for (let round = 0; round < 6; round++) {
    const headers = {'Content-Type':'application/json'};
    if (config.key) headers.Authorization = 'Bearer ' + config.key;
    const response = await fetcher(config.endpoint, {
      method:'POST', headers, redirect:'error', signal:AbortSignal.timeout(70_000),
      body:JSON.stringify({model:config.model,messages,tools,tool_choice:'auto'})
    }).catch(() => { throw new Error('模型服务连接失败，请检查服务器配置。'); });
    if (!response.ok) throw new Error('模型服务返回 HTTP ' + response.status);
    const answer = (await response.json()).choices?.[0]?.message;
    if (!answer) throw new Error('模型服务未返回聊天消息。');
    const calls = Array.isArray(answer.tool_calls) ? answer.tool_calls : [];
    const reply = typeof answer.content === 'string' ? answer.content.trim() : '';
    if (!calls.length) return reply.slice(0,2000);
    if (calls.length > 8) throw new Error('模型单轮返回的绘画工具过多。');
    messages.push({role:'assistant',content:reply || null,tool_calls:calls});
    const images = [];
    for (const call of calls) {
      let result;
      try {
        if (!PAINT_TOOLS.some(tool=>tool.name===call.function?.name)) throw new Error('未知绘画工具');
        const raw = String(call.function.arguments || '{}');
        if (raw.length > 60_000) throw new Error('绘画参数过长');
        const args = JSON.parse(raw);
        result = await run(call.function.name,args);
        if (result.previewImage) {
          images.push({type:'image_url',image_url:{url:result.previewImage}});
          result = {id:result.id,title:result.title,note:'The current canvas preview follows.'};
        }
      } catch (error) {
        result = {ok:false,error:error.message};
      }
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result).slice(0,16_000)});
    }
    if (images.length) messages.push({role:'user',content:[{type:'text',text:'Canvas preview returned by your look tool:'},...images]});
  }
  throw new Error('这一轮已达到绘画工具调用上限。');
}
