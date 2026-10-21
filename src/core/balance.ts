export const BALANCE = {
  /**
   * 升级经验曲线：从 L 升到 L+1 需要 `EXP_BASE × L^EXP_POW` 点经验。
   *
   * 为什么不是线性的：怪给的经验 = 怪等级 ≈ 玩家等级 L，
   * 如果需求也是 ∝L，那"几只怪升一级"就是个常数，等级再高也感觉不到变难
   * （旧公式 expToNext=L+1 就是 1 只怪 1 级）。需求必须比 L 长得快。
   *
   * 为什么不是真·指数：×1.01^L 到 1 万级时单级需求 ≈ 8e43，
   * 而一次击杀只给 1e4，等于 8e39 杀升一级 —— 完全是死路，
   * 而且违背 PLAN.md 里"禁止复利乘法成长"的红线。
   *
   * 取幂律 1.5 次方（= 累积经验 ∝ L^2.5），正好落在主流 RPG 区间：
   * 魔兽 ≈ L^2.1、RuneScape ≈ L^2.5、最终幻想 ≈ L^2~L^3。
   * 杀同级怪升级所需只数 ≈ 5×√L：Lv1→5 只、Lv10→16 只、
   * Lv100→50 只、Lv1000→159 只、Lv10000→500 只。
   */
  EXP_BASE: 5,
  EXP_POW: 1.5,
  /**
   * 减伤公式的常数项：减伤 = 防御 / (防御 + MIT_K0 + MIT_KD × 攻击方等级)
   * 之前是 K0(100) × 攻击方等级 —— 10 级怪的分母就有 1000，
   * 5 点防御只减伤 0.5%，等于完全没用。现在改成「常数 + 很小的等级项」，
   * 前期防御就有手感，后期靠 MIT_CAP 封顶防止堆防御无敌。
   */
  MIT_K0: 12,
  MIT_KD: 1.5,
  /** 减伤上限（防止后期堆防御到免伤） */
  MIT_CAP: 0.65,
  /**
   * 怪物血量 / 防御的**超线性**指数：等级越高，怪的成长快过角色。
   * 角色是线性成长（每级全属性 +1），所以后期同级怪会越来越硬、越来越难打，
   * 只能靠装备补属性 —— 装备点数 ≈ 怪等级 × 10 个部位，才是后期的主属性来源。
   */
  MONSTER_HP_EXP: 1.25,
  MONSTER_DEF_EXP: 1.1,
  /**
   * 怪物物攻系数：怪物物攻 = 1 + 等级 × 本系数。
   * 之前是 1:1（10 级怪攻 10），但人物血量不会随等级自动成长（只能拿点数加），
   * 前期两下就残血；砍到一半后 10 级怪攻 6，40 血能扛十来下。
   */
  MONSTER_ATK_SCALE: 0.5,
  K0: 100,
  HP_PER_POINT: 1,
  MP_PER_POINT: 1,
  H0: 100,
  AGI0: 100,
  SPD0: 100,
  BASE_MOVE_SPEED: 100,
  BASE_ATTACK_INTERVAL: 1000,
  CRIT_DMG_BASE: 1.5,
  CDR_MAX: 0.75,
  HIT_FLOOR: 0.05,
  HIT_CAP: 1.0,
  POINTS_PER_LEVEL: 1,
  /** 每升 1 级，九项属性各自自动 +1（等级自带的成长，与自由点数无关） */
  ATTR_PER_LEVEL: 1,
  POTION_STEP: 10,
  SELL_REFUND_RATE: 0.5,
  DAMAGE_FLOAT_MIN: 0.95,
  DAMAGE_FLOAT_MAX: 1.05,
  BREAKTHROUGH_LO_SLOPE: 1,
  BREAKTHROUGH_HI_SLOPE: 2,
  /** 普通怪掉装备的概率（与技能书互斥，两者相加 = 总掉率 10%） */
  DROP_EQUIP_CHANCE: 0.06,
  /** 普通怪掉技能书的概率（与装备互斥） */
  DROP_BOOK_CHANCE: 0.04,
  /** BOSS 保底掉几件装备（BOSS 每 10 级才一只，作为里程碑奖励） */
  BOSS_EQUIP_GUARANTEE: 1,
} as const;
