// M1-3：摄像头 → 手部关键点 → 视线跟随 + 歪头 + 离散手势接管表情
import { renderCharacter, PRESETS, setFace, getFace, mouthOpenScale } from './character.js';
import {
  analyzeHand, makeDebouncer, isFingerHeart, palmWidth, GESTURE_NAME,
} from './gestures.js';

/* ---------- 状态 ---------- */
const state = {
  target: { gx: 0, gy: 0, tilt: 0 },
  cur:    { gx: 0, gy: 0, tilt: 0 },
  hand: false,
  lastHandAt: 0,
  fps: 0,
  gesture: 'none',       // 去抖后的当前手势
  hands: 0,               // 当前画面里的手数
  openness: 0,            // 伸直的手指数 0~1（离散台阶，用来切换表情）
  spread: 0,              // 手指展开的连续程度 0~1（用来越平滑地张嘴）
};

const el = (id) => document.getElementById(id);
const bearEl = el('bear');
let poseEl = null, gazeEl = null, mouthEl = null;

/* ---------- 粒子层 ----------
   害羞：两三颗小爱心从左脸红晕往上飘；
   生气：头顶右上闪一个"井"字怒气符号，按住不放就每隔 1.6 秒再闪一次；
   惊讶：一圈短线从脸外围往外炸开。
   全部叠在与熊同坐标的 SVG 上，并跟随 pose 的旋转一起动，不会脱开脸。 */
const fxg = el('fxg');
const SVG_NS = 'http://www.w3.org/2000/svg';
const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let nextShyFx = 0, nextAngerFx = 0, heartSide = 1;

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function mountFx(node, ms) {
  fxg.appendChild(node);
  while (fxg.childElementCount > 10) fxg.firstElementChild.remove();   // 兜底，不让节点堆积
  setTimeout(() => node.remove(), ms);
}

/* 换表情时让旧粒子立刻退场。
   粒子自己会活 2~3 秒，不撤的话会出现"头上还挂着井号、脸上已经开始冒爱心"——
   两种表情的情绪同时在画面上，边界就糊了。这里不硬切，220ms 淡出，
   观感上是"收尾"而不是"消失"。 */
function clearFx(fadeMs = 220) {
  for (const n of Array.from(fxg.children)) {
    if (n.dataset.dying) continue;
    n.dataset.dying = '1';
    const from = parseFloat(getComputedStyle(n).opacity) || 0;
    if (n.animate) {
      const anim = n.animate([{ opacity: from }, { opacity: 0 }], { duration: fadeMs, fill: 'forwards' });
      anim.onfinish = () => n.remove();
      setTimeout(() => n.remove(), fadeMs + 150);   // 兜底：onfinish 没触发也不会留下节点
    } else {
      n.remove();
    }
  }
}

const HEART_PATH = 'M0 6 C0 2.2 3.4 0 6.6 0 C9.2 0 11.4 1.7 13 4.2 '
  + 'C14.6 1.7 16.8 0 19.4 0 C22.6 0 26 2.2 26 6 C26 10.6 19.6 15.4 13 19.6 C6.4 15.4 0 10.6 0 6 Z';

function spawnHeart(side) {
  const g = svgEl('g', { class: 'fx-heart fx-heart-' + side });
  // 起点落在腮红外侧的棕色头罩上：白色脸盘里没有空地，压在腮红上会糊成一团。
  // 描一圈浅色边，玫瑰色压在深棕上也立得住。
  const a = getFace().fx[side === 'l' ? 'heartL' : 'heartR'];
  const inner = svgEl('g', { transform: `translate(${a.x} ${a.y}) scale(${a.scale})` });
  inner.appendChild(svgEl('path', {
    d: HEART_PATH, fill: '#E08C84', stroke: '#FBF5EA', 'stroke-width': 2.4,
    'stroke-linejoin': 'round',
  }));
  g.appendChild(inner);
  mountFx(g, 2900);
}

function spawnAnger() {
  const g = svgEl('g', { class: 'fx-anger' });
  const a = getFace().fx.anger;
  const inner = svgEl('g', { transform: `translate(${a.x} ${a.y}) rotate(-8) scale(${a.scale})` });
  inner.appendChild(svgEl('path', {
    d: 'M-32 -11 L32 -11 M-32 13 L32 13 M-13 -33 L-13 35 M9 -33 L9 35',
    fill: 'none', stroke: '#C0503A', 'stroke-width': 8, 'stroke-linecap': 'round',
  }));
  g.appendChild(inner);
  mountFx(g, 2300);
}

/* 惊讶的炸开：这只熊几乎占满画布，脸外面没有空间画放射线，
   放射线压上去会盖住眼睛。改用四角的漫画式速度线——四个角是画面里
   唯一空着的区域，两根短线朝中心方向指，配缩放淡出就是"炸一下"。 */
function spawnSpark() {
  const g = svgEl('g', { class: 'fx-spark' });
  const inner = svgEl('g');
  const { w: W, h: H } = getFace().canvas;
  const c = getFace().fx.sparkCenter;
  const cx = c.x, cy = c.y;
  const mx = W * 0.057, my = H * 0.056;
  const u = Math.min(W, H) / 946;                 // 线宽与线长都随画布缩放
  for (const [x, y] of [[mx, my], [W - mx, my], [mx, H - my], [W - mx, H - my]]) {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    for (const [r1, r2] of [[len - 6 * u, len - 74 * u], [len - 96 * u, len - 138 * u]]) {
      inner.appendChild(svgEl('path', {
        d: `M${(cx + ux * r1).toFixed(0)} ${(cy + uy * r1).toFixed(0)} `
          + `L${(cx + ux * r2).toFixed(0)} ${(cy + uy * r2).toFixed(0)}`,
        fill: 'none', stroke: '#2A2622', 'stroke-width': 10 * u, 'stroke-linecap': 'round',
      }));
    }
  }
  g.appendChild(inner);
  mountFx(g, 1300);
}

function updateFx(now) {
  if (REDUCED) return;
  if (currentFace === 'shy' && now > nextShyFx) {
    spawnHeart(heartSide > 0 ? 'l' : 'r');
    heartSide = -heartSide;
    nextShyFx = now + 1000;
  }
  if (currentFace === 'anger' && now > nextAngerFx) {
    spawnAnger();
    nextAngerFx = now + 2200;
  }
}

/* ---------- 表情档案导航 ---------- */
const FACES = [
  ['neutral', '中性 · 待机', 'NEUTRAL'],
  ['curious', '好奇', 'CURIOUS'],
  ['joy', '大笑', 'JOY'],
  ['shy', '害羞', 'SHY'],
  ['wink', '得意 wink', 'WINK'],
  ['surprise', '惊讶', 'SURPRISE'],
  ['puzzle', '疑惑', 'PUZZLE'],
  ['anger', '生气', 'ANGER'],
];
let currentFace = 'neutral';

const nav = el('nav');
FACES.forEach(([key, cn, en], i) => {
  const li = document.createElement('li');
  li.dataset.key = key;
  li.innerHTML = `<i>${String(i + 1).padStart(2, '0')}</i>${cn}`;
  li.addEventListener('click', () => paint(key));
  nav.appendChild(li);
});

function paint(key) {
  const prev = currentFace;
  currentFace = key;
  bearEl.innerHTML = renderCharacter(PRESETS[key]);
  poseEl = bearEl.querySelector('#pose');
  gazeEl = bearEl.querySelector('#gaze');
  mouthEl = bearEl.querySelector('#mouth');
  [...nav.children].forEach((li) => li.classList.toggle('active', li.dataset.key === key));
  if (key !== prev) { nextShyFx = 0; nextAngerFx = 0; clearFx(); }
  if (key === 'surprise' && prev !== 'surprise') spawnSpark();
}

/* ---------- 每一帧把参数写到 SVG 上 ---------- */
let blinkStart = 0, nextBlink = performance.now() + 2000;
let EYE_CY = 0;      // 眨眼缩放的轴，加载 face.json 后算出来

function blinkScale(now) {
  if (now > nextBlink) { blinkStart = now; nextBlink = now + 2400 + Math.random() * 3200; }
  const dt = now - blinkStart;
  if (dt > 190 || dt < 0) return 1;
  return 1 - Math.sin((dt / 190) * Math.PI) * 0.92;
}

function applyPose(now) {
  if (!poseEl || !gazeEl) return;
  const f = getFace();
  const { x: px, y: py } = f.pivot;
  const breathe = Math.sin(now * 0.0016) * 0.008;

  const poseT = `translate(${px} ${py}) rotate(${state.cur.tilt.toFixed(2)}) scale(${(1 + breathe).toFixed(4)}) translate(${-px} ${-py})`;
  poseEl.setAttribute('transform', poseT);
  fxg.setAttribute('transform', poseT);   // 粒子跟着头一起歪，不会飘在原地

  const gx = state.cur.gx * f.gazeAmp.x;
  const gy = state.cur.gy * f.gazeAmp.y;
  gazeEl.setAttribute('transform',
    `translate(${gx.toFixed(2)} ${gy.toFixed(2)}) translate(0 ${EYE_CY}) scale(1 ${blinkScale(now).toFixed(3)}) translate(0 ${-EYE_CY})`);

  // 张手程度连续控制张嘴大小（只在大笑表情下生效）
  if (mouthEl) {
    const open = currentFace === 'joy' ? mouthOpenScale(state.spread) : 1;
    const mx = +mouthEl.dataset.mx, my = +mouthEl.dataset.my;
    mouthEl.setAttribute('transform',
      `translate(${mx} ${my}) scale(1 ${open.toFixed(3)}) translate(${-mx} ${-my})`);
  }

  updateFx(now);
}

/* ---------- 弹簧插值：永远不直接赋值，只向目标靠近一小步 ---------- */
const K = 0.15;
const K_TILT = 0.06;      // 歪头比视线慢得多：整只熊在转，慢一点才不晃眼
function springStep() {
  state.cur.gx += (state.target.gx - state.cur.gx) * K;
  state.cur.gy += (state.target.gy - state.cur.gy) * K;
  state.cur.tilt += (state.target.tilt - state.cur.tilt) * K_TILT;
}

/* ---------- 手势 → 表情接管 ----------
   优先级：比心 > 点赞 > 握拳 > 张手。
   · 单手比心   → 害羞（按住型）
   · 竖大拇指   → wink（点按型：锁定 3 秒，换个手势后才可再触发）
   · 握拳       → 生气（按住型）
   · 张开手掌   → 大笑（按住型，张嘴大小跟着张开度连续变化）
   其余状况 → 好奇；手离开 3 秒 → 中性待机。滑块试玩模式下不接管。 */
const debounce = makeDebouncer(180);
let winkUntil = 0;         // wink 锁定的截止时刻
let winkArmed = true;      // 点赞触发过一次后，要先换个手势才允许再次触发
let prevGesture = 'none';

// 张手 → 大笑 的滞回：张开度到 0.72 才笑，掉到 0.45 以下才收
const OPEN_ON = 0.72, OPEN_OFF = 0.45;
let joyOpen = false;

let heartOn = false;
let heartOffUntil = 0;     // 比心刚松开的一小段时间内不认点赞

/* 单手比心分两档：
   进入要三个条件同时成立（拇指食指相碰、食指在掌外、后三指蜷着）；
   保持只要求拇指和食指还捻着（< 0.45 掌宽）。
   不这样分档，手指稍微松一点就会掉出害羞，表情一闪一闪。 */
function updateHeart(lm, now) {
  if (!lm) {
    if (heartOn) heartOffUntil = now + 800;
    heartOn = false;
    return false;
  }
  const was = heartOn;
  if (!heartOn) {
    heartOn = isFingerHeart(lm);
  } else {
    const w = palmWidth(lm) || 1e-6;
    heartOn = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / w <= 0.45;
  }
  // 松手时拇指还立在前面，那一瞬间的四指判据恰好满足"竖大拇指"。
  // 不挡的话每次害羞完都会莫名眨一下眼。
  if (was && !heartOn) heartOffUntil = now + 800;
  return heartOn;
}

function updateOpennessHysteresis() {
  if (state.openness >= OPEN_ON) joyOpen = true;
  else if (state.openness <= OPEN_OFF) joyOpen = false;
}

function paintIdle(g, now) {
  if (joyOpen) paintMaybe('joy');
  // 看不清的时候它会疑惑地看着镜头，比干等在那儿更说明问题
  else if (darkOn && !state.hand) paintMaybe('puzzle');
  else if (g === 'none' && now - state.lastHandAt > 3000) paintMaybe('neutral');
  else paintMaybe('curious');
}

function applyGestureFace(g, now) {
  if (!running) return;                      // 滑块试玩模式：表情全交给手动导航

  if (now < winkUntil)     { prevGesture = g; return; }   // wink 锁定期：其他手势不抢

  if (g !== prevGesture) winkArmed = true;    // 换过手势后点赞重新可用

  switch (g) {
    case 'heart':
      paintMaybe('shy');
      break;
    case 'thumb':
      if (now <= heartOffUntil) {
        // 比心松手的惯性姿势：拇指立着，但不是想点赞。按普通待机处理，
        // 不能让这一支什么都不画，否则会僵在害羞上。
        paintIdle(g, now);
      } else if (winkArmed) {
        winkUntil = now + 3000;
        winkArmed = false;
        paintMaybe('wink');
      }
      break;
    case 'fist':
      paintMaybe('anger');
      break;
    default:
      paintIdle(g, now);
  }
  prevGesture = g;
}

function paintMaybe(key) {
  if (currentFace !== key) paint(key);
}

/* ---------- 摄像头 + 手部识别 ---------- */
const video = el('video');
const overlay = el('overlay');
const ctx = overlay.getContext('2d');
const statusEl = el('status');
const camOff = el('camOff');
const camNote = el('camNote');

/* ---------- 画面亮度 ----------
   缩到 32×24 去算平均亮度，每 600ms 一次，开销可以忽略。
   用两个阈值做滞回（暗处 <42 判暗，回到 >58 才解除），
   否则正好卡在临界点时会一直闪"太暗"。 */
const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32; lumaCanvas.height = 24;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
let bright = 255, darkOn = false, lastLumaAt = 0;

function sampleBrightness(now) {
  if (now - lastLumaAt < 600) return;
  lastLumaAt = now;
  if (!video.videoWidth) return;
  try {
    lumaCtx.drawImage(video, 0, 0, 32, 24);
    const d = lumaCtx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    bright = sum / (d.length / 4);
  } catch (e) { return; }        // 视频还没准备好时 drawImage 会抛错
  if (!darkOn && bright < 42) darkOn = true;
  else if (darkOn && bright > 58) darkOn = false;
}

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17],
];

let landmarker = null;
let running = false;
let lastDetectAt = 0;
let fpsWindow = [], fpsStamp = 0;

async function initModel() {
  statusEl.textContent = '正在加载识别模型…';
  const { FilesetResolver, HandLandmarker } = await import('./vendor/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  const opts = {
    baseOptions: { modelAssetPath: './assets/hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,               // 只认主手：四个动作都是单手，多给一只手只会让主手来回抢
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    opts.baseOptions.delegate = 'CPU';
    landmarker = await HandLandmarker.createFromOptions(fileset, opts);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return failCamera('浏览器不支持摄像头');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, audio: false,
    });
    video.srcObject = stream;
    video.play().catch(() => {});   // 不阻塞等待播放，避免个别浏览器卡在这里
  } catch (e) {
    return failCamera(e.name === 'NotAllowedError' ? '摄像头权限被拒绝' : '摄像头不可用');
  }
  camOff.hidden = true;
  el('startBtn').hidden = true;
  try {
    if (!landmarker) await initModel();
  } catch (e) {
    return failCamera('识别模型加载失败');
  }
  statusEl.textContent = '正在识别';
  statusEl.className = 'status on';
  el('hint').textContent = '张手=大笑（张越大嘴越大）· 握拳=生气 · 点赞=wink · 单手比心=害羞（拇指和食指捻一下）。';
  running = true;
  requestAnimationFrame(loop);
}

function failCamera(msg) {
  statusEl.textContent = msg;
  statusEl.className = 'status err';
  el('startBtn').hidden = true;
  el('fallback').classList.add('show');
  el('hint').textContent = '把手抬到画面前时，它的视线会跟着手走。这里先用滑块代替。';
  bindFallback();
  if (!running) requestAnimationFrame(loop);
}

/* ---------- 从手的关键点算参数 ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 主手就是返回的第一只手。numHands 设成 1 之后，MediaPipe 只会给出最可信的那只，
// 不需要再在两只手之间挑——挑来挑去正是视线跳动的原因之一。
function updateFromHands(result) {
  const lms = result?.landmarks || [];
  const now = performance.now();

  if (!lms.length) {
    state.hand = false;
    state.hands = 0;
    heartOn = false;
    joyOpen = false;
    const debounced = debounce('none', now);
    state.gesture = debounced;
    state.openness += (0 - state.openness) * K;
    state.spread += (0 - state.spread) * K;
    applyGestureFace(debounced, now);
    // 手离开画面：回到待机，轻微游移
    const t = now * 0.001;
    state.target.gx = Math.sin(t * 0.55) * 0.32;
    state.target.gy = Math.sin(t * 0.37 + 1.2) * 0.16;
    state.target.tilt = Math.sin(t * 0.31) * 1.2;
    return;
  }
  state.hand = true;
  state.hands = lms.length;
  state.lastHandAt = now;

  // numHands 设成 1，返回的第一只就是主手，不需要再挑
  const primary = lms[0];
  const analysis = analyzeHand(primary);

  // 单手比心覆盖其它分类：拇指食指捻住时，四指判据会把它归成"过渡中"
  updateHeart(primary, now);
  const gesture = heartOn ? 'heart' : analysis.gesture;

  // 张开度：单手时取主手；比心时两手都蜷着，不参与
  if (!heartOn) state.openness += (analysis.openness - state.openness) * 0.3;
  state.spread += (analysis.spread - state.spread) * 0.3;
  updateOpennessHysteresis();

  // 连续通道：视线跟着手腕走，歪头跟着手掌朝向走
  state.target.gx = clamp((1 - primary[0].x - 0.5) * 2.4, -1, 1);
  state.target.gy = clamp((primary[0].y - 0.5) * 2.2, -1, 1);

  const dx = primary[9].x - primary[0].x;
  const dy = primary[9].y - primary[0].y;
  const tilt = Math.atan2(-dx, -dy) * 180 / Math.PI;
  // 死区：手腕轻微倾斜时一律视为「没歪」，避免手掌角度抖动带着整只熊晃
  const DZ = 1.8, MAX = 4;
  const mag = Math.abs(tilt);
  state.target.tilt = mag <= DZ ? 0 : Math.sign(tilt) * Math.min((mag - DZ) / (MAX - DZ) * MAX, MAX);

  const debounced = debounce(gesture, now);
  state.gesture = debounced;
  applyGestureFace(debounced, now);
}

/* ---------- 画手部骨架（可画多只手） ---------- */
function drawOverlayFrame(landmarks) {
  const W = overlay.width, H = overlay.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const lm of landmarks) drawOverlay(lm);
}

function drawOverlay(lm) {
  if (!lm) return;
  const W = overlay.width, H = overlay.height;
  ctx.setTransform(-1, 0, 0, 1, W, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(132,88,30,.85)';
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
  }
  ctx.stroke();
  ctx.fillStyle = '#F4EFE2';
  ctx.strokeStyle = 'rgba(132,88,30,.9)';
  ctx.lineWidth = 2;
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, 4.2, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

/* ---------- 主循环 ---------- */
function loop(now) {
  if (running && landmarker && video.readyState >= 2) {
    sampleBrightness(now);
    if (now - lastDetectAt > 30) {
      lastDetectAt = now;
      let result = null;
      try { result = landmarker.detectForVideo(video, now); } catch (e) { /* 偶发丢帧忽略 */ }
      updateFromHands(result);
      drawOverlayFrame(result?.landmarks || []);
      // 帧率
      fpsWindow.push(now);
      while (fpsWindow.length && now - fpsWindow[0] > 1000) fpsWindow.shift();
      state.fps = fpsWindow.length;
    }
  }
  if (!running) { updateFromHands(null); }
  springStep();
  applyPose(now);
  if (now - fpsStamp > 120) { fpsStamp = now; readout(); }
  requestAnimationFrame(loop);
}

// 面板上的比心状态：只报"认到没有"，不再暴露两手间距
function heartReadout() {
  if (!running) return '—';
  if (!state.hand) return '没看到手';
  return heartOn ? '已识别' : '—';
}

function readout() {
  el('pGx').textContent = state.cur.gx.toFixed(2);
  el('pGy').textContent = state.cur.gy.toFixed(2);
  el('pTilt').textContent = state.cur.tilt.toFixed(1) + '°';
  el('pFps').textContent = state.fps ? state.fps + ' fps' : '—';
  el('pBright').textContent = (running && video.videoWidth) ? Math.round(bright) + (darkOn ? ' · 偏暗' : '') : '—';
  el('pGesture').textContent = GESTURE_NAME[state.gesture] || '—';
  el('pHeart').textContent = heartReadout();
  el('pOpen').textContent = Math.round(state.openness * 4) + ' / 4';
  el('pSpread').textContent = Math.round(state.spread * 100) + '%';
  if (running) {
    const t = performance.now();
    const idle = !state.hand && t - state.lastHandAt > 1500;   // 手刚离开时先别急着催
    statusEl.textContent = t < winkUntil ? 'wink 中 · 手势锁定'
      : (darkOn && !state.hand) ? '画面偏暗 · 往亮处挪一点'
      : state.hand ? '已检测到手：' + (GESTURE_NAME[state.gesture] || '识别中')
      : idle ? '把手抬进画面里'
      : '等待手进入画面';
    statusEl.className = 'status on';
    setCamNote((darkOn && !state.hand) ? '画面偏暗 · 往亮处挪一点'
      : idle ? '把手抬进画面里' : '');
  } else {
    setCamNote('');
  }
}

/* 摄像头框右下角的小提示条：暗 / 没手 两种文案，其余时候收起来 */
function setCamNote(text) {
  if (!text) { if (!camNote.hidden) camNote.hidden = true; return; }
  if (camNote.textContent !== text) camNote.textContent = text;
  if (camNote.hidden) camNote.hidden = false;
}

/* ---------- 摄像头小窗折叠 ----------
   只影响显示，识别照常跑；折叠状态记在 sessionStorage 里，刷新后还是折叠的。 */
const camWrap = el('camWrap');
const camToggle = el('camToggle');
let camCollapsed = false;

function setCamCollapsed(v) {
  camCollapsed = v;
  camWrap.hidden = v;
  camToggle.textContent = v ? '展开' : '收起';
  camToggle.setAttribute('aria-expanded', String(!v));
  try { sessionStorage.setItem('camCollapsed', v ? '1' : '0'); } catch (e) { /* 隐私模式下不可用 */ }
}

camToggle.addEventListener('click', () => setCamCollapsed(!camCollapsed));

/* ---------- 试玩模式滑块 ---------- */
let fallbackBound = false;
function bindFallback() {
  if (fallbackBound) return;
  fallbackBound = true;
  el('sGx').addEventListener('input', (e) => { state.target.gx = e.target.value / 100; });
  el('sGy').addEventListener('input', (e) => { state.target.gy = e.target.value / 100; });
  el('sTilt').addEventListener('input', (e) => { state.target.tilt = +e.target.value; });
}

/* ---------- 启动 ----------
   先读 face.json，再画第一帧。face.json 描述"这张脸长在哪"：
   五官坐标、旋转轴、视线幅度、粒子锚点全部在里面。
   换角色只换这个文件和底图，识别与动画代码一行不动。 */
async function boot() {
  if (location.protocol === 'file:') {
    el('status').textContent = '请用本地服务打开';
    el('status').className = 'status err';
    el('hint').textContent = '双击项目里的「启动小熊网站.bat」，或运行 python -m http.server 8777，不要直接双击 html 文件。';
    return;
  }

  let cfg;
  try {
    const res = await fetch('./face.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    cfg = await res.json();
  } catch (e) {
    el('status').textContent = 'face.json 读取失败';
    el('status').className = 'status err';
    el('hint').textContent = '找不到 face.json，或内容不是合法 JSON。这个文件记录五官位置，缺了它画不出表情。';
    return;
  }

  const f = setFace(cfg);
  EYE_CY = (f.eyeL.y + f.eyeR.y) / 2;

  // 舞台比例、粒子层视口都跟着画布尺寸走，不再写死 946×964
  document.documentElement.style.setProperty('--face-ratio', `${f.canvas.w} / ${f.canvas.h}`);
  el('fx').setAttribute('viewBox', `0 0 ${f.canvas.w} ${f.canvas.h}`);

  // 角色名也来自 face.json，换角色时标题跟着变
  if (f.name) {
    el('brandName').textContent = f.name;
    document.title = f.name + ' · 手势玩偶';
  }

  paint(new URLSearchParams(location.search).get('face') || 'neutral');   // ?face=shy 直接进某个表情
  try { setCamCollapsed(sessionStorage.getItem('camCollapsed') === '1'); } catch (e) {}
  el('startBtn').addEventListener('click', startCamera);
  requestAnimationFrame(loop);

  // ?auto=1 时直接尝试开摄像头，方便排查
  if (new URLSearchParams(location.search).get('auto') === '1') startCamera();

  // ?sim=1：暴露一个入口，供 tools/sim.html 用合成关键点跑状态机（不接摄像头）
  if (new URLSearchParams(location.search).get('sim') === '1') {
    window.__sim = {
      feed(result) { running = true; updateFromHands(result); },
      face: () => currentFace,
      paint,
      state,
      fx: () => [...fxg.children].map((n) => n.getAttribute('class')),
      tickFx: (now = performance.now()) => updateFx(now),
      flags: () => ({ winkUntil, heartOn, joyOpen }),
    };
  }
}

boot();
