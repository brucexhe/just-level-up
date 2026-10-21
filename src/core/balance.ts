export const BALANCE = {
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
