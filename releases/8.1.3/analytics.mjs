export const VERSION = '8.1.3';
export const RELEASE_NAME = 'ZenFlow Vision';
export const FEATURES = {
 water:['Вода','object','Стакан/бутылка у рта; голос; журнал поднесений; подтверждение мл'],
 smile:['Улыбка','face','Порог входа/выхода; удержание; один счёт на улыбку'],
 stretch:['Разминка шеи','face','Наклон; возврат в центр; пауза между повторениями'],
 posture:['Положение головы','face','Калибровка; углы; чувствительность; задержка и частота предупреждений'],
 distance:['Дистанция','face','Относительно калибровки; сглаживание; без выдуманных сантиметров'],
 yawn:['Открывание рта','face','Длительность; повторное закрытие; событие без диагноза усталости'],
 phone:['Телефон','object','Уверенность модели; удержание в кадре; пауза между сигналами'],
 zen:['Дзен','hand','Сложенные ладони; удержание; ручной выход'],
 nightMode:['Автотема','local','Системное время; ручной выбор; сохранение'],
 gestures:['Жесты рук','hand','Ладонь; кулак; V; большой палец; щипок'],
 light:['Освещение','pixels','Яркость; пересвет; низкий контраст'],
 blink:['Моргания','face','Нормированный размер глаз; длительность; частота за минуту'],
 privacy:['Приватность','face','Несколько лиц; задержка срабатывания; скрытие снимков'],
 faceYoga:['Мимические движения','face','Подъём бровей; вытягивание губ; возврат к нейтрали'],
 heart:['Сердце руками','hand','Две руки; геометрия кончиков пальцев; удержание'],
 worldLens:['Объекты','object','Подписи; оценка уверенности; фильтр; число объектов'],
 autoPause:['Пауза фокуса','face','Пропажа лица; несколько лиц; скрытая вкладка'],
 faceTouch:['Касание лица','hand','Расстояние от руки; удержание; исключение питья и жестов'],
 sportMode:['Режим разминки','pose','Ручной старт/стоп; видимость тела; таймер'],
 eyeRule:['Отдых для глаз','local','Время присутствия; отсрочка; совместимость с дыханием'],
 squatCounter:['Приседания','pose','Угол колена; полный цикл; видимость суставов'],
 eyeClosure:['Закрытые глаза','face','Длительность; один сигнал; сброс при потере лица'],
 headTurns:['Повороты головы','face','Относительное смещение; удержание; возврат'],
 presence:['Присутствие','face','Вход/выход; время отсутствия; ограничение истории'],
 composition:['Лицо в кадре','face','Центрирование; размер лица; выход за край'],
 motion:['Движение в кадре','pixels','Разность кадров; зона интереса; подавление смены света'],
 heatmap:['Карта движения','pixels','12 зон; затухание; сброс сессии'],
 frameHealth:['Качество потока','camera','Зависший кадр; FPS; размеры; задержка обработки'],
 pose:['Скелет тела','pose','33 точки; видимость суставов; наклон плеч'],
 armRaise:['Подъём рук','pose','Запястья над плечами; возврат вниз; полный цикл'],
 movementBreak:['Перерыв для движения','local','Таймер присутствия; отсрочка; приоритет упражнений']
};
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
export const distance=(a,b)=>validPoint(a)&&validPoint(b)?Math.hypot(a.x-b.x,a.y-b.y):NaN;
export function angle(a,b,c) {
 if (![a,b,c].every(validPoint)) return null;
 const u=[a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)],v=[c.x-b.x,c.y-b.y,(c.z||0)-(b.z||0)];
 const denom=Math.hypot(...u)*Math.hypot(...v);if(denom<1e-8)return null;
 return Math.acos(clamp(u.reduce((s,n,i)=>s+n*v[i],0)/denom,-1,1))*180/Math.PI;
}
export function median(values) {const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);const mid=Math.floor(sorted.length/2);return sorted.length?(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2):null;}
export class Gate {
 constructor(hold=400,cooldown=2000){this.hold=hold;this.cooldown=cooldown;this.reset();this.last=-Infinity;}
 reset(){this.since=null;this.latched=false;}
 update(active,now){if(!Number.isFinite(now))return false;if(!active){this.reset();return false;}if(this.since===null||now<this.since)this.since=now;
  if(!this.latched&&now-this.since>=this.hold&&now-this.last>=this.cooldown){this.latched=true;this.last=now;return true;}return false;}
}
export class BlinkTracker {
 constructor(){this.closedAt=null;this.history=[];this.longGate=new Gate(2000,5000);}
 reset(){this.closedAt=null;this.longGate.reset();}
 update(ratio,now){if(!Number.isFinite(ratio)){this.reset();return {blink:false,long:false,rate:null};}
  const closed=ratio<.16;let blink=false;
  if(closed&&this.closedAt===null)this.closedAt=now;
  if(!closed&&ratio>.21&&this.closedAt!==null){const dt=now-this.closedAt;blink=dt>=50&&dt<=900;if(blink)this.history.push(now);this.closedAt=null;}
  this.history=this.history.filter(t=>now-t<=60000);return {blink,long:this.longGate.update(closed,now),duration:this.closedAt===null?0:Math.max(0,now-this.closedAt),rate:this.history.length};
 }
}
export class RepTracker {
 constructor(){this.phase='ready';this.downAt=null;this.last=-Infinity;}
 reset(){this.phase='ready';this.downAt=null;}
 update(degrees,now){if(!Number.isFinite(degrees)){this.reset();return false;}
  if(this.phase==='ready'&&degrees<105){this.phase='down';this.downAt=now;}
  else if(this.phase==='down'&&degrees>160){this.phase='ready';const valid=now-this.downAt>=350&&now-this.last>=1000&&now-this.downAt<30000;this.downAt=null;if(valid){this.last=now;return true;}}
  return false;
 }
}
export function faceMetrics(lm) {
 const indices=[1,10,13,14,33,61,133,145,152,159,234,263,291,362,374,386,454];
 if(!lm||!indices.every(i=>validPoint(lm[i])))return null;
 const width=distance(lm[234],lm[454]),height=distance(lm[10],lm[152]),eyes=distance(lm[33],lm[263]);
 if(width<.03||height<.04||eyes<.02)return null;
 const left=distance(lm[159],lm[145])/Math.max(.0001,distance(lm[33],lm[133]));
 const right=distance(lm[386],lm[374])/Math.max(.0001,distance(lm[362],lm[263]));
 return {eyeRatio:(left+right)/2,eyeY:(lm[33].y+lm[263].y)/2,eyeWidth:eyes,width,height,noseY:lm[1].y,
  tilt:Math.atan2(lm[263].y-lm[33].y,lm[263].x-lm[33].x)*180/Math.PI,
  turn:(lm[1].x-(lm[33].x+lm[263].x)/2)/eyes,
  mouth:distance(lm[13],lm[14])/height,smile:distance(lm[61],lm[291])/width,
  centerX:(lm[234].x+lm[454].x)/2,centerY:(lm[10].y+lm[152].y)/2};
}
export function classifyHand(lm) {
 if(!lm||lm.length<21||!lm.every(validPoint))return 'unknown';
 const scale=distance(lm[0],lm[9]);if(scale<.015)return 'unknown';
 if(distance(lm[4],lm[8])/scale<.20)return 'pinch';
 const extended=[8,12,16,20].map(i=>distance(lm[i],lm[0])>distance(lm[i-2],lm[0])*1.15);
 if(extended.every(Boolean))return 'palm';
 if(extended[0]&&extended[1]&&!extended[2]&&!extended[3])return 'victory';
 if(extended.every(v=>!v))return lm[4].y<lm[3].y-scale*.25?'thumbs-up':'fist';
 return 'other';
}
export function pairGesture(hands) {
 if(!hands||hands.length!==2||hands.some(h=>h.length<21||!h.every(validPoint)))return null;
 const [a,b]=hands,scale=(distance(a[0],a[9])+distance(b[0],b[9]))/2;if(scale<.02)return null;
 if(distance(a[8],b[8])/scale<.55&&distance(a[4],b[4])/scale<.55&&a[4].y>a[8].y+.02)return 'heart';
 if(distance(a[0],b[0])/scale<.9&&distance(a[20],b[20])/scale<.9)return 'prayer';
 return null;
}
export function poseMetrics(lm,aspect=1) {
 if(!lm||lm.length<33)return null;
 const visible=i=>validPoint(lm[i])&&(lm[i].visibility??1)>=.65;
 const point=i=>({...lm[i],x:lm[i].x*aspect,z:0});
 const knees=[[23,25,27],[24,26,28]].map(ids=>ids.every(visible)?angle(...ids.map(point)):null).filter(Number.isFinite);
 const shoulders=visible(11)&&visible(12)?Math.atan2(lm[12].y-lm[11].y,(lm[12].x-lm[11].x)*aspect)*180/Math.PI:null;
 const arms=[11,12,15,16].every(visible)?lm[15].y<lm[11].y-.05&&lm[16].y<lm[12].y-.05:null;
 if(!knees.length&&shoulders===null&&arms===null)return null;
 return {knee:knees.length?median(knees):null,shoulders,arms,visible:lm.filter((_,i)=>visible(i)).length};
}
export function imageQuality(rgba,width,height) {
 const count=width*height;if(!count||rgba.length<count*4)return null;
 const luminance=new Float32Array(count);let mean=0,clipped=0;
 for(let i=0;i<count;i++){const l=.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2];luminance[i]=l;mean+=l;if(l<5||l>250)clipped++;}
 mean/=count;let variance=0,edges=0;
 for(let i=0;i<count;i++){variance+=(luminance[i]-mean)**2;if(i%width)edges+=Math.abs(luminance[i]-luminance[i-1]);}
 return {mean,contrast:Math.sqrt(variance/count),clipped:clipped/count,detail:edges/count,luminance};
}
export class MotionTracker {
 constructor(){this.previous=null;this.heat=Array(12).fill(0);}
 reset(){this.previous=null;this.heat.fill(0);}
 update(current,width,height,roi='all') {
  if(!current||current.length!==width*height)return null;
  if(!this.previous||this.previous.length!==current.length){this.previous=Array.from(current);return {fraction:0,heat:[...this.heat]};}
  const shift=current.reduce((s,v,i)=>s+v-this.previous[i],0)/current.length;let changed=0,total=0;const bins=Array(12).fill(0),sizes=Array(12).fill(0);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   if(roi==='center'&&(x<width*.2||x>width*.8||y<height*.15||y>height*.85))continue;
   const i=y*width+x,bin=Math.min(2,Math.floor(y/height*3))*4+Math.min(3,Math.floor(x/width*4));total++;sizes[bin]++;
   if(Math.abs(current[i]-this.previous[i]-shift)>18){changed++;bins[bin]++;}
  }
  this.previous=Array.from(current);this.heat=this.heat.map((v,i)=>Math.max(v*.88,bins[i]/Math.max(1,sizes[i])));
  return {fraction:changed/Math.max(1,total),heat:[...this.heat]};
 }
}
export function containerNearMouth(detections,mouth,width,height) {
 if(!validPoint(mouth)||!width||!height)return false;
 return (detections||[]).some(d=>{
  const c=d.categories?.[0],b=d.boundingBox;if(!b||!['bottle','cup','mug'].includes(c?.categoryName)||(c.score??0)<.5)return false;
  const x=clamp(mouth.x*width,b.originX,b.originX+b.width),y=clamp(mouth.y*height,b.originY,b.originY+b.height);
  return Math.hypot((x-mouth.x*width)/width,(y-mouth.y*height)/height)<.12;
 });
}
export class Coordinator {
 constructor(){this.modules=new Map();this.errors=[];}
 run(key,enabled,available,now,fn){const m=this.modules.get(key)||{runs:0,errors:0,last:0,status:'waiting'};this.modules.set(key,m);
  if(!enabled){m.status='off';return null;}if(!available){m.status='waiting';return null;}
  try {const result=fn();m.runs++;m.last=now;m.status='ok';m.reason='';return result;}
  catch(error){m.errors++;m.status='error';m.reason=String(error?.message||error).slice(0,200);this.errors.push({key,time:now,message:m.reason});this.errors=this.errors.slice(-50);return null;}
 }
}
export class NoticeQueue {
 constructor(){this.items=[];this.last=new Map();this.lastDelivery=-Infinity;}
 push(key,text,now,priority=1,cooldown=15000){if(now-(this.last.get(key)??-Infinity)<cooldown||this.items.some(i=>i.key===key))return false;
  this.last.set(key,now);this.items.push({key,text,now,priority});this.items.sort((a,b)=>b.priority-a.priority||a.now-b.now);this.items=this.items.slice(0,12);return true;}
 next(now,blocked=false){this.items=this.items.filter(i=>now-i.now<15000);if(blocked||now-this.lastDelivery<4000)return null;const item=this.items.shift();if(item)this.lastDelivery=now;return item||null;}
 clear(){this.items=[];}
}
export function runSelfTests() {
 const results=[];const check=(name,features,fn)=>{try{if(fn()!==true)throw Error('Не совпало ожидаемое поведение');results.push({name,features,passed:true});}catch(e){results.push({name,features,passed:false,error:e.message});}};
 check('Удержание и защита от дребезга',['smile','stretch','yawn','posture','distance','phone','faceTouch','faceYoga','heart','zen','headTurns','composition','presence'],()=>{const g=new Gate(300,1000);return !g.update(true,0)&&!g.update(true,299)&&g.update(true,300)&&!g.update(true,2000)&&!g.update(false,2100)&&!g.update(true,2200)&&g.update(true,2500);});
 check('Пропажа сигнала сбрасывает удержание',['presence','privacy','autoPause'],()=>{const g=new Gate(300,0);g.update(true,0);g.update(false,200);return !g.update(true,400)&&g.update(true,700);});
 check('Одиночное моргание',['blink'],()=>{const t=new BlinkTracker();t.update(.1,0);return t.update(.3,150).blink&&!t.update(.3,300).blink;});
 check('Закрытые глаза не становятся серией морганий',['blink','eyeClosure'],()=>{const t=new BlinkTracker();t.update(.1,0);return t.update(.1,2100).long&&!t.update(.1,4200).long&&!t.update(.3,4300).blink;});
 check('Пропажа лица не создаёт моргание',['blink','eyeClosure'],()=>{const t=new BlinkTracker();t.update(.1,0);t.update(NaN,50);return !t.update(.3,100).blink;});
 check('Приседание считается после полного возврата',['pose','squatCounter','sportMode'],()=>{const r=new RepTracker();return !r.update(170,0)&&!r.update(90,100)&&r.update(170,1000)&&!r.update(170,1100);});
 check('Дрожание колена не даёт повтор',['squatCounter'],()=>{const r=new RepTracker();r.update(90,0);return !r.update(170,100);});
 check('Невидимый сустав обрывает повтор',['pose','squatCounter'],()=>{const r=new RepTracker();r.update(90,0);r.update(null,100);return !r.update(170,1000);});
 check('Прямой и прямоугольный сустав',['pose','armRaise'],()=>Math.abs(angle({x:0,y:0},{x:1,y:0},{x:2,y:0})-180)<.001&&Math.abs(angle({x:0,y:1},{x:0,y:0},{x:1,y:0})-90)<.001);
 check('Повреждённые точки не проходят',['pose','composition','gestures'],()=>faceMetrics([])===null&&classifyHand([])==='unknown'&&angle(null,null,null)===null);
 check('Медиана устойчива к одиночному выбросу',['posture','distance','stretch'],()=>median([.2,.21,.22,10,.23])===.22);
 check('Чёрный кадр имеет нулевую яркость',['light','frameHealth'],()=>imageQuality(new Uint8Array(16),2,2).mean===0);
 check('Изменение света не считается движением',['motion','heatmap'],()=>{const t=new MotionTracker();t.update(new Float32Array(12).fill(40),4,3);return t.update(new Float32Array(12).fill(80),4,3).fraction===0;});
 check('Локальное движение попадает в карту',['motion','heatmap'],()=>{const t=new MotionTracker();t.update(new Float32Array(12).fill(40),4,3);const b=new Float32Array(12).fill(40);b[5]=180;const result=t.update(b,4,3);return result.fraction>0&&result.heat[5]>0;});
 check('Ёмкость должна быть рядом с ртом',['water','worldLens'],()=>{const ds=[{categories:[{categoryName:'cup',score:.9}],boundingBox:{originX:40,originY:40,width:20,height:20}}];return containerNearMouth(ds,{x:.5,y:.5},100,100)&&!containerNearMouth(ds,{x:.95,y:.95},100,100);});
 check('Ошибка одного датчика не останавливает другой',['frameHealth','worldLens','pose'],()=>{const c=new Coordinator();c.run('bad',true,true,0,()=>{throw Error('test');});return c.run('good',true,true,1,()=>42)===42&&c.modules.get('bad').status==='error';});
 check('Выключенный датчик не исполняется',Object.keys(FEATURES),()=>{const c=new Coordinator();let n=0;c.run('test',false,true,0,()=>n++);return n===0&&c.modules.get('test').status==='off';});
 check('Нет модели — честное ожидание',Object.keys(FEATURES),()=>{const c=new Coordinator();c.run('test',true,false,0,()=>42);return c.modules.get('test').status==='waiting';});
 check('Очередь не перебивает и удаляет повторы',['eyeRule','movementBreak','zen'],()=>{const q=new NoticeQueue();return q.push('a','A',0)&&!q.push('a','A',1)&&q.next(100)?.text==='A'&&q.next(101)===null;});
 check('Дыхание блокирует конкурирующие подсказки',['eyeRule','zen','movementBreak'],()=>{const q=new NoticeQueue();q.push('a','A',0);return q.next(100,true)===null&&q.next(200)?.text==='A';});
 check('Просроченные уведомления удаляются',['eyeRule','movementBreak'],()=>{const q=new NoticeQueue();q.push('a','A',0);return q.next(16000)===null;});
 return results;
}
