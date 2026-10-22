// 临时调参脚本 v3：人物血量成长候选方案（不改 src）
// 关键约束：血量的等级加成只作用于 hp，攻击/防御线一律保持 L+9（旧公式）
const B = {
  MIT_K0: 600, MIT_KD: 1.0, MIT_CAP: 0.65,
  M_HP_BASE: 5, M_HP_EXP: 1.05, M_DEF_EXP: 1.1, M_ATK_SCALE: 0.75,
  POTION_STEP: 10, POTION_HEAL_PCT: 0.25, POTION_PRICE_MULT: 10,
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mit = (def, atkLv) => clamp(def / (def + B.MIT_K0 + B.MIT_KD * Math.max(1, atkLv)), 0, B.MIT_CAP);
const mHp = (L) => Math.max(1, Math.round(B.M_HP_BASE * Math.pow(L, B.M_HP_EXP)));
const mDef = (L) => Math.max(1, Math.round(Math.pow(L, B.M_DEF_EXP)));
const mAtk = (L) => 1 + L * B.M_ATK_SCALE;

const ATTR = (L) => 10 + (L - 1);   // 等级自带的属性线 = L+9
const GEAR = (L) => 2 * L;          // 满装备口径：装备+自由点 ≈ 2L → 总属性 ≈ 3L
const SLOPE = 5;                    // 方案 A：hp 每级 +5（其余八项仍 +1）
const lvlHp = (L) => Math.round(B.M_HP_BASE * Math.pow(L, B.M_HP_EXP)); // 方案 B：照抄怪物曲线

const hpOld = (L, gear) => ATTR(L) + (gear ? GEAR(L) : 0);
const hpA = (L, gear) => 10 + SLOPE * (L - 1) + (gear ? GEAR(L) : 0);
const hpB = (L, gear) => ATTR(L) + lvlHp(L) + (gear ? GEAR(L) : 0);

// pLv = 攻击方(玩家)等级；减伤分母里吃攻击方等级，越级时必须和怪等级分开
function duel(L, hp, ad, pLv = L) {
  const dmgOut = Math.max(1, Math.round(ad * (1 - mit(mDef(L), pLv))));
  const dmgIn = Math.max(1, Math.round(mAtk(L) * (1 - mit(ad, L))));
  const kill = Math.ceil(mHp(L) / dmgOut);
  return { kill, survive: hp / dmgIn, dmgIn, dmgOut };
}

const anchors = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const row = (L, hp, ad) => {
  const d = duel(L, hp, ad);
  return `血${String(Math.round(hp)).padEnd(7)} 扛${d.survive.toFixed(1).padStart(6)}刀 砍${String(d.kill).padStart(3)}刀 ${d.survive >= d.kill ? '胜' : '负'}`;
};

console.log('怪同级参考：血量/防御/攻击');
for (const L of anchors) console.log(`  Lv${String(L).padEnd(6)} 血${String(mHp(L)).padEnd(7)} 防${String(mDef(L)).padEnd(7)} 攻${mAtk(L).toFixed(1)}`);

console.log('\n===== 裸装打同级怪 =====');
console.log('Lv      | 旧(=L+9)                | A 线性x5                | B 幂1.05');
for (const L of anchors) {
  const ad = ATTR(L);
  console.log(
    `Lv${String(L).padEnd(6)} | ${row(L, hpOld(L, false), ad)} | ${row(L, hpA(L, false), ad)} | ${row(L, hpB(L, false), ad)}`,
  );
}

console.log('\n===== 满装备打同级怪（攻防线仍是 3L+9）=====');
console.log('Lv      | 旧(=3L+9)               | A 线性(7L+5)            | B 幂');
for (const L of anchors) {
  const ad = ATTR(L) + GEAR(L);
  console.log(
    `Lv${String(L).padEnd(6)} | ${row(L, hpOld(L, true), ad)} | ${row(L, hpA(L, true), ad)} | ${row(L, hpB(L, true), ad)}`,
  );
}

console.log('\n===== 越级压力测试：Lv{L} 裸装打 Lv{L+10} 怪 =====');
for (const L of [10, 50, 100, 1000]) {
  const d = duel(L + 10, hpA(L, false), ATTR(L), L);
  const o = duel(L + 10, hpOld(L, false), ATTR(L), L);
  console.log(`Lv${String(L).padEnd(6)} 旧 ${o.survive.toFixed(1)}刀/需${d.kill}刀 | A ${d.survive.toFixed(1)}刀/需${d.kill}刀`);
}

console.log('\n===== 药水经济（金币/杀 = 怪等级）=====');
for (const L of [10, 100, 1000, 10000]) {
  const heal = (hp) => Math.max(B.POTION_STEP * Math.floor(L / B.POTION_STEP), Math.round(hp * B.POTION_HEAL_PCT));
  const o = heal(hpOld(L, true)), n = heal(hpA(L, true));
  console.log(`Lv${String(L).padEnd(6)} 旧药${String(o).padEnd(7)}价${String(o * 10).padEnd(8)}=${(o * 10 / L).toFixed(1)}杀 | A药${String(n).padEnd(7)}价${String(n * 10).padEnd(8)}=${(n * 10 / L).toFixed(1)}杀 | 满池${Math.ceil(hpA(L, true) / n)}瓶`);
}

const pts = [];
for (let L = 1; L <= 10000; L++) {
  const adN = ATTR(L), adF = ATTR(L) + GEAR(L);
  const dn = duel(L, hpOld(L, false), adN), an = duel(L, hpA(L, false), adN);
  const df = duel(L, hpOld(L, true), adF), af = duel(L, hpA(L, true), adF);
  pts.push({
    L,
    monster: mHp(L),
    oldNaked: hpOld(L, false),
    oldFull: hpOld(L, true),
    newNaked: hpA(L, false),
    newFull: hpA(L, true),
    powNaked: hpB(L, false),
    rOldNaked: dn.survive / dn.kill,
    rNewNaked: an.survive / an.kill,
    rOldFull: df.survive / df.kill,
    rNewFull: af.survive / af.kill,
  });
}
require('fs').writeFileSync('/tmp/hp-curve3.json', JSON.stringify(pts));
console.log('\n采样点', pts.length, '-> /tmp/hp-curve3.json');
