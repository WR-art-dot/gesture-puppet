// 角色渲染器 v3
// 所有五官位置、尺寸都从 face.json 读，代码里不再有这只熊的坐标。
// 换角色 = 换一张底图 + 换一个 face.json，渲染与手势逻辑完全不动。
//
// 尺寸约定：mouth.w 是"嘴宽"这个基准单位。其余所有横向、纵向尺寸
// 都按 mouth.w 的比例换算，所以同一份代码能适配大小差三倍的角色。

let FACE = null;

export function setFace(cfg) {
  // 补齐缺省字段，避免某个 face.json 少写一行就整页崩掉
  FACE = {
    image: './assets/character-base.png',
    canvas: { w: 946, h: 964 },
    ink: '#2A2622',
    brow: { y: 500, len: 50, w: 12 },
    gazeAmp: { x: 14, y: 10 },
    ...cfg,
    canvas: { w: 946, h: 964, ...(cfg.canvas || {}) },
    brow: { y: 500, len: 50, w: 12, ...(cfg.brow || {}) },
    gazeAmp: { x: 14, y: 10, ...(cfg.gazeAmp || {}) },
  };
  return FACE;
}

export function getFace() {
  return FACE;
}

// 嘴宽作为全局尺度：k=1 对应嘴宽 100px 的角色
function k() {
  return (FACE.mouth.w || 100) / 100;
}

/* ---------------- 眼睛 ---------------- */
// 全部按眼睛半径 r 的比例画，换角色时眼睛大小自动跟着变
function eyeMark(shape, eye, mirror) {
  const { x: cx, y: cy, r } = eye;
  const ink = FACE.ink;
  const line = (d, w) => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const s = mirror ? -1 : 1;

  switch (shape) {
    case 'happy':            // 笑眼：向上弯的粗弧
      return line(`M${cx - r * 1.5} ${cy + r * 0.45} Q${cx} ${cy - r * 1.36} ${cx + r * 1.5} ${cy + r * 0.45}`, r * 0.64);

    case 'wink':             // 折线眼：两道粗线交汇成"＜"，开口朝右
      return line(`M${cx - s * r * 1.09} ${cy - r * 0.86} L${cx + s * r * 0.77} ${cy - r * 0.09} L${cx - s * r * 1.09} ${cy + r * 0.68}`, r * 0.68);

    case 'squint':           // 细眯眼
      return `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.18}" ry="${r * 0.36}" fill="${ink}"/>`;

    case 'big':              // 惊讶：更大的圆眼
      return `<circle cx="${cx}" cy="${cy}" r="${r * 1.45}" fill="${ink}"/>`;

    default:                 // 默认圆点眼
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ink}"/>`;
  }
}

/* ---------------- 眉毛 ---------------- */
// dy / curve 都以眉毛长度为基准，长度本身随角色缩放
function browMark(x, angle, dy, len = FACE.brow.len, curve = -0.2) {
  const ink = FACE.ink;
  return `<path d="M${-len / 2} 0 Q0 ${curve * len} ${len / 2} 0"
    transform="translate(${x} ${FACE.brow.y + dy * len}) rotate(${angle})"
    fill="none" stroke="${ink}" stroke-width="${FACE.brow.w}" stroke-linecap="round"/>`;
}

function browsMark(kind) {
  const L = FACE.eyeL.x, R = FACE.eyeR.x;
  if (kind === 'sad') return browMark(L, -15, 0.08) + browMark(R, 15, 0.08);
  if (kind === 'anger') return browMark(L, 16, 0.2) + browMark(R, -16, 0.2);
  if (kind === 'oneUp') return browMark(R, -14, -0.28, FACE.brow.len * 0.84, -0.22);
  if (kind === 'up') return browMark(L, -3, -0.16) + browMark(R, 3, -0.16);
  return '';
}

/* ---------------- 嘴巴 ---------------- */
// 全部以嘴宽 w 为基准：横纵偏移都乘 w/100
function mouthMark(shape, cx, cy) {
  const ink = FACE.ink;
  const w = k();
  const px = (v) => (cx + v * w).toFixed(1);
  const py = (v) => (cy + v * w).toFixed(1);
  const stroke = `fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round"`;

  switch (shape) {
    case 'muzzle':           // 中性：鼻子下方两撇外翻的小弧线
      return `<path d="M${px(-34)} ${py(4)} Q${px(-19)} ${py(15)} ${px(-6)} ${py(-6)}" ${stroke} stroke-width="${15 * w}"/>
        <path d="M${px(34)} ${py(4)} Q${px(19)} ${py(15)} ${px(6)} ${py(-6)}" ${stroke} stroke-width="${15 * w}"/>`;

    case 'laugh': {          // 大笑：深色轮廓 + 粉红口腔 + 舌头
      const d = `M${px(-50)} ${py(-12)} L${px(50)} ${py(-12)}
        Q${px(50)} ${py(26)} ${px(32)} ${py(41)} Q${px(0)} ${py(58)} ${px(-32)} ${py(41)} Q${px(-50)} ${py(26)} ${px(-50)} ${py(-12)} Z`;
      return `<path d="${d}" fill="#EE7D80" stroke="${ink}" stroke-width="${10 * w}" stroke-linejoin="round"/>
        <path d="M${px(-44)} ${py(-11)} L${px(44)} ${py(-11)}" stroke="${ink}" stroke-width="${11 * w}" stroke-linecap="round"/>
        <ellipse cx="${px(0)}" cy="${py(30)}" rx="${30 * w}" ry="${15 * w}" fill="#F6AEB2"/>`;
    }

    case 'o':                // 惊讶：黑色小圆口 + 内侧粉红舌头
      return `<circle cx="${px(2)}" cy="${py(26)}" r="${22 * w}" fill="${ink}"/>
        <circle cx="${px(-4)}" cy="${py(31)}" r="${10 * w}" fill="#E4553F"/>`;

    case 'three':            // 害羞：横向的「3」
      return `<path d="M${px(-14)} ${py(-6)} Q${px(17)} ${py(-8)} ${px(4)} ${py(8)} Q${px(19)} ${py(24)} ${px(-14)} ${py(22)}"
        ${stroke} stroke-width="${13 * w}"/>`;

    case 'wave':             // 疑惑：波浪嘴
      return `<path d="M${px(-30)} ${py(-2)} Q${px(-16)} ${py(-14)} ${px(0)} ${py(-2)} Q${px(16)} ${py(10)} ${px(30)} ${py(-2)}"
        ${stroke} stroke-width="${13 * w}"/>`;

    case 'frown':            // 生气：下撇嘴
      return `<path d="M${px(-24)} ${py(8)} Q${px(0)} ${py(-12)} ${px(24)} ${py(8)}" ${stroke} stroke-width="${15 * w}"/>`;

    default:
      return `<path d="M${px(-34)} ${py(4)} Q${px(-19)} ${py(15)} ${px(-6)} ${py(-6)}" ${stroke} stroke-width="${15 * w}"/>
        <path d="M${px(34)} ${py(4)} Q${px(19)} ${py(15)} ${px(6)} ${py(-6)}" ${stroke} stroke-width="${15 * w}"/>`;
  }
}

/* ---------------- 腮红 ---------------- */
function blushMark(b) {
  const { x, y } = b;
  const sc = (b.rx || 62) / 62;      // 斜排线随腮红尺寸缩放
  let { rx, ry } = b;
  const hot = b.hot || 0;            // 0 = 淡粉，1 = 深红发烫
  const opacity = b.opacity == null ? 0.8 : b.opacity;
  const id = (b.id || '') + (x < FACE.canvas.w / 2 ? 'L' : 'R');
  const hue = hot > 0.25 ? 'hot' : 'soft';
  const s = 1 + hot * 0.14;
  rx *= s; ry *= s;

  return `<g opacity="${opacity}">
    ${hot > 0.1 ? `<ellipse cx="${x}" cy="${y}" rx="${rx * 1.75}" ry="${ry * 1.7}" fill="url(#glowGrad)" opacity="${hot * 0.6}"/>` : ''}
    <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#blushGrad-${hue})"/>
    ${hot > 0.25 ? `<g clip-path="url(#clip-${id})" stroke="#C33520" stroke-width="${5 * sc}" stroke-linecap="round" opacity="${0.16 + hot * 0.14}">
      <path d="M${x - 30 * sc} ${y + 24 * sc} L${x - 8 * sc} ${y - 22 * sc}"/>
      <path d="M${x - 8 * sc} ${y + 28 * sc} L${x + 14 * sc} ${y - 18 * sc}"/>
      <path d="M${x + 14 * sc} ${y + 30 * sc} L${x + 34 * sc} ${y - 12 * sc}"/>
    </g>` : ''}
  </g>`;
}

/* ---------------- 组装 ---------------- */

export function renderCharacter(p = {}) {
  const { eyeL, eyeR, nose, mouth: m } = FACE;
  const { w: W, h: H } = FACE.canvas;
  const shapeL = p.eyeShapes ? p.eyeShapes[0] : (p.eyeShape || 'dot');
  const shapeR = p.eyeShapes ? p.eyeShapes[1] : (p.eyeShape || 'dot');
  const amp = FACE.gazeAmp;
  const gx = (p.pupil ? p.pupil.x : 0) * amp.x;
  const gy = (p.pupil ? p.pupil.y : 0) * amp.y;
  const blushOpacity = p.blush == null ? 0.85 : p.blush;
  const hot = p.blushHot || 0;
  const tilt = p.tilt || 0;
  const bounce = p.bounce || 0;
  const { x: px, y: py } = FACE.pivot;
  const id = 'c' + Math.random().toString(36).slice(2, 8);

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="bear-svg">
  <defs>
    <radialGradient id="blushGrad-soft">
      <stop offset="0%" stop-color="#F8BFCB" stop-opacity="1"/>
      <stop offset="62%" stop-color="#F9C9D3" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#FBDDE3" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blushGrad-hot">
      <stop offset="0%" stop-color="#EE4A31" stop-opacity="1"/>
      <stop offset="72%" stop-color="#F0593F" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#F58973" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowGrad">
      <stop offset="0%" stop-color="#EF4A32" stop-opacity="0.9"/>
      <stop offset="55%" stop-color="#F17155" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#F7A08E" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip-${id}L"><ellipse cx="${FACE.blushL.x}" cy="${FACE.blushL.y}" rx="${FACE.blushL.rx}" ry="${FACE.blushL.ry}"/></clipPath>
    <clipPath id="clip-${id}R"><ellipse cx="${FACE.blushR.x}" cy="${FACE.blushR.y}" rx="${FACE.blushR.rx}" ry="${FACE.blushR.ry}"/></clipPath>
  </defs>
  <g id="lift" transform="translate(${px} ${py}) scale(${1 + bounce * 0.04}) translate(${-px} ${-py})">
    <g id="pose" transform="translate(${px} ${py}) rotate(${tilt}) translate(${-px} ${-py})">
      <image href="${FACE.image}" x="0" y="0" width="${W}" height="${H}"/>
      ${blushMark({ ...FACE.blushL, hot, opacity: blushOpacity, id })}
      ${blushMark({ ...FACE.blushR, hot, opacity: blushOpacity, id })}
      <g id="gaze" transform="translate(${gx} ${gy})">
        ${eyeMark(shapeL, eyeL, false)}
        ${eyeMark(shapeR, eyeR, true)}
      </g>
      ${browsMark(p.brow || 'none')}
      <ellipse cx="${nose.x}" cy="${nose.y}" rx="${nose.rx}" ry="${nose.ry}" fill="${FACE.ink}"/>
      <g id="mouth" data-mx="${m.x}" data-my="${m.y - 14 * (m.w / 100)}">${mouthMark(p.mouth || 'muzzle', m.x, m.y)}</g>
    </g>
  </g>
</svg>`;
}

// 手指展开程度（0~1，连续值）→ 嘴巴张开的纵向缩放
// 1 = 原始大笑的嘴型，0.45 = 几乎闭合
export function mouthOpenScale(spread) {
  return 0.40 + 0.60 * Math.min(1, Math.max(0, spread));
}

/* ---------------- 表情预设 ---------------- */

export const PRESETS = {
  neutral:  { eyeShape: 'dot',   mouth: 'muzzle', brow: 'none',   blush: 0.85, blushHot: 0 },
  curious:  { eyeShape: 'big',   mouth: 'muzzle', brow: 'up',     blush: 0.8,  blushHot: 0, pupil: { x: 0.55, y: -0.35 } },
  joy:      { eyeShapes: ['happy', 'happy'], mouth: 'laugh', brow: 'none', blush: 0.9, blushHot: 0, bounce: 0.55 },
  shy:      { eyeShape: 'dot',   mouth: 'three',  brow: 'sad',    blush: 1,    blushHot: 1 },
  anger:    { eyeShape: 'dot',   mouth: 'frown',  brow: 'anger',  blush: 0.9,  blushHot: 0.7 },
  wink:     { eyeShapes: ['dot', 'wink'],        mouth: 'muzzle', brow: 'none', blush: 0.95, blushHot: 0.9, tilt: -5 },
  surprise: { eyeShape: 'big',   mouth: 'o',      brow: 'none',   blush: 0.8,  blushHot: 0, bounce: 0.45 },
  puzzle:   { eyeShape: 'dot',   mouth: 'wave',   brow: 'oneUp',  blush: 0.7,  blushHot: 0, tilt: 6 },
};
