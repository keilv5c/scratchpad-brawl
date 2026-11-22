import {
  IdentityComboDef,
  IdentityComboId,
  MathOperatorDef,
  MathOperatorId,
  MathSchoolDef,
  MathSchoolId,
  MathThemeId,
  MathThemePalette,
  MathTrialMaster,
} from './mathTypes';

/**
 * Authentic "Animation vs. Math / Geometry" Monochrome Vector + Restrained Accent Palette:
 * - P1 is ALWAYS iconic solid Alan Becker Orange (#ff7a1a) for instant visual recognition.
 * - Math constructs are crisp pure vector white (on black void) or ink black (on white stage),
 *   with restrained accents (gold for φ/Euler, coral-red for ÷0/derivatives) instead of cyber-neon gradients.
 */
export const MATH_SCHOOLS: Record<MathSchoolId, MathSchoolDef> = {
  euler: {
    id: 'euler',
    name: '经典欧拉',
    formula: 'e^(iπ) + 1 = 0',
    symbol: 'e',
    badge: '复平面 · 虚轴闪避',
    color: '#ffffff',
    secondaryColor: '#f2c14e',
    desc: '挥舞自然常数 e 弧刃作战；闪避乘以虚数 ×i 切入虚轴无敌绕背，重击掷出旋转欧拉单位圆，大招展开 e^(iπ)+1=0 复平面清弹归零。',
    heavyName: '欧拉单位圆 e^(iθ)',
    superName: '上帝公式 · 欧拉恒等式',
    superFormula: 'e^(iπ) + 1 = 0',
    speedMult: 1.05,
    damageMult: 1.0,
  },
  golden: {
    id: 'golden',
    name: '黄金分割',
    formula: 'φ = (1+√5)/2',
    symbol: 'φ',
    badge: '斐波那契 5·8·13',
    color: '#f2c14e',
    secondaryColor: '#ffffff',
    desc: '普攻三段严格按斐波那契数列 5 → 8 → 13 递增！蓄力展开嵌套黄金矩形发射对数螺线，大招牵引焦点触发 5 段递增黄金脉冲。',
    heavyName: '斐波那契对数螺线',
    superName: '黄金比例 · 绝对构图',
    superFormula: 'φ = 1.6180339...',
    speedMult: 1.02,
    damageMult: 1.0,
  },
  trig: {
    id: 'trig',
    name: '三角函数',
    formula: 'sin²x + cos²x = 1',
    symbol: 'sin',
    badge: '实时波动 · 渐近斩',
    color: '#e6f0ff',
    secondaryColor: '#8ec5ff',
    desc: '操控实时震荡的正弦激光波与 tan(π/2) 渐近线纵斩！大招展开巨型单位圆，沿实轴 cos 与纵轴 sin 交替扫射正交波束。',
    heavyName: '正弦驻波 sin(kx−ωt)',
    superName: '单位圆 · 正交扫频',
    superFormula: 'cos θ + i·sin θ',
    speedMult: 1.06,
    damageMult: 1.0,
  },
  calculus: {
    id: 'calculus',
    name: '高数微积分',
    formula: '∫ f(x)dx · d/dx',
    symbol: '∫',
    badge: '求导降阶 · 黎曼压制',
    color: '#ffffff',
    secondaryColor: '#ef5350',
    desc: '挥舞巨型积分号 ∫ 镰刀，每次命中令目标多项式降阶（x³→3x²→6x→6→0 归零破盾！）；蓄力召唤黎曼矩形重压，大招泰勒多项式锁杀。',
    heavyName: '黎曼和定积分碾压',
    superName: '泰勒级数 · 逼近锁杀',
    superFormula: 'Σ f⁽ⁿ⁾(a)/n! · (x−a)ⁿ',
    speedMult: 0.98,
    damageMult: 1.04,
  },
  algebra: {
    id: 'algebra',
    name: '运算魔方',
    formula: '+ − × ÷ · 2ⁿ · ÷0',
    symbol: '∑',
    badge: '减号长棍 · 指数分裂',
    color: '#ffffff',
    secondaryColor: '#ef5350',
    desc: '原汁原味动画开头武器：减号 − 当长棍、加号 + 与乘号 × 连斩；蓄力发射 2→4 分裂指数弹，大招压入分母 0 弯曲坐标系网格！',
    heavyName: '指数分裂弹 2ⁿ',
    superName: '除以零 · 坐标系奇点',
    superFormula: 'lim (x / 0) → ∞',
    speedMult: 1.04,
    damageMult: 1.0,
  },
  euclid: {
    id: 'euclid',
    name: '欧几里得几何',
    formula: '△ · Fractal · 4D',
    symbol: '△',
    badge: '分形三角 · 四维投影',
    color: '#ffffff',
    secondaryColor: '#a8b8ff',
    desc: '手搓纯白几何棱镜近战斩击，蓄力掷出递归分裂的谢尔宾斯基分形三角，大招展开真实 4D 旋转矩阵计算的四维超立方体投影。',
    heavyName: '谢尔宾斯基分形三角',
    superName: '高维投影 · 4D 超立方体',
    superFormula: 'Tesseract ℝ⁴ → ℝ²',
    speedMult: 1.04,
    damageMult: 1.0,
  },
};

export const MATH_SCHOOL_LIST: MathSchoolDef[] = [
  MATH_SCHOOLS.euler,
  MATH_SCHOOLS.golden,
  MATH_SCHOOLS.trig,
  MATH_SCHOOLS.calculus,
  MATH_SCHOOLS.algebra,
  MATH_SCHOOLS.euclid,
];

export const MATH_OPERATORS: Record<MathOperatorId, MathOperatorDef> = {
  mul2: {
    id: 'mul2',
    glyph: '×2',
    name: '倍增算子',
    color: '#ffffff',
    desc: '下一发重击/大招弹道翻倍齐射（受总伤上限平衡约束）',
  },
  pow2: {
    id: 'pow2',
    glyph: 'x²',
    name: '平方增幅',
    color: '#f2c14e',
    desc: '下一发公式攻击范围 ×1.3、伤害 +25% 并附带破防',
  },
  neg: {
    id: 'neg',
    glyph: '−',
    name: '取负反转',
    color: '#ef5350',
    desc: '击退变为反向拉扯，并反弹触碰到的敌方弹幕',
  },
  deriv: {
    id: 'deriv',
    glyph: 'd/dx',
    name: '求导加速',
    color: '#ffffff',
    desc: '瞬时变化率提升：移速与弹速提高 5 秒',
  },
  integ: {
    id: 'integ',
    glyph: '∫',
    name: '积分蓄能',
    color: '#f2c14e',
    desc: '回复护盾与 +22% 势能',
  },
  pi: {
    id: 'pi',
    glyph: 'π',
    name: '圆周共鸣',
    color: '#ffffff',
    desc: '附带双发 π 切线弧刃；与 i 组合触发 e^(iπ)+1=0',
  },
  imag: {
    id: 'imag',
    glyph: 'i',
    name: '虚数相位',
    color: '#b8c8ff',
    desc: '弹道穿透格挡；与 π 组合触发 e^(iπ)+1=0',
  },
  div0: {
    id: 'div0',
    glyph: '÷0',
    name: '零除奇点',
    color: '#ef5350',
    desc: '撕裂局部黑洞引力奇点，弯曲背景笛卡尔坐标系网格',
  },
};

export const SPAWNABLE_OPERATORS: MathOperatorId[] = [
  'mul2',
  'pow2',
  'neg',
  'deriv',
  'integ',
  'pi',
  'imag',
];

export const ALL_OPERATORS_LIST: MathOperatorDef[] = [
  MATH_OPERATORS.mul2,
  MATH_OPERATORS.pow2,
  MATH_OPERATORS.neg,
  MATH_OPERATORS.deriv,
  MATH_OPERATORS.integ,
  MATH_OPERATORS.pi,
  MATH_OPERATORS.imag,
  MATH_OPERATORS.div0,
];

export const IDENTITY_COMBOS: Record<IdentityComboId, IdentityComboDef> = {
  euler_zero: {
    id: 'euler_zero',
    formula: 'e^(iπ) + 1 = 0',
    title: '欧拉归零 · 五常数共鸣',
    desc: '抹除全场敌方弹幕并释放复平面归零脉冲',
    color: '#f2c14e',
  },
  pythagorean_one: {
    id: 'pythagorean_one',
    formula: 'sin²x + cos²x = 1',
    title: '绝对归一 · 几何护盾',
    desc: '回复 +18 生命并获得 3.5 秒 40% 减伤护盾',
    color: '#ffffff',
  },
  ftc_cycle: {
    id: 'ftc_cycle',
    formula: 'd/dx ∫ f(t)dt = f(x)',
    title: '微积分基本定理 · 势能循环',
    desc: '回复 +35% 势能并进入 5 秒求导加速',
    color: '#f2c14e',
  },
  div_zero: {
    id: 'div_zero',
    formula: 'lim(x → 0) 1/x = ∞',
    title: '除以零 · 网格坍缩奇点',
    desc: '在目标处撕开黑洞奇点，弯曲整张笛卡尔网格',
    color: '#ef5350',
  },
};

export function detectIdentityCombo(
  school: MathSchoolId,
  ops: MathOperatorId[]
): IdentityComboId | null {
  const has = (id: MathOperatorId) => ops.includes(id);
  if (has('div0')) return 'div_zero';
  if ((has('pi') && has('imag')) || (school === 'euler' && (has('pi') || has('imag')) && ops.length >= 2)) {
    return 'euler_zero';
  }
  if (has('deriv') && has('integ')) return 'ftc_cycle';
  if (school === 'trig' && (has('pow2') || (has('pi') && ops.length >= 1))) {
    return 'pythagorean_one';
  }
  if (has('pow2') && has('pi')) return 'pythagorean_one';
  return null;
}

export function buildFormulaPreview(school: MathSchoolId, ops: MathOperatorId[]): string {
  const s = MATH_SCHOOLS[school];
  if (ops.length === 0) return `f(x) = ${s.formula}`;
  const combo = detectIdentityCombo(school, ops);
  if (combo) {
    return `连携就绪: ${IDENTITY_COMBOS[combo].formula}`;
  }
  const opStr = ops.map((o) => MATH_OPERATORS[o].glyph).join(' · ');
  return `[ ${opStr} ] ∘ ${s.formula}`;
}

export const MATH_TRIAL_MASTERS: MathTrialMaster[] = [
  {
    stageIndex: 0,
    name: '算子哨兵 · ±×÷',
    title: '第 1 试炼 · 运算魔方',
    quote: '“从最基础的四则运算开始求解。”',
    school: 'algebra',
    color: '#ffffff',
    secondaryColor: '#ef5350',
    maxHp: 145,
    difficulty: 0.44,
  },
  {
    stageIndex: 1,
    name: '单位圆行者 · sin',
    title: '第 2 试炼 · 三角函数',
    quote: '“在正弦与余弦的周期里找准破绽。”',
    school: 'trig',
    color: '#ffffff',
    secondaryColor: '#8ec5ff',
    maxHp: 160,
    difficulty: 0.56,
  },
  {
    stageIndex: 2,
    name: '黄金构图师 · φ',
    title: '第 3 试炼 · 黄金分割',
    quote: '“5、8、13……每一步都符合黄金比例。”',
    school: 'golden',
    color: '#f2c14e',
    secondaryColor: '#ffffff',
    maxHp: 175,
    difficulty: 0.68,
  },
  {
    stageIndex: 3,
    name: '微积分学者 · ∫',
    title: '第 4 试炼 · 高数微积分',
    quote: '“连续求导直至归零，接受定积分的重压。”',
    school: 'calculus',
    color: '#ffffff',
    secondaryColor: '#ef5350',
    maxHp: 190,
    difficulty: 0.78,
  },
  {
    stageIndex: 4,
    name: '欧拉 · e^(iπ)',
    title: '终极试炼 · 上帝公式守护者',
    quote: '“e^(iπ) + 1 = 0 —— 复平面万象终归于零。”',
    school: 'euler',
    color: '#ffffff',
    secondaryColor: '#f2c14e',
    maxHp: 240,
    isBoss: true,
    difficulty: 0.88,
  },
];

export const MATH_THEMES: Record<MathThemeId, MathThemePalette> = {
  chalkboard: {
    id: 'chalkboard',
    name: '纯黑虚空（原版动画风）',
    bgTop: '#08080a',
    bgBottom: '#0b0b0e',
    gridMinor: 'rgba(255, 255, 255, 0.055)',
    gridMajor: 'rgba(255, 255, 255, 0.13)',
    axisColor: 'rgba(255, 255, 255, 0.36)',
    axisLabel: 'rgba(255, 255, 255, 0.62)',
    platformFill: '#111115',
    platformStroke: '#ffffff',
    platformGlow: 'rgba(255, 255, 255, 0.08)',
    chalkCore: '#ffffff',
    dimOverlay: '#030305',
    isLight: false,
  },
  blueprint: {
    id: 'blueprint',
    name: '纯白演算纸（浅色矢量）',
    bgTop: '#f7f7f4',
    bgBottom: '#f0f0ec',
    gridMinor: 'rgba(20, 20, 24, 0.065)',
    gridMajor: 'rgba(20, 20, 24, 0.14)',
    axisColor: 'rgba(20, 20, 24, 0.42)',
    axisLabel: 'rgba(20, 20, 24, 0.72)',
    platformFill: '#ffffff',
    platformStroke: '#141418',
    platformGlow: 'rgba(0, 0, 0, 0.06)',
    chalkCore: '#141418',
    dimOverlay: '#0a0a0d',
    isLight: true,
  },
};
