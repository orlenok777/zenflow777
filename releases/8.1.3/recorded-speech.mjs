import {SpeechDriver} from './speech.mjs';
export const CLIP_TEXT={test:'Проверка звука. Если вы слышите эту фразу, аудиоплеер работает.',cup:'Стакан или кружка у рта. Поднесение записано.',bottle:'Бутылка у рта. Поднесение записано.',posture:'Положение головы изменилось. Проверьте, удобно ли вы сидите.',inhale:'Вдох.',exhale:'Выдох.',hold:'Задержка.',water:'Перерыв. Проверьте, хочется ли вам пить.',break:'Пора сделать короткий перерыв.',phone:'Телефон остаётся в кадре.'};
export function clipFor(text){if(/проверка|голос включён|запускаем камеру/i.test(text))return'test';if(/бутылка.*у рта/i.test(text))return'bottle';if(/стакан|кружка/i.test(text)&&/у рта/i.test(text))return'cup';if(/положение головы|наклон|осанк/i.test(text))return'posture';if(/^вдох[.!]?$/i.test(text))return'inhale';if(/^выдох[.!]?$/i.test(text))return'exhale';if(/^задержка[.!]?$/i.test(text))return'hold';if(/жажд|хочется ли вам пить/i.test(text))return'water';if(/телефон/i.test(text))return'phone';if(/перерыв|разминк.*глаз|время.*отдых/i.test(text))return'break';return null;}
export class RecordedSpeechDriver extends SpeechDriver{
 constructor(options){super(options);this.media=options.media;this.audioBase=options.audioBase;this.mode='recorded';this.route='none';this.mediaGeneration=0;}
 supported(){return Boolean(this.media)||super.supported();}
 stop(){super.stop();this.mediaGeneration++;if(this.media){this.media.onplaying=this.media.onended=this.media.onerror=null;try{this.media.pause();}catch{}}this.route='none';}
 say(text,options={}){
  const clip=clipFor(text);if(this.mode==='browser'||!clip){this.route='browser';if(!super.supported()){this.update('error','Для этой фразы нужен речевой движок браузера. Сообщения о стакане и бутылке используют готовые записи.');return false;}return super.say(text,options);}
  if(!this.enabled||this.current)return false;
  if(!this.media){this.update('error','Аудиоплеер недоступен');return false;}
  const {rate=1,volume=.8,onStart=()=>{}}=options;if(!(volume>0)){this.update('error','Громкость программы равна нулю');return false;}
  const generation=++this.mediaGeneration,media=this.media;this.route='recorded';this.current={text,clip};this.lastText=CLIP_TEXT[clip];let started=false;
  const active=()=>generation===this.mediaGeneration&&this.current;
  const fail=reason=>{if(!active())return;this.stop();this.update('error',reason);};
  media.onplaying=()=>{if(!active()||started)return;started=true;this.clearTimer(this.timer);this.update('speaking','Аудиоплеер воспроизводит: '+CLIP_TEXT[clip]);onStart();this.timer=this.setTimer(()=>fail('Воспроизведение зависло. Нажмите «Проверить аудиозапись».'),25000);};
  media.onended=()=>{if(!active())return;this.clearTimer(this.timer);this.current=null;this.update('ready','Аудиозапись завершена');};
  media.onerror=()=>fail('Не удалось загрузить аудиофайл. Проверьте соединение и нажмите проверку.');
  this.update('starting','Запуск аудиозаписи…');this.timer=this.setTimer(()=>fail('Аудиоплеер не начал воспроизведение. Нажмите ▶ в плеере ниже.'),8000);
  try{media.src=this.audioBase+clip+'.mp3';media.muted=false;media.volume=volume;media.playbackRate=rate;media.currentTime=0;const pending=media.play();pending?.catch(error=>fail(error.name==='NotAllowedError'?'Браузер заблокировал звук. Нажмите ▶ в плеере ниже.':'Ошибка аудиоплеера: '+error.message));return true;}catch(error){fail('Не удалось включить аудио: '+error.message);return false;}
 }
}
