import type { SkillDef } from '../skills';

/**
 * 全职业通用技能：狂暴 / 护盾。
 * 所有职业共享同一份定义（热键 E / R 也一致），
 * 各职业文件（mage.ts …）只放本职业专属技能，见 jobSkills()。
 */
export const UNIVERSAL_SKILLS: SkillDef[] = [
  {
    id: 'frenzy',
    name: '狂暴',
    icon: '🌀',
    hotkey: 'E',
    school: 'buff',
    mpCost: 3,
    mpCostGrowth: 0.5,
    cdMs: 60000,
    power: 0.1,
    value: 5000,
    desc: '短时间内提升攻击力与攻击/施法速度。',
  },
  {
    id: 'shield',
    name: '护盾',
    icon: '🛡',
    hotkey: 'R',
    school: 'ward',
    mpCost: 3,
    mpCostGrowth: 0.5,
    // 冷却 = 时长：技能栏上的倒计时就是护盾剩余时间
    cdEqualsDuration: true,
    // 减伤 = 2% + 0.1%/级，Lv281 碰 30% 上限。不封顶的话后期就是免伤
    power: 0.02,
    powerGrowth: 0.001,
    powerCap: 0.3,
    // 时长 = 6s + 0.55s/级，Lv100 碰 60s 上限（CD 同为 60s → 此后常驻）
    value: 6000,
    valueGrowth: 550,
    valueCap: 60000,
    desc: '展开球形护盾（参考魔法盾），短时间内提升物理抗性与法术抗性。',
  },
];
