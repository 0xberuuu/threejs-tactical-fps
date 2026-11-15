// Weapon definitions and the shared firing model. One table drives the
// player, the bots and the buy menu, so the three can never disagree.
// Spread is in radians; damage falls off with distance; headshots multiply.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 'secondary', price: 0,
    damage: 26, headMult: 4, rpm: 350, auto: false,
    mag: 12, reserve: 48, reload: 1.4,
    spread: 0.006, moveSpread: 0.03, bloom: 0.008, bloomDecay: 0.05,
    recoil: 0.011, kick: 0.35, range: 55, falloff: 0.55,
    pellets: 1, heavy: false, tracer: 0.5,
  },
  k7: {
    id: 'k7', name: 'K7 Ripper', slot: 'primary', price: 1200,
    damage: 24, headMult: 4, rpm: 750, auto: true,
    mag: 30, reserve: 90, reload: 2.0,
    spread: 0.012, moveSpread: 0.045, bloom: 0.011, bloomDecay: 0.045,
    recoil: 0.009, kick: 0.3, range: 45, falloff: 0.5,
    pellets: 1, heavy: false, tracer: 0.55,
  },
  ar4: {
    id: 'ar4', name: 'AR-4 Longbow', slot: 'primary', price: 2600,
    damage: 33, headMult: 4, rpm: 600, auto: true,
    mag: 30, reserve: 90, reload: 2.4,
    spread: 0.004, moveSpread: 0.038, bloom: 0.009, bloomDecay: 0.05,
    recoil: 0.013, kick: 0.45, range: 70, falloff: 0.7,
    pellets: 1, heavy: true, tracer: 0.6,
  },
  dmr: {
    id: 'dmr', name: 'DMR-8 Hawkeye', slot: 'primary', price: 4200,
    damage: 80, headMult: 3, rpm: 55, auto: false,
    mag: 5, reserve: 15, reload: 3.0,
    spread: 0.001, moveSpread: 0.06, bloom: 0.02, bloomDecay: 0.03,
    recoil: 0.035, kick: 1.0, range: 90, falloff: 0.85,
    pellets: 1, heavy: true, tracer: 0.7,
  },
};

export const GRENADE_DEFS = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, fuse: 2.0, radius: 8, maxDamage: 120 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 250, fuse: 1.4, radius: 6, duration: 12 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 50;

// Full ammo for a weapon id, as stored on a combatant.
export function fullAmmo(id) {
  const w = WEAPONS[id];
  return { mag: w.mag, reserve: w.reserve };
}

// Current spread for a shooter: base + movement + air + accumulated bloom.
// Crouching tightens it. Stopping to aim pays — the core gunplay promise.
export function currentSpread(combatant, moving, airborne) {
  const w = WEAPONS[combatant.weapon];
  let spread = w.spread + combatant.spreadBloom;
  if (moving) spread += w.moveSpread;
  if (airborne) spread += 0.05;
  if (combatant.crouched) spread *= 0.7;
  return spread;
}

// Damage at a distance, before the headshot multiplier and armor.
export function damageAtRange(weapon, dist) {
  const t = Math.min(1, dist / weapon.range);
  return weapon.damage * (1 - (1 - weapon.falloff) * t);
}

// Armor absorbs half the damage while it lasts.
export function applyArmor(combatant, damage) {
  if (combatant.armor <= 0) return damage;
  const absorbed = Math.min(combatant.armor, damage * 0.5);
  combatant.armor -= absorbed;
  return damage - absorbed;
}
