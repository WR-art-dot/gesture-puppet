// tools/test-gestures.mjs —— 用合成的 21 点关键点验证手势分类器
// 用法：node tools/test-gestures.mjs
import {
  analyzeHand, makeDebouncer, isFingerHeart, palmWidth,
} from '../gestures.js';

const P = (x, y) => ({ x, y, z: 0 });

// 造一只手：wrist 手腕，base 是五指根部位置，每根手指给 tip 偏移和 pip 偏移
function makeHand({ wrist, thumbTip, thumbPip, fingerTipDy, fingerPipDy }) {
  const lm = new Array(21).fill(null).map(() => P(0, 0));
  lm[0] = wrist;
  lm[1] = P(wrist.x - 0.06, wrist.y - 0.08);
  lm[2] = thumbPip;
  lm[3] = P((thumbPip.x + thumbTip.x) / 2, (thumbPip.y + thumbTip.y) / 2);
  lm[4] = thumbTip;
  const xs = [-0.07, 0, 0.07, 0.14];
  [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach(([mcp, pip, dip, tip], i) => {
    const bx = wrist.x + xs[i];
    lm[mcp] = P(bx, wrist.y - 0.2);
    lm[pip] = P(bx, wrist.y + fingerPipDy);
    lm[dip] = P(bx, wrist.y + (fingerPipDy + fingerTipDy) / 2);
    lm[tip] = P(bx, wrist.y + fingerTipDy);
  });
  return lm;
}

const wrist = P(0.5, 0.9);

const openLm = makeHand({
  wrist, thumbTip: P(0.32, 0.62), thumbPip: P(0.4, 0.72),
  fingerTipDy: -0.55, fingerPipDy: -0.25,
});

const fistLm = makeHand({
  wrist, thumbTip: P(0.55, 0.82), thumbPip: P(0.44, 0.78),
  fingerTipDy: -0.05, fingerPipDy: -0.14,
});

const thumbLm = makeHand({
  wrist, thumbTip: P(0.5, 0.45), thumbPip: P(0.5, 0.72),
  fingerTipDy: -0.05, fingerPipDy: -0.14,
});

let failed = 0;
function ok(name, cond, extra = '') {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '（' + extra + '）' : ''}`);
}
function check(name, lm, want) {
  const got = analyzeHand(lm).gesture;
  ok(name, got === want, `期望 ${want}，得到 ${got}`);
}

// ---- 四个保留动作 ----
check('张开手掌', openLm, 'open');
check('握拳', fistLm, 'fist');
check('竖大拇指', thumbLm, 'thumb');

// 握拳容错：四根手指里有一根没蜷实，仍然算握拳（以前会掉进"过渡中"）
{
  const loose = fistLm.map((p) => ({ ...p }));
  loose[8] = P(0.43, wrist.y - 0.18);      // 食指虚着，指尖只收了半截
  check('握拳：食指没蜷实 → 仍算握拳', loose, 'fist');
  ok('握拳：虚着那根的伸出比 ≈ 1.2', analyzeHand(loose).maxR > 1.1 && analyzeHand(loose).maxR < 1.3,
    analyzeHand(loose).maxR.toFixed(2));
}
// 单指伸直（指屏幕）不该被当成握拳
{
  const point = fistLm.map((p) => ({ ...p }));
  point[8] = P(0.43, wrist.y - 0.55);
  const g = analyzeHand(point).gesture;
  ok('食指伸直指着 → 不误判为握拳', g !== 'fist', `得到 ${g}`);
}

// ---- 单手比心：拇指尖和食指尖捻在一起 ----
const fingerHeartLm = (() => {
  const lm = new Array(21).fill(null).map(() => P(0.5, 0.7));
  lm[0] = P(0.50, 0.85);
  lm[1] = P(0.45, 0.79);
  lm[5] = P(0.44, 0.66); lm[6] = P(0.43, 0.50); lm[7] = P(0.40, 0.47); lm[8] = P(0.385, 0.44);
  lm[2] = P(0.41, 0.72); lm[3] = P(0.40, 0.55); lm[4] = P(0.40, 0.455);
  lm[9] = P(0.49, 0.65);  lm[10] = P(0.49, 0.72); lm[12] = P(0.50, 0.74);
  lm[13] = P(0.54, 0.655); lm[14] = P(0.545, 0.72); lm[16] = P(0.55, 0.74);
  lm[17] = P(0.585, 0.675); lm[18] = P(0.59, 0.73); lm[20] = P(0.59, 0.75);
  return lm;
})();
ok('单手比心：拇指食指捻在一起 → true', isFingerHeart(fingerHeartLm) === true,
  `捏合 ${(Math.hypot(0.04, 0.015) / palmWidth(fingerHeartLm)).toFixed(2)} 掌宽`);
ok('单手比心：握拳不算', isFingerHeart(fistLm) === false);
ok('单手比心：竖大拇指不算', isFingerHeart(thumbLm) === false);
ok('单手比心：张开手掌不算', isFingerHeart(openLm) === false);

// 拇指食指刚松开一点（0.42 掌宽）不该再认成比心
{
  const loose = fingerHeartLm.map((p) => ({ ...p }));
  const w = palmWidth(loose);
  loose[4] = P(loose[8].x + 0.42 * w * 0.9, loose[8].y - 0.42 * w * 0.44);
  ok('单手比心：两指松开 → false', isFingerHeart(loose) === false,
    `捏合 ${(Math.hypot(loose[4].x - loose[8].x, loose[4].y - loose[8].y) / w).toFixed(2)} 掌宽`);
}

// ---- 去抖 ----
const deb = makeDebouncer(180);
let t = 0;
const seq = ['open', 'open', 'fist', 'open', 'open', 'open', 'open', 'open', 'fist', 'fist', 'fist'];
const outs = seq.map((g) => deb(g, (t += 60)));
const expect = ['none', 'none', 'none', 'none', 'none', 'none', 'open', 'open', 'open', 'open', 'open'];
ok('去抖: ' + outs.join(' → '), JSON.stringify(outs) === JSON.stringify(expect));

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
