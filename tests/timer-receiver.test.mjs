import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechDriver} from '../releases/8.1.3/speech.mjs';
import {RecordedSpeechDriver} from '../releases/8.1.3/recorded-speech.mjs';

// Window timers reject a SpeechDriver as their receiver. Arrow-function mocks
// hide this browser failure, so these injected timers deliberately check `this`.
function browserTimers() {
  let next = 0;
  const pending = new Map();
  return {
    pending,
    setTimer: function (callback, delay) {
      assert.equal(this, undefined, 'setTimeout must not receive the driver as this');
      pending.set(++next, {callback, delay});
      return next;
    },
    clearTimer: function (id) {
      assert.equal(this, undefined, 'clearTimeout must not receive the driver as this');
      pending.delete(id);
    }
  };
}

test('Browser timer receiver: native speech can start, end, time out and recover', () => {
  const timers = browserTimers();
  let utterance;
  const d = new SpeechDriver({
    ...timers,
    synth: {speak(value) { utterance = value; }, cancel() {}, getVoices() { return []; }},
    Utterance: class { constructor(text) { this.text = text; } }
  });
  assert.equal(d.enable('Проверка'), true);
  utterance.onstart();
  assert.equal(d.status, 'speaking');
  utterance.onend();
  assert.equal(timers.pending.size, 0);
  d.say('Бутылка у рта');
  [...timers.pending.values()][0].callback();
  assert.equal(d.status, 'error');
  assert.equal(d.enable('Повтор'), true);
  d.disable();
  assert.equal(timers.pending.size, 0);
});

test('Browser timer receiver: MP3 check and following detection both finish', () => {
  const timers = browserTimers();
  const media = {play() { return Promise.resolve(); }, pause() {}};
  const d = new RecordedSpeechDriver({ ...timers, media, audioBase: '/audio/' });
  for (const text of ['Проверка', 'Бутылка у рта', 'Стакан у рта']) {
    assert.equal(d.enabled ? d.say(text) : d.enable(text), true);
    media.onplaying();
    assert.equal(d.status, 'speaking');
    media.onended();
    assert.equal(d.status, 'ready');
    assert.equal(d.current, null);
    assert.equal(timers.pending.size, 0);
  }
  d.disable();
});
