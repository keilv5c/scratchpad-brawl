import { AudioVisualSettings, CareerStats, FxIntensity, InkSkinId, ShakeLevel, StyleRank } from '../types';

export interface InkSkinDef {
  id: InkSkinId;
  name: string;
  desc: string;
  inkColor: string;
  scarfColor: string;
  rainbow?: boolean;
}

export const INK_SKINS: Record<InkSkinId, InkSkinDef> = {
  classic: {
    id: 'classic',
    name: '2B炭黑 · 红领巾',
    desc: '经典草稿本炭黑笔迹与鲜红飘带',
    inkColor: '#171b24',
    scarfColor: '#dc2f2f',
  },
  gold: {
    id: 'gold',
    name: '黑金钢笔 · 鎏金带',
    desc: '沉稳深黑配满分鎏金拖尾，学霸气场',
    inkColor: '#1f1912',
    scarfColor: '#d99a1e',
  },
  neon: {
    id: 'neon',
    name: '荧光青笔 · 霓虹影',
    desc: '高对比荧光马克笔风，极速疾走手感',
    inkColor: '#0e4a44',
    scarfColor: '#10c488',
  },
  vermilion: {
    id: 'vermilion',
    name: '红批改笔 · 满分红',
    desc: '老师批改试卷专用红笔的凌厉压迫感',
    inkColor: '#8c1616',
    scarfColor: '#ff4238',
  },
  porcelain: {
    id: 'porcelain',
    name: '蓝圆珠笔 · 天空蓝',
    desc: '最经典的蓝圆珠笔涂鸦风格',
    inkColor: '#15346e',
    scarfColor: '#2589f5',
  },
  rainbow: {
    id: 'rainbow',
    name: '十二色彩铅 · 虹彩',
    desc: '随时间流转的彩色铅笔变色飘带！',
    inkColor: '#191b26',
    scarfColor: '#e0367a',
    rainbow: true,
  },
};

export const INK_SKIN_LIST: InkSkinDef[] = [
  INK_SKINS.classic,
  INK_SKINS.gold,
  INK_SKINS.neon,
  INK_SKINS.vermilion,
  INK_SKINS.porcelain,
  INK_SKINS.rainbow,
];

export interface StyleRankMeta {
  rank: StyleRank;
  cn: string;
  sub: string;
  color: string;
  minScore: number;
}

// Teacher's Red Grading Pen Ranks!
export const STYLE_RANKS: StyleRankMeta[] = [
  { rank: 'D', cn: 'C', sub: '涂鸦起步', color: '#5c6473', minScore: 15 },
  { rank: 'C', cn: 'B', sub: '及格过关', color: '#2475c4', minScore: 40 },
  { rank: 'B', cn: 'A', sub: '作业优秀', color: '#1b9664', minScore: 72 },
  { rank: 'A', cn: 'S', sub: '满分答卷!', color: '#d47c11', minScore: 112 },
  { rank: 'S', cn: 'SSS', sub: '满屏红星!!', color: '#d62424', minScore: 160 },
];

export function scoreToStyleRank(score: number): StyleRank {
  if (score >= 160) return 'S';
  if (score >= 112) return 'A';
  if (score >= 72) return 'B';
  if (score >= 40) return 'C';
  if (score >= 15) return 'D';
  return 'none';
}

export function getStyleRankMeta(rank: StyleRank): StyleRankMeta | null {
  return STYLE_RANKS.find((r) => r.rank === rank) ?? null;
}

const SETTINGS_KEY = 'scratchpad_brawl_av_v010';
const CAREER_KEY = 'inkblade_career_v2'; // Keep existing career records seamlessly!

export function loadAudioVisualSettings(): AudioVisualSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioVisualSettings>;
      const validShake: ShakeLevel =
        parsed.shakeLevel === 'off' || parsed.shakeLevel === 'soft' || parsed.shakeLevel === 'strong'
          ? parsed.shakeLevel
          : 'soft';
      const validFx: FxIntensity =
        parsed.fxIntensity === 'eyesafe' ||
        parsed.fxIntensity === 'balanced' ||
        parsed.fxIntensity === 'cinema'
          ? parsed.fxIntensity
          : 'balanced';
      return {
        sfxVolume: typeof parsed.sfxVolume === 'number' ? parsed.sfxVolume : 0.85,
        bgmVolume: typeof parsed.bgmVolume === 'number' ? parsed.bgmVolume : 0.6,
        shakeLevel: validShake,
        fxIntensity: validFx,
        skinId: parsed.skinId && parsed.skinId in INK_SKINS ? parsed.skinId : 'classic',
      };
    }
  } catch {
    // ignore
  }
  return {
    sfxVolume: 0.85,
    bgmVolume: 0.6,
    shakeLevel: 'soft', // Eye-friendly soft shake by default!
    fxIntensity: 'balanced', // Zero-strobe normal combat + epic Super & KO cinematics!
    skinId: 'classic',
  };
}

export function saveAudioVisualSettings(s: AudioVisualSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function loadCareerStats(): CareerStats {
  try {
    const raw = localStorage.getItem(CAREER_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<CareerStats>;
      return {
        totalKOs: p.totalKOs ?? 0,
        totalParries: p.totalParries ?? 0,
        maxCombo: p.maxCombo ?? 0,
        highestWave: p.highestWave ?? 0,
        arcadeClears: p.arcadeClears ?? 0,
        totalClashes: p.totalClashes ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return {
    totalKOs: 0,
    totalParries: 0,
    maxCombo: 0,
    highestWave: 0,
    arcadeClears: 0,
    totalClashes: 0,
  };
}

export function saveCareerStats(c: CareerStats): void {
  try {
    localStorage.setItem(CAREER_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}
