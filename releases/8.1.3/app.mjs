import {RecordedSpeechDriver} from './recorded-speech.mjs';
import {SpeechDriver} from './speech.mjs';
import {HABIT_DEFAULTS,habitSettings,drinkAtMouth,DrinkTracker,pitchProxy,postureDelta,cleanDrinkLog} from './habits.mjs';
import {VERSION,RELEASE_NAME,FEATURES,clamp,distance,median,Gate,BlinkTracker,RepTracker,faceMetrics,classifyHand,pairGesture,poseMetrics,imageQuality,MotionTracker,Coordinator,NoticeQueue,runSelfTests,containerNearMouth} from './analytics.mjs';

        // Перехват консольных ошибок для стабильного логирования
        const originalConsoleError = console.error;
        console.error = function (...args) {
            if (args[0] && typeof args[0] === 'string' && args[0].includes('TensorFlow Lite XNNPACK')) return;
            originalConsoleError.apply(console, args);
        };

        // Camera dependencies load only after an explicit camera action.
        let PoseLandmarker, poseLM, FaceLandmarker, HandLandmarker, ObjectDetector, FilesetResolver, DrawingUtils;

        // ========== STATE ==========
        const state = {
            water: 0, smiles: 0, stretches: 0, faceYoga: 0, treeLevel: 1,
            cigaretteCount: 0, foodCount: 0, postureCorrections: 0,
            cameraActive: false, lastActionTs: 0, frameCount: 0, audioUnlocked: false,
            lastMouthPos: null, lastMouthTs: 0, lastDetections: [], isProcessing: false,
            lowPowerMode: false, lowFPSCount: 0, history: [],
            bottleCapacity: 2000, currentWater: 2000,
            lastPostureWarn: 0, lastDistanceWarn: 0, lastLightWarn: 0, lastBlinkCheck: 0,
            lastYawnTs: 0, lastStretchTs: 0, lastPhoneWarn: 0, lastGestureTs: 0,
            lastYogaTs: 0, lastAiCheck: 0, lastFaceTouchWarn: 0,
            focusStartTime: 0, totalFocusTime: 0, lastFocusUpdate: 0,
            isTimerPaused: false, lastFaceSeenTs: 0,
            isFocused: true, isZenMode: false, isNightMode: false, isVRMode: false, isAnalyzing: false,
            blinks: 0, totalBlinksThisSession: 0, blinkHistory: [], avgLight: 0,
            currDist: 0, currPosture: "ok", currTilt: 0,
            // Sport/Squat
            sittingStartTime: Date.now(), isExercising: false, exerciseStartTime: 0,
            lastStandUpCheck: 0, baselineNoseY: null, calibrationSamples: [],
            squats: 0, lastSquatDir: null, lastSquatTs: 0,
            squatBaselineY: null, squatPrevY: null, squatGoingDown: false,
            // Caffeine
            caffeineTotal: 0, caffeineLog: [],
            // Mood
            moodLog: [],
            // Streak
            streak: 0,
            // Eye break
            lastEyeBreak: Date.now(), eyeBreakInterval: 20,
            eyeBreakActive: false,
            // Contacts
            contacts: { phone: (function(){ try{return localStorage.getItem('zen_phone')||'';}catch(e){return '';} })() },
            autoReport: {
                enabled: (function(){ try{return localStorage.getItem('zen_ar_enabled')==='true';}catch(e){return false;} })(),
                interval: (function(){ try{return (localStorage.getItem('zen_ar_interval') === 'day' ? 'day' : parseInt(localStorage.getItem('zen_ar_interval'))||60);}catch(e){return 60;} })(),
                lastSent: Date.now()
            },
            features: {
                water:true, smile:true, stretch:true, posture:true, distance:true,
                yawn:true, phone:true, zen:true, nightMode:true, gestures:true,
                light:true, blink:true, privacy:true, faceYoga:true, heart:true,
                worldLens:true, autoPause:true, faceTouch:true,
                sportMode:true, eyeRule:true, squatCounter:true
            }
        };

        const FEATURE_NAMES = {
            water:"💧 Гидратация", smile:"😊 Улыбка", stretch:"🧘 Разминка Шеи",
            posture:"🚶 Осанка", distance:"📏 Дистанция", yawn:"😴 Зевота",
            phone:"📵 Детокс", zen:"🙏 Дзен", nightMode:"🌙 Ночной Режим",
            gestures:"✌️ Жесты", light:"💡 Свет", blink:"👁️ Моргание",
            privacy:"🛡️ Приватность", faceYoga:"🤨 Фейс-Йога", heart:"❤️ Жест Сердца",
            aiObjectCheck:"🤖 AI Детектор", worldLens:"👁️ Линза Мира",
            autoPause:"⏸️ Авто-Пауза", faceTouch:"✋ Гигиена", sportMode:"🏃 Спорт",
            eyeRule:"👁️ 20-20-20", squatCounter:"🏋️ Приседания"
        };

        const TREES = ["🌱","🌿","🪴","🎋","🌳","🌲","🌸","🍎","👑"];
        // Cloud analysis intentionally stays unconfigured; never embed production secrets here.
        const OBJECT_TRANSLATIONS = {"person":"Человек","bottle":"Бутылка","cup":"Чашка","cell phone":"Телефон","laptop":"Ноутбук","book":"Книга","chair":"Стул","potted plant":"Растение"};
        const CAFFEINE_DATA = { coffee:80, espresso:63, tea:30, energy:150 };

        const video = document.getElementById("webcam");
        const canvas = document.getElementById("output_canvas");
        const ctx = canvas.getContext("2d");
        let faceLM, handLM, objectDet, drawingUtils;
        let lastTime = -1;

        // ========== CHART CONFIGURATION (Chart.js) ==========
        let zenChartInstance = null;
        function initChart() {
            if (zenChartInstance || typeof window.Chart !== "function") return;
            const ctxChart = document.getElementById('zenRealtimeChart').getContext('2d');
            zenChartInstance = new Chart(ctxChart, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Улыбки 😊',
                            data: [],
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            borderWidth: 3,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Записи воды 💧',
                            data: [],
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            borderWidth: 3,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: 'Приседы 🏋️',
                            data: [],
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99, 102, 241, 0.1)',
                            borderWidth: 3,
                            tension: 0.4,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0, 0, 0, 0.05)' }
                        },
                        x: {
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { font: { family: 'Quicksand', size: 10 } }
                        }
                    }
                }
            });
        }

        //        // ========== AUDIO CONTEXT & SYNTHESIZERS ==========
        let audioInstance = null;
        function getAudioContext() {
            if (!audioInstance) {
                const AudioClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioClass) throw new Error('Аудио не поддерживается');
                audioInstance = new AudioClass();
            }
            return audioInstance;
        }
        const audioCtx = new Proxy({}, { get(_, key) {
            const context = getAudioContext(), value = context[key];
            return typeof value === 'function' ? value.bind(context) : value;
        }});
        const ambientNodes = {};
        let ambientVolume = 0.3;

        function playTickSound() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.05);
        }

        function playSuccessSound() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const freqs = [523.25, 659.25, 783.99];
            freqs.forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, audioCtx.currentTime + i * 0.1);
                gain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + i * 0.1 + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.1 + 0.4);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + i * 0.1);
                osc.stop(audioCtx.currentTime + i * 0.1 + 0.5);
            });
        }

        function playPomodoroEnd() {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            [440,550,660,880].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.2, audioCtx.currentTime + i * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.6);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + i * 0.15);
                osc.stop(audioCtx.currentTime + i * 0.15 + 0.7);
            });
        }

        // ========== AMBIENT SOUND ENGINE ==========
        const activeAmbient = { current: null };

        function createRainSound() { return createNoise('rain'); }

        /* */
        function createOceanSound() { return createNoise('ocean'); }

        function createForestSound() { return createNoise('forest'); }

        function createFireSound() { return createNoise('fire'); }

        function createWhiteNoise() { return createNoise('white'); }

        /* */
        function createBinaural() {
            const oscL = audioCtx.createOscillator();
            const oscR = audioCtx.createOscillator();
            const merger = audioCtx.createChannelMerger(2);
            const gainL = audioCtx.createGain(); gainL.gain.value = ambientVolume * 0.4;
            const gainR = audioCtx.createGain(); gainR.gain.value = ambientVolume * 0.4;
            oscL.frequency.value = 150; oscR.frequency.value = 160; // 10Hz Alpha beat for focus
            oscL.type = 'sine'; oscR.type = 'sine';
            oscL.connect(gainL); oscR.connect(gainR);
            gainL.connect(merger, 0, 0); gainR.connect(merger, 0, 1);
            merger.connect(audioCtx.destination);
            oscL.start(); oscR.start();
            return { source: oscL, right: oscR, gain: gainL, rightGain: gainR, stop: () => { try{ oscL.stop(); oscR.stop(); merger.disconnect(); gainL.disconnect(); gainR.disconnect(); }catch(e){} } };
        }

        window.toggleAmbient = function(type) {
            try { if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); }
            catch { toast('Браузер не поддерживает звуки атмосферы.'); return; }
            const btn = document.getElementById(`amb-${type}`);

            if (activeAmbient.current === type) {
                if (ambientNodes[type]) { ambientNodes[type].stop(); delete ambientNodes[type]; }
                activeAmbient.current = null;
                btn.classList.remove('active');
                return;
            }

            if (activeAmbient.current && ambientNodes[activeAmbient.current]) {
                ambientNodes[activeAmbient.current].stop();
                delete ambientNodes[activeAmbient.current];
                document.querySelectorAll('.ambient-btn').forEach(b => b.classList.remove('active'));
            }

            const creators = { rain: createRainSound, ocean: createOceanSound, forest: createForestSound, fire: createFireSound, white: createWhiteNoise, binaural: createBinaural };
            if(!creators[type]||!btn)return;try{ambientNodes[type] = creators[type]();}catch{activeAmbient.current=null;toast('Не удалось запустить звук.');return;}
            activeAmbient.current = type;
            btn.classList.add('active');
            const names = { rain:'Дождь', ocean:'Океан', forest:'Лес', fire:'Костёр', white:'Белый шум', binaural:'Альфа ритмы' };
            addChat(`🎵 Запущена успокаивающая атмосфера: ${names[type]}`, 'ai');
        };

        document.getElementById('ambient-volume').addEventListener('input', (e) => {
            ambientVolume = clamp(Number(e.target.value)||0,0,100) / 100;
            const type = activeAmbient.current;
            if (type && ambientNodes[type]) {
                ambientNodes[type].gain.gain.value = ambientVolume * (type === 'binaural' ? 0.4 : 1);
                if (ambientNodes[type].rightGain) ambientNodes[type].rightGain.gain.value = ambientVolume * 0.4;
            }
        });

        // ========== LOGGER ==========
        function logDiag(msg) {
            const log = document.getElementById('diag-log');
            const time = new Date().toLocaleTimeString();
            const el = document.createElement('div');
            el.textContent = `[${time}] ${msg}`;
            log.prepend(el);
            if (log.children.length > 50) log.lastChild.remove();
        }

        // ========== STREAK SYSTEM ==========
        function loadStreak() {
            try {
                const lastVisit = localStorage.getItem('zen_last_visit');
                const streak = parseInt(localStorage.getItem('zen_streak')) || 0;
                const today = new Date().toDateString();
                const previousDate = new Date(); previousDate.setDate(previousDate.getDate() - 1);
                const yesterday = previousDate.toDateString();
                if (!lastVisit) { state.streak = 1; }
                else if (lastVisit === yesterday) { state.streak = streak + 1; }
                else if (lastVisit === today) { state.streak = streak; }
                else { state.streak = 1; }
                localStorage.setItem('zen_last_visit', today);
                localStorage.setItem('zen_streak', state.streak);
            } catch(e) { state.streak = 1; }
            updateStreakUI();
        }

        /* */
        function updateStreakUI() {
            document.getElementById('streak-display').innerText = state.streak;
            document.getElementById('modal-streak').innerText = state.streak;
            document.getElementById('diag-streak').innerText = `${state.streak} дней`;
        }

        // ========== CAFFEINE TRACKER ==========
        window.addCaffeine = function(type) {
            ensureCurrentDay();
            if (state.caffeineLog.length >= 2000 || !Object.hasOwn(CAFFEINE_DATA, type)) return;
            const mg = CAFFEINE_DATA[type];
            state.caffeineTotal += mg;
            state.caffeineLog.push({ type, mg, time: Date.now() });
            state.caffeineLog = state.caffeineLog.filter(c => localDay(c.time) === activeDay);
            state.caffeineTotal = state.caffeineLog.reduce((a, c) => a + c.mg, 0);
            updateCaffeineUI();
            const names = { coffee:'Кофе', espresso:'Эспрессо', tea:'Чай', energy:'Энергетик' };
            addHistoryEvent('☕', `${names[type]} (+${mg}мг)`);
            addChat(`☕ Зафиксирован кофеин: ${names[type]}. Записано за день: ${state.caffeineTotal}мг`, 'ai');
            window.speakZen(`Зафиксирована доза кофеина. ${names[type]}`);
        };

        function updateCaffeineUI() {
            const pct = Math.min(100, (state.caffeineTotal / 400) * 100);
            document.getElementById('caffeine-bar').style.width = pct + '%';
            document.getElementById('caffeine-mg').innerText = `${state.caffeineTotal} мг`;
            document.getElementById('modal-caffeine').innerText = state.caffeineTotal;
            const statusEl = document.getElementById('caffeine-status');
            statusEl.innerText = state.caffeineTotal === 0 ? 'Кофеин пока не записан' : 'Примерное содержание в напитках, не уровень в крови';
        }



        // ========== MOOD TRACKER ==========
        window.logMood = function(emoji, label) {
            ensureCurrentDay();
            if (state.moodLog.length >= 2000) { toast('Достигнут предел записей за день.'); return; }
            state.moodLog.push({ emoji, label, time: Date.now() });
            document.getElementById('current-mood-display').innerText = emoji;
            document.getElementById('vibe-emoji').innerText = emoji;
            document.getElementById('vr-vibe').innerText = emoji;
            
            const strip = document.getElementById('mood-log-strip');
            if (strip.innerText.includes('Отметьте настроение')) strip.innerHTML = '';
            const dot = document.createElement('div');
            dot.title = `${label} — ${new Date().toLocaleTimeString()}`;
            dot.className = 'flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/50 border border-white/80 text-base hover:scale-110 transition cursor-default';
            dot.innerText = emoji;
            strip.appendChild(dot);
            strip.scrollLeft = strip.scrollWidth;
            
            document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('selected', b.textContent.trim() === emoji));
            addHistoryEvent(emoji, `Настроение: ${label || 'Отмечено'}`);
            document.getElementById('modal-mood').innerText = emoji;

            // Адаптивное изменение тональности бинаурального биения в зависимости от настроения
            if (activeAmbient.current === 'binaural' && ambientNodes['binaural']) {
                const pitch = emoji === '😡' ? 100 : emoji === '😔' ? 180 : 150;
                ambientNodes['binaural'].source.frequency.value = pitch;
                ambientNodes['binaural'].right.frequency.value = pitch + 10;
                addChat(`🤖 Частота звука изменена по вашей отметке: ${pitch}Гц.`, 'ai');
            }
        };

        // ========== POMODORO TIMER ==========
        const POMO = { workDuration: 25*60, breakDuration: 5*60, longBreakDuration: 15*60 };
        let pomoState = { running: false, isBreak: false, timeLeft: POMO.workDuration, sessions: 0, interval: null };

        /* */
        function updatePomodoroRing() {
            const total = pomoState.isBreak ? (pomoState.sessions % 4 === 0 && pomoState.sessions > 0 ? POMO.longBreakDuration : POMO.breakDuration) : POMO.workDuration;
            const pct = ((total - pomoState.timeLeft) / total) * 100;
            const ring = document.getElementById('pomo-ring');
            const color = pomoState.isBreak ? '#10b981' : '#ef4444';
            ring.style.background = `conic-gradient(${color} ${pct}%, #e5e7eb ${pct}%)`;
            if (pomoState.isBreak) ring.classList.add('break-mode');
            else ring.classList.remove('break-mode');
            
            const card = document.getElementById('pomodoro-card');
            if (pomoState.isBreak) card.classList.add('pomodoro-break');
            else card.classList.remove('pomodoro-break');
        }

        function updatePomodoroDisplay() {
            const mins = Math.floor(pomoState.timeLeft / 60);
            const secs = pomoState.timeLeft % 60;
            document.getElementById('pomo-time').innerText = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
            document.getElementById('pomo-label').innerText = pomoState.isBreak ? 'ПЕРЕРЫВ' : 'ФОКУС';
            document.getElementById('pomo-session-info').innerText = `Завершено сессий: ${pomoState.sessions}`;
            updatePomodoroRing();
            for (let i = 1; i <= 4; i++) {
                const dot = document.getElementById(`pomo-dot-${i}`);
                if (!dot) continue;
                dot.className = i <= pomoState.sessions % 4 ? 'w-2 h-2 rounded-full bg-rose-400' : 'w-2 h-2 rounded-full bg-gray-200';
            }
        }

        // Absolute deadline avoids timer drift when a tab is throttled.
        function setPomoButtons() {
            document.getElementById('pomo-start').disabled = pomoState.running;
            document.getElementById('pomo-pause').disabled = !pomoState.running;
            document.getElementById('pomo-skip').disabled = false;
        }
        function tickPomodoro() {
            if (!pomoState.running) return;
            pomoState.timeLeft = Math.max(0, Math.ceil((pomoState.deadline - Date.now()) / 1000));
            if (pomoState.timeLeft === 0) {
                const finishedAt = pomoState.deadline;
                clearInterval(pomoState.interval);
                pomoState.running = false;
                pomoState.deadline = null;
                if (!pomoState.isBreak) {
                    ensureCurrentDay();
                    pomoState.sessions++;
                    const day = localDay(finishedAt);
                    if (day === activeDay) state.pomodorosCompleted++;
                    else {
                        const past = dailyStore.days[day] || emptyDay();
                        past.pomodorosCompleted = (past.pomodorosCompleted || 0) + 1;
                        dailyStore.days[day] = past;
                    }
                    pomoState.isBreak = true;
                    pomoState.timeLeft = pomoState.sessions % 4 === 0 ? POMO.longBreakDuration : POMO.breakDuration;
                    addHistoryEvent('🍅', 'Сессия завершена. Перерыв запускается вручную.');
                    toast('Сессия завершена. Можно начать перерыв.');
                } else {
                    pomoState.isBreak = false;
                    pomoState.timeLeft = POMO.workDuration;
                    toast('Перерыв завершён. Можно начать новую сессию.');
                }
                if (state.audioUnlocked) { try { playPomodoroEnd(); } catch {} }
                setPomoButtons(); renderDailyPanel(); saveData();if(vision.settings.autoContinue&&!document.hidden)startPomodoro();
            }
            updatePomodoroDisplay();
        }
        function startPomodoro() {
            ensureCurrentDay();
            if (pomoState.running) return;
            pomoState.running = true;
            pomoState.deadline = Date.now() + pomoState.timeLeft * 1000;
            clearInterval(pomoState.interval);
            pomoState.interval = setInterval(tickPomodoro, 250);
            setPomoButtons(); saveData();
        }
        function pausePomodoro() {
            tickPomodoro();
            if (!pomoState.running) return;
            clearInterval(pomoState.interval);
            pomoState.running = false;
            pomoState.deadline = null;
            setPomoButtons(); saveData();
        }
        function resetPomodoro() {
            clearInterval(pomoState.interval);
            pomoState.running = false; pomoState.deadline = null; pomoState.isBreak = false;
            pomoState.timeLeft = POMO.workDuration;
            setPomoButtons(); updatePomodoroDisplay(); saveData();
        }
        function skipPomodoro() {
            clearInterval(pomoState.interval);
            pomoState.running = false; pomoState.deadline = null;
            // A skipped work phase is not a completed session.
            pomoState.isBreak = !pomoState.isBreak;
            pomoState.timeLeft = pomoState.isBreak ? POMO.breakDuration : POMO.workDuration;
            setPomoButtons(); updatePomodoroDisplay(); saveData();
        }


        document.getElementById('pomo-start').onclick = startPomodoro;
        document.getElementById('pomo-pause').onclick = pausePomodoro;
        document.getElementById('pomo-reset').onclick = resetPomodoro;
        document.getElementById('pomo-skip').onclick = skipPomodoro;

        // ========== BREATHING EXERCISE ==========
        let breathInterval = null;
        const breathPhases = [
            { name: 'Вдох', cls: 'inhale', dur: 4 },
            { name: 'Задержка', cls: 'hold', dur: 4 },
            { name: 'Выдох', cls: 'exhale', dur: 4 },
            { name: 'Задержка', cls: 'hold', dur: 4 }
        ];
        let breathPhaseIdx = 0, breathCount = 4, breathCyclesTarget = 4, breathCycleDone = 0;

        function runBreathPhase() {
            const phase = breathPhases[breathPhaseIdx];
            const circle = document.getElementById('breath-circle');
            const counter = document.getElementById('breath-counter');
            const phaseEl = document.getElementById('breath-phase');
            circle.className = 'breath-circle ' + phase.cls;
            phaseEl.innerText = phase.name;
            let count = phase.dur;const deadline=Date.now()+phase.dur*1000;
            counter.innerText = count;
            
            // Вокальное сопровождение дыхания
            if(state.audioUnlocked)speech.enable(phase.name,{rate:habits.settings.voiceRate,volume:habits.settings.voiceVolume});
            
            breathInterval = setInterval(() => {
                count=Math.max(0,Math.ceil((deadline-Date.now())/1000));
                counter.innerText = count;
                if (count <= 0) {
                    clearInterval(breathInterval);
                    breathPhaseIdx = (breathPhaseIdx + 1) % breathPhases.length;
                    if (breathPhaseIdx === 0) {
                        breathCycleDone++;
                        document.getElementById('breath-cycle-num').innerText = breathCycleDone + 1;
                        if (breathCycleDone >= breathCyclesTarget) {
                            stopBreathingGuide();
                            window.speakZen("Превосходно! Глубокое дыхание завершено.", true);
                            return;
                        }
                    }
                    runBreathPhase();
                }
            }, 1000);
        }

        /* */
        function startBreathingGuide() {
clearInterval(breathInterval);closeEyeBreak();vision.notices.clear();vision.breathing=true;
            breathCycleDone = 0;
            breathPhaseIdx = 0;
            breathCyclesTarget = parseInt(document.getElementById('breath-cycles-select').value);
            document.getElementById('breath-cycle-total').innerText = breathCyclesTarget;
            document.getElementById('breath-cycle-num').innerText = 1;
            document.getElementById('breathStartBtn').classList.add('hidden');
            document.getElementById('breathStopBtn').classList.remove('hidden');
            runBreathPhase();
        }

        function stopBreathingGuide() {
vision.breathing=false;
            clearInterval(breathInterval);
            const circle = document.getElementById('breath-circle');
            circle.className = 'breath-circle';
            document.getElementById('breath-counter').innerText = '4';
            document.getElementById('breath-phase').innerText = 'Вдох';
            document.getElementById('breathStartBtn').classList.remove('hidden');
            document.getElementById('breathStopBtn').classList.add('hidden');
        }

        document.getElementById('breathingBtn').onclick = () => document.getElementById('breathing-modal').classList.add('active');
        document.getElementById('closeBreathing').onclick = () => { stopBreathingGuide(); document.getElementById('breathing-modal').classList.remove('active'); };
        document.getElementById('breathStartBtn').onclick = startBreathingGuide;
        document.getElementById('breathStopBtn').onclick = stopBreathingGuide;

        // ========== 20-20-20 EYE RULE ==========
        let eyeBreakCountdown = 20, eyeBreakTimer = null;

        function triggerEyeBreak() {
if(vision.breathing||vision.exercise||vision.privacyActive||document.hidden||Date.now()<vision.eyeSnoozeUntil||Date.now()-state.lastFaceSeenTs>1500)return;
            if (state.eyeBreakActive) return;
            state.eyeBreakActive = true;
            state.lastEyeBreak = Date.now();vision.eyeFocus=0;
            document.getElementById('eye-break-modal').classList.add('active');
            eyeBreakCountdown = 20;const deadline=Date.now()+20000;
            updateEyeCountdown();
            window.speakZen("Время разминки глаз. Снимите фокус и посмотрите на удаленный предмет.", true);
            addHistoryEvent('👁️', 'Перерыв для глаз (20-20-20)');
            addChat("👁️ Активировано правило 20-20-20. Снимите нагрузку с глазных мышц.", 'ai');
            eyeBreakTimer = setInterval(() => {
                eyeBreakCountdown=Math.max(0,Math.ceil((deadline-Date.now())/1000));
                updateEyeCountdown();
                if (eyeBreakCountdown <= 0) {
                    clearInterval(eyeBreakTimer);
                    closeEyeBreak();
                    window.speakZen("Разминка глаз завершена. Спасибо!");
                }
            }, 1000);
        }

        function updateEyeCountdown() {
            const pct = ((20 - eyeBreakCountdown) / 20) * 100;
            document.getElementById('eye-countdown').innerText = eyeBreakCountdown;
            document.getElementById('eye-countdown-ring').style.background = `conic-gradient(#3b82f6 ${pct}%, #e5e7eb ${pct}%)`;
        }

        function closeEyeBreak() {
            clearInterval(eyeBreakTimer);
            state.eyeBreakActive = false;
            document.getElementById('eye-break-modal').classList.remove('active');
        }

        document.getElementById('closeEyeBreak').onclick = closeEyeBreak;

        /* */
        // ========== SETTINGS ==========
        const phoneInput = document.getElementById('cfg-whatsapp');
        const arToggle = document.getElementById('toggle-auto-report');
        const arInterval = document.getElementById('cfg-report-interval');
        const eyeRuleToggle = document.getElementById('toggle-eye-rule');
        const eyeIntervalSelect = document.getElementById('cfg-eye-interval');
        phoneInput.value = state.contacts.phone;
        if (state.autoReport.enabled) arToggle.classList.add('active');
        arInterval.value = state.autoReport.interval;

        function saveSettings() {
            state.contacts.phone = phoneInput.value.replace(/[^0-9]/g, '');
            state.autoReport.enabled = arToggle.classList.contains('active');
            state.features.eyeRule = eyeRuleToggle.classList.contains('active');
            state.eyeBreakInterval = parseInt(eyeIntervalSelect.value) || 20;
            const val = arInterval.value;
            state.autoReport.interval = val === 'day' ? 'day' : parseInt(val);
            try {
                localStorage.setItem('zen_phone', state.contacts.phone);
                localStorage.setItem('zen_ar_enabled', state.autoReport.enabled);
                localStorage.setItem('zen_ar_interval', val);
            } catch(e) {}
            state.autoReport.lastSent = Date.now();
            scheduleSave();
        }

        phoneInput.addEventListener('input', saveSettings);
        arInterval.addEventListener('change', saveSettings);
        arToggle.addEventListener('click', () => { arToggle.classList.toggle('active'); saveSettings(); });
        eyeRuleToggle.addEventListener('click', () => { eyeRuleToggle.classList.toggle('active'); saveSettings(); });
        eyeIntervalSelect.addEventListener('change', saveSettings);

        // ========== AUTO REPORT ==========
        function checkAutoReport() {
            checkAutoReport_inner();
            if (state.features.eyeRule && state.cameraActive) {
                const minutesSince = (vision.eyeFocus||0) / 60000;
                if (minutesSince >= state.eyeBreakInterval) triggerEyeBreak();
            }
        }

        function checkAutoReport_inner() {
            if (!state.autoReport.enabled) return;
            const now = Date.now();
            const due = state.autoReport.interval === 'day'
                ? new Date().getHours() >= 20 && reportDay !== localDay()
                : now - state.autoReport.lastSent >= state.autoReport.interval * 60000;
            if (!due) return;
            state.autoReport.lastSent = now;
            reportDay = localDay();
            document.getElementById('auto-report-alert').classList.add('active');
            toast('Отчёт готов. Отправить его можно по кнопке в статистике.');
            saveData();
        }
        window.confirmAutoSend = function() {
            document.getElementById('auto-report-alert').classList.remove('active');
            generateAndShareReport(false);
        };
        setInterval(checkAutoReport, 60000);



        /* */
        // ========== SHARING & SHAPSHOTS ==========
        function dataURItoBlob(dataURI) {
            const byteString = atob(dataURI.split(',')[1]);
            const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            return new Blob([ab], { type: mimeString });
        }

        async function generateAndShareReport() {
            ensureCurrentDay();
            const reportText = `ZenFlow — ${activeDay}\nВода (вручную): ${waterTotal()} мл\nКофеин (оценка): ${state.caffeineTotal} мг\nPomodoro завершено: ${state.pomodorosCompleted}\nВремя перед камерой: ${formatDuration(state.totalFocusTime)}\nУлыбки: ${state.smiles}\nРазминки: ${state.stretches}\nПриседания (оценка): ${state.squats}\nНастроение: ${state.moodLog.at(-1)?.label || 'не отмечено'}`;
            try {
                if (state.contacts.phone) {
                    const target = window.open(`https://wa.me/${state.contacts.phone}?text=${encodeURIComponent(reportText)}`, '_blank', 'noopener,noreferrer');
                    toast('Если WhatsApp не открылся, скачайте отчёт через «CSV».');
                } else if (navigator.share) {
                    await navigator.share({title: 'Отчёт ZenFlow', text: reportText});
                } else {
                    downloadFile('ZenFlow-report.txt', reportText, 'text/plain');
                    toast('Текстовый отчёт скачан.');
                }
            } catch (error) {
                if (error.name !== 'AbortError') { downloadFile('ZenFlow-report.txt', reportText, 'text/plain'); toast('Отчёт сохранён в текстовый файл.'); }
            }
        }



        document.getElementById('shareReportBtn').addEventListener('click', () => generateAndShareReport(false));

        // ========== UI HELPERS ==========
        document.getElementById('diagBtn').onclick = () => document.getElementById('diagnostics-modal').classList.add('active');
        document.getElementById('closeDiagnostics').onclick = () => document.getElementById('diagnostics-modal').classList.remove('active');
        document.getElementById('copyLogBtn').onclick = () => { navigator.clipboard.writeText(document.getElementById('diag-log').innerText); alert("Лог скопирован!"); };
        window.toggleVRMode = function() { state.isVRMode = !state.isVRMode; document.body.classList.toggle('vr-active', state.isVRMode); };

        /* */
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                stopBreathingGuide(); closeEyeBreak();
                document.querySelectorAll('[id$="-modal"], #auto-report-alert').forEach(el => el.classList.remove('active'));
                document.body.classList.remove('privacy-blur', 'vr-active'); state.isVRMode = false; toggleZenMode(false);
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
            const key = e.key.toLowerCase();
            if (key === 'v') { e.preventDefault(); window.toggleVRMode(); }
            if (key === 'b') { e.preventDefault(); document.getElementById('breathing-modal').classList.add('active'); }
            if (key === 'p') { e.preventDefault(); pomoState.running ? pausePomodoro() : startPomodoro(); }
        });



        function renderSettings() {
            const list = document.getElementById('settings-list');
            list.innerHTML = '';
            const allEnabled = Object.values(state.features).every(v => v);
            const masterRow = document.createElement('div');
            masterRow.tabIndex = 0; masterRow.setAttribute('role', 'switch'); masterRow.setAttribute('aria-checked', String(allEnabled));
            masterRow.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); masterRow.click(); } };
            masterRow.className = 'toggle-row mb-3 pb-3 border-b border-gray-200 bg-gray-50/50 px-2 rounded-lg';
            masterRow.innerHTML = `<span class="font-bold text-sm text-emerald-700">⚡ ${allEnabled ? 'Отключить все сенсоры' : 'Активировать все сенсоры'}</span><div class="toggle-switch ${allEnabled ? 'active' : ''}"></div>`;
            masterRow.onclick = () => { const ns = !allEnabled; for (const k in state.features) state.features[k] = ns; syncFeatureEffects(); renderSettings(); scheduleSave(); };
            list.appendChild(masterRow);
            for (const [key, enabled] of Object.entries(state.features)) {
                const row = document.createElement('div');
                row.className = 'toggle-row px-2 hover:bg-gray-50 rounded-lg transition-colors';
                row.innerHTML = `<span class="font-bold text-sm">${FEATURE_NAMES[key]||key}</span><div class="toggle-switch ${enabled ? 'active' : ''}" data-key="${key}"></div>`;
                row.querySelector('.toggle-switch').onclick = (e) => {
                    e.stopPropagation();
                    const k = e.currentTarget.dataset.key;
                    state.features[k] = !state.features[k];
                    if (k==='nightMode' && !state.features[k]) document.body.classList.remove('night-mode');
                    if (k==='privacy' && !state.features[k]) document.body.classList.remove('privacy-blur');
                    if (k==='zen' && !state.features[k] && state.isZenMode) toggleZenMode(false);
                    syncFeatureEffects(); renderSettings(); scheduleSave();
                };
                const control = row.querySelector('.toggle-switch');
                control.tabIndex = 0; control.setAttribute('role', 'switch'); control.setAttribute('aria-label', FEATURE_NAMES[key] || key); control.setAttribute('aria-checked', String(enabled));
                control.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); control.click(); } };
                list.appendChild(row);
            }
        }

        document.getElementById('settingsBtn').onclick = () => { renderSettings(); document.getElementById('settings-modal').classList.add('active'); };
        document.getElementById('closeSettings').onclick = () => document.getElementById('settings-modal').classList.remove('active');

        function addHistoryEvent(icon, text) {
            const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
            ensureCurrentDay();
            state.history.unshift({ time, icon, text, timestamp: Date.now() });
            if (state.history.length > 200) state.history.pop();
            renderHistory();
            scheduleSave();
        }

        function renderHistory() {
            const container = document.getElementById('history-list');
            if (!state.history.length) { container.innerHTML = '<div class="text-center text-xs text-gray-400 py-2">Событий пока нет</div>'; return; }
            container.innerHTML = state.history.map(item => `<div class="history-item"><span class="font-mono text-gray-400">${escapeHTML(item.time)}</span><span class="font-bold text-gray-700 flex-1 ml-2">${escapeHTML(item.icon)} ${escapeHTML(item.text)}</span></div>`).join('');
        }

        /* */
        function updateStatsUI() {
            document.getElementById('water-count').innerText = state.water;
            document.getElementById('smile-count').innerText = state.smiles;
            document.getElementById('stretch-count').innerText = state.stretches;
            document.getElementById('squat-count').innerText = state.squats;
            document.getElementById('modal-water-count').innerText = state.water;
            document.getElementById('modal-water-vol').innerText = (waterTotal() / 1000).toFixed(1);
            document.getElementById('modal-smiles').innerText = state.smiles;
            document.getElementById('modal-stretches').innerText = state.stretches;
            document.getElementById('modal-posture').innerText = state.postureCorrections;
            document.getElementById('modal-squats').innerText = state.squats;
            document.getElementById('vr-water').innerText = state.water;
            updateStreakUI();
            let score = 50 + ((state.smiles + state.water + state.stretches + state.squats) * 2) - ((state.postureCorrections + state.cigaretteCount) * 3);
            score = Math.max(0, Math.min(100, score));
            document.getElementById('modal-zen-score').innerText = Math.round(score) + "%";
            const bar = document.getElementById('modal-zen-bar');
            bar.style.width = score + "%";
            bar.className = score > 80 ? "bg-emerald-500 h-2.5 rounded-full transition-all duration-1000" : score > 50 ? "bg-yellow-500 h-2.5 rounded-full transition-all duration-1000" : "bg-rose-500 h-2.5 rounded-full transition-all duration-1000";

            recordActivityPoint();
            renderActivityChart();
            renderDailyPanel();
            scheduleSave();
        }



        function updateLiveTimer() {
            ensureCurrentDay();
            const now = Date.now();
            const elapsed = Math.max(0, Math.min(now - focusTick, 2000));
            focusTick = now;
            const focused = state.cameraActive && !document.hidden && now-vision.lastFrameAt<3000 &&
                (!state.features.autoPause || (faceLM && vision.faceCount===1 && now - state.lastFaceSeenTs < 1500));
            if (focused){state.totalFocusTime += elapsed;vision.eyeFocus=(vision.eyeFocus||0)+elapsed;vision.moveFocus=(vision.moveFocus||0)+elapsed;}
            state.isTimerPaused = !focused;
            document.getElementById('auto-pause-badge').classList.toggle('hidden', focused || !state.cameraActive);
            document.getElementById('focus-status-text').innerText = focused ? 'АКТИВНО' : 'ПАУЗА';
            document.getElementById('focus-icon').innerText = focused ? '⏱️' : '⏸️';
            renderFocusTime();
        }
        setInterval(updateLiveTimer, 1000);



        /* */
        function updateSportTimer() {
            if (!state.isExercising) return;
            const elapsed = Math.floor((Date.now() - state.exerciseStartTime) / 1000);
            if (elapsed > 0 && state.audioUnlocked) playTickSound();
            const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
            document.getElementById('sport-timer').innerText = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
        }
        setInterval(updateSportTimer, 1000);

        function updateWaterVisuals() {
            const percent = Math.min(100, waterTotal() / preferences.waterGoal * 100);
            document.getElementById('bottle-water-level').style.height = percent + '%';
            document.getElementById('glasses-container').textContent = '';
        }



        function getDistance(p1, p2) { return Math.sqrt(Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2)); }

        window.speakZen = function(text, priority = false) {
            if (!window.speechSynthesis || !state.audioUnlocked) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ru-RU'; utterance.pitch = state.isZenMode ? 0.7 : 0.9; utterance.rate = state.isZenMode ? 0.8 : 1.0;
            const indicator = document.getElementById('voice-indicator');
            utterance.onstart = () => indicator?.classList.remove('hidden');
            utterance.onend = () => indicator?.classList.add('hidden');
            window.speechSynthesis.speak(utterance);
        };

        function showAlert(msg, colorClass = "bg-rose-500") {
            const el = document.getElementById('smart-alert');
            document.getElementById('alert-msg').innerText = msg;
            el.className = `absolute top-4 left-0 right-0 flex justify-center transition-opacity duration-300 opacity-100 z-50`;
            el.firstElementChild.className = `${colorClass}/90 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg flex items-center gap-2`;
            setTimeout(() => { el.classList.remove('opacity-100'); el.classList.add('opacity-0'); }, 3000);
        }

        function checkTimeTheme() { applyTheme(); }



        /* */
        window.announceStatus = function(type) {
            if (!state.audioUnlocked) unlockAudio();
            const msgs = {
                water: `Вы записали ${waterTotal()} миллилитров воды.`,
                smile: `Вы улыбнулись ${state.smiles} раз.`,
                stretch: `Разминок шеи завершено: ${state.stretches}.`,
                squat: `Всего приседаний выполнено: ${state.squats}.`,
                posture: state.currPosture === "bad" ? "Выпрямите спину." : "Оценка положения доступна после калибровки камеры.",
                distance: state.currDist > 0.25 ? "Вы слишком близко к экрану. Сядьте глубже." : state.currDist < 0.10 ? "Вы далеко от экрана." : "Дистанция в норме.",
                zen: "Сложите руки вместе для активации режима дзен.",
                tilt: `Наклон вашей головы: ${Math.round(state.currTilt)} градусов.`
            };
            if (msgs[type]) window.speakZen(msgs[type], true);
        };

        const audioBtn = document.getElementById('audioUnlockBtn');
        function unlockAudio(){enableSpeech();}
        audioBtn.addEventListener('click',()=>{if(state.audioUnlocked)disableSpeech();else enableSpeech();});

        function performSnapshot(triggerType = "success") {
            if (vision.privacyActive || vision.faceCount>1 || !state.cameraActive || video.readyState < 2 || !video.videoWidth) return null;
            if (!['audit','ai-check','manual'].includes(triggerType) && !preferences.autoSnapshots) return null;
            const wrapper = document.getElementById('video-wrapper');
            const gallery = document.getElementById('snapshot-gallery');
            wrapper.classList.remove('shutter-flash'); void wrapper.offsetWidth; wrapper.classList.add('shutter-flash');
            try {
                const snapCanvas = document.createElement('canvas');
                snapCanvas.width = video.videoWidth; snapCanvas.height = video.videoHeight;
                const sCtx = snapCanvas.getContext('2d');
                if(vision.settings.mirror){sCtx.translate(snapCanvas.width, 0); sCtx.scale(-1, 1);} sCtx.drawImage(video, 0, 0);
                sCtx.font = "bold 60px sans-serif"; sCtx.fillStyle = "white"; sCtx.shadowColor = "black"; sCtx.shadowBlur = 10;
                const icons = { smile:"😊", water:"💧", stretch:"🧘", zen:"🙏", energy:"⚡", heart:"❤️", squat:"🏋️" };
                if (icons[triggerType]) sCtx.fillText(icons[triggerType], 30, 80);
                const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.85);
                if (!['audit','ai-check'].includes(triggerType)) {
                    if (!gallery.querySelector('img')) gallery.innerHTML = '';
                    const div = document.createElement('div');
                    div.className = 'snapshot-item flex-shrink-0 w-[120px] h-[90px] rounded-xl overflow-hidden border-2 border-white shadow-sm relative cursor-pointer hover:scale-105 transition-transform';
                    div.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover"><div class="absolute bottom-0 w-full bg-black/40 text-white text-[8px] text-center py-1 backdrop-blur-sm">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
                    div.onclick = () => { const link = document.createElement('a'); link.download=`zen-${Date.now()}.jpg`; link.href=dataUrl; link.click(); };
                    gallery.prepend(div);
                    while (gallery.children.length > 20) gallery.lastChild.remove();
                }
                return dataUrl;
            } catch(e) { return null; }
        }

        /* */
let aiLoading = null;
async function initAI(){
 if(aiLoading)return aiLoading;
 aiLoading=(async()=>{
  try{
   setCameraStatus('Загрузка моделей распознавания…');
   ({FaceLandmarker,HandLandmarker,ObjectDetector,FilesetResolver,DrawingUtils,PoseLandmarker}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm'));
   const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm');drawingUtils=new DrawingUtils(ctx);
   const tasks=[['face',()=>faceLM,v=>faceLM=v,FaceLandmarker,'face_landmarker/face_landmarker/float16/1/face_landmarker.task',{numFaces:2,outputFaceBlendshapes:true}],['hand',()=>handLM,v=>handLM=v,HandLandmarker,'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',{numHands:2}],['object',()=>objectDet,v=>objectDet=v,ObjectDetector,'object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',{scoreThreshold:.5}],['pose',()=>poseLM,v=>poseLM=v,PoseLandmarker,'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',{numPoses:1}]];
   for(const [name,get,set,Model,path,extra]of tasks){if(get()){vision.models[name]='ready';continue;}
    if(!needsModel(name))continue;
    vision.models[name]='loading';renderVisionStatus();
    try{set(await Model.createFromOptions(files,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/'+path,delegate:'CPU'},runningMode:'VIDEO',...extra}));vision.models[name]='ready';}
    catch(error){vision.models[name]='error';vision.coordinator.run('model-'+name,true,true,Date.now(),()=>{throw error;});logDiag(name+': '+error.message);}
    const short=name==='object'?'obj':name;if(document.getElementById('diag-'+short))document.getElementById('diag-'+short).textContent=vision.models[name];
    if(document.getElementById('ind-'+short))document.getElementById('ind-'+short).className='status-dot '+(get()?'dot-online':'dot-error');
   }
   return Boolean(faceLM||handLM||objectDet||poseLM);
  }catch(error){logDiag('Модели: '+error.message);Object.keys(vision.models).forEach(k=>vision.models[k]='error');return false;}
  finally{aiLoading=null;renderVisionStatus();}
 })();return aiLoading;
}



        /* */
function checkNeckStretch(landmarks) {
            if (!state.features.stretch) return;
            const angle = Math.atan2(landmarks[263].y-landmarks[33].y, landmarks[263].x-landmarks[33].x) * (180/Math.PI);
            state.currTilt = angle;
            document.getElementById('tilt-text').innerText = Math.round(angle) + "°";
            document.getElementById('tilt-bar').style.transform = `rotate(${angle}deg)`;
            if (Math.abs(angle) > 22 && Date.now() - state.lastStretchTs > 4000) {
                state.lastStretchTs = Date.now(); state.stretches++;
                updateStatsUI(); addHistoryEvent('🧘','Разминка шеи зафиксирована'); triggerSuccess("Отличная разминка шеи!","Шея расслабилась. Продолжайте держать спину.", "stretch");
            }
        }

function checkSmile(landmarks) {
            if (!state.features.smile) return;
            const ratio = getDistance(landmarks[61],landmarks[291]) / getDistance(landmarks[234],landmarks[454]);
            if (ratio < 0.34) smiling = false;
            if (ratio > 0.38 && !smiling && Date.now() - lastSmile > 2000) {
                lastSmile = Date.now(); smiling = true; state.smiles++;
                updateStatsUI(); addHistoryEvent('😊','Зафиксирована улыбка'); triggerSuccess("Чудесная улыбка!","Отличный настрой! Так держать.","smile");
                if (state.audioUnlocked) playSuccessSound();
            }
        }

        /* */
        // ========== СЦЕНАРИЙ: Контроль моргания (Защита сухости глаз) ==========
function checkPos(landmarks) {
            lastFace = landmarks;
            const eyeDist = getDistance(landmarks[33],landmarks[263]);
            state.currDist = eyeDist;
            let pct = (eyeDist-0.05)/0.25*100;
            document.getElementById('dist-bar').style.width = Math.max(5,Math.min(100,pct)) + "%";
            if (state.features.distance) {
                if (eyeDist > 0.24) { 
                    document.getElementById('dist-text').innerText="Слишком Близко!"; 
                    if(Date.now()-state.lastDistanceWarn>15000){
                        state.lastDistanceWarn=Date.now();
                        showAlert("Отодвиньтесь от экрана!","bg-rose-600");
                        window.speakZen("Вы слишком наклонились к экрану. Держите дистанцию.");
                        addHistoryEvent('📏', 'Нарушена дистанция до экрана');
                    } 
                }
                else if (eyeDist < 0.10) { document.getElementById('dist-text').innerText="Далеко!"; if(Date.now()-state.lastDistanceWarn>15000){state.lastDistanceWarn=Date.now();showAlert("Ближе","bg-amber-500");} }
                else document.getElementById('dist-text').innerText="Норма";
            }
        }

        // ========== SQUAT DETECTION ==========
/* */
function checkHeartGesture(landmarksArray) {
            if (!state.features.heart || landmarksArray.length < 2) return;
            const h1 = landmarksArray[0], h2 = landmarksArray[1];
            if (getDistance(h1[8],h2[8]) < 0.08 && getDistance(h1[4],h2[4]) < 0.08 && h1[4].y > h1[8].y) {
                if (Date.now() - state.lastGestureTs > 5000) { state.lastGestureTs = Date.now(); triggerSuccess("Любовь к себе!","Вы прекрасны! Берегите себя.","heart"); }
            }
        }

        function toggleZenMode(active) {
            state.isZenMode = active;
            const status = document.getElementById('zen-status');
            if (active) { document.body.classList.add('zen-active'); status.innerText = "АКТИВЕН"; window.speakZen("Режим дзен запущен. Погрузитесь в покой.",true); performSnapshot("zen"); }
            else { document.body.classList.remove('zen-active'); status.innerText = "Сложи руки"; }
        }

function triggerSuccess(msg, voiceMsg, type = "water") {
            const overlay = document.getElementById('touch-overlay');
            const msgs = { smile:"Счастье!", stretch:"Разминка!", heart:"Любовь!", squat:"Приседание!", energy:"Активность!" };
            document.getElementById('overlay-msg').innerText = msgs[type] || "Польза!";
            overlay.classList.add('active'); setTimeout(() => overlay.classList.remove('active'), 1500);
            if (type === "water") {
                toast('Если вы пили воду, укажите объём в дневнике.');
                return;
                if (state.water % 3 === 0 && state.treeLevel < TREES.length) {
                    state.treeLevel++;
                    document.getElementById('tree-lvl').innerText = state.treeLevel;
                    document.getElementById('tree-display').innerText = TREES[state.treeLevel-1];
                    // Анимированная вспышка уровня дерева
                    document.getElementById('tree-display').classList.add('animate-ping');
                    setTimeout(() => document.getElementById('tree-display').classList.remove('animate-ping'), 1000);
                    window.speakZen(`Ваш сад осознанности вырос до уровня ${state.treeLevel}! Поздравляю.`, true);
                }
            }
            updateStatsUI(); performSnapshot(type); addChat(msg, 'ai'); window.speakZen(voiceMsg || msg);
        }

        /* */
function predict() {
 if(!state.cameraActive)return;
 frameHandle=requestAnimationFrame(predict);
 const now=performance.now(),wall=Date.now();
 if(document.hidden)return;
 sensor('frameHealth',true,()=>{
  if(vision.lastFrameAt&&wall-vision.lastFrameAt>3000){setCameraStatus('Кадры не обновляются. Проверьте камеру или перезапустите её.');}
 });
 if(video.readyState<2||video.currentTime===lastVideoTime)return;
 const interval=vision.settings.quality==='eco'?100:vision.settings.quality==='detail'?40:66;
 if(now-lastTime<interval)return;lastTime=now;lastVideoTime=video.currentTime;vision.lastFrameAt=wall;
 ensureCurrentDay();const started=performance.now();
 vision.frameTimes.push(wall);vision.frameTimes=vision.frameTimes.filter(t=>wall-t<2000);
 vision.fps=vision.frameTimes.length>1?(vision.frameTimes.length-1)*1000/Math.max(1,wall-vision.frameTimes[0]):0;
 if(due('pixels',wall,300))processPixels();
 const groups=[['face',faceLM,100,()=>processFace()],['hand',handLM,150,()=>processHands()],['object',objectDet,500,()=>processObjects()],['pose',poseLM,200,()=>processPose()]];
 for(const [key,model,delay,process]of groups){
  const needed=needsModel(key);
  if(!needed||!model||!due(key,wall,vision.settings.quality==='eco'?delay*2:delay))continue;
  vision.coordinator.run('model-'+key,true,true,wall,()=>{
   const result=model.detectForVideo(video,now);
   vision.due['valid-'+key]=wall;if(key==='face')vision.faceResult=result;else if(key==='hand')vision.handResult=result;else if(key==='pose')vision.poseResult=result;else {vision.objects=result.detections||[];vision.lastObjectAt=wall;}
   process();
  });
  if(vision.coordinator.modules.get('model-'+key)?.status==='error'){
   for(const [feature,def]of Object.entries(FEATURES))if(def[1]===key){vision.gates[feature]?.reset();vision.coordinator.run(feature,state.features[feature],false,wall,()=>{});}
   if(key==='face'){vision.metrics=null;lastFace=null;vision.blink.reset();state.lastFaceSeenTs=0;}if(key==='pose'){vision.rep.reset();vision.armsUp=false;}if(key==='object'||key==='face')habits.tracker.reset();
  }
 }
 if(wall-state.lastFaceSeenTs>1500){vision.metrics=null;lastFace=null;vision.blink.reset();}
 vision.coordinator.run('overlay',true,true,wall,drawVisionOverlay);
 vision.latency=performance.now()-started;
 if(due('ui',wall,1000))renderVisionStatus();
 state.frameCount++;
}

        /* */
        function addChat(text, role) {
            const box = document.getElementById('chat-box');
            const d = document.createElement('div');
            d.className = `chat-bubble ${role==='user'?'chat-user':'chat-ai'} animate-fade-in`;
            d.textContent = text;
            while (box.children.length > 100) box.firstChild.remove();
            box.appendChild(d); box.scrollTop = box.scrollHeight;
        }

        document.getElementById('statsBtn').onclick = () => { updateStatsUI(); renderHistory(); document.getElementById('stats-modal').classList.add('active'); };
        document.getElementById('closeStats').onclick = () => document.getElementById('stats-modal').classList.remove('active');

        document.getElementById('startBtn').onclick = startCamera;


        document.getElementById('adviceBtn').onclick = async () => {
            unlockAudio();
            const btn = document.getElementById('adviceBtn'); btn.disabled = true; btn.innerText = "Подключение...";
            addChat("Нужен совет для баланса...", 'user');
            const wisdoms = [
                "Каждый вдох — это начало нового момента. Глубоко выдохните.",
                "Фокус — это не отсутствие отвлечений, а умение вовремя возвращаться.",
                "Сделайте короткий перерыв и проверьте, хочется ли вам пить.",
                "Ваша осанка отражает вашу уверенность. Выпрямите плечи.",
                "Сделайте перерыв на 20 секунд и посмотрите вдаль по правилу 20-20-20.",
                "Если вам удобно, встаньте и немного пройдитесь."
            ];
            try {
                {
                    const wisdom = wisdoms[Math.floor(Math.random() * wisdoms.length)];
                    addChat(wisdom, 'ai'); window.speakZen(wisdom);
                }
            } catch(e) {
                const wisdom = wisdoms[Math.floor(Math.random() * wisdoms.length)];
                addChat(wisdom, 'ai'); window.speakZen(wisdom);
            }
            btn.disabled = false; btn.innerText = "✨ Запросить Мудрость";
        };

        // ===== ZenFlow 7.0: device-local daily data and camera lifecycle =====
        const DATA_KEY = 'zenflow_v7';
        const COUNTERS = ['water','smiles','stretches','faceYoga','treeLevel','cigaretteCount','foodCount','postureCorrections','squats','totalFocusTime','totalBlinksThisSession','pomodorosCompleted'];
        const defaultPreferences = {waterGoal:2000, workMinutes:25, breakMinutes:5, longBreakMinutes:15, theme:'auto', autoSnapshots:false};
        let preferences = {...defaultPreferences};
        let dailyStore = {schema:7, days:Object.create(null)};
        let activeDay = localDay(), focusTick = Date.now(), saveHandle = null, toastHandle = null;
        let storageWritable = true, reportDay = '', ready = false, lastStoredValue = null;
        let frameHandle = null, cameraGeneration = 0, lastVideoTime = -1;
        let lastFace = null, postureBaseline = null, standingCandidate = null;
        let eyesClosed = false, eyesClosedAt = 0, smiling = false, lastSmile = 0, lastWaterPrompt = 0;
        Object.assign(state, {hydrationLog:[], activity:[], pomodorosCompleted:0});
const vision=createVisionRuntime();const habits=createHabits();const speech=createSpeech();
for(const [key,[name]] of Object.entries(FEATURES)){if(!(key in state.features))state.features[key]=true;FEATURE_NAMES[key]=name;}

        function localDay(value = Date.now()) {
            const date = new Date(value), pad = n => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
        }
        function emptyDay() {
            const value = Object.fromEntries(COUNTERS.map(key => [key, key === 'treeLevel' ? 1 : 0]));
            return {...value, hydrationLog:[], caffeineLog:[], moodLog:[], history:[], activity:[]};
        }
        function waterTotal() { return state.hydrationLog.reduce((total, item) => total + item.ml, 0); }
        function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
        function formatDuration(ms) {
            const sec = Math.floor(Math.max(0,ms)/1000), pad = n => String(n).padStart(2,'0');
            return `${pad(Math.floor(sec/3600))}:${pad(Math.floor(sec/60)%60)}:${pad(sec%60)}`;
        }
        function toast(message) {
            const el = document.getElementById('zf-toast');
            el.textContent = message; el.hidden = false;
            clearTimeout(toastHandle); toastHandle = setTimeout(() => el.hidden = true, 6000);
        }
        function captureDay() {
            return {...Object.fromEntries(COUNTERS.map(key => [key, state[key]])),
                hydrationLog:state.hydrationLog, caffeineLog:state.caffeineLog, moodLog:state.moodLog,
                history:state.history, activity:state.activity};
        }
        function applyDay(day) {
            Object.assign(state, emptyDay(), day);
            state.water = state.hydrationLog.length;
            state.blinks = state.totalBlinksThisSession;
            state.caffeineTotal = state.caffeineLog.reduce((total,item) => total + item.mg, 0);
            state.treeLevel = Math.min(TREES.length, 1 + Math.floor(state.water/3));
        }
        function ensureCurrentDay() {
            if (!ready || activeDay === localDay()) return;
            dailyStore.days[activeDay] = captureDay();
            activeDay = localDay();
            applyDay(dailyStore.days[activeDay] || emptyDay());
            focusTick = Date.now();
            state.lastEyeBreak = Date.now();vision.eyeFocus=0;
            loadStreak(); renderMood(); updateCaffeineUI(); renderHistory();
            updateStatsUI(); renderFocusTime(); saveData();
        }
        function scheduleSave() {
            if (!ready) return;
            clearTimeout(saveHandle);
            saveHandle = setTimeout(saveData, 250);
        }
        function saveData() {
            if (!ready) return;
            clearTimeout(saveHandle);
            dailyStore.days[activeDay] = captureDay();
            for (const key of Object.keys(dailyStore.days).sort().slice(0,-90)) delete dailyStore.days[key];
            dailyStore.preferences = {...preferences, features:{...state.features}, eyeBreakInterval:state.eyeBreakInterval};
            dailyStore.timer = {running:pomoState.running, isBreak:pomoState.isBreak, timeLeft:pomoState.timeLeft, sessions:pomoState.sessions, deadline:pomoState.deadline || null};
            dailyStore.report = {day:reportDay, lastSent:state.autoReport.lastSent};
            if (!storageWritable) return;
            try {
                if (localStorage.getItem(DATA_KEY) !== lastStoredValue) {
                    storageWritable = false;
                    document.getElementById('save-status').innerText = 'Данные изменены в другой вкладке. Скачайте JSON текущих записей и обновите страницу.';
                    return;
                }
                const serialized = JSON.stringify(dailyStore);
                localStorage.setItem(DATA_KEY, serialized);
                lastStoredValue = serialized;
                document.getElementById('save-status').innerText = 'Сохранено на этом устройстве · последние 90 дней';
            } catch {
                document.getElementById('save-status').innerText = 'Не удалось сохранить. Скачайте резервную копию JSON.';
            }
        }
        function bounded(value, min, max) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Недопустимое числовое значение');
            return value;
        }
        function textValue(value, max = 300) {
            if (typeof value !== 'string' || value.length > max) throw new Error('Недопустимая строка');
            return value;
        }
        function listValue(value, limit, mapper) {
            if (!Array.isArray(value) || value.length > limit) throw new Error('Слишком много записей или неверный формат');
            return value.map(mapper);
        }
        function validateBackup(input) {
            if (!input || input.schema !== 7 || !input.days || typeof input.days !== 'object' || Array.isArray(input.days)) throw new Error('Нужна резервная копия ZenFlow 7 или 8');
            const entries = Object.entries(input.days);
            if (entries.length > 90) throw new Error('В копии больше 90 дней');
            const clean = {schema:7, days:Object.create(null)};
            const timestamp = value => bounded(value, 0, Date.now()+86400000);
            for (const [date, raw] of entries) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || localDay(new Date(date+'T12:00:00')) !== date || !raw || typeof raw !== 'object') throw new Error('Неверная дата');
                const record = emptyDay();
                for (const key of COUNTERS) record[key] = bounded(raw[key] ?? record[key], 0, key === 'totalFocusTime' ? 172800000 : 1000000);
                record.hydrationLog = listValue(raw.hydrationLog || [], 2000, item => ({ml:bounded(item.ml,10,2000),time:timestamp(item.time)}));
                record.caffeineLog = listValue(raw.caffeineLog || [], 2000, item => ({type:textValue(item.type,30),mg:bounded(item.mg,0,2000),time:timestamp(item.time)}));
                record.moodLog = listValue(raw.moodLog || [], 2000, item => ({emoji:textValue(item.emoji,20),label:textValue(item.label,100),time:timestamp(item.time)}));
                record.history = listValue(raw.history || [], 200, item => ({time:textValue(item.time,30),icon:textValue(item.icon,20),text:textValue(item.text),timestamp:timestamp(item.timestamp || 0)}));
                record.activity = listValue(raw.activity || [], 288, item => ({time:timestamp(item.time),smiles:bounded(item.smiles,0,1000000),water:bounded(item.water,0,1000000),squats:bounded(item.squats,0,1000000)}));
                for (const item of [...record.hydrationLog, ...record.caffeineLog, ...record.moodLog, ...record.activity]) {
                    if (localDay(item.time) !== date) throw new Error('Дата записи не совпадает с днём');
                }
                clean.days[date] = record;
            }
            const p = input.preferences || {};
            clean.preferences = {
                waterGoal:bounded(p.waterGoal ?? 2000,250,6000), workMinutes:bounded(p.workMinutes ?? 25,1,180),
                breakMinutes:bounded(p.breakMinutes ?? 5,1,60), longBreakMinutes:bounded(p.longBreakMinutes ?? 15,1,90),
                theme:['auto','dark','light'].includes(p.theme) ? p.theme : 'auto', autoSnapshots:p.autoSnapshots === true,
                features:Object.fromEntries(Object.keys(state.features).filter(key => typeof p.features?.[key] === 'boolean').map(key => [key, p.features[key]])),
                eyeBreakInterval:[20,30,45,60].includes(p.eyeBreakInterval) ? p.eyeBreakInterval : 20
            };
            if (input.timer) {
                const t = input.timer;
                clean.timer = {running:t.running === true,isBreak:t.isBreak === true,timeLeft:bounded(t.timeLeft,0,10800),sessions:bounded(t.sessions,0,1000000),deadline:t.deadline === null ? null : bounded(t.deadline,0,Date.now()+10800000)};
                if (clean.timer.running && clean.timer.deadline === null) throw new Error('Нет времени завершения таймера');
            }
            if (input.report) clean.report = {day:textValue(input.report.day || '',10),lastSent:timestamp(input.report.lastSent || 0)};
            return clean;
        }
        function applyPreferences() {
            POMO.workDuration = Math.round(preferences.workMinutes*60);
            POMO.breakDuration = Math.round(preferences.breakMinutes*60);
            POMO.longBreakDuration = Math.round(preferences.longBreakMinutes*60);
            document.getElementById('cfg-water-goal').value = preferences.waterGoal;
            document.getElementById('cfg-work').value = preferences.workMinutes;
            document.getElementById('cfg-break').value = preferences.breakMinutes;
            document.getElementById('cfg-long-break').value = preferences.longBreakMinutes;
            document.getElementById('cfg-theme').value = preferences.theme;
            document.getElementById('cfg-snapshots').checked = preferences.autoSnapshots;
            eyeRuleToggle.classList.toggle('active', state.features.eyeRule);
            eyeIntervalSelect.value = state.eyeBreakInterval;
            applyTheme();
        }
        function applyTheme() {
            if (!ready) return;
            const hour = new Date().getHours();
            state.isNightMode = preferences.theme === 'dark' || (preferences.theme === 'auto' && state.features.nightMode && (hour >=20 || hour <7));
            document.body.classList.toggle('night-mode', state.isNightMode);
        }
        function syncFeatureEffects() {
for(const [k,g] of Object.entries(vision.gates))if(!state.features[k])g.reset();
if(!state.features.privacy)vision.privacyActive=false;if(!state.features.sportMode)vision.exercise=false;
if(state.cameraActive)initAI();
            if (!state.features.privacy) document.body.classList.remove('privacy-blur');
            if (!state.features.zen) toggleZenMode(false);
            if (!state.features.sportMode) { state.isExercising = false; document.getElementById('sport-overlay').classList.remove('active'); }
            if (!state.features.eyeRule) closeEyeBreak();
            eyeRuleToggle.classList.toggle('active', state.features.eyeRule);
            applyTheme();
        }
        function renderFocusTime() {
            const time = formatDuration(state.totalFocusTime);
            for (const id of ['live-timer','modal-timer','vr-timer','daily-focus']) document.getElementById(id).innerText = time;
        }
        function renderDailyPanel() {
            const total = waterTotal();
            document.getElementById('daily-date').innerText = new Date(activeDay+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
            document.getElementById('water-total').innerText = `${total} / ${preferences.waterGoal} мл`;
            document.getElementById('water-progress').max = preferences.waterGoal;
            document.getElementById('water-progress').value = Math.min(total,preferences.waterGoal);
            document.getElementById('undo-water').disabled = !state.hydrationLog.length;
            document.getElementById('daily-pomos').innerText = `${state.pomodorosCompleted} завершено`;
            document.getElementById('tree-lvl').innerText = state.treeLevel;
            document.getElementById('tree-display').innerText = TREES[Math.min(state.treeLevel-1,TREES.length-1)];
            updateWaterVisuals(); renderWeek();
        }
        function renderWeek() {
            const rows = [];
            for (let i=0;i<7;i++) {
                const date = new Date(); date.setDate(date.getDate()-i);
                const key = localDay(date), record = key === activeDay ? captureDay() : dailyStore.days[key];
                rows.push(`<tr><td>${date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</td><td>${record ? record.hydrationLog.reduce((s,item)=>s+item.ml,0) : '—'}</td><td>${record ? record.pomodorosCompleted : '—'}</td><td>${record ? Math.floor(record.totalFocusTime/60000) : '—'}</td></tr>`);
            }
            document.getElementById('weekly-history').innerHTML = rows.join('');
        }
        function recordActivityPoint() {
            const point = {time:Date.now(),smiles:state.smiles,water:state.water,squats:state.squats};
            const last = state.activity.at(-1);
            if (!last || ['smiles','water','squats'].some(key => last[key] !== point[key])) {
                state.activity.push(point); state.activity = state.activity.slice(-288);
            }
        }
        function renderActivityChart() {
            initChart();
            if (!zenChartInstance) return;
            document.getElementById('chart-fallback').hidden = true;
            zenChartInstance.data.labels = state.activity.map(item=>new Date(item.time).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
            ['smiles','water','squats'].forEach((key,index)=>zenChartInstance.data.datasets[index].data=state.activity.map(item=>item[key]));
            zenChartInstance.update('none');
        }
        function renderMood() {
            const last = state.moodLog.at(-1);
            for (const id of ['current-mood-display','modal-mood','vibe-emoji','vr-vibe']) document.getElementById(id).innerText = last?.emoji || '😐';
            const strip = document.getElementById('mood-log-strip'); strip.textContent = '';
            for (const item of state.moodLog.slice(-40)) {
                const dot = document.createElement('span'); dot.textContent = item.emoji;
                dot.title = item.label + ' · ' + new Date(item.time).toLocaleTimeString(); strip.appendChild(dot);
            }
        }
        function addWater(ml) {
            ensureCurrentDay();
            if (!Number.isInteger(ml) || ml<10 || ml>2000) { toast('Введите объём от 10 до 2000 мл.'); return; }
            if (state.hydrationLog.length >=2000) { toast('Достигнут предел записей за день.'); return; }
            state.hydrationLog.push({ml,time:Date.now()});habits.lastWaterReminder=Date.now();
            state.water = state.hydrationLog.length; state.treeLevel = Math.min(TREES.length,1+Math.floor(state.water/3));
            addHistoryEvent('💧',`Вода: +${ml} мл (вручную)`);
            document.getElementById('water-confirm').hidden = true;
            updateStatsUI(); saveData(); toast(`Добавлено ${ml} мл.`);
        }
        function downloadFile(name, content, type) {
            const url = URL.createObjectURL(new Blob([content],{type:type+';charset=utf-8'}));
            const link = document.createElement('a'); link.href=url; link.download=name;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
        }
        function exportCSV() {
            ensureCurrentDay(); saveData();
            const rows = [['Дата','Вода мл','Помодоро','Перед камерой минут','Кофеин мг оценка','Улыбки оценка','Разминки оценка','Приседания оценка']];
            for (const [date,day] of Object.entries(dailyStore.days).sort(([a],[b])=>a.localeCompare(b))) {
                rows.push([date,day.hydrationLog.reduce((s,i)=>s+i.ml,0),day.pomodorosCompleted,(day.totalFocusTime/60000).toFixed(1),day.caffeineLog.reduce((s,i)=>s+i.mg,0),day.smiles,day.stretches,day.squats]);
            }
            downloadFile('ZenFlow-history.csv','\uFEFF'+rows.map(row=>row.map(cell=>'"'+String(cell).replaceAll('"','""')+'"').join(';')).join('\r\n'),'text/csv');
        }
        function setCameraStatus(message) {
            document.getElementById('camera-status').innerText=message;
            document.getElementById('status-text').innerText=state.cameraActive ? 'Камера включена' : 'Камера выключена';
        }
        function stopCamera() {
 habits.tracker.reset();
 stopRecording(); stopBreathingGuide();closeEyeBreak();vision.notices.clear();vision.metrics=null;vision.poseMetrics=null;vision.quality=null;vision.motionResult=null;vision.exercise=false;vision.privacyActive=false;
            cameraGeneration++;
            updateLiveTimer();
            state.cameraActive=false; state.isTimerPaused=true; state.isExercising=false;
            if (frameHandle!==null) cancelAnimationFrame(frameHandle); frameHandle=null;
            video.srcObject?.getTracks().forEach(track=>track.stop());
            video.srcObject=null; video.pause(); ctx.clearRect(0,0,canvas.width,canvas.height);
            lastVideoTime=-1; lastFace=null; postureBaseline=null; eyesClosed=false; smiling=false;
            document.body.classList.remove('privacy-blur'); toggleZenMode(false);
            document.getElementById('sport-overlay').classList.remove('active');
            document.getElementById('startBtn').disabled=false;
            document.getElementById('startBtn').classList.remove('hidden');
            document.getElementById('live-ui').classList.add('hidden');
            document.getElementById('pre-loader').classList.remove('hidden');
            document.getElementById('pre-loader').style.opacity='1';
            for (const id of ['stop-camera','calibrate-camera','take-snapshot','retry-ai']) document.getElementById(id).disabled=true;
            document.getElementById('diag-cam').innerText='Выключена';
            document.getElementById('focus-status-text').innerText='ПАУЗА';
            document.getElementById('auto-pause-badge').classList.add('hidden');
            setCameraStatus('Камера выключена. Дневник и Pomodoro доступны.'); saveData();renderVisionStatus();
        }
        async function startCamera() {
            if (state.cameraActive || document.getElementById('startBtn').disabled) return;
            if (!navigator.mediaDevices?.getUserMedia) { setCameraStatus('Камера недоступна: откройте файл в современном браузере через HTTPS или localhost.'); return; }
            const generation=++cameraGeneration;
            document.getElementById('startBtn').disabled=true;
            document.getElementById('stop-camera').disabled=false;
            setCameraStatus('Ожидание доступа к камере…');
            try {
                const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(vision.settings.cameraId?{deviceId:{exact:vision.settings.cameraId}}:{facingMode:'user'}),width:{ideal:vision.settings.quality==='detail'?1280:640},height:{ideal:vision.settings.quality==='detail'?720:480}}});
                if (generation!==cameraGeneration) { stream.getTracks().forEach(track=>track.stop()); return; }
                video.srcObject=stream;
                await new Promise((resolve,reject)=>{
                    const finish=()=>{clearTimeout(timeout);video.removeEventListener('loadedmetadata',finish);resolve();};
                    const timeout=setTimeout(()=>{video.removeEventListener('loadedmetadata',finish);reject(new Error('Камера не передала кадр.'));},10000);
                    if (video.readyState>=1) finish(); else video.addEventListener('loadedmetadata',finish,{once:true});
                });
                if (generation!==cameraGeneration) return;
                await video.play();
                if (generation!==cameraGeneration) return;
                resetVisionSession();applyVisionMirror();refreshCameras();state.cameraActive=true; focusTick=Date.now(); state.lastFaceSeenTs=0; state.frameCount=0;
                state.baselineNoseY=null; state.calibrationSamples=[]; state.lastDetections=[];
                state.squatBaselineY=null; state.squatGoingDown=false; state.lastEyeBreak=Date.now();
                canvas.width=video.videoWidth;canvas.height=video.videoHeight;lastVideoTime=-1;
                document.getElementById('pre-loader').classList.add('hidden');
                document.getElementById('live-ui').classList.remove('hidden');
                document.getElementById('startBtn').classList.add('hidden');
                for (const id of ['calibrate-camera','take-snapshot']) document.getElementById(id).disabled=false;
                document.getElementById('diag-cam').innerText='OK';
                for (const track of stream.getTracks()) track.addEventListener('ended',()=>{if(generation===cameraGeneration) {stopCamera();toast('Камера отключена устройством.');}});
                predict();
                const loaded=await initAI();
                if (generation!==cameraGeneration) return;
                document.getElementById('retry-ai').disabled=false;
                setCameraStatus(loaded ? `Распознавание: ${[faceLM&&'лицо',handLM&&'руки',objectDet&&'объекты'].filter(Boolean).join(', ')}. Сядьте удобно и выполните калибровку.` : 'Камера работает без распознавания. Проверьте интернет и нажмите «Повторить загрузку AI».');
            } catch(error) {
                if(generation!==cameraGeneration) return;
                stopCamera();
                const messages={NotAllowedError:'Доступ к камере запрещён. Разрешите его в настройках браузера.',NotFoundError:'Камера не найдена. Подключите камеру и повторите.',NotReadableError:'Камера занята другой программой. Закройте её и повторите.'};
                setCameraStatus(messages[error.name]||'Не удалось запустить камеру. '+error.message);
                logDiag('Камера: '+error.message);
            }
        }

function createVisionRuntime() {
 const defaults={cameraId:'',quality:'balanced',mirror:true,overlay:'mesh',roi:'all',objectFilter:'all',notifications:true,quietFocus:false,breakMinutes:45,autoContinue:false};
 let settings={...defaults};try{const saved=JSON.parse(localStorage.getItem('zenflow_vision_preferences')||'{}');for(const k of Object.keys(defaults))if(typeof saved[k]===typeof defaults[k])settings[k]=saved[k];}catch{}
 if(!['balanced','eco','detail'].includes(settings.quality))settings.quality='balanced';
for(const [key,values] of Object.entries({overlay:['mesh','contour','none'],roi:['all','center'],objectFilter:['all','drinks','phone']}))if(!values.includes(settings[key]))settings[key]=defaults[key];
 settings.breakMinutes=clamp(settings.breakMinutes,5,120);
 const gates=Object.fromEntries(Object.keys(FEATURES).map(k=>[k,new Gate(k==='privacy'?700:k==='yawn'?1400:600,k==='phone'?30000:5000)]));
 return {settings,coordinator:new Coordinator(),notices:new NoticeQueue(),gates,blink:new BlinkTracker(),rep:new RepTracker(),motion:new MotionTracker(),models:{face:'idle',hand:'idle',object:'idle',pose:'idle'},
  faceCount:0,faceResult:null,handResult:null,poseResult:null,objects:[],metrics:null,poseMetrics:null,quality:null,motionResult:null,
  due:{},lastFrameAt:0,frameTimes:[],fps:0,latency:0,lastUI:0,startedAt:0,sessionEvents:[],lastObjectAt:0,lastPresence:null,awaySince:null,
  calibration:null,exercise:false,armsUp:false,breathing:false,breathDeadline:0,eyeDeadline:0,eyeSnoozeUntil:0,breakDue:0,privacyActive:false,
  recorder:null,recordChunks:[],recordBytes:0,recordTimer:null,recordURL:null,recordStarted:0,releasePending:false,selfTests:[],pixelCanvas:document.createElement('canvas'),
  session:{smiles:0,blinks:0,closures:0,mouth:0,turns:0,gestures:0,phone:0,touches:0,motion:0,arms:0,squats:0},uiReady:false};
}

function sensor(key,available,fn) {
 if(!state.features[key]||!available)vision.gates[key]?.reset();
 return vision.coordinator.run(key,Boolean(state.features[key]),available,Date.now(),fn);
}

function sensorEvent(key,text,icon='•',speak=true) {
 const now=Date.now();vision.sessionEvents.unshift({time:now,key,text});vision.sessionEvents=vision.sessionEvents.slice(0,250);
 addHistoryEvent(icon,text);if(speak)vision.notices.push(key,text,now,key==='privacy'?3:1,15000);
}

function renderVisionStatus() {
 if(!vision.uiReady)return;
 const now=Date.now(),m=vision.metrics,q=vision.quality,p=vision.poseMetrics;
 const put=(id,value)=>document.getElementById(id).textContent=value;
 put('vision-version',`${RELEASE_NAME} ${VERSION}`);
 put('vision-faces',state.cameraActive?String(vision.faceCount):'—');
 put('vision-fps',state.cameraActive?`${vision.fps.toFixed(1)} FPS`:'—');
 put('vision-latency',state.cameraActive?`${Math.round(vision.latency)} мс`:'—');
 put('vision-quality-metric',q?`${Math.round(q.mean)}/255 · контраст ${Math.round(q.contrast)}`:'—');
 put('vision-motion',vision.motionResult?`${Math.round(vision.motionResult.fraction*100)}% зоны`:'—');
 put('vision-blinks',vision.metrics?`${vision.blink.history.filter(t=>now-t<60000).length} за 60 сек`:'—');
 put('vision-head',m?`${Math.round(m.tilt)}° · поворот ${m.turn.toFixed(2)}`:'—');
 put('vision-pose',p?`${p.visible}/33 точек · колено ${p.knee===null?'—':Math.round(p.knee)+'°'}`:'—');
 put('vision-record-state',vision.recorder?`Запись ${Math.floor((now-vision.recordStarted)/1000)} / 60 сек`:'Запись выключена');
 put('vision-summary',`Улыбки ${vision.session.smiles} · моргания ${vision.session.blinks} · жесты ${vision.session.gestures} · движения ${vision.session.motion} · приседания ${vision.session.squats}`);
 document.getElementById('vision-record').disabled=!state.cameraActive||vision.privacyActive||Boolean(vision.recorder)||typeof MediaRecorder==='undefined';
 document.getElementById('vision-record-stop').disabled=!vision.recorder;
 document.getElementById('vision-exercise').textContent=vision.exercise?'Закончить разминку':'Начать разминку';
 document.getElementById('vision-release').disabled=state.cameraActive||Boolean(aiLoading);
 const statuses={ok:'Работает',waiting:'Ожидание',off:'Выключен',error:'Ошибка'};
 const filter=document.getElementById('vision-feature-filter').value;
 const rows=[];
 for(const [key,[name,dependency,detail]]of Object.entries(FEATURES)){
  let item=vision.coordinator.modules.get(key)||{status:state.features[key]?'waiting':'off',runs:0,errors:0,last:0};
  if(!state.features[key])item={...item,status:'off'};
  else if(dependency!=='local'&&(!state.cameraActive||document.hidden||!item.last||now-item.last>3000))item={...item,status:'waiting'};
  if(filter!=='all'&&item.status!==filter)continue;
  const tests=vision.selfTests.filter(t=>t.features?.includes(key));
  const testLabel=tests.length?`${tests.filter(t=>t.passed).length}/${tests.length} логика`:'Не запускался';
  rows.push(`<tr><td><label><input type="checkbox" data-vision-feature="${key}" ${state.features[key]?'checked':''}> ${escapeHTML(name)}</label><small>${escapeHTML(detail)}</small></td><td><span class="sensor-state ${item.status}">${statuses[item.status]}</span><small>${escapeHTML(item.reason||dependency)} · ${item.runs} проверок</small></td><td><button class="zf-button" data-sensor-test="${key}">${testLabel}</button></td></tr>`);
 }
 const table=document.getElementById('vision-sensors');if(!table.contains?.(document.activeElement))table.innerHTML=rows.join('');
 const eventFilter=document.getElementById('vision-event-filter').value;
 document.getElementById('vision-events').innerHTML=vision.sessionEvents.filter(x=>eventFilter==='all'||x.key===eventFilter).slice(0,40).map(x=>`<li><time>${new Date(x.time).toLocaleTimeString('ru-RU')}</time> ${escapeHTML(x.text)}</li>`).join('')||'<li>Событий этой сессии пока нет.</li>';
 put('vision-tests-summary',vision.selfTests.length?`Самотесты: ${vision.selfTests.filter(t=>t.passed).length}/${vision.selfTests.length}. Это синтетические тесты логики, не проверка точности на вашей камере.`:'Самотесты ещё не запускались.');
}

function due(key,now,ms){if(now-(vision.due[key]??-Infinity)<ms)return false;vision.due[key]=now;return true;}

function processPixels(){
 const needed=['light','motion','heatmap'].some(key=>state.features[key]);if(!needed)return;
 const c=vision.pixelCanvas;c.width=64;c.height=48;const pc=c.getContext('2d',{willReadFrequently:true});
 try{pc.drawImage(video,0,0,64,48);const q=imageQuality(pc.getImageData(0,0,64,48).data,64,48);vision.quality=q;
  sensor('light',Boolean(q),()=>{state.avgLight=Math.round(q.mean);document.getElementById('light-val').textContent=state.avgLight;
   const dark=q.mean<35,bright=q.clipped>.65; if(vision.gates.light.update(dark||bright,Date.now()))sensorEvent('light',dark?'Кадр тёмный: добавьте освещение.':'Много пересвеченных пикселей: измените свет.','💡');});
  if(state.features.motion||state.features.heatmap)vision.motionResult=vision.motion.update(q.luminance,64,48,vision.settings.roi);
  sensor('motion',Boolean(vision.motionResult),()=>{if(vision.gates.motion.update(vision.motionResult.fraction>.08,Date.now())){vision.session.motion++;sensorEvent('motion','Движение в выбранной зоне кадра','↔️',false);}});
  sensor('heatmap',Boolean(vision.motionResult),()=>vision.motionResult.heat);
 }catch(error){vision.coordinator.run('pixels',true,true,Date.now(),()=>{throw error;});}
}

function processFace(){
 const now=Date.now(),res=vision.faceResult;vision.faceCount=res?.faceLandmarks?.length||0;
 sensor('privacy',true,()=>{const multiple=vision.faceCount>1;
  if(vision.gates.privacy.update(multiple,now)){vision.privacyActive=true;stopRecording();vision.notices.clear();sensorEvent('privacy','В кадре несколько лиц. Экран скрыт.','🛡️',false);}
  if(!multiple){vision.privacyActive=false;vision.gates.privacy.reset();}
  document.body.classList.toggle('privacy-blur',vision.privacyActive);
 });
 sensor('presence',true,()=>{
  const present=vision.faceCount===1;
  if(present!==vision.lastPresence){vision.lastPresence=present;if(!present){vision.awaySince=now;vision.absenceLogged=false;}
   else{const absent=vision.awaySince?Math.round((now-vision.awaySince)/1000):0;vision.awaySince=null;if(absent>5)sensorEvent('presence',`Лицо снова в кадре. Отсутствие: ${absent} сек`,'👤',false);}
  }
  if(!present&&vision.awaySince&&now-vision.awaySince>5000&&!vision.absenceLogged){vision.absenceLogged=true;sensorEvent('presence','Одного лица в кадре нет более 5 секунд','👤',false);}
 });
 const single=vision.faceCount===1,lm=single?res.faceLandmarks[0]:null;
 vision.metrics=single?faceMetrics(lm):null;const m=vision.metrics;
 if(!m){vision.smileActive=false;lastFace=null;vision.blink.reset();vision.rep.reset();for(const key of ['smile','stretch','posture','distance','yawn','blink','faceYoga','eyeClosure','headTurns','composition']){vision.gates[key]?.reset();sensor(key,false,()=>{});}return;}
 lastFace=lm;state.lastFaceSeenTs=now;
 if(vision.calibration){
  const cal=vision.calibration;cal.samples.push(m);
  document.getElementById('vision-calibration').textContent=`Калибровка: ${cal.samples.length}/20 стабильных кадров`;
  if(cal.samples.length>=20){const eyes=cal.samples.map(x=>x.eyeWidth),center=median(eyes);
   if(Math.max(...eyes)-Math.min(...eyes)>center*.18){cal.samples=[];toast('Во время калибровки двигайтесь меньше.');}
   else{postureBaseline={y:median(cal.samples.map(x=>x.noseY)),eyeWidth:center,tilt:median(cal.samples.map(x=>x.tilt))};postureBaseline.pitch=median(cal.samples.map(pitchProxy));vision.calibration=null;document.getElementById('vision-calibration').textContent='Калибровка сохранена для этой сессии.';}
  }
  if(vision.calibration&&now-cal.started>15000){vision.calibration=null;toast('Калибровка не завершена. Попробуйте при стабильном свете.');}
 }
 sensor('smile',Boolean(res.faceBlendshapes?.[0]),()=>{const cats=res.faceBlendshapes[0].categories;const score=((cats.find(c=>c.categoryName==='mouthSmileLeft')?.score||0)+(cats.find(c=>c.categoryName==='mouthSmileRight')?.score||0))/2;vision.smileActive=score>.55||(Boolean(vision.smileActive)&&score>.35);if(vision.gates.smile.update(vision.smileActive,now)){state.smiles++;vision.session.smiles++;sensorEvent('smile','Улыбка зафиксирована','😊',false);updateStatsUI();performSnapshot('smile');}});
 sensor('stretch',true,()=>{state.currTilt=m.tilt;document.getElementById('tilt-text').textContent=Math.round(m.tilt)+'°';document.getElementById('tilt-bar').style.transform=`rotate(${m.tilt}deg)`;
  if(vision.gates.stretch.update(Math.abs(m.tilt)>22&&Math.abs(m.tilt)<60,now)){state.stretches++;sensorEvent('stretch','Наклон головы зафиксирован','🧘',false);updateStatsUI();}});
 habitPosture(m);
 sensor('distance',Boolean(postureBaseline),()=>{state.currDist=m.eyeWidth;const raw=m.eyeWidth/postureBaseline.eyeWidth;vision.distanceRatio=vision.distanceRatio==null?raw:vision.distanceRatio*.7+raw*.3;const ratio=vision.distanceRatio;
  document.getElementById('dist-text').textContent=`${ratio.toFixed(2)}× калибровки`;document.getElementById('dist-bar').style.width=clamp(ratio*50,5,100)+'%';
  if(vision.gates.distance.update(ratio>1.4||ratio<.65,now))sensorEvent('distance',ratio>1.4?'Вы приблизились к камере.':'Вы отдалились от камеры.','📏');});
 sensor('yawn',true,()=>{document.getElementById('yawn-status').textContent=m.mouth>.14?'Рот открыт':'Рот закрыт';if(vision.gates.yawn.update(m.mouth>.14,now)){vision.session.mouth++;sensorEvent('yawn','Длительное открывание рта. Возможна зевота.','🥱',false);}});
 const eyes=(state.features.blink||state.features.eyeClosure)?vision.blink.update(m.eyeRatio,now):null;
 sensor('blink',Boolean(eyes),()=>{if(eyes.blink){state.blinks++;state.totalBlinksThisSession++;vision.session.blinks++;}document.getElementById('dbg-blink').textContent=`${eyes.rate} / 60 сек`;});
 sensor('eyeClosure',Boolean(eyes),()=>{if(eyes.long){vision.session.closures++;sensorEvent('eyeClosure','Глаза закрыты более двух секунд.','👁️',false);}});
 sensor('headTurns',true,()=>{if(vision.gates.headTurns.update(Math.abs(m.turn)>.25,now)){vision.session.turns++;sensorEvent('headTurns','Голова повернулась относительно камеры','↔️',false);}});
 sensor('composition',true,()=>{const off=Math.abs(m.centerX-.5)>.28||Math.abs(m.centerY-.5)>.30||m.width>.75;
  if(vision.gates.composition.update(off,now))sensorEvent('composition','Расположите лицо ближе к центру кадра.','📐');});
 sensor('faceYoga',Boolean(res.faceBlendshapes?.[0]),()=>{const cats=res.faceBlendshapes[0].categories;
  const score=name=>cats.find(c=>c.categoryName===name)?.score||0;
  const brow=(score('browInnerUp')+score('browOuterUpLeft')+score('browOuterUpRight'))/3;
  const pucker=score('mouthPucker');if(vision.gates.faceYoga.update(brow>.55||pucker>.6,now)){state.faceYoga++;sensorEvent('faceYoga',brow>.55?'Подъём бровей зафиксирован':'Движение губ зафиксировано','🙂',false);}
 });
}

function processHands(){
 const now=Date.now(),hands=vision.handResult?.landmarks||[],available=hands.length>0&&!vision.privacyActive,pair=pairGesture(hands);
 const mouth=lastFace&&vision.metrics?{x:(lastFace[13].x+lastFace[14].x)/2,y:(lastFace[13].y+lastFace[14].y)/2}:null;
 const drinks=now-vision.lastObjectAt<1500&&containerNearMouth(vision.objects,mouth,video.videoWidth,video.videoHeight);
 sensor('gestures',available,()=>{const names={'palm':'Ладонь','fist':'Кулак','victory':'V','thumbs-up':'Большой палец','pinch':'Щипок','other':'Другой жест','unknown':'—'};
  const gesture=classifyHand(hands[0]);document.getElementById('vision-gesture').textContent=names[gesture];
  if(vision.lastGesture!==gesture){vision.gates.gestures.reset();vision.lastGesture=gesture;}
  if(vision.gates.gestures.update(!['other','unknown'].includes(gesture)&&!pair,now)){vision.session.gestures++;sensorEvent('gestures',`Жест: ${names[gesture]}`,'✋',false);}});
 sensor('heart',available,()=>{if(vision.gates.heart.update(pair==='heart',now)){sensorEvent('heart','Сердце руками','❤️',false);performSnapshot('heart');}});
 sensor('zen',available,()=>{if(vision.gates.zen.update(pair==='prayer',now))toggleZenMode(!state.isZenMode);});
 sensor('faceTouch',available&&Boolean(mouth),()=>{const touch=hands.some(h=>distance(h[8],lastFace[1])<vision.metrics.width*.35);
  if(vision.gates.faceTouch.update(touch&&!drinks&&!pair,now)){vision.session.touches++;sensorEvent('faceTouch','Рука рядом с лицом','✋',false);}});
 if(!available){for(const k of ['gestures','heart','zen','water','faceTouch'])vision.gates[k].reset();document.getElementById('vision-gesture').textContent='—';}
}

function processObjects(){
 detectDrink();
 const now=Date.now();state.lastDetections=vision.objects;
 sensor('worldLens',true,()=>{document.getElementById('vision-objects').textContent=vision.objects.slice(0,8).map(d=>`${OBJECT_TRANSLATIONS[d.categories[0].categoryName]||d.categories[0].categoryName} ${Math.round(d.categories[0].score*100)}%`).join(' · ')||'Объектов не найдено';});
 sensor('phone',!vision.privacyActive,()=>{const phone=vision.objects.some(d=>d.categories[0]?.categoryName==='cell phone'&&d.categories[0].score>=.6);
  if(vision.gates.phone.update(phone,now)){vision.session.phone++;sensorEvent('phone','Телефон остаётся в кадре. Если он отвлекает, уберите его.','📵');}});
 document.getElementById('dbg-obj').textContent=vision.objects.some(d=>['bottle','cup'].includes(d.categories[0]?.categoryName))?'Ёмкость':'—';
}

function processPose(){
 const now=Date.now(),lm=vision.poseResult?.landmarks?.[0];vision.poseMetrics=poseMetrics(lm,video.videoWidth/video.videoHeight);const p=vision.poseMetrics;
 sensor('pose',Boolean(p),()=>p);
 sensor('sportMode',Boolean(p),()=>{state.isExercising=vision.exercise;});
 sensor('squatCounter',Boolean(p)&&vision.exercise&&!vision.privacyActive,()=>{if(vision.rep.update(p.knee,now)){state.squats++;vision.session.squats++;document.getElementById('squat-overlay-count').textContent=state.squats;sensorEvent('squatCounter','Полный цикл приседания','🏋️',false);updateStatsUI();}});
 sensor('armRaise',Boolean(p)&&vision.exercise&&!vision.privacyActive,()=>{if(p.arms===null){vision.armsUp=false;vision.gates.armRaise.reset();return;}if(p.arms){if(vision.gates.armRaise.update(true,now))vision.armsUp=true;}else if(vision.armsUp){vision.armsUp=false;vision.session.arms++;sensorEvent('armRaise','Подъём и опускание рук','🙌',false);}if(!p.arms)vision.gates.armRaise.reset();});
 if(!p||!vision.exercise||vision.privacyActive){vision.rep.reset();vision.armsUp=false;vision.gates.armRaise.reset();}
}

function drawVisionOverlay(){
 ctx.clearRect(0,0,canvas.width,canvas.height);if(vision.settings.overlay==='none'||vision.privacyActive)return;
 if(state.features.heatmap&&vision.motionResult){vision.motionResult.heat.forEach((value,i)=>{ctx.fillStyle=`rgba(14,165,233,${value*.4})`;ctx.fillRect(i%4*canvas.width/4,Math.floor(i/4)*canvas.height/3,canvas.width/4,canvas.height/3);});}
 const lm=vision.faceResult?.faceLandmarks?.[0];
 if(lm&&vision.metrics&&drawingUtils){
  const links=vision.settings.overlay==='mesh'?FaceLandmarker.FACE_LANDMARKS_TESSELATION:FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
  if(links)drawingUtils.drawConnectors(lm,links,{color:'#34d39980',lineWidth:vision.settings.overlay==='mesh'?.5:2});
 }
 if(drawingUtils&&Date.now()-(vision.due['valid-hand']||0)<1500&&state.features.gestures)for(const hand of vision.handResult?.landmarks||[])drawingUtils.drawConnectors(hand,HandLandmarker.HAND_CONNECTIONS,{color:'#38bdf8',lineWidth:2});
 if(drawingUtils&&Date.now()-(vision.due['valid-pose']||0)<1500&&state.features.pose&&vision.poseResult?.landmarks?.[0])drawingUtils.drawConnectors(vision.poseResult.landmarks[0],PoseLandmarker.POSE_CONNECTIONS,{color:'#fbbf24',lineWidth:2});
 if(state.features.worldLens&&Date.now()-vision.lastObjectAt<1500)for(const det of vision.objects){
  const cat=det.categories?.[0],b=det.boundingBox;if(!cat||!b)continue;
  if(vision.settings.objectFilter==='drinks'&&!['cup','bottle'].includes(cat.categoryName))continue;
  if(vision.settings.objectFilter==='phone'&&cat.categoryName!=='cell phone')continue;
  ctx.strokeStyle=cat.categoryName==='cell phone'?'#fb7185':'#34d399';ctx.lineWidth=2;ctx.strokeRect(b.originX,b.originY,b.width,b.height);
  ctx.save();ctx.translate(vision.settings.mirror?b.originX+b.width:b.originX,Math.max(16,b.originY));if(vision.settings.mirror)ctx.scale(-1,1);ctx.font='14px sans-serif';ctx.fillStyle='white';ctx.fillText(`${OBJECT_TRANSLATIONS[cat.categoryName]||cat.categoryName} ${Math.round(cat.score*100)}%`,0,-3);ctx.restore();
 }
}

function releaseModels(){
 if(state.cameraActive||aiLoading){toast('Сначала остановите камеру и дождитесь загрузки.');return;}
 for(const model of [faceLM,handLM,objectDet,poseLM])try{model?.close();}catch{}
 faceLM=handLM=objectDet=poseLM=null;drawingUtils=null;Object.keys(vision.models).forEach(k=>vision.models[k]='idle');toast('Память моделей освобождена.');renderVisionStatus();
}

function resetVisionSession(){
 vision.faceCount=0;vision.metrics=null;vision.faceResult=null;vision.handResult=null;vision.poseResult=null;vision.poseMetrics=null;vision.objects=[];
 vision.coordinator=new Coordinator();vision.notices.clear();vision.blink=new BlinkTracker();vision.rep.reset();vision.motion.reset();
 Object.values(vision.gates).forEach(g=>g.reset());vision.session=Object.fromEntries(Object.keys(vision.session).map(k=>[k,0]));vision.sessionEvents=[];
 vision.due={};vision.frameTimes=[];vision.startedAt=Date.now();vision.lastFrameAt=Date.now();vision.lastPresence=null;vision.awaySince=null;
 vision.distanceRatio=null;vision.smileActive=false;vision.eyeFocus=0;vision.moveFocus=0;vision.exercise=false;vision.armsUp=false;vision.calibration=null;vision.privacyActive=false;vision.breakDue=Date.now()+vision.settings.breakMinutes*60000;
}

async function refreshCameras(){
 const select=document.getElementById('vision-camera');if(!navigator.mediaDevices?.enumerateDevices){select.disabled=true;return;}
 try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');select.replaceChildren(new Option('Камера по умолчанию',''));
  devices.forEach((d,i)=>select.add(new Option(d.label||`Камера ${i+1}`,d.deviceId)));if(devices.some(d=>d.deviceId===vision.settings.cameraId))select.value=vision.settings.cameraId;else vision.settings.cameraId='';
 }catch{toast('Список камер недоступен до выдачи разрешения.');}
}

function startRecording(){
 if(!state.cameraActive||vision.privacyActive||vision.recorder)return;
 if(typeof MediaRecorder==='undefined'){toast('Запись видео не поддерживается в этом браузере.');return;}
 try{const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  const recorder=new MediaRecorder(video.srcObject,type?{mimeType:type}:{});vision.recorder=recorder;vision.recordChunks=[];vision.recordBytes=0;vision.recordStarted=Date.now();
  recorder.ondataavailable=e=>{if(e.data.size){vision.recordChunks.push(e.data);vision.recordBytes+=e.data.size;if(vision.recordBytes>30*1024*1024)stopRecording();}};
  recorder.onstop=()=>{const blob=new Blob(vision.recordChunks,{type:recorder.mimeType});if(vision.recordURL)URL.revokeObjectURL(vision.recordURL);vision.recordURL=URL.createObjectURL(blob);
   const link=document.getElementById('vision-record-download');link.href=vision.recordURL;link.download=`ZenFlow-${VERSION}-${Date.now()}.${recorder.mimeType.includes('mp4')?'mp4':'webm'}`;link.hidden=false;vision.recorder=null;vision.recordChunks=[];renderVisionStatus();};
  recorder.onerror=()=>{toast('Ошибка записи видео.');stopRecording();};recorder.start(1000);vision.recordTimer=setTimeout(stopRecording,60000);renderVisionStatus();
 }catch(e){vision.recorder=null;toast('Запись недоступна: '+e.message);}
}

function stopRecording(){clearTimeout(vision.recordTimer);if(vision.recorder?.state==='recording')vision.recorder.stop();}

function dispatchNotice(){
 const now=Date.now();vision.notices.items=vision.notices.items.filter(i=>now-i.now<(i.key.startsWith('water:')?60000:15000));
 renderSpeech();
 if(document.hidden||vision.breathing||state.eyeBreakActive||vision.privacyActive||speech.current||now-vision.notices.lastDelivery<4000)return;
 const item=vision.notices.items.find(i=>i.key.startsWith('water:')?(habits.settings.drinkVoice):vision.settings.notifications&&!(vision.settings.quietFocus&&pomoState.running&&!pomoState.isBreak));
 if(!item)return;
 if(!item.shown){toast(item.text);item.shown=true;}
 // Keep the event pending until speech actually starts. A failed engine requires a user retry.
 if(!state.audioUnlocked||!speech.enabled||speech.status==='error')return;
 speech.say(item.text,{rate:habits.settings.voiceRate,volume:habits.settings.voiceVolume,onStart:()=>{vision.notices.items=vision.notices.items.filter(i=>i!==item);vision.notices.lastDelivery=Date.now();}});
}

function runFeatureChecks(key=null){
 const tests=runSelfTests();
 const add=(name,features,fn)=>{try{tests.push({name,features,passed:fn()===true});}catch(e){tests.push({name,features,passed:false,error:e.message});}};
 add('Календарная дата локальная',['nightMode','water'],()=>/^\d{4}-\d{2}-\d{2}$/.test(localDay()));
 add('Настройки Pomodoro в допустимых границах',['eyeRule','movementBreak'],()=>POMO.workDuration>=60&&POMO.breakDuration>=60&&POMO.longBreakDuration>=60);
 add('Гидратация соответствует ручным записям',['water'],()=>state.water===state.hydrationLog.length&&waterTotal()>=0);
 add('Сериализация дневника проходит схему',['water','nightMode'],()=>{const data={schema:7,days:{[activeDay]:captureDay()},preferences:{...preferences,features:state.features}};return Boolean(validateBackup(JSON.parse(JSON.stringify(data))));});
 add('Каждая функция имеет переключатель',Object.keys(FEATURES),()=>Object.keys(FEATURES).every(k=>typeof state.features[k]==='boolean'));
 add('Все элементы управления присутствуют',Object.keys(FEATURES),()=>['startBtn','stop-camera','pomo-start','water-form','vision-sensors','vision-record','vision-version'].every(id=>Boolean(document.getElementById(id))));
 vision.selfTests=tests;renderVisionStatus();
 const selected=key?tests.filter(t=>t.features.includes(key)):tests;
 document.getElementById('vision-test-details').textContent=selected.map(t=>`${t.passed?'✓':'✗'} ${t.name}${t.error?' — '+t.error:''}`).join('\n');
 return selected;
}

function initVisionUI(){
 vision.uiReady=true;
 for(const id of ['mirror','notifications','quiet-focus','auto-continue']){const key={'quiet-focus':'quietFocus','auto-continue':'autoContinue'}[id]||id;document.getElementById('vision-'+id).checked=vision.settings[key];}
 for(const key of ['quality','overlay','roi','objectFilter'])document.getElementById('vision-'+key).value=vision.settings[key];
 document.getElementById('vision-break-minutes').value=vision.settings.breakMinutes;
 document.getElementById('vision-config').onchange=()=>{
  const oldCamera=vision.settings.cameraId,oldQuality=vision.settings.quality;
  vision.settings.cameraId=document.getElementById('vision-camera').value;
  for(const id of ['mirror','notifications','quiet-focus','auto-continue']){const key={'quiet-focus':'quietFocus','auto-continue':'autoContinue'}[id]||id;vision.settings[key]=document.getElementById('vision-'+id).checked;}
  for(const key of ['quality','overlay','roi','objectFilter'])vision.settings[key]=document.getElementById('vision-'+key).value;
  vision.settings.breakMinutes=clamp(Number(document.getElementById('vision-break-minutes').value)||45,5,120);
  vision.breakDue=Date.now()+vision.settings.breakMinutes*60000;applyVisionMirror();vision.motion.reset();
  try{localStorage.setItem('zenflow_vision_preferences',JSON.stringify(vision.settings));}catch{toast('Настройки камеры не удалось сохранить.');}
  if((oldCamera!==vision.settings.cameraId||oldQuality!==vision.settings.quality)&&state.cameraActive){stopCamera();toast('Настройки камеры изменены. Нажмите «Камера» для нового запуска.');}
 };
 document.getElementById('vision-refresh-cameras').onclick=refreshCameras;
 document.getElementById('vision-test-all').onclick=()=>runFeatureChecks();
 document.getElementById('vision-sensors').onclick=e=>{const key=e.target.dataset.sensorTest;if(key)runFeatureChecks(key);};
 document.getElementById('vision-sensors').onchange=e=>{const key=e.target.dataset.visionFeature;if(!key)return;state.features[key]=e.target.checked;vision.gates[key]?.reset();syncFeatureEffects();saveData();renderVisionStatus();if(state.cameraActive)initAI();};
 document.getElementById('vision-feature-filter').onchange=renderVisionStatus;document.getElementById('vision-event-filter').onchange=renderVisionStatus;
 document.getElementById('vision-record').onclick=startRecording;document.getElementById('vision-record-stop').onclick=stopRecording;
 document.getElementById('vision-release').onclick=releaseModels;
 document.getElementById('vision-exercise').onclick=()=>{vision.exercise=!vision.exercise;vision.rep.reset();vision.armsUp=false;state.isExercising=vision.exercise;state.exerciseStartTime=Date.now();vision.breakDue=Date.now()+vision.settings.breakMinutes*60000;if(vision.exercise){state.features.sportMode=true;state.features.pose=true;state.features.squatCounter=true;if(state.cameraActive)initAI();}document.getElementById('sport-overlay').classList.toggle('active',vision.exercise);renderVisionStatus();};
 document.getElementById('calibrate-camera').onclick=()=>{if(!vision.metrics){toast('Расположите одно лицо в кадре.');return;}vision.calibration={started:Date.now(),samples:[]};document.getElementById('vision-calibration').textContent='Сидите удобно и неподвижно примерно 2–4 секунды.';};
 document.getElementById('vision-export').onclick=()=>{const data={version:VERSION,date:new Date().toISOString(),session:vision.session,events:vision.sessionEvents,tests:vision.selfTests,modules:Object.fromEntries(vision.coordinator.modules),camera:{width:video.videoWidth,height:video.videoHeight,fps:vision.fps},note:'Без кадров, координат лица и идентификаторов камеры'};downloadFile(`ZenFlow-${VERSION}-diagnostics.json`,JSON.stringify(data,null,2),'application/json');};
 document.getElementById('vision-snooze').onclick=()=>{vision.breakDue=Date.now()+10*60000;vision.eyeSnoozeUntil=Date.now()+10*60000;vision.notices.clear();closeEyeBreak();toast('Напоминания о перерыве отложены на 10 минут.');};
 document.getElementById('vision-clear-gallery').onclick=()=>{document.getElementById('snapshot-gallery').textContent='Снимки удалены.';if(vision.recordURL)URL.revokeObjectURL(vision.recordURL);vision.recordURL=null;document.getElementById('vision-record-download').hidden=true;};
 document.getElementById('vision-clear-log').onclick=()=>{vision.sessionEvents=[];renderVisionStatus();};
 document.getElementById('vision-caffeine-undo').onclick=()=>{ensureCurrentDay();const value=state.caffeineLog.pop();if(value){state.caffeineTotal=state.caffeineLog.reduce((s,x)=>s+x.mg,0);updateCaffeineUI();saveData();toast('Последняя запись кофеина отменена.');}};
 document.getElementById('vision-mood-undo').onclick=()=>{ensureCurrentDay();state.moodLog.pop();renderMood();saveData();toast('Последняя отметка настроения отменена.');};
 document.getElementById('vision-volume-reset').onclick=()=>{document.getElementById('ambient-volume').value=30;document.getElementById('ambient-volume').dispatchEvent(new Event('input'));};
 document.getElementById('copyLogBtn').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('diag-log').innerText);toast('Диагностика скопирована.');}catch{downloadFile('ZenFlow-log.txt',document.getElementById('diag-log').innerText,'text/plain');}};
 applyVisionMirror();refreshCameras();renderVisionStatus();
 document.addEventListener('visibilitychange',()=>{if(document.hidden){vision.notices.clear();vision.blink.reset();vision.rep.reset();vision.calibration=null;stopRecording();}});
 navigator.mediaDevices?.addEventListener?.('devicechange',refreshCameras);
 setInterval(()=>{dispatchNotice();if(due('status',Date.now(),1000))renderVisionStatus();sensor('nightMode',true,applyTheme);
  sensor('movementBreak',state.cameraActive&&!document.hidden,()=>{if((vision.moveFocus||0)>=vision.settings.breakMinutes*60000&&Date.now()>vision.breakDue&&!vision.exercise&&!vision.breathing){vision.notices.push('movementBreak','Пора сделать короткий перерыв для движения.',Date.now(),2,60000);vision.moveFocus=0;vision.breakDue=Date.now();}});
  sensor('autoPause',true,()=>state.isTimerPaused);
 },1000);
}

function applyVisionMirror(){const transform=vision.settings.mirror?'scaleX(-1)':'none';video.style.transform=transform;canvas.style.transform=transform;}

        // Restore only known schema fields; imported strings never become executable markup.
        try {
            const raw=localStorage.getItem(DATA_KEY);
            lastStoredValue=raw;
            if(raw) dailyStore=validateBackup(JSON.parse(raw));
        } catch {
            storageWritable=false;
            document.getElementById('save-status').innerText='Хранилище недоступно или данные повреждены. Исходные данные не перезаписаны.';
        }
        preferences={...defaultPreferences,...dailyStore.preferences};
        if(preferences.features) Object.assign(state.features,preferences.features);
        state.eyeBreakInterval=preferences.eyeBreakInterval||20;
        if(dailyStore.report) {reportDay=dailyStore.report.day;state.autoReport.lastSent=dailyStore.report.lastSent;}
        applyDay(dailyStore.days[activeDay]||emptyDay());
        if(dailyStore.timer) Object.assign(pomoState,dailyStore.timer);
        else pomoState.timeLeft=Math.round(preferences.workMinutes*60);
        ready=true; applyPreferences(); loadStreak(); renderMood(); updateCaffeineUI(); updateStatsUI(); renderHistory(); renderFocusTime();
        if(pomoState.running) {tickPomodoro();if(pomoState.running) pomoState.interval=setInterval(tickPomodoro,250);}
        setPomoButtons(); updatePomodoroDisplay(); saveData();

        document.querySelectorAll('[data-water]').forEach(btn=>btn.onclick=()=>addWater(Number(btn.dataset.water)));
        document.getElementById('water-form').onsubmit=event=>{event.preventDefault();addWater(Number(document.getElementById('water-custom').value));};
        document.getElementById('undo-water').onclick=()=>{ensureCurrentDay();const last=state.hydrationLog.pop();if(!last)return;state.water=state.hydrationLog.length;state.treeLevel=Math.min(TREES.length,1+Math.floor(state.water/3));addHistoryEvent('↩️',`Отменена вода: ${last.ml} мл`);updateStatsUI();saveData();toast('Последняя запись воды отменена.');};
        document.getElementById('dismiss-water').onclick=()=>document.getElementById('water-confirm').hidden=true;
        document.getElementById('export-json').onclick=()=>{ensureCurrentDay();saveData();const {report,...backup}=dailyStore;downloadFile('ZenFlow-backup.json',JSON.stringify(backup,null,2),'application/json');};
        document.getElementById('export-csv').onclick=exportCSV;
        document.getElementById('import-json').onchange=async event=>{
            const file=event.target.files[0];if(!file)return;
            try {
                if(file.size>8*1024*1024)throw new Error('Максимальный размер — 8 МБ');
                const clean=validateBackup(JSON.parse(await file.text()));
                if(!confirm('Заменить записи и настройки данными из этого файла? Сначала можно отменить и скачать текущую резервную копию.'))return;
                stopCamera(); pausePomodoro();
                if(clean.timer) {clean.timer.running=false;clean.timer.deadline=null;}
                localStorage.setItem(DATA_KEY,JSON.stringify(clean));
                location.reload();
            } catch(error) {toast('Импорт не выполнен: '+error.message);}
            finally {event.target.value='';}
        };
        document.getElementById('preferences-form').onsubmit=event=>{
            event.preventDefault();
            const next={waterGoal:Number(document.getElementById('cfg-water-goal').value),workMinutes:Number(document.getElementById('cfg-work').value),breakMinutes:Number(document.getElementById('cfg-break').value),longBreakMinutes:Number(document.getElementById('cfg-long-break').value),theme:document.getElementById('cfg-theme').value,autoSnapshots:document.getElementById('cfg-snapshots').checked};
            const changed=['workMinutes','breakMinutes','longBreakMinutes'].some(key=>next[key]!==preferences[key]);
            preferences={...preferences,...next};applyPreferences();if(changed)resetPomodoro();renderDailyPanel();saveData();toast('Настройки сохранены.');
        };
        document.getElementById('stop-camera').onclick=stopCamera;
        document.getElementById('calibrate-camera').onclick=()=>{
            if(!lastFace || Date.now()-state.lastFaceSeenTs>1500){toast('Сначала расположите лицо в кадре.');return;}
            postureBaseline={y:lastFace[1].y};state.baselineNoseY=lastFace[1].y;
            document.getElementById('posture-text').innerText='Калибровка сохранена';toast('Положение запомнено до отключения камеры.');
        };
        document.getElementById('take-snapshot').onclick=()=>{if(!performSnapshot('manual'))toast('Кадр пока недоступен.');};
        document.getElementById('retry-ai').onclick=async()=>{
            const generation=cameraGeneration;document.getElementById('retry-ai').disabled=true;
            const loaded=await initAI();if(generation!==cameraGeneration)return;
            document.getElementById('retry-ai').disabled=false;
            setCameraStatus(loaded?`Доступно: ${[faceLM&&'лицо',handLM&&'руки',objectDet&&'объекты'].filter(Boolean).join(', ')}.`:'Модели недоступны. Дневник и таймер продолжают работать.');
        };
        document.getElementById('chart-lib').addEventListener('load',renderActivityChart);
        document.addEventListener('visibilitychange',()=>{
            focusTick=Date.now();
            if(document.hidden){state.lastFaceSeenTs=0;eyesClosed=false;stopBreathingGuide();closeEyeBreak();saveData();}
            else {ensureCurrentDay();tickPomodoro();applyTheme();}
        });
        window.addEventListener('pagehide',()=>{stopCamera();saveData();Object.values(ambientNodes).forEach(node=>node.stop());});
        setInterval(()=>{ensureCurrentDay();saveData();renderWeek();},10000);
        setInterval(applyTheme,60000);


    
window.speakZen=(text,priority=false)=>{if(vision.breathing)return;vision.notices.push("voice:"+String(text).slice(0,40),String(text),Date.now(),priority?2:1,15000);};
initVisionUI();initHabits();initSpeech();initRecordedAudio();

function needsModel(name){return Object.entries(FEATURES).some(([k,v])=>v[1]===name&&state.features[k])||(name==='object'&&state.features.water)||(name==='face'&&(state.features.water||state.features.faceTouch));}

function createNoise(kind){
 const seconds=6,buffer=audioCtx.createBuffer(1,audioCtx.sampleRate*seconds,audioCtx.sampleRate),out=buffer.getChannelData(0);
 for(let i=0;i<out.length;i++){const t=i/audioCtx.sampleRate,n=Math.random()*2-1;out[i]=kind==='ocean'?n*(.25+.2*Math.sin(t*Math.PI/3)):kind==='forest'?n*.06+(Math.sin(t*23)>.985?Math.sin(t*6200)*.2:0):kind==='fire'?n*.15+(Math.random()>.999?n*.6:0):n*.25;}
 const source=audioCtx.createBufferSource();source.buffer=buffer;source.loop=true;
 const filter=audioCtx.createBiquadFilter();filter.type=kind==='forest'?'highpass':kind==='white'?'allpass':kind==='ocean'?'lowpass':'bandpass';filter.frequency.value=kind==='forest'?950:kind==='ocean'?450:850;filter.Q.value=.5;
 const gain=audioCtx.createGain();gain.gain.value=ambientVolume;source.connect(filter);filter.connect(gain);gain.connect(audioCtx.destination);source.start();let stopped=false;
 return{source,gain,stop(){if(stopped)return;stopped=true;source.stop();source.disconnect();filter.disconnect();gain.disconnect();}};
}

function createHabits(){let raw={},log=[];try{raw=JSON.parse(localStorage.getItem('zenflow_habits_settings')||'{}');}catch{}try{log=JSON.parse(localStorage.getItem('zenflow_drink_events')||'[]');}catch{}return{settings:habitSettings(raw),log:cleanDrinkLog(log,Date.now()),tracker:new DrinkTracker(),lastWaterReminder:Date.now(),notified:{},voiceName:'',posture:null};}
function saveHabits(){try{localStorage.setItem('zenflow_habits_settings',JSON.stringify(habits.settings));localStorage.setItem('zenflow_drink_events',JSON.stringify(habits.log));}catch{toast('Не удалось сохранить настройки или события напитков. Экспортируйте статистику.');}}
function renderHabits(){const today=habits.log.filter(e=>localDay(e.time)===localDay());document.getElementById('habit-drinks').textContent=`Стакан/кружка: ${today.filter(e=>e.type==='cup').length} · бутылка: ${today.filter(e=>e.type==='bottle').length} · всего: ${today.length}`;document.getElementById('habit-confirmed').textContent=`Подтверждено вручную: ${waterTotal()} мл`;renderSpeech();document.getElementById('habit-drink-history').textContent=habits.log.slice(-12).reverse().map(e=>`${new Date(e.time).toLocaleString('ru-RU')} — ${e.type==='cup'?'Стакан/кружка':'Бутылка'} у рта`).join('\n')||'Поднесений пока нет.';}
function detectDrink(){const now=Date.now(),available=state.cameraActive&&vision.faceCount===1&&Boolean(lastFace&&vision.metrics)&&now-state.lastFaceSeenTs<1500&&!vision.privacyActive;const mouth=available?{x:(lastFace[13].x+lastFace[14].x)/2,y:(lastFace[13].y+lastFace[14].y)/2}:null;
 if(!state.features.water||!available){habits.tracker.reset();sensor('water',false,()=>{});return;}
 sensor('water',true,()=>{const type=drinkAtMouth(vision.objects,mouth,video.videoWidth,video.videoHeight,habits.settings.drinkConfidence);document.getElementById('dbg-status').textContent=type?(type==='cup'?'Стакан/кружка у рта':'Бутылка у рта'):'Наблюдение';const event=habits.tracker.update(type,now,habits.settings);if(!event)return;habits.log=cleanDrinkLog([...habits.log,{type:event,time:now}],now);habits.lastWaterReminder=now;saveHabits();renderHabits();document.getElementById('water-confirm').hidden=false;const count=habits.log.filter(e=>localDay(e.time)===localDay(now)).length;const text=`${event==='cup'?'Стакан или кружка':'Бутылка'} у рта. За сегодня поднесений: ${count}.`;sensorEvent('water',text,'💧',false);if(habits.settings.drinkVoice)vision.notices.push('water:'+now,text,now,2,0);});}
function habitPosture(m){const p=postureDelta(m,postureBaseline,habits.settings);habits.posture=p;sensor('posture',Boolean(p),()=>{const bad=p.bad&&!vision.exercise&&!vision.breathing;state.currPosture=bad?'bad':'ok';document.getElementById('posture-text').textContent=`Вбок ${p.roll.toFixed(1)}° · вперёд/назад ≈${p.pitch.toFixed(1)}°`;document.getElementById('posture-bar').style.width=`${clamp(100-Math.max(p.roll,p.pitch)*2,5,100)}%`;vision.gates.posture.hold=habits.settings.hold*1000;vision.gates.posture.cooldown=habits.settings.postureCooldown*1000;if(vision.gates.posture.update(bad,Date.now())){state.postureCorrections++;sensorEvent('posture','Положение головы вышло за настроенные углы. Проверьте, удобно ли вы сидите.','↕️');updateStatsUI();}});}
function habitRoutineTick(){renderHabits();if(document.hidden||vision.breathing||state.eyeBreakActive||vision.privacyActive)return;const now=Date.now(),s=habits.settings;if(s.waterReminder&&now-habits.lastWaterReminder>=s.waterMinutes*60000){habits.lastWaterReminder=now;vision.notices.push('water-reminder','Перерыв: проверьте, хочется ли вам пить.',now);}
 const clock=new Date(now).toTimeString().slice(0,5),day=localDay();for(const [key,enabled,time,text]of [['wind',s.windDown,s.windTime,'Время вашего вечернего ритуала. Можно приглушить свет и завершить дела.'],['caffeine',s.caffeineReminder,s.caffeineTime,'Наступило выбранное вами время ограничения кофеина.']]){if(enabled&&clock>=time&&habits.notified[key]!==day){habits.notified[key]=day;vision.notices.push(key,text,now);}}
}
function initHabits(){for(const key of Object.keys(HABIT_DEFAULTS)){const el=document.getElementById('habit-'+key);if(!el)continue;if(typeof HABIT_DEFAULTS[key]==='boolean')el.checked=habits.settings[key];else el.value=habits.settings[key];}
 document.getElementById('habit-settings').onchange=()=>{const raw={};for(const key of Object.keys(HABIT_DEFAULTS)){const el=document.getElementById('habit-'+key);raw[key]=typeof HABIT_DEFAULTS[key]==='boolean'?el.checked:typeof HABIT_DEFAULTS[key]==='number'?Number(el.value):el.value;}habits.settings=habitSettings(raw);vision.gates.posture.reset();habits.tracker.reset();habits.lastWaterReminder=Date.now();saveHabits();};
 document.getElementById('habit-export').onclick=()=>downloadFile(`ZenFlow-${VERSION}-drinks.csv`,'\uFEFFДата;Тип;Событие\r\n'+habits.log.map(e=>`${new Date(e.time).toISOString()};${e.type};Поднесение к рту`).join('\r\n'),'text/csv');
 document.getElementById('habit-undo').onclick=()=>{habits.log.pop();saveHabits();renderHabits();toast('Последнее поднесение отменено.');};
 document.getElementById('habit-calibrate').onclick=()=>document.getElementById('calibrate-camera').click();
 document.getElementById('habit-slow-breath').onclick=()=>{stopBreathingGuide();breathPhases.splice(0,breathPhases.length,{name:'Вдох',cls:'inhale',dur:4},{name:'Выдох',cls:'exhale',dur:6});document.getElementById('breathing-modal').classList.add('active');document.getElementById('breath-cycles-select').value='12';startBreathingGuide();breathCyclesTarget=12;document.getElementById('breath-cycle-total').textContent='12';};
 renderHabits();setInterval(habitRoutineTick,1000);
}

function createSpeech(){return new RecordedSpeechDriver({media:document.getElementById('speech-player'),audioBase:'./releases/8.1.3/audio/',synth:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,setTimer:setTimeout,clearTimer:clearTimeout,onState:()=>renderSpeech()});}
function renderSpeech(){const el=document.getElementById('habit-voice-status');if(!el||!speech)return;let status=speech.message;
 if(state.audioUnlocked&&speech.status==='ready'){if(document.hidden)status='Озвучка приостановлена: вкладка скрыта';else if(vision.breathing)status='Озвучка датчиков ждёт окончания дыхания';else if(state.eyeBreakActive)status='Озвучка датчиков ждёт отдыха глаз';else if(vision.privacyActive)status='Озвучка приостановлена: несколько лиц';else if(!habits.settings.drinkVoice)status='Озвучка напитков выключена в настройках';}
 el.textContent=status;el.setAttribute('role','status');document.getElementById('speech-last').textContent=speech.lastText?`Последняя фраза: ${speech.lastText}`:'Фраз пока не было.';document.getElementById('audioStatusText').innerText=!state.audioUnlocked?'ВКЛ ГОЛОС':speech.status==='error'?'ОШИБКА ГОЛОСА':speech.status==='speaking'?'ГОВОРИТ':'ГОЛОС';document.getElementById('diag-audio').innerText=speech.status;
}
function enableSpeech(text='Проверка голоса. Стакан или бутылка у рта.'){
 speech.userMuted=false;state.audioUnlocked=true;habits.settings.drinkVoice=true;document.getElementById('habit-drinkVoice').checked=true;
 if(habits.settings.voiceVolume<=0){habits.settings.voiceVolume=.8;document.getElementById('habit-voiceVolume').value=.8;}
 saveHabits();audioBtn.classList.add('unlocked');document.getElementById('audioStatusIcon').innerText='🔊';
 speech.enable(text,{rate:habits.settings.voiceRate,volume:habits.settings.voiceVolume});renderSpeech();
}
function disableSpeech(){speech.userMuted=true;speech.disable();state.audioUnlocked=false;audioBtn.classList.remove('unlocked');document.getElementById('audioStatusIcon').innerText='🔇';renderSpeech();}
function initSpeech(){const fill=()=>{const select=document.getElementById('speech-voice');select.replaceChildren(new Option('Автоматически: русский голос',''));for(const v of speech.voices()){const option=new Option(`${v.name} (${v.lang})`,v.voiceURI);select.add(option);}select.value=speech.voiceURI;};fill();window.speechSynthesis?.addEventListener?.('voiceschanged',fill);
 document.getElementById('speech-voice').onchange=e=>{speech.voiceURI=e.target.value;};
 document.getElementById('speech-recover').onclick=()=>enableSpeech();document.getElementById('speech-replay').onclick=()=>enableSpeech(speech.lastText||'Проверка голоса.');
 document.getElementById('habit-enable-voice').onclick=()=>enableSpeech('Голос включён. Я сообщу, когда стакан или бутылка окажется у рта.');
 document.getElementById('startBtn').onclick=()=>{if(!state.audioUnlocked&&!speech.userMuted)enableSpeech('Проверка голоса. Запускаем камеру.');return startCamera();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){speech.stop();if(state.audioUnlocked)speech.update('ready','Речь приостановлена: вкладка скрыта');}});renderSpeech();
}

function initRecordedAudio(){
 const media=document.getElementById('speech-player'),mode=document.getElementById('speech-mode');
 mode.onchange=()=>{speech.stop();speech.mode=mode.value;speech.update('ready',mode.value==='recorded'?'Выбраны готовые аудиозаписи':'Выбран речевой движок браузера');renderSpeech();};
 document.getElementById('speech-recording-test').onclick=()=>{speech.mode='recorded';mode.value='recorded';enableSpeech();};
 document.getElementById('speech-native-test').onclick=()=>{speech.mode='browser';mode.value='browser';enableSpeech();};
 // Native player controls work even without Web Speech. Keep the same media element for subsequent clips.
 media.addEventListener('playing',()=>{if(!speech.current){speech.current={manual:true,text:'Проверочная запись'};speech.route='recorded';speech.enabled=true;state.audioUnlocked=true;speech.userMuted=false;speech.update('ready','Запись запущена кнопкой плеера. Озвучка напитков включена.');}renderSpeech();});
 media.addEventListener('ended',()=>{if(speech.current?.manual){speech.current=null;speech.update('ready','Запись завершена');}});
 document.getElementById('speech-audible').onclick=()=>{document.getElementById('speech-confirmation').textContent='Вы подтвердили, что слышите запись. Включите камеру и поднесите стакан.';};
}
