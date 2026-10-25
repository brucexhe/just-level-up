import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 房间公共状态：Colyseus 只把变化的字段增量发给房间里所有人。
 * 私有数据（背包 / 经验 / 点数）不放这里，见 SelfSync 消息。
 */

export const PlayerPub = schema(
  {
    name: t.string(),
    x: t.float32(),
    y: t.float32(),
    hp: t.number(),
    maxHp: t.number(),
    level: t.number(),
    flipX: t.boolean(),
    moving: t.boolean(),
    dead: t.boolean(),
    frenzy: t.boolean(),
    shield: t.boolean(),
  },
  'PlayerPub',
);
export type PlayerPub = SchemaType<typeof PlayerPub>;

export const MonsterPub = schema(
  {
    level: t.number(),
    isBoss: t.boolean(),
    name: t.string(),
    x: t.float32(),
    y: t.float32(),
    hp: t.number(),
    maxHp: t.number(),
    flipX: t.boolean(),
    moving: t.boolean(),
    aggressive: t.boolean(),
    poisoned: t.boolean(),
  },
  'MonsterPub',
);
export type MonsterPub = SchemaType<typeof MonsterPub>;

export const DropPub = schema(
  {
    x: t.float32(),
    y: t.float32(),
    kind: t.string(),
    /** 装备：部位 / 品质；技能书：技能 id */
    slot: t.string(),
    rarity: t.string(),
    skill: t.string(),
    /** 掉落物自身等级（装备 level / 技能书 points） */
    level: t.number(),
    ownerId: t.string(),
    ownerName: t.string(),
    /** 保护期已过：任何人都能捡（只在过期那一刻翻转一次，不每 tick 推剩余时间） */
    free: t.boolean(),
  },
  'DropPub',
);
export type DropPub = SchemaType<typeof DropPub>;

export const FireballPub = schema(
  {
    x: t.float32(),
    y: t.float32(),
    angle: t.float32(),
  },
  'FireballPub',
);
export type FireballPub = SchemaType<typeof FireballPub>;

export const StageState = schema(
  {
    stage: t.number(),
    cycle: t.number(),
    /** 下次整关重刷还剩多少 ms */
    resetLeft: t.number(),
    players: t.map(PlayerPub),
    monsters: t.map(MonsterPub),
    drops: t.map(DropPub),
    fireballs: t.map(FireballPub),
  },
  'StageState',
);
export type StageState = SchemaType<typeof StageState>;
