// Acknowledges speech on the native start event, never on a boolean preference.
export class SpeechDriver {
 constructor({synth,Utterance,setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{}}){
  Object.assign(this,{synth,Utterance,onState});
  // Window timers must be invoked as free functions, never with this driver
  // as their receiver (which throws "Illegal invocation" in real browsers).
  this.setTimer=(callback,delay)=>setTimer(callback,delay);
  this.clearTimer=id=>clearTimer(id);
  this.current=null;this.timer=null;this.enabled=false;this.status='off';this.message='Нажмите «Включить голос и проверить»';this.lastText='';this.voiceURI='';
 }
 update(status,message){this.status=status;this.message=message;this.onState(this);}
 voices(){try{return this.synth?.getVoices?.()||[];}catch{return[];}}
 supported(){return Boolean(this.synth&&this.Utterance);}
 stop(){this.clearTimer(this.timer);const old=this.current;this.current=null;if(old){old.onstart=old.onend=old.onerror=null;}try{this.synth?.cancel();}catch{}}
 disable(){this.stop();this.enabled=false;this.update('off','Голос выключен');}
 enable(text,options={}){this.stop();this.enabled=true;return this.say(text,options);}
 say(text,{rate=1,volume=.8,onStart=()=>{}}={}){
  if(!this.supported()){this.update('error','Речь недоступна в этом браузере. Откройте страницу в другом браузере.');return false;}
  if(!this.enabled||this.current)return false;
  if(!(volume>0)){this.update('error','Громкость голоса равна нулю. Увеличьте её и нажмите проверку.');return false;}
  const u=new this.Utterance(String(text));this.current=u;this.lastText=String(text);u.lang='ru-RU';u.rate=rate;u.volume=volume;
  const voices=this.voices();u.voice=voices.find(v=>v.voiceURI===this.voiceURI)||voices.find(v=>/^ru(?:-|_)/i.test(v.lang)&&v.localService)||voices.find(v=>/^ru(?:-|_)/i.test(v.lang))||null;
  if(u.voice)u.lang=u.voice.lang;
  const fail=(reason)=>{if(this.current!==u)return;this.stop();this.update('error',reason);};
  u.onstart=()=>{if(this.current!==u)return;this.clearTimer(this.timer);this.update('speaking','Произносится: '+this.lastText);onStart();this.timer=this.setTimer(()=>fail('Речь не завершилась. Нажмите «Восстановить голос».'),25000);};
  u.onend=()=>{if(this.current!==u)return;this.clearTimer(this.timer);this.current=null;this.update('ready','Последняя фраза завершена браузером');};
  u.onerror=e=>fail(`Ошибка речи: ${e.error||'неизвестная'}. Нажмите «Восстановить голос».`);
  this.update('starting','Ожидание запуска речи…');this.timer=this.setTimer(()=>fail('Браузер не запустил речь. Нажмите «Восстановить голос»; проверьте громкость устройства.'),5000);
  try{if(this.synth.paused)this.synth.resume?.();this.synth.speak(u);return this.status!=='error';}catch(error){fail('Не удалось запустить речь: '+error.message);return false;}
 }
}
