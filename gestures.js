// gestures.js —— 纯计算：21 个手部关键点 → 手势分类
// 不依赖任何 DOM，可以在 node 里单独测试。
//
// 只保留四个动作：张开手掌、握拳、竖大拇指、单手比心。
// 取舍标准是"单手、静态、判据只依赖一帧几何"——
// 需要 1 秒时间窗口的挥手、依赖相机推进速率的"凑近"都已经去掉，
// 它们跟别的动作抢通道，是误判的主要来源。
//
// MediaPipe 手部关键点编号：
//  0 手腕
//  1-4   大拇指（根→尖）
//  5-8   食指
//  9-12  中指
//  13-16 无名指
//  17-20 小指

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 四根手指：指尖 / 第二关节 / 指根
const FINGERS = [
  { tip: 8,  pip: 6,  mcp: 5  },
  { tip: 12, pip: 10, mcp: 9  },
  { tip: 16, pip: 14, mcp: 13 },
  { tip: 20, pip: 18, mcp: 17 },
];

export function analyzeHand(lm) {
  const wrist = lm[0];
  const handSize = dist(lm[0], lm[9]);   // 手腕→中指根，作为手掌大小的标尺

  // 每根手指的"伸出程度" = 指尖到手腕 / 第二关节到手腕。
  // 伸开约 1.4~2.0，握实约 0.5~1.0。比值不受手的朝向影响。
  const ratios = FINGERS.map(
    ({ tip, pip }) => dist(lm[tip], wrist) / (dist(lm[pip], wrist) || 1e-6)
  );
  const extendedN = ratios.filter((r) => r > 1.12).length;
  const curledN = ratios.filter((r) => r < 1.08).length;
  const maxR = Math.max(...ratios);

  // spread：手指展开的连续程度（0 = 完全蜷起，1 = 充分张开）。
  // 嘴巴的大小靠它驱动，所以要用连续量而不是"伸直的手指数"。
  let spreadSum = 0;
  for (const { tip, mcp } of FINGERS) {
    const base = dist(lm[mcp], wrist);
    if (base < 1e-6) continue;
    spreadSum += Math.min(Math.max((dist(lm[tip], wrist) / base - 1) / 1.1, 0), 1);
  }
  const spread = spreadSum / FINGERS.length;

  // 大拇指没有可靠的"第二关节"参照，改用：指尖明显比根关节离手腕远，
  // 且指尖在根关节上方（屏幕坐标 y 越小越靠上），才认作"朝上的点赞"。
  const thumbExt = dist(lm[4], wrist) > dist(lm[2], wrist) * 1.25;
  const thumbUp  = thumbExt && (lm[4].y < lm[2].y - handSize * 0.12);

  let gesture = 'other';
  if (extendedN >= 4) {
    gesture = 'open';                                    // 五指张开
  } else if (extendedN === 0 || (extendedN <= 1 && curledN >= 2 && maxR < 1.30)) {
    // 握拳的容错：真握拳很少四根都蜷得一样实，常常有一根虚着。
    // 允许一根虚着，但那根也不能伸得太直（maxR 卡在 1.30）。
    gesture = thumbUp ? 'thumb' : 'fist';
  }

  return { gesture, openness: extendedN / 4, spread, handSize, maxR };
}

// 掌宽 = 食指根(5) 到 小指根(17) 的距离，作为单手比心的尺度基准
export function palmWidth(lm) {
  return dist2(lm[5], lm[17]);
}

// 单手比心：拇指尖和食指尖捻在一起，中指无名指小指蜷着。
// 三个条件同时成立才算，避免跟握拳、点赞混淆：
//   1. 拇指尖和食指尖几乎相碰（< 0.34 掌宽）
//   2. 食指伸在掌外（握拳时它会缩回来，这一条把拳头挡在外面）
//   3. 后三指都蜷着
const CURL_FINGERS = [
  { tip: 12, pip: 10 }, { tip: 16, pip: 14 }, { tip: 20, pip: 18 },
];

export function isFingerHeart(lm) {
  const w = palmWidth(lm) || 1e-6;
  if (dist2(lm[4], lm[8]) / w > 0.34) return false;
  if (dist2(lm[8], lm[0]) / w < 0.95) return false;
  return CURL_FINGERS.every(
    ({ tip, pip }) => dist2(lm[tip], lm[0]) <= dist2(lm[pip], lm[0]) * 1.12
  );
}

// 去抖器：同一手势需要连续保持 holdMs 才被认定，
// 识别偶尔抖一两帧不会导致表情乱跳。
export function makeDebouncer(holdMs = 180) {
  let candidate = 'none', since = 0, current = 'none';
  return (gesture, now) => {
    if (gesture !== candidate) { candidate = gesture; since = now; }
    if (candidate !== current && now - since >= holdMs) current = candidate;
    return current;
  };
}

// 手势 → 表情 的映射表（供面板显示用）
export const GESTURE_NAME = {
  none:  '—',
  open:  '张开手掌',
  fist:  '握拳',
  thumb: '竖大拇指',
  heart: '比心',
  other: '过渡中',
};
