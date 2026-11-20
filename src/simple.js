import { isValidDate, taskProgress } from './model.js';
import { pictureDisplayRange, pictureDateLine } from './align-start.js';
import { t as translate } from './i18n.js';

const NS='http://www.w3.org/2000/svg';
const FONT='"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const INK='#071f49', GRID='#dce8f6';
const LEFT=12, CHART=420, RIGHT=1908, WIDTH=1920;
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
function node(tag,attrs={},parent){const el=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))if(v!=null)el.setAttribute(k,String(v));parent?.append(el);return el;}
function measureText(){const c=document.createElement('canvas').getContext('2d');return(s,font,weight=700)=>{if(!c)return Array.from(String(s)).reduce((n,a)=>n+font*(/[^\x00-\xff]/.test(a)?1:.58),0);c.font=`${weight} ${font}px ${FONT}`;const metrics=c.measureText(String(s));return Math.max(metrics.width,(metrics.actualBoundingBoxLeft||0)+(metrics.actualBoundingBoxRight||0));};}
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
function text(parent,value,x,y,font,attrs={},lines){const el=node('text',{x,y,fill:INK,'font-family':FONT,'font-size':font,'font-weight':700,...attrs},parent);(lines||[String(value??'')]).forEach((line,i)=>{node('tspan',{x,dy:i?font*1.15:0},el).textContent=line;});return el;}
function blockText(parent,value,x,cy,font,role,lines,fill){return text(parent,value,x,cy-(lines.length-1)*font*1.15/2+font*.35,font,{'text-anchor':'middle',fill,'data-role':role},lines);}
function mix(value,amount){const c=color(value);return '#'+[1,3,5].map(i=>Math.round(parseInt(c.slice(i,i+2),16)*(1-amount)+255*amount).toString(16).padStart(2,'0')).join('');}
function luminance(value){const c=color(value);const a=[1,3,5].map(i=>{const n=parseInt(c.slice(i,i+2),16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
function milestoneOf(phase){const v=phase.milestone,label=typeof v==='string'?v:record(v)&&typeof v.label==='string'?v.label:'';const candidate=phase.milestoneDate||(record(v)?v.date:null)||(isValidDate(label)?label:null);return{label,date:isValidDate(candidate)?candidate:null};}
function shape(parent,x,y,kind,fill,role='milestone-symbol'){if(kind==='star'){const points=Array.from({length:10},(_,i)=>{const r=i%2?5:11,a=-Math.PI/2+i*Math.PI/5;return`${x+Math.cos(a)*r},${y+Math.sin(a)*r}`;}).join(' ');return node('polygon',{points,fill,stroke:'#fff','stroke-width':2,'data-role':role,'data-shape':kind},parent);}return node('circle',{cx:x,cy:y,r:9,fill,stroke:'#fff','stroke-width':2,'data-role':role,'data-shape':'circle'},parent);}
function barPath(x,y,w,h,arrow){const r=Math.min(10,w/4,h/4),tip=arrow?Math.min(20,w*.1):0;return`M ${x+r} ${y} H ${x+w-tip-r} Q ${x+w-tip} ${y} ${x+w-tip} ${y+r} ${arrow?`L ${x+w} ${y+h/2} L ${x+w-tip} ${y+h-r}`:`V ${y+h-r}`} Q ${x+w-tip} ${y+h} ${x+w-tip-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;}

const BADGE_FONT = 17;
function statusBadge(status, barX, measure) {
  if (!status) return null;
  const lines = wrap(status, 280, BADGE_FONT, measure);
  const width = Math.ceil(lines.reduce((widest, line) => Math.max(widest, measure(line, BADGE_FONT)), 0)) + 20;
  return { status, lines, width, height: lines.length * BADGE_FONT * 1.15 + 10, x: Math.min(barX, RIGHT - width - 3) };
}

function drawStatus(parent, badge, bottom, color) {
  const y = bottom - badge.height;
  const group = node('g', {'data-role': 'phase-status-badge', 'aria-label': badge.status}, parent);
  node('rect', {x: badge.x, y, width: badge.width, height: badge.height, rx: 7,
    fill: mix(color, .93), stroke: mix(color, .47), 'stroke-width': 1.2}, group);
  text(group, badge.status, badge.x + 10, y + 5 + BADGE_FONT * .89, BADGE_FONT,
    {'data-role': 'phase-status'}, badge.lines);
}

function drawProgress(parent, defs, phase, barY, barHeight, color, projectIndex) {
  const inset = Math.min(6, phase.barWidth * .1);
  const x = phase.x + inset, y = barY + 6;
  const width = phase.barWidth - 2 * inset - phase.tip, height = barHeight - 12;
  const geometry = {x, y, width, height, rx: Math.min(5, width / 2)};
  const layer = node('g', {class: 'bar-tracking-layer', 'pointer-events': 'none', 'aria-hidden': 'true'}, parent);
  node('rect', {...geometry, class: 'bar-progress-track', fill: mix(color, .83),
    stroke: mix(color, .55), 'stroke-width': 1}, layer);
  const clipId = `simple-progress-${projectIndex}-${phase.fi}`;
  const clip = node('clipPath', {id: clipId}, defs);
  node('rect', geometry, clip);
  const paint = node('g', {'clip-path': `url(#${clipId})`}, layer);
  const completed = {x, y, width: width * phase.progress / 100, height};
  node('rect', {...completed, class: 'bar-progress', 'data-role': 'phase-progress',
    fill: `url(#simple-fill-${projectIndex})`}, paint);
  if (phase.progress > 0 && phase.progress < 100) {
    node('rect', {...completed, class: 'bar-progress-texture', fill: 'url(#simple-progress-stripes)'}, paint);
  }
}

function defineProgressStripes(defs) {
  const pattern = node('pattern', {id: 'simple-progress-stripes', class: 'bar-progress-pattern',
    patternUnits: 'userSpaceOnUse', width: 16, height: 16}, defs);
  node('path', {class: 'bar-progress-motion', d: 'M-16 16l16-16 M0 16L16 0 M16 16L32 0 M32 16L48 0',
    fill: 'none', stroke: '#fff', 'stroke-opacity': .26, 'stroke-width': 4}, pattern);
}

// The first calendar year uses months; later years use quarters. True civil
// dates interpolate inside each cell, without rounding task start/end dates.
function axisFor(start,end){const initial=Number(start.slice(0,4)),units=[];for(let i=monthIndex(start);i<=monthIndex(end);){const y=Math.floor(i/12),m=i%12+1,quarter=y!==initial,beginMonth=quarter?Math.floor((m-1)/3)*3+1:m,last=quarter?beginMonth+2:m;const unitStart=iso(y,beginMonth),unitEnd=iso(y,last,days(y,last));const a=coordinate(start>unitStart?start:unitStart),b=coordinate(end<unitEnd?end:unitEnd,true);units.push({year:y,month:beginMonth,quarter:quarter?Math.floor((beginMonth-1)/3)+1:null,a,b,weight:(quarter?1.15:1)*(b-a)/(quarter?3:1)});i=y*12+last;}
  const total=units.reduce((n,u)=>n+u.weight,0);let x=CHART;for(const u of units){u.x1=x;u.x2=x+(RIGHT-CHART)*u.weight/total;x=u.x2;}const toX=(date,inclusive=false)=>{const c=coordinate(date,inclusive);if(c<=units[0].a)return CHART;if(c>=units.at(-1).b)return RIGHT;const u=units.find(u=>c>=u.a&&c<=u.b);return u.x1+(c-u.a)/(u.b-u.a)*(u.x2-u.x1);};return{units,toX};}

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
  const dates=[];let phaseCount=0;for(const p of model.projects){if(!record(p)||!Array.isArray(p.phases))throw new Error(translate('專案的任務資料格式不正確','Invalid task data in the project'));for(const f of p.phases){if(!record(f)||!isValidDate(f.start)||!isValidDate(f.end)||f.start>f.end)throw new Error(translate('階段起訖日期無效','Invalid task start or end date'));dates.push(f.start,f.end);const m=milestoneOf(f);if(m.date)dates.push(m.date);phaseCount++;}}
  const now=new Date(),fallback=iso(now.getFullYear(),now.getMonth()+1,now.getDate()),minimum=dates.length?dates.reduce((a,b)=>a<b?a:b):fallback,maximum=dates.length?dates.reduce((a,b)=>a>b?a:b):fallback;
  const {start,end}=pictureDisplayRange(settings,minimum,maximum);
  if(monthIndex(end)-monthIndex(start)>1200)throw new Error(translate('圖片日期範圍過大，請縮小到100年內','The picture spans more than 100 years. Shorten its date range.'));
  const {units,toX}=axisFor(start,end),measure=measureText(),markerShape=settings.milestoneShape==='star'?'star':'circle';
  const title=typeof settings.title==='string'&&settings.title.trim()?settings.title:typeof model.title==='string'&&model.title.trim()?model.title:translate('專案時程規劃','Project roadmap'),titleLines=wrap(title,RIGHT-LEFT-24,70,measure,900),headingY=52+titleLines.length*80,bodyY=headingY+138;
  const layouts=model.projects.map((project,pi)=>{
    const fill=color(project.color),projectFont=size(project.fontSize,30),projectName=String(project.name??translate('未命名專案','Untitled project')),projectLines=wrap(projectName,CHART-196,projectFont,measure),status=typeof project.status==='string'?project.status:'',statusLines=status?wrap(status,CHART-196,16,measure):[],lanes=[];
    const phases=project.phases.map((phase,fi)=>({phase,fi})).filter(({phase})=>phase.end>=start&&phase.start<=end).map(({phase,fi})=>{
      const label=String(phase.label??translate('未命名階段','Untitled task')),phaseIcon=typeof phase.icon==='string'?phase.icon:'',progress=taskProgress(phase.progress),status=typeof phase.status==='string'?phase.status.trim():'',outside=phase.start<start||phase.end>end?'partial':'inside';
      const x=clamp(toX(phase.start),CHART+3,RIGHT-6),barWidth=Math.max(3,clamp(toX(phase.end,true),x+3,RIGHT-3)-x);
      const outsideLabel = barWidth < 32 || ((status || progress !== null) && barWidth < 85);
      const actualMilestone=milestoneOf(phase),milestone=actualMilestone.date&&(actualMilestone.date<start||actualMilestone.date>end)?{label:'',date:null}:actualMilestone,inline=!outsideLabel&&!!milestone.label&&!milestone.date&&milestone.label.length<=8&&barWidth<170;
      const caption=`${phaseIcon?phaseIcon+' ':''}${label}${progress===null?'':' · '+progress+'%'}`;
      const badge = statusBadge(status, x, measure);
      const arrow=!inline&&phase.end<=end&&(phase.open_end||fi===project.phases.length-1),tip=arrow?Math.min(20,barWidth*.1):0,markerSpace=milestone.label||milestone.date||fi<project.phases.length-1?7:0;
      const leftMarkerSpace=fi>0?9:0,available=outsideLabel?220:Math.max(8,barWidth-tip-markerSpace-leftMarkerSpace-4),units=Array.from(caption).reduce((sum,char)=>sum+(/[^\x00-\xff]/.test(char)?1:.55),0);
      let autoFont=clamp(available/Math.max(1,inline?units:Math.ceil(units/2))-.1,14,28);
      // Actual CJK font metrics differ by engine. Keep automatic captions within
      // two lines when space permits; an authored font size always takes priority.
      while(autoFont>12&&(wrap(caption,Math.max(autoFont,available),autoFont,measure).length>(inline?1:2)||Math.max(...wrap(caption,Math.max(autoFont,available),autoFont,measure).map(line=>measure(line,autoFont)))>available-4))autoFont=Math.max(12,autoFont-.25);
      const fontSize=size(phase.fontSize,autoFont),contentWidth=Math.max(fontSize,available),lines=wrap(caption,contentWidth,fontSize,measure);
      const mileFont=inline?Math.min(20,fontSize*.8,contentWidth/Math.max(.1,measure(milestone.label,1))-.1):20,mileLines=inline?[milestone.label]:[],labelHeight=lines.length*fontSize*1.15,mileHeight=mileLines.length*mileFont*1.15;
      const calloutValue=milestone.date?`${milestone.date}${milestone.label&&milestone.label!==milestone.date?'\n'+milestone.label:''}`:milestone.label;
      const calloutLines=!inline&&calloutValue?wrap(calloutValue.replace(/(\d{4}\/\d{1,2}|\d{4}\s*下半年)\s+/,'$1\n'),232,22,measure):[],needed=Math.max(labelHeight+(inline?mileHeight+3:0)+24,calloutLines.length*25.3+20);
      const labelWidth = Math.max(...lines.map(line => measure(line, fontSize)));
      let labelX = x + leftMarkerSpace + (barWidth - tip - markerSpace - leftMarkerSpace) / 2;
      let left = x, right = x + barWidth;
      if (outsideLabel) {
        // A tracked one-day task has room for its dates but rarely for a caption.
        // Reserve its external caption in the same lane as the task.
        labelX = right + 12 + labelWidth / 2;
        if (labelX + labelWidth / 2 > RIGHT) labelX = left - 12 - labelWidth / 2;
        left = Math.min(left, labelX - labelWidth / 2 - 6);
        right = Math.max(right, labelX + labelWidth / 2 + 6);
      }
      const datedMarkerX = milestone.date ? clamp(toX(milestone.date), CHART + 12, RIGHT - 12) : null;
      let lane = lanes.findIndex(items => items.every(item => {
        const barsApart = right <= item.left + .01 || left + .01 >= item.right;
        const badgesApart = !badge || !item.badge || badge.x + badge.width + 4 <= item.badge.x || item.badge.x + item.badge.width + 4 <= badge.x;
        const markersApart = datedMarkerX === null || item.datedMarkerX === null || Math.abs(datedMarkerX - item.datedMarkerX) >= 24;
        return barsApart && badgesApart && markersApart;
      }));
      if (lane < 0) { lane = lanes.length; lanes.push([]); }
      lanes[lane].push({left, right, badge, datedMarkerX});
      return{phase,fi,label,phaseIcon,badge,progress,milestone,outside,outsideLabel,labelX,labelWidth,x,barWidth,fontSize,caption,lines,mileLines,mileFont,labelHeight,mileHeight,needed,inline,arrow,tip,markerSpace,leftMarkerSpace,calloutValue,calloutLines,lane};
    });
    const barHeight=Math.max(64,...phases.map(f=>f.needed)),leftHeight=projectLines.length*projectFont*1.15+statusLines.length*18.4+24;
    let lanesHeight = 0;
    const laneOffsets = lanes.map(items => {
      const badgeHeight = Math.max(...items.map(item => item.badge?.height ?? 0));
      // Dated markers sit above the bar. Keep their own band below the status.
      const hasDatedMarker = items.some(item => item.datedMarkerX !== null);
      const badgeGap = hasDatedMarker ? 23 : 5;
      const clearance = hasDatedMarker && lanesHeight > 0 ? 11 : 0;
      const barY = lanesHeight + (badgeHeight ? badgeHeight + badgeGap : clearance);
      lanesHeight = barY + barHeight + 12;
      return {barY, badgeGap};
    });
    const occupied=phases.map(t=>({left:t.labelX-t.labelWidth/2,right:t.labelX+t.labelWidth/2,lane:t.lane}));
    for(const t of phases){if(!t.milestone.date&&(t.milestone.label||t.fi<phases.length-1)){const x=clamp(t.x+t.barWidth,CHART+12,RIGHT-12);occupied.push({left:x-11,right:x+11,lane:t.lane});}}
    let annotationHeight=0;
    for(const t of phases){if(!t.calloutLines.length)continue;
      const anchor=t.milestone.date?clamp(toX(t.milestone.date),CHART+12,RIGHT-12):clamp(t.x+t.barWidth,CHART+12,RIGHT-12),w=Math.max(...t.calloutLines.map(line=>measure(line,22)))+12;
      const candidates=[anchor+22,anchor-w-22,CHART+12,RIGHT-w-12,...occupied.filter(item=>item.lane===t.lane).flatMap(item=>[item.left-w-16,item.right+16])];
      const valid=candidates.filter(x=>x>=CHART+10&&x+w<=RIGHT-10&&occupied.every(item=>item.lane!==t.lane||x+w+10<=item.left||x>=item.right+10));
      valid.sort((a,b)=>Math.abs(a+w/2-anchor)-Math.abs(b+w/2-anchor));
      t.calloutX=valid[0];t.calloutW=w;
      if(t.calloutX===undefined){const h=t.calloutLines.length*25.3+14;t.calloutX=clamp(anchor-w/2,CHART+12,RIGHT-w-12);t.calloutBandCenter=annotationHeight+8+h/2;annotationHeight+=h+10;}
      else occupied.push({left:t.calloutX-5,right:t.calloutX+w+5,lane:t.lane});
    }
    const rowHeight=Math.max(106,leftHeight,lanesHeight+28+annotationHeight);
    return{project,pi,fill,projectFont,projectName,projectLines,status,statusLines,phases,barHeight,laneOffsets,lanesHeight,annotationHeight,height:rowHeight};
  });
  const rowsHeight=layouts.reduce((n,l)=>n+l.height,0),viewHeight=Math.max(1080,bodyY+Math.max(rowsHeight,110)+48),viewWidth=viewHeight*16/9,offsetX=(viewWidth-WIDTH)/2;
  const svg=node('svg',{xmlns:NS,width,height,viewBox:`0 0 ${viewWidth} ${viewHeight}`,class:'roadmap-simple',role:'img','aria-label':title,'data-simple':'true','data-start':start,'data-end':end,'data-layout-scale':Math.min(1,1080/viewHeight),'data-axis-kind':'month-quarter','data-project-count':model.projects.length,'data-phase-count':phaseCount});
  node('title',{},svg).textContent=title;node('desc',{},svg).textContent=translate(`共${model.projects.length}個專案、${phaseCount}個階段；期間${start}至${end}。`,`${model.projects.length} projects and ${phaseCount} tasks, from ${start} to ${end}.`);
  node('rect',{x:0,y:0,width:viewWidth,height:viewHeight,fill:'#fff'},svg);const defs=node('defs',{},svg),content=node('g',{transform:`translate(${offsetX} 0)`},svg);
  if (layouts.some(layout => layout.phases.some(phase => phase.progress > 0 && phase.progress < 100))) defineProgressStripes(defs);
  const header=node('linearGradient',{id:'simple-header',x1:0,y1:0,x2:1,y2:1},defs);node('stop',{offset:'0%','stop-color':'#d5e0ef'},header);node('stop',{offset:'100%','stop-color':'#e8edf6'},header);
  // Leave room for the full CJK font box, which can exceed its ink ascent in Firefox.
  text(content,title,24,100,70,{'font-weight':900,'data-role':'title'},titleLines);
  node('rect',{x:LEFT,y:headingY,width:RIGHT-LEFT,height:138,rx:12,fill:'#fff',stroke:GRID},content);node('path',{d:`M ${LEFT+12} ${headingY} H ${RIGHT-12} Q ${RIGHT} ${headingY} ${RIGHT} ${headingY+12} V ${headingY+62} H ${CHART} V ${bodyY} H ${LEFT} V ${headingY+12} Q ${LEFT} ${headingY} ${LEFT+12} ${headingY}`,fill:'url(#simple-header)'},content);
  const projectHeader=translate('專案項目','Projects');blockText(content,projectHeader,(LEFT+CHART)/2,headingY+69,40,'project-header',[projectHeader],INK);
  const years=[];for(const u of units){const previous=years.at(-1);if(previous?.year===u.year)previous.x2=u.x2;else years.push({year:u.year,x1:u.x1,x2:u.x2});}
  for(const y of years){blockText(content,String(y.year),(y.x1+y.x2)/2,headingY+31,44,'year',[String(y.year)],'#080c53');if(y.x1>CHART)node('line',{x1:y.x1,x2:y.x1,y1:headingY,y2:bodyY+rowsHeight,stroke:'#afc5e1','stroke-width':2,'stroke-dasharray':'6 3'},content);}
  for(const u of units){const cx=(u.x1+u.x2)/2;if(u.quarter){const months=translate(`${u.month}-${u.month+2}月`,`${shortMonth(u.month)}–${shortMonth(u.month+2)}`);blockText(content,`Q${u.quarter}`,cx,headingY+86,30,'quarter',[`Q${u.quarter}`],'#080c53');blockText(content,months,cx,headingY+116,25,'quarter-months',[months],'#080c53');}else{const month=monthLabel(u.month);blockText(content,month,cx,headingY+102,32,'month',[month],'#080c53');}node('line',{x1:u.x1,x2:u.x1,y1:headingY+62,y2:bodyY+rowsHeight,stroke:GRID,'stroke-width':1},content);}
  const dateLine=pictureDateLine(settings),today=dateLine?.date,todayX=today&&today>=start&&today<=end?toX(today):null;
  if(todayX!==null){node('line',{x1:todayX,x2:todayX,y1:headingY+62,y2:bodyY,stroke:'#c4414a','stroke-width':2,'stroke-dasharray':'6 4','data-role':'today-line','data-date':today},content);text(content,dateLine.label,clamp(todayX+7,CHART+8,RIGHT-90),headingY+57,17,{'data-role':'today-label',fill:'#a3313e'});}
  let rowY=bodyY;
  for(const l of layouts){
    const{project,pi,fill,phases}=l,group=node('g',{transform:`translate(0 ${rowY})`,'data-project-id':project.id??`project-${pi}`,'data-project-index':pi,'data-row-height':l.height},content);
    node('rect',{x:LEFT,y:0,width:RIGHT-LEFT,height:l.height,fill:'#fff',stroke:GRID,'data-role':'project-row'},group);node('rect',{x:LEFT,y:0,width:CHART-LEFT,height:l.height,fill:mix(fill,.9)},group);
    for(const unit of units)node('line',{x1:unit.x1,x2:unit.x1,y1:0,y2:l.height,stroke:unit.quarter===1?'#afc5e1':GRID,'stroke-width':unit.quarter===1?1.5:1,'stroke-dasharray':unit.quarter===1?'6 3':null},group);
    if(todayX!==null)node('line',{x1:todayX,x2:todayX,y1:0,y2:l.height,stroke:'#c4414a','stroke-width':2,'stroke-dasharray':'6 4','data-role':'today-line','data-date':today},group);
    const gradient=node('linearGradient',{id:`simple-fill-${pi}`,x1:'0%',y1:'0%',x2:'100%',y2:'25%'},defs);node('stop',{offset:'0%','stop-color':fill},gradient);node('stop',{offset:'100%','stop-color':mix(fill,.3)},gradient);
    node('circle',{cx:56,cy:l.height/2,r:30,fill,stroke:'#fff','stroke-width':2,'data-role':'project-badge'},group);blockText(group,String(pi+1),56,l.height/2,38,'project-number',[String(pi+1)],'#fff');projectIcon(group,project,131,l.height/2,fill);
    const nameHeight=l.projectLines.length*l.projectFont*1.15+l.statusLines.length*18.4;blockText(group,l.projectName,184+(CHART-196)/2,(l.height-nameHeight)/2+l.projectLines.length*l.projectFont*1.15/2,l.projectFont,'project-name',l.projectLines,INK);
    if(l.status)blockText(group,l.status,184+(CHART-196)/2,(l.height+nameHeight)/2-l.statusLines.length*18.4/2,16,'project-status',l.statusLines,'#405774');
    const top=l.annotationHeight+(l.height-l.annotationHeight-l.lanesHeight+12)/2;
    for(const t of phases){const f=t.phase,y=top+l.laneOffsets[t.lane].barY,cx=t.labelX,cy=y+l.barHeight/2,stage=node('g',{'data-phase-id':f.id??`project-${pi}-phase-${t.fi}`,'data-phase-index':t.fi,'data-start':f.start,'data-end':f.end,'data-range-state':t.outside,'data-lane':t.lane},group);t.stage=stage;t.y=y;t.cy=cy;t.cx=cx;
      node('title',{},stage).textContent=`${t.caption}${t.badge?'\n'+t.badge.status:''}\n${f.start} — ${f.open_end?translate('結束未定','End date not set'):f.end}${t.milestone.label?'\n'+translate('里程碑：','Milestone: ')+t.milestone.label:''}${t.milestone.date?translate('（'+t.milestone.date+'）',' ('+t.milestone.date+')'):t.milestone.label?translate('（日期待確認）',' (date to be confirmed)'):''}`;
      const d=barPath(t.x,y,t.barWidth,l.barHeight,t.arrow),opacity=f.light ? 0.4 : t.progress===null ? 1 : 0.22;
      node('path',{d,x:t.x,y,width:t.barWidth,height:l.barHeight,fill:`url(#simple-fill-${pi})`,opacity,stroke:'#fff','stroke-width':1.5,'data-role':'phase-bar'},stage);
      if(t.progress!==null)drawProgress(stage,defs,t,y,l.barHeight,fill,pi);
      if(t.badge)drawStatus(stage,t.badge,y-l.laneOffsets[t.lane].badgeGap,fill);
      if(f.open_end&&f.end<=end)node('path',{d:`M ${t.x+t.barWidth-Math.min(20,t.barWidth*.1)} ${y} L ${t.x+t.barWidth} ${cy} L ${t.x+t.barWidth-Math.min(20,t.barWidth*.1)} ${y+l.barHeight}`,fill:'none',stroke:fill,'stroke-width':2,'data-role':'open-end'},stage);
      const labelCy=cy-(t.inline?(t.mileHeight+3)/2:0)+(t.milestone.date?6:0),textFill=t.outsideLabel||t.progress!==null||f.light||luminance(fill)>.4?INK:'#fff';
      const labelNode=blockText(stage,t.caption,cx,labelCy,t.fontSize,'phase-label',t.lines,textFill);
      if (t.progress !== null && !t.outsideLabel) {
        // One caption can straddle the completed colour and the pale remainder.
        labelNode.setAttribute('paint-order', 'stroke');
        labelNode.setAttribute('stroke', '#fff');
        labelNode.setAttribute('stroke-width', '2');
        labelNode.setAttribute('stroke-linejoin', 'round');
      }
      if(t.inline)blockText(stage,t.milestone.label,cx,cy+t.labelHeight/2+2,t.mileFont,'milestone-label',t.mileLines,textFill);
    }
    for(const t of phases){const m=t.milestone,anchor=m.date?clamp(toX(m.date),CHART+12,RIGHT-12):clamp(t.x+t.barWidth,CHART+12,RIGHT-12),hasMarker=!!m.date||(!m.date&&t.phase.end<=end&&(m.label||t.fi<project.phases.length-1));
      if(hasMarker){const markerY=m.date?t.y-8:t.cy,marker=node('g',{'data-role':m.date?'milestone':'phase-end-marker','data-date':m.date||null,'data-anchor':m.date?'date':'phase-end','data-range-state':m.date&&(m.date<start||m.date>end)?'outside':t.outside},t.stage);node('title',{},marker).textContent=m.date?`${m.date} ${m.label}`:m.label?translate(`${m.label}（日期待確認）`,`${m.label} (date to be confirmed)`):translate('階段交界','Task boundary');if(m.date)node('line',{x1:anchor,x2:anchor,y1:markerY+8,y2:t.y+4,stroke:fill,'stroke-width':1.5},marker);shape(marker,anchor,markerY,m.date||m.label?(settings.locks?.milestoneShape?markerShape:['circle','star'].includes(t.phase.milestoneShape)?t.phase.milestoneShape:markerShape):'circle',fill);}
      if((m.label||m.date)&&!t.inline){const value=t.calloutValue,lines=t.calloutLines,w=Math.max(...lines.map(line=>measure(line,22)))+12;
        const x=t.calloutX,cy=t.calloutBandCenter??t.cy;node('rect',{x:x-5,y:cy-lines.length*25.3/2-5,width:w+10,height:lines.length*25.3+10,rx:5,fill:'#fff','fill-opacity':.94,'data-role':'milestone-callout'},t.stage);blockText(t.stage,value,x+w/2,cy,22,'milestone-label',lines,fill);
      }
    }
    if(!phases.length&&!project.phases.length){const empty=translate('尚無階段','No tasks yet');blockText(group,empty,CHART+140,l.height/2,24,'empty-project',[empty],'#63758a');}rowY+=l.height;
  }
  node('rect',{x:LEFT,y:headingY,width:RIGHT-LEFT,height:138+rowsHeight,rx:10,fill:'none',stroke:GRID,'stroke-width':1.5},content);
  svg.layoutInfo={width,height,range:{start,end},projects:model.projects.length,phases:phaseCount,scale:Math.min(1,1080/viewHeight),milestoneShape:markerShape,axis:'first-year-months-then-quarters'};node('metadata',{'data-role':'layout-info'},svg).textContent=JSON.stringify(svg.layoutInfo);return svg;
}
