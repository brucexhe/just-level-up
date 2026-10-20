import Phaser from 'phaser';
import { attackIntervalMs, computeDamage, moveSpeed } from '../../core/formulas';
import {
  aggregatedStats,
  allocateAttrPoint,
  createInitialState,
  equipItem,
  gainExp,
  maxHp,
  maxMp,
  restoreHp,
  restoreMp,
  spendMp,
  type GameState,
} from '../../state/gameState';
import { dropEquipment, totalPoints } from '../../core/equipment';
import { goldDrop } from '../../core/economy';
import { expToNext, isBreakthrough, killExp } from '../../core/progression';
import { createMonster, type Combatant } from '../combat';
import {
  bakeGrass,
  bakeMonsters,
  bakePlayer,
  bakeProps,
  bakeSimple,
  skinForLevel,
} from '../assets';
import {
  FIREBALL_MULT,
  FIREBALL_RADIUS,
  FIREBALL_SPEED,
  FRENZY_DURATION_MS,
  FRENZY_INTERVAL_MULT,
  SKILLS,
} from '../skills';
import type { BaseAttr } from '../../core/types';

const MAP_SIZE = 2000;
const ATTACK_RANGE = 90;
const MONSTER_COUNT = 8;
const REGEN_PER_SEC = 1;

const ATTR_KEYS: BaseAttr[] = [
  'hp',
  'mp',
  'pAtk',
  'mAtk',
  'pDef',
  'mDef',
  'speed',
  'agi',
  'luck',
];
const ATTR_ZH: Record<BaseAttr, string> = {
  hp: '血量',
  mp: '法力',
  pAtk: '物攻',
  mAtk: '法攻',
  pDef: '物防',
  mDef: '法防',
  speed: '速度',
  agi: '敏捷',
  luck: '幸运',
};

interface MonsterView {
  data: Combatant;
  sprite: Phaser.Physics.Arcade.Sprite;
  hpBg: Phaser.GameObjects.Image;
  hpFg: Phaser.GameObjects.Image;
  nextAttackAt: number;
  knockUntil: number;
}

interface SkillSlot {
  def: (typeof SKILLS)[number];
  readyAt: number;
  cdOverlay: Phaser.GameObjects.Rectangle;
  cdText: Phaser.GameObjects.Text;
  root: Phaser.GameObjects.Container;
}

export class StageBattleScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private state!: GameState;
  private monsterLevel = 1;
  private playerNextAttackAt = 0;
  private frenzyUntil = 0;
  private monsters: MonsterView[] = [];
  private monsterGroup!: Phaser.Physics.Arcade.Group;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private regenAt = 0;
  private toastList: { text: Phaser.GameObjects.Text }[] = [];

  // HUD
  private hudLevel!: Phaser.GameObjects.Text;
  private hudKills!: Phaser.GameObjects.Text;
  private hpFg!: Phaser.GameObjects.Image;
  private hpText!: Phaser.GameObjects.Text;
  private mpFg!: Phaser.GameObjects.Image;
  private expFg!: Phaser.GameObjects.Image;
  private expText!: Phaser.GameObjects.Text;
  private hudGold!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Graphics;
  private skillSlots: SkillSlot[] = [];
  private statsPanel!: Phaser.GameObjects.Container;
  private statRows: Record<string, { value: Phaser.GameObjects.Text; add: Phaser.GameObjects.Text }> = {};
  private statsPoints!: Phaser.GameObjects.Text;

  constructor() {
    super('StageBattle');
  }

  create() {
    this.state = createInitialState();
    this.physics.world.setBounds(0, 0, MAP_SIZE, MAP_SIZE);

    bakeSimple(this);
    bakeGrass(this);
    bakePlayer(this);
    bakeMonsters(this);
    bakeProps(this);
    this.createAnims();

    this.add.tileSprite(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE, MAP_SIZE, 'grass').setDepth(-10);
    this.add
      .rectangle(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE, MAP_SIZE)
      .setStrokeStyle(8, 0x1a2a1e)
      .setDepth(-9);

    this.buildObstacles();

    this.shadow = this.add.image(0, 0, 'shadow').setScale(1.4, 1).setDepth(4);
    this.player = this.physics.add.sprite(MAP_SIZE / 2, MAP_SIZE / 2, 'player-a');
    this.player.setScale(3).setCollideWorldBounds(true).setDepth(5);
    this.player.play('walk-player');

    this.monsterGroup = this.physics.add.group();
    for (let i = 0; i < MONSTER_COUNT; i++) this.spawnMonster();

    this.physics.add.collider(this.player, this.obstacles);
    this.physics.add.collider(this.monsterGroup, this.obstacles);
    this.physics.add.collider(this.monsterGroup, this.monsterGroup);
    this.physics.add.collider(this.player, this.monsterGroup);

    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.setupInput();
    this.buildHud();

    (window as unknown as Record<string, unknown>).__demo = {
      snapshot: () => this.snapshot(),
      pos: () => ({ x: Math.round(this.player.x), y: Math.round(this.player.y) }),
      tp: (x: number, y: number) => this.player.setPosition(x, y),
      step: (n: number) => {
        let t = performance.now();
        for (let i = 0; i < n; i++) {
          t += 16.666;
          this.game.loop.step(t);
        }
      },
      nearest: () => {
        const m = this.monsters.find((v) => v.sprite.active);
        return m
          ? { x: Math.round(m.sprite.x), y: Math.round(m.sprite.y), level: m.data.level }
          : null;
      },
    };
  }

  private createAnims() {
    const mk = (key: string, a: string, b: string) => {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: [{ key: a }, { key: b }],
          frameRate: 5,
          repeat: -1,
        });
      }
    };
    mk('walk-player', 'player-a', 'player-b');
    mk('walk-slime', 'slime-a', 'slime-b');
    mk('walk-goblin', 'goblin-a', 'goblin-b');
    mk('walk-ogre', 'ogre-a', 'ogre-b');
  }

  private buildObstacles() {
    this.obstacles = this.physics.add.staticGroup();
    const rnd = new Phaser.Math.RandomDataGenerator(['stage1']);
    let placed = 0;
    let guard = 0;
    while (placed < 26 && guard++ < 300) {
      const x = rnd.between(120, MAP_SIZE - 120);
      const y = rnd.between(120, MAP_SIZE - 120);
      if (Phaser.Math.Distance.Between(x, y, MAP_SIZE / 2, MAP_SIZE / 2) < 260) continue;
      const kind = rnd.pick(['rock', 'bush', 'tree', 'tree', 'bush']);
      const s = this.obstacles.create(x, y, kind);
      s.setScale(3);
      s.setDepth(y).refreshBody();
      placed++;
    }
  }

  private spawnMonster() {
    const level = this.monsterLevel;
    const skin = skinForLevel(level);
    let x = 0;
    let y = 0;
    for (let i = 0; i < 30; i++) {
      x = Phaser.Math.Between(120, MAP_SIZE - 120);
      y = Phaser.Math.Between(120, MAP_SIZE - 120);
      if (Phaser.Math.Distance.Between(x, y, this.player?.x ?? 0, this.player?.y ?? 0) > 420) break;
    }
    const sprite = this.monsterGroup.create(x, y, `${skin}-a`) as Phaser.Physics.Arcade.Sprite;
    sprite.setScale(3).setDepth(y).play(`walk-${skin}`);
    sprite.setData('skin', skin);

    const hpBg = this.add.image(x, y - 34, 'bar').setDisplaySize(34, 5).setTint(0x000000).setDepth(y + 1).setAlpha(0.7).setVisible(false);
    const hpFg = this.add.image(x - 17, y - 34, 'bar').setOrigin(0, 0.5).setDisplaySize(34, 5).setTint(0xe05656).setDepth(y + 1).setVisible(false);

    const view: MonsterView = {
      data: createMonster(level),
      sprite,
      hpBg,
      hpFg,
      nextAttackAt: 0,
      knockUntil: 0,
    };
    sprite.setData('view', view);
    this.monsters.push(view);
  }

  // ---------- 输入 ----------

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as unknown as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.keyboard!.addCapture('TAB,Q,E,SPACE');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.castFireball(p);
      else this.tryMelee();
    });
    this.input.keyboard!.on('keydown-SPACE', () => this.tryMelee());
    this.input.keyboard!.on('keydown-Q', () => this.castFireball(this.input.activePointer));
    this.input.keyboard!.on('keydown-E', () => this.castFrenzy());
    this.input.keyboard!.on('keydown-TAB', () => {
      this.statsPanel.setVisible(!this.statsPanel.visible);
    });
    this.input.keyboard!.on('keydown-F', () => this.autoEquipBest());

    const numKeys = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
      Phaser.Input.Keyboard.KeyCodes.NINE,
    ];
    numKeys.forEach((kc, i) => {
      this.input.keyboard!.on(`keydown-${kc}`, () => {
        if (allocateAttrPoint(this.state, ATTR_KEYS[i])) {
          this.addToast(`+1 ${ATTR_ZH[ATTR_KEYS[i]]}`, '#7ee787');
          this.refreshStatsPanel();
        }
      });
    });
  }

  // ---------- HUD ----------

  private buildHud() {
    const W = this.scale.width;

    this.add.rectangle(150, 60, 300, 110, 0x0a0e14, 0.72).setOrigin(0.5).setScrollFactor(0).setDepth(900);
    this.hudLevel = this.text(12, 10, '', '#ffd93d', 18).setScrollFactor(0).setDepth(901);
    this.hudKills = this.text(200, 12, '', '#9aa4b2', 13).setScrollFactor(0).setDepth(901);

    this.add.image(20, 46, 'bar').setOrigin(0, 0.5).setDisplaySize(240, 12).setTint(0x23301f).setScrollFactor(0).setDepth(901);
    this.hpFg = this.add.image(20, 46, 'bar').setOrigin(0, 0.5).setDisplaySize(240, 12).setTint(0x38d05a).setScrollFactor(0).setDepth(902);
    this.hpText = this.text(24, 40, '', '#eaffef', 12).setScrollFactor(0).setDepth(903);

    this.add.image(20, 64, 'bar').setOrigin(0, 0.5).setDisplaySize(200, 10).setTint(0x1c2a3a).setScrollFactor(0).setDepth(901);
    this.mpFg = this.add.image(20, 64, 'bar').setOrigin(0, 0.5).setDisplaySize(200, 10).setTint(0x3a8ad0).setScrollFactor(0).setDepth(902);

    this.add.image(20, 80, 'bar').setOrigin(0, 0.5).setDisplaySize(240, 6).setTint(0x2c2a20).setScrollFactor(0).setDepth(901);
    this.expFg = this.add.image(20, 80, 'bar').setOrigin(0, 0.5).setDisplaySize(240, 6).setTint(0xe8c84a).setScrollFactor(0).setDepth(902);
    this.expText = this.text(24, 74, '', '#f5e6b8', 10).setScrollFactor(0).setDepth(903);
    this.hudGold = this.text(12, 90, '', '#e8c84a', 13).setScrollFactor(0).setDepth(901);

    // 技能栏
    const barX = W / 2 - (SKILLS.length - 1) * 30;
    SKILLS.forEach((def, i) => {
      const x = barX + i * 60;
      const root = this.add.container(x, this.scale.height - 44).setScrollFactor(0).setDepth(905);
      const bg = this.add.image(0, 0, 'slot').setTint(0x11161f);
      const icon = this.text(0, -2, def.icon, '#ffffff', 20);
      const key = this.text(14, 12, def.hotkey, '#9aa4b2', 9);
      const cost = def.mpCost > 0 ? this.text(-14, 12, `${def.mpCost}MP`, '#6ab0f3', 9) : this.text(0, 12, '', '#fff', 9);
      const cdOverlay = this.add.rectangle(0, 0, 46, 46, 0x000000, 0.7).setOrigin(0.5);
      const cdText = this.text(0, 0, '', '#ffffff', 13);
      root.add([bg, icon, key, cost, cdOverlay, cdText]);
      root.setSize(48, 48).setInteractive({ useHandCursor: true });
      root.on('pointerdown', () => {
        if (def.id === 'attack') this.tryMelee();
        else if (def.id === 'fireball') this.castFireball(this.input.activePointer);
        else this.castFrenzy();
      });
      this.skillSlots.push({ def, readyAt: 0, cdOverlay, cdText, root });
    });

    // 小地图
    this.add.rectangle(W - 88, 88, 156, 156, 0x0a0e14, 0.72).setScrollFactor(0).setDepth(900);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(901);
    this.text(W - 160, 10, '第 1 关 · 草原', '#9aa4b2', 12).setScrollFactor(0).setDepth(901);

    this.buildStatsPanel();
    this.text(12, this.scale.height - 18, 'WASD移动 · 左键普攻 · Q/右键火球 · E狂暴 · Tab加点 · F穿装', '#5a6472', 11).setScrollFactor(0).setDepth(900);
  }

  private buildStatsPanel() {
    const W = this.scale.width;
    this.statsPanel = this.add.container(W - 300, 170).setScrollFactor(0).setDepth(940).setVisible(false);
    const bg = this.add.rectangle(0, 0, 290, 350, 0x0a0e14, 0.94).setOrigin(0, 0);
    this.statsPanel.add(bg);
    this.statsPanel.add(this.text(14, 10, '角色加点', '#ffd93d', 16));
    this.statsPoints = this.text(14, 34, '', '#7ee787', 12);
    this.statsPanel.add(this.statsPoints);

    ATTR_KEYS.forEach((attr, i) => {
      const y = 60 + i * 26;
      const label = this.text(14, y, ATTR_ZH[attr], '#c8d0e0', 13);
      const value = this.text(110, y, '', '#ffffff', 13);
      const add = this.text(240, y, '[+]', '#7ee787', 14).setInteractive({ useHandCursor: true });
      add.on('pointerdown', () => {
        if (allocateAttrPoint(this.state, attr)) {
          this.addToast(`+1 ${ATTR_ZH[attr]}`, '#7ee787');
          this.refreshStatsPanel();
        } else {
          this.addToast('属性点不足', '#ff8a8a');
        }
      });
      this.statRows[attr] = { value, add };
      this.statsPanel.add([label, value, add]);
    });
    this.refreshStatsPanel();
  }

  private refreshStatsPanel() {
    const stats = this.baseOnlyStats();
    for (const attr of ATTR_KEYS) {
      const row = this.statRows[attr];
      if (!row) continue;
      const v = stats[attr] ?? 0;
      row.value.setText(`${v}`);
      row.add.setColor(this.state.attrPoints > 0 ? '#7ee787' : '#4a5568');
    }
    this.statsPoints.setText(
      `可用属性点 ${this.state.attrPoints}  ·  装备点 ${this.state.equipPoints}  ·  金币 ${this.state.gold}`,
    );
  }

  private baseOnlyStats() {
    return this.state.baseStats;
  }

  private text(x: number, y: number, s: string, color: string, size: number) {
    return this.add.text(x, y, s, {
      fontFamily: 'ui-monospace, monospace',
      fontSize: `${size}px`,
      color,
    });
  }

  private addToast(msg: string, color = '#e8e8e8') {
    const baseY = this.scale.height - 130;
    this.toastList.forEach((t, i) => {
      t.text.y = baseY - (this.toastList.length - i) * 22;
    });
    const text = this.text(14, baseY, msg, color, 13).setScrollFactor(0).setDepth(930).setAlpha(0);
    this.toastList.push({ text });
    this.tweens.add({ targets: text, alpha: 1, duration: 120 });
    this.tweens.add({
      targets: text,
      alpha: 0,
      delay: 2400,
      duration: 500,
      onComplete: () => {
        this.toastList = this.toastList.filter((t) => t.text !== text);
        text.destroy();
      },
    });
  }

  // ---------- 战斗 ----------

  private meleeInterval() {
    const stats = aggregatedStats(this.state);
    const base = attackIntervalMs(stats.agi ?? 0);
    return this.time.now < this.frenzyUntil ? base * FRENZY_INTERVAL_MULT : base;
  }

  private tryMelee(time: number = this.time.now) {
    if (time < this.playerNextAttackAt) return;
    const target = this.nearestMonster();
    if (!target) return;
    this.playerNextAttackAt = time + this.meleeInterval();

    const stats = aggregatedStats(this.state);
    const dmg = computeDamage({
      attack: stats.pAtk ?? 1,
      defense: target.data.stats.pDef ?? 0,
      attackerLevel: this.state.level,
    });
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      target.sprite.x,
      target.sprite.y,
    );
    this.slashEffect(angle);
    this.tweens.add({
      targets: this.player,
      scaleX: 3.25,
      scaleY: 3.25,
      duration: 60,
      yoyo: true,
    });
    this.applyDamage(target, dmg, angle);
  }

  private castFireball(pointer: Phaser.Input.Pointer) {
    const slot = this.skillSlots.find((s) => s.def.id === 'fireball')!;
    const now = this.time.now;
    if (now < slot.readyAt) return;
    if (!spendMp(this.state, slot.def.mpCost)) {
      this.addToast('法力不足', '#6ab0f3');
      return;
    }
    slot.readyAt = now + slot.def.cdMs;

    const stats = aggregatedStats(this.state);
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      pointer.worldX,
      pointer.worldY,
    );
    const fb = this.physics.add.image(this.player.x, this.player.y, 'fireball');
    fb.setScale(2.5).setDepth(6).setRotation(angle);
    this.physics.velocityFromRotation(angle, FIREBALL_SPEED, fb.body!.velocity);

    const trail = this.add.particles(0, 0, 'dot', {
      follow: fb,
      speed: { min: 10, max: 40 },
      lifespan: 260,
      scale: { start: 1.4, end: 0 },
      tint: [0xff8a2a, 0xffd23a],
      alpha: { start: 0.9, end: 0 },
    });
    trail.setDepth(5);

    this.physics.add.overlap(fb, this.monsterGroup, (fbObj) => {
      this.explodeFireball(fb, trail, stats.mAtk ?? 1);
      fbObj.destroy();
    });
    this.time.delayedCall(2200, () => {
      trail.destroy();
      fb.destroy();
    });
  }

  private explodeFireball(fb: Phaser.Physics.Arcade.Image, trail: Phaser.GameObjects.Particles.ParticleEmitter, mAtk: number) {
    trail.stop();
    trail.destroy();
    const px = fb.x;
    const py = fb.y;
    fb.destroy();

    const burst = this.add.particles(px, py, 'dot', {
      speed: { min: 80, max: 220 },
      lifespan: 420,
      scale: { start: 2.2, end: 0 },
      tint: [0xff8a2a, 0xffd23a, 0xd84a1a],
      emitting: false,
    });
    burst.explode(26);
    burst.setDepth(7);
    this.time.delayedCall(600, () => burst.destroy());

    this.cameras.main.shake(90, 0.005);

    for (const m of [...this.monsters]) {
      const d = Phaser.Math.Distance.Between(px, py, m.sprite.x, m.sprite.y);
      if (d > FIREBALL_RADIUS) continue;
      const dmg = computeDamage({
        attack: mAtk * FIREBALL_MULT,
        defense: m.data.stats.mDef ?? 0,
        attackerLevel: this.state.level,
      });
      const angle = Phaser.Math.Angle.Between(px, py, m.sprite.x, m.sprite.y);
      this.applyDamage(m, dmg, angle);
    }
  }

  private castFrenzy() {
    const slot = this.skillSlots.find((s) => s.def.id === 'frenzy')!;
    const now = this.time.now;
    if (now < slot.readyAt) return;
    if (!spendMp(this.state, slot.def.mpCost)) {
      this.addToast('法力不足', '#6ab0f3');
      return;
    }
    slot.readyAt = now + slot.def.cdMs;
    this.frenzyUntil = now + FRENZY_DURATION_MS;
    this.player.setTint(0xffb060);
    this.time.delayedCall(FRENZY_DURATION_MS, () => this.player.clearTint());
    const ring = this.add.image(this.player.x, this.player.y, 'ring').setTint(0xffb060).setScale(0.6).setAlpha(0.9).setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: 2.4,
      alpha: 0,
      duration: 400,
      onComplete: () => ring.destroy(),
    });
    this.addToast('狂暴！攻速提升', '#ffb060');
  }

  private nearestMonster(): MonsterView | null {
    let best: MonsterView | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      const d = Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, this.player.x, this.player.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return bestD <= ATTACK_RANGE ? best : null;
  }

  private applyDamage(m: MonsterView, dmg: number, angle: number) {
    m.data.hp -= dmg;
    this.floatText(m.sprite.x, m.sprite.y - 30, `${dmg}`, '#ffd93d', dmg >= m.data.maxHp * 0.5 ? 24 : 17);
    m.sprite.setTintFill(0xffffff);
    m.sprite.setVelocity(Math.cos(angle) * 130, Math.sin(angle) * 130);
    m.knockUntil = this.time.now + 130;
    this.time.delayedCall(90, () => {
      if (m.sprite.active) m.sprite.clearTint();
    });
    m.hpBg.setVisible(true);
    m.hpFg.setVisible(true);
    const ratio = Phaser.Math.Clamp(m.data.hp / m.data.maxHp, 0, 1);
    m.hpFg.setDisplaySize(34 * ratio, 5);
    if (m.data.hp <= 0) this.killMonster(m);
  }

  private killMonster(m: MonsterView) {
    const ml = m.data.level;
    const px = m.sprite.x;
    const py = m.sprite.y;
    m.hpBg.destroy();
    m.hpFg.destroy();
    m.sprite.destroy();
    this.monsters = this.monsters.filter((x) => x !== m);

    const burst = this.add.particles(px, py, 'dot', {
      speed: { min: 60, max: 180 },
      lifespan: 500,
      scale: { start: 2, end: 0 },
      tint: [0xe05656, 0xffffff],
      emitting: false,
    });
    burst.setDepth(7);
    burst.explode(18);
    this.time.delayedCall(650, () => burst.destroy());
    this.cameras.main.shake(70, 0.004);

    // 结算
    const before = this.state.level;
    gainExp(this.state, killExp(ml));
    const gold = goldDrop(ml);
    this.state.gold += gold;
    this.state.kills += 1;
    this.state.highestMonsterLevel = Math.max(this.state.highestMonsterLevel, ml);
    const drop = dropEquipment(ml);
    this.state.inventory.push(drop);
    this.flyCoins(px, py, gold);
    this.addToast(
      `击杀 Lv${ml} ${skinForLevel(ml) === 'slime' ? '史莱姆' : skinForLevel(ml) === 'goblin' ? '哥布林' : '食人魔'} · +${killExp(ml)}exp +${gold}金币 · 掉落${drop.name}`,
      '#9ad06a',
    );
    if (this.state.level > before) this.levelUpFx(before);

    this.monsterLevel += 1;
    this.time.delayedCall(1200, () => this.spawnMonster());
  }

  private flyCoins(px: number, py: number, _gold: number) {
    for (let i = 0; i < 3; i++) {
      const coin = this.add.image(px + Phaser.Math.Between(-14, 14), py + Phaser.Math.Between(-14, 14), 'coin').setScale(2).setDepth(8);
      this.tweens.add({
        targets: coin,
        x: this.player.x,
        y: this.player.y,
        duration: 380 + i * 90,
        ease: 'Cubic.In',
        onComplete: () => coin.destroy(),
      });
    }
  }

  private levelUpFx(before: number) {
    const ring = this.add.image(this.player.x, this.player.y, 'ring').setTint(0xffd93d).setScale(0.5).setAlpha(1).setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: 2.8,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
    const t = this.text(this.player.x, this.player.y - 60, `升级! Lv${this.state.level}`, '#ffd93d', 22)
      .setOrigin(0.5)
      .setDepth(9);
    this.tweens.add({
      targets: t,
      y: t.y - 40,
      alpha: 0,
      duration: 900,
      onComplete: () => t.destroy(),
    });
    this.cameras.main.flash(120, 255, 220, 120);
    this.addToast(
      `Lv${before} → Lv${this.state.level}，+${this.state.level - before}属性点${isBreakthrough(this.state.level) ? '（可进阶!）' : ''}`,
      '#ffd93d',
    );
    this.refreshStatsPanel();
  }

  private autoEquipBest() {
    if (this.state.inventory.length === 0) {
      this.addToast('背包为空', '#9aa4b2');
      return;
    }
    const pool = [...this.state.inventory].sort((a, b) => totalPoints(b) - totalPoints(a));
    let equippedCount = 0;
    for (const item of pool) {
      const cur = this.state.equipped[item.slot];
      if (!cur || totalPoints(item) > totalPoints(cur)) {
        equipItem(this.state, item);
        equippedCount++;
      }
    }
    this.addToast(
      equippedCount > 0 ? `穿戴 ${equippedCount} 件装备，战力提升` : '当前装备已是最优',
      '#7ee787',
    );
    this.refreshStatsPanel();
  }

  private slashEffect(angle: number) {
    const arc = this.add.image(
      this.player.x + Math.cos(angle) * 34,
      this.player.y + Math.sin(angle) * 34,
      'slash',
    );
    arc.setRotation(angle).setScale(3).setTint(0xfff2c8).setAlpha(0.95).setDepth(6);
    this.tweens.add({
      targets: arc,
      alpha: 0,
      scale: 3.8,
      duration: 130,
      onComplete: () => arc.destroy(),
    });
  }

  private floatText(x: number, y: number, s: string, color: string, size: number) {
    const t = this.text(x, y, s, color, size).setOrigin(0.5).setDepth(8);
    this.tweens.add({
      targets: t,
      y: y - 46,
      alpha: 0,
      duration: 680,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  private snapshot() {
    const alive = this.monsters.filter((m) => m.sprite.active).length;
    return {
      level: this.state.level,
      exp: this.state.exp,
      expNext: expToNext(this.state.level),
      hp: Math.max(0, Math.round(this.state.hp)),
      maxHp: maxHp(this.state),
      mp: Math.round(this.state.mp),
      maxMp: maxMp(this.state),
      gold: this.state.gold,
      attrPoints: this.state.attrPoints,
      equipPoints: this.state.equipPoints,
      kills: this.state.kills,
      inventory: this.state.inventory.length,
      monsterLevel: this.monsterLevel,
      monstersAlive: alive,
    };
  }

  // ---------- 主循环 ----------

  update(time: number) {
    const stats = aggregatedStats(this.state);
    const speed = moveSpeed(stats.speed ?? 0);
    const vx =
      (this.cursors.right.isDown || this.wasd.D.isDown ? 1 : 0) -
      (this.cursors.left.isDown || this.wasd.A.isDown ? 1 : 0);
    const vy =
      (this.cursors.down.isDown || this.wasd.S.isDown ? 1 : 0) -
      (this.cursors.up.isDown || this.wasd.W.isDown ? 1 : 0);
    this.player.setVelocity(vx * speed, vy * speed);
    if (vx !== 0 && vy !== 0) {
      (this.player.body!.velocity as Phaser.Math.Vector2).scale(0.7071);
    }
    if (vx !== 0) this.player.setFlipX(vx < 0);
    if (vx !== 0 || vy !== 0) {
      if (!this.player.anims.isPlaying) this.player.play('walk-player');
    } else if (this.player.anims.isPlaying) {
      this.player.anims.stop();
      this.player.setTexture('player-a');
    }
    this.shadow.setPosition(this.player.x, this.player.y + 26);
    this.player.setDepth(this.player.y);
    this.shadow.setDepth(this.player.y - 0.1);

    if (time >= this.regenAt) {
      this.regenAt = time + 1000;
      restoreHp(this.state, REGEN_PER_SEC);
      restoreMp(this.state, REGEN_PER_SEC);
    }

    if (time >= this.playerNextAttackAt) this.tryMelee(time);

    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      m.sprite.setDepth(m.sprite.y);
      m.hpBg.setPosition(m.sprite.x, m.sprite.y - 36);
      m.hpFg.setPosition(m.sprite.x - 17, m.sprite.y - 36);
      if (time < m.knockUntil) continue;
      if (!m.data.aggressive) {
        m.sprite.setVelocity(0, 0);
        if (m.sprite.anims.isPlaying) m.sprite.anims.stop();
        continue;
      }
      const d = Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, this.player.x, this.player.y);
      const ms = moveSpeed(m.data.stats.speed ?? 0) * 0.55;
      if (d > ATTACK_RANGE * 0.75) {
        const ang = Phaser.Math.Angle.Between(m.sprite.x, m.sprite.y, this.player.x, this.player.y);
        m.sprite.setVelocity(Math.cos(ang) * ms, Math.sin(ang) * ms);
        m.sprite.setFlipX(Math.cos(ang) < 0);
      } else {
        m.sprite.setVelocity(0, 0);
        if (time >= m.nextAttackAt) {
          this.monsterAttack(m);
          m.nextAttackAt = time + attackIntervalMs(m.data.stats.agi ?? 0);
        }
      }
    }

    this.updateHud();
  }

  private monsterAttack(m: MonsterView) {
    const stats = aggregatedStats(this.state);
    const dmg = computeDamage({
      attack: m.data.stats.pAtk ?? 1,
      defense: stats.pDef ?? 0,
      attackerLevel: m.data.level,
    });
    this.state.hp -= dmg;
    this.floatText(this.player.x, this.player.y - 40, `-${dmg}`, '#ff6b6b', 16);
    this.cameras.main.shake(60, 0.003);
    if (this.state.hp <= 0) {
      this.state.hp = maxHp(this.state);
      this.state.mp = maxMp(this.state);
      this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
      this.cameras.main.flash(400, 200, 0, 0);
      this.addToast(`被 Lv${m.data.level} 怪击杀，已回城复活`, '#ff6b6b');
    }
  }

  private updateHud() {
    const s = this.state;
    const mhp = maxHp(s);
    const mmp = maxMp(s);
    this.hudLevel.setText(`Lv ${s.level}`);
    this.hudKills.setText(`击杀 ${s.kills}`);
    this.hpFg.setDisplaySize(240 * Phaser.Math.Clamp(s.hp / mhp, 0, 1), 12);
    this.hpText.setText(`${Math.max(0, Math.round(s.hp))} / ${mhp}`);
    this.mpFg.setDisplaySize(200 * Phaser.Math.Clamp(s.mp / Math.max(1, mmp), 0, 1), 10);
    const next = expToNext(s.level);
    this.expFg.setDisplaySize(240 * Phaser.Math.Clamp(s.exp / next, 0, 1), 6);
    this.expText.setText(`EXP ${s.exp}/${next}`);
    this.hudGold.setText(
      `金币 ${s.gold} · 属性点 ${s.attrPoints} · 装备点 ${s.equipPoints} · 背包 ${s.inventory.length}`,
    );

    const now = this.time.now;
    for (const slot of this.skillSlots) {
      const remain = slot.readyAt - now;
      if (remain > 0) {
        const ratio = Phaser.Math.Clamp(remain / slot.def.cdMs, 0, 1);
        slot.cdOverlay.setVisible(true).setSize(46, 46 * ratio);
        slot.cdText.setText(remain > 1000 ? `${Math.ceil(remain / 1000)}s` : '·').setVisible(true);
      } else {
        slot.cdOverlay.setVisible(false);
        slot.cdText.setVisible(false);
      }
      if (slot.def.mpCost > 0) {
        const poor = s.mp < slot.def.mpCost;
        slot.cdText.setColor(poor && remain <= 0 ? '#ff8a8a' : '#ffffff');
      }
    }

    this.drawMinimap();
  }

  private drawMinimap() {
    const g = this.minimap;
    const W = this.scale.width;
    const size = 140;
    const ox = W - 80 - size / 2;
    const oy = 80;
    g.clear();
    g.lineStyle(2, 0x334455, 1).strokeRect(ox - size / 2, oy - size / 2, size, size);
    const toMap = (v: number) => ox - size / 2 + (v / MAP_SIZE) * size;
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      g.fillStyle(m.data.aggressive ? 0xe05656 : 0x9a6ae0, 1);
      g.fillRect(toMap(m.sprite.x) - 2, toMap(m.sprite.y) - 2, 4, 4);
    }
    g.fillStyle(0xffffff, 1);
    g.fillRect(toMap(this.player.x) - 3, toMap(this.player.y) - 3, 6, 6);
  }
}

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 960,
  height: 600,
  backgroundColor: '#10141a',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [StageBattleScene],
};
