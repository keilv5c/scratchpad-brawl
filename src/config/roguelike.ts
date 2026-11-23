import { ArcadeMaster, RoguelikeBuffDef, RoguelikeBuffId, StageId, ThemeId, WeaponId } from '../types';

export const ROGUELIKE_BUFFS: Record<RoguelikeBuffId, RoguelikeBuffDef> = {
  echo_bomb: {
    id: 'echo_bomb',
    name: '残影爆墨',
    tag: '身法流',
    desc: '每次残影步都会在原地留下墨水雷，0.55 秒后炸飞周围敌人！',
    accent: '#d62f2f',
    icon: '💥',
  },
  triple_proj: {
    id: 'triple_proj',
    name: '三连齐发',
    tag: '弹幕流',
    desc: '所有文具远程重击（圆弧波、修正带、图钉、铁钉、三角尺、墨弹）变为扇形三连发！',
    accent: '#1d64c2',
    icon: '🔱',
  },
  parry_vamp: {
    id: 'parry_vamp',
    name: '弹反回血',
    tag: '弹反流',
    desc: '完美弹反回复 16 点生命，并释放震退全场敌人的金墨冲击波！',
    accent: '#d48c17',
    icon: '🛡️',
  },
  pin_rain: {
    id: 'pin_rain',
    name: '巨型图钉雨',
    tag: '连击流',
    desc: '每累计命中 5 次，自动召唤 3 枚巨型红图钉从天而降轰击目标！',
    accent: '#1c7c54',
    icon: '📌',
  },
  heavy_ink: {
    id: 'heavy_ink',
    name: '浓墨重涂',
    tag: '爆发流',
    desc: '全招式伤害提升 28%，击退力度与纸面墨溅范围大幅增强！',
    accent: '#7a2520',
    icon: '🖋️',
  },
  sketch_haste: {
    id: 'sketch_haste',
    name: '疾风草稿',
    tag: '极速流',
    desc: '移动速度提升 18%，残影步冷却时间缩短 35%！',
    accent: '#0f9b78',
    icon: '⚡',
  },
  thick_paper: {
    id: 'thick_paper',
    name: '加厚草稿纸',
    tag: '生存流',
    desc: '最大生命值 +40，并立刻回复 45 点生命值与满额格挡值！',
    accent: '#3e638f',
    icon: '📜',
  },
  ink_fountain: {
    id: 'ink_fountain',
    name: '灵感涌泉',
    tag: '大招流',
    desc: '攻击、弹反与残影闪避获得的灵感值提升 50%，高频狂放文具大招！',
    accent: '#8228b5',
    icon: '🌊',
  },
  ink_lightning: {
    id: 'ink_lightning',
    name: '塑料尺静电雷',
    tag: '重击流',
    desc: '蓄力重击命中时，摩擦静电召唤一道手绘落雷追加 12 点独立雷击伤害！',
    accent: '#d99a1e',
    icon: '🌩️',
  },
  iron_nib: {
    id: 'iron_nib',
    name: '重压折痕',
    tag: '连招流',
    desc: '所有快攻三段终结技附加「破防」与「霸体」效果，无视格挡硬拆！',
    accent: '#b83227',
    icon: '✂️',
  },
};

export const ROGUELIKE_BUFF_LIST: RoguelikeBuffDef[] = Object.values(ROGUELIKE_BUFFS);

export function rollThreeBuffChoices(owned: RoguelikeBuffId[]): RoguelikeBuffDef[] {
  const unowned = ROGUELIKE_BUFF_LIST.filter((b) => !owned.includes(b.id));
  const pool = unowned.length >= 3 ? [...unowned] : [...ROGUELIKE_BUFF_LIST];
  const result: RoguelikeBuffDef[] = [];
  while (result.length < 3 && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

export interface RoguelikeWaveSpec {
  wave: number;
  title: string;
  stage: StageId;
  theme: ThemeId;
  enemies: ArcadeMaster[];
}

const WAVE_STAGES: Array<{ stage: StageId; theme: ThemeId }> = [
  { stage: 'notebook', theme: 'grid' },
  { stage: 'desk_city', theme: 'kraft' },
  { stage: 'ink_ship', theme: 'xuan' },
  { stage: 'double_spread', theme: 'grid' },
  { stage: 'sketch_tower', theme: 'kraft' },
  { stage: 'origami', theme: 'grid' },
  { stage: 'bridge', theme: 'kraft' },
  { stage: 'bamboo', theme: 'xuan' },
];

const MINION_WEAPONS: WeaponId[] = [
  'pencil',
  'ruler',
  'cutter',
  'tape',
  'compass',
  'whip',
  'boomerang',
  'scissors',
  'stapler',
  'highlighter',
  'eraser',
  'fountain_pen',
];

export function buildRoguelikeWave(wave: number): RoguelikeWaveSpec {
  const loc = WAVE_STAGES[(wave - 1) % WAVE_STAGES.length];
  const isBossWave = wave % 3 === 0;
  const diff = Math.min(0.76, 0.28 + wave * 0.06);
  const hpScale = 1 + (wave - 1) * 0.11;

  if (isBossWave) {
    const bossWeapon: WeaponId = wave % 6 === 0 ? 'eraser' : 'fountain_pen';
    const boss: ArcadeMaster = {
      id: `rogue_boss_${wave}`,
      stageIndex: wave,
      name: wave >= 6 ? '执笔大魔王·真' : '红笔巡考头目',
      title: `第 ${wave} 波 · 文具头目`,
      quote: '「交卷时间到，准备重做吧！」',
      weapon: bossWeapon,
      stage: loc.stage,
      theme: loc.theme,
      inkColor: '#0c0d12',
      scarfColor: '#d99a1e',
      maxHp: Math.round(122 * hpScale),
      difficulty: Math.min(0.8, diff + 0.08),
      aggression: 0.72,
      parrySkill: Math.min(0.38, 0.2 + wave * 0.03),
      dodgeSkill: 0.4,
      isBoss: true,
    };
    const guard: ArcadeMaster = {
      id: `rogue_guard_${wave}`,
      stageIndex: wave,
      name: '剪刀护卫',
      title: '精英同桌',
      quote: '',
      weapon: MINION_WEAPONS[wave % MINION_WEAPONS.length],
      stage: loc.stage,
      theme: loc.theme,
      inkColor: '#2a3954',
      scarfColor: '#3a7ce0',
      maxHp: Math.round(56 * hpScale),
      difficulty: Math.max(0.3, diff - 0.12),
      aggression: 0.58,
      parrySkill: 0.16,
      dodgeSkill: 0.2,
    };
    return {
      wave,
      title: `第 ${wave} 波 · 头目突袭`,
      stage: loc.stage,
      theme: loc.theme,
      enemies: wave >= 6 ? [boss, guard] : [boss],
    };
  }

  const count = wave === 1 ? 2 : wave >= 5 ? 3 : 2;
  const palette: Array<[string, string, string]> = [
    ['铅笔涂鸦兵', '#3e4452', '#6d7a8f'],
    ['圆珠笔小将', '#1b3f82', '#2678e6'],
    ['荧光疾走兵', '#166348', '#14b87a'],
    ['红笔课代表', '#8f1b1b', '#e03636'],
  ];

  const enemies: ArcadeMaster[] = [];
  for (let i = 0; i < count; i++) {
    const [name, ink, scarf] = palette[(wave + i) % palette.length];
    const wep = MINION_WEAPONS[(wave * 3 + i * 5) % MINION_WEAPONS.length];
    enemies.push({
      id: `rogue_${wave}_${i}`,
      stageIndex: wave,
      name: `${name} ${i + 1}号`,
      title: `第 ${wave} 波涂鸦大军`,
      quote: '',
      weapon: wep,
      stage: loc.stage,
      theme: loc.theme,
      inkColor: ink,
      scarfColor: scarf,
      maxHp: Math.round((52 + i * 8) * hpScale),
      difficulty: Math.min(0.68, diff - (count >= 3 ? 0.12 : 0.05) + i * 0.04),
      aggression: 0.5 + i * 0.08,
      parrySkill: Math.min(0.22, 0.08 + wave * 0.025),
      dodgeSkill: Math.min(0.28, 0.12 + wave * 0.03),
    });
  }

  return {
    wave,
    title: `第 ${wave} 波 · ${count} 敌围攻`,
    stage: loc.stage,
    theme: loc.theme,
    enemies,
  };
}
