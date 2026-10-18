export function mountWorkbench(){
 const $=s=>document.querySelector(s),body=document.body;body.classList.add('workbench');
 const folder=document.createElement('details');folder.className='folder-menu';folder.innerHTML='<summary>작업 폴더 ▾</summary>';
 folder.append($('.workspace-bar'));$('.brand').after(folder);
 $('.top-actions').prepend($('#analysis-progress'));
 const libraryActions=document.createElement('details');libraryActions.className='library-actions';libraryActions.innerHTML='<summary>전체 곡 작업 ▾</summary>';libraryActions.append($('.library-footer'));$('.library').append(libraryActions);
 const libraryToggle=document.createElement('button');libraryToggle.className='library-toggle';libraryToggle.type='button';libraryToggle.setAttribute('aria-controls','tracks');
 const setCollapsed=value=>{body.classList.toggle('library-collapsed',value);libraryToggle.textContent=value?'›':'‹';libraryToggle.title=value?'곡 목록 펼치기':'곡 목록 최소화';libraryToggle.setAttribute('aria-label',libraryToggle.title);libraryToggle.setAttribute('aria-expanded',String(!value));};
 $('.library .section-head').prepend(libraryToggle);
 try{setCollapsed(localStorage.getItem('lyricflow-library-collapsed')==='true');}catch{setCollapsed(false);}
 libraryToggle.onclick=()=>{const value=!body.classList.contains('library-collapsed');setCollapsed(value);try{localStorage.setItem('lyricflow-library-collapsed',String(value));}catch{}};
 const workspace=$('.review-workspace'),monitor=$('.monitor-pane');
 const divider=document.createElement('div');divider.className='monitor-resizer';divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-label','미리보기 너비 조절');divider.setAttribute('aria-orientation','vertical');divider.title='왼쪽으로 끌면 미리보기가 커집니다. 두 번 클릭하면 기본 크기로 돌아갑니다.';workspace.append(divider);
 let preferredWidth=null,widthDrag=null;
 try{const n=Number(localStorage.getItem('lyricflow-monitor-width'));if(Number.isFinite(n)&&n>0)preferredWidth=n;}catch{}
 const setWidth=n=>{const total=workspace.clientWidth,min=Math.min(220,total*.45),max=Math.max(min,total-(total<650?160:260)-8),width=Math.round(Math.max(min,Math.min(max,n)));workspace.style.setProperty('--monitor-width',width+'px');divider.setAttribute('aria-valuenow',String(width));return width;};
 const saveWidth=()=>{try{localStorage.setItem('lyricflow-monitor-width',String(preferredWidth));}catch{}};
 divider.onpointerdown=e=>{if(e.button!==0)return;widthDrag={x:e.clientX,width:monitor.getBoundingClientRect().width};divider.setPointerCapture(e.pointerId);body.classList.add('resizing-monitor');e.preventDefault();};
 divider.onpointermove=e=>{if(widthDrag)preferredWidth=setWidth(widthDrag.width+widthDrag.x-e.clientX);};
 const endWidth=()=>{if(widthDrag){widthDrag=null;body.classList.remove('resizing-monitor');if(preferredWidth!==null)saveWidth();}};
 divider.onpointerup=endWidth;divider.onpointercancel=endWidth;
 divider.ondblclick=()=>{preferredWidth=null;workspace.style.removeProperty('--monitor-width');try{localStorage.removeItem('lyricflow-monitor-width');}catch{}};
 divider.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();preferredWidth=setWidth(monitor.getBoundingClientRect().width+(e.key==='ArrowLeft'?30:-30));saveWidth();};
 new ResizeObserver(()=>{if(preferredWidth!==null&&!widthDrag)setWidth(preferredWidth);}).observe(workspace);
 const timeline=$('.timeline-workspace');$('.layout').append(timeline);
 const resize=document.createElement('div');resize.className='timeline-resizer';resize.tabIndex=0;resize.setAttribute('role','separator');resize.setAttribute('aria-label','타임라인 높이 조절');resize.setAttribute('aria-orientation','horizontal');timeline.prepend(resize);
 const setHeight=n=>{const height=Math.round(Math.max(220,Math.min(window.innerHeight*.55,n)));body.style.setProperty('--timeline-height',height+'px');resize.setAttribute('aria-valuenow',String(height));return height;};
 try{const n=Number(localStorage.getItem('lyricflow-timeline-height'));if(n)setHeight(n);}catch{}
 let start=null;
 resize.onpointerdown=e=>{start={y:e.clientY,height:timeline.getBoundingClientRect().height};resize.setPointerCapture(e.pointerId);e.preventDefault();};
 resize.onpointermove=e=>{if(start)setHeight(start.height+start.y-e.clientY);};
 const finish=()=>{if(start){try{localStorage.setItem('lyricflow-timeline-height',String(timeline.getBoundingClientRect().height));}catch{}start=null;}};
 resize.onpointerup=finish;resize.onpointercancel=finish;
 resize.onkeydown=e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();setHeight(timeline.getBoundingClientRect().height+(e.key==='ArrowUp'?20:-20));};
 $('.inspector').append($('.jobs-panel'));
 const actions=document.createElement('details');actions.className='bulk-menu';actions.innerHTML='<summary>선택 작업 ▾</summary>';
 const bulk=$('.bulk-tools');for(const b of [...bulk.querySelectorAll('button')])actions.append(b);bulk.append(actions);
 const markerMenu=document.createElement('details');markerMenu.className='marker-menu';markerMenu.innerHTML='<summary>마커 ▾</summary>';markerMenu.append($('.timeline-marker-tools'),$('.timeline-marker-list'));$('.timing-tools').append(markerMenu);
 const beatMenu=document.createElement('details');beatMenu.className='beat-menu';beatMenu.innerHTML='<summary>박자 설정 ▾</summary>';beatMenu.append($('.beat-settings'));$('.timeline-grid-tools').append(beatMenu);
 const manual=$('.caption-time-fields');manual.hidden=true;
 const help=document.createElement('p');help.className='drag-guide';help.textContent='블록을 끌어 위치 이동 · 양끝을 끌어 길이 조절';$('.caption-detail').append(help);
 // Numeric fields remain internal to existing I/O keyboard handlers, not in the editing UI.
 $('#selected-caption-text').placeholder='목록이나 타임라인에서 가사를 선택하세요.';
 const toolbar=$('.head-buttons');$('.top-actions').append(toolbar);
 document.addEventListener('click',e=>{
  const trigger=e.target.closest('[popovertarget]');
  if(trigger){const menu=document.getElementById(trigger.getAttribute('popovertarget')),r=trigger.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(window.innerWidth-240,r.right-220))+'px';menu.style.top=Math.max(8,Math.min(window.innerHeight-150,r.bottom+4))+'px';}
  const menu=e.target.closest('.row-actions[popover]');if(menu&&e.target.closest('button')&&menu.isConnected&&menu.matches(':popover-open'))menu.hidePopover();
 });
}
