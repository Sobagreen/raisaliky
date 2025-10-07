/* === Config === */
const SIZE = 8;                     // поле NxN
const TYPES = [1,2,3,4,5,6];        // 1.png ... 6.png в корне
const SCORE_PER_TILE = 10;
const STAR_REFILL_CHANCE = 0.04;    // шанс появления звезды при доливе
const DRAG_THRESHOLD = 16;          // пикселей для определения направления

/* === State === */
let grid = [];                      // 2D: {type:number, star:boolean} | null
let score = 0, moves = 0;
let starInventory = 0;
let starArmed = false;
let selected = null;                // {r,c}
let historyState = null;            // для rewind

/* Drag state */
let dragStart = null;               // {r,c, x, y}
let dragging = false;
let suppressNextClick = false;      // чтобы клик не срабатывал сразу после драга

/* === DOM === */
const gridEl  = document.getElementById('grid');
const scoreEl = document.getElementById('score');
const movesEl = document.getElementById('moves');
const starEl  = document.getElementById('starPower');
const starCountEl = document.getElementById('starCount');
const toastEl = document.getElementById('toast');

/* === Utils === */
const rand = n => Math.floor(Math.random()*n);
const delay = ms => new Promise(res=>setTimeout(res, ms));
function showToast(msg, ms=1400){ toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'), ms); }
function neighbors(a,b){ return (a.r===b.r && Math.abs(a.c-b.c)===1) || (a.c===b.c && Math.abs(a.r-b.r)===1); }

/* Цвет рамки по типу */
function borderForType(type, isStar=false){
  if(isStar) return '#fbbf24'; // золото
  const map = {
    1:'#60a5fa', // blue-400
    2:'#34d399', // emerald-400
    3:'#f59e0b', // amber-500
    4:'#f87171', // red-400
    5:'#a78bfa', // violet-400
    6:'#22d3ee'  // cyan-400
  };
  return map[type] || '#94a3b8';
}

/* === Fancy BG === */
(() => {
  const c = document.getElementById('bgfx');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ctx = c.getContext('2d');
  let w,h, dots=[];

  function resize(){
    w = c.width  = Math.floor(innerWidth*dpr);
    h = c.height = Math.floor(innerHeight*dpr);
    c.style.width = innerWidth+'px';
    c.style.height = innerHeight+'px';
    dots = Array.from({length: 90}, () => ({
      x: Math.random()*w, y: Math.random()*h,
      r: 1 + Math.random()*2*dpr,
      a: .15 + Math.random()*.35,
      vx: (-.3 + Math.random()*.6)*dpr,
      vy: (-.2 + Math.random()*.4)*dpr
    }));
  }
  window.addEventListener('resize', resize); resize();

  (function tick(){
    ctx.clearRect(0,0,w,h);
    dots.forEach(p => {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>w) p.vx*=-1;
      if(p.y<0||p.y>h) p.vy*=-1;
      const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*10);
      g.addColorStop(0, `rgba(122,240,193,${p.a})`);
      g.addColorStop(1, `rgba(122,240,193,0)`);
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*6,0,Math.PI*2); ctx.fill();
    });
    requestAnimationFrame(tick);
  })();
})();

/* === Grid build / render === */
function buildGrid(){
  gridEl.style.setProperty('--grid-size', SIZE);
  gridEl.innerHTML = '';
  for(let r=0;r<SIZE;r++){
    for(let c=0;c<SIZE;c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.r = r; tile.dataset.c = c;
      cell.appendChild(tile);
      gridEl.appendChild(cell);
    }
  }
}

function candidatePaths(base){ return [`${base}.png`, `${base}.PNG`, `${base}.Png`]; }
function setImgWithFallback(imgEl, base, isStar=false){
  const paths = isStar ? ['bonus.png','bonus.PNG','bonus.Png'] : candidatePaths(base);
  let i = 0;
  imgEl.onerror = () => { i++; if(i < paths.length) imgEl.src = paths[i]; };
  imgEl.src = paths[i];
}

function renderTile(r,c){
  const el = gridEl.children[r*SIZE+c].firstChild; // .tile
  const t = grid[r][c];
  el.classList.toggle('selected', !!selected && selected.r===r && selected.c===c);
  if(!t){ el.innerHTML=''; el.style.borderColor='transparent'; return; }
  if(!el.firstChild) el.innerHTML = `<img alt="">`;
  const img = el.querySelector('img');
  if (t.star) setImgWithFallback(img, 'bonus', true);
  else setImgWithFallback(img, String(t.type));
  el.style.borderColor = borderForType(t.type, t.star);
}

function renderAll(){ for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) renderTile(r,c); }
function updateHUD(){ scoreEl.textContent=score; movesEl.textContent=moves; starCountEl.textContent=starInventory; starEl.classList.toggle('active', starArmed); }
function randomTile(){ return { type: TYPES[rand(TYPES.length)], star:false }; }

/* Аккуратное управление выделением — всегда ОДНА плитка */
function setSelected(pos){
  const prev = selected;
  selected = pos;
  if(prev) renderTile(prev.r, prev.c);
  if(pos) renderTile(pos.r, pos.c);
}

function initGrid(){
  grid = Array.from({length: SIZE}, () => Array.from({length: SIZE}, randomTile));
  while(findMatches().length) shuffleBoard(); // без стартовых матчей
}

function shuffleBoard(){
  const list=[]; for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) list.push(grid[r][c]);
  for(let i=list.length-1;i>0;i--){ const j=rand(i+1); [list[i],list[j]]=[list[j],list[i]]; }
  let k=0; for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) grid[r][c]=list[k++];
}

function snapshot(){ historyState = JSON.stringify({grid, score, moves, starInventory}); }
function restore(){
  if(!historyState) return;
  const s = JSON.parse(historyState);
  grid=s.grid; score=s.score; moves=s.moves; starInventory=s.starInventory;
  setSelected(null); starArmed=false; updateHUD(); renderAll();
}

/* === Matches === */
function findMatches(){
  const out=[];
  // rows
  for(let r=0;r<SIZE;r++){
    let run=1;
    for(let c=1;c<=SIZE;c++){
      const prev=grid[r][c-1], cur=(c<SIZE?grid[r][c]:null);
      if(cur && prev && !prev.star && !cur.star && prev.type===cur.type){ run++; }
      else { if(run>=3) out.push(Array.from({length:run},(_,i)=>({r,c:c-1-i}))); run=1; }
    }
  }
  // cols
  for(let c=0;c<SIZE;c++){
    let run=1;
    for(let r=1;r<=SIZE;r++){
      const prev=grid[r-1][c], cur=(r<SIZE?grid[r][c]:null);
      if(cur && prev && !prev.star && !cur.star && prev.type===cur.type){ run++; }
      else { if(run>=3) out.push(Array.from({length:run},(_,i)=>({r:r-1-i,c}))); run=1; }
    }
  }
  return out;
}

async function crush(matches, chain=0){
  if(!matches.length) return false;
  const seen=new Set(); let removed=0;

  matches.forEach(group=>{
    if(group.length===4){ starInventory+=1; popConfetti(); showToast('Получена ⭐ звезда!'); }
    if(group.length>=5){ starInventory+=2; popConfetti(); showToast('Вау! ⭐⭐ за матч из 5+'); }
    group.forEach(p=>{
      const key=p.r+','+p.c;
      if(!seen.has(key)){ seen.add(key); grid[p.r][p.c]=null; removed++; }
    });
  });

  score += Math.floor(removed * SCORE_PER_TILE * (chain?1.5:1));
  updateHUD(); await gravityAndRefill(); renderAll();

  const next=findMatches();
  if(next.length) await crush(next, chain+1);
  return true;
}

async function gravityAndRefill(){
  for(let c=0;c<SIZE;c++){
    let write=SIZE-1;
    for(let r=SIZE-1;r>=0;r--){
      if(grid[r][c]!=null){ grid[write][c]=grid[r][c]; write--; }
    }
    for(let r=write;r>=0;r--){
      const spawnStar = Math.random() < STAR_REFILL_CHANCE;
      grid[r][c] = spawnStar ? {type:TYPES[rand(TYPES.length)], star:true} : randomTile();
    }
  }
  await delay(120);
}

/* === Общая попытка обмена (для клика и драга) === */
async function attemptSwap(a,b){
  if(!neighbors(a,b)) return;

  // если в обмене участвует звезда — просто подбор в инвентарь
  const tA = grid[a.r][a.c], tB = grid[b.r][b.c];
  if(tA && tA.star){ starInventory++; grid[a.r][a.c] = randomTile(); updateHUD(); renderTile(a.r,a.c); showToast('⭐ В инвентаре'); return; }
  if(tB && tB.star){ starInventory++; grid[b.r][b.c] = randomTile(); updateHUD(); renderTile(b.r,b.c); showToast('⭐ В инвентаре'); return; }

  snapshot();
  swap(a,b);
  renderTile(a.r,a.c); renderTile(b.r,b.c);

  const m = findMatches();
  if(!m.length){
    await delay(100);
    swap(a,b);
    renderTile(a.r,a.c); renderTile(b.r,b.c);
    setSelected(null);
    return;
  }
  moves++; updateHUD(); setSelected(null); await crush(m);
}

function swap(a,b){ const tmp=grid[a.r][a.c]; grid[a.r][a.c]=grid[b.r][b.c]; grid[b.r][b.c]=tmp; }

/* === Drag & Drop (mouse + touch) === */
function getRCFromEventTarget(target){
  const tileEl = target.closest && target.closest('.tile');
  if(!tileEl) return null;
  return { r:+tileEl.dataset.r, c:+tileEl.dataset.c, el:tileEl };
}

gridEl.addEventListener('mousedown', (e)=>{
  if(starArmed) return; // звезда работает по клику
  const rc = getRCFromEventTarget(e.target); if(!rc) return;
  dragging = true; suppressNextClick = false;
  dragStart = { r:rc.r, c:rc.c, x:e.clientX, y:e.clientY };
  setSelected({r:rc.r, c:rc.c});
});
window.addEventListener('mousemove', (e)=>{
  if(!dragging || !dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if(Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

  let target = null;
  if(Math.abs(dx) > Math.abs(dy)){
    target = { r: dragStart.r, c: dragStart.c + (dx>0?1:-1) };
  } else {
    target = { r: dragStart.r + (dy>0?1:-1), c: dragStart.c };
  }
  if(target && target.r>=0 && target.c>=0 && target.r<SIZE && target.c<SIZE){
    suppressNextClick = true;
    attemptSwap({r:dragStart.r, c:dragStart.c}, target);
  }
  dragging = false; dragStart = null;
});
window.addEventListener('mouseup', ()=>{
  dragging = false; dragStart = null;
});

/* Touch */
gridEl.addEventListener('touchstart', (e)=>{
  if(starArmed) return;
  const t = e.changedTouches[0];
  const rc = getRCFromEventTarget(e.target); if(!rc) return;
  dragging = true; suppressNextClick = false;
  dragStart = { r:rc.r, c:rc.c, x:t.clientX, y:t.clientY };
  setSelected({r:rc.r, c:rc.c});
},{passive:true});
gridEl.addEventListener('touchmove', (e)=>{
  if(!dragging || !dragStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - dragStart.x;
  const dy = t.clientY - dragStart.y;
  if(Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

  let target = null;
  if(Math.abs(dx) > Math.abs(dy)){
    target = { r: dragStart.r, c: dragStart.c + (dx>0?1:-1) };
  } else {
    target = { r: dragStart.r + (dy>0?1:-1), c: dragStart.c };
  }
  if(target && target.r>=0 && target.c>=0 && target.r<SIZE && target.c<SIZE){
    suppressNextClick = true;
    attemptSwap({r:dragStart.r, c:dragStart.c}, target);
  }
  dragging = false; dragStart = null;
},{passive:true});
gridEl.addEventListener('touchend', ()=>{ dragging=false; dragStart=null; }, {passive:true});

/* === Click interactions (звезда, клик-обмен) === */
gridEl.addEventListener('click', async (e)=>{
  if(suppressNextClick){ suppressNextClick=false; return; }

  const tileEl = e.target.closest('.tile'); if(!tileEl) return;
  const r = +tileEl.dataset.r, c = +tileEl.dataset.c;
  const t = grid[r][c];

  if(starArmed){
    if(t && t.star){ showToast('Выбери обычную плитку'); return; }
    useStarOnType(t.type); return;
  }

  // клик по звезде на поле = подобрать в инвентарь
  if(t && t.star){
    starInventory++; grid[r][c] = randomTile(); renderTile(r,c); updateHUD(); showToast('⭐ В инвентаре');
    return;
  }

  // клик-обмен: если нет выбранной — выделяем; если сосед — пытаемся обменять; если не сосед — переназначаем выделение
  if(!selected){ setSelected({r,c}); return; }
  if(selected.r===r && selected.c===c){ setSelected(null); return; }
  if(neighbors(selected, {r,c})){
    await attemptSwap(selected, {r,c});
    return;
  }
  setSelected({r,c});
});

document.getElementById('newGame').addEventListener('click', ()=> newGame());
document.getElementById('rewind').addEventListener('click', ()=>{ historyState ? (restore(), showToast('↺ Откат к началу хода')) : showToast('Пока нечего откатывать'); });
starEl.addEventListener('click', ()=>{
  if(starInventory<=0){ showToast('Нет звёзд — сделай матч из 4+'); return; }
  starInventory--; starArmed=true; updateHUD(); showToast('⭐ Активировано. Выбери тип плитки');
});

/* === Confetti === */
function popConfetti(){
  const c=document.createElement('canvas'), ctx=c.getContext('2d');
  const dpr=Math.min(2, window.devicePixelRatio||1);
  c.width=innerWidth*dpr; c.height=innerHeight*dpr; c.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:30';
  document.body.appendChild(c);
  const parts=Array.from({length:120},()=>({x:Math.random()*c.width,y:-20,vy:1+dpr*Math.random()*3,vx:(-1+Math.random()*2)*dpr,s:2+dpr*Math.random()*3,a:1,hue:Math.random()*60+40}));
  let t=0;(function anim(){ctx.clearRect(0,0,c.width,c.height);parts.forEach(p=>{p.vy+=0.03;p.y+=p.vy;p.x+=p.vx;p.a-=0.005;ctx.fillStyle=`hsla(${p.hue},95%,65%,${Math.max(0,p.a)})`;ctx.fillRect(p.x,p.y,p.s,p.s*2);});t++; if(t<220) requestAnimationFrame(anim); else c.remove();})();
}

/* === Game lifecycle === */
function newGame(){ score=0;moves=0;starInventory=0;starArmed=false; setSelected(null); historyState=null; updateHUD(); initGrid(); buildGrid(); renderAll(); }
buildGrid(); newGame();
