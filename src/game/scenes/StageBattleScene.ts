import Phaser from 'phaser';
import { attackIntervalMs, computeDamage, moveSpeed } from '../../core/formulas';
import {
  aggregatedStats,
  allocateAttrPoint,
  createInitialState,
  equipBest,
  gainExp,
  maxHp,
  maxMp,
  powerScore,
  restoreHp,
  restoreMp,
  skillLevel,
  skillName,
  spendMp,
  type GameState,
} from '../../state/gameState';
import { rollDrops } from '../../core/drops';
import { goldDrop } from '../../core/economy';
import { expToNext, isBreakthrough, killExp } from '../../core/progression';
import { skillMpCost, skillPower, skillValue } from '../../core/skills';
import { stageIndexForLevel } from '../../core/stage';
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
  FIREBALL_SPEED,
  POISON_TICK_MS,
  SKILL_BY_ID,
  type SkillId,
} from '../../data/skills';
import { ATTR_META } from '../../data/attrs';
import { BASE_ATTRS } from '../../core/types';
import { GameUI } from '../../ui';
import type {
  Cooldown,
  MinimapData,
  MinimapMonster,
  SettingsApi,
} from '../../ui/api';
import { audio, type SfxName } from '../audio';
import {
  backupState,
  clearSave,
  loadPrefs,
  loadState,
  restoreBackup,
  savePrefs,
  saveState,
  savedAt,
  backupAt,
} from '../../state/save';

const MAP_SIZE = 2000;
const ATTACK_RANGE = 90;
const MONSTER_COUNT = 10;
const REGEN_PER_SEC = 1;
const STAGE_NAMES = ['草原', '森林', '荒漠', '雪原', '沼泽', '火山', '深渊', '天空'];

const ATTR_KEYS = BASE_ATTRS;
const ATTR_ZH: Record<string, string> = Object.fromEntries(
  BASE_ATTRS.map((k) => [k, ATTR_META[k].name]),
) as Record<string, string>;

interface Dot {
  perTick: number;
  until: number;
  tickAt: number;
}

interface MonsterView {
  data: Combatant;
  sprite: Phaser.Physics.Arcade.Sprite;
  hpBg: Phaser.GameObjects.Image;
  hpFg: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  nextAttackAt: number;
  knockUntil: number;
  dots: Dot[];
  isBoss: boolean;
}

export class StageBattleScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private aura!: Phaser.GameObjects.Image;
  private playerLabel!: Phaser.GameObjects.Text;
  private state!: GameState;
  private monsterLevel = 1;
  private playerNextAttackAt = 0;
  private monsters: MonsterView[] = [];
  private monsterGroup!: Phaser.Physics.Arcade.Group;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private moveTarget: { x: number; y: number } | null = null;
  private attackTarget: MonsterView | null = null;
  private targetRing!: Phaser.GameObjects.Image;
  private steerSince = 0;
  private stuckX = 0;
  private stuckY = 0;
  private regenAt = 0;
  private frenzyUntil = 0;
  private cooldowns = new Map<SkillId, number>();
  private bossAtLevel = -1;
  private paused = false;
  private pausedAt = 0;
  private saveAt = 0;
  /** 静态障碍坐标缓存（小地图用） */
  private obstaclePoints: { x: number; y: number }[] = [];

  private ui!: GameUI;

  constructor() {
    super('StageBattle');
  }

  create() {
    // 有存档就接着玩，没有就开新局
    const loaded = loadState();
    this.state = loaded ?? createInitialState();
    this.monsterLevel = Math.max(1, this.state.highestMonsterLevel);
    const prefs = loadPrefs();
    audio.setVolume(prefs.volume);
    audio.setSfx(prefs.sfx);
    audio.setMusic(prefs.music);
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
      .setStrokeStyle(8, 0x2c4d33)
      .setDepth(-9);

    this.buildObstacles();

    this.shadow = this.add.image(0, 0, 'shadow').setScale(1.4, 1).setDepth(4);
    this.aura = this.add
      .image(0, 0, 'ring')
      .setTint(0xff7bd5)
      .setScale(1.6)
      .setAlpha(0.55)
      .setDepth(4)
      .setVisible(false);
    this.targetRing = this.add
      .image(0, 0, 'ring')
      .setTint(0xe05656)
      .setScale(0.9)
      .setAlpha(0.8)
      .setDepth(3)
      .setVisible(false);
    this.player = this.physics.add.sprite(MAP_SIZE / 2, MAP_SIZE / 2, 'player-a');
    this.player.setScale(3).setCollideWorldBounds(true).setDepth(5);
    this.player.play('walk-player');
    this.playerLabel = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '11px',
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(9);

    this.monsterGroup = this.physics.add.group();
    for (let i = 0; i < MONSTER_COUNT; i++) this.spawnMonster();

    this.physics.add.collider(this.player, this.obstacles);
    this.physics.add.collider(this.monsterGroup, this.obstacles);
    this.physics.add.collider(this.monsterGroup, this.monsterGroup);
    this.physics.add.collider(this.player, this.monsterGroup);

    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.setupInput();
    this.setupUI();
    this.unlockAudioOnGesture();

    if (loaded) {
      this.ui.toast(`已载入存档：Lv${this.state.level} · 击杀 ${this.state.kills}`, '#9ad06a');
    }

    (window as unknown as Record<string, unknown>).__demo = {
      snapshot: () => this.snapshot(),
      state: () => this.state,
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
      /** 障碍物坐标（调试/截图用） */
      props: () => this.obstaclePoints.map((p) => ({ ...p })),
      paused: () => this.paused,
      setPaused: (p: boolean) => this.setPaused(p),
      audio: () => ({
        music: audio.musicEnabled,
        sfx: audio.sfxEnabled,
        volume: audio.volume,
        playing: audio.playing,
      }),
      save: () => saveState(this.state),
      backup: () => backupState(this.state),
      /** 当前场上的挥砍特效数量（冒烟测试用） */
      fx: () => {
        let blade = 0;
        let slash = 0;
        for (const o of this.children.list) {
          const key = (o as Phaser.GameObjects.Image).texture?.key;
          if (key === 'blade') blade++;
          if (key === 'slash') slash++;
        }
        return { blade, slash };
      },
      /** 主动普攻一次，返回是否真的砍出去了 */
      attack: () => {
        const before = this.playerNextAttackAt;
        this.tryMelee();
        return this.playerNextAttackAt !== before;
      },
    };
  }

  /**
   * 浏览器要求音频必须在用户手势里启动，
   * 所以第一次点击 / 按键时才真正创建 AudioContext 并起播 BGM。
   */
  private unlockAudioOnGesture(): void {
    const once = () => {
      audio.unlock();
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
    window.addEventListener('pointerdown', once);
    window.addEventListener('keydown', once);
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
    while (placed < 30 && guard++ < 300) {
      const x = rnd.between(120, MAP_SIZE - 120);
      const y = rnd.between(120, MAP_SIZE - 120);
      if (Phaser.Math.Distance.Between(x, y, MAP_SIZE / 2, MAP_SIZE / 2) < 260) continue;
      const kind = rnd.pick(['rock', 'bush', 'tree', 'tree', 'bush']);
      const s = this.obstacles.create(x, y, kind);
      s.setScale(3);
      s.setDepth(y).refreshBody();
      // 地面投影：浅色草地上让物体有落地感，边界更清楚
      this.add
        .image(x, y + 13, 'shadow')
        .setScale(kind === 'tree' ? 1.9 : 1.5, 0.9)
        .setAlpha(0.62)
        .setDepth(y - 1);
      this.obstaclePoints.push({ x, y });
      placed++;
    }
  }

  private spawnMonster(isBoss = false) {
    const level = this.monsterLevel;
    const skin = skinForLevel(level);
    let x = 0;
    let y = 0;
    for (let i = 0; i < 30; i++) {
      x = Phaser.Math.Between(120, MAP_SIZE - 120);
      y = Phaser.Math.Between(120, MAP_SIZE - 120);
      if (
        Phaser.Math.Distance.Between(
          x,
          y,
          this.player?.x ?? MAP_SIZE / 2,
          this.player?.y ?? MAP_SIZE / 2,
        ) > 420
      )
        break;
    }
    const sprite = this.monsterGroup.create(x, y, `${skin}-a`) as Phaser.Physics.Arcade.Sprite;
    sprite.setScale(isBoss ? 5.5 : 3).setDepth(y).play(`walk-${skin}`);
    if (isBoss) sprite.setTint(0xff9a9a);

    const barY = isBoss ? 54 : 34;
    const barW = isBoss ? 60 : 34;
    const hpBg = this.add
      .image(x, y - barY, 'bar')
      .setDisplaySize(barW, 5)
      .setTint(0x000000)
      .setDepth(y + 1)
      .setAlpha(0.7)
      .setVisible(false);
    const hpFg = this.add
      .image(x - barW / 2, y - barY, 'bar')
      .setOrigin(0, 0.5)
      .setDisplaySize(barW, 5)
      .setTint(isBoss ? 0xff3b3b : 0xe05656)
      .setDepth(y + 1)
      .setVisible(false);

    const data = createMonster(level);
    if (isBoss) {
      data.maxHp = Math.round(data.maxHp * 8);
      data.hp = data.maxHp;
      data.stats.pAtk = Math.round((data.stats.pAtk ?? 1) * 1.6);
    }
    const label = this.add
      .text(x, y - barY - 12, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '11px',
        color: isBoss ? '#ff6b6b' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(y + 2);

    const view: MonsterView = {
      data,
      sprite,
      hpBg,
      hpFg,
      label,
      nextAttackAt: 0,
      knockUntil: 0,
      dots: [],
      isBoss,
    };
    sprite.setData('view', view);
    this.monsters.push(view);
    if (isBoss) {
      this.ui.toast(`第 ${stageIndexForLevel(level)} 关 BOSS 出现了！Lv${level}`, '#ff6b6b');
      this.cameras.main.flash(300, 180, 40, 40);
    }
  }

  // ---------- 输入 ----------

  private setupInput() {
    this.input.keyboard!.addCapture('SPACE,Q,W,E,F');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.attackTarget = null;
        this.moveTarget = { x: p.worldX, y: p.worldY };
        this.moveMark(p.worldX, p.worldY);
      } else {
        const hit = this.monsterAt(p.worldX, p.worldY);
        if (hit) {
          this.moveTarget = null;
          this.attackTarget = hit;
        }
      }
    });
    this.input.keyboard!.on('keydown-SPACE', () => this.castSkill('attack'));
    this.input.keyboard!.on('keydown-Q', () => this.castSkill('fireball'));
    this.input.keyboard!.on('keydown-W', () => this.castSkill('frenzy'));
    this.input.keyboard!.on('keydown-E', () => this.castSkill('poison'));
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
        const attr = ATTR_KEYS[i];
        if (attr && allocateAttrPoint(this.state, attr)) {
          this.ui.toast(`+1 ${ATTR_ZH[attr]}`, '#7ee787');
        }
      });
    });
  }

  /** 世界坐标 (x, y) 附近可点选的怪物（取最近一只） */
  private monsterAt(x: number, y: number): MonsterView | null {
    let best: MonsterView | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      const d = Phaser.Math.Distance.Between(x, y, m.sprite.x, m.sprite.y);
      if (d <= 52 && d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  /** 右键落点标记 */
  private moveMark(x: number, y: number) {
    const mark = this.add
      .image(x, y, 'ring')
      .setTint(0x7ee787)
      .setScale(0.3)
      .setAlpha(0.9)
      .setDepth(3);
    this.tweens.add({
      targets: mark,
      scale: 0.7,
      alpha: 0,
      duration: 300,
      onComplete: () => mark.destroy(),
    });
  }

  /** 本帧移动方向（弧度）；无目标或已到达时返回 null */
  private steerVelocity(): number | null {
    const t = this.attackTarget;
    if (t && !t.sprite.active) this.attackTarget = null;
    const focus = this.attackTarget;
    if (focus) {
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        focus.sprite.x,
        focus.sprite.y,
      );
      if (d > ATTACK_RANGE * 0.8) {
        return Phaser.Math.Angle.Between(
          this.player.x,
          this.player.y,
          focus.sprite.x,
          focus.sprite.y,
        );
      }
      return null;
    }
    const mv = this.moveTarget;
    if (mv) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, mv.x, mv.y);
      if (d <= 8) {
        this.moveTarget = null;
        return null;
      }
      return Phaser.Math.Angle.Between(this.player.x, this.player.y, mv.x, mv.y);
    }
    return null;
  }

  // ---------- 世界内飘字 ----------

  private text(x: number, y: number, s: string, color: string, size: number) {
    return this.add.text(x, y, s, {
      fontFamily: 'ui-monospace, monospace',
      fontSize: `${size}px`,
      color,
      // 草地改浅后，飘字/提示必须带描边才不会糊在背景里
      stroke: '#101820',
      strokeThickness: Math.max(3, Math.round(size * 0.2)),
    });
  }

  // ---------- UI（DOM） ----------

  private setupUI() {
    this.ui = new GameUI({
      root: document.getElementById('ui-root') as HTMLElement,
      host: document.getElementById('shell') as HTMLElement,
      designWidth: 1200,
      getState: () => this.state,
      castSkill: (id) => this.castSkill(id),
      cooldownOf: (id) => this.cooldownOf(id),
      now: () => this.time.now,
      minimap: () => this.minimapData(),
      moveTo: (x, y) => this.moveToWorld(x, y),
      settings: this.settingsApi(),
      sfx: (n) => audio.play(n),
    });
  }

  // ---------- 设置（暂停 / 音频 / 存档） ----------

  private settingsApi(): SettingsApi {
    return {
      paused: () => this.paused,
      togglePause: () => this.setPaused(!this.paused),
      music: () => audio.musicEnabled,
      sfx: () => audio.sfxEnabled,
      volume: () => audio.volume,
      setMusic: (on) => {
        audio.setMusic(on);
        if (on) audio.unlock();
        this.savePrefs();
      },
      setSfx: (on) => {
        audio.setSfx(on);
        this.savePrefs();
      },
      setVolume: (v) => {
        audio.setVolume(v);
        this.savePrefs();
      },
      backup: () => {
        const at = backupState(this.state);
        if (at) audio.play('coin');
        return at;
      },
      restore: () => {
        const s = restoreBackup();
        if (!s) return false;
        this.applyState(s);
        audio.play('levelup');
        return true;
      },
      reset: () => {
        clearSave();
        this.applyState(createInitialState());
        audio.play('die');
      },
      savedAt: () => savedAt(),
      backupAt: () => backupAt(),
    };
  }

  private savePrefs(): void {
    savePrefs({
      music: audio.musicEnabled,
      sfx: audio.sfxEnabled,
      volume: audio.volume,
    });
  }

  /** 暂停：世界完全静止（物理 + 补间 + 计时器一起冻结） */
  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    if (p) {
      this.paused = true;
      this.pausedAt = this.time.now;
      this.physics.world.pause();
      this.tweens.pauseAll();
      audio.setPaused(true);
    } else {
      // 把暂停期间流逝的时间补回所有计时器，避免 CD 在暂停时偷偷走完
      this.shiftTimers(this.time.now - this.pausedAt);
      this.paused = false;
      this.physics.world.resume();
      this.tweens.resumeAll();
      audio.setPaused(false);
    }
  }

  /** 每 20 秒自动落盘一次 */
  private autoSave(time: number): void {
    if (this.saveAt === 0) {
      this.saveAt = time + 20000;
      return;
    }
    if (time < this.saveAt) return;
    this.saveAt = time + 20000;
    saveState(this.state);
  }

  /** 给所有"未来时间点"加上偏移量 dt */
  private shiftTimers(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const [k, v] of [...this.cooldowns]) this.cooldowns.set(k, v + dt);
    this.playerNextAttackAt += dt;
    this.regenAt += dt;
    this.steerSince += dt;
    if (this.frenzyUntil > 0) this.frenzyUntil += dt;
    for (const m of this.monsters) {
      m.nextAttackAt += dt;
      m.knockUntil += dt;
      for (const d of m.dots) {
        d.until += dt;
        d.tickAt += dt;
      }
    }
  }

  /** 整局替换存档状态（恢复备份 / 重置时调用） */
  private applyState(s: GameState): void {
    this.state = s;
    this.state.hp = maxHp(s);
    this.state.mp = maxMp(s);
    this.monsterLevel = Math.max(1, s.highestMonsterLevel);
    this.bossAtLevel = -1;
    this.frenzyUntil = 0;
    this.cooldowns.clear();
    this.playerNextAttackAt = 0;
    for (const m of [...this.monsters]) {
      m.hpBg.destroy();
      m.hpFg.destroy();
      m.label.destroy();
      m.sprite.destroy();
    }
    this.monsters = [];
    for (let i = 0; i < MONSTER_COUNT; i++) this.spawnMonster();
    this.attackTarget = null;
    this.moveTarget = null;
    this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
    this.aura.setVisible(false);
    this.setPaused(false);
    saveState(this.state);
    this.ui.toast(`已载入 Lv${this.state.level} 的进度`, '#ffd93d');
  }

  /** 小地图每帧取用的场景快照 */
  private minimapData(): MinimapData {
    const cam = this.cameras.main.worldView;
    const stage = stageIndexForLevel(this.monsterLevel);
    const monsters: MinimapMonster[] = [];
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      monsters.push({
        x: m.sprite.x,
        y: m.sprite.y,
        level: m.data.level,
        boss: m.isBoss,
        aggressive: m.data.aggressive,
      });
    }
    return {
      world: MAP_SIZE,
      player: { x: this.player.x, y: this.player.y },
      monsters,
      obstacles: this.obstaclePoints,
      view: { x: cam.x, y: cam.y, w: cam.width, h: cam.height },
      stage,
      stageName: STAGE_NAMES[(stage - 1) % STAGE_NAMES.length],
      monsterLevel: this.monsterLevel,
    };
  }

  /** 小地图点击 → 世界坐标移动 */
  private moveToWorld(x: number, y: number) {
    const tx = Phaser.Math.Clamp(x, 8, MAP_SIZE - 8);
    const ty = Phaser.Math.Clamp(y, 8, MAP_SIZE - 8);
    this.attackTarget = null;
    this.moveTarget = { x: tx, y: ty };
    this.moveMark(tx, ty);
  }

  private cooldownOf(id: SkillId): Cooldown {
    const readyAt = this.cooldowns.get(id) ?? 0;
    return {
      remain: Math.max(0, readyAt - this.time.now),
      total: SKILL_BY_ID[id].cdMs,
    };
  }

  // ---------- 技能 ----------

  private castSkill(id: SkillId) {
    const s = this.state;
    const lv = skillLevel(s, id);
    if (lv <= 0) {
      this.ui.toast(`尚未学会「${SKILL_BY_ID[id].name}」，需要技能书`, '#ff8a8a');
      return;
    }
    const def = SKILL_BY_ID[id];
    const now = this.time.now;
    if ((this.cooldowns.get(id) ?? 0) > now) return;
    const cost = skillMpCost(def, lv);
    if (cost > 0 && !spendMp(s, cost)) {
      this.ui.toast('法力不足', '#6ab0f3');
      return;
    }
    switch (id) {
      case 'attack':
        this.tryMelee(now);
        break;
      case 'fireball':
        this.castFireball(this.input.activePointer, lv);
        break;
      case 'frenzy':
        this.castFrenzy(lv);
        break;
      case 'poison':
        this.castPoison(lv);
        break;
    }
    this.cooldowns.set(id, now + def.cdMs);
  }

  private frenzyActive(): boolean {
    return this.time.now < this.frenzyUntil;
  }

  /** 狂暴期间的攻击/攻速倍率 */
  private frenzyMult(): number {
    if (!this.frenzyActive()) return 1;
    const lv = Math.max(1, skillLevel(this.state, 'frenzy'));
    return 1 + skillPower(SKILL_BY_ID.frenzy, lv);
  }

  private castFrenzy(lv: number) {
    this.frenzyUntil = this.time.now + skillValue(SKILL_BY_ID.frenzy, lv);
    this.aura.setVisible(true);
    this.cameras.main.flash(140, 255, 120, 220);
    audio.play('frenzy');
    this.ui.toast(`狂暴！攻击与攻速 +${Math.round((this.frenzyMult() - 1) * 100)}%`, '#ff9fd8');
  }

  private castPoison(lv: number) {
    const target =
      (this.attackTarget && this.attackTarget.sprite.active ? this.attackTarget : null) ??
      this.nearestMonster(140);
    if (!target) {
      this.ui.toast('附近没有可施毒的目标', '#9aa4b2');
      return;
    }
    const stats = aggregatedStats(this.state);
    const perTick = computeDamage({
      attack: (stats.mAtk ?? 1) * skillPower(SKILL_BY_ID.poison, lv) * this.frenzyMult(),
      defense: target.data.stats.mDef ?? 0,
      attackerLevel: this.state.level,
    });
    target.dots.push({
      perTick,
      until: this.time.now + skillValue(SKILL_BY_ID.poison, lv),
      tickAt: this.time.now + POISON_TICK_MS,
    });
    target.sprite.setTint(0x9ade6a);
    this.time.delayedCall(140, () => {
      if (target.sprite.active) target.sprite.clearTint();
    });
    audio.play('poison');
    this.ui.toast(`施毒成功：每 0.5s ${perTick} 点，持续 ${(skillValue(SKILL_BY_ID.poison, lv) / 1000).toFixed(1)}s`, '#9ade6a');
  }

  private castFireball(pointer: Phaser.Input.Pointer, lv: number) {
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
    audio.play('fire');

    const trail = this.add.particles(0, 0, 'dot', {
      follow: fb,
      speed: { min: 10, max: 40 },
      lifespan: 260,
      scale: { start: 1.4, end: 0 },
      tint: [0xff8a2a, 0xffd23a],
      alpha: { start: 0.9, end: 0 },
    });
    trail.setDepth(5);

    const mAtk = (stats.mAtk ?? 1) * this.frenzyMult();
    this.physics.add.overlap(fb, this.monsterGroup, (fbObj) => {
      this.explodeFireball(fb, trail, mAtk, lv);
      (fbObj as Phaser.Physics.Arcade.Image).destroy();
    });
    this.time.delayedCall(2200, () => {
      if (trail.active) trail.destroy();
      if (fb.active) fb.destroy();
    });
  }

  private explodeFireball(
    fb: Phaser.Physics.Arcade.Image,
    trail: Phaser.GameObjects.Particles.ParticleEmitter,
    mAtk: number,
    lv: number,
  ) {
    if (trail.active) {
      trail.stop();
      trail.destroy();
    }
    const px = fb.x;
    const py = fb.y;
    if (fb.active) fb.destroy();

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

    const radius = skillValue(SKILL_BY_ID.fireball, lv);
    for (const m of [...this.monsters]) {
      const d = Phaser.Math.Distance.Between(px, py, m.sprite.x, m.sprite.y);
      if (d > radius) continue;
      const dmg = computeDamage({
        attack: mAtk * skillPower(SKILL_BY_ID.fireball, lv),
        defense: m.data.stats.mDef ?? 0,
        attackerLevel: this.state.level,
      });
      const angle = Phaser.Math.Angle.Between(px, py, m.sprite.x, m.sprite.y);
      this.applyDamage(m, dmg, angle);
    }
  }

  // ---------- 战斗 ----------

  private meleeInterval() {
    const stats = aggregatedStats(this.state);
    const base = attackIntervalMs(stats.agi ?? 0);
    return base / this.frenzyMult();
  }

  private tryMelee(time: number = this.time.now) {
    if (time < this.playerNextAttackAt) return;
    const target = this.meleeTarget();
    if (!target) return;
    this.playerNextAttackAt = time + this.meleeInterval();

    const stats = aggregatedStats(this.state);
    const lv = Math.max(1, skillLevel(this.state, 'attack'));
    const dmg = computeDamage({
      attack:
        (stats.pAtk ?? 1) * skillPower(SKILL_BY_ID.attack, lv) * this.frenzyMult(),
      defense: target.data.stats.pDef ?? 0,
      attackerLevel: this.state.level,
    });
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      target.sprite.x,
      target.sprite.y,
    );
    this.player.setFlipX(target.sprite.x < this.player.x);
    this.slashEffect(angle);
    this.swingBlade(angle);
    audio.play('swing');
    this.tweens.add({
      targets: this.player,
      scaleX: 3.25,
      scaleY: 3.25,
      duration: 60,
      yoyo: true,
    });
    this.applyDamage(target, dmg, angle);
  }

  /** 优先攻击左键锁定的目标（需在攻击距离内），否则就近攻击 */
  private meleeTarget(): MonsterView | null {
    const t = this.attackTarget;
    if (t && t.sprite.active && this.inAttackRange(t)) return t;
    return this.nearestMonster();
  }

  private inAttackRange(m: MonsterView): boolean {
    return (
      Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        m.sprite.x,
        m.sprite.y,
      ) <= ATTACK_RANGE
    );
  }

  private nearestMonster(maxDist = ATTACK_RANGE): MonsterView | null {
    let best: MonsterView | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      const d = Phaser.Math.Distance.Between(
        m.sprite.x,
        m.sprite.y,
        this.player.x,
        this.player.y,
      );
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return bestD <= maxDist ? best : null;
  }

  private applyDamage(m: MonsterView, dmg: number, angle: number, tint = 0xffffff) {
    m.data.hp -= dmg;
    const heavy = dmg >= m.data.maxHp * 0.5;
    this.floatText(
      m.sprite.x,
      m.sprite.y - 30,
      `${dmg}`,
      tint === 0xffffff ? '#ffd93d' : '#9ade6a',
      heavy ? 24 : 17,
    );
    audio.play(heavy ? 'crit' : 'hit');
    m.sprite.setTintFill(tint);
    m.sprite.setVelocity(Math.cos(angle) * 130, Math.sin(angle) * 130);
    m.knockUntil = this.time.now + 130;
    // 受击抖动：轻微压扁再弹回，打击感更明确
    const baseScale = m.isBoss ? 5.5 : 3;
    m.sprite.setScale(baseScale * 1.18, baseScale * 0.82);
    this.tweens.add({
      targets: m.sprite,
      scaleX: baseScale,
      scaleY: baseScale,
      duration: 130,
      ease: 'Back.Out',
    });
    this.time.delayedCall(90, () => {
      if (m.sprite.active) m.sprite.clearTint();
    });
    this.refreshMonsterBar(m);
    if (m.data.hp <= 0) this.killMonster(m);
  }

  private refreshMonsterBar(m: MonsterView) {
    m.hpBg.setVisible(true);
    m.hpFg.setVisible(true);
    const ratio = Phaser.Math.Clamp(m.data.hp / m.data.maxHp, 0, 1);
    const w = m.isBoss ? 60 : 34;
    m.hpFg.setDisplaySize(w * ratio, 5);
    m.label.setVisible(true);
    m.label.setText(m.isBoss ? `BOSS Lv${m.data.level}` : `Lv${m.data.level}`);
  }

  private killMonster(m: MonsterView) {
    const ml = m.data.level;
    const px = m.sprite.x;
    const py = m.sprite.y;
    const isBoss = m.isBoss;
    m.hpBg.destroy();
    m.hpFg.destroy();
    m.label.destroy();
    m.sprite.destroy();
    this.monsters = this.monsters.filter((x) => x !== m);

    const burst = this.add.particles(px, py, 'dot', {
      speed: { min: 60, max: 180 },
      lifespan: 500,
      scale: { start: 2, end: 0 },
      tint: isBoss ? [0xff3b3b, 0xffd93d] : [0xe05656, 0xffffff],
      emitting: false,
    });
    burst.setDepth(7);
    burst.explode(isBoss ? 46 : 18);
    this.time.delayedCall(650, () => burst.destroy());
    this.cameras.main.shake(isBoss ? 200 : 70, isBoss ? 0.012 : 0.004);
    audio.play(isBoss ? 'boss' : 'kill');

    // 结算
    const mul = isBoss ? 3 : 1;
    const before = this.state.level;
    gainExp(this.state, killExp(ml) * mul);
    const gold = goldDrop(ml) * mul;
    this.state.gold += gold;
    this.state.kills += 1;
    this.state.highestMonsterLevel = Math.max(this.state.highestMonsterLevel, ml);

    // 掉落：装备 / 技能书都很稀有（各 ≤10%，BOSS 保底 1 件装备）
    const drops = rollDrops(ml, isBoss);
    const gainText = [`+${killExp(ml) * mul}exp`, `+${gold}金币`].join(' ');
    for (const it of drops.equip) this.state.inventory.push(it);
    for (const b of drops.books) this.state.skillBooks.push(b);

    const dropParts: string[] = [];
    if (drops.equip.length) dropParts.push(`${drops.equip.length} 件装备`);
    if (drops.books.length) {
      dropParts.push(`《${skillName(drops.books[0]!.skillId)}技能书》`);
      audio.play('equip');
    }
    const dropText = dropParts.join(' + ');
    this.flyCoins(px, py, drops.equip.length > 0 || isBoss ? 6 : 3);
    audio.play('coin');

    if (isBoss) {
      this.state.bossKills += 1;
      this.ui.toast(
        `击败第 ${stageIndexForLevel(ml)} 关 BOSS！${gainText}${
          dropText ? ' · 掉落 ' + dropText : ''
        }`,
        '#ffd93d',
      );
      this.cameras.main.flash(320, 255, 220, 120);
    } else {
      this.ui.toast(
        `击杀 Lv${ml} · ${gainText}${dropText ? ' · 掉落 ' + dropText : ''}`,
        dropText ? '#ffd93d' : '#9ad06a',
      );
    }
    if (this.state.level > before) this.levelUpFx(before);

    this.monsterLevel += 1;
    this.time.delayedCall(1200, () => this.spawnMonster());
    if (this.monsterLevel % 10 === 0 && this.bossAtLevel !== this.monsterLevel) {
      this.bossAtLevel = this.monsterLevel;
      this.time.delayedCall(1400, () => this.spawnMonster(true));
    }
  }

  private flyCoins(px: number, py: number, n: number) {
    for (let i = 0; i < n; i++) {
      const coin = this.add
        .image(
          px + Phaser.Math.Between(-14, 14),
          py + Phaser.Math.Between(-14, 14),
          'coin',
        )
        .setScale(2)
        .setDepth(8);
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
    const ring = this.add
      .image(this.player.x, this.player.y, 'ring')
      .setTint(0xffd93d)
      .setScale(0.5)
      .setAlpha(1)
      .setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: 2.8,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
    const t = this.text(this.player.x, this.player.y - 60, `LEVEL UP! Lv${this.state.level}`, '#ffd93d', 22)
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
    audio.play('levelup');
    this.ui.toast(
      `Lv${before} → Lv${this.state.level}，+${this.state.level - before} 属性点${
        isBreakthrough(this.state.level) ? '（可进阶!）' : ''
      }`,
      '#ffd93d',
    );
  }

  private autoEquipBest() {
    if (this.state.inventory.length === 0) {
      this.ui.toast('背包里没有装备', '#9aa4b2');
      return;
    }
    const n = equipBest(this.state);
    this.ui.toast(
      n > 0 ? `穿戴 ${n} 件更优装备，战力 ${powerScore(this.state)}` : '当前装备已是最优',
      '#7ee787',
    );
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

  /** 挥刀：一把刀绕角色从后向前扫过（普通攻击的实体动作） */
  private swingBlade(angle: number) {
    const ox = this.player.x + Math.cos(angle) * 12;
    const oy = this.player.y + Math.sin(angle) * 12;
    const blade = this.add
      .image(ox, oy, 'blade')
      .setScale(2.6)
      .setDepth(7)
      .setRotation(angle - 1.3)
      .setAlpha(0.95);
    this.tweens.add({
      targets: blade,
      rotation: angle + 0.7,
      alpha: 0,
      scale: 2.2,
      duration: 170,
      ease: 'Quad.Out',
      onComplete: () => blade.destroy(),
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
      skillPoints: this.state.skillPoints,
      kills: this.state.kills,
      inventory: this.state.inventory.length,
      skillBooks: this.state.skillBooks.length,
      monsterLevel: this.monsterLevel,
      monstersAlive: alive,
      power: powerScore(this.state),
    };
  }

  // ---------- 主循环 ----------

  update(time: number) {
    // 暂停时世界完全静止，但 UI 仍然刷新（面板、小地图照常能看）
    if (this.paused) {
      this.player.setVelocity(0, 0);
      this.ui.sync();
      return;
    }
    this.autoSave(time);

    const stats = aggregatedStats(this.state);
    const speed = moveSpeed(stats.speed ?? 0);
    const dir = this.steerVelocity();
    const vx = dir === null ? 0 : Math.cos(dir) * speed;
    const vy = dir === null ? 0 : Math.sin(dir) * speed;
    this.player.setVelocity(vx, vy);
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
    this.playerLabel.setPosition(this.player.x, this.player.y - 44);
    this.playerLabel.setText(`Lv${this.state.level}`);

    const frenzy = this.frenzyActive();
    this.aura.setVisible(frenzy);
    if (frenzy) {
      this.aura.setPosition(this.player.x, this.player.y + 10);
      this.aura.setAlpha(0.35 + 0.2 * Math.sin(time / 120));
      this.aura.setDepth(this.player.y - 0.2);
    }

    // 点击移动卡住检测：持续朝目标转向却 400ms 内几乎没位移 → 被障碍挡住，放弃目标
    if (dir !== null) {
      if (this.steerSince === 0) {
        this.steerSince = time;
        this.stuckX = this.player.x;
        this.stuckY = this.player.y;
      } else if (time - this.steerSince >= 400) {
        const moved = Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          this.stuckX,
          this.stuckY,
        );
        this.stuckX = this.player.x;
        this.stuckY = this.player.y;
        this.steerSince = time;
        if (moved < 2) {
          this.moveTarget = null;
          this.attackTarget = null;
        }
      }
    } else {
      this.steerSince = 0;
    }

    const ringOn = this.attackTarget;
    if (ringOn && ringOn.sprite.active) {
      this.targetRing.setPosition(ringOn.sprite.x, ringOn.sprite.y + 8).setVisible(true);
    } else {
      this.targetRing.setVisible(false);
    }

    if (time >= this.regenAt) {
      this.regenAt = time + 1000;
      restoreHp(this.state, REGEN_PER_SEC);
      restoreMp(this.state, REGEN_PER_SEC);
    }

    if (time >= this.playerNextAttackAt) this.tryMelee(time);

    for (const m of [...this.monsters]) {
      if (!m.sprite.active) continue;
      m.sprite.setDepth(m.sprite.y);
      const barY = m.isBoss ? 54 : 34;
      m.hpBg.setPosition(m.sprite.x, m.sprite.y - barY);
      m.hpFg.setPosition(m.sprite.x - (m.isBoss ? 30 : 17), m.sprite.y - barY);
      m.label.setPosition(m.sprite.x, m.sprite.y - barY - 13);

      // DoT 结算
      if (m.dots.length > 0) {
        m.dots = m.dots.filter((d) => d.until > time);
        for (const d of m.dots) {
          if (!m.sprite.active) break; // 这一跳可能已击杀目标
          if (time >= d.tickAt) {
            d.tickAt = time + POISON_TICK_MS;
            this.applyDamage(m, d.perTick, Math.PI / 2, 0x9ade6a);
          }
        }
      }

      if (time < m.knockUntil) continue;
      if (!m.data.aggressive) {
        m.sprite.setVelocity(0, 0);
        if (m.sprite.anims.isPlaying) m.sprite.anims.stop();
        continue;
      }
      const d = Phaser.Math.Distance.Between(
        m.sprite.x,
        m.sprite.y,
        this.player.x,
        this.player.y,
      );
      const ms = moveSpeed(m.data.stats.speed ?? 0) * (m.isBoss ? 0.45 : 0.55);
      if (d > ATTACK_RANGE * 0.75) {
        const ang = Phaser.Math.Angle.Between(
          m.sprite.x,
          m.sprite.y,
          this.player.x,
          this.player.y,
        );
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

    this.ui.sync();
  }

  private monsterAttack(m: MonsterView) {
    const stats = aggregatedStats(this.state);
    const dmg = computeDamage({
      attack: (m.data.stats.pAtk ?? 1) * (m.isBoss ? 1.4 : 1),
      defense: stats.pDef ?? 0,
      attackerLevel: m.data.level,
    });
    this.state.hp -= dmg;
    this.floatText(this.player.x, this.player.y - 40, `-${dmg}`, '#ff6b6b', 16);
    this.cameras.main.shake(60, 0.003);
    audio.play('hurt');
    if (this.state.hp <= 0) {
      this.state.hp = maxHp(this.state);
      this.state.mp = maxMp(this.state);
      this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
      this.cameras.main.flash(400, 200, 0, 0);
      audio.play('die');
      this.ui.toast(`被 Lv${m.data.level} ${m.isBoss ? 'BOSS ' : ''}击杀，已回城复活`, '#ff6b6b');
    }
  }

}

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 1200,
  height: 720,
  backgroundColor: '#10141a',
  disableContextMenu: true,
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
