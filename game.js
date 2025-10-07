/* === Config === */
const SIZE = 8;                 // поле NxN
const TYPES = [1,2,3,4,5,6];    // соответствуют 1.png ... 6.png в корне
const SCORE_PER_TILE = 10;
const STAR_REFILL_CHANCE = 0.04; // шанс появления звезды при доливе

/* === State === */
let grid = [];                   // 2D: {type:number, star:boolean} | null
let score = 0, moves = 0;
let starInventory = 0;
let starArmed = false;
let selected = null;             // {r,c}
let historyState = null;         // для rewind

/* === DOM === */
const gridEl  = document.getElementById('grid');
const scoreEl = document.getElementById('score');
const movesEl = document.getElementById('moves');
const starEl  = document.getElementById('starPower');
const starCountEl = document.getElementById('starCount');
const toastEl = document.getElementById('toast');

/* === Utils === */
const rand = n => Math.floor(Math.random()*n);
const inside = (r,c) => r>=0 && c>=0 && r<SIZE && c<SIZE;
const delay = ms => new Promise(res=>setTimeout(res, ms));

function showToast(msg, ms=1400){
  toastEl.textContent = msg; toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), ms);
}

/* === Background particles === */
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

function imgPath(x){ return `${x}.png`; }            // 1.png … 6.png
function starPath(){ return `bonus.png`; }           // бонус
function rewindPath(){ return `rewind.png`; }        // просто для ссылки, не обяз.

function renderTile(r,c){
  const el = gridEl.children[r*SIZE+c].firstChild;
  const t = grid[r][c];
  el.classList.toggle('selected', !!selected && selected.r===r && selected.c===c);
  if(!t){ el.innerHTML=''; return; }
  el.innerHTML = `<img src="${t.star ? starPath() : imgPath(t.type)}" alt="">`;
}

function renderAll(){
  for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) renderTile(r,c);
}

function updateHUD(){
  scoreEl.textContent = score;
  movesEl.textContent = moves;
  starCountEl.textContent = starInventory;
  starEl.classList.toggle('active', starArmed);
}

function randomTile(){ return { type: [1,2,3,4,5,6][rand(6)], star:false }; }

function initGrid(){
  grid = Array.from({length: SIZE}, () => Array.from({length: SIZE}, randomTile));
  while(findMatches().length) shuffleBoard(); // чтобы без стартовых совпадений
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
  selected=null; starArmed=false; updateHUD(); renderAll();
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
      grid[r][c] = spawnStar ? {type:[1,2,3,4,5,6][rand(6)], star:true} : randomTile();
    }
  }
  await delay(120);
}

function neighbors(a,b){ return (a.r===b.r && Math.abs(a.c-b.c)===1) || (a.c===b.c && Math.abs(a.r-b.r)===1); }
function deselect(){ selected=null; }

/* === Input === */
gridEl.addEventListener('click', async (e)=>{
  const tileEl = e.target.closest('.tile'); if(!tileEl) return;
  const r = +tileEl.dataset.r, c = +tileEl.dataset.c;
  const t = grid[r][c];

  if(starArmed){
    if(t && t.star){ showToast('Выбери обычную плитку'); return; }
    useStarOnType(t.type); return;
  }
  if(t && t.star){
    starInventory++; grid[r][c]=randomTile(); renderTile(r,c); updateHUD(); showToast('⭐ В инвентаре');
    return;
  }

  if(!selected){ selected={r,c}; renderTile(r,c); return; }
  const b={r,c};
  if(selected.r===r && selected.c===c){ deselect(); renderTile(r,c); return; }
  if(!neighbors(selected,b)){ selected={r,c}; renderAll(); return; }

  snapshot();
  swap(selected,b); renderTile(selected.r,selected.c); renderTile(r,c);
  const m=findMatches();
  if(!m.length){
    await delay(120); swap(selected,b); renderTile(selected.r,selected.c); renderTile(r,c); deselect(); return;
  }
  moves++; updateHUD(); deselect(); await crush(m);
});

function swap(a,b){ const tmp=grid[a.r][a.c]; grid[a.r][a.c]=grid[b.r][b.c]; grid[b.r][b.c]=tmp; }

function useStarOnType(type){
  starArmed=false; updateHUD(); let removed=0;
  for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++){
    const t=grid[r][c]; if(t && !t.star && t.type===type){ grid[r][c]=null; removed++; }
  }
  if(removed){
    score += removed * SCORE_PER_TILE * 2; popConfetti();
    showToast('⭐ Бабах! Убраны все выбранные плитки ('+removed+')');
    updateHUD(); gravityAndRefill().then(()=>{ renderAll(); setTimeout(()=>crush(findMatches()), 100); });
  }
}

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
  const parts=Array.from({length:140},()=>({x:Math.random()*c.width,y:-20,vy:1+dpr*Math.random()*3,vx:(-1+Math.random()*2)*dpr,s:2+dpr*Math.random()*3,a:1,hue:Math.random()*60+40}));
  let t=0;(function anim(){ctx.clearRect(0,0,c.width,c.height);parts.forEach(p=>{p.vy+=0.03;p.y+=p.vy;p.x+=p.vx;p.a-=0.005;ctx.fillStyle=`hsla(${p.hue},95%,65%,${Math.max(0,p.a)})`;ctx.fillRect(p.x,p.y,p.s,p.s*2);});t++; if(t<260) requestAnimationFrame(anim); else c.remove();})();}

/* === Game lifecycle === */
function newGame(){ score=0;moves=0;starInventory=0;starArmed=false;selected=null;historyState=null; updateHUD(); initGrid(); buildGrid(); renderAll(); }
buildGrid(); newGame();
