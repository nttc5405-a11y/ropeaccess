
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const svgPointer = e => { const pt=e.currentTarget.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(e.currentTarget.getScreenCTM().inverse()); };

// ========================================================================
// 常數：NFPA 2500（原 NFPA 1983）/ UIAA / 單位換算
// ========================================================================
const G = 9.80665;                 // m/s²
const KGF_PER_KN = 1000 / G;       // 1 kN ≈ 101.97 kgf
const LBF_PER_KN = 224.809;

// NFPA 1983 (2017 ed.) 繩索與系統強度
const NFPA = {
  G_RATED: { name: 'G (General Use)', mbs_kN: 40, swl_kN: 40 / 15, ratio: 15, persons: 2, color: '#22c55e' },
  T_RATED: { name: 'T (Technical Use)', mbs_kN: 20, swl_kN: 20 / 10, ratio: 10, persons: 1, color: '#3b82f6' },
  E_RATED: { name: 'E (Escape)', mbs_kN: 13.5, swl_kN: 13.5 / 10, ratio: 10, persons: 1, color: '#a855f7' },
};

// 人體承受門檻 (kN) — UIAA / OSHA / ANSI Z359
const HUMAN_THRESHOLDS = [
  { max: 4,  label: '安全範圍',         color: 'text-green-800',   bg: 'bg-green-500/10' },
  { max: 6,  label: 'UIAA 安全帶上限',  color: 'text-amber-800',  bg: 'bg-yellow-500/10' },
  { max: 8,  label: 'OSHA PFAS 上限',   color: 'text-orange-800',  bg: 'bg-orange-500/10' },
  { max: 12, label: '嚴重內傷風險',     color: 'text-red-700',     bg: 'bg-red-500/10' },
  { max: Infinity, label: '可能致命 / 超 NFPA G MBS', color: 'text-red-500 font-bold', bg: 'bg-red-600/20' },
];

const evalHuman = (kN) => HUMAN_THRESHOLDS.find(t => kN <= t.max);

// 評估安全係數
const evalNfpa = (force_kN, rating) => {
  const r = NFPA[rating];
  const sf = r.mbs_kN / force_kN;
  let level = 'pass', text = `安全係數 ${sf.toFixed(1)}:1 (≥ ${r.ratio}:1)`, color = 'text-green-800';
  if (sf < r.ratio && sf >= r.ratio * 0.6) { level = 'warn'; text = `⚠ 安全係數 ${sf.toFixed(1)}:1 (低於 ${r.ratio}:1)`; color = 'text-amber-800'; }
  if (sf < r.ratio * 0.6 && sf >= 1) { level = 'fail'; text = `❌ 安全係數 ${sf.toFixed(1)}:1 (嚴重不足)`; color = 'text-orange-800'; }
  if (sf < 1) { level = 'crit'; text = `☠ 超過 MBS ${r.mbs_kN}kN`; color = 'text-red-500 font-bold'; }
  return { sf, level, text, color };
};

// ========================================================================
// 工具函式
// ========================================================================
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const kNtoKgf = (kN) => kN * KGF_PER_KN;
const fmt = (v, d=1) => Number(v).toFixed(d);

// 截圖：合成 video（背景）+ SVG（前景），輸出 PNG
async function captureSVGWithVideo(svgEl, videoEl, W, H, filename) {
  if (!svgEl) return false;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // 背景：相機畫面（cover 縮放）或深色底
  if (videoEl && videoEl.srcObject && videoEl.videoWidth > 0) {
    const vRatio = videoEl.videoWidth / videoEl.videoHeight;
    const cRatio = W / H;
    let dw, dh, dx, dy;
    if (vRatio > cRatio) { dh = H; dw = dh * vRatio; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = dw / vRatio; dx = 0; dy = (H - dh) / 2; }
    ctx.drawImage(videoEl, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);
  }
  // SVG 圖層
  let svgStr = new XMLSerializer().serializeToString(svgEl);
  if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, W, H); res(); };
      img.onerror = rej;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  // 下載 PNG
  return new Promise((res) => {
    canvas.toBlob(b => {
      if (!b) { res(false); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      res(true);
    }, 'image/png');
  });
}

// 全頁截圖：使用 getDisplayMedia 捕捉當前頁面畫面並下載為 PNG
async function capturePageScreenshot(filename = 'rope-analysis.png') {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', cursor: 'never', frameRate: 1 },
      audio: false,
      preferCurrentTab: true,
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await new Promise(res => { video.onloadedmetadata = () => video.play().then(res); });
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const w = video.videoWidth, h = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    stream.getTracks().forEach(t => t.stop());
    return new Promise(res => {
      canvas.toBlob(b => {
        if (!b) { res(false); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        res(true);
      }, 'image/png');
    });
  } catch(e) {
    console.warn('Screenshot failed:', e);
    return false;
  }
}

// ========================================================================
// 圖示 (內嵌 SVG，不依賴 lucide)
// ========================================================================
const Icon = ({ name, size=18, className='' }) => {
  const paths = {
    activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
    triangle: <path d="M12 2L2 22h20L12 2z" />,
    arrowDown: <><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></>,
    git: <><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></>,
    move: <><polyline points="19 12 12 19 5 12"/><line x1="12" y1="5" x2="12" y2="19"/></>,
    anchor: <><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></>,
    cog: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    print: <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
    info: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
    camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2l2-2h12l2 2h2a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></>,
    chevron: <polyline points="6 9 12 15 18 9" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name]}
    </svg>
  );
};

// ========================================================================
// 共用 UI
// ========================================================================
const Slider = ({label,value,min,max,step=1,onChange,unit,hint,ariaLabel}) => {
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const commit=()=>{ const n=Number(draft); if(draft.trim()!=='' && Number.isFinite(n)) onChange(clamp(n,min,max)); else setDraft(String(value)); };
  const change=(delta)=>onChange(Number(clamp(value+delta,min,max).toFixed(4)));
  return <div className="numeric-field"><label>{label}</label><div className="number-entry">
    <button aria-label={`${ariaLabel||label} 減少`} onClick={()=>change(-step)}>−</button>
    <input type="number" inputMode="decimal" min={min} max={max} step={step} aria-label={ariaLabel||label} value={draft}
      onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){commit();e.target.blur();}if(e.key==='Escape')setDraft(String(value));}} />
    <span>{unit}</span><button aria-label={`${ariaLabel||label} 增加`} onClick={()=>change(step)}>＋</button>
  </div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} aria-label={`${ariaLabel||label} 滑桿`} />
  {hint&&<p className="field-hint">{hint}</p>}</div>;
};
const Result = ({label,value,unit='kgf',sub,primary=false}) => <div className={`quick-result ${primary?'primary':''}`}><span>{label}</span><strong>{value}<small>{unit}</small></strong>{sub&&<span className="result-sub">{sub}</span>}</div>;
const ResultForce = ({label,kN,primary=false,invalid=false}) => <Result label={label} value={invalid?'—':fmt(kNtoKgf(kN),0)} primary={primary} sub={invalid?'此幾何條件無有效解':`${fmt(kN,2)} kN`} />;
const Results = ({children}) => {
  const ref=useRef(null);const [docked,setDocked]=useState(false);
  useEffect(()=>{const check=()=>setDocked(ref.current?.getBoundingClientRect().bottom<0);window.addEventListener('scroll',check,{passive:true});check();return()=>window.removeEventListener('scroll',check);},[]);
  return <><div ref={ref} className="result-grid">{children}</div>{docked&&<div className="result-dock" aria-hidden="true">{React.Children.map(children,c=><div><span>{c.props.label}</span><b>{c.props.invalid?'—':fmt(kNtoKgf(c.props.kN),0)} <small>kgf</small></b></div>)}</div>}</>;
};
const ModuleTitle = ({number,title,hint}) => <div className="module-title"><div className="eyebrow">模組 {number} ／ 即時試算</div><h2>{title}</h2><p>{hint}</p></div>;
const Reference = ({children}) => <details className="reference"><summary>公式與操作說明</summary><div>{children}</div></details>;
const PointFields = ({points,W,H}) => <details className="reference"><summary>精確調整各點位置</summary><p>相對圖面位置（％）。X 向右增加，Y 向下增加。</p>{points.map(p=><div className="point-fields" key={p.id}><b>{p.label}</b><Slider label="X 位置" ariaLabel={`${p.id} X 位置`} value={Number((p.point.x/W*100).toFixed(1))} min={2} max={98} step={1} unit="%" onChange={v=>p.set({...p.point,x:v/100*W})}/><Slider label="Y 位置" ariaLabel={`${p.id} Y 位置`} value={Number((p.point.y/H*100).toFixed(1))} min={4} max={96} step={1} unit="%" onChange={v=>p.set({...p.point,y:v/100*H})}/></div>)}</details>;
const layoutCanvasLabels = (labels,points,lines,W,top,bottom) => {
  const placed=[];const w=252,h=94;
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  for(const label of labels){
    const p=label.point;
    const offsets=label.offsets||[[0,-110],[0,105],[-175,0],[175,0],[-160,-105],[160,-105],[-160,105],[160,105]];
    const candidates=offsets.map(([dx,dy])=>({x:clamp(p.x+dx-w/2,12,W-w-12),y:clamp(p.y+dy-h/2,top+12,bottom-h-12),w,h}));
    // Also consider empty grid locations when points crowd together.
    for(const x of [12,(W-w)/2,W-w-12])for(const y of [top+12,(top+bottom-h)/2,bottom-h-12])candidates.push({x,y,w,h});
    const score=r=>{
      let cost=Math.hypot(r.x+w/2-p.x,r.y+h/2-p.y)*0.08;
      for(const q of placed)cost+=overlap({...r,x:r.x-8,y:r.y-8,w:w+16,h:h+16},q)*100;
      for(const q of points)cost+=overlap(r,{x:q.point.x-52,y:q.point.y-52,w:104,h:104})*20;
      for(const line of lines)for(let t=0;t<=1;t+=.1){const x=line.a.x+(line.b.x-line.a.x)*t,y=line.a.y+(line.b.y-line.a.y)*t;if(x>r.x&&x<r.x+w&&y>r.y&&y<r.y+h)cost+=40;}
      return cost;
    };
    const best=candidates.reduce((a,b)=>score(a)<=score(b)?a:b);placed.push({...best,...label});
  }
  return placed;
};
const QuickDiagram = ({W,H,points,lines,onMove,onEnd,onStart,svgRef,videoRef,cameraOn=false,showGrid=true,fullscreen,setFullscreen,tools,extra,labels=[],metrics=[],dock=[],vbY=0,vbH=H}) => {
  useEffect(()=>{if(!fullscreen)return; const previous=document.body.style.overflow;document.body.style.overflow='hidden';const escape=e=>{if(e.key==='Escape')setFullscreen(false);};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',escape);};},[fullscreen]);
  const panelRef=useRef(null);const [docked,setDocked]=useState(false);
  useEffect(()=>{const check=()=>setDocked(panelRef.current?.getBoundingClientRect().bottom<0);window.addEventListener('scroll',check,{passive:true});check();return()=>window.removeEventListener('scroll',check);},[]);
  const placed=layoutCanvasLabels(labels,points,lines,W,vbY,vbY+vbH);
  return <><section ref={panelRef} className={`diagram-panel ${fullscreen?'diagram-fullscreen':''}`}><div className="diagram-heading"><span>受力示意圖</span><button onClick={()=>setFullscreen(!fullscreen)}>{fullscreen?'返回試算':'放大圖形'}</button></div>
    <div className={`diagram-surface ${cameraOn?'camera-surface':''}`}>
      {cameraOn&&<video ref={videoRef} autoPlay playsInline muted />}
      <svg ref={svgRef} viewBox={`0 ${vbY} ${W} ${vbH+58}`} role="group" aria-label="可拖曳受力示意圖" onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd}>
        {!cameraOn&&<rect x="0" y={vbY} width={W} height={vbH+58} fill="#f8fafc" />}
        {showGrid&&<g>{Array.from({length:Math.ceil(W/80)},(_,i)=><line key={`x${i}`} x1={i*80} y1={vbY} x2={i*80} y2={vbY+vbH} stroke={cameraOn?'#ffffff66':'#e2e8f0'} />)}{Array.from({length:Math.ceil(vbH/80)},(_,i)=><line key={`y${i}`} x1={0} y1={vbY+i*80} x2={W} y2={vbY+i*80} stroke={cameraOn?'#ffffff66':'#e2e8f0'} />)}</g>}
        {lines.map((l,i)=><line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={l.color||'#1e40af'} strokeWidth="7" strokeLinecap="round" />)}
        {extra}
        <g className="canvas-labels" pointerEvents="none">
          {placed.map((l,i)=><g key={i} className="canvas-force-label" aria-label={`${l.label} ${l.value} ${l.unit||'kgf'}`}>
            <line x1={l.point.x} y1={l.point.y} x2={clamp(l.point.x,l.x,l.x+l.w)} y2={clamp(l.point.y,l.y,l.y+l.h)} stroke="#64748b" strokeWidth="2" strokeDasharray="5 5"/>
            <rect x={l.x} y={l.y} width={l.w} height={l.h} rx="14" fill="#fff" stroke="#9aabc0" strokeWidth="2"/>
            <text x={l.x+l.w/2} y={l.y+32} textAnchor="middle" fontSize="32" fontWeight="600" fill="#334155">{l.label}</text>
            <text x={l.x+l.w/2} y={l.y+76} textAnchor="middle" fontSize="46" fontWeight="800" fill={l.color||'#163f88'}>{l.value} <tspan fontSize="29" fontWeight="500">{l.unit||'kgf'}</tspan></text>
          </g>)}
          <rect x="0" y={vbY+vbH+4} width={W} height="54" fill="#ffffff"/>
          <text x={W/2} y={vbY+vbH+39} textAnchor="middle" fontSize="29" fontWeight="650" fill="#334155">{metrics.join('　／　')}</text>
        </g>
        {points.map(p=><g key={p.id} transform={`translate(${p.point.x} ${p.point.y})`} role="button" aria-label={p.set?`${p.label}，方向鍵微調位置`:p.label} tabIndex={p.set?0:undefined}
          onKeyDown={e=>{if(!p.set)return;const offsets={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};if(offsets[e.key]){e.preventDefault();const [dx,dy]=offsets[e.key];p.set({x:clamp(p.point.x+dx,16,W-16),y:clamp(p.point.y+dy,16,H-16)});}}}
          onPointerDown={e=>{if(p.draggable===false)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);onStart(p.id);}} style={{cursor:p.draggable===false?'default':'grab'}}>
          <circle r="50" fill="transparent" /><circle r="27" fill={p.color||'#1e40af'} stroke="white" strokeWidth="5" /><text textAnchor="middle" dominantBaseline="central" fontSize="28" fontWeight="700" fill="white">{p.id}</text>
        </g>)}
      </svg>
    </div><div className="diagram-caption">{points.map(p=><span key={p.id}><i style={{background:p.color||'#1e40af'}}/>{p.id} {p.label}</span>)}</div>
    {tools&&<details className="diagram-tools"><summary>圖形工具</summary><div>{tools}</div></details>}
  </section>{docked&&!fullscreen&&<div className="result-dock" aria-hidden="true">{dock.map((r,i)=><div key={i}><span>{r.label}</span><b>{r.value} <small>kgf</small></b></div>)}</div>}</>;
};
// 力量顯示卡：統一以 kgf 顯示
const ForceCard = ({ title, kN, colorClass = 'text-slate-900', description, accent }) => (
  <div className={`bg-white p-4 rounded-xl border ${accent ? 'border-red-900/60' : 'border-slate-200'} flex flex-col items-center justify-center text-center relative overflow-hidden`}>
    <div className="text-slate-600 text-xs mb-1 uppercase tracking-wider">{title}</div>
    <div className={`text-3xl md:text-4xl font-bold font-mono count-up ${colorClass}`} key={kN.toFixed(2)}>
      {fmt(kNtoKgf(kN), 0)} <span className="text-base text-slate-600 font-sans">kgf</span>
    </div>
    {description && <div className="text-xs text-slate-600 mt-2">{description}</div>}
  </div>
);

const NumberCard = ({ title, value, unit, colorClass = 'text-slate-900', description }) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center">
    <div className="text-slate-600 text-xs mb-1 uppercase tracking-wider">{title}</div>
    <div className={`text-3xl md:text-4xl font-bold font-mono count-up ${colorClass}`} key={value}>
      {value} <span className="text-base text-slate-600 font-sans">{unit}</span>
    </div>
    {description && <div className="text-xs text-slate-600 mt-2">{description}</div>}
  </div>
);

// 摺疊區塊：用於長篇參考/教學內容，預設可收合以精簡介面
// action：可放置獨立可點擊元素（如外部連結），不會被收合按鈕吃掉點擊事件
const CollapsibleSection = ({ title, subtitle, badge, action, defaultOpen = false, className = '', children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border ${className}`}>
      <div className="w-full flex items-center justify-between gap-3 p-4">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex-1 flex items-center gap-2 flex-wrap min-w-0 text-left">
          {badge}
          <div className="min-w-0">
            <div className="text-slate-900 font-bold text-sm md:text-base">{title}</div>
            {subtitle && <div className="text-slate-600 text-xs mt-0.5">{subtitle}</div>}
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? '收合' : '展開'}>
            <Icon name="chevron" size={20}
              className={`text-slate-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && <div className="px-4 pb-4 md:px-5 md:pb-5 space-y-4">{children}</div>}
    </div>
  );
};

// NFPA 安全係數徽章（精簡版）
const NfpaBadge = ({ force_kN }) => {
  const [rating, setRating] = useState('G_RATED');
  const r = NFPA[rating];
  const e = evalNfpa(force_kN, rating);
  return (
    <div className="bg-slate-100/40 border border-slate-300 rounded-lg px-2.5 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-600 font-bold">NFPA 1983</span>
          <div className="flex gap-0.5">
            {Object.keys(NFPA).map(k => (
              <button key={k}
                onClick={() => setRating(k)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${rating===k ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600'}`}
                title={NFPA[k].name}>
                {k.split('_')[0]}
              </button>
            ))}
          </div>
        </div>
        <span className={`text-[11px] font-mono ${e.color}`}>{e.text}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full transition-all" style={{
          width: `${Math.min(100, (force_kN / r.mbs_kN) * 100)}%`,
          background: e.level==='pass' ? '#22c55e' : e.level==='warn' ? '#eab308' : e.level==='fail' ? '#f97316' : '#ef4444',
        }} />
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 font-mono">
        <span>{r.name.split(' ')[0]} · {r.ratio}:1 · {r.persons}P</span>
        <span>SWL {fmt(kNtoKgf(r.swl_kN), 0)} / MBS {fmt(kNtoKgf(r.mbs_kN), 0)} kgf</span>
      </div>
    </div>
  );
};

// 摩擦係數範例（μ）：常見繩索接觸面組合，供快速套用
const FRICTION_MU_PRESETS = [
  { label: '繩對繩（摩擦節/繞繩）', mu: 0.55, hint: '尼龍對尼龍纏繞，範圍約 0.40–0.70' },
  { label: '繩對鉤環（拋光鋁）',   mu: 0.15, hint: '光滑鋁合金鉤環，範圍約 0.10–0.20' },
  { label: '繩對鉤環（一般/鋼）', mu: 0.25, hint: '一般或鋼製鉤環，範圍約 0.20–0.30' },
  { label: '繩對確保器/下降器',   mu: 0.30, hint: '八字環、ATC 等溝槽裝置，範圍約 0.20–0.40' },
  { label: '繩對乾燥樹幹',       mu: 0.40, hint: '乾燥樹皮，範圍約 0.30–0.45' },
  { label: '繩對潮濕樹皮',       mu: 0.20, hint: '濕滑樹皮或苔蘚，範圍約 0.15–0.25' },
  { label: '繩對粗糙岩石',       mu: 0.65, hint: '粗糙花崗岩等，範圍約 0.50–0.80' },
];

// ========================================================================
// 模組 1：Capstan 摩擦力 — 加上螺旋繪製、張力熱力圖
// ========================================================================
function FrictionModule() {
  const [turns, setTurns] = useState(1);
  const [mu, setMu] = useState(0.2);
  const [knownVar, setKnownVar] = useState('T1');    // 'T1'=已知載重求制動力 · 'T2'=已知施力求可承受載重
  const [knownKgf, setKnownKgf] = useState(100);       // 目前「已知」那一側的數值

  const theta = turns * 2 * Math.PI;
  const gain = Math.exp(mu * theta);
  const load_kgf = knownVar === 'T1' ? knownKgf : knownKgf * gain;   // T₁ 載重
  const hold_kgf = knownVar === 'T1' ? knownKgf / gain : knownKgf;   // T₂ 施力/制動力
  const load_kN = (load_kgf * G) / 1000;
  const hold_kN = (hold_kgf * G) / 1000;
  const friction_kN = load_kN - hold_kN;

  // 切換「已知」的一側時，把目前算出的值帶過去，畫面數字才不會跳動
  const switchKnown = (nextVar) => {
    if (nextVar === knownVar) return;
    const carried = nextVar === 'T1' ? load_kgf : hold_kgf;
    setKnownKgf(Math.round(carried * 10) / 10);
    setKnownVar(nextVar);
  };

  // 螺旋繞線 path
  const spiralPath = useMemo(() => {
    const cx = 100, cy = 100, r0 = 40, dr = 4;
    const totalAngle = theta;
    const steps = Math.max(40, Math.ceil(totalAngle * 8));
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = Math.PI / 2 + t * totalAngle;
      const r = r0 + t * dr * Math.min(1, turns);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' ';
    }
    return d;
  }, [theta, turns]);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">1. 繩索摩擦力 — Capstan Equation</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              繩索纏繞於圓柱（鉤環、樹幹、下降器）時，摩擦力以指數成長。
              公式：<code className="text-blue-800 bg-slate-100 px-1 rounded">T₁ = T₂ × e^(μθ)</code>
            </p>
          </div>
          <div className="space-y-4 bg-slate-100/50 p-5 rounded-xl">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-700">已知條件</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => switchKnown('T1')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${knownVar === 'T1' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600'}`}>
                  已知 T₁（載重）求 T₂
                </button>
                <button type="button" onClick={() => switchKnown('T2')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${knownVar === 'T2' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600'}`}>
                  已知 T₂（施力）求 T₁
                </button>
              </div>
            </div>
            <Slider label={knownVar === 'T1' ? '載重 (T₁，已知)' : '施力 (T₂，已知)'}
              value={knownKgf} min={10} max={500} step={10} unit="kgf" onChange={setKnownKgf} />
            <Slider label="纏繞圈數 (θ)" value={turns} min={0} max={4} step={0.25} unit="圈" onChange={setTurns} editable />
            <div className="space-y-2">
              <Slider label="摩擦係數 (μ)" value={mu} min={0.1} max={0.8} step={0.05} unit="" onChange={setMu} />
              <div className="flex flex-wrap gap-1.5">
                {FRICTION_MU_PRESETS.map((p) => {
                  const active = Math.abs(mu - p.mu) < 0.001;
                  return (
                    <button key={p.label} type="button" onClick={() => setMu(p.mu)} title={p.hint}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600'}`}>
                      {p.label} μ≈{fmt(p.mu, 2)}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-600">點選上方範例快速套用常見摩擦係數，或用滑塊微調。</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 flex flex-col">
          <div className="grid grid-cols-2 gap-4">
            <ForceCard title={knownVar === 'T1' ? 'T₁（已知載重）' : 'T₁（計算：可承受載重）'}
              kN={load_kN} colorClass="text-blue-800"
              description={knownVar === 'T1' ? '您輸入的載重' : '此設定下最多能承受的載重'} />
            <ForceCard title={knownVar === 'T2' ? 'T₂（已知施力）' : 'T₂（計算：所需制動力）'}
              kN={hold_kN} colorClass="text-green-800"
              description={knownVar === 'T2' ? '您輸入的施力' : '您需要施加的力'} />
          </div>
          <p className="text-xs text-slate-600 text-center -mt-2">摩擦力吸收 {fmt(kNtoKgf(friction_kN), 0)} kgf（T₁−T₂）</p>
          <div className="grid grid-cols-2 gap-4">
            <NumberCard title="制動倍數 e^(μθ)" value={fmt(gain, 1)} unit="倍" colorClass="text-purple-800"
              description={turns === 0 ? '未纏繞' : `${turns} 圈 × μ=${mu}`} />
            <NumberCard title="拖拉效率 η = 1/e^(μθ)" value={fmt((1/gain)*100, 0)} unit="%"
              colorClass={(1/gain) > 0.85 ? 'text-emerald-800' : (1/gain) > 0.5 ? 'text-amber-800' : 'text-red-700'}
              description={turns === 0 ? '無摩擦損失' : `100 kgf 拉力只剩 ${fmt((1/gain)*100, 0)} kgf`} />
          </div>

          <div className="flex-1 bg-white rounded-xl border border-slate-200 flex items-center justify-center p-4 min-h-[220px]">
            <svg viewBox="0 0 200 220" className="w-full h-full max-h-64">
              <circle cx="100" cy="100" r="40" fill="#334155" stroke="#475569" strokeWidth="3" />
              <text x="100" y="104" fill="#94a3b8" fontSize="10" textAnchor="middle">μ = {mu}</text>

              <path d={spiralPath} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />

              <line x1="60" y1="140" x2="60" y2="200" stroke="#ef4444" strokeWidth="5" />
              <polygon points="55,200 65,200 60,210" fill="#ef4444" />
              <text x="60" y="218" fill="#ef4444" fontSize="11" fontWeight="bold" textAnchor="middle">T₁ {fmt(load_kgf, 0)} kgf</text>

              <line x1="140" y1="100" x2="140" y2="20" stroke="#22c55e" strokeWidth={Math.max(1.5, 5 - turns)} />
              <polygon points="135,30 145,30 140,18" fill="#22c55e" />
              <text x="140" y="14" fill="#22c55e" fontSize="11" fontWeight="bold" textAnchor="middle">T₂ {fmt(kNtoKgf(hold_kN),0)} kgf</text>
            </svg>
          </div>
        </div>
      </div>

      <CollapsibleSection
        className="bg-gradient-to-br from-sky-950/30 to-slate-900 border-sky-800/40"
        badge={<div className="bg-red-600 text-white px-2 py-1 rounded text-xs font-bold">▶ YouTube 系列</div>}
        title="進階解讀：「一個鉤環 vs 兩個鉤環，哪個摩擦力較大？」三部曲"
        subtitle="來源：Over The Edge Rescue · 測試地點：紐西蘭 Aspiring Safety 50 kN 垂直試驗台">

        {/* 三部曲說明卡 */}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-white/60 rounded-lg p-3 border border-slate-200">
            <div className="text-xs text-sky-400 font-bold mb-1">PART 1 · 摩擦係數理論</div>
            <a href="https://www.youtube.com/watch?v=1r21sGpqd3w" target="_blank" rel="noopener noreferrer"
              className="text-xs text-slate-800 hover:text-sky-300 underline-offset-2 hover:underline block mb-2">
              Coefficient of Friction Testing ↗
            </a>
            <div className="text-xs text-slate-600 leading-relaxed">
              用 Capstan 公式推導：單鉤環包覆角為 180°（半圓）；雙鉤環為 2×90° 也等於 180°。
              <strong className="text-sky-300">理論上摩擦力相同</strong>。
            </div>
          </div>

          <div className="bg-white/60 rounded-lg p-3 border border-slate-200">
            <div className="text-xs text-sky-400 font-bold mb-1">PART 2 · 慢拉測試</div>
            <a href="https://www.youtube.com/watch?v=l9wy479rKcw" target="_blank" rel="noopener noreferrer"
              className="text-xs text-slate-800 hover:text-sky-300 underline-offset-2 hover:underline block mb-2">
              Slow Pull Tests ↗
            </a>
            <div className="text-xs text-slate-600 leading-relaxed">
              在 50 kN 試驗台上實測「最大可單手控制力 Max Force」。
              Munter 結加第二個鉤環只多 <strong className="text-sky-300">0.1 kN</strong>，幾乎可忽略。
            </div>
          </div>

          <div className="bg-white/60 rounded-lg p-3 border border-slate-200">
            <div className="text-xs text-sky-400 font-bold mb-1">PART 3 · 實際垂降</div>
            <a href="https://www.youtube.com/watch?v=kOf7zMUQPDc" target="_blank" rel="noopener noreferrer"
              className="text-xs text-slate-800 hover:text-sky-300 underline-offset-2 hover:underline block mb-2">
              Practical Abseil Tests ↗
            </a>
            <div className="text-xs text-slate-600 leading-relaxed">
              真人實際垂降驗證：Munter 加第二個鉤環體感差不多；Reverso 在細繩時加鉤環有感；
              <strong className="text-sky-300">「多繞一圈」效果遠大於加鉤環</strong>。
            </div>
          </div>
        </div>

        {/* 結論表格 */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-100/60 text-slate-800 font-bold text-sm">
            📊 三部曲結論彙整表
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-700">
              <thead className="bg-slate-50 text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2 border-b border-slate-200">情境 / 裝置</th>
                  <th className="px-3 py-2 border-b border-slate-200">變因</th>
                  <th className="px-3 py-2 border-b border-slate-200">摩擦增益</th>
                  <th className="px-3 py-2 border-b border-slate-200">建議</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">理論（Capstan）</td>
                  <td className="px-3 py-2">1 vs 2 鉤環</td>
                  <td className="px-3 py-2 text-slate-600">相同（θ=180°）</td>
                  <td className="px-3 py-2 font-sans text-slate-600">同總包覆角 → 摩擦同</td>
                </tr>
                <tr className="border-b border-slate-200/60 bg-slate-50/40">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">Munter 義大利結</td>
                  <td className="px-3 py-2">+1 鉤環</td>
                  <td className="px-3 py-2 text-amber-800">+0.1 kN</td>
                  <td className="px-3 py-2 font-sans text-yellow-800">⚠ 不值得加</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">Munter 義大利結</td>
                  <td className="px-3 py-2">D 型 vs O 型鉤環</td>
                  <td className="px-3 py-2 text-amber-800">+0.3 kN</td>
                  <td className="px-3 py-2 font-sans text-yellow-800">⚠ 差異很小</td>
                </tr>
                <tr className="border-b border-slate-200/60 bg-slate-50/40">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">Reverso 確保器（粗繩）</td>
                  <td className="px-3 py-2">+1 鉤環</td>
                  <td className="px-3 py-2 text-amber-800">差異不明顯</td>
                  <td className="px-3 py-2 font-sans text-slate-600">不需加</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">Reverso 確保器（細繩）</td>
                  <td className="px-3 py-2">+1 鉤環</td>
                  <td className="px-3 py-2 text-green-800">+0.5 kN ↑</td>
                  <td className="px-3 py-2 font-sans text-green-800">✓ 推薦加</td>
                </tr>
                <tr className="border-b border-slate-200/60 bg-slate-50/40">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">Reverso（細繩進階）</td>
                  <td className="px-3 py-2">兩鉤環分開（一個變向）</td>
                  <td className="px-3 py-2 text-green-800">明顯增加</td>
                  <td className="px-3 py-2 font-sans text-green-800">✓ 最易控制</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 font-sans font-medium text-slate-800">細繩垂降通用</td>
                  <td className="px-3 py-2">Munter → Munter 1.5（多半圈）</td>
                  <td className="px-3 py-2 text-green-800">+0.7 kN</td>
                  <td className="px-3 py-2 font-sans text-green-800">✓ 強烈推薦</td>
                </tr>
                <tr className="bg-emerald-950/30">
                  <td className="px-3 py-2 font-sans font-bold text-emerald-800">🏆 通用最佳解</td>
                  <td className="px-3 py-2 text-emerald-800">多繞一圈（鉤環/裝置/繩索）</td>
                  <td className="px-3 py-2 text-emerald-800 font-bold">e^(μ·π) 倍</td>
                  <td className="px-3 py-2 font-sans text-emerald-800 font-bold">✓✓ 對應 Capstan 公式</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 重點結論 */}
        <div className="bg-emerald-950/30 rounded-lg p-4 border border-emerald-900/50">
          <div className="text-emerald-800 font-bold text-sm mb-2">📌 三部曲核心結論</div>
          <ol className="text-xs text-slate-700 leading-relaxed list-decimal pl-5 space-y-1">
            <li><strong className="text-emerald-800">理論與實測一致</strong>：包覆角度（θ）才是決定摩擦力的關鍵，鉤環「數量」並非主因——這正是 Capstan 公式 T = T₂·e^(μθ) 的核心。</li>
            <li><strong className="text-emerald-800">想加摩擦力？多繞一圈！</strong> 每多繞 180°（π 弧度），摩擦增益就乘上 e^(μπ)（μ=0.2 時 ≈ 1.87 倍；μ=0.3 時 ≈ 2.57 倍）。比加第二個鉤環有效得多。</li>
            <li><strong className="text-emerald-800">細繩例外</strong>：Reverso 在細繩上摩擦本來就低，加第二個鉤環從低基準算起仍有感（+0.5 kN）；用「分開兩鉤環＋變向」更易控制。</li>
            <li><strong className="text-emerald-800">D 型 vs O 型差異小</strong>：選鉤環不必執著形狀，承重方向（軸向）才是重點。</li>
          </ol>
        </div>

        <div className="text-[10px] text-slate-600 border-t border-slate-200 pt-2">
          來源：
          <a href="https://www.youtube.com/watch?v=1r21sGpqd3w" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Part 1 · 摩擦係數</a>
          {' · '}
          <a href="https://www.youtube.com/watch?v=l9wy479rKcw" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Part 2 · 慢拉測試</a>
          {' · '}
          <a href="https://www.youtube.com/watch?v=kOf7zMUQPDc" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Part 3 · 實際垂降</a>
          {' · '}
          <a href="https://overtheedgerescue.com/rope-rescue/oneortwocarabinersforfriction/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Over The Edge Rescue 完整測試報告</a>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        className="bg-gradient-to-br from-emerald-950/30 to-slate-900 border-emerald-800/40"
        title="📐 μ 值 vs 滑輪效率對照"
        subtitle="繩索拖拉效率 η = e^(−μθ)，180° 包覆角情境下的裝置對照">
        <p className="text-slate-600 text-xs -mt-2 leading-relaxed">
          繩索拖拉效率 η = e^(−μθ)，其中 θ 為包覆角（弧度）。
          以下為最常見的 <strong className="text-emerald-800">180° 包覆角</strong>（θ = π）情境下，不同摩擦係數對應的效率與裝置等級。
        </p>

        {/* 主要對照表：μ → 裝置 → 效率 */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-100/60 text-slate-800 font-bold text-sm">
            🎯 摩擦係數 ↔ 裝置等級 ↔ 180° 效率
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left border-b border-slate-200">μ 值範圍</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">對應裝置</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">180° 效率</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">100 kgf 能傳遞</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b border-slate-200/60 bg-emerald-950/20">
                  <td className="px-3 py-2 text-emerald-800">0.03 – 0.05</td>
                  <td className="px-3 py-2 font-sans">球軸承滑輪（Petzl Rescue / SMC PMP / DMM）</td>
                  <td className="px-3 py-2 text-emerald-800 font-bold">86 – 91%</td>
                  <td className="px-3 py-2 text-emerald-800">86 – 91 kgf</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 text-green-800">0.05 – 0.10</td>
                  <td className="px-3 py-2 font-sans">一般滑輪、軸套式滑輪</td>
                  <td className="px-3 py-2 text-green-800 font-bold">73 – 85%</td>
                  <td className="px-3 py-2 text-green-800">73 – 85 kgf</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 text-yellow-800">0.15 – 0.25</td>
                  <td className="px-3 py-2 font-sans">鉤環當變向用</td>
                  <td className="px-3 py-2 text-yellow-800 font-bold">46 – 62%</td>
                  <td className="px-3 py-2 text-yellow-800">46 – 62 kgf</td>
                </tr>
                <tr className="border-b border-slate-200/60 bg-orange-950/20">
                  <td className="px-3 py-2 text-orange-800 font-bold">0.30</td>
                  <td className="px-3 py-2 font-sans">粗糙鉤環 / 樹枝表面</td>
                  <td className="px-3 py-2 text-orange-800 font-bold">39%</td>
                  <td className="px-3 py-2 text-orange-800">39 kgf</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2 text-red-800">0.40 – 0.60</td>
                  <td className="px-3 py-2 font-sans">乾燥樹幹 / 粗糙岩石</td>
                  <td className="px-3 py-2 text-red-700 font-bold">28 – 15%</td>
                  <td className="px-3 py-2 text-red-800">28 – 15 kgf</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-red-500">0.60 +</td>
                  <td className="px-3 py-2 font-sans">濕草、苔蘚、極粗糙表面</td>
                  <td className="px-3 py-2 text-red-500 font-bold">≤ 15%</td>
                  <td className="px-3 py-2 text-red-500">≤ 15 kgf</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 包覆角影響：以 μ=0.3 為例 */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-100/60 text-slate-800 font-bold text-sm">
            🔁 包覆角影響（以 μ = 0.3 為例）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left border-b border-slate-200">包覆角</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">情境</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">計算</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">效率</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2">90°</td>
                  <td className="px-3 py-2 font-sans">半圈轉折、輕微變向</td>
                  <td className="px-3 py-2 text-slate-600">e^(−0.3·π/2)</td>
                  <td className="px-3 py-2 text-yellow-800 font-bold">62%</td>
                </tr>
                <tr className="border-b border-slate-200/60 bg-slate-50/40">
                  <td className="px-3 py-2 text-orange-800 font-bold">180°</td>
                  <td className="px-3 py-2 font-sans">完整變向（最常見）</td>
                  <td className="px-3 py-2 text-slate-600">e^(−0.3·π)</td>
                  <td className="px-3 py-2 text-orange-800 font-bold">39%</td>
                </tr>
                <tr className="border-b border-slate-200/60">
                  <td className="px-3 py-2">270°</td>
                  <td className="px-3 py-2 font-sans">繞 3/4 圈</td>
                  <td className="px-3 py-2 text-slate-600">e^(−0.3·3π/2)</td>
                  <td className="px-3 py-2 text-red-800 font-bold">24%</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">360°</td>
                  <td className="px-3 py-2 font-sans">完整一圈（鎖定/制動用）</td>
                  <td className="px-3 py-2 text-slate-600">e^(−0.3·2π)</td>
                  <td className="px-3 py-2 text-red-700 font-bold">15%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 實務影響：3:1 倍力系統範例 */}
        <div className="bg-red-950/30 rounded-lg p-4 border border-red-900/50">
          <div className="text-red-800 font-bold text-sm mb-2">⚠ 實務影響：3:1 倍力系統</div>
          <div className="text-xs text-slate-700 leading-relaxed space-y-1">
            <div>• 理論：100 kg 載重只需出 33 kg（省力 3 倍）</div>
            <div>• 用 μ = 0.3 的「滑輪」（兩個轉折點）：實效倍率僅約 <strong className="text-red-700">1.49:1</strong>，需出 <strong className="text-red-700">67 kg</strong></div>
            <div>• 效率損失 50%，<strong className="text-red-700">倍力系統幾乎失效</strong></div>
            <div className="text-emerald-800 mt-2">
              ✓ NFPA / IRATA 教材強調：救援拖拉系統<strong>必須使用真正的軸承滑輪</strong>，鉤環或樹枝代替會讓系統失去意義
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ========================================================================
// 模組 2：Highline 索道張力 — 兩端可拖曳 + 相機 AR 疊圖 + 格線
// ========================================================================
function HighlineModule() {
  const W = 800, H = 480;
  const [load_kgf, setLoad] = useState(100);
  const load_kN = (load_kgf * G) / 1000;

  // 兩個錨點與負載皆可拖曳
  const [anchorL, setAnchorL] = useState({ x: W * 0.15, y: H * 0.20 });
  const [anchorR, setAnchorR] = useState({ x: W * 0.85, y: H * 0.20 });
  const [loadPos, setLoadPos] = useState({ x: W * 0.50, y: H * 0.55 });

  // 相機 / 格線 / 全螢幕 / 截圖
  const [cameraOn, setCameraOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [shotMsg, setShotMsg] = useState('');
  const videoRef = useRef(null);
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const takeScreenshot = useCallback(async () => {
    const ok = await captureSVGWithVideo(svgRef.current, videoRef.current, W, H,
      `highline_${Date.now()}.png`);
    setShotMsg(ok ? '✓ 截圖已儲存' : '✗ 截圖失敗');
    setTimeout(() => setShotMsg(''), 2000);
  }, [W, H]);

  useEffect(() => {
    let stream = null;
    if (cameraOn) {
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
          setCameraError('');
        })
        .catch(err => {
          setCameraError('無法存取相機：' + (err.message || err.name) + '（需 HTTPS 或 localhost）');
          setCameraOn(false);
        });
    }
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cameraOn]);

  // 力學計算（向量平衡）
  const data = useMemo(() => {
    // 從 load 指向兩個錨點的向量（張力沿此方向作用於 load）
    const dxL = anchorL.x - loadPos.x, dyL = anchorL.y - loadPos.y;
    const dxR = anchorR.x - loadPos.x, dyR = anchorR.y - loadPos.y;
    const lenL = Math.hypot(dxL, dyL) || 1;
    const lenR = Math.hypot(dxR, dyR) || 1;
    const uL = { x: dxL / lenL, y: dyL / lenL };
    const uR = { x: dxR / lenR, y: dyR / lenR };

    // 解線性系統：T_L·uL + T_R·uR + (0, +W) = 0
    const det = uL.x * uR.y - uR.x * uL.y;
    let T_L_kN = 0, T_R_kN = 0;
    if (Math.abs(det) > 1e-6) {
      T_L_kN = ( 0 * uR.y - uR.x * (-load_kN)) / det;
      T_R_kN = (uL.x * (-load_kN) - 0 * uL.y) / det;
    }

    // 角度（從水平線量起，正值代表錨點高於 load）
    const thetaL_deg = toDeg(Math.atan2(-dyL, Math.abs(dxL)));
    const thetaR_deg = toDeg(Math.atan2(-dyR, Math.abs(dxR)));

    // 兩繩之間的夾角（在 load 點上量測）= 兩錨點間的中央夾角
    const cosInner = clamp(uL.x * uR.x + uL.y * uR.y, -1, 1);
    const innerAngle_deg = toDeg(Math.acos(cosInner));

    // 偏離量（負載相對兩錨點中心的水平偏移，pixel）
    const centerX = (anchorL.x + anchorR.x) / 2;
    const offset_px = loadPos.x - centerX;
    const span_px = Math.abs(anchorR.x - anchorL.x) || 1;
    const offsetRatio = offset_px / span_px; // 正值 = 偏右

    // 偏離點所需控制拉力（水平）：假設單繩等張力情境，
    // 解 T(uL+uR) + (0, +W) = (F_h, 0)
    //   垂直：T(uL.y + uR.y) + W = 0  → T = -W / (uL.y + uR.y)
    //   水平：F_h = -T·(uL.x + uR.x)  （外加力與繩拉力方向相反）
    const sumY = uL.y + uR.y;
    let F_h_kN = 0, T_uniform_kN = 0;
    if (sumY < -1e-3) {
      T_uniform_kN = -load_kN / sumY;
      F_h_kN = -T_uniform_kN * (uL.x + uR.x);
    }

    return {
      T_L_kN, T_R_kN, uL, uR, thetaL_deg, thetaR_deg, lenL, lenR,
      innerAngle_deg, offset_px, offsetRatio, F_h_kN, centerX,
    };
  }, [anchorL, anchorR, loadPos, load_kN]);

  // 拖曳處理
  const onMove = useCallback((e) => {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = svgPointer(e);
    const sx = clamp(pos.x,16,W-16), sy = clamp(pos.y,16,H-16);
    if (drag === 'L') setAnchorL({ x: sx, y: sy });
    if (drag === 'R') setAnchorR({ x: sx, y: sy });
    if (drag === 'W') setLoadPos({ x: sx, y: sy });
  }, [drag]);

  // 安全評估（取兩側較大值）
  const maxT_kN = Math.max(Math.abs(data.T_L_kN), Math.abs(data.T_R_kN));
  const human = evalHuman(maxT_kN);
  const minTheta = Math.min(data.thetaL_deg, data.thetaR_deg);
  const lowAngle = minTheta < 5 && minTheta >= 0;
  const invalid = data.T_L_kN < 0 || data.T_R_kN < 0; // 負張力 = 無解（錨點低於負載）

  // 格線間距
  const GRID = 40;

  const [undo,setUndo]=useState(null);
  const reset=()=>{setUndo({anchorL,anchorR,loadPos,load_kgf});setAnchorL({x:120,y:96});setAnchorR({x:680,y:96});setLoadPos({x:400,y:264});setLoad(100);};
  const symmetric=a=>{setAnchorL({x:120,y:96});setAnchorR({x:680,y:96});setLoadPos({x:400,y:96+280*Math.tan(toRad(a))});};
  const singular=Math.abs(data.uL.x*data.uR.y-data.uR.x*data.uL.y)<1e-6;
  const noSolution=invalid||singular||data.thetaL_deg<=0||data.thetaR_deg<=0;
  return <div className="quick-module">
    <ModuleTitle number="2" title="索道張力" hint="調整載重或拖曳三點，立即查看兩側張力。" />
    {(lowAngle||noSolution)&&<div className="warning" role="status">{noSolution?'幾何無效：請讓負載位於兩錨點之間及下方。':'注意：至少一側下垂角小於 5°。'}</div>}
    <QuickDiagram W={W} H={H}
      labels={[{label:'左側張力',value:noSolution?'—':fmt(kNtoKgf(data.T_L_kN),0),point:{x:(anchorL.x+loadPos.x)/2,y:(anchorL.y+loadPos.y)/2}},{label:'右側張力',value:noSolution?'—':fmt(kNtoKgf(data.T_R_kN),0),point:{x:(anchorR.x+loadPos.x)/2,y:(anchorR.y+loadPos.y)/2}},{label:'負載 W',value:load_kgf,point:loadPos,color:'#92400e',offsets:[[0,110],[-180,70],[180,70],[0,-120]]}]}
      metrics={[`左 θ ${fmt(data.thetaL_deg)}°`,`右 θ ${fmt(data.thetaR_deg)}°`,`∠ ${fmt(data.innerAngle_deg)}°`]}
      dock={[{label:'左側張力',value:noSolution?'—':fmt(kNtoKgf(data.T_L_kN),0)},{label:'右側張力',value:noSolution?'—':fmt(kNtoKgf(data.T_R_kN),0)}]}
      points={[{id:'L',label:'左錨點',point:anchorL,set:setAnchorL},{id:'R',label:'右錨點',point:anchorR,set:setAnchorR},{id:'W',label:'負載',point:loadPos,set:setLoadPos,color:'#b45309'}]} lines={[{a:anchorL,b:loadPos},{a:loadPos,b:anchorR}]} onMove={onMove} onEnd={()=>setDrag(null)} onStart={setDrag} svgRef={svgRef} videoRef={videoRef} cameraOn={cameraOn} showGrid={showGrid} fullscreen={fullscreen} setFullscreen={setFullscreen}
      tools={<><button aria-pressed={cameraOn} onClick={()=>setCameraOn(!cameraOn)}>{cameraOn?'關閉相機':'相機疊圖'}</button><label><input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)}/>顯示格線</label><button onClick={takeScreenshot}>儲存圖形</button><button onClick={reset}>重置</button>{undo&&<button onClick={()=>{setAnchorL(undo.anchorL);setAnchorR(undo.anchorR);setLoadPos(undo.loadPos);setLoad(undo.load_kgf);setUndo(null);}}>復原重置</button>}<span role="status">{shotMsg}</span></>}/>
    {cameraError&&<p className="warning">{cameraError}</p>}
    <div className="input-panel"><Slider label="載重 W" value={load_kgf} min={50} max={500} step={10} unit="kgf" onChange={setLoad}/><div className="preset-label">對稱下垂角</div><div className="preset-row">{[10,15,30,45].map(a=><button key={a} onClick={()=>symmetric(a)}>{a}°</button>)}</div></div>
    <PointFields W={W} H={H} points={[{id:'L',label:'左錨點 L',point:anchorL,set:setAnchorL},{id:'R',label:'右錨點 R',point:anchorR,set:setAnchorR},{id:'W',label:'負載 W',point:loadPos,set:setLoadPos}]}/>
    <Reference><p>對稱情境：T = W / (2 sin θ)。左右不對稱時，沿用原有向量平衡計算。</p><p>下垂角從水平線量起。位置欄位是圖面百分比，並非現場距離。等張力假設下的水平控制拉力：{noSolution?'—':fmt(kNtoKgf(Math.abs(data.F_h_kN)),0)} kgf。</p></Reference>
  </div>;
}

// ========================================================================
// 模組 3：墜落衝擊力 — 修 useEffect bug、加繩拉伸動畫、人體分級警告
// ========================================================================
function FallImpactModule() {
  const [mass, setMass] = useState(80);
  const [ropeLength, setRopeLength] = useState(10);
  const [fallDistance, setFallDistance] = useState(5);
  const [k_kgf, setK_kgf] = useState(4080);      // 繩索動態剛度（kgf）
  const k_kN = (k_kgf * G) / 1000;

  // FIX: 只依 ropeLength，使用 Math.min
  useEffect(() => {
    setFallDistance(prev => Math.min(prev, ropeLength * 2));
  }, [ropeLength]);

  const fallFactor = fallDistance / ropeLength;
  const mg_kN = (mass * G) / 1000;
  const impact_kN = mg_kN + Math.sqrt(mg_kN * mg_kN + 2 * k_kN * mg_kN * fallFactor);
  const human = evalHuman(impact_kN);

  // 觸發動畫的 key
  const [animKey, setAnimKey] = useState(0);
  const [showFlash, setShowFlash] = useState(false);
  useEffect(() => {
    setAnimKey(k => k + 1);
    setShowFlash(true);
    const t = setTimeout(() => setShowFlash(false), 500);
    return () => clearTimeout(t);
  }, [fallFactor, mass, k_kgf]);

  // 視覺定位
  const startY = fallFactor <= 1 ? 60 : 60 - (fallFactor - 1) * 30;
  const targetY = fallFactor <= 1 ? 100 + fallFactor * 50 : 150 + (fallFactor - 1) * 30;

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">3. 墜落衝擊力 — UIAA Fall Factor</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            墜落係數 FF = 墜落距離 / 有效繩長。最大 FF=2（先鋒墜落）。
            公式：<code className="text-blue-800 bg-slate-100 px-1 rounded">F = mg + √(mg² + 2·k·mg·FF)</code>
          </p>
          <p className="text-xs text-slate-600 mt-2">
            人體門檻：&lt;408 kgf 安全 · &lt;612 kgf UIAA 上限 · &lt;816 kgf OSHA · &lt;1224 kgf 重傷 · ≥1224 kgf 致命
          </p>
        </div>
        <div className="space-y-4 bg-slate-100/50 p-5 rounded-xl">
          <Slider label="體重 (m)" value={mass} min={50} max={120} step={1} unit="kg" onChange={setMass} />
          <Slider label="有效繩長 (L)" value={ropeLength} min={1} max={50} step={1} unit="m" onChange={setRopeLength} />
          <Slider label="墜落距離 (h)" value={fallDistance} min={0.1} max={ropeLength * 2} step={0.1} unit="m" onChange={setFallDistance} />
          <Slider label="繩索動態剛度 k" value={k_kgf} min={2000} max={12000} step={100} unit="kgf" onChange={setK_kgf}
            hint="UIAA 動態繩典型 2500–4100 kgf · 靜力繩 8200–12200 kgf" />
        </div>
      </div>

      <div className="space-y-4 flex flex-col">
        <div className="grid grid-cols-2 gap-4">
          <NumberCard title="墜落係數 FF" value={fmt(fallFactor,2)} unit=""
            colorClass={fallFactor>=2 ? 'text-red-500 font-bold' : fallFactor>1 ? 'text-orange-800' : fallFactor>0.5 ? 'text-amber-800' : 'text-green-800'} />
          <ForceCard title="衝擊力" kN={impact_kN}
            colorClass={human.color + (impact_kN > 6 ? ' pulse-red' : '')}
            description={impact_kN > 6 ? `⚠ ${human.label}（>612 kgf）` : human.label} accent={impact_kN > 8} />
        </div>
        <div className="flex-1 bg-white rounded-xl border border-slate-200 flex items-center justify-center p-4 relative overflow-hidden min-h-[260px]">
          {showFlash && impact_kN > 6 && (
            <div className="absolute inset-0 bg-red-500/30 flash-impact pointer-events-none" />
          )}
          <svg viewBox="0 0 200 280" className="w-full h-full max-h-64">
            <circle cx="100" cy="50" r="6" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="2" />
            <text x="110" y="55" fill="#94a3b8" fontSize="10">固定點</text>

            {/* 繩索：FF≤1 直墜，FF&gt;1 上方有起跌段 */}
            {fallFactor <= 1 ? (
              <line key={`r-${animKey}`} x1="100" y1="50" x2="100" y2={targetY}
                stroke="#f59e0b" strokeWidth="2.5">
                <animate attributeName="y2" from={startY} to={targetY} dur="0.5s" fill="freeze" />
                <animate attributeName="strokeWidth" values="2.5;4;2.5" dur="0.4s" begin="0.5s" />
              </line>
            ) : (
              <>
                <line x1="100" y1="50" x2="100" y2="20" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3" />
                <text x="105" y="18" fill="#94a3b8" fontSize="10">起跌點</text>
                <path key={`r-${animKey}`} d={`M 100 50 Q 130 80 130 ${targetY}`}
                  fill="none" stroke="#f59e0b" strokeWidth="2.5">
                  <animate attributeName="d"
                    from={`M 100 50 Q 130 80 130 ${startY}`}
                    to={`M 100 50 Q 130 80 130 ${targetY}`}
                    dur="0.5s" fill="freeze" />
                </path>
              </>
            )}

            <circle key={`c-${animKey}`}
              cx={fallFactor <= 1 ? 100 : 130} cy={targetY} r="9"
              fill={impact_kN > 8 ? '#ef4444' : impact_kN > 6 ? '#f97316' : impact_kN > 4 ? '#eab308' : '#22c55e'}>
              <animate attributeName="cy"
                values={`${startY}; ${targetY+8}; ${targetY-2}; ${targetY}`}
                keyTimes="0; 0.7; 0.85; 1" dur="0.7s"
                calcMode="spline"
                keySplines="0.42 0 1 1; 0 0 0.58 1; 0 0 0.58 1"
                fill="freeze" />
            </circle>

            <text x="100" y="270" fill="#64748b" fontSize="9" textAnchor="middle">動態模擬：繩索拉伸 → 反彈</text>
          </svg>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// 模組 4：死亡三角 — 加力向量分解動畫
// ========================================================================
function DeathTriangleModule() {
  const [load_kgf, setLoad] = useState(100);
  const [angle, setAngle] = useState(60);

  const load_kN = (load_kgf * G) / 1000;
  const t = toRad(angle);
  // 標準 V 型：每邊 W / (2 cos(θ/2))
  const vRig_kN = load_kN / (2 * Math.cos(t / 2));
  // 死亡三角（封閉）：每邊承受向下分量 + 水平擠壓分量
  // 向量推導：每側張力 = sqrt( (W/(2cos))² + (W·sin/(2cos))² ... ) — 採用較教學版公式
  const dt_kN = load_kN * Math.sqrt(1 + Math.pow(Math.tan(t / 2), 2)) / (2 * Math.cos(t / 2));

  // SVG 動態
  const dy = 70;
  const dx = dy * Math.tan(t / 2);
  const midX = 150;
  const aL = midX - dx, aR = midX + dx;
  const minX = Math.min(0, aL - 30);
  const maxX = Math.max(300, aR + 30);
  const vBoxW = maxX - minX;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">4. 死亡三角 — Death Triangle</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              扁帶連接兩個固定點且<strong className="text-red-700">未打結（封閉三角）</strong>時，
              水平方向的擠壓分量會放大固定點負載。安全做法：使用流動分力環或打孤狼結。
            </p>
          </div>
          <div className="space-y-4 bg-slate-100/50 p-5 rounded-xl">
            <Slider label="載重 (W)" value={load_kgf} min={50} max={500} step={10} unit="kgf" onChange={setLoad} />
            <Slider label="夾角 (θ)" value={angle} min={10} max={160} step={5} unit="°" onChange={setAngle} />
          </div>
        </div>

        <div className="space-y-4 flex flex-col">
          <div className="grid grid-cols-2 gap-4">
            <ForceCard title="V 型 (單點張力)" kN={vRig_kN}
              colorClass={vRig_kN > load_kN ? 'text-amber-800' : 'text-green-800'}
              description={`${fmt((vRig_kN/load_kN)*100,0)}% 載重`} />
            <ForceCard title="死亡三角 (合力)" kN={dt_kN} colorClass="text-red-500"
              description={`${fmt((dt_kN/load_kN)*100,0)}% 載重`} accent />
          </div>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl border border-slate-200 flex flex-col items-center p-3 overflow-hidden">
              <span className="text-xs text-green-800 mb-1 font-bold">✓ 標準 V 型架設</span>
              <svg viewBox={`${minX} 0 ${vBoxW} 170`} className="w-full h-full">
                <circle cx={aL} cy="40" r="4" fill="#cbd5e1" />
                <circle cx={aR} cy="40" r="4" fill="#cbd5e1" />
                <path d={`M ${aL} 40 L ${midX} 110 L ${aR} 40`} fill="none" stroke="#22c55e" strokeWidth="2.5" />
                <circle cx={midX} cy="110" r="6" fill="#3b82f6" />
                <line x1={midX} y1="110" x2={midX} y2="150" stroke="#ef4444" strokeWidth="3" />
                <text x={midX+8} y="148" fill="#ef4444" fontSize="11">{load_kgf}kgf</text>
                <line x1={aL} y1="40" x2={aL - 18} y2="22" stroke="#22c55e" strokeWidth="2" />
                <text x={aL - 50} y="18" fill="#22c55e" fontSize="11" fontWeight="bold">{fmt(kNtoKgf(vRig_kN),0)}</text>
                <line x1={aR} y1="40" x2={aR + 18} y2="22" stroke="#22c55e" strokeWidth="2" />
                <text x={aR + 22} y="18" fill="#22c55e" fontSize="11" fontWeight="bold">{fmt(kNtoKgf(vRig_kN),0)}</text>
              </svg>
            </div>

            <div className="bg-white rounded-xl border border-red-900/50 flex flex-col items-center p-3 relative overflow-hidden">
              <span className="text-xs text-red-700 mb-1 font-bold">✗ 危險：死亡三角</span>
              <svg viewBox={`${minX} 0 ${vBoxW} 170`} className="w-full h-full">
                <circle cx={aL} cy="40" r="4" fill="#cbd5e1" />
                <circle cx={aR} cy="40" r="4" fill="#cbd5e1" />
                <path d={`M ${aL} 40 L ${aR} 40 L ${midX} 110 Z`} fill="rgba(239,68,68,0.08)" stroke="#ef4444" strokeWidth="2.5" />
                <circle cx={midX} cy="110" r="6" fill="#3b82f6" />
                <line x1={midX} y1="110" x2={midX} y2="150" stroke="#ef4444" strokeWidth="3" />
                <line x1={aL} y1="40" x2={aL + 25} y2="40" stroke="#ef4444" strokeWidth="2" markerEnd="url(#arrL)" />
                <line x1={aR} y1="40" x2={aR - 25} y2="40" stroke="#ef4444" strokeWidth="2" markerEnd="url(#arrR)" />
                <defs>
                  <marker id="arrL" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0 0, 6 3, 0 6" fill="#ef4444" /></marker>
                  <marker id="arrR" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0 0, 6 3, 0 6" fill="#ef4444" /></marker>
                </defs>
                <text x={aL - 50} y="35" fill="#ef4444" fontSize="11" fontWeight="bold">{fmt(kNtoKgf(dt_kN),0)}</text>
                <text x={aR + 22} y="35" fill="#ef4444" fontSize="11" fontWeight="bold">{fmt(kNtoKgf(dt_kN),0)}</text>
              </svg>
            </div>
          </div>
        </div>
      </div>

      <CollapsibleSection
        className="bg-gradient-to-br from-amber-950/30 to-slate-900 border-amber-800/40"
        badge={<div className="bg-red-600 text-white px-2 py-1 rounded text-xs font-bold flex items-center gap-1">▶ YouTube</div>}
        title="進階解讀：「美國死亡三角是個迷思」"
        subtitle={<>來源：HowNot2 — <span className="font-mono">American Death Triangle is a Myth</span></>}
        action={
          <a href="https://www.youtube.com/watch?v=7sQNpjnJe40" target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors no-print">
            觀看影片 ↗
          </a>
        }>

        <div className="text-sm text-slate-700 leading-relaxed space-y-3">
          <p>
            HowNot2 透過實際測試挑戰了傳統教科書對死亡三角的描述，提出三個重要觀點：
          </p>

          <div className="bg-white/60 rounded-lg p-4 space-y-2 border border-slate-200">
            <div className="flex items-baseline gap-2">
              <span className="text-amber-800 font-bold text-xs shrink-0">論點 1</span>
              <div>
                <div className="text-slate-800 font-medium">力的放大被誇大了</div>
                <div className="text-xs text-slate-600 mt-1">
                  在等邊（60°）與較窄的 40° 配置下，每個固定點承受的力大約是
                  下方總力的 <strong className="text-amber-800">70%</strong>，
                  並非外界傳言的「成倍放大」。除非夾角極寬（&gt; 120°），力才會明顯超過 100%。
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/60 rounded-lg p-4 space-y-2 border border-slate-200">
            <div className="flex items-baseline gap-2">
              <span className="text-amber-800 font-bold text-xs shrink-0">論點 2</span>
              <div>
                <div className="text-slate-800 font-medium">關鍵在於夾角控制</div>
                <div className="text-xs text-slate-600 mt-1">
                  夾角是真正決定力量大小的關鍵：
                  <span className="font-mono text-orange-800">170°</span> 時就達到 5 倍力，
                  <span className="font-mono text-red-700">180°</span> 時力會趨近無限大。
                  維持銳角（&lt; 90°）就能避開最危險的力學區域。
                </div>
              </div>
            </div>
          </div>

          <div className="bg-red-950/40 rounded-lg p-4 space-y-2 border border-red-900/50">
            <div className="flex items-baseline gap-2">
              <span className="text-red-700 font-bold text-xs shrink-0">論點 3</span>
              <div>
                <div className="text-red-800 font-bold">真正的「死亡」來自缺乏冗餘，不是力的放大</div>
                <div className="text-xs text-slate-700 mt-1">
                  整個系統只靠<strong className="text-red-700">一條扁帶</strong>串連兩個固定點，
                  一旦這條扁帶任何一處磨損、切割或結點失效，<strong>整個系統瞬間崩潰</strong>，
                  沒有任何備援。這才是死亡三角真正致命的原因，也是它應該被避免的根本理由。
                </div>
              </div>
            </div>
          </div>

          <div className="bg-emerald-950/30 rounded-lg p-4 border border-emerald-900/50">
            <div className="text-emerald-800 font-bold text-sm mb-1">📌 重點結論</div>
            <div className="text-xs text-slate-700 leading-relaxed">
              死亡三角並非「不能用」，但因為<strong className="text-emerald-800">缺乏冗餘</strong>，
              在生命安全應用（救援、攀登、高空作業）中應堅守 NFPA / SPRAT 慣例：
              使用<strong>分力環（Quad / W 系統）</strong>或<strong>單獨打結的雙腿系統</strong>，
              讓任一環節失效時其他環節仍能承載。
            </div>
          </div>
        </div>

        <div className="text-[10px] text-slate-600 border-t border-slate-200 pt-2">
          來源：<a href="https://www.youtube.com/watch?v=7sQNpjnJe40" target="_blank" rel="noopener noreferrer"
            className="text-amber-800 hover:underline">HowNot2 — American Death Triangle is a Myth (YouTube)</a>
          {' · '}
          <a href="https://www.hownot2.com/post/american-death-triangle-is-a-myth" target="_blank" rel="noopener noreferrer"
            className="text-amber-800 hover:underline">HowNot2 部落格全文</a>
          {' · '}
          <a href="https://en.wikipedia.org/wiki/American_death_triangle" target="_blank" rel="noopener noreferrer"
            className="text-amber-800 hover:underline">Wikipedia</a>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ========================================================================
// 模組 5：變向固定點
// ========================================================================
function DirectionalAnchorModule() {
  const [tension_kgf, setTension] = useState(100);
  const [angle, setAngle] = useState(90);

  const tension_kN = (tension_kgf * G) / 1000;
  const angleRad = toRad(angle);
  const anchor_kN = 2 * tension_kN * Math.cos(angleRad / 2);

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">5. 變向固定點 / 滑輪</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            滑輪/鉤環變向時，固定點承受兩端張力的向量和。夾角越小（U 型迴轉），力越大（最高 2 倍）。
            公式：<code className="text-blue-800 bg-slate-100 px-1 rounded">F = 2T × cos(θ/2)</code>
          </p>
        </div>
        <div className="space-y-4 bg-slate-100/50 p-5 rounded-xl">
          <Slider label="繩索張力 (T)" value={tension_kgf} min={50} max={500} step={10} unit="kgf" onChange={setTension} />
          <Slider label="繩索夾角 (θ)" value={angle} min={0} max={180} step={5} unit="°" onChange={setAngle} />
        </div>
      </div>

      <div className="space-y-4 flex flex-col">
        <div className="grid grid-cols-2 gap-3">
          <ForceCard title="變向固定點合力 F" kN={anchor_kN}
            colorClass={anchor_kN > tension_kN * 1.5 ? 'text-red-700' : 'text-blue-800'}
            description={`為單邊張力的 ${fmt(anchor_kN/tension_kN,2)} 倍`} />
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-center text-center">
            <div className="text-slate-600 text-xs mb-1 uppercase tracking-wider">F = 2T·cos(θ/2)</div>
            <div className="text-base font-mono text-slate-700 count-up" key={angle}>
              2 × {tension_kgf} × cos({angle/2}°)
            </div>
            <div className="text-emerald-800 text-xs mt-2">
              {angle === 0 ? '⚠ U型迴轉：F = 2T（最大）' :
               angle === 120 ? '✓ 120°黃金角：F = T（等張力）' :
               angle === 180 ? '水平展開：F = 0（無垂直分量）' :
               `F / T = ${fmt(anchor_kN/tension_kN,2)}`}
            </div>
          </div>
        </div>
        <div className="flex-1 bg-white rounded-xl border border-slate-200 flex items-center justify-center p-4 min-h-[280px]">
          <svg viewBox="0 0 260 300" className="w-full h-full max-h-80">
            {/* 固定錨結構（樑/天花板） */}
            <rect x="40" y="10" width="180" height="14" fill="#334155" stroke="#1e293b" strokeWidth="1" />
            <line x1="50" y1="24" x2="40" y2="32" stroke="#475569" strokeWidth="1" />
            <line x1="80" y1="24" x2="70" y2="32" stroke="#475569" strokeWidth="1" />
            <line x1="160" y1="24" x2="150" y2="32" stroke="#475569" strokeWidth="1" />
            <line x1="200" y1="24" x2="190" y2="32" stroke="#475569" strokeWidth="1" />
            {/* 連接到變向點 */}
            <line x1="130" y1="24" x2="130" y2="80" stroke="#64748b" strokeWidth="3" />

            {/* 重力方向指示 */}
            <line x1="16" y1="18" x2="16" y2="50" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3,2" />
            <polygon points="12,46 20,46 16,54" fill="#94a3b8" />
            <text x="7" y="66" fontSize="8" fill="#64748b" fontWeight="bold" textAnchor="middle">g↓</text>

            {/* 變向鉤環（中心點 130,90） */}
            <circle cx="130" cy="90" r="12" fill="#cbd5e1" stroke="#475569" strokeWidth="3" />
            <circle cx="130" cy="90" r="6" fill="#0f172a" />

            {(() => {
              const a = (angle / 2) * Math.PI / 180;
              const len = 110;
              const cx = 130, cy = 90;
              // 最小間距：θ<5° 時強制分開一點以便視覺辨識
              const aVis = Math.max(a, angle < 5 ? 0.05 : 0);
              const x1 = cx - len * Math.sin(aVis), y1 = cy + len * Math.cos(aVis);
              const x2 = cx + len * Math.sin(aVis), y2 = cy + len * Math.cos(aVis);
              const arrowLen = Math.min(60, Math.max(18, anchor_kN * 7));
              return (<>
                {/* 垂直基準線（虛線，重力方向） */}
                <line x1={cx} y1={cy + 16} x2={cx} y2={cy + len + 8}
                  stroke="#1e40af" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />

                {/* 兩條繩索（向下） */}
                <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#f59e0b" strokeWidth="3.5" />
                <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="3.5" />

                {/* 角度弧（θ：兩繩夾角） */}
                {angle >= 5 && (
                  <path d={`M ${cx - 30 * Math.sin(a)} ${cy + 30 * Math.cos(a)} A 30 30 0 0 0 ${cx + 30 * Math.sin(a)} ${cy + 30 * Math.cos(a)}`}
                    fill="none" stroke="#94a3b8" strokeWidth="1.5" />
                )}
                <text x={cx} y={cy + 48} textAnchor="middle" fontSize="11" fill="#94a3b8" fontWeight="bold">θ = {angle}°</text>

                {/* 左端：重物（負載） */}
                <line x1={x1} y1={y1} x2={x1} y2={y1 + 8} stroke="#f59e0b" strokeWidth="3" />
                <rect x={x1 - 18} y={y1 + 8} width="36" height="32" rx="4" fill="#64748b" stroke="#334155" strokeWidth="2" />
                <text x={x1} y={y1 + 22} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#ffffff">{tension_kgf}</text>
                <text x={x1} y={y1 + 33} textAnchor="middle" fontSize="8" fill="#cbd5e1">kgf</text>
                {/* 重力箭頭（重力朝下） */}
                <line x1={x1} y1={y1 + 42} x2={x1} y2={y1 + 56} stroke="#dc2626" strokeWidth="2" />
                <polygon points={`${x1-4},${y1+52} ${x1+4},${y1+52} ${x1},${y1+60}`} fill="#dc2626" />
                <text x={x1} y={y1 + 72} textAnchor="middle" fontSize="8" fill="#dc2626">W↓</text>

                {/* 右端：操作端拉力 */}
                <line x1={x2} y1={y2} x2={x2} y2={y2 + 8} stroke="#f59e0b" strokeWidth="3" />
                <circle cx={x2} cy={y2 + 22} r="12" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="2" />
                <text x={x2} y={y2 + 26} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#ffffff">P</text>
                <text x={x2} y={y2 + 50} textAnchor="middle" fontSize="9" fill="#3b82f6" fontWeight="bold">{tension_kgf} kgf</text>

                {/* 張力 T 標籤 */}
                {angle >= 10 && <>
                  <text x={(cx + x1) / 2 - 26} y={(cy + y1) / 2 - 2} fontSize="10" fill="#f59e0b" fontWeight="bold">T</text>
                  <text x={(cx + x2) / 2 + 10} y={(cy + y2) / 2 - 2} fontSize="10" fill="#f59e0b" fontWeight="bold">T</text>
                </>}

                {/* 合力 F（向上箭頭，錨點反力） */}
                <line x1={cx} y1={cy} x2={cx} y2={cy - arrowLen} stroke="#ef4444" strokeWidth="4" />
                <polygon points={`${cx-5},${cy-arrowLen+6} ${cx+5},${cy-arrowLen+6} ${cx},${cy-arrowLen-4}`} fill="#ef4444" />
                <rect x={cx + 8} y={cy - arrowLen - 8} width="90" height="22" rx="4" fill="#fef2f2" stroke="#ef4444" />
                <text x={cx + 14} y={cy - arrowLen + 7} fontSize="12" fill="#b91c1c" fontWeight="bold" fontFamily="monospace">
                  F = {fmt(kNtoKgf(anchor_kN), 0)} kgf
                </text>
                {/* F 說明：錨點需承受的向上反力 */}
                <text x={cx} y={cy - arrowLen - 14} textAnchor="middle" fontSize="8" fill="#f87171">錨點反力↑</text>
              </>);
            })()}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// 模組 6：固定點與拉力夾角模擬器（保留拖曳，加無障礙與磁吸）
// ========================================================================
function capstanGain(mu, theta) { return Math.exp(mu * theta); }

function AnchorPullAngleModule() {
  // 畫布尺寸固定，不可調整
  const W = 780, H = 520;
  const massKg = 100;
  const T_L = (massKg * G) / 1000;

  // A（固定點）與 L（負載）位置鎖定 — 重力方向永遠向下
  const A = { x: W * 0.5, y: H * 0.30 };
  const L = { x: W * 0.5, y: H * 0.82 };   // L 永遠在 A 正下方
  const R_PULL = 200;                       // P 在以 A 為圓心、固定半徑的圓上移動

  // 拉力角度 α：從 A→L（向下）量起；正值 = P 在右側，負值 = P 在左側
  const [alphaDeg, setAlphaDeg] = useState(90);    // 預設 90°：P 水平向右
  const [mu, setMu] = useState(0.20);
  const [tight, setTight] = useState('P');
  const [dragging, setDragging] = useState(false);

  // P 由 α 推算（單位向量旋轉：A→L 為 (0,+1)，順時針旋轉 α 度）
  const alphaRad = toRad(alphaDeg);
  const P = {
    x: A.x + R_PULL * Math.sin(alphaRad),
    y: A.y + R_PULL * Math.cos(alphaRad),
  };

  // 拖曳 P：以滑鼠相對 A 的位置反推 α（限制 -180~180）
  const onMove = useCallback((e) => {
    if (!dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // 將像素座標還原到 viewBox 座標
    const {x:sx,y:sy} = svgPointer(e);
    const dx = sx - A.x;
    const dy = sy - A.y;
    // 從 +y（向下）方向量起的順時針角度
    let ang = toDeg(Math.atan2(dx, dy));
    if (ang > 180) ang -= 360;
    if (ang < -180) ang += 360;
    setAlphaDeg(ang);
  }, [dragging]);

  // 力學計算
  const data = useMemo(() => {
    const absAlpha = Math.abs(alphaDeg);
    const theta = toRad(absAlpha);
    const gain = capstanGain(mu, theta);
    const T_P = tight === 'P' ? T_L * gain : T_L / gain;

    // 兩端張力沿 A→L、A→P 拉動 A 端
    const uAL = { x: 0, y: 1 };
    const uAP = { x: Math.sin(alphaRad), y: Math.cos(alphaRad) };
    const Rx = T_L * uAL.x + T_P * uAP.x;
    const Ry = T_L * uAL.y + T_P * uAP.y;
    const Rmag = Math.hypot(Rx, Ry);
    return { absAlpha, gain, T_P, Rmag, Rx, Ry };
  }, [alphaDeg, mu, tight, T_L, alphaRad]);

  // 固定常用角度按鈕
  const presetAngles = [0, 30, 45, 60, 90, 120, 150, 180];

  const [fullscreen,setFullscreen]=useState(false);
  return <div className="quick-module"><ModuleTitle number="6" title="拉力夾角模擬" hint="負載固定為 100 kg。調整夾角與摩擦係數，即時查看固定點合力。"/>
    <QuickDiagram W={W} H={H} vbY={-80} vbH={640}
      labels={[{label:'固定點合力 R',value:fmt(kNtoKgf(data.Rmag),0),point:A},{label:'操作端拉力 P',value:fmt(kNtoKgf(data.T_P),0),point:P,color:'#065f46'},{label:'負載 L',value:100,unit:'kg',point:L,color:'#92400e'}]}
      metrics={[`α ${fmt(data.absAlpha)}°`,alphaDeg>=0?'右側':'左側',`增益 ${fmt(data.gain,2)} 倍`]}
      dock={[{label:'固定點合力 R',value:fmt(kNtoKgf(data.Rmag),0)},{label:'操作端拉力 P',value:fmt(kNtoKgf(data.T_P),0)}]} points={[{id:'A',label:'固定點',point:A,draggable:false},{id:'L',label:'負載 100 kg',point:L,draggable:false,color:'#b45309'},{id:'P',label:'拉力點',point:P,color:'#047857'}]} lines={[{a:A,b:L},{a:A,b:P,color:'#047857'}]} onMove={onMove} onStart={()=>setDragging(true)} onEnd={()=>setDragging(false)} fullscreen={fullscreen} setFullscreen={setFullscreen}
      extra={<circle cx={A.x} cy={A.y} r={R_PULL} fill="none" stroke="#94a3b8" strokeDasharray="6 8" strokeWidth="2"/>}/>
    <div className="input-panel"><Slider label="拉力夾角 α" ariaLabel="拉力夾角" value={Number(alphaDeg.toFixed(1))} min={-180} max={180} step={1} unit="°" onChange={setAlphaDeg}/>
      <div className="preset-row">{presetAngles.map(a=><button key={a} aria-pressed={Math.round(data.absAlpha)===a} onClick={()=>setAlphaDeg(alphaDeg<0?-a:a)}>{a}°</button>)}<button onClick={()=>setAlphaDeg(-alphaDeg)}>左右鏡像</button></div>
      <Slider label="摩擦係數 μ" value={mu} min={0} max={0.6} step={0.01} onChange={setMu}/>
      <div className="preset-label">緊邊選擇</div><div className="preset-row"><button aria-pressed={tight==='P'} onClick={()=>setTight('P')}>P 操作端緊邊</button><button aria-pressed={tight==='L'} onClick={()=>setTight('L')}>L 負載端緊邊</button></div>
    </div><Reference><p>固定點 A 與負載 L 鎖定；僅 P 點可拖曳。α 從 A→L 的向下方向量起，正值為右側、負值為左側。</p><p>沿用 Capstan 增益 e^(μθ) 修正操作端拉力，固定點合力為兩端張力的向量和。</p></Reference>
  </div>;
}

// ========================================================================
// 模組 7（新增）：機械倍力系統 MA System
// ========================================================================
function MAModule() {
  const [load_kgf, setLoad] = useState(100);
  const [ratio, setRatio] = useState(3);          // 1, 2, 3, 4, 5, 6, 7, 9
  const [efficiency, setEfficiency] = useState(0.9); // 滑輪效率（每段）

  // 理論輸入力 = 載重 / 倍率
  const load_kN = (load_kgf * G) / 1000;
  const idealInput_kN = load_kN / ratio;
  // 實際 = 理論 / 累積效率（簡化模型：每多一段乘上效率）
  const realRatio = (1 - Math.pow(efficiency, ratio)) / (1 - efficiency); // 級數和近似
  const realInput_kN = load_kN / realRatio;
  const lossPct = ((realInput_kN - idealInput_kN) / idealInput_kN) * 100;

  const presets = [
    { name: '1:1 直拉', ratio: 1 },
    { name: '2:1 滑輪', ratio: 2 },
    { name: '3:1 Z-rig', ratio: 3 },
    { name: '4:1', ratio: 4 },
    { name: '5:1 Compound', ratio: 5 },
    { name: '6:1', ratio: 6 },
    { name: '7:1', ratio: 7 },
    { name: '9:1', ratio: 9 },
  ];

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">7. 機械倍力系統 — Mechanical Advantage</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            倍力系統可大幅減少救援者出力，但每個滑輪都會損失 5–15%。
            公式（級數）：<code className="text-blue-800 bg-slate-100 px-1 rounded">η_total = (1−η^n) / (1−η)</code>
          </p>
        </div>

        <div className="space-y-4 bg-slate-100/50 p-5 rounded-xl">
          <Slider label="負載 (W)" value={load_kgf} min={50} max={500} step={10} unit="kgf" onChange={setLoad} />
          <div>
            <div className="text-sm font-medium text-slate-700 mb-2">倍率</div>
            <div className="grid grid-cols-4 gap-2">
              {presets.map(p => (
                <button key={p.ratio} onClick={() => setRatio(p.ratio)}
                  className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    ratio === p.ratio ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-600'}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <Slider label="滑輪效率 η" value={efficiency} min={0.7} max={1.0} step={0.01} unit="" onChange={setEfficiency}
            hint="高品質球軸承 0.95 · 一般滑輪 0.90 · 鉤環變向 0.70" />
        </div>

        {/* μ ↔ η 換算對照 */}
        <div className="bg-slate-100/40 border border-slate-300 rounded-xl p-3 text-xs space-y-1.5">
          <div className="text-slate-700 font-bold mb-1">📐 η ↔ μ 換算（180° 包覆角）</div>
          <div className="text-slate-600 leading-relaxed">
            滑輪效率與摩擦係數的關係：<code className="text-blue-800 bg-slate-50 px-1 rounded">η = e^(−μπ)</code>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 font-mono">
            <div className="text-slate-600">η = 0.95 ⇄ <span className="text-emerald-800">μ ≈ 0.016</span></div>
            <div className="text-slate-600">η = 0.90 ⇄ <span className="text-green-800">μ ≈ 0.034</span></div>
            <div className="text-slate-600">η = 0.85 ⇄ <span className="text-yellow-800">μ ≈ 0.052</span></div>
            <div className="text-slate-600">η = 0.70 ⇄ <span className="text-orange-800">μ ≈ 0.113</span></div>
            <div className="text-slate-600">η = 0.50 ⇄ <span className="text-red-800">μ ≈ 0.221</span></div>
            <div className="text-slate-600">η = 0.39 ⇄ <span className="text-red-700">μ ≈ 0.300</span></div>
          </div>
        </div>
      </div>

      <div className="space-y-4 flex flex-col">
        <div className="grid grid-cols-2 gap-4">
          <ForceCard title="理論輸入力" kN={idealInput_kN} colorClass="text-green-800" description={`載重 ÷ ${ratio}`} />
          <ForceCard title="實際輸入力" kN={realInput_kN} colorClass="text-amber-800" description={`效率損失 ${fmt(lossPct,0)}%`} />
        </div>
        <NumberCard title="實效倍率" value={fmt(realRatio,2)} unit=":1" colorClass="text-blue-800"
          description={`理論 ${ratio}:1 · 損失 ${fmt(lossPct,0)}%`} />
        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-600 space-y-1">
          <div className="text-slate-800 font-bold mb-2">救援操作備註：</div>
          <div>• Whistle Test：放手時系統會否危險？倍力系統需配備制動器（Prusik / 抓結）</div>
          <div>• Critical Point：分析全系統最弱環節，依 NFPA SWL 預估</div>
          <div>• 倍率越高 → 效率損失越大、繩索消耗越快、救援距離越短</div>
          <div>• 高倍率（5:1+）建議用 Compound 系統而非單純 Simple</div>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// 模組 8（新）：高轉折點受力分析（下方錨點 → 高處轉折 → 操作端）
// 樹枝、鉤環、滑輪等都適用
// ========================================================================
// 轉折物類型：每種類型有對應預設 μ 與可調範圍
const REDIRECT_TYPES = {
  tree:      { icon: '🌳', label: '樹幹',
               mu: 0.40, muMin: 0.20, muMax: 0.80, muStep: 0.05,
               hint: '乾燥樹皮 ≈0.30-0.45 · 粗糙樹皮 ≈0.50 · 濕滑 ≈0.20' },
  carabiner: { icon: '⛓', label: '鉤環',
               mu: 0.20, muMin: 0.10, muMax: 0.40, muStep: 0.05,
               hint: '拋光鋁製 ≈0.15 · 一般鉤環 ≈0.20 · 磨損/鋼製 ≈0.30' },
  pulley:    { icon: '⚙', label: '滑輪',
               mu: 0.05, muMin: 0.03, muMax: 0.15, muStep: 0.01,
               hint: '球軸承 ≈0.03-0.05 · 軸套式 ≈0.07 · 磨損滑輪 ≈0.10' },
};

function RedirectAnalysisModule() {
  const W = 800, H = 480;

  // 三個可拖曳點：下方錨點 A、高處轉折點 R、操作端 O
  const [anchor, setAnchor] = useState({ x: W * 0.20, y: H * 0.78 });
  const [redirect, setRedirect] = useState({ x: W * 0.50, y: H * 0.18 });
  const [operator, setOperator] = useState({ x: W * 0.80, y: H * 0.78 });

  const [load_kgf, setLoad] = useState(100);
  const [pulleyType, setPulleyType] = useState('carabiner'); // 'tree' | 'carabiner' | 'pulley'
  const [mu, setMu] = useState(REDIRECT_TYPES['carabiner'].mu);
  const [tight, setTight] = useState('A');     // 緊邊：A=載重端（垂降）、O=操作端（拉升）

  // 切換轉折物類型時自動連動 μ
  const handleTypeChange = useCallback((type) => {
    setPulleyType(type);
    setMu(REDIRECT_TYPES[type].mu);
  }, []);

  // 相機 / 格線 / 全螢幕 / 截圖
  const [cameraOn, setCameraOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [shotMsg, setShotMsg] = useState('');
  const videoRef = useRef(null);
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const load_kN = (load_kgf * G) / 1000;
  const muEff = mu;   // μ 直接對應所選轉折物類型的實際摩擦係數

  // 啟動相機
  useEffect(() => {
    let stream = null;
    if (cameraOn) {
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; setCameraError(''); })
        .catch(err => { setCameraError('無法存取相機：' + (err.message || err.name) + '（需 HTTPS 或 localhost）'); setCameraOn(false); });
    }
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cameraOn]);

  const takeScreenshot = useCallback(async () => {
    const ok = await captureSVGWithVideo(svgRef.current, videoRef.current, W, H,
      `redirect_${Date.now()}.png`);
    setShotMsg(ok ? '✓ 截圖已儲存' : '✗ 截圖失敗');
    setTimeout(() => setShotMsg(''), 2000);
  }, []);

  // 力學計算（在 R 點分析）
  const data = useMemo(() => {
    const dxRA = anchor.x - redirect.x, dyRA = anchor.y - redirect.y;
    const dxRO = operator.x - redirect.x, dyRO = operator.y - redirect.y;
    const lenRA = Math.hypot(dxRA, dyRA) || 1;
    const lenRO = Math.hypot(dxRO, dyRO) || 1;
    const uRA = { x: dxRA / lenRA, y: dyRA / lenRA };
    const uRO = { x: dxRO / lenRO, y: dyRO / lenRO };

    // 包覆角 θ = R 點兩繩段之間的夾角
    const cosT = clamp(uRA.x * uRO.x + uRA.y * uRO.y, -1, 1);
    const theta = Math.acos(cosT);
    const angleDeg = toDeg(theta);

    // Capstan 摩擦 e^(μθ)
    const gain = Math.exp(muEff * theta);

    // 張力：A 端為載重端 = load_kN
    const T_A_kN = load_kN;
    // 操作端 = 載重 / e^μθ（垂降，緊邊在 A）或載重 × e^μθ（拉升，緊邊在 O）
    const T_O_kN = tight === 'A' ? load_kN / gain : load_kN * gain;

    // R 點承受合力（兩繩拉動 R 朝向 A 與 O）
    const Rx = T_A_kN * uRA.x + T_O_kN * uRO.x;
    const Ry = T_A_kN * uRA.y + T_O_kN * uRO.y;
    const Rmag = Math.hypot(Rx, Ry);

    // 警告：若 R 比 A 還低，違反「上方轉折」假設
    const redirectAboveAnchor = redirect.y < anchor.y;
    const redirectAboveOperator = redirect.y < operator.y;

    return {
      angleDeg, theta, gain, T_A_kN, T_O_kN, Rmag, Rx, Ry,
      uRA, uRO, redirectAboveAnchor, redirectAboveOperator,
    };
  }, [anchor, redirect, operator, load_kN, muEff, tight]);

  const onMove = useCallback((e) => {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = svgPointer(e);
    const sx = clamp(pos.x,16,W-16), sy = clamp(pos.y,16,H-16);
    if (drag === 'A') setAnchor({ x: sx, y: sy });
    if (drag === 'R') setRedirect({ x: sx, y: sy });
    if (drag === 'O') setOperator({ x: sx, y: sy });
  }, [drag]);

  const GRID = 40;
  const geometryWarn = !data.redirectAboveAnchor || !data.redirectAboveOperator;

  const [undo,setUndo]=useState(null);
  const reset=()=>{setUndo({anchor,redirect,operator,load_kgf,pulleyType,mu,tight});setAnchor({x:160,y:374.4});setRedirect({x:400,y:86.4});setOperator({x:640,y:374.4});setLoad(100);handleTypeChange('carabiner');setTight('A');};
  const symmetric=a=>{setAnchor({x:160,y:374.4});setOperator({x:640,y:374.4});setRedirect({x:400,y:374.4-240/Math.tan(toRad(a/2))});};
  return <div className="quick-module">
    <ModuleTitle number="8" title="高轉折點分析" hint="選擇轉折物與操作方向，查看轉折點承受的合力。"/>
    {geometryWarn&&<p className="warning" role="status">注意：轉折點 R 應位於 A、O 上方。</p>}
    <QuickDiagram W={W} H={H}
      labels={[{label:'轉折點合力 R',value:fmt(kNtoKgf(data.Rmag),0),point:redirect},{label:'載重端張力 A',value:fmt(kNtoKgf(data.T_A_kN),0),point:anchor,color:'#92400e'},{label:'操作端拉力 O',value:fmt(kNtoKgf(data.T_O_kN),0),point:operator,color:'#065f46'}]}
      metrics={[`兩繩夾角 ${fmt(data.angleDeg)}°`,`增益 ${fmt(data.gain,2)} 倍`]}
      dock={[{label:'轉折點合力 R',value:fmt(kNtoKgf(data.Rmag),0)},{label:'操作端拉力 O',value:fmt(kNtoKgf(data.T_O_kN),0)}]}
      points={[{id:'A',label:'載重端',point:anchor,set:setAnchor,color:'#b45309'},{id:'R',label:'高轉折點',point:redirect,set:setRedirect},{id:'O',label:'操作端',point:operator,set:setOperator,color:'#047857'}]} lines={[{a:anchor,b:redirect},{a:redirect,b:operator,color:'#047857'}]} onMove={onMove} onStart={setDrag} onEnd={()=>setDrag(null)} svgRef={svgRef} videoRef={videoRef} cameraOn={cameraOn} showGrid={showGrid} fullscreen={fullscreen} setFullscreen={setFullscreen}
      tools={<><button aria-pressed={cameraOn} onClick={()=>setCameraOn(!cameraOn)}>{cameraOn?'關閉相機':'相機疊圖'}</button><label><input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)}/>顯示格線</label><button onClick={takeScreenshot}>儲存圖形</button><button onClick={reset}>重置</button>{undo&&<button onClick={()=>{setAnchor(undo.anchor);setRedirect(undo.redirect);setOperator(undo.operator);setLoad(undo.load_kgf);setPulleyType(undo.pulleyType);setMu(undo.mu);setTight(undo.tight);setUndo(null);}}>復原重置</button>}<span role="status">{shotMsg}</span></>}/>
    {cameraError&&<p className="warning">{cameraError}</p>}
    <div className="input-panel"><Slider label="載重 W" value={load_kgf} min={50} max={500} step={10} unit="kgf" onChange={setLoad}/>
      <div className="preset-label">轉折物類型</div><div className="preset-row">{Object.entries(REDIRECT_TYPES).map(([key,t])=><button key={key} aria-pressed={pulleyType===key} onClick={()=>handleTypeChange(key)}>{t.label}</button>)}</div>
      <div className="preset-label">操作方向</div><div className="preset-row"><button aria-pressed={tight==='A'} onClick={()=>setTight('A')}>垂降 · A 緊邊</button><button aria-pressed={tight==='O'} onClick={()=>setTight('O')}>拉升 · O 緊邊</button></div>
      <Slider label="摩擦係數 μ" value={mu} min={REDIRECT_TYPES[pulleyType].muMin} max={REDIRECT_TYPES[pulleyType].muMax} step={REDIRECT_TYPES[pulleyType].muStep} onChange={setMu}/>
      <div className="preset-label">對稱兩繩夾角</div><div className="preset-row">{[75,90,120].map(a=><button key={a} onClick={()=>symmetric(a)}>{a}°</button>)}</div>
    </div><PointFields W={W} H={H} points={[{id:'A',label:'載重端 A',point:anchor,set:setAnchor},{id:'R',label:'轉折點 R',point:redirect,set:setRedirect},{id:'O',label:'操作端 O',point:operator,set:setOperator}]}/>
    <Reference><p>沿用原版 Capstan 摩擦與向量合力模型。A 端張力 = {fmt(kNtoKgf(data.T_A_kN),0)} kgf；操作端依緊邊選擇乘上或除以摩擦增益。</p><p>R 合力為兩繩張力的向量和。位置欄位是圖面百分比，並非現場距離。</p></Reference>
  </div>;
}

// ========================================================================
// 模組 9：EN 認證規範速查（依器材類別整理）
// ========================================================================
const EN_DATA = {
  ropes: {
    title: '繩索',
    titleEn: 'Ropes',
    icon: '🪢',
    color: 'amber',
    standards: [
      {
        code: 'EN 892',
        title: '動態山岳攀登繩',
        titleEn: 'Dynamic Mountaineering Ropes',
        scope: '攀岩、登山專用，必須能在墜落時吸收衝擊能量',
        types: [
          { name: '單繩 (Single ①)', desc: '直徑 8.9–11mm，可獨立使用，最常見' },
          { name: '半繩 (Half ½)', desc: '需成對使用，分掛兩個保護點，適合冰攀/長路線' },
          { name: '雙繩 (Twin ∞)', desc: '雙繩同時掛同一保護點，常見於阿爾卑斯式攀登' },
        ],
        tests: [
          { item: '最大衝擊力', value: '≤ 12 kN (1224 kgf)', note: '單繩 80kg / 雙繩 80kg / 半繩 55kg 測試' },
          { item: '標準墜落係數', value: 'FF = 1.77', note: 'UIAA 動態測試' },
          { item: '通過墜落次數', value: '≥ 5 次', note: '不可斷裂' },
          { item: '靜態伸長率', value: '≤ 8% (單繩) / ≤ 12% (半繩)', note: '80 kg 載重' },
          { item: '外皮滑移', value: '≤ 20 mm/2m', note: '結構完整性測試' },
        ],
        notes: '彈性繩本質是「能量吸收器」，不適合救援拖拉系統使用。標準 ① ½ ∞ 標誌會印在繩端標籤上。',
      },
      {
        code: 'EN 1891',
        title: '低伸長率芯鞘繩（半靜力繩）',
        titleEn: 'Low Stretch Kernmantel Ropes',
        scope: '工業繩索作業、繩索救援、洞穴探勘、技術下降使用',
        types: [
          { name: 'Type A', desc: '直徑 ≥ 10 mm，一般救援/工作用，強度高' },
          { name: 'Type B', desc: '直徑 8.5–12 mm，特殊輕量用途，強度較低' },
        ],
        tests: [
          { item: '靜態強度（無打結）', value: 'Type A ≥ 22 kN · Type B ≥ 18 kN' },
          { item: '靜態強度（含 8 字結）', value: 'Type A ≥ 15 kN · Type B ≥ 12 kN' },
          { item: '最大伸長率', value: '≤ 5%', note: '50–150 kg 載重' },
          { item: '動態衝擊測試', value: 'FF=0.3 三次墜落不斷', note: '100 kg 測試' },
          { item: '外皮滑移', value: '≤ 40 mm/2m' },
          { item: '繩芯結合力', value: '繩芯與外皮黏結強度測試' },
        ],
        notes: '「半靜力繩」在 NFPA 標準中對應 G/T-rated。**禁止用於攀登動態保護**（無法吸收墜落衝擊）。',
      },
    ],
  },
  connectors: {
    title: '鉤環/連接器',
    titleEn: 'Carabiners',
    icon: '⛓',
    color: 'sky',
    standards: [
      {
        code: 'EN 12275',
        title: '登山連接器（鉤環）',
        titleEn: 'Mountaineering Connectors',
        scope: '攀登/登山運動使用的鉤環',
        types: [
          { name: 'Type B (Basic)', desc: '一般用途，最常見' },
          { name: 'Type H (HMS)', desc: '梨型，專為義大利結 (Munter) 設計' },
          { name: 'Type K (Klettersteig)', desc: '攀岩鐵道專用，強化開門強度' },
          { name: 'Type X (Oval)', desc: '橢圓形，輔助器材/滑輪用' },
          { name: 'Type D (Directional)', desc: '受力方向鎖定型' },
          { name: 'Type Q (Screw link)', desc: '螺旋連接環，永久連接用' },
          { name: 'Type A (Anchor)', desc: '錨點連接器，特定方向受力' },
        ],
        tests: [
          { item: '主軸（縱向）強度', value: 'Type B/H ≥ 20 kN · Type K ≥ 25 kN · Type Q ≥ 25 kN' },
          { item: '副軸（橫向）強度', value: '≥ 7 kN（Type Q ≥ 10 kN）' },
          { item: '開門狀態強度', value: '≥ 7 kN（Type H 6 kN · Type K 8 kN）' },
          { item: '開門功能', value: '8000 次循環測試' },
          { item: '閘門開啟力', value: '可手動操作' },
        ],
        notes: '主軸強度數字（kN）必須**永久刻印於本體**。Type 字母通常標於閘門或本體側邊。',
      },
      {
        code: 'EN 362',
        title: '個人防墜系統連接器',
        titleEn: 'Personal Fall Protection Connectors',
        scope: '工業高空作業、墜落保護用，要求比 EN 12275 嚴格',
        types: [
          { name: 'Class A (Anchor)', desc: '錨點專用連接器' },
          { name: 'Class B (Basic)', desc: '基本連接器' },
          { name: 'Class M (Multi-use)', desc: '多用途連接器，主副軸都需高強度' },
          { name: 'Class T (Termination)', desc: '終端連接器，特定方向受力' },
          { name: 'Class Q (Screw)', desc: '螺旋鎖環' },
        ],
        tests: [
          { item: '主軸強度', value: '≥ 20 kN（多數類別）· Class M/Q ≥ 25 kN' },
          { item: '副軸強度', value: 'Class M ≥ 15 kN' },
          { item: '閘門必須自動上鎖', value: '不可手動鎖（與 EN 12275 不同）' },
          { item: '雙動作開啟', value: '至少需要兩個獨立動作才能打開閘門' },
        ],
        notes: '**工業/救援用必須選 EN 362**（不可只有 EN 12275）。CE 後的 4 位數字是通報機構編號。',
      },
    ],
  },
  harness: {
    title: '安全帶',
    titleEn: 'Harnesses',
    icon: '🎽',
    color: 'rose',
    standards: [
      {
        code: 'EN 12277',
        title: '登山安全帶',
        titleEn: 'Mountaineering Harnesses',
        scope: '攀登運動用',
        types: [
          { name: 'Type A', desc: '全身式（含胸帶 + 坐帶）' },
          { name: 'Type B', desc: '小型全身式（兒童 / 體重 < 40kg）' },
          { name: 'Type C', desc: '坐式安全帶（最常見）' },
          { name: 'Type D', desc: '胸式安全帶（需配合坐帶使用）' },
          { name: 'Type E', desc: '身體固定帶（救援用，被救者穿戴）' },
        ],
        tests: [
          { item: '靜態強度', value: '≥ 15 kN · 維持 3 分鐘不破損' },
          { item: '動態墜落測試', value: 'FF=1.7（80kg）· 模擬倒掛 10 分鐘無滑脫' },
          { item: '掛點縫線結構', value: '主掛點需特殊強化' },
        ],
      },
      {
        code: 'EN 361',
        title: '墜落制止全身式安全帶',
        titleEn: 'Full Body Harness for Fall Arrest',
        scope: '工業墜落保護專用，**必備**才能配 EN 355 緩衝器',
        tests: [
          { item: '靜態強度', value: '≥ 15 kN · 3 分鐘維持' },
          { item: '動態測試', value: '100 kg 重物 4m 自由墜落，安全帶不破損' },
          { item: '主掛點', value: '背部 D 環（dorsal）+ 胸部（sternal）' },
          { item: '掛點標識', value: 'A 字母標示掛點，A/2 表示需與另一 A/2 共用' },
        ],
        notes: '工業/救援必備。坐帶 (EN 813) 不能單獨用於墜落制止，必須搭配 EN 361 全身式。',
      },
      {
        code: 'EN 813',
        title: '坐式安全帶（工作定位）',
        titleEn: 'Sit Harness for Work Positioning',
        scope: '高空作業、繩索進入、工作定位專用',
        tests: [
          { item: '靜態強度', value: '腹部掛點 ≥ 15 kN' },
          { item: '懸吊測試', value: '單獨懸吊 100kg / 30 分鐘' },
          { item: '腹部掛點', value: '繩索進入專用（IRATA / SPRAT 教學）' },
        ],
        notes: '常與 EN 361 合一販售（如 Petzl Avao Bod）。**單獨使用不能用於墜落制止**。',
      },
      {
        code: 'EN 358',
        title: '工作定位帶',
        titleEn: 'Work Positioning Belt',
        scope: '工作定位、限制墜落（防止抵達墜落邊緣）',
        tests: [
          { item: '靜態強度', value: '≥ 15 kN' },
          { item: '側邊掛點', value: '兩側 D 環，配合定位繩使用' },
        ],
        notes: '**僅限定位/限制，不能用於墜落制止**。墜落距離若 > 0.5m 必須加裝 EN 355 緩衝器。',
      },
    ],
  },
  helmet: {
    title: '頭盔',
    titleEn: 'Helmets',
    icon: '⛑',
    color: 'orange',
    standards: [
      {
        code: 'EN 12492',
        title: '登山者頭盔',
        titleEn: 'Helmets for Mountaineers',
        scope: '攀岩、登山、繩索救援',
        tests: [
          { item: '頂部撞擊', value: '5kg / 2m 自由落下，傳遞至假人頸部 ≤ 10 kN' },
          { item: '前/後/側撞擊', value: '5kg / 0.5m，傳遞力 ≤ 10 kN' },
          { item: '貫穿測試', value: '1.5kg 尖錐 / 1m 落下，不貫穿至頭模' },
          { item: '繫帶強度', value: '≥ 50 N · 撕裂力 ≥ 250 N' },
          { item: '繫帶滑落', value: '前傾測試後不可脫落' },
        ],
        notes: '繩索作業/救援標準頭盔。具側邊與後方衝擊吸收能力，與工業頭盔 EN 397 不同。',
      },
      {
        code: 'EN 397',
        title: '工業安全頭盔',
        titleEn: 'Industrial Safety Helmets',
        scope: '建築工地、一般工業墜物保護',
        tests: [
          { item: '頂部撞擊', value: '5kg / 1m 落下，傳遞 ≤ 5 kN' },
          { item: '貫穿測試', value: '3kg 尖錐 / 1m，不貫穿' },
          { item: '繫帶（選配）', value: '在 150–250 N 範圍內鬆脫（防勒頸）' },
        ],
        notes: '**主要保護頂部墜物**，側邊與後方無強制要求。**不適合繩索作業/救援**（容易在倒立或側撞時脫落）。',
      },
    ],
  },
  slings: {
    title: '扁帶/繩環',
    titleEn: 'Tapes & Slings',
    icon: '🎀',
    color: 'purple',
    standards: [
      {
        code: 'EN 565',
        title: '織帶（扁帶素材）',
        titleEn: 'Tape',
        scope: '織造扁帶素材，後續加工為繩環/快扣等',
        tests: [
          { item: '最小斷裂強度', value: '≥ 22 kN' },
        ],
      },
      {
        code: 'EN 566',
        title: '成品繩環',
        titleEn: 'Slings',
        scope: '完成的縫合繩環、扁帶環',
        tests: [
          { item: '最小斷裂強度', value: '≥ 22 kN' },
          { item: '老化測試', value: 'UV / 溫度循環後仍維持強度' },
        ],
        notes: '通常標示 22 kN，相當於 ≈ 2240 kgf。Dyneema 細扁帶因熔點低（~150°C），不可與摩擦熱接觸。',
      },
    ],
  },
  lanyards: {
    title: '連接繩/緩衝器',
    titleEn: 'Lanyards & Energy Absorbers',
    icon: '🪢',
    color: 'cyan',
    standards: [
      {
        code: 'EN 354',
        title: '連接繩（Lanyard）',
        titleEn: 'Lanyards',
        scope: '個人保護系統的連接元件（不含緩衝功能）',
        tests: [
          { item: '靜態強度', value: '≥ 22 kN（含末端）' },
          { item: '長度限制', value: '≤ 2 m（成品總長）' },
        ],
        notes: '**單獨使用不能墜落制止**，必須搭配 EN 355 緩衝器。',
      },
      {
        code: 'EN 355',
        title: '能量吸收緩衝器',
        titleEn: 'Energy Absorbers',
        scope: '吸收墜落衝擊力，防止人體與設備受損',
        tests: [
          { item: '最大制動力', value: '≤ 6 kN (612 kgf)', note: '人體可承受極限' },
          { item: '最大延伸距離', value: '≤ 1.75 m', note: '緩衝器撕開後總長' },
          { item: '測試載重', value: '100 kg / 4m 自由墜落', note: 'FF=2 模擬' },
        ],
        notes: '撕裂式緩衝器（tear-out）一旦觸發必須**整組更換**。墜落距離計算必須加上 1.75m + 連接繩長。',
      },
      {
        code: 'EN 360',
        title: '自鎖式防墜器（Retractable）',
        titleEn: 'Retractable Type Fall Arrester',
        scope: '可伸縮鋼索/織帶，自動鎖定墜落',
        tests: [
          { item: '鎖定速度', value: '通常 1.5 m/s 內鎖定' },
          { item: '最大制動力', value: '≤ 6 kN' },
          { item: '靜態強度', value: '≥ 12 kN' },
          { item: '動態測試', value: '100 kg / 0.6 m 模擬墜落' },
        ],
      },
    ],
  },
  ascDesc: {
    title: '上升下降器',
    titleEn: 'Ascenders & Descenders',
    icon: '⬆',
    color: 'emerald',
    standards: [
      {
        code: 'EN 567',
        title: '繩索抓握器（上升器）',
        titleEn: 'Rope Clamps / Ascenders',
        scope: '繩索上升、Z-rig 倍力系統的抓繩器',
        tests: [
          { item: '工作載重測試', value: '4 kN 不損傷繩索' },
          { item: '靜態強度', value: '通過 5 kN 載重不滑脫（10 kN 容許繩索損傷）' },
        ],
        notes: '**禁止用於墜落制止**（牙齒會切斷繩索）。掉落係數 > 0.3 即可能損繩。',
      },
      {
        code: 'EN 12841',
        title: '繩索調整裝置',
        titleEn: 'Rope Adjustment Devices',
        scope: '工業繩索進入專用，依用途分三型',
        types: [
          { name: 'Type A 安全繩備援', desc: '安全繩上的防墜備援，必須能夾繩 + 限制衝擊力 < 6 kN' },
          { name: 'Type B 工作繩上升器', desc: '工作繩上升用，承載 30–140 kg' },
          { name: 'Type C 工作繩下降器', desc: '工作繩下降用，承載 30–200 kg' },
        ],
        tests: [
          { item: 'Type A 制動力', value: '≤ 6 kN（含繩索與裝置）' },
          { item: 'Type A 靜載', value: '15 kN / 3 分鐘無破損' },
          { item: 'Type C 工作載重', value: '依規格 30–200 kg 連續使用' },
          { item: 'Type C 制動測試', value: '0.5 m 自由墜落 + 動態鎖定' },
        ],
        notes: 'IRATA / SPRAT 雙繩系統強制要求：工作繩用 Type B/C + 安全繩用 Type A，**兩者不可省略其一**。',
      },
      {
        code: 'EN 341',
        title: '救援下降器',
        titleEn: 'Descender Devices for Rescue',
        scope: '緊急逃生與救援下降專用',
        types: [
          { name: 'Class A', desc: '高耐用，30–150 kg，下降高度 ≤ 200m' },
          { name: 'Class B', desc: '30–100 kg，≤ 100m' },
          { name: 'Class C', desc: '30–100 kg，≤ 30m' },
          { name: 'Class D', desc: '低耐用，≤ 30m，僅單次使用' },
        ],
        tests: [
          { item: '能量耗散', value: '依 Class 計算 W = m·g·h 容許值' },
          { item: '溫度安全', value: '裝置外殼不可導致繩索熔化' },
        ],
      },
    ],
  },
  pulley: {
    title: '滑輪',
    titleEn: 'Pulleys',
    icon: '⚙',
    color: 'indigo',
    standards: [
      {
        code: 'EN 12278',
        title: '攀登/救援用滑輪',
        titleEn: 'Pulleys',
        scope: '繩索倍力系統、變向用滑輪',
        tests: [
          { item: '單繩滑輪最低強度', value: '≥ 12 kN（軸向）' },
          { item: '雙繩滑輪', value: '≥ 24 kN' },
          { item: '繩槽寬度', value: '相容指定繩徑範圍' },
          { item: '效率（選配標示）', value: '球軸承 ≥ 90% · 一般軸 ≥ 70%' },
        ],
        notes: '**鉤環當滑輪用效率僅 ~50%**（高摩擦），救援拖拉應使用真正的滑輪。Prusik 不可放在滑輪繩槽內（會損傷）。',
      },
    ],
  },
  anchor: {
    title: '錨點裝置',
    titleEn: 'Anchor Devices',
    icon: '⚓',
    color: 'red',
    standards: [
      {
        code: 'EN 795',
        title: '錨點裝置',
        titleEn: 'Anchor Devices',
        scope: '個人防墜系統的固定錨點',
        types: [
          { name: 'Type A', desc: '永久型固定錨點（牆面螺栓、地面螺栓）' },
          { name: 'Type B', desc: '臨時型可攜帶錨點（門框繩環、配重式等）' },
          { name: 'Type C', desc: '柔性水平救生繩（鋼索水平索）' },
          { name: 'Type D', desc: '剛性水平軌道' },
          { name: 'Type E', desc: '配重型錨點（不需鑽孔）' },
        ],
        tests: [
          { item: '金屬錨點靜載', value: '≥ 12 kN / 3 分鐘' },
          { item: '非金屬錨點靜載', value: '≥ 18 kN / 3 分鐘' },
          { item: '動態墜落測試', value: '100 kg 模擬 FF=2 墜落不脫落' },
          { item: 'Type C/D 撓度測試', value: '水平索墜落後撓度限制' },
        ],
        notes: 'Type B 可攜帶式（如 Petzl Connexion Fixe）方便消防/救援臨時架設。Type A 需專業安裝與年度檢驗。',
      },
    ],
  },
};

function StandardCard({ std, color, expanded, onToggle }) {
  const colorMap = {
    amber: 'border-amber-700/50 bg-amber-950/20',
    sky: 'border-sky-700/50 bg-sky-950/20',
    rose: 'border-rose-700/50 bg-rose-950/20',
    orange: 'border-orange-700/50 bg-orange-950/20',
    purple: 'border-purple-700/50 bg-purple-950/20',
    cyan: 'border-cyan-700/50 bg-cyan-950/20',
    emerald: 'border-emerald-700/50 bg-emerald-950/20',
    indigo: 'border-indigo-700/50 bg-indigo-950/20',
    red: 'border-red-700/50 bg-red-950/20',
  };
  const codeColor = {
    amber: 'text-amber-800', sky: 'text-sky-300', rose: 'text-rose-300',
    orange: 'text-orange-800', purple: 'text-purple-800', cyan: 'text-cyan-800',
    emerald: 'text-emerald-800', indigo: 'text-indigo-300', red: 'text-red-800',
  };
  return (
    <div className={`border rounded-xl overflow-hidden ${colorMap[color]}`}>
      <button onClick={onToggle}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-white/5 transition-colors">
        <span className={`font-mono font-bold text-lg ${codeColor[color]}`}>{std.code}</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-900">{std.title}</div>
          <div className="text-xs text-slate-600 mt-0.5">{std.titleEn}</div>
          <div className="text-xs text-slate-700 mt-1.5 leading-relaxed">{std.scope}</div>
        </div>
        <span className="text-slate-600 text-sm shrink-0">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-300/50 pt-3">
          {std.types && std.types.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">分類 / Sub-types</div>
              <div className="space-y-1.5">
                {std.types.map((t, i) => (
                  <div key={i} className="text-sm bg-white/40 rounded p-2 border border-slate-200">
                    <span className={`font-bold ${codeColor[color]}`}>{t.name}</span>
                    <span className="text-slate-700 ml-2">{t.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">測試要求 / Key Tests</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {std.tests.map((t, i) => (
                    <tr key={i} className="border-b border-slate-200/50">
                      <td className="py-1.5 pr-3 text-slate-600 align-top whitespace-nowrap">{t.item}</td>
                      <td className="py-1.5 pr-3 font-mono text-slate-900 align-top">{t.value}</td>
                      {t.note && <td className="py-1.5 text-slate-600 align-top text-[11px]">{t.note}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {std.notes && (
            <div className="text-xs bg-slate-50/60 border border-slate-300/50 rounded p-2.5 text-slate-700 leading-relaxed">
              💡 {std.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ENCertModule() {
  const [activeCategory, setActiveCategory] = useState('ropes');
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = (code) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const expandAll = () => {
    const cat = EN_DATA[activeCategory];
    setExpanded(new Set(cat.standards.map(s => s.code)));
  };
  const collapseAll = () => setExpanded(new Set());

  const cat = EN_DATA[activeCategory];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">9. EN 認證規範速查</h2>
        <p className="text-slate-600 text-sm leading-relaxed">
          歐洲標準（European Norm，EN）對繩索救援與高空作業器材的認證規範。
          所有 PPE 個人防護器材在歐盟銷售必須通過對應 EN 標準並取得 <strong className="text-blue-800">CE 認證</strong>，
          標示格式為 <code className="text-blue-800 bg-slate-100 px-1 rounded">CE 0123</code>（後 4 位為通報機構編號）。
        </p>
        <p className="text-xs text-amber-800 bg-amber-950/30 border border-amber-800/40 rounded p-2 mt-2">
          ⚠ 本資料僅供教學參考。採購器材時請以製造商提供的官方 CE 聲明書與最新版 EN 規範為準。
        </p>
      </div>

      {/* 類別導航 */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(EN_DATA).map(([key, c]) => (
          <button key={key}
            onClick={() => { setActiveCategory(key); setExpanded(new Set()); }}
            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              activeCategory === key
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}>
            <span className="text-base">{c.icon}</span>
            <span>{c.title}</span>
            <span className="text-[10px] opacity-70 font-mono">({c.standards.length})</span>
          </button>
        ))}
      </div>

      {/* 展開/收合控制 */}
      <div className="flex justify-between items-center text-xs">
        <div className="text-slate-600">
          <span className="font-bold text-slate-800">{cat.title}</span> · {cat.titleEn} · 共 {cat.standards.length} 項標準
        </div>
        <div className="flex gap-2">
          <button onClick={expandAll}
            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">展開全部</button>
          <button onClick={collapseAll}
            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">收合全部</button>
        </div>
      </div>

      {/* 標準列表 */}
      <div className="space-y-3">
        {cat.standards.map(std => (
          <StandardCard key={std.code} std={std} color={cat.color}
            expanded={expanded.has(std.code)} onToggle={() => toggle(std.code)} />
        ))}
      </div>

      {/* 通用 CE 標識說明 */}
      <CollapsibleSection className="bg-slate-50/60 border-slate-200 mt-4" title="📋 CE 標識通用判讀">
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <div className="bg-white/60 rounded p-3 border border-slate-200">
            <div className="font-bold text-blue-800 mb-1">CE + 4 位數字</div>
            <div className="text-slate-700">例：<code className="bg-slate-100 px-1 rounded">CE 0123</code> 代表通過 TÜV SÜD（編號 0123）公告機構認證</div>
          </div>
          <div className="bg-white/60 rounded p-3 border border-slate-200">
            <div className="font-bold text-blue-800 mb-1">EN 編號 + Type / Class</div>
            <div className="text-slate-700">例：<code className="bg-slate-100 px-1 rounded">EN 12275:2013 / B</code> 代表 2013 版的 Basic 類鉤環</div>
          </div>
          <div className="bg-white/60 rounded p-3 border border-slate-200">
            <div className="font-bold text-blue-800 mb-1">UIAA 認證（攀登器材）</div>
            <div className="text-slate-700">獨立於 EN 之外的攀登運動國際認證，常與 EN 並列</div>
          </div>
          <div className="bg-white/60 rounded p-3 border border-slate-200">
            <div className="font-bold text-blue-800 mb-1">製造批號 / 出廠日</div>
            <div className="text-slate-700">用於追溯與檢驗週期管理（PPE 通常 5–10 年壽命）</div>
          </div>
        </div>
      </CollapsibleSection>

      {/* 對照表 */}
      <CollapsibleSection className="bg-slate-50/60 border-slate-200" title="🌐 EN vs NFPA / ANSI 對照">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-600 border-b border-slate-300">
              <tr>
                <th className="px-2 py-2 text-left">器材</th>
                <th className="px-2 py-2 text-left">歐洲 (EN)</th>
                <th className="px-2 py-2 text-left">美國 (NFPA / ANSI)</th>
                <th className="px-2 py-2 text-left">主要差異</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              <tr className="border-b border-slate-200/50">
                <td className="px-2 py-2 font-medium">繩索（救援）</td>
                <td className="px-2 py-2 font-mono">EN 1891 Type A</td>
                <td className="px-2 py-2 font-mono">NFPA 1983 G/T-rated</td>
                <td className="px-2 py-2 text-slate-600">NFPA 強度更高（G 40 kN vs EN A 22 kN）</td>
              </tr>
              <tr className="border-b border-slate-200/50">
                <td className="px-2 py-2 font-medium">鉤環</td>
                <td className="px-2 py-2 font-mono">EN 362 / EN 12275</td>
                <td className="px-2 py-2 font-mono">NFPA 1983 + ANSI Z359.12</td>
                <td className="px-2 py-2 text-slate-600">NFPA G 要求 ≥ 36 kN（vs EN ≥ 20 kN）</td>
              </tr>
              <tr className="border-b border-slate-200/50">
                <td className="px-2 py-2 font-medium">安全帶（墜落）</td>
                <td className="px-2 py-2 font-mono">EN 361</td>
                <td className="px-2 py-2 font-mono">ANSI Z359.11</td>
                <td className="px-2 py-2 text-slate-600">掛點數量與位置標準不同</td>
              </tr>
              <tr className="border-b border-slate-200/50">
                <td className="px-2 py-2 font-medium">緩衝器</td>
                <td className="px-2 py-2 font-mono">EN 355 (≤6 kN)</td>
                <td className="px-2 py-2 font-mono">ANSI Z359.13 (≤8 kN)</td>
                <td className="px-2 py-2 text-slate-600">ANSI 容許較高制動力</td>
              </tr>
              <tr>
                <td className="px-2 py-2 font-medium">頭盔</td>
                <td className="px-2 py-2 font-mono">EN 12492</td>
                <td className="px-2 py-2 font-mono">NFPA 1951 / ANSI Z89.1</td>
                <td className="px-2 py-2 text-slate-600">NFPA 1951 含耐高溫測試</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ========================================================================
// 主應用
// ========================================================================
function App() {
  const [activeTab,setActiveTab]=useState(1);
  const [night,setNight]=useState(false);
  useEffect(()=>{document.documentElement.dataset.theme=night?'night':'day';},[night]);
  const tabs = [
    { id: 0, name: '1. 繩索摩擦力',     icon: 'git',       comp: <FrictionModule /> },
    { id: 1, name: '2. 索道張力',       icon: 'move',      comp: <HighlineModule /> },
    { id: 2, name: '3. 墜落衝擊力',     icon: 'activity',  comp: <FallImpactModule /> },
    { id: 3, name: '4. 死亡三角',       icon: 'triangle',  comp: <DeathTriangleModule /> },
    { id: 4, name: '5. 變向固定點',     icon: 'arrowDown', comp: <DirectionalAnchorModule /> },
    { id: 5, name: '6. 拉力夾角模擬',   icon: 'anchor',    comp: <AnchorPullAngleModule /> },
    { id: 6, name: '7. 機械倍力 MA',    icon: 'cog',       comp: <MAModule /> },
    { id: 7, name: '8. 高轉折點分析',   icon: 'triangle',  comp: <RedirectAnalysisModule /> },
    { id: 8, name: '9. EN 認證規範',     icon: 'info',      comp: <ENCertModule /> },
  ];
  const quick=[1,5,7];
  return <div className="app-shell"><header className="site-header"><div className="brand"><span className="brand-mark"><Icon name="activity" size={24}/></span><div><h1>繩索快算</h1><p>ROPE FORCE CALCULATOR</p></div></div><button className="theme-toggle" onClick={()=>setNight(!night)} aria-pressed={night}>{night?'日間模式':'夜間模式'}</button></header>
    <div className="workspace"><div className="intro-line"><span>快速試算</span><span>輸入條件，結果即時更新</span></div>
      <nav className="quick-nav" aria-label="常用模組">{quick.map(id=><button key={id} aria-current={activeTab===id?'page':undefined} onClick={()=>setActiveTab(id)}><Icon name={tabs[id].icon} size={20}/><span>{id===1?'索道張力':id===5?'拉力夾角':'高轉折點'}</span><small>0{id+1}</small></button>)}</nav>
      <label className="module-select">全部模組<select aria-label="全部模組" value={activeTab} onChange={e=>setActiveTab(Number(e.target.value))}>{tabs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <main key={activeTab} className={`main-panel ${quick.includes(activeTab)?'':'legacy-panel'}`}>{tabs[activeTab].comp}</main>
      <footer>僅供教學與參考，實際救援請依現場專業判斷。<br/><span>繩索受力分析 · 手機日間版</span></footer>
    </div></div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
