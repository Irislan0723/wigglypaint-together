/* A landscape workspace shares the same live canvas, history and joint session. */
(()=>{
  'use strict';
  const body=document.body,room=document.querySelector('.paint-room'),frame=document.getElementById('paintFrame');
  if(!room||!frame)return;
  const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8l-5-5m13 5 5-5M8 16l-5 5m13-5 5 5"/></svg>';
  const enter=document.createElement('button');enter.type='button';enter.id='paintLandscape';enter.className='paint-icon';enter.title=enter.ariaLabel='横屏放大画板';enter.innerHTML=icon;enter.setAttribute('aria-pressed','false');
  document.querySelector('.paint-collection-actions').prepend(enter);
  const menu=document.createElement('button');menu.type='button';menu.className='paint-menu-item';menu.id='paintLandscapeMenu';menu.innerHTML=icon+'<span lang="en">Landscape Canvas</span>';
  document.querySelector('#paintActionsDialog .paint-action-menu').append(menu);
  const exit=document.createElement('button');exit.type='button';exit.className='paint-focus-close';exit.id='paintLandscapeExit';exit.title=exit.ariaLabel='退出横屏画板';exit.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';exit.hidden=true;room.append(exit);
  let active=false,host=null,previousFocus;
  function expandHost(value){
    if(value)host=window.frameElement?.closest('.joint-float');
    if(!host)return null;
    const control=host.querySelector('[data-expand]');
    host.classList.toggle('joint-float-landscape',value);
    host.dispatchEvent(new Event('paint-landscape-change'));
    if(!value)host=null;
    return control;
  }
  function layout(){
    if(!active)return;
    const portrait=innerHeight>innerWidth;body.classList.toggle('paint-landscape-portrait',portrait);
    room.style.setProperty('--paint-focus-width',(portrait?innerHeight:innerWidth)+'px');room.style.setProperty('--paint-focus-height',(portrait?innerWidth:innerHeight)+'px');
    const workspace=document.querySelector('.paint-workspace'),width=Math.min(workspace.clientWidth,workspace.clientHeight*512/342);
    room.style.setProperty('--paint-landscape-board-width',width+'px');room.style.setProperty('--paint-landscape-board-height',(width*342/512)+'px');
  }
  function set(value){
    if(active===value)return;
    active=value;
    if(active){previousFocus=document.activeElement;document.querySelectorAll('dialog[open]').forEach(d=>d.close())}
    const control=expandHost(active);
    body.classList.toggle('paint-landscape',active);exit.hidden=!active||!!control;enter.setAttribute('aria-pressed',String(active));
    if(active){layout();(control||exit).focus()}else{body.classList.remove('paint-landscape-portrait');(control||previousFocus)?.focus()}
    requestAnimationFrame(()=>{if(active)layout();window.dispatchEvent(new Event('resize'))});
  }
  enter.onclick=menu.onclick=()=>set(true);exit.onclick=()=>set(false);
  window.addEventListener('resize',layout);window.visualViewport?.addEventListener('resize',layout);
  frame.addEventListener('load',()=>{if(active)layout()});
  // Escape is delivered to the document owning keyboard focus, including Decker.
  function escape(event){if(active&&event.key==='Escape'&&!document.querySelector('dialog[open]')){event.preventDefault();event.stopImmediatePropagation();set(false)}}
  document.addEventListener('keydown',escape,true);frame.addEventListener('load',()=>frame.contentWindow?.addEventListener('keydown',escape,true));
  window.addEventListener('pagehide',()=>{if(host)expandHost(false)},{once:true});
  window.PaintTogetherPaintLandscape={set,get active(){return active}};
})();
