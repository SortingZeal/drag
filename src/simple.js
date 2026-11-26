import { isValidDate, taskProgress } from './model.js';
import { pictureDisplayRange, pictureDateLine } from './align-start.js';
import { t as translate } from './i18n.js';
import { readTaskMilestone, taskMilestoneShape } from './task-properties.js';
import { statusTone } from './task-glyphs.js';
import { svgNode as node, progressPaint, progressStripes, addProgressPatterns, addCompletionSheen, addCompletionCheck, placeCompletionCheck } from './progress-appearance.js';

const NS='http://www.w3.org/2000/svg';
const FONT='"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const INK='#071f49', GRID='#dce8f6';
const LEFT=12, CHART=420, RIGHT=1908, WIDTH=1920;
const CHECK_SIZE = 24, CHECK_GUTTER = CHECK_SIZE + 14;
const shortMonth=month=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1];
const monthLabel=month=>translate(`${month}月`,shortMonth(month));
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const color=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v:'#64748b';
const size=(v,fallback)=>v!==''&&Number.isFinite(Number(v))&&Number(v)>=8&&Number(v)<=160?Number(v):fallback;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const parts=s=>s.split('-').map(Number);
const days=(y,m)=>[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
const iso=(y,m,d=1)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const monthIndex=s=>{const[y,m]=parts(s);return y*12+m-1;};
const coordinate=(s,inclusive=false)=>{const[y,m,d]=parts(s);return y*12+m-1+(d-(inclusive?0:1))/days(y,m);};
function measureText() {
  const ctx = document.createElement('canvas').getContext('2d');
  let activeFont;
  const widths = new Map();
  return (value, font, weight = 700) => {
    const text = String(value);
    if (!ctx) return Array.from(text).reduce((n, char) => n + font * (/[^\x00-\xff]/.test(char) ? 1 : .58), 0);
    const face = weight + ' ' + font + 'px';
    const key = text.length <= 256 ? face + ':' + text : null;
    const cached = key === null ? undefined : widths.get(key);
    if (cached !== undefined) return cached;
    if (activeFont !== face) {
      ctx.font = face + ' ' + FONT;
      activeFont = face;
    }
    const metrics = ctx.measureText(text);
    const width = Math.max(metrics.width, (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0));
    if (key !== null) {
      // Bound the per-render cache even when every imported caption is unique.
      if (widths.size === 4096) widths.clear();
      widths.set(key, width);
    }
    return width;
  };
}
function wrap(value,width,font,measure,weight=700){
  const lines=[];
  for(const paragraph of String(value??'').split(/\r?\n/)){
    const rows=[];let line='';
    const wordWrap=/[A-Za-z]/.test(paragraph)&&/[ \t]/.test(paragraph);
    if(wordWrap){
      for(const token of paragraph.match(/\s+|\S+/g)||['']){
        if(/^\s+$/.test(token)){line+=token;continue;}
        if(measure(line+token,font,weight)<=width){line+=token;continue;}
        if(line.trim()){rows.push(line);line='';}
        for(const char of Array.from(token)){if(line&&measure(line+char,font,weight)>width){rows.push(line);line=char;}else line+=char;}
      }
    }else for(const char of Array.from(paragraph)){if(line&&measure(line+char,font,weight)>width){rows.push(line);line=char;}else line+=char;}
    rows.push(line);
    if(!wordWrap&&rows.length>1&&measure(rows.at(-1),font,weight)<width*.35){
      const combined=Array.from(rows.at(-2)+rows.at(-1));let best=null;
      for(let i=1;i<combined.length;i++){const a=combined.slice(0,i).join(''),b=combined.slice(i).join(''),wa=measure(a,font,weight),wb=measure(b,font,weight);if(wa>width||wb>width)continue;const score=Math.abs(wa-wb);if(!best||score<best.score)best={a,b,score};}
      if(best)rows.splice(-2,2,best.a,best.b);
    }
    lines.push(...rows);
  }
  return lines;
}
function fitCaption(caption, available, authoredSize, measure) {
  let fontSize = size(authoredSize, null);
  const automatic = fontSize === null;
  if (automatic) {
    const units = Array.from(caption).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : .55), 0);
    fontSize = clamp(available / Math.max(1, Math.ceil(units / 2)) - .1, 14, 28);
  }
  for (;;) {
    const lines = wrap(caption, Math.max(fontSize, available), fontSize, measure);
    const labelWidth = lines.reduce((width, line) => Math.max(width, measure(line, fontSize)), 0);
    if (!automatic || fontSize <= 12 || (lines.length <= 2 && labelWidth <= available - 4)) {
      return {fontSize, lines, labelWidth};
    }
    fontSize = Math.max(12, fontSize - .25);
  }
}
function text(parent,value,x,y,font,attrs={},lines){const el=node('text',{x,y,fill:INK,'font-family':FONT,'font-size':font,'font-weight':700,...attrs},parent);(lines||[String(value??'')]).forEach((line,i)=>{node('tspan',{x,dy:i?font*1.15:0},el).textContent=line;});return el;}
function blockText(parent,value,x,cy,font,role,lines,fill){return text(parent,value,x,cy-(lines.length-1)*font*1.15/2+font*.35,font,{'text-anchor':'middle',fill,'data-role':role},lines);}
function mix(value,amount){const c=color(value);return '#'+[1,3,5].map(i=>Math.round(parseInt(c.slice(i,i+2),16)*(1-amount)+255*amount).toString(16).padStart(2,'0')).join('');}
function luminance(value){const c=color(value);const a=[1,3,5].map(i=>{const n=parseInt(c.slice(i,i+2),16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
function shape(parent,x,y,kind,fill,role='milestone-symbol'){if(kind==='star'){const points=Array.from({length:10},(_,i)=>{const r=i%2?5:11,a=-Math.PI/2+i*Math.PI/5;return`${x+Math.cos(a)*r},${y+Math.sin(a)*r}`;}).join(' ');return node('polygon',{points,fill,stroke:'#fff','stroke-width':2,'data-role':role,'data-shape':kind},parent);}return node('circle',{cx:x,cy:y,r:9,fill,stroke:'#fff','stroke-width':2,'data-role':role,'data-shape':'circle'},parent);}
function barPath(x,y,w,h,arrow){const r=Math.min(10,w/4,h/4),tip=arrow?Math.min(20,w*.1):0;return`M ${x+r} ${y} H ${x+w-tip-r} Q ${x+w-tip} ${y} ${x+w-tip} ${y+r} ${arrow?`L ${x+w} ${y+h/2} L ${x+w-tip} ${y+h-r}`:`V ${y+h-r}`} Q ${x+w-tip} ${y+h} ${x+w-tip-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;}

const BADGE_FONT = 15;
function statusBadge(status, barX, measure) {
  if (!status) return null;
  const lines = wrap(status, 280, BADGE_FONT, measure);
  const width = Math.ceil(lines.reduce((widest, line) => Math.max(widest, measure(line, BADGE_FONT)), 0)) + 28;
  return { status, lines, width, height: Math.ceil(lines.length * BADGE_FONT * 1.15 + 9),
    x: Math.min(barX, RIGHT - width - 3) };
}

function drawStatus(parent, badge, bottom) {
  const y = bottom - badge.height;
  const tone = statusTone(badge.status);
  const group = node('g', {'data-role': 'phase-status-badge', 'data-edit-field': 'status', 'aria-label': badge.status}, parent);
  node('rect', {x: badge.x, y, width: badge.width, height: badge.height, rx: 10,
    fill: tone.paper, stroke: tone.line}, group);
  node('circle', {cx: badge.x + 10, cy: y + 13, r: 3.5, fill: tone.accent}, group);
  text(group, badge.status, badge.x + 19, y + 5 + BADGE_FONT * .89, BADGE_FONT,
    {'data-role': 'phase-status', fill: tone.ink}, badge.lines);
}

const NOTE_FONT = 17;
const NOTE_LINE = 20;

function milestoneNote(milestone, task, toX, measure, barVisible) {
  const {label, date} = milestone;
  if (!label && !date) return null;
  const anchor = toX(date || task.end, !date);
  const pending = !date ? translate('日期待定', 'Date TBD') : '';
  const name = [!barVisible ? task.label : '', label !== date ? label : ''].filter(Boolean).join(' · ');
  const lines = name ? wrap(name, 239, NOTE_FONT, measure) : [];
  const dateText = date || pending;
  const lineWidths = lines.map(line => measure(line, NOTE_FONT));
  const dateOffset = lines.length ? Math.ceil(lineWidths.at(-1)) + 10 : 0;
  const width = Math.ceil(Math.max(dateOffset + measure(dateText, 15, 600), ...lineWidths)) + 16;
  const height = 26 + Math.max(0, lines.length - 1) * NOTE_LINE;
  const positions = [anchor - 16 - width, anchor + 16]
    .filter(x => x >= CHART && x + width <= RIGHT)
    .map(x => ({x, left: Math.min(x, anchor - 12), right: Math.max(x + width, anchor + 12)}));
  return {anchor, width, height, lines, date, dateText, dateOffset, positions};
}

function placeNote(note, occupied, fits = () => true) {
  const position = note.positions.find(p => fits(p) && occupied.every(item =>
    p.right + 4 <= item.left || item.right + 4 <= p.left));
  if (!position) return false;
  note.x = position.x;
  occupied.push(position);
  return true;
}

function clearsBar(position, item, bar) {
  if (position.right + 3 <= bar.left || bar.right + 3 <= position.left) return true;
  // A marker may touch its own endpoint if the bar is still large enough to grab.
  if (bar !== item || bar.barWidth < 24) return false;
  const {anchor, width} = item.note;
  if (position.x < bar.right + 3 && position.x + width > bar.left - 3) return false;
  const labelLeft = bar.labelX - bar.labelWidth / 2, labelRight = bar.labelX + bar.labelWidth / 2;
  if (anchor + 14 > labelLeft && anchor - 14 < labelRight) return false;
  return bar.progress !== 100 || anchor - 12 >= bar.x + CHECK_GUTTER;
}

function layoutMilestones(items, bars, barY, barHeight, badgeHeight) {
  const besideBars = [], besideBadges = [], bands = [];
  for (const {badge} of bars) {
    if (badge) besideBadges.push({left: badge.x, right: badge.x + badge.width});
  }
  const notes = items.filter(item => item.note).sort((a, b) => a.note.anchor - b.note.anchor);
  for (const item of notes) {
    const note = item.note;
    if (note.height <= barHeight && placeNote(note, besideBars, p => bars.every(bar => clearsBar(p, item, bar)))) {
      note.y = barY + (barHeight - note.height) / 2;
    } else if (note.height <= badgeHeight && placeNote(note, besideBadges)) {
      note.y = barY - 6 - (badgeHeight + note.height) / 2;
    } else {
      let band = bands.find(band => placeNote(note, band.occupied));
      if (!band) {
        band = {occupied: [], notes: [], height: 0};
        placeNote(note, band.occupied);
        bands.push(band);
      }
      band.notes.push(note);
      band.height = Math.max(band.height, note.height);
    }
  }
  let bottom = barY + barHeight;
  for (const band of bands) {
    if (barHeight || bottom > barY) bottom += 7;
    for (const note of band.notes) note.y = bottom + (band.height - note.height) / 2;
    bottom += band.height;
  }
  return bottom;
}

function drawMilestone(stage, entry, bandY, fill, settings) {
  const {phase, note} = entry;
  const {anchor, x, width, height, lines, date, dateText} = note;
  const cy = bandY + height / 2;
  const annotation = node('g', {'data-edit-field': 'milestone'}, stage);
  const marker = node('g', {'data-role': date ? 'milestone' : 'phase-end-marker',
    'data-date': date, 'data-anchor': date ? 'date' : 'phase-end'}, annotation);
  node('title', {}, marker).textContent = [entry.milestone.label, dateText].filter(Boolean).join(' · ');
  shape(marker, anchor, cy, taskMilestoneShape(phase, settings), fill);
  node('rect', {x, y: bandY, width, height, rx: 5, fill: '#fff', 'data-role': 'milestone-callout'}, annotation);
  const tx = x + 8;
  const label = node('text', {x: tx, y: bandY + 19, 'font-family': FONT, 'font-weight': 700,
    fill: INK, 'data-role': 'milestone-label'}, annotation);
  for (const [i, line] of lines.entries()) {
    node('tspan', {x: tx, y: bandY + 19 + i * NOTE_LINE, 'font-size': NOTE_FONT}, label).textContent = line;
  }
  // The pending-date caption is separate so the supplied milestone name stays accessible verbatim.
  const dateParent = date ? label : annotation;
  const dateTag = date ? 'tspan' : 'text';
  node(dateTag, {x: tx + note.dateOffset, y: bandY + height - 7, 'font-family': FONT, 'font-size': 15,
    'font-weight': 600, fill: '#475569', 'data-role': 'milestone-date'}, dateParent).textContent = dateText;
}

function drawProgress(parent, defs, phase, barY, barHeight, color, projectIndex, offsetX, rowY) {
  const inset = Math.min(6, phase.barWidth * .1);
  const x = phase.x + inset, y = barY + 6;
  const width = phase.barWidth - 2 * inset - phase.tip, height = barHeight - 12;
  const geometry = {x, y, width, height, rx: Math.min(5, width / 2)};
  const layer = node('g', {class: 'bar-tracking-layer', 'pointer-events': 'none', 'aria-hidden': 'true'}, parent);
  const empty = phase.progress === 0;
  node('rect', {...geometry, class: 'bar-progress-track', fill: mix(color, empty ? .96 : .83),
    stroke: empty || phase.progress === 100 ? '#71808a' : mix(color, .55),
    'stroke-opacity': empty ? .8 : 1, 'stroke-width': 1.5, 'stroke-dasharray': empty ? '7 5' : null}, layer);
  const clipId = `simple-progress-${projectIndex}-${phase.fi}`;
  const clip = node('clipPath', {id: clipId}, defs);
  node('rect', geometry, clip);
  const paint = node('g', {'clip-path': `url(#${clipId})`, opacity: phase.phase.light ? .72 : null}, layer);
  const completed = {x, y, width: width * phase.progress / 100, height};
  const paintWeight = progressPaint(phase.progress);
  node('rect', {...completed, class: 'bar-progress', 'data-role': 'phase-progress',
    fill: `url(#simple-fill-${projectIndex})`, 'fill-opacity': phase.progress === 100 ? 1 : paintWeight.fillOpacity}, paint);
  if (phase.progress > 0 && phase.progress < 100) {
    node('rect', {...completed, class: 'bar-progress-texture', fill: progressStripes('simple', phase.progress),
      opacity: paintWeight.stripeOpacity}, paint);
  } else if (phase.progress === 100) {
    // Paint in chart coordinates so translated project rows share one light field.
    node('rect', {...completed, x: x + offsetX, y: y + rowY, transform: `translate(${-offsetX} ${-rowY})`,
      class: 'bar-complete-texture', fill: 'url(#simple-complete-sheen)'}, paint);
    const check = addCompletionCheck(layer);
    placeCompletionCheck(check, x, y, width, height, CHECK_SIZE,
      phase.labelX - phase.labelWidth / 2, phase.labelX + phase.labelWidth / 2);
  }
}

// The first calendar year uses months; later years use quarters. True civil
// dates interpolate inside each cell, without rounding task start/end dates.
function axisFor(start, end) {
  const initialYear = Number(start.slice(0, 4)), units = [];
  for (let index = monthIndex(start); index <= monthIndex(end);) {
    const year = Math.floor(index / 12), month = index % 12 + 1;
    const quarterly = year !== initialYear;
    const first = quarterly ? Math.floor((month - 1) / 3) * 3 + 1 : month;
    const last = quarterly ? first + 2 : month;
    const firstDate = iso(year, first), lastDate = iso(year, last, days(year, last));
    const a = coordinate(start > firstDate ? start : firstDate);
    const b = coordinate(end < lastDate ? end : lastDate, true);
    units.push({year, month: first, quarter: quarterly ? Math.ceil(first / 3) : null,
      a, b, weight: (b - a) * (quarterly ? 1.15 / 3 : 1)});
    index = year * 12 + last;
  }
  const total = units.reduce((sum, unit) => sum + unit.weight, 0);
  let x = CHART;
  for (const unit of units) {
    unit.x1 = x;
    unit.x2 = x + (RIGHT - CHART) * unit.weight / total;
    x = unit.x2;
  }
  const toX = (date, inclusive = false) => {
    const c = coordinate(date, inclusive);
    if (c <= units[0].a) return CHART;
    if (c >= units.at(-1).b) return RIGHT;
    const unit = units.find(unit => c <= unit.b);
    return unit.x1 + (c - unit.a) / (unit.b - unit.a) * (unit.x2 - unit.x1);
  };
  const toDate = x => {
    if (x <= CHART) return start;
    if (x >= RIGHT) return end;
    const unit = units.find(unit => x <= unit.x2) || units.at(-1);
    const c = unit.a + (x - unit.x1) / (unit.x2 - unit.x1) * (unit.b - unit.a);
    const index = Math.floor(c + 1e-9), year = Math.floor(index / 12), month = index % 12 + 1;
    const day = clamp(1 + Math.floor((c - index) * days(year, month) + 1e-8), 1, days(year, month));
    return iso(year, month, day);
  };
  return {units,toX,toDate};
}

function projectIcon(parent,project,x,cy,fill){const icon=String(project.icon??'▣');if(!icon)return;const kind={'★':'trophy','⚙':'gear','▣':'screen','⬡':'shield','●':'people','⌘':'network','◎':'search'}[icon];if(!kind||project.locks?.icon){return text(parent,icon,x,cy+17,48,{fill,'text-anchor':'middle','data-role':'project-icon'});}
  const g=node('g',{transform:`translate(${x-26} ${cy-26}) scale(1.0833)`,fill,stroke:fill,'stroke-width':3,'stroke-linejoin':'round','data-role':'project-icon'},parent);node('title',{},g).textContent=icon;
  if(kind==='trophy'){node('path',{d:'M 12 4 H 36 V 16 Q 36 29 24 31 Q 12 29 12 16 Z'},g);node('path',{d:'M 12 8 H 5 V 15 Q 5 25 17 25 M 36 8 H 43 V 15 Q 43 25 31 25',fill:'none'},g);node('path',{d:'M 24 29 V 39 M 15 43 H 33 M 18 39 H 30',fill:'none','stroke-width':5},g);}
  if(kind==='gear'){for(let i=0;i<8;i++)node('rect',{x:19,y:2,width:10,height:13,rx:1,transform:`rotate(${i*45} 24 24)`},g);node('circle',{cx:24,cy:24,r:16},g);node('circle',{cx:24,cy:24,r:7,fill:'#fff',stroke:'none'},g);}
  if(kind==='screen'){node('rect',{x:5,y:5,width:38,height:29,rx:2,fill:'none','stroke-width':4},g);node('path',{d:'M 24 35 V 43 M 13 44 H 35',fill:'none','stroke-width':4},g);}
  if(kind==='shield'){node('path',{d:'M 24 3 Q 33 10 43 11 V 25 Q 39 38 24 46 Q 9 38 5 25 V 11 Q 15 10 24 3 Z'},g);node('path',{d:'M 24 10 V 38 Q 34 31 36 23 V 16 Q 29 14 24 10',fill:'#fff',stroke:'none'},g);}
  if(kind==='people'){node('circle',{cx:24,cy:12,r:8,stroke:'none'},g);node('circle',{cx:7,cy:19,r:6,stroke:'none'},g);node('circle',{cx:41,cy:19,r:6,stroke:'none'},g);node('path',{d:'M 12 45 V 34 Q 12 22 24 22 Q 36 22 36 34 V 45 Z M 0 44 V 33 Q 0 26 8 26 L 13 28 Q 8 35 9 44 Z M 39 44 Q 40 35 35 28 L 40 26 Q 48 26 48 33 V 44 Z',stroke:'none'},g);}
  if(kind==='network'){node('path',{d:'M 12 24 L 36 8 M 12 24 L 36 40 M 12 24 H 40',fill:'none','stroke-width':5},g);for(const[cx,cy,r]of[[10,24,9],[37,8,8],[37,40,8]])node('circle',{cx,cy,r,stroke:'#fff','stroke-width':1.5},g);}
  if(kind==='search'){node('circle',{cx:16,cy:14,r:7,stroke:'none'},g);node('path',{d:'M 2 40 V 30 Q 2 22 13 22 H 21 V 40 Z',stroke:'none'},g);node('circle',{cx:29,cy:20,r:13,fill:'white','stroke-width':4},g);node('path',{d:'M 38 31 L 47 42',fill:'none','stroke-width':6},g);}
}

/** Reference-style overview. Dates, locks and all supplied metadata stay intact. */
export function renderSimple(model,options={}){
  if(!record(model)||!Array.isArray(model.projects))throw new Error(translate('圖表的專案資料格式不正確','Invalid project data for the chart'));
  const settings={...(record(model.presentation)?model.presentation:{}),...options},width=Number(settings.width||3840),height=Number(settings.height||2160);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<320||height<180||width>16384||height>9216||Math.abs(width/height-16/9)>.001)throw new Error(translate('簡易圖片尺寸須為16:9，且介於320×180及16384×9216','Picture dimensions must be 16:9 and between 320×180 and 16384×9216.'));
  const dates=[];let phaseCount=0;for(const p of model.projects){if(!record(p)||!Array.isArray(p.phases))throw new Error(translate('專案的任務資料格式不正確','Invalid task data in the project'));for(const f of p.phases){if(!record(f)||!isValidDate(f.start)||!isValidDate(f.end)||f.start>f.end)throw new Error(translate('階段起訖日期無效','Invalid task start or end date'));dates.push(f.start,f.end);const m=readTaskMilestone(f);if(m.date)dates.push(m.date);phaseCount++;}}
  const now=new Date(),fallback=iso(now.getFullYear(),now.getMonth()+1,now.getDate()),minimum=dates.length?dates.reduce((a,b)=>a<b?a:b):fallback,maximum=dates.length?dates.reduce((a,b)=>a>b?a:b):fallback;
  const {start,end}=pictureDisplayRange(settings,minimum,maximum);
  if(monthIndex(end)-monthIndex(start)>1200)throw new Error(translate('圖片日期範圍過大，請縮小到100年內','The picture spans more than 100 years. Shorten its date range.'));
  const {units,toX,toDate}=axisFor(start,end),measure=measureText(),markerShape=settings.milestoneShape==='star'?'star':'circle';
  const dateLine=pictureDateLine(settings),today=dateLine?.date,todayX=today&&today>=start&&today<=end?toX(today):null;
  const headerHeight = todayX === null ? 138 : 162;
  const title=typeof settings.title==='string'&&settings.title.trim()?settings.title:typeof model.title==='string'&&model.title.trim()?model.title:translate('專案時程規劃','Project roadmap'),titleLines=wrap(title,RIGHT-LEFT-24,70,measure,900),headingY=52+titleLines.length*80,bodyY=headingY+headerHeight;
  const layouts=model.projects.map((project,pi)=>{
    const fill=color(project.color),projectFont=size(project.fontSize,30),projectName=String(project.name??translate('未命名專案','Untitled project')),projectLines=wrap(projectName,CHART-196,projectFont,measure),status=typeof project.status==='string'?project.status:'',statusLines=status?wrap(status,CHART-196,16,measure):[],lanes=[];
    const phases = [];
    for (const [fi, phase] of project.phases.entries()) {
      const milestone = readTaskMilestone(phase);
      const barVisible = phase.end >= start && phase.start <= end;
      const stamp = milestone.date || phase.end;
      const note = stamp >= start && stamp <= end ? milestoneNote(milestone, phase, toX, measure, barVisible) : null;
      if (!barVisible && !note) continue;
      const label = String(phase.label ?? translate('未命名階段', 'Untitled task'));
      const progress = taskProgress(phase.progress);
      const icon = typeof phase.icon === 'string' ? phase.icon : '';
      const caption = [icon, label].filter(Boolean).join(' ') + (progress === null ? '' : ' · ' + progress + '%');
      const outside = phase.start < start || phase.end > end ? 'partial' : 'inside';
      const x = clamp(toX(phase.start), CHART + 3, RIGHT - 6);
      const barWidth = Math.max(3, clamp(toX(phase.end, true), x + 3, RIGHT - 3) - x);
      const badge = barVisible && typeof phase.status === 'string' ? statusBadge(phase.status.trim(), x, measure) : null;
      const arrow = phase.open_end && phase.end <= end, tip = arrow ? Math.min(20, barWidth * .1) : 0;
      const gutter = progress === 100 ? CHECK_GUTTER : 0;
      const outsideLabel = barWidth < 32 || ((badge || progress !== null) && barWidth < 85)
        || (phase.fontSize && size(phase.fontSize, 0) > barWidth - tip - gutter - 6);
      const available = outsideLabel ? 220 : Math.max(8, barWidth - tip - gutter - 10);
      const {fontSize, lines, labelWidth} = fitCaption(caption, available, phase.fontSize, measure);
      let labelX = x + (barWidth - tip + gutter) / 2;
      if (outsideLabel) {
        labelX = x + barWidth + 12 + labelWidth / 2;
        if (labelX + labelWidth / 2 > RIGHT) labelX = x - 12 - labelWidth / 2;
        labelX = clamp(labelX, CHART + labelWidth / 2 + 4, RIGHT - labelWidth / 2 - 4);
      }
      const left = Math.min(x, labelX - labelWidth / 2 - 2), right = Math.max(x + barWidth, labelX + labelWidth / 2 + 2);
      const entry = {phase, fi, label, caption, progress, badge, barVisible, outside, arrow, tip,
        x, barWidth, outsideLabel, labelX, labelWidth, fontSize, lines, left, right, milestone, note};
      let lane = project.pictureTaskLayout === 'ordered' ? -1 : lanes.findIndex(items => items.every(item => {
        const barsApart = !barVisible || !item.barVisible || right <= item.left + .01 || left + .01 >= item.right;
        const badgesApart = !badge || !item.badge || badge.x + badge.width + 4 <= item.badge.x || item.badge.x + item.badge.width + 4 <= badge.x;
        return barsApart && badgesApart;
      }));
      if (lane < 0) { lane = lanes.length; lanes.push([]); }
      entry.lane = lane;
      lanes[lane].push(entry);
      phases.push(entry);
    }
    let lanesHeight = 0;
    const laneOffsets = lanes.map(items => {
      const bars = items.filter(item => item.barVisible);
      const badgeHeight = Math.max(0, ...items.map(item => item.badge?.height ?? 0));
      const barHeight = bars.length ? Math.max(58, ...bars.map(item => item.lines.length * item.fontSize * 1.15 + 22)) : 0;
      const barY = lanesHeight + (badgeHeight ? badgeHeight + 6 : 0);
      lanesHeight = layoutMilestones(items, bars, barY, barHeight, badgeHeight) + 10;
      return {barY, barHeight};
    });
    const leftHeight = projectLines.length * projectFont * 1.15 + statusLines.length * 18.4 + 24;
    return {project,pi,fill,projectFont,projectName,projectLines,status,statusLines,phases,laneOffsets,lanesHeight,
      height: Math.max(96, leftHeight, lanesHeight + 20)};
  });
  const rowsHeight=layouts.reduce((n,l)=>n+l.height,0),viewHeight=Math.max(1080,bodyY+Math.max(rowsHeight,110)+48),viewWidth=viewHeight*16/9,offsetX=(viewWidth-WIDTH)/2;
  const svg=node('svg',{xmlns:NS,width,height,viewBox:`0 0 ${viewWidth} ${viewHeight}`,class:'roadmap-simple',role:'img','aria-label':title,'data-simple':'true','data-start':start,'data-end':end,'data-layout-scale':Math.min(1,1080/viewHeight),'data-axis-kind':'month-quarter','data-project-count':model.projects.length,'data-phase-count':phaseCount});
  node('title',{},svg).textContent=title;node('desc',{},svg).textContent=translate(`共${model.projects.length}個專案、${phaseCount}個階段；期間${start}至${end}。`,`${model.projects.length} projects and ${phaseCount} tasks, from ${start} to ${end}.`);
  node('rect',{x:0,y:0,width:viewWidth,height:viewHeight,fill:'#fff'},svg);const defs=node('defs',{},svg),content=node('g',{transform:`translate(${offsetX} 0)`},svg);
  addProgressPatterns(defs, 'simple', layouts.flatMap(layout => layout.phases.filter(phase => phase.barVisible).map(phase => phase.progress)));
  if (layouts.some(layout => layout.phases.some(phase => phase.barVisible && phase.progress === 100))) addCompletionSheen(defs, 'simple-complete-sheen', options.completionLight);
  const header=node('linearGradient',{id:'simple-header',x1:0,y1:0,x2:1,y2:1},defs);node('stop',{offset:'0%','stop-color':'#d5e0ef'},header);node('stop',{offset:'100%','stop-color':'#e8edf6'},header);
  // Leave room for the full CJK font box, which can exceed its ink ascent in Firefox.
  text(content,title,24,100,70,{'font-weight':900,'data-role':'title'},titleLines);
  node('rect',{x:LEFT,y:headingY,width:RIGHT-LEFT,height:headerHeight,rx:12,fill:'#fff',stroke:GRID,'data-role':'calendar-header'},content);node('path',{d:`M ${LEFT+12} ${headingY} H ${RIGHT-12} Q ${RIGHT} ${headingY} ${RIGHT} ${headingY+12} V ${headingY+62} H ${CHART} V ${bodyY} H ${LEFT} V ${headingY+12} Q ${LEFT} ${headingY} ${LEFT+12} ${headingY}`,fill:'url(#simple-header)'},content);
  const projectHeader=translate('專案項目','Projects');blockText(content,projectHeader,(LEFT+CHART)/2,headingY+69,40,'project-header',[projectHeader],INK);
  const years=[];for(const u of units){const previous=years.at(-1);if(previous?.year===u.year)previous.x2=u.x2;else years.push({year:u.year,x1:u.x1,x2:u.x2});}
  let lastYearRight = -Infinity;
  for (const y of years) {
    const label = String(y.year), font = clamp((y.x2 - y.x1 - 8) / measure(label, 1), 17, 44);
    const w = measure(label, font), cx = clamp((y.x1 + y.x2) / 2, CHART + w / 2 + 4, RIGHT - w / 2 - 4);
    if (cx - w / 2 > lastYearRight + 6) {
      blockText(content, label, cx, headingY + 31, font, 'year', [label], '#172d4c');
      lastYearRight = cx + w / 2;
    }
    if (y.x1 > CHART) node('line', {x1:y.x1, x2:y.x1, y1:headingY, y2:bodyY+rowsHeight,
      stroke:'#afc5e1','stroke-width':2,'stroke-dasharray':'6 3'}, content);
  }
  for (const u of units) {
    const cx = (u.x1 + u.x2) / 2, cellWidth = u.x2 - u.x1 - 4;
    const label = u.quarter ? 'Q' + u.quarter : monthLabel(u.month);
    const font = Math.min(u.quarter ? 30 : 32, cellWidth * 32 / measure(label, 32));
    if (font >= 14) {
      const months = u.quarter ? translate(`${u.month}-${u.month+2}月`, `${shortMonth(u.month)}–${shortMonth(u.month+2)}`) : '';
      const subFont = months ? Math.min(25, cellWidth * 25 / measure(months, 25)) : 0;
      const twoLines = subFont >= 14;
      blockText(content, label, cx, headingY + (twoLines ? 86 : 102), font,
        u.quarter ? 'quarter' : 'month', [label], '#172d4c');
      if (twoLines) blockText(content, months, cx, headingY + 116, subFont, 'quarter-months', [months], '#405774');
    }
    node('line',{x1:u.x1,x2:u.x1,y1:headingY+62,y2:bodyY+rowsHeight,stroke:GRID,'stroke-width':1},content);
  }
  if(todayX!==null){node('line',{x1:todayX,x2:todayX,y1:headingY+62,y2:bodyY,stroke:'#c4414a','stroke-width':2,'stroke-dasharray':'6 4','data-role':'today-line','data-date':today},content);text(content,dateLine.label,clamp(todayX+7,CHART+8,RIGHT-measure(dateLine.label,17)-4),bodyY-7,17,{'data-role':'today-label',fill:'#a3313e'});}
  let rowY=bodyY;
  for(const l of layouts){
    const{project,pi,fill,phases}=l,group=node('g',{transform:`translate(0 ${rowY})`,'data-project-id':project.id??`project-${pi}`,'data-project-index':pi,'data-row-height':l.height},content);
    node('rect',{x:LEFT,y:0,width:RIGHT-LEFT,height:l.height,fill:'#fff',stroke:GRID,'data-role':'project-row'},group);
    for(const unit of units)node('line',{x1:unit.x1,x2:unit.x1,y1:0,y2:l.height,stroke:unit.quarter===1?'#afc5e1':GRID,'stroke-width':unit.quarter===1?1.5:1,'stroke-dasharray':unit.quarter===1?'6 3':null},group);
    if(todayX!==null)node('line',{x1:todayX,x2:todayX,y1:0,y2:l.height,stroke:'#c4414a','stroke-width':2,'stroke-dasharray':'6 4','data-role':'today-line','data-date':today},group);
    const gradient=node('linearGradient',{id:`simple-fill-${pi}`,x1:'0%',y1:'0%',x2:'100%',y2:'25%'},defs);node('stop',{offset:'0%','stop-color':fill},gradient);node('stop',{offset:'100%','stop-color':mix(fill,.3)},gradient);
    const label=node('g',{'data-role':'project-label'},group);
    node('rect',{x:LEFT,y:0,width:CHART-LEFT,height:l.height,fill:mix(fill,.9)},label);
    node('circle',{cx:56,cy:l.height/2,r:30,fill,stroke:'#fff','stroke-width':2,'data-role':'project-badge'},label);blockText(label,String(pi+1),56,l.height/2,38,'project-number',[String(pi+1)],'#fff');projectIcon(label,project,131,l.height/2,fill);
    const nameHeight=l.projectLines.length*l.projectFont*1.15+l.statusLines.length*18.4;blockText(label,l.projectName,184+(CHART-196)/2,(l.height-nameHeight)/2+l.projectLines.length*l.projectFont*1.15/2,l.projectFont,'project-name',l.projectLines,INK);
    if(l.status)blockText(label,l.status,184+(CHART-196)/2,(l.height+nameHeight)/2-l.statusLines.length*18.4/2,16,'project-status',l.statusLines,'#405774');
    const top = (l.height - l.lanesHeight + 10) / 2;
    const leaders = node('g', {'aria-hidden': 'true', 'pointer-events': 'none'}, group);
    for (const t of phases) {
      const f = t.phase;
      const {barY, barHeight} = l.laneOffsets[t.lane];
      const y = top + barY, cy = y + barHeight / 2;
      const stage = node('g', {'data-phase-id': f.id ?? `project-${pi}-phase-${t.fi}`,
        'data-phase-index':t.fi, 'data-start':f.start, 'data-end':f.end, 'data-range-state':t.outside, 'data-lane':t.lane}, group);
      const dateRange = f.start + ' — ' + (f.open_end ? translate('結束未定','End date not set') : f.end);
      const milestoneText = [t.milestone.label !== t.milestone.date ? t.milestone.label : '',
        t.milestone.date || (t.milestone.label && translate('日期待定', 'Date TBD'))].filter(Boolean).join(' · ');
      node('title', {}, stage).textContent = [t.caption, t.badge?.status, dateRange, milestoneText].filter(Boolean).join('\n');
      if (t.barVisible) {
        const d = barPath(t.x, y, t.barWidth, barHeight, t.arrow);
        const opacity = t.progress === 0 ? (f.light ? .05 : .09) : f.light ? .4 : t.progress === null ? 1 : .22;
        node('path',{d, x:t.x, y, width:t.barWidth, height:barHeight, fill:`url(#simple-fill-${pi})`,
          opacity, stroke:'#fff', 'stroke-width':1.5,'data-role':'phase-bar'},stage);
        if(t.progress!==null)drawProgress(stage,defs,t,y,barHeight,fill,pi,offsetX,rowY);
        if(t.badge)drawStatus(stage,t.badge,y-6);
        if(t.arrow)node('path',{d:`M ${t.x+t.barWidth-t.tip} ${y} L ${t.x+t.barWidth} ${cy} L ${t.x+t.barWidth-t.tip} ${y+barHeight}`,fill:'none',stroke:fill,'stroke-width':2,'data-role':'open-end'},stage);
        const textFill = t.outsideLabel || t.progress !== null || f.light || luminance(fill) > .4 ? INK : '#fff';
        const labelNode = blockText(stage, t.caption, t.labelX, cy, t.fontSize, 'phase-label', t.lines, textFill);
        if (t.progress !== null && !t.outsideLabel) {
          labelNode.setAttribute('paint-order', 'stroke');
          labelNode.setAttribute('stroke', '#fff');
          labelNode.setAttribute('stroke-width', '2');
          labelNode.setAttribute('stroke-linejoin', 'round');
        }
      }
      if (t.note) {
        if (t.barVisible) {
          const anchor = t.note.anchor, origin = clamp(anchor, t.x, t.x + t.barWidth);
          const markerY = top + t.note.y + t.note.height / 2;
          const base = clamp(markerY, y, y + barHeight), rail = clamp(markerY, y - 2, y + barHeight + 2);
          node('path', {d: `M ${origin} ${base} V ${rail} H ${anchor} V ${markerY}`,
            fill: 'none', stroke: mix(fill, .42), 'stroke-width': 1.5, 'stroke-dasharray': t.note.date ? null : '3 3'}, leaders);
        }
        drawMilestone(stage, t, top + t.note.y, fill, settings);
      }
    }
    if(!phases.length&&!project.phases.length){const empty=translate('尚無階段','No tasks yet');blockText(group,empty,CHART+140,l.height/2,24,'empty-project',[empty],'#63758a');}rowY+=l.height;
  }
  node('rect',{x:LEFT,y:headingY,width:RIGHT-LEFT,height:headerHeight+rowsHeight,rx:10,fill:'none',stroke:GRID,'stroke-width':1.5},content);
  svg.xAtDate = (date, inclusive = false) => offsetX + toX(date, inclusive);
  svg.dateAtX = x => toDate(x - offsetX);
  svg.layoutInfo={width,height,range:{start,end},projects:model.projects.length,phases:phaseCount,scale:Math.min(1,1080/viewHeight),milestoneShape:markerShape,axis:'first-year-months-then-quarters'};node('metadata',{'data-role':'layout-info'},svg).textContent=JSON.stringify(svg.layoutInfo);return svg;
}
