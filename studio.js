"use strict";
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("Couldn't load the PDF reader. Check your internet connection and try again.")); document.head.appendChild(s); }); }
const MOD_B64 = "";
function encode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i]; let j = i + 1;
    while (j < arr.length && arr[j] === v) j++;
    const c = j - i;
    out.push(c === 1 ? v.toString(36) : v.toString(36) + "*" + c.toString(36));
    i = j;
  }
  return out.join(",");
}
function decode(bp) {
  const [w, h, d] = bp.size, arr = new Uint16Array(w * h * d);
  let pos = 0;
  for (const r of bp.data.split(",")) {
    const s = r.indexOf("*");
    const v = parseInt(s < 0 ? r : r.slice(0, s), 36), c = s < 0 ? 1 : parseInt(r.slice(s + 1), 36);
    if (v) arr.fill(v, pos, pos + c);
    pos += c;
  }
  return arr;
}

// ---------- colors ----------
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function oklab(r, g, b) {
  r = srgbToLin(r); g = srgbToLin(g); b = srgbToLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

function nearest(list, L, A, B) {
  let best = 0, bd = 1e9;
  for (let i = 0; i < list.length; i++) {
    const q = list[i].lab;
    const d = (q[0] - L) ** 2 + (q[1] - A) ** 2 + (q[2] - B) ** 2;
    const dd = Math.sqrt(d) + list[i].pen;
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}


async function gunzipMaybe(buf) {
  const u = new Uint8Array(buf);
  if (u[0] === 0x1f && u[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser can't unzip that file. Try Chrome or Edge.");
    const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(ds).arrayBuffer();
  }
  return buf;
}
function readNBT(buf, little) {
  const dv = new DataView(buf); let p = 0;
  const td = new TextDecoder();
  const u8 = () => dv.getUint8(p++);
  const i8 = () => dv.getInt8(p++);
  const i16 = () => { const v = dv.getInt16(p, little); p += 2; return v; };
  const u16 = () => { const v = dv.getUint16(p, little); p += 2; return v; };
  const i32 = () => { const v = dv.getInt32(p, little); p += 4; return v; };
  const str = () => { const n = u16(); const s = td.decode(new Uint8Array(buf, p, n)); p += n; return s; };
  function payload(t) {
    switch (t) {
      case 1: return i8();
      case 2: return i16();
      case 3: return i32();
      case 4: { const a = i32(), b = i32(); return little ? { lo: a >>> 0, hi: b } : { hi: a, lo: b >>> 0 }; }
      case 5: { const v = dv.getFloat32(p, little); p += 4; return v; }
      case 6: { const v = dv.getFloat64(p, little); p += 8; return v; }
      case 7: { const n = i32(); const v = new Int8Array(buf.slice(p, p + n)); p += n; return v; }
      case 8: return str();
      case 9: { const et = u8(), n = i32(); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = payload(et); return out; }
      case 10: { const o = {}; for (; ;) { const t2 = u8(); if (t2 === 0) break; const k = str(); o[k] = payload(t2); } return o; }
      case 11: { const n = i32(); const v = new Int32Array(n); for (let i = 0; i < n; i++) v[i] = i32(); return v; }
      case 12: {
        // longs as pairs of 32 bit words, low word first, so bits read as one stream
        const n = i32(); const v = new Uint32Array(n * 2);
        for (let i = 0; i < n; i++) { const a = dv.getUint32(p, little), b = dv.getUint32(p + 4, little); p += 8; if (little) { v[i * 2] = a; v[i * 2 + 1] = b; } else { v[i * 2] = b; v[i * 2 + 1] = a; } }
        return v;
      }
      default: throw new Error("Unknown NBT tag " + t);
    }
  }
  const t = u8(); if (t !== 10) throw new Error("This doesn't look like an NBT file.");
  str();
  return payload(10);
}
const num = v => typeof v === "object" && v && "lo" in v ? v.hi * 4294967296 + v.lo : v;

// ---------- Java to Bedrock ----------
const RENAME = {
  cave_air: "air", void_air: "air", grass: "short_grass", dirt_path: "grass_path", snow_block: "snow", cobweb: "web", magma_block: "magma",
  nether_bricks: "nether_brick", red_nether_bricks: "red_nether_brick", terracotta: "hardened_clay", slime_block: "slime", spawner: "mob_spawner",
  jack_o_lantern: "lit_pumpkin", sugar_cane: "reeds", lily_pad: "waterlily", end_stone_bricks: "end_bricks", powered_rail: "golden_rail",
  bricks: "brick_block", note_block: "noteblock", dead_bush: "deadbush", light_gray_glazed_terracotta: "silver_glazed_terracotta", melon: "melon_block",
  tall_seagrass: "seagrass", kelp_plant: "kelp", bubble_column: "water", frogspawn: "frog_spawn", rooted_dirt: "dirt_with_roots", stonecutter: "stonecutter_block",
  comparator: "unpowered_comparator", repeater: "unpowered_repeater", shulker_box: "undyed_shulker_box", oak_door: "wooden_door", oak_trapdoor: "trapdoor",
  oak_fence_gate: "fence_gate", stone_slab: "normal_stone_slab", stone_stairs: "normal_stone_stairs", prismarine_brick_stairs: "prismarine_bricks_stairs",
  prismarine_brick_slab: "prismarine_brick_slab", end_stone_brick_stairs: "end_brick_stairs", end_stone_brick_slab: "end_stone_brick_slab", end_stone_brick_wall: "end_stone_brick_wall",
  wall_torch: "torch", soul_wall_torch: "soul_torch", redstone_wall_torch: "redstone_torch", oak_sign: "standing_sign", oak_wall_sign: "wall_sign",
  piston_head: "air", moving_piston: "air", nether_portal: "air", structure_void: "air", attached_melon_stem: "melon_stem", attached_pumpkin_stem: "pumpkin_stem",
  water_cauldron: "cauldron", lava_cauldron: "cauldron", powder_snow_cauldron: "cauldron", light: "light_block", chain: "chain", enchanting_table: "enchanting_table",
  smooth_quartz_stairs: "smooth_quartz_stairs", carved_pumpkin: "carved_pumpkin",
};
const AXIS_RE = /(_log|_wood|_stem|_hyphae|pillar|basalt|bone_block|hay_block|^chain$|bamboo_block|^deepslate$|muddy_mangrove_roots|ochre_froglight|verdant_froglight|pearlescent_froglight)$/;
function javaToEntry(full, P) {
  P = P || {};
  let name = full.replace(/^minecraft:/, "");
  let dir = "", flags = "";
  const raw = [];
  let m;
  if (/^potted_/.test(name)) name = "flower_pot";
  if ((m = name.match(/^(.*)_wall_banner$/))) { name = "wall_banner"; dir = P.facing || ""; }
  else if ((m = name.match(/^(.*)_banner$/))) { name = "standing_banner"; if (P.rotation !== undefined) raw.push("ground_sign_direction=" + P.rotation); }
  else if ((m = name.match(/^(.*)_bed$/))) { name = "bed"; dir = P.facing || ""; if (P.part === "head") flags += "T"; }
  else if ((m = name.match(/^(.*)_wall_hanging_sign$/))) { name = m[1] + "_hanging_sign"; dir = P.facing || ""; }
  else if ((m = name.match(/^(.*)_wall_sign$/)) && name !== "oak_wall_sign") { name = m[1] + "_wall_sign"; dir = P.facing || ""; }
  else if ((m = name.match(/^(.*)_sign$/)) && name !== "oak_sign" && !/hanging/.test(name) && !/wall/.test(name)) { name = m[1] + "_standing_sign"; if (P.rotation !== undefined) raw.push("ground_sign_direction=" + P.rotation); }
  if (RENAME[name] !== undefined) name = RENAME[name];
  if (name === "standing_sign" && P.rotation !== undefined && !raw.length) raw.push("ground_sign_direction=" + P.rotation);
  if (name === "air") return "minecraft:air|||";
  if (name === "redstone_torch" && P.lit === "false") name = "unlit_redstone_torch";
  // slabs
  if (/_slab$/.test(name)) {
    if (P.type === "double") name = name.replace(/_slab$/, "_double_slab");
    else if (P.type === "top") flags += "U";
  }
  if (/_stairs$/.test(name)) { dir = P.facing || ""; if (P.half === "top") flags += "U"; }
  else if (/door$/.test(name) && !/trapdoor/.test(name)) { dir = P.facing || ""; if (P.half === "upper") flags += "T"; if (P.open === "true") flags += "O"; if (P.hinge === "right") raw.push("door_hinge_bit=true"); }
  else if (/trapdoor$/.test(name)) { dir = P.facing || ""; if (P.half === "top") flags += "U"; if (P.open === "true") flags += "O"; }
  else if (/fence_gate$/.test(name)) { dir = P.facing || ""; if (P.open === "true") flags += "O"; if (P.in_wall === "true") raw.push("in_wall_bit=true"); }
  else if (/torch$/.test(name)) { dir = P.facing || "up"; }
  else if (/button$|^lever$/.test(name)) { dir = P.face === "floor" ? "up" : P.face === "ceiling" ? "down" : (P.facing || ""); }
  else if (P.facing) dir = P.facing;
  if (P.axis && (AXIS_RE.test(name) || /log|wood|stem|hyphae/.test(name))) flags += P.axis.toUpperCase();
  if (P.hanging === "true") flags += "H";
  if (/(^|_)(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|pitcher_plant|tall_seagrass|small_dripleaf)$/.test(name) && P.half === "upper") flags += "T";
  if (/leaves$/.test(name)) raw.push("persistent_bit=true");
  if (name === "snow" && P.layers) { name = "snow_layer"; raw.push("height=" + (+P.layers - 1)); }
  if (/candle$/.test(name) && P.candles) raw.push("candles=" + (+P.candles - 1));
  if (name === "sea_pickle" && P.pickles) raw.push("cluster_count=" + (+P.pickles - 1));
  if ((name === "water" || name === "lava") && P.level && P.level !== "0") return "";
  return "minecraft:" + name + "|" + dir + "|" + flags + "|" + raw.join(",");
}
// Bedrock states to the neutral form (same as the add-on's describe()).
const R_WEIRDO = ["east", "west", "south", "north"], R_FACING = ["down", "up", "north", "south", "west", "east"];
const R_DOOR = ["east", "south", "west", "north"], R_TRAP = ["east", "west", "south", "north"], R_GENERIC = ["south", "west", "north", "east"];
function bedrockToEntry(id, st) {
  id = id.includes(":") ? id : "minecraft:" + id;
  if (/^minecraft:(air|structure_void)$/.test(id)) return id === "minecraft:air" ? "minecraft:air|||" : "";
  let dir = "", flags = ""; const raw = [];
  const isDoor = /door/.test(id) && !/trapdoor/.test(id), isTrap = /trapdoor/.test(id);
  for (const k in st || {}) {
    let v = st[k]; if (typeof v === "object" && v && "lo" in v) v = num(v);
    if (k === "minecraft:cardinal_direction" || k === "minecraft:facing_direction") dir = v;
    else if (k === "weirdo_direction") dir = R_WEIRDO[v] || "";
    else if (k === "facing_direction") dir = typeof v === "string" ? v : R_FACING[v] || "";
    else if (k === "torch_facing_direction") dir = v === "top" ? "up" : v === "unknown" ? "" : v;
    else if (k === "direction") dir = (isDoor ? R_DOOR : isTrap ? R_TRAP : R_GENERIC)[v] || "";
    else if (k === "pillar_axis") flags += String(v).toUpperCase();
    else if (k === "upside_down_bit" || k === "top_slot_bit") { if (v) flags += "U"; }
    else if (k === "minecraft:vertical_half") { if (v === "top") flags += "U"; }
    else if (k === "upper_block_bit" || k === "head_piece_bit") { if (v) flags += "T"; }
    else if (k === "open_bit") { if (v) flags += "O"; }
    else if (k === "hanging" || k === "hanging_bit") { if (v) flags += "H"; }
    else if (v !== 0 && v !== false && v !== "") raw.push(k + "=" + (v === true ? "true" : v));
  }
  return id + "|" + dir + "|" + flags + "|" + raw.join(",");
}

// ---------- schematic readers ----------
// Each returns { w, h, d, get(x,y,z) -> palette entry index into states[], states: [{name, props, bedrock}] }
function bitsReader(words, bits) {
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  return i => {
    const p = i * bits, w = p >>> 5, o = p & 31;
    let v = words[w] >>> o;
    if (o + bits > 32) v |= words[w + 1] << (32 - o);
    return (v & mask) >>> 0;
  };
}
function readLitematic(root) {
  const regions = root.Regions || {};
  const names = Object.keys(regions);
  if (!names.length) throw new Error("This Litematica file has no regions.");
  const boxes = names.map(n => {
    const r = regions[n];
    const pos = { x: r.Position.x, y: r.Position.y, z: r.Position.z }, sz = { x: r.Size.x, y: r.Size.y, z: r.Size.z };
    const min = { x: pos.x + (sz.x < 0 ? sz.x + 1 : 0), y: pos.y + (sz.y < 0 ? sz.y + 1 : 0), z: pos.z + (sz.z < 0 ? sz.z + 1 : 0) };
    return { r, min, w: Math.abs(sz.x), h: Math.abs(sz.y), d: Math.abs(sz.z) };
  });
  const gmin = { x: Math.min(...boxes.map(b => b.min.x)), y: Math.min(...boxes.map(b => b.min.y)), z: Math.min(...boxes.map(b => b.min.z)) };
  const gmax = { x: Math.max(...boxes.map(b => b.min.x + b.w)), y: Math.max(...boxes.map(b => b.min.y + b.h)), z: Math.max(...boxes.map(b => b.min.z + b.d)) };
  const W = gmax.x - gmin.x, H = gmax.y - gmin.y, D = gmax.z - gmin.z;
  const states = [{ name: "minecraft:air", props: {} }], key = new Map([["minecraft:air{}", 0]]);
  const grid = new Uint32Array(W * H * D);
  for (const b of boxes) {
    const pal = (b.r.BlockStatePalette || []).map(s => { const k = s.Name + JSON.stringify(s.Properties || {}); let v = key.get(k); if (v === undefined) { v = states.length; states.push({ name: s.Name, props: s.Properties || {} }); key.set(k, v); } return v; });
    const bits = Math.max(2, Math.ceil(Math.log2(pal.length)));
    const get = bitsReader(b.r.BlockStates, bits);
    const ox = b.min.x - gmin.x, oy = b.min.y - gmin.y, oz = b.min.z - gmin.z;
    for (let y = 0; y < b.h; y++) for (let z = 0; z < b.d; z++) for (let x = 0; x < b.w; x++) {
      const v = get((y * b.d + z) * b.w + x);
      const s = pal[v] || 0; if (!s) continue;
      grid[((y + oy) * D + (z + oz)) * W + (x + ox)] = s;
    }
  }
  return { w: W, h: H, d: D, grid, states, java: true, meta: root.Metadata ? (root.Metadata.Name || "") : "" };
}
function readVarints(bytes, count) {
  const out = new Uint32Array(count); let p = 0;
  for (let i = 0; i < count && p < bytes.length; i++) {
    let v = 0, s = 0, b;
    do { b = bytes[p++] & 0xff; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
    out[i] = v;
  }
  return out;
}
function readSponge(root) {
  const S = root.Schematic || root;
  const w = S.Width & 0xffff, h = S.Height & 0xffff, d = S.Length & 0xffff;
  let palette, data;
  if (S.Blocks) { palette = S.Blocks.Palette; data = S.Blocks.Data; }
  else { palette = S.Palette; data = S.BlockData; }
  if (!palette || !data) {
    if ((S.Blocks && S.Blocks.length !== undefined) || S.Materials) return readLegacySchematic(S);
    throw new Error("I couldn't find the blocks in this schematic.");
  }
  const states = [];
  for (const [k, v] of Object.entries(palette)) {
    const m = k.match(/^([^\[]+)(?:\[(.*)\])?$/);
    const props = {};
    if (m[2]) for (const kv of m[2].split(",")) { const [a, b] = kv.split("="); props[a] = b; }
    states[num(v)] = { name: m[1], props };
  }
  const grid = readVarints(data, w * h * d);
  return { w, h, d, grid, states, java: true };
}
function readStructureNbt(root) {
  const [w, h, d] = root.size.map(Number);
  const palette = root.palette || (root.palettes && root.palettes[0]) || [];
  const states = palette.map(s => ({ name: s.Name, props: s.Properties || {} }));
  states.push({ name: "minecraft:air", props: {} });
  const air = states.length - 1;
  const grid = new Uint32Array(w * h * d).fill(air);
  for (const b of root.blocks || []) { const [x, y, z] = b.pos; grid[(y * d + z) * w + x] = b.state; }
  return { w, h, d, grid, states, java: true };
}
function readMcstructure(root) {
  const [w, h, d] = root.size.map(Number);
  const st = root.structure;
  const idx = st.block_indices[0];
  const pal = st.palette.default.block_palette;
  const states = pal.map(p => ({ name: p.name, props: p.states || {}, bedrock: true }));
  states.push({ name: "minecraft:structure_void", props: {}, bedrock: true });
  const voidI = states.length - 1;
  const grid = new Uint32Array(w * h * d);
  // mcstructure goes x, then y, then z fastest
  let i = 0;
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++, i++) { const v = idx[i]; grid[(y * d + z) * w + x] = v < 0 ? voidI : v; }
  return { w, h, d, grid, states, java: false };
}

const COLOR_OF = new Map(PALETTE.map(p => [p[0].split("|")[0], p[4]]));
function guessColor(id) {
  if (COLOR_OF.has(id)) return COLOR_OF.get(id);
  const bare = id.replace(/^minecraft:/, "");
  for (const [k, c] of COLOR_OF) if (bare.startsWith(k.replace(/^minecraft:/, "").replace(/_planks$|_block$|_wool$|_concrete$/, ""))) return c;
  if (/water/.test(id)) return [60, 90, 200]; if (/lava/.test(id)) return [220, 100, 20]; if (/leaves|grass|vine|fern/.test(id)) return [70, 130, 50];
  return [140, 140, 140];
}

const ITEM_OF = { wall_sign: "oak_sign", standing_sign: "oak_sign", wall_banner: "banner", standing_banner: "banner", redstone_wire: "redstone", tripwire: "string", unlit_redstone_torch: "redstone_torch", reeds: "sugar_cane", cocoa: "cocoa_beans", wheat: "wheat_seeds", carrots: "carrot", potatoes: "potato", beetroot: "beetroot_seeds", melon_stem: "melon_seeds", pumpkin_stem: "pumpkin_seeds", water: "water_bucket", lava: "lava_bucket", powder_snow: "powder_snow_bucket", lit_furnace: "furnace", lit_smoker: "smoker", lit_blast_furnace: "blast_furnace", lit_redstone_lamp: "redstone_lamp", unpowered_repeater: "repeater", powered_repeater: "repeater", unpowered_comparator: "comparator", powered_comparator: "comparator", kelp: "kelp" };
const SKIP_ITEM = /^(air|structure_void|fire|soul_fire|bubble_column|piston_arm_collision|moving_block|portal|end_portal|end_gateway|frosted_ice|light_block|barrier)$/;
function itemFor(entry) {
  const [id0, , flags = ""] = entry.split("|");
  const id = id0.replace(/^minecraft:/, "");
  if (SKIP_ITEM.test(id)) return null;
  if (/T/.test(flags) && /door|bed|tall_grass|large_fern|sunflower|lilac|peony|rose_bush|pitcher_plant|seagrass|dripleaf/.test(id)) return null;
  let m = id.match(/^(.*)_double_slab$/); if (m) return [(m[1] === "normal_stone" ? "stone" : m[1]) + "_slab", 2];
  m = id.match(/^(.*)_(standing|wall)_sign$/); if (m) return [m[1] + "_sign", 1];
  if (id.includes(":")) return [id, 1];
  return [ITEM_OF[id] || id, 1];
}
function materials(bp, data) {
  data = data || decode(bp);
  const per = new Map();
  for (let i = 0; i < data.length; i++) if (data[i]) per.set(data[i], (per.get(data[i]) || 0) + 1);
  const totals = new Map();
  for (const [v, n] of per) { const it = itemFor(bp.pal[v] || ""); if (!it) continue; totals.set(it[0], (totals.get(it[0]) || 0) + n * it[1]); }
  return [...totals].sort((a, b) => b[1] - a[1]);
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(); const parts = [], central = []; let off = 0;
  for (const [name, content] of files) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const nm = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}
function packScript(libId, bps) {
  const strings = bps.map(b => JSON.stringify({ name: b.name, size: b.size, pal: b.pal, data: b.data }));
  return `// Made by Genesis Studio. Hands these blueprints to Genesis when the world loads.
import { world, system } from "@minecraft/server";
const LIB = ${JSON.stringify(libId)};
const BPS = [
${strings.map(s => JSON.stringify(s)).join(",\n")}
];
const SIZE = 1800;
let sending = false, lastSend = -1000;
function send() {
  if (sending || system.currentTick - lastSend < 100) return;
  sending = true; lastSend = system.currentTick;
  const msgs = [];
  BPS.forEach((s, i) => { const n = Math.ceil(s.length / SIZE); for (let j = 0; j < n; j++) msgs.push(LIB + "|" + i + "|" + j + "|" + n + "|" + s.slice(j * SIZE, (j + 1) * SIZE)); });
  let k = 0;
  const id = system.runInterval(() => {
    for (let c = 0; c < 16 && k < msgs.length; c++, k++) { try { system.sendScriptEvent("builder:bp", msgs[k]); } catch (e) { } }
    if (k >= msgs.length) { system.clearRun(id); try { system.sendScriptEvent("builder:bpdone", LIB + "|" + BPS.length); } catch (e) { } sending = false; }
  }, 1);
}
system.afterEvents.scriptEventReceive.subscribe(ev => { if (ev.id === "builder:hello") system.run(send); });
try { world.afterEvents.worldLoad.subscribe(() => system.runTimeout(send, 60)); } catch (e) { system.runTimeout(send, 100); }
`;
}
// ================= 3D models to voxels =================
// A model becomes a list of triangles. Each triangle can carry a flat color, colors per corner,
// or texture coordinates into a picture. Then the triangles are sampled into a block grid.
const lin2srgb = c => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));

function makeModel() { return { pos: [], uv: [], col: [], mat: [], mats: [] }; }
// a material: { color: [r,g,b] 0-255, tex: ImageData or null }
function addTri(M, p, uv, col, m) { M.pos.push(...p); M.uv.push(...(uv || [NaN, NaN, NaN, NaN, NaN, NaN])); M.col.push(...(col || [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN])); M.mat.push(m); }

async function decodeImage(bytes, type) {
  const blob = new Blob([bytes], { type: type || "image/png" });
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
  return x.getImageData(0, 0, c.width, c.height);
}

// ---------- OBJ (with optional MTL and textures picked at the same time) ----------
const NAMED = { red: [200, 40, 40], green: [60, 160, 60], blue: [50, 80, 200], yellow: [230, 200, 50], white: [235, 235, 235], black: [30, 30, 30], gray: [128, 128, 128], grey: [128, 128, 128], brown: [120, 80, 45], orange: [230, 120, 30], pink: [230, 140, 170], purple: [130, 60, 170], wood: [150, 110, 70], metal: [170, 170, 180], glass: [180, 210, 230], skin: [230, 190, 160], gold: [220, 180, 60], stone: [125, 125, 125], grass: [90, 150, 60], leaf: [70, 140, 50] };
function guessByName(n) { n = (n || "").toLowerCase(); for (const k in NAMED) if (n.includes(k)) return NAMED[k]; return null; }
async function parseMTL(text, files) {
  const mats = {}; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim().split(/\s+/);
    if (l[0] === "newmtl") { cur = mats[l.slice(1).join(" ")] = { color: [200, 200, 200], tex: null }; }
    else if (cur && l[0] === "Kd") cur.color = [1, 2, 3].map(i => Math.round(Math.min(1, +l[i]) * 255));
    else if (cur && l[0] === "map_Kd") {
      const name = l[l.length - 1].split(/[\\/]/).pop().toLowerCase();
      const f = files.find(x => x.name.toLowerCase() === name);
      if (f) { try { cur.tex = await decodeImage(new Uint8Array(await f.arrayBuffer()), f.type); } catch (e) { } }
    }
  }
  return mats;
}
async function parseOBJ(text, files = []) {
  const M = makeModel();
  const v = [], vc = [], vt = [];
  let mtl = {};
  const mtlFile = files.find(f => /\.mtl$/i.test(f.name));
  if (mtlFile) mtl = await parseMTL(await mtlFile.text(), files);
  let matIdx = -1;
  const matOf = name => { const i = M.mats.findIndex(m => m.name === name); if (i >= 0) return i; const m = mtl[name] || { color: guessByName(name) || [190, 190, 190], tex: null }; M.mats.push({ name, color: m.color, tex: m.tex }); return M.mats.length - 1; };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l[0] === "#") continue;
    const p = l.split(/\s+/);
    if (p[0] === "v") { v.push([+p[1], +p[2], +p[3]]); vc.push(p.length >= 7 ? [+p[4], +p[5], +p[6]].map(c => c > 1 ? c : c * 255) : null); }
    else if (p[0] === "vt") vt.push([+p[1], +(p[2] || 0)]);
    else if (p[0] === "usemtl") matIdx = matOf(p.slice(1).join(" "));
    else if (p[0] === "f") {
      if (matIdx < 0) matIdx = matOf("default");
      const idx = p.slice(1).map(s => { const q = s.split("/"); const a = +q[0], b = q[1] ? +q[1] : 0; return [a < 0 ? v.length + a : a - 1, b ? (b < 0 ? vt.length + b : b - 1) : -1]; });
      for (let k = 1; k + 1 < idx.length; k++) {
        const tri = [idx[0], idx[k], idx[k + 1]];
        const pos = tri.flatMap(([a]) => v[a] || [0, 0, 0]);
        const uv = tri.every(([, b]) => b >= 0 && vt[b]) ? tri.flatMap(([, b]) => vt[b]) : null;
        const col = tri.every(([a]) => vc[a]) ? tri.flatMap(([a]) => vc[a]) : null;
        addTri(M, pos, uv, col, matIdx);
      }
    }
  }
  if (!M.mat.length) throw new Error("I couldn't find any faces in that OBJ file.");
  M.up = "y";
  return M;
}

// ---------- STL ----------
function parseSTL(buf) {
  const M = makeModel(); M.mats.push({ name: "model", color: [190, 190, 190], tex: null }); M.up = "z";
  const u8 = new Uint8Array(buf);
  const head = new TextDecoder().decode(u8.slice(0, 256));
  const dv = new DataView(buf);
  const binCount = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (binCount && 84 + binCount * 50 === buf.byteLength) {
    for (let i = 0; i < binCount; i++) { const o = 84 + i * 50 + 12; const p = []; for (let k = 0; k < 9; k++) p.push(dv.getFloat32(o + k * 4, true)); addTri(M, p, null, null, 0); }
  } else if (/^\s*solid/.test(head)) {
    const t = new TextDecoder().decode(u8); const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g; let m, p = [];
    while ((m = re.exec(t))) { p.push(+m[1], +m[2], +m[3]); if (p.length === 9) { addTri(M, p, null, null, 0); p = []; } }
  } else throw new Error("That STL file looks damaged.");
  return M;
}

// ---------- glTF and GLB ----------
const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(g, bufs, i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
  if (!bv) return null;
  const [T, size] = COMP[a.componentType], n = NCOMP[a.type];
  const stride = bv.byteStride || size * n;
  const buf = bufs[bv.buffer], base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const out = new Float32Array(a.count * n);
  const norm = a.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] : 0;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = base + k * stride + c * size;
    let v;
    switch (a.componentType) { case 5126: v = dv.getFloat32(o, true); break; case 5125: v = dv.getUint32(o, true); break; case 5123: v = dv.getUint16(o, true); break; case 5122: v = dv.getInt16(o, true); break; case 5121: v = dv.getUint8(o); break; default: v = dv.getInt8(o); }
    out[k * n + c] = norm ? v / norm : v;
  }
  return { data: out, n };
}
function mat4mul(a, b) { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function nodeMatrix(nd) {
  if (nd.matrix) return nd.matrix.slice();
  const [tx, ty, tz] = nd.translation || [0, 0, 0], [qx, qy, qz, qw] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1];
  const r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0, 2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0, 2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0, 0, 0, 0, 1];
  for (let i = 0; i < 3; i++) { r[i] *= sx; r[4 + i] *= sy; r[8 + i] *= sz; }
  r[12] = tx; r[13] = ty; r[14] = tz; return r;
}
function b64bytes(uri) { const s = atob(uri.split(",")[1]); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function parseGLTF(g, bin, files = []) {
  if ((g.extensionsUsed || []).includes("KHR_draco_mesh_compression") || (g.extensionsUsed || []).includes("EXT_meshopt_compression")) throw new Error("This model is compressed. Export it again without Draco or meshopt compression, then try again.");
  const bufs = await Promise.all((g.buffers || []).map(async (b, i) => {
    if (b.uri && b.uri.startsWith("data:")) return b64bytes(b.uri);
    if (b.uri) { const f = files.find(x => x.name === b.uri.split("/").pop()); if (f) return new Uint8Array(await f.arrayBuffer()); throw new Error(`The model needs ${b.uri}. Pick it together with the .gltf file, or use a .glb.`); }
    return bin;
  }));
  const M = makeModel(); M.up = "y";
  const texCache = new Map();
  const imageData = async ti => {
    if (texCache.has(ti)) return texCache.get(ti);
    let img = null;
    try {
      const t = g.textures[ti], im = g.images[t.source];
      if (im.bufferView !== undefined) { const bv = g.bufferViews[im.bufferView]; img = await decodeImage(bufs[bv.buffer].slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), im.mimeType); }
      else if (im.uri && im.uri.startsWith("data:")) img = await decodeImage(b64bytes(im.uri), im.uri.slice(5, im.uri.indexOf(";")));
      else if (im.uri) { const f = files.find(x => x.name === im.uri.split("/").pop()); if (f) img = await decodeImage(new Uint8Array(await f.arrayBuffer()), f.type); }
    } catch (e) { img = null; }
    texCache.set(ti, img); return img;
  };
  for (const [mi, m] of (g.materials || [{}]).entries()) {
    const pb = m.pbrMetallicRoughness || {};
    const f = pb.baseColorFactor || [1, 1, 1, 1];
    const tex = pb.baseColorTexture ? await imageData(pb.baseColorTexture.index) : null;
    M.mats.push({ name: m.name || "material " + mi, color: [lin2srgb(f[0]), lin2srgb(f[1]), lin2srgb(f[2])], tex, factor: f });
  }
  if (!M.mats.length) M.mats.push({ name: "default", color: [200, 200, 200], tex: null, factor: [1, 1, 1, 1] });
  const visit = (ni, parent) => {
    const nd = g.nodes[ni]; const mtx = mat4mul(parent, nodeMatrix(nd));
    if (nd.mesh !== undefined) for (const pr of g.meshes[nd.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const P = readAccessor(g, bufs, pr.attributes.POSITION); if (!P) continue;
      const UV = pr.attributes.TEXCOORD_0 !== undefined ? readAccessor(g, bufs, pr.attributes.TEXCOORD_0) : null;
      const CO = pr.attributes.COLOR_0 !== undefined ? readAccessor(g, bufs, pr.attributes.COLOR_0) : null;
      const I = pr.indices !== undefined ? readAccessor(g, bufs, pr.indices).data : null;
      const cnt = I ? I.length : P.data.length / 3;
      const mat = pr.material !== undefined ? pr.material : 0;
      const tp = k => { const x = P.data[k * 3], y = P.data[k * 3 + 1], z = P.data[k * 3 + 2]; return [mtx[0] * x + mtx[4] * y + mtx[8] * z + mtx[12], mtx[1] * x + mtx[5] * y + mtx[9] * z + mtx[13], mtx[2] * x + mtx[6] * y + mtx[10] * z + mtx[14]]; };
      for (let t = 0; t + 2 < cnt; t += 3) {
        const ks = [0, 1, 2].map(j => I ? I[t + j] : t + j);
        const pos = ks.flatMap(tp);
        const uv = UV ? ks.flatMap(k => [UV.data[k * 2], UV.data[k * 2 + 1]]) : null;
        const col = CO ? ks.flatMap(k => [0, 1, 2].map(c => lin2srgb(CO.data[k * CO.n + c]))) : null;
        addTri(M, pos, uv, col, mat);
      }
    }
    for (const c of nd.children || []) visit(c, mtx);
  };
  const scene = g.scenes ? g.scenes[g.scene || 0] : { nodes: g.nodes.map((_, i) => i) };
  for (const ni of scene.nodes) visit(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (!M.mat.length) throw new Error("I couldn't find any triangles in that model.");
  return M;
}
async function parseGLB(buf, files) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("That isn't a GLB file.");
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const data = new Uint8Array(buf, off + 8, len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data)); else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return parseGLTF(json, bin, files);
}

// ---------- MagicaVoxel .vox (already blocks) ----------
function parseVOX(buf) {
  const dv = new DataView(buf); const td = new TextDecoder();
  if (td.decode(new Uint8Array(buf, 0, 4)) !== "VOX ") throw new Error("That isn't a MagicaVoxel file.");
  let off = 8; const models = []; let size = null; let pal = null;
  const read = (end) => {
    while (off < end) {
      const id = td.decode(new Uint8Array(buf, off, 4)), n = dv.getUint32(off + 4, true), ch = dv.getUint32(off + 8, true);
      const body = off + 12;
      if (id === "SIZE") size = [dv.getUint32(body, true), dv.getUint32(body + 4, true), dv.getUint32(body + 8, true)];
      else if (id === "XYZI") { const c = dv.getUint32(body, true); const vox = new Uint8Array(buf, body + 4, c * 4).slice(); models.push({ size, vox }); }
      else if (id === "RGBA") { pal = []; for (let i = 0; i < 256; i++) pal.push([dv.getUint8(body + i * 4), dv.getUint8(body + i * 4 + 1), dv.getUint8(body + i * 4 + 2), dv.getUint8(body + i * 4 + 3)]); }
      off = body + n;
      if (ch) read(off + ch);
    }
  };
  read(buf.byteLength);
  if (!models.length) throw new Error("That .vox file has no voxels.");
  if (!pal) { pal = []; for (let i = 0; i < 256; i++) { const v = 255 - i; pal.push([v, v, v, 255]); } }
  return { vox: models[0], pal, extra: models.length - 1 };
}

// ---------- sampling triangles into blocks ----------
function sampleTex(img, u, v) {
  u = u - Math.floor(u); v = v - Math.floor(v);
  const x = Math.min(img.width - 1, Math.floor(u * img.width)), y = Math.min(img.height - 1, Math.floor((1 - v) * img.height));
  const i = (y * img.width + x) * 4; const d = img.data;
  return d[i + 3] < 30 ? null : [d[i], d[i + 1], d[i + 2]];
}
// opts: { size: longest side in blocks, up: "y" | "z" | "x", turn: 0-3, solid: bool, single: [r,g,b] | null }
function voxelize(M, opts) {
  const up = opts.up || M.up || "y";
  const T = M.pos.length / 9;
  const map = (x, y, z) => { let p = up === "z" ? [x, z, -y] : up === "x" ? [y, x, z] : [x, y, z]; for (let t = 0; t < (opts.turn || 0); t++) p = [-p[2], p[1], p[0]]; return p; };
  const P = new Float32Array(M.pos.length);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < M.pos.length; i += 3) { const q = map(M.pos[i], M.pos[i + 1], M.pos[i + 2]); for (let c = 0; c < 3; c++) { P[i + c] = q[c]; if (q[c] < mn[c]) mn[c] = q[c]; if (q[c] > mx[c]) mx[c] = q[c]; } }
  const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  const s = (opts.size - 1) / ext;
  const W = Math.max(1, Math.ceil((mx[0] - mn[0]) * s) + 1), H = Math.max(1, Math.ceil((mx[1] - mn[1]) * s) + 1), D = Math.max(1, Math.ceil((mx[2] - mn[2]) * s) + 1);
  const cells = new Map();
  const add = (x, y, z, c) => {
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return;
    const k = (y * D + z) * W + x;
    let a = cells.get(k); if (!a) { a = [0, 0, 0, 0]; cells.set(k, a); }
    if (c) { a[0] += c[0]; a[1] += c[1]; a[2] += c[2]; a[3]++; }
  };
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const a = [(P[o] - mn[0]) * s, (P[o + 1] - mn[1]) * s, (P[o + 2] - mn[2]) * s], b = [(P[o + 3] - mn[0]) * s, (P[o + 4] - mn[1]) * s, (P[o + 5] - mn[2]) * s], c = [(P[o + 6] - mn[0]) * s, (P[o + 7] - mn[1]) * s, (P[o + 8] - mn[2]) * s];
    const e = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]), Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]));
    const n = Math.min(1500, Math.max(1, Math.ceil(e * 2)));
    const mat = M.mats[M.mat[t]] || M.mats[0];
    const hasCol = !isNaN(M.col[o]);
    const hasUV = !isNaN(M.uv[t * 6]) && mat && mat.tex;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      const x = a[0] * w + b[0] * u + c[0] * v, y = a[1] * w + b[1] * u + c[1] * v, z = a[2] * w + b[2] * u + c[2] * v;
      let col = opts.single;
      if (!col) {
        if (hasUV) { const uv = M.uv; const tu = uv[t * 6] * w + uv[t * 6 + 2] * u + uv[t * 6 + 4] * v, tv = uv[t * 6 + 1] * w + uv[t * 6 + 3] * u + uv[t * 6 + 5] * v; col = sampleTex(mat.tex, tu, tv); if (col && mat.factor) col = col.map((q, k) => q * Math.min(1, mat.factor[k] * 1.0)); }
        else if (hasCol) col = [0, 1, 2].map(k => M.col[o + k] * w + M.col[o + 3 + k] * u + M.col[o + 6 + k] * v);
        else col = mat ? mat.color : [190, 190, 190];
      }
      add(Math.round(x), Math.round(y), Math.round(z), col);
    }
  }
  return finishGrid(W, H, D, cells, opts.solid);
}
function voxFromVOX(V, opts) {
  const [sx, sy, sz] = V.vox.size;
  const scale = opts.scale || 1;
  let W = sx * scale, D = sy * scale, H = sz * scale;
  const cells = new Map();
  const v = V.vox.vox;
  for (let i = 0; i < v.length; i += 4) {
    const x = v[i], y = v[i + 1], z = v[i + 2], ci = v[i + 3];
    const c = V.pal[(ci - 1 + 256) % 256];
    for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) for (let d = 0; d < scale; d++) {
      const X = x * scale + a, Y = z * scale + b, Z = (sy - 1 - y) * scale + d;
      cells.set((Y * D + Z) * W + X, [c[0], c[1], c[2], 1]);
    }
  }
  return finishGrid(W, H, D, cells, false);
}
// optional solid fill: anything the outside can't reach becomes part of the build
function finishGrid(W, H, D, cells, solid) {
  if (solid && W * H * D <= 64e6) {
    const g = new Uint8Array(W * H * D);
    for (const k of cells.keys()) g[k] = 1;
    const q = new Int32Array(W * H * D); let qh = 0, qt = 0;
    const push = k => { if (!g[k]) { g[k] = 2; q[qt++] = k; } };
    for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || z === 0 || x === W - 1 || y === H - 1 || z === D - 1) push((y * D + z) * W + x);
    while (qh < qt) { const k = q[qh++]; const x = k % W, z = Math.floor(k / W) % D, y = Math.floor(k / (W * D)); if (x > 0) push(k - 1); if (x < W - 1) push(k + 1); if (z > 0) push(k - W); if (z < D - 1) push(k + W); if (y > 0) push(k - W * D); if (y < H - 1) push(k + W * D); }
    let filler = [128, 128, 128, 1];
    for (let k = 0; k < g.length; k++) if (g[k] === 0) cells.set(k, filler);
  }
  return { size: [W, H, D], cells };
}

// isometric preview of a voxel set: colors per cell index
function drawIso(canvas, size, colorAt, keys) {
  const [W, H, D] = size;
  const maxC = 150000;
  const step = keys.length > maxC ? Math.ceil(keys.length / maxC) : 1;
  const sorted = [];
  for (let i = 0; i < keys.length; i += step) sorted.push(keys[i]);
  const xyz = k => [k % W, Math.floor(k / (W * D)), Math.floor(k / W) % D];
  sorted.sort((a, b) => { const A = xyz(a), B = xyz(b); return (A[0] + A[2]) - (B[0] + B[2]) || A[1] - B[1]; });
  const span = W + D, tall = H;
  const a = Math.max(1, Math.min(10, Math.floor(520 / Math.max(span, tall * 1.2))));
  canvas.width = Math.ceil(span * a) + 4; canvas.height = Math.ceil(span * a / 2 + tall * a) + 4;
  const c = canvas.getContext("2d"); c.clearRect(0, 0, canvas.width, canvas.height);
  const ox = D * a + 2, oy = tall * a + 2;
  for (const k of sorted) {
    const [x, y, z] = xyz(k), col = colorAt(k); if (!col) continue;
    const sx = ox + (x - z) * a, sy = oy + (x + z) * a / 2 - y * a;
    const sh = f => `rgb(${col[0] * f | 0},${col[1] * f | 0},${col[2] * f | 0})`;
    c.fillStyle = sh(1.0); c.beginPath(); c.moveTo(sx, sy - a / 2); c.lineTo(sx + a, sy); c.lineTo(sx, sy + a / 2); c.lineTo(sx - a, sy); c.fill();
    c.fillStyle = sh(0.78); c.beginPath(); c.moveTo(sx - a, sy); c.lineTo(sx, sy + a / 2); c.lineTo(sx, sy + a * 1.5); c.lineTo(sx - a, sy + a); c.fill();
    c.fillStyle = sh(0.62); c.beginPath(); c.moveTo(sx + a, sy); c.lineTo(sx, sy + a / 2); c.lineTo(sx, sy + a * 1.5); c.lineTo(sx + a, sy + a); c.fill();
  }
  canvas.hidden = false;
}

// ================= Genesis Studio: reading any kind of file =================
// Every file is looked at by what is inside it, not only by its name. Pictures, photos, drawings,
// 3D models, schematics, command files, videos, music, documents, archives, fonts and plain text all
// become something that can be built. A file nothing else understands still has a pattern, and that
// pattern can be built too.

const LIMIT_PIXELS = 4096 * 4096;
const td8 = new TextDecoder("utf-8");
const ascii = (u, a, n) => { let s = ""; for (let i = a; i < a + n && i < u.length; i++) s += String.fromCharCode(u[i]); return s; };
const extOf = n => ((n || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
function asFile(bytes, name, type) { try { return new File([bytes], name, { type: type || "" }); } catch (e) { const b = new Blob([bytes], { type: type || "" }); b.name = name; return b; } }

// ---------- a canvas that the picture code can treat like an image ----------
function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; c.naturalWidth = w; c.naturalHeight = h; return c; }
function canvasFromRGBA(w, h, rgba) { const c = canvasOf(w, h); const x = c.getContext("2d"); const id = x.createImageData(w, h); id.data.set(rgba.subarray ? rgba.subarray(0, w * h * 4) : rgba); x.putImageData(id, 0, 0); return c; }
function canvasFromDrawable(d, w, h) {
  w = w || d.naturalWidth || d.videoWidth || d.width; h = h || d.naturalHeight || d.videoHeight || d.height;
  const sc = Math.min(1, Math.sqrt(LIMIT_PIXELS / Math.max(1, w * h)));
  const c = canvasOf(Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)));
  c.getContext("2d").drawImage(d, 0, 0, c.width, c.height); return c;
}
function dataURL(bytes, mime) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(new Blob([bytes], { type: mime || "application/octet-stream" })); }); }
async function imgFromURL(url) { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("no")); img.src = url; }); return img; }
// the browser's own decoders first: no web addresses needed, so it works even inside strict pages
async function browserPicture(bytes, mime) {
  try { const bmp = await createImageBitmap(new Blob([bytes], { type: mime || "" })); return canvasFromDrawable(bmp); } catch (e) { }
  try { return canvasFromDrawable(await imgFromURL(await dataURL(bytes, mime))); } catch (e) { }
  try { const u = URL.createObjectURL(new Blob([bytes], { type: mime || "" })); try { return canvasFromDrawable(await imgFromURL(u)); } finally { setTimeout(() => URL.revokeObjectURL(u), 5000); } } catch (e) { }
  return null;
}

// ---------- what is it, really ----------
function sniff(u, name, mime) {
  const e = extOf(name), a4 = ascii(u, 0, 4), a12 = ascii(u, 0, 12);
  if (u[0] === 0x89 && a4.slice(1) === "PNG") return "png";
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return "jpeg";
  if (a4 === "GIF8") return "gif";
  if (a4 === "RIFF" && ascii(u, 8, 4) === "WEBP") return "webp";
  if (a4 === "RIFF" && ascii(u, 8, 4) === "WAVE") return "audio";
  if (a4 === "RIFF" && ascii(u, 8, 4) === "AVI ") return "video";
  if (u[0] === 0x42 && u[1] === 0x4d && e !== "txt") return "bmp";
  if (a4 === "8BPS") return "psd";
  if (a4 === "qoif") return "qoi";
  if ((a4 === "II*\0" || a4 === "MM\0*")) return "tiff";
  if (u[0] === 0 && u[1] === 0 && (u[2] === 1 || u[2] === 2) && u[3] === 0 && (e === "ico" || e === "cur" || u.length > 6 && u[4] > 0 && u[5] === 0)) return "ico";
  if (ascii(u, 4, 4) === "ftyp") { const br = ascii(u, 8, 4); if (/avif|avis/.test(br)) return "avif"; if (/hei|mif1|msf1/.test(br)) return "heic"; if (/M4A |M4B |mp42?/.test(br) && /m4a|m4b|aac/.test(e)) return "audio"; return "video"; }
  if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return /mka|weba/.test(e) ? "audio" : "video";
  if (a4 === "OggS") return /ogv/.test(e) ? "video" : "audio";
  if (a4 === "fLaC" || ascii(u, 0, 3) === "ID3" || (u[0] === 0xff && (u[1] & 0xe0) === 0xe0 && /mp3|mpga|aac|m4a/.test(e)) || (u[0] === 0xff && (u[1] & 0xf6) === 0xf0)) return "audio";
  if (a4 === "MThd") return "midi";
  if (a4 === "%PDF") return "pdf";
  if (u[0] === 0x50 && u[1] === 0x4b && (u[2] === 3 || u[2] === 5) && (u[3] === 4 || u[3] === 6)) return "zip";
  if (u[0] === 0x1f && u[1] === 0x8b) return "gzip";
  if (ascii(u, 257, 5) === "ustar") return "tar";
  if (a4 === "glTF") return "glb";
  if (a4 === "VOX ") return "vox";
  if (a4 === "wOFF" || a4 === "wOF2" || a4 === "OTTO" || a4 === "true" || (u[0] === 0 && u[1] === 1 && u[2] === 0 && u[3] === 0 && /ttf|otf|ttc/.test(e))) return "font";
  if (ascii(u, 0, 4) === "ply\n" || ascii(u, 0, 5) === "ply\r\n") return "ply";
  if (e === "mcstructure" || (u[0] === 0x0a && u[1] === 0x00 && u[2] === 0x00 && e === "mcstructure")) return "mcstructure";
  if (/^(litematic|schem|schematic|nbt)$/.test(e)) return "nbt";
  if (u[0] === 0x0a && (u[1] === 0x00) && u[2] < 0x40 && !isText(u)) return "nbt";
  if (e === "tga" || e === "icb" || e === "vda" || e === "vst") return "tga";
  if (/^P[1-6]\s/.test(ascii(u, 0, 3)) || /^(pbm|pgm|ppm|pnm|pam)$/.test(e)) return "pnm";
  if (e === "stl" && !isText(u)) return "stl";
  if (e === "fbx" || ascii(u, 0, 18) === "Kaydara FBX Binary") return "fbx";
  if (e === "blend" || ascii(u, 0, 7) === "BLENDER") return "blend";
  if (/^(mcworld|mctemplate)$/.test(e)) return "zip";
  if (isText(u)) return "text";
  if (/^image\//.test(mime || "")) return "image";
  if (/^video\//.test(mime || "")) return "video";
  if (/^audio\//.test(mime || "")) return "audio";
  return "binary";
}
function isText(u) {
  const n = Math.min(u.length, 4096); if (!n) return false;
  let bad = 0; for (let i = 0; i < n; i++) { const c = u[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) bad++; }
  return bad / n < 0.02;
}

// ---------- the main door: bytes in, things that can be built out ----------
// each item: { kind: picture|model|vox|schematic, label, found, img|model|vox|file|S, name, prompt }
async function intake(bytes, name, mime, siblings, depth = 0) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const type = sniff(u, name, mime), base = (name || "file").split("/").pop();
  const pic = (img, what) => [{ kind: "picture", img, name: base, label: `${base}, ${what}`, found: `${what}, ${img.naturalWidth} by ${img.naturalHeight} pixels` }];
  switch (type) {
    case "png": case "jpeg": case "gif": case "webp": case "bmp": case "ico": case "avif": case "image": {
      const c = await browserPicture(u, mime || ({ png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" }[type]));
      if (c) return pic(c, ({ png: "a PNG picture", jpeg: "a photo", gif: "a GIF picture", webp: "a WebP picture", bmp: "a bitmap picture", ico: "an icon", avif: "an AVIF picture", image: "a picture" })[type]);
      if (type === "bmp") return pic(decodeBMP(u), "a bitmap picture");
      throw new Error(`I could see that ${base} is a picture, but it seems damaged or cut short. Try saving it again as a PNG.`);
    }
    case "heic": {
      const c = await browserPicture(u, "image/heic");
      if (c) return pic(c, "a HEIC photo");
      throw new Error(`${base} is a HEIC photo, the kind iPhones take. This browser cannot open those. On the phone, share it as JPG (or set Camera Formats to Most Compatible), then bring it here.`);
    }
    case "tiff": return pic(await decodeTIFF(u), "a TIFF picture");
    case "psd": return pic(decodePSD(u), "a Photoshop picture");
    case "qoi": return pic(decodeQOI(u), "a QOI picture");
    case "tga": return pic(decodeTGA(u), "a Targa picture");
    case "pnm": return pic(decodePNM(u), "a Netpbm picture");
    case "glb": { const m = await parseGLB(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), siblings || []); return [modelItem(m, base, "a GLB 3D model")]; }
    case "vox": { const v = parseVOX(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); return [{ kind: "vox", vox: v, name: base, label: `${base}, a voxel model`, found: `a MagicaVoxel model, ${v.vox.size.join(" by ")} voxels${v.extra ? ` (I will use the first of ${v.extra + 1} models)` : ""}` }]; }
    case "ply": return [modelItem(parsePLY(u), base, "a PLY 3D model")];
    case "stl": return [modelItem(parseSTL(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)), base, "an STL 3D model")];
    case "mcstructure": case "nbt": return [{ kind: "schematic", file: asFile(u, /\.[a-z]+$/i.test(base) ? base : base + (type === "mcstructure" ? ".mcstructure" : ".nbt")), name: base, label: `${base}, a schematic`, found: "a schematic" }];
    case "gzip": {
      const out = new Uint8Array(await gunzipMaybe(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)));
      const inner = base.replace(/\.(gz|tgz)$/i, (m) => m.toLowerCase() === ".tgz" ? ".tar" : "");
      if (/^(litematic|schem|schematic|nbt)$/.test(extOf(base))) return [{ kind: "schematic", file: asFile(u, base), name: base, label: `${base}, a schematic`, found: "a schematic" }];
      if (depth > 3) return [];
      return intake(out, inner || base, "", siblings, depth + 1);
    }
    case "zip": return readArchive(await unzip(u), base, depth, "zip");
    case "tar": return readArchive(untar(u), base, depth, "tar");
    case "pdf": return readPDF(u, base);
    case "video": return readVideo(u, base, mime);
    case "audio": return [await readAudio(u, base)];
    case "midi": return [readMIDI(u, base)];
    case "font": return [await readFont(u, base)];
    case "fbx": case "blend": throw new Error(`${base} is a ${type === "fbx" ? "FBX" : "Blender"} file. Those keep their shapes in a private form. In Blender (it is free), choose File, then Export, then glTF or OBJ, and bring that here.`);
    case "text": return readText(u, base, siblings, depth);
    default: return [bytesArt(u, base)];
  }
}
function modelItem(m, base, what) {
  const tex = m.mats && m.mats.some(x => x.tex);
  return { kind: "model", model: m, name: base, label: `${base}, ${what}`, found: `${what} with ${fmt(m.mat.length)} triangle${m.mat.length === 1 ? "" : "s"}${tex ? " and textures" : m.col && m.col.some(c => !isNaN(c)) ? " and colors" : ""}` };
}

// ---------- text: models, commands, numbers, words ----------
async function readText(u, base, siblings, depth) {
  const text = td8.decode(u).replace(/^﻿/, ""), e = extOf(base), head = text.slice(0, 4000);
  const t = head.trimStart();
  if (/^\s*<svg[\s>]|<svg[\s>]/i.test(head) && (e === "svg" || /^<(\?xml|svg|!DOCTYPE svg)/i.test(t))) {
    const c = await browserPicture(u, "image/svg+xml"); if (c) return [{ kind: "picture", img: c, name: base, label: `${base}, a drawing`, found: `a vector drawing, ${c.naturalWidth} by ${c.naturalHeight}` }];
  }
  if (/<COLLADA/i.test(head)) return [modelItem(parseDAE(text), base, "a Collada 3D model")];
  if (/^solid\b/.test(t) && /facet\s+normal/.test(text.slice(0, 20000))) return [modelItem(parseSTL(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)), base, "an STL 3D model")];
  if (e === "obj" || /^(v|vt|vn|f|o|g|usemtl|mtllib)\s/m.test(head) && /^v\s+-?[\d.]/m.test(head) && /^f\s/m.test(text)) return [modelItem(await parseOBJ(text, siblings || []), base, "an OBJ 3D model")];
  if (/^ply\b/.test(t)) return [modelItem(parsePLY(u), base, "a PLY 3D model")];
  if (/^OFF\b/.test(t)) return [modelItem(parseOFF(text), base, "an OFF 3D model")];
  if (/^\s*[\[{]/.test(t)) {
    let j = null; try { j = JSON.parse(text); } catch (er) { }
    if (j) {
      if (j.asset && (j.meshes || j.nodes)) return [modelItem(await parseGLTF(j, null, siblings || []), base, "a glTF 3D model")];
      if (j.elements && (j.meta || j.resolution || j.textures)) return [modelItem(await parseBBModel(j), base, "a Blockbench model")];
      if (j["minecraft:geometry"] || (j.format_version && JSON.stringify(j).includes("\"cubes\""))) return [modelItem(parseBedrockGeo(j), base, "a Bedrock geometry model")];
      if (Array.isArray(j) && j.length && j.every(r => typeof r === "number")) return [{ kind: "picture", img: chartCanvas([j], ["values"], base), name: base, label: `${base}, numbers`, found: `${j.length} numbers, drawn as a bar chart` }];
    }
  }
  const lines = text.split(/\r?\n/);
  const cmds = lines.filter(l => /^\s*\/?(setblock|fill)\s/i.test(l)).length;
  if (cmds && (e === "mcfunction" || cmds >= Math.min(3, lines.length))) { const S = readCommands(lines); if (S) return [{ kind: "schematic", S, name: base, label: `${base}, Minecraft commands`, found: `${fmt(cmds)} Minecraft commands that place blocks` }]; }
  const table = readTable(lines, e);
  if (table) return [{ kind: "picture", img: chartCanvas(table.series, table.names, base), name: base, label: `${base}, a table of numbers`, found: `a table with ${table.series.length} column${table.series.length === 1 ? "" : "s"} of numbers, drawn as a bar chart` }];
  // words: make a sign of them, and offer them to Genesis as a description
  let words = text;
  if (/<html|<body|<p[\s>]/i.test(head)) words = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  words = words.replace(/[ \t]+/g, " ").trim();
  const c = textCanvas(words);
  const prompt = words.length <= 400 ? words.replace(/\s+/g, " ") : "";
  return [{ kind: "picture", img: c, name: base, label: `${base}, writing`, found: `writing, ${fmt(words.split(/\s+/).length)} words, set into a sign of blocks`, prompt }];
}
function readTable(lines, e) {
  const rows = lines.map(l => l.trim()).filter(Boolean); if (rows.length < 2) return null;
  const sep = e === "tsv" || rows[0].includes("\t") ? "\t" : rows[0].includes(";") && !rows[0].includes(",") ? ";" : ",";
  const cells = rows.map(r => r.split(sep).map(c => c.trim().replace(/^"|"$/g, "")));
  const cols = Math.max(...cells.map(r => r.length)); if (cols < 1) return null;
  const num = s => { const v = parseFloat(String(s).replace(/[$,%\s]/g, "")); return isFinite(v) ? v : NaN; };
  const header = cells[0].some(c => isNaN(num(c))) ? cells[0] : null;
  const body = header ? cells.slice(1) : cells;
  const series = [], names = [];
  for (let k = 0; k < cols; k++) { const col = body.map(r => num(r[k])); const good = col.filter(v => !isNaN(v)).length; if (good >= Math.max(2, body.length * 0.7)) { series.push(col.map(v => isNaN(v) ? 0 : v)); names.push(header ? header[k] : `column ${k + 1}`); } }
  if (!series.length || (sep === "," && cells[0].length < 2 && !/csv/.test(e))) return null;
  return { series: series.slice(0, 6), names: names.slice(0, 6) };
}
function chartCanvas(series, names, title) {
  const n = Math.min(64, Math.max(...series.map(s => s.length))), H = 48, cols = ["#e0646a", "#4a90d9", "#f8c45a", "#5cb85c", "#9b59b6", "#f39a4f"];
  const bw = Math.max(1, Math.min(6, Math.floor(96 / (n * series.length)))), group = series.length * bw + 1;
  const c = canvasOf(n * group + 3, H + 4), x = c.getContext("2d");
  x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, c.width, c.height);
  let max = 0, min = 0; for (const s of series) for (const v of s.slice(0, n)) { max = Math.max(max, v); min = Math.min(min, v); }
  const span = Math.max(1e-9, max - min), zero = H + 2 - Math.round((0 - min) / span * H);
  series.forEach((s, k) => { x.fillStyle = cols[k % cols.length]; for (let i = 0; i < Math.min(n, s.length); i++) { const y = H + 2 - Math.round((s[i] - min) / span * H); x.fillRect(2 + i * group + k * bw, Math.min(y, zero), bw, Math.max(1, Math.abs(zero - y))); } });
  x.fillStyle = "#24163a"; x.fillRect(1, zero, c.width - 2, 1);
  return c;
}
function textCanvas(words) {
  const maxLines = 10, wrap = 28;
  const out = []; for (const para of words.split(/\n+/)) { let line = ""; for (const w of para.split(/\s+/)) { if ((line + " " + w).trim().length > wrap) { if (line) out.push(line); line = w; } else line = (line + " " + w).trim(); if (out.length >= maxLines) break; } if (line && out.length < maxLines) out.push(line); if (out.length >= maxLines) break; }
  const fs = 14, lh = 16, W = Math.max(...out.map(l => l.length), 4) * 9 + 8;
  const c = canvasOf(W, out.length * lh + 6), x = c.getContext("2d");
  x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#24163a"; x.font = `bold ${fs}px monospace`; x.textBaseline = "top";
  out.forEach((l, i) => x.fillText(l, 4, 3 + i * lh));
  return c;
}
// Minecraft command files: setblock and fill, absolute or relative
function readCommands(lines) {
  const ops = []; const P = s => { const r = /^~/.test(s) || /^\^/.test(s); const v = parseFloat(s.replace(/^[~^]/, "")) || 0; return v; };
  for (const raw of lines) {
    const l = raw.trim().replace(/^\//, ""); const m = l.split(/\s+/);
    if (/^setblock$/i.test(m[0]) && m.length >= 5) ops.push({ a: [P(m[1]), P(m[2]), P(m[3])], b: null, id: m[4] });
    else if (/^fill$/i.test(m[0]) && m.length >= 8) ops.push({ a: [P(m[1]), P(m[2]), P(m[3])], b: [P(m[4]), P(m[5]), P(m[6])], id: m[7], mode: m[8] });
  }
  if (!ops.length) return null;
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const o of ops) for (const p of [o.a, o.b || o.a]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], Math.floor(p[k])); hi[k] = Math.max(hi[k], Math.floor(p[k])); }
  const w = hi[0] - lo[0] + 1, h = hi[1] - lo[1] + 1, d = hi[2] - lo[2] + 1;
  if (w * h * d > 40000000) throw new Error("Those commands cover too large a space for one blueprint.");
  const states = [{ name: "minecraft:air", props: {} }], idx = new Map([["minecraft:air", 0]]);
  const grid = new Uint32Array(w * h * d);
  const stateOf = s => { const m = s.match(/^([a-z0-9_:]+)(?:\[(.*)\])?/i); if (!m) return 0; const key = s; if (idx.has(key)) return idx.get(key); const props = {}; if (m[2]) for (const kv of m[2].split(",")) { const [a, b] = kv.split("="); if (b !== undefined) props[a.replace(/"/g, "").trim()] = b.replace(/"/g, "").trim(); } states.push({ name: m[1].includes(":") ? m[1] : "minecraft:" + m[1], props }); idx.set(key, states.length - 1); return states.length - 1; };
  for (const o of ops) {
    const v = stateOf(o.id), b = o.b || o.a;
    const [x0, x1] = [Math.floor(Math.min(o.a[0], b[0])) - lo[0], Math.floor(Math.max(o.a[0], b[0])) - lo[0]];
    const [y0, y1] = [Math.floor(Math.min(o.a[1], b[1])) - lo[1], Math.floor(Math.max(o.a[1], b[1])) - lo[1]];
    const [z0, z1] = [Math.floor(Math.min(o.a[2], b[2])) - lo[2], Math.floor(Math.max(o.a[2], b[2])) - lo[2]];
    const hollow = /hollow|outline/.test(o.mode || "");
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
      if (o.mode === "outline" && !edge) continue;
      grid[(y * d + z) * w + x] = hollow && !edge ? 0 : v;
    }
  }
  return { w, h, d, grid, states, java: true };
}

// ---------- archives ----------
async function readArchive(entries, base, depth, what) {
  const files = entries.filter(f => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(f.name) && f.data && f.data.length);
  const e = extOf(base);
  // a 3D printing file is a zip with one model inside
  const m3 = files.find(f => /3d\/3dmodel\.model$/i.test(f.name));
  if (m3) return [modelItem(parse3MF(td8.decode(m3.data)), base, "a 3MF 3D model")];
  const siblings = files.map(f => asFile(f.data, f.name.split("/").pop()));
  const items = [];
  const officeText = files.find(f => /^(word\/document\.xml|content\.xml)$/i.test(f.name));
  const slides = files.filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f.name));
  for (const f of files) {
    if (depth > 3 || items.length >= 60) break;
    const n = f.name.toLowerCase();
    if (/\.(xml|rels|json|txt|md|lang|js|mcfunction|html?|css|yml|yaml|properties|cfg|toml)$/.test(n) && !/\.(mcfunction)$/.test(n) && !/\.(bbmodel|gltf)$/.test(n)) continue;
    if (/(^|\/)(manifest|pack_manifest)\.json$/.test(n)) continue;
    try { const got = await intake(f.data, f.name, "", siblings, depth + 1); for (const it of got) { it.label = `${f.name}: ${it.label.split(", ").slice(1).join(", ") || it.label}`; items.push(it); } } catch (er) { }
  }
  if (officeText || slides.length) {
    const xml = [officeText, ...slides].filter(Boolean).map(f => td8.decode(f.data)).join(" ");
    const words = xml.replace(/<\/w:p>|<\/a:p>|<\/text:p>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();
    if (words) items.push({ kind: "picture", img: textCanvas(words), name: base, label: `${base}: its writing`, found: `the writing in ${base}, set into a sign of blocks`, prompt: words.length <= 400 ? words.replace(/\s+/g, " ") : "" });
  }
  if (!items.length) throw new Error(`I opened ${base} and looked at all ${files.length} things inside, but none of them was a picture, model, schematic or anything else I can build.`);
  const rank = it => ({ schematic: 0, vox: 1, model: 2, picture: 3 })[it.kind] ?? 4;
  items.sort((a, b) => rank(a) - rank(b));
  return items;
}
function u16(u, o) { return u[o] | (u[o + 1] << 8); }
function u32(u, o) { return (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0; }
async function unzip(u) {
  let eocd = -1; for (let i = u.length - 22; i >= Math.max(0, u.length - 70000); i--) if (u32(u, i) === 0x06054b50) { eocd = i; break; }
  const out = [];
  if (eocd < 0) { // no directory: walk the local headers
    let o = 0; while (o + 30 < u.length && u32(u, o) === 0x04034b50) { const method = u16(u, o + 8), cs = u32(u, o + 18), nl = u16(u, o + 26), xl = u16(u, o + 28); const name = td8.decode(u.subarray(o + 30, o + 30 + nl)); const start = o + 30 + nl + xl; if (!cs) break; out.push({ name, data: await inflateEntry(u.subarray(start, start + cs), method) }); o = start + cs; }
    return out;
  }
  const n = u16(u, eocd + 10); let p = u32(u, eocd + 16); let total = 0;
  for (let i = 0; i < n && p + 46 <= u.length; i++) {
    if (u32(u, p) !== 0x02014b50) break;
    const method = u16(u, p + 10), cs = u32(u, p + 20), us = u32(u, p + 24), nl = u16(u, p + 28), xl = u16(u, p + 30), cl = u16(u, p + 32), lo = u32(u, p + 42);
    const name = td8.decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith("/") || us > 200e6 || (total += us) > 600e6) continue;
    const start = lo + 30 + u16(u, lo + 26) + u16(u, lo + 28);
    try { out.push({ name, data: await inflateEntry(u.subarray(start, start + cs), method) }); } catch (e) { }
  }
  return out;
}
async function inflateEntry(d, method) {
  if (method === 0) return d.slice();
  if (method !== 8) throw new Error("unsupported compression");
  if (typeof DecompressionStream !== "undefined") { try { return new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); } catch (e) { } }
  return inflateRaw(d);
}
function untar(u) {
  const out = []; let o = 0;
  while (o + 512 <= u.length) {
    const name = ascii(u, o, 100).replace(/\0.*$/, ""); if (!name) break;
    const size = parseInt(ascii(u, o + 124, 12).replace(/\0.*$/, "").trim() || "0", 8) || 0, type = String.fromCharCode(u[o + 156]);
    const prefix = ascii(u, o + 345, 155).replace(/\0.*$/, "");
    if (type === "0" || type === "\0") out.push({ name: (prefix ? prefix + "/" : "") + name, data: u.subarray(o + 512, o + 512 + size) });
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
// a small inflater for browsers without DecompressionStream
function inflateRaw(src) {
  let pos = 0, bit = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0;
  const need = n => { if (op + n > out.length) { const b = new Uint8Array(Math.max(out.length * 2, op + n)); b.set(out); out = b; } };
  const bits = n => { let v = 0; for (let i = 0; i < n; i++) { if (pos >= src.length) throw new Error("truncated"); v |= ((src[pos] >> bit) & 1) << i; if (++bit === 8) { bit = 0; pos++; } } return v; };
  const build = lens => { const max = Math.max(...lens); const count = new Uint16Array(max + 1), offs = new Uint16Array(max + 2); for (const l of lens) if (l) count[l]++; for (let i = 1; i <= max; i++) offs[i + 1] = offs[i] + count[i]; const sym = new Uint16Array(lens.length); lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; }); return { count, sym, max }; };
  const decode = h => { let code = 0, first = 0, index = 0; for (let len = 1; len <= h.max; len++) { code |= bits(1); const c = h.count[len]; if (code - c < first) return h.sym[index + (code - first)]; index += c; first += c; first <<= 1; code <<= 1; } throw new Error("bad code"); };
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixedL = null, fixedD = null, last = 0;
  while (!last) {
    last = bits(1); const t = bits(2);
    if (t === 0) { if (bit) { bit = 0; pos++; } const len = src[pos] | (src[pos + 1] << 8); pos += 4; need(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len; continue; }
    let L, Dd;
    if (t === 1) { if (!fixedL) { const l = new Array(288); for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8; fixedL = build(l); fixedD = build(new Array(30).fill(5)); } L = fixedL; Dd = fixedD; }
    else {
      const hl = bits(5) + 257, hd = bits(5) + 1, hc = bits(4) + 4, ord = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], cl = new Array(19).fill(0);
      for (let i = 0; i < hc; i++) cl[ord[i]] = bits(3);
      const ch = build(cl), lens = [];
      while (lens.length < hl + hd) { const s = decode(ch); if (s < 16) lens.push(s); else if (s === 16) { const p = lens[lens.length - 1]; for (let r = 3 + bits(2); r > 0; r--) lens.push(p); } else if (s === 17) for (let r = 3 + bits(3); r > 0; r--) lens.push(0); else for (let r = 11 + bits(7); r > 0; r--) lens.push(0); }
      L = build(lens.slice(0, hl)); Dd = build(lens.slice(hl));
    }
    for (;;) { const s = decode(L); if (s < 256) { need(1); out[op++] = s; } else if (s === 256) break; else { const li = s - 257, len = LB[li] + bits(LE[li]); const di = decode(Dd), dist = DB[di] + bits(DE[di]); need(len); for (let i = 0; i < len; i++, op++) out[op] = out[op - dist]; } }
  }
  return out.subarray(0, op);
}

// ---------- documents ----------
async function readPDF(u, base) {
  if (typeof pdfjsLib === "undefined") await loadScript("pdf.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
  const doc = await pdfjsLib.getDocument({ data: u.slice(), isEvalSupported: false, disableFontFace: false, useSystemFonts: true }).promise;
  const n = Math.min(doc.numPages, 24), items = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i); const v1 = page.getViewport({ scale: 1 }); const sc = Math.min(3, 1400 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale: sc }); const c = canvasOf(Math.ceil(vp.width), Math.ceil(vp.height)); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    items.push({ kind: "picture", img: c, name: `${base.replace(/\.pdf$/i, "")} page ${i}`, label: `page ${i} of ${doc.numPages}`, found: `page ${i} of a ${doc.numPages} page PDF, ${c.width} by ${c.height} pixels` });
  }
  return items;
}

// ---------- moving pictures: five moments from the video ----------
async function readVideo(u, base, mime) {
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto";
  const tryLoad = src => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("slow")), 15000); v.onloadeddata = () => { clearTimeout(t); res(); }; v.onerror = () => { clearTimeout(t); rej(new Error("no")); }; v.src = src; v.load(); });
  let url = null;
  try { url = URL.createObjectURL(new Blob([u], { type: mime || "video/mp4" })); await tryLoad(url); }
  catch (e) { if (u.length > 120e6) throw new Error(`${base} is a video too large to read here. Take a screenshot of the moment you want and bring that instead.`); try { await tryLoad(await dataURL(u, mime || "video/mp4")); } catch (e2) { throw new Error(`${base} is a video, but this browser cannot play its kind. Take a screenshot of the moment you want, or save the video as MP4 or WebM.`); } }
  const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 1, items = [];
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    await new Promise(res => { const t = setTimeout(res, 4000); v.onseeked = () => { clearTimeout(t); res(); }; v.currentTime = Math.min(dur - 0.05, dur * f); });
    const c = canvasFromDrawable(v); const s = Math.round(dur * f);
    items.push({ kind: "picture", img: c, name: `${base.replace(/\.[a-z0-9]+$/i, "")} at ${s}s`, label: `the moment at ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, found: `the moment ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} into a video, ${c.width} by ${c.height} pixels` });
  }
  if (url) setTimeout(() => URL.revokeObjectURL(url), 20000);
  return items;
}

// ---------- sound: a picture of how it sounds over time ----------
async function readAudio(u, base) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext || window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("This browser cannot listen to sound files.");
  const ctx = AC === window.OfflineAudioContext || AC === window.webkitOfflineAudioContext ? new AC(1, 44100, 44100) : new AC();
  let buf; try { buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), res, rej); if (p && p.then) p.then(res, rej); }); }
  catch (e) { throw new Error(`${base} is a sound, but this browser cannot hear its kind. Save it as MP3, WAV or OGG.`); }
  const data = buf.getChannelData(0), W = 192, H = 96, N = 1024, c = canvasOf(W, H), x = c.getContext("2d"), img = x.createImageData(W, H);
  const re = new Float32Array(N), im = new Float32Array(N), mags = [];
  let peak = 1e-9;
  for (let col = 0; col < W; col++) {
    const start = Math.floor(col / W * Math.max(0, data.length - N));
    for (let i = 0; i < N; i++) { re[i] = (data[start + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(H);
    for (let r = 0; r < H; r++) { const f0 = Math.floor(2 * Math.pow(N / 4, r / H)), f1 = Math.max(f0 + 1, Math.floor(2 * Math.pow(N / 4, (r + 1) / H))); let s = 0; for (let k = f0; k < f1; k++) s += Math.hypot(re[k], im[k]); m[r] = s / (f1 - f0); peak = Math.max(peak, m[r]); }
    mags.push(m);
  }
  for (let col = 0; col < W; col++) for (let r = 0; r < H; r++) {
    const v = Math.max(0, 1 + Math.log10(mags[col][r] / peak + 1e-6) / 3.5), [R, G, B] = magma(v), i = ((H - 1 - r) * W + col) * 4;
    img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const s = Math.round(buf.duration);
  return { kind: "picture", img: c, name: base, label: `${base}, a sound`, found: `a sound ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} long, drawn as a picture of its voice: low notes at the bottom, high at the top, time from left to right. Try the 3D option to sculpt it` };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
function magma(t) { const s = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191]]; t = Math.min(1, Math.max(0, t)) * (s.length - 1); const i = Math.min(s.length - 2, Math.floor(t)), f = t - i; return s[i].map((v, k) => Math.round(v + (s[i + 1][k] - v) * f)); }
// music as a piano roll: time across, pitch up, one color per instrument
function readMIDI(u, base) {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength); let o = 8; const ntr = dv.getUint16(10), div = dv.getUint16(12) || 96; o = 14;
  const notes = []; let end = 0;
  for (let t = 0; t < ntr && o + 8 <= u.length; t++) {
    if (ascii(u, o, 4) !== "MTrk") break; const len = dv.getUint32(o + 4); let p = o + 8; const stop = p + len; o = stop;
    let tick = 0, run = 0; const open = new Map();
    const vlq = () => { let v = 0, b; do { b = u[p++]; v = (v << 7) | (b & 127); } while (b & 128 && p < stop); return v; };
    while (p < stop) {
      tick += vlq(); let st = u[p]; if (st & 128) p++; else st = run;
      if (st === 0xff) { p++; const l = vlq(); p += l; continue; }
      if (st === 0xf0 || st === 0xf7) { const l = vlq(); p += l; continue; }
      run = st; const ty = st & 0xf0, ch = st & 15;
      if (ty === 0x90 || ty === 0x80) { const k = u[p++], vel = u[p++]; const key = ch * 128 + k; if (ty === 0x90 && vel) open.set(key, tick); else if (open.has(key)) { notes.push({ k, ch, a: open.get(key), b: tick }); open.delete(key); } }
      else if (ty === 0xc0 || ty === 0xd0) p += 1; else p += 2;
      end = Math.max(end, tick);
    }
  }
  if (!notes.length) throw new Error(`${base} is a music file, but I found no notes in it.`);
  let lo = 127, hi = 0; for (const n of notes) { lo = Math.min(lo, n.k); hi = Math.max(hi, n.k); }
  const W = Math.min(256, Math.max(32, Math.ceil(end / (div / 4)))), H = hi - lo + 1, c = canvasOf(W, H), x = c.getContext("2d");
  x.fillStyle = "#14101f"; x.fillRect(0, 0, W, H);
  const cols = ["#e0646a", "#4a90d9", "#f8c45a", "#5cb85c", "#9b59b6", "#f39a4f", "#ffffff", "#5ad1d1"];
  for (const n of notes) { x.fillStyle = cols[n.ch % cols.length]; const a = Math.floor(n.a / end * (W - 1)), b = Math.max(a + 1, Math.ceil(n.b / end * (W - 1))); x.fillRect(a, hi - n.k, b - a, 1); }
  return { kind: "picture", img: c, name: base, label: `${base}, music`, found: `music with ${fmt(notes.length)} notes, drawn as a piano roll: time from left to right, high notes at the top, one color for each instrument` };
}
async function readFont(u, base) {
  const fam = "g" + Math.random().toString(36).slice(2);
  try { const f = new FontFace(fam, u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); await f.load(); document.fonts.add(f); }
  catch (e) { throw new Error(`${base} is a font, but this browser could not read it.`); }
  const lines = ["Genesis", "Aa Bb Cc", "0123456789"], c = canvasOf(200, 96), x = c.getContext("2d");
  x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, 200, 96); x.fillStyle = "#24163a"; x.textBaseline = "top";
  lines.forEach((l, i) => { x.font = `${i ? 22 : 32}px "${fam}"`; x.fillText(l, 6, 4 + (i ? 40 + (i - 1) * 26 : 0)); });
  return { kind: "picture", img: c, name: base, label: `${base}, a font`, found: "a font, written out as a sample sign" };
}
// anything else: its bytes as colors
function bytesArt(u, base) {
  const n = Math.min(u.length, 3 * 128 * 128), side = Math.max(8, Math.min(128, Math.floor(Math.sqrt(Math.max(1, n / 3)))));
  const rgba = new Uint8Array(side * side * 4), step = Math.max(1, Math.floor(u.length / (side * side * 3)));
  for (let i = 0; i < side * side; i++) { const o = i * 3 * step; rgba[i * 4] = u[o] || 0; rgba[i * 4 + 1] = u[o + 1] || 0; rgba[i * 4 + 2] = u[o + 2] || 0; rgba[i * 4 + 3] = 255; }
  return { kind: "picture", img: canvasFromRGBA(side, side, rgba), name: base, label: `${base}, its pattern`, found: `a kind of file I cannot read the meaning of. Every file has a pattern, though, so here are its bytes as colors, ${side} by ${side}` };
}

// ---------- picture formats the browser does not know ----------
function decodeBMP(u) {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), off = dv.getUint32(10, true), w = dv.getInt32(18, true), h0 = dv.getInt32(22, true), bpp = dv.getUint16(28, true), h = Math.abs(h0);
  if (![24, 32].includes(bpp)) throw new Error("This bitmap uses a color depth I cannot read. Save it as PNG.");
  const rgba = new Uint8Array(w * h * 4), row = Math.ceil(w * bpp / 32) * 4;
  for (let y = 0; y < h; y++) { const sy = h0 > 0 ? h - 1 - y : y; for (let x = 0; x < w; x++) { const p = off + sy * row + x * bpp / 8, i = (y * w + x) * 4; rgba[i] = u[p + 2]; rgba[i + 1] = u[p + 1]; rgba[i + 2] = u[p]; rgba[i + 3] = bpp === 32 ? u[p + 3] : 255; } }
  return canvasFromRGBA(w, h, rgba);
}
function decodeTGA(u) {
  const idl = u[0], cmt = u[1], it = u[2], cml = u16(u, 5), cmd = u[7], w = u16(u, 12), h = u16(u, 14), bpp = u[16], desc = u[17];
  let p = 18 + idl; const cmap = []; if (cmt) { for (let i = 0; i < cml; i++) { const q = p + i * (cmd / 8); cmap.push(cmd >= 24 ? [u[q + 2], u[q + 1], u[q], cmd === 32 ? u[q + 3] : 255] : [((u16(u, q) >> 10) & 31) * 8, ((u16(u, q) >> 5) & 31) * 8, (u16(u, q) & 31) * 8, 255]); } p += cml * (cmd / 8); }
  const N = w * h, px = new Uint8Array(N * 4), B = bpp / 8, rle = it >= 9;
  const read = (out) => { if (it === 1 || it === 9) { const c = cmap[u[p++]] || [0, 0, 0, 255]; out.set(c); } else if (it === 3 || it === 11) { const g = u[p++]; out[0] = out[1] = out[2] = g; out[3] = B === 2 ? u[p++] : 255; } else if (B === 2) { const v = u16(u, p); p += 2; out[0] = ((v >> 10) & 31) * 8; out[1] = ((v >> 5) & 31) * 8; out[2] = (v & 31) * 8; out[3] = 255; } else { out[2] = u[p]; out[1] = u[p + 1]; out[0] = u[p + 2]; out[3] = B === 4 ? u[p + 3] : 255; p += B; } };
  const tmp = new Uint8Array(4); let i = 0;
  while (i < N && p < u.length) { if (rle) { const hdr = u[p++], n = (hdr & 127) + 1; if (hdr & 128) { read(tmp); for (let k = 0; k < n && i < N; k++, i++) px.set(tmp, i * 4); } else for (let k = 0; k < n && i < N; k++, i++) { read(tmp); px.set(tmp, i * 4); } } else { read(tmp); px.set(tmp, i * 4); i++; } }
  const top = desc & 32, rgba = new Uint8Array(N * 4); for (let y = 0; y < h; y++) rgba.set(px.subarray((top ? y : h - 1 - y) * w * 4, ((top ? y : h - 1 - y) + 1) * w * 4), y * w * 4);
  return canvasFromRGBA(w, h, rgba);
}
function decodePNM(u) {
  let p = 0; const tok = () => { for (;;) { while (p < u.length && /\s/.test(String.fromCharCode(u[p]))) p++; if (u[p] === 35) { while (p < u.length && u[p] !== 10) p++; continue; } break; } let s = ""; while (p < u.length && !/\s/.test(String.fromCharCode(u[p]))) s += String.fromCharCode(u[p++]); return s; };
  const m = tok(), w = +tok(), h = +tok(), max = m === "P1" || m === "P4" ? 1 : +tok(); p++;
  const rgba = new Uint8Array(w * h * 4), sc = 255 / max;
  for (let i = 0; i < w * h; i++) {
    let r, g, b;
    if (m === "P1") { const v = +tok(); r = g = b = v ? 0 : 255; } else if (m === "P2") r = g = b = +tok() * sc; else if (m === "P3") { r = +tok() * sc; g = +tok() * sc; b = +tok() * sc; }
    else if (m === "P4") { const row = Math.ceil(w / 8), y = Math.floor(i / w), x = i % w, v = (u[p + y * row + (x >> 3)] >> (7 - (x & 7))) & 1; r = g = b = v ? 0 : 255; }
    else if (m === "P5") r = g = b = u[p + i] * sc; else { r = u[p + i * 3] * sc; g = u[p + i * 3 + 1] * sc; b = u[p + i * 3 + 2] * sc; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
  }
  return canvasFromRGBA(w, h, rgba);
}
function decodeQOI(u) {
  const be = o => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  const w = be(4), h = be(8), N = w * h, out = new Uint8Array(N * 4), idx = new Uint8Array(256); let p = 14, r = 0, g = 0, b = 0, a = 255, run = 0;
  for (let i = 0; i < N; i++) {
    if (run > 0) run--; else if (p < u.length - 8) {
      const b1 = u[p++];
      if (b1 === 0xfe) { r = u[p++]; g = u[p++]; b = u[p++]; } else if (b1 === 0xff) { r = u[p++]; g = u[p++]; b = u[p++]; a = u[p++]; }
      else if ((b1 & 0xc0) === 0) { const q = (b1 & 63) * 4; r = idx[q]; g = idx[q + 1]; b = idx[q + 2]; a = idx[q + 3]; }
      else if ((b1 & 0xc0) === 0x40) { r = (r + ((b1 >> 4) & 3) - 2) & 255; g = (g + ((b1 >> 2) & 3) - 2) & 255; b = (b + (b1 & 3) - 2) & 255; }
      else if ((b1 & 0xc0) === 0x80) { const b2 = u[p++], vg = (b1 & 63) - 32; r = (r + vg - 8 + ((b2 >> 4) & 15)) & 255; g = (g + vg) & 255; b = (b + vg - 8 + (b2 & 15)) & 255; }
      else run = b1 & 63;
      const q = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4; idx[q] = r; idx[q + 1] = g; idx[q + 2] = b; idx[q + 3] = a;
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return canvasFromRGBA(w, h, out);
}
function decodePSD(u) {
  const be16 = o => (u[o] << 8) | u[o + 1], be32 = o => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  const ch = be16(12), h = be32(14), w = be32(18), depth = be16(22), mode = be16(24);
  if (depth !== 8) throw new Error("This Photoshop file uses 16 or 32 bit color. Save it as 8 bit, or export a PNG.");
  let p = 26; p += 4 + be32(p); p += 4 + be32(p); p += 4 + be32(p);
  const comp = be16(p); p += 2; const N = w * h, planes = [];
  if (comp === 0) for (let c = 0; c < ch; c++) { planes.push(u.subarray(p, p + N)); p += N; }
  else if (comp === 1) {
    const counts = []; for (let i = 0; i < ch * h; i++) { counts.push(be16(p)); p += 2; }
    for (let c = 0; c < ch; c++) { const pl = new Uint8Array(N); let o = 0; for (let y = 0; y < h; y++) { const end = p + counts[c * h + y]; while (p < end) { const n = u[p++]; if (n < 128) { for (let k = 0; k <= n; k++) pl[o++] = u[p++]; } else if (n > 128) { const v = u[p++]; for (let k = 0; k < 257 - n; k++) pl[o++] = v; } } } planes.push(pl); }
  } else throw new Error("This Photoshop file is compressed in a way I cannot read. Export a PNG.");
  const rgba = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { if (mode === 1 || ch < 3) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = planes[0][i]; rgba[i * 4 + 3] = ch > 1 ? planes[1][i] : 255; } else if (mode === 4 && ch >= 4) { const C = planes[0][i], M = planes[1][i], Y = planes[2][i], K = planes[3][i]; rgba[i * 4] = C * K / 255; rgba[i * 4 + 1] = M * K / 255; rgba[i * 4 + 2] = Y * K / 255; rgba[i * 4 + 3] = 255; } else { rgba[i * 4] = planes[0][i]; rgba[i * 4 + 1] = planes[1][i]; rgba[i * 4 + 2] = planes[2][i]; rgba[i * 4 + 3] = ch > 3 ? planes[3][i] : 255; } }
  return canvasFromRGBA(w, h, rgba);
}
async function decodeTIFF(u) {
  const le = u[0] === 0x49, r16 = o => le ? u[o] | (u[o + 1] << 8) : (u[o] << 8) | u[o + 1], r32 = o => (le ? (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) : ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3])) >>> 0;
  const ifd = r32(4), n = r16(ifd), T = {};
  for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12, tag = r16(e), type = r16(e + 2), cnt = r32(e + 4), sz = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] || 1; let vo = cnt * sz > 4 ? r32(e + 8) : e + 8; const vals = []; for (let k = 0; k < Math.min(cnt, 1 << 20); k++) vals.push(sz === 2 ? r16(vo + k * 2) : sz === 4 ? r32(vo + k * 4) : u[vo + k]); T[tag] = vals; }
  const w = T[256][0], h = T[257][0], bps = (T[258] || [1])[0], comp = (T[259] || [1])[0], photo = (T[262] || [2])[0], spp = (T[277] || [1])[0], pred = (T[317] || [1])[0];
  const offs = T[273] || T[324], counts = T[279] || T[325], rps = (T[278] || [h])[0], cmap = T[320];
  if (T[322]) throw new Error("This TIFF is stored in tiles, which I cannot read yet. Save it as PNG.");
  if (bps !== 8 && !(bps === 1 && spp === 1) && !(bps === 4 && photo === 3)) throw new Error("This TIFF uses 16 bit color or more. Save it as 8 bit, or as PNG.");
  const strips = [];
  for (let s = 0; s < offs.length; s++) {
    const d = u.subarray(offs[s], offs[s] + counts[s]);
    if (comp === 1) strips.push(d); else if (comp === 32773) strips.push(unpackBits(d)); else if (comp === 5) strips.push(lzwTIFF(d)); else if (comp === 8 || comp === 32946) strips.push(await inflateZlib(d));
    else throw new Error("This TIFF is compressed in a way I cannot read (JPEG inside TIFF). Save it as PNG or JPG.");
  }
  const total = new Uint8Array(strips.reduce((a, s) => a + s.length, 0)); let o = 0; for (const s of strips) { total.set(s, o); o += s.length; }
  const rowBytes = Math.ceil(w * spp * bps / 8);
  if (pred === 2 && bps === 8) for (let y = 0; y < h; y++) for (let x = spp; x < w * spp; x++) total[y * rowBytes + x] = (total[y * rowBytes + x] + total[y * rowBytes + x - spp]) & 255;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let r, g, b, a = 255;
    if (bps === 1) { const v = (total[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1; r = g = b = (photo === 0 ? !v : v) ? 255 : 0; }
    else if (photo === 3) { const k = bps === 4 ? (total[y * rowBytes + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : total[y * rowBytes + x]; const N = cmap.length / 3; r = cmap[k] >> 8; g = cmap[N + k] >> 8; b = cmap[2 * N + k] >> 8; }
    else if (spp < 3) { const v = total[y * rowBytes + x * spp]; r = g = b = photo === 0 ? 255 - v : v; if (spp === 2) a = total[y * rowBytes + x * spp + 1]; }
    else if (photo === 5) { const q = y * rowBytes + x * spp, K = 255 - total[q + 3]; r = (255 - total[q]) * K / 255; g = (255 - total[q + 1]) * K / 255; b = (255 - total[q + 2]) * K / 255; }
    else { const q = y * rowBytes + x * spp; r = total[q]; g = total[q + 1]; b = total[q + 2]; if (spp > 3) a = total[q + 3]; }
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }
  return canvasFromRGBA(w, h, rgba);
}
function unpackBits(d) { const out = []; let p = 0; while (p < d.length) { const n = (d[p++] << 24) >> 24; if (n >= 0) { for (let k = 0; k <= n; k++) out.push(d[p++]); } else if (n !== -128) { const v = d[p++]; for (let k = 0; k < 1 - n; k++) out.push(v); } } return Uint8Array.from(out); }
function lzwTIFF(d) {
  const out = []; let bitPos = 0, size = 9; let dict = [];
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push(null, null); size = 9; };
  const read = () => { let v = 0; for (let i = 0; i < size; i++) { const B = d[(bitPos + i) >> 3]; if (B === undefined) return 257; v = (v << 1) | ((B >> (7 - ((bitPos + i) & 7))) & 1); } bitPos += size; return v; };
  reset(); let prev = null;
  for (;;) {
    const c = read(); if (c === 257) break;
    if (c === 256) { reset(); prev = null; continue; }
    let e; if (c < dict.length && dict[c]) e = dict[c]; else if (prev) e = prev.concat(prev[0]); else break;
    for (const v of e) out.push(v);
    if (prev) dict.push(prev.concat(e[0]));
    prev = e;
    if (dict.length + 1 >= (1 << size) && size < 12) size++;
  }
  return Uint8Array.from(out);
}
async function inflateZlib(d) {
  if (typeof DecompressionStream !== "undefined") { try { return new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer()); } catch (e) { } }
  return inflateRaw(d.subarray(2));
}

// ---------- more 3D formats ----------
function parsePLY(u) {
  const headEnd = (() => { const s = ascii(u, 0, Math.min(u.length, 65536)); const i = s.indexOf("end_header"); return i < 0 ? -1 : s.indexOf("\n", i) + 1; })();
  if (headEnd <= 0) throw new Error("That PLY file has no header.");
  const head = ascii(u, 0, headEnd).split(/\r?\n/), fmtL = (head.find(l => l.startsWith("format")) || "").split(" ")[1] || "ascii";
  const els = []; for (const l of head) { const p = l.trim().split(/\s+/); if (p[0] === "element") els.push({ name: p[1], n: +p[2], props: [] }); else if (p[0] === "property" && els.length) els[els.length - 1].props.push(p[1] === "list" ? { list: true, ct: p[2], it: p[3], name: p[4] } : { t: p[1], name: p[2] }); }
  const M = makeModel(); const V = [], C = []; const SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), little = fmtL === "binary_little_endian";
  let p = headEnd; const words = fmtL === "ascii" ? td8.decode(u.subarray(headEnd)).trim().split(/\s+/) : null; let wi = 0;
  const rd = t => { if (words) return +words[wi++]; let v; switch (t) { case "char": case "int8": v = dv.getInt8(p); break; case "uchar": case "uint8": v = dv.getUint8(p); break; case "short": case "int16": v = dv.getInt16(p, little); break; case "ushort": case "uint16": v = dv.getUint16(p, little); break; case "int": case "int32": v = dv.getInt32(p, little); break; case "uint": case "uint32": v = dv.getUint32(p, little); break; case "float": case "float32": v = dv.getFloat32(p, little); break; default: v = dv.getFloat64(p, little); } p += SZ[t] || 4; return v; };
  M.mats.push({ name: "ply", color: [190, 190, 190] });
  for (const el of els) for (let i = 0; i < el.n; i++) {
    const rec = {}; for (const pr of el.props) { if (pr.list) { const n = rd(pr.ct); const l = []; for (let k = 0; k < n; k++) l.push(rd(pr.it)); rec[pr.name] = l; } else rec[pr.name] = rd(pr.t); }
    if (el.name === "vertex") { V.push([rec.x, rec.y, rec.z]); C.push(rec.red !== undefined ? [rec.red, rec.green, rec.blue] : rec.r !== undefined ? [rec.r, rec.g, rec.b] : null); }
    else if (el.name === "face") { const f = rec.vertex_indices || rec.vertex_index || []; for (let k = 1; k + 1 < f.length; k++) { const t = [f[0], f[k], f[k + 1]]; addTri(M, t.flatMap(j => V[j] || [0, 0, 0]), null, t.every(j => C[j]) ? t.flatMap(j => C[j]) : null, 0); } }
  }
  if (!M.mat.length) throw new Error("That PLY file has points but no faces. I need a surface to build.");
  M.up = "y"; return M;
}
function parseOFF(text) {
  const w = text.replace(/#.*$/gm, "").trim().split(/\s+/); let i = w[0].toUpperCase().endsWith("OFF") ? 1 : 0; const nv = +w[i++], nf = +w[i++]; i++;
  const V = []; for (let k = 0; k < nv; k++) V.push([+w[i++], +w[i++], +w[i++]]);
  const M = makeModel(); M.mats.push({ name: "off", color: [190, 190, 190] });
  for (let k = 0; k < nf; k++) { const n = +w[i++]; const f = []; for (let j = 0; j < n; j++) f.push(+w[i++]); for (let j = 1; j + 1 < n; j++) addTri(M, [f[0], f[j], f[j + 1]].flatMap(q => V[q]), null, null, 0); }
  M.up = "y"; return M;
}
function parse3MF(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml"); const M = makeModel(); M.mats.push({ name: "3mf", color: [190, 190, 190] });
  for (const mesh of doc.getElementsByTagNameNS("*", "mesh")) {
    const V = [...mesh.getElementsByTagNameNS("*", "vertex")].map(v => [+v.getAttribute("x"), +v.getAttribute("y"), +v.getAttribute("z")]);
    for (const t of mesh.getElementsByTagNameNS("*", "triangle")) addTri(M, [+t.getAttribute("v1"), +t.getAttribute("v2"), +t.getAttribute("v3")].flatMap(q => V[q] || [0, 0, 0]), null, null, 0);
  }
  if (!M.mat.length) throw new Error("That 3MF file has no triangles.");
  M.up = "z"; return M;
}
function parseDAE(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml"); const M = makeModel(); M.mats.push({ name: "dae", color: [190, 190, 190] });
  const byId = id => doc.querySelector(`[id="${id.replace(/^#/, "")}"]`);
  for (const mesh of doc.getElementsByTagName("mesh")) {
    const vertsEl = mesh.getElementsByTagName("vertices")[0]; if (!vertsEl) continue;
    const posIn = [...vertsEl.getElementsByTagName("input")].find(i => i.getAttribute("semantic") === "POSITION"); const src = posIn && byId(posIn.getAttribute("source")); if (!src) continue;
    const fa = src.getElementsByTagName("float_array")[0].textContent.trim().split(/\s+/).map(Number);
    for (const prim of [...mesh.getElementsByTagName("triangles"), ...mesh.getElementsByTagName("polylist"), ...mesh.getElementsByTagName("polygons")]) {
      const inputs = [...prim.getElementsByTagName("input")], stride = Math.max(...inputs.map(i => +(i.getAttribute("offset") || 0))) + 1;
      const vOff = +((inputs.find(i => i.getAttribute("semantic") === "VERTEX") || { getAttribute: () => 0 }).getAttribute("offset") || 0);
      const pEls = [...prim.getElementsByTagName("p")]; const vc = prim.getElementsByTagName("vcount")[0]; const counts = vc ? vc.textContent.trim().split(/\s+/).map(Number) : null;
      for (const pe of pEls) {
        const idx = pe.textContent.trim().split(/\s+/).map(Number); const verts = []; for (let k = 0; k < idx.length; k += stride) verts.push(idx[k + vOff]);
        const V = j => [fa[j * 3], fa[j * 3 + 1], fa[j * 3 + 2]];
        if (counts) { let o = 0; for (const c of counts) { for (let j = 1; j + 1 < c; j++) addTri(M, [verts[o], verts[o + j], verts[o + j + 1]].flatMap(V), null, null, 0); o += c; } }
        else if (prim.tagName === "polygons") { for (let j = 1; j + 1 < verts.length; j++) addTri(M, [verts[0], verts[j], verts[j + 1]].flatMap(V), null, null, 0); }
        else for (let k = 0; k + 2 < verts.length; k += 3) addTri(M, [verts[k], verts[k + 1], verts[k + 2]].flatMap(V), null, null, 0);
      }
    }
  }
  if (!M.mat.length) throw new Error("I found no triangles in that Collada file.");
  const up = (doc.getElementsByTagName("up_axis")[0] || {}).textContent; M.up = /Z/.test(up || "") ? "z" : "y"; return M;
}
// boxes made in Blockbench, with their own painted textures
async function parseBBModel(j) {
  const M = makeModel(); const texs = [];
  for (const t of j.textures || []) { let img = null; try { if (t.source && t.source.startsWith("data:")) img = await decodeImage(b64bytes(t.source), "image/png"); } catch (e) { } texs.push(img); M.mats.push({ name: t.name || "texture", color: [190, 190, 190], tex: img }); }
  if (!M.mats.length) M.mats.push({ name: "box", color: [190, 190, 190] });
  const res = j.resolution || { width: 16, height: 16 };
  const walk = list => { for (const e of list || []) { if (e && e.from && e.to) boxToTris(M, e, res); } };
  walk(j.elements);
  if (!M.mat.length) throw new Error("That Blockbench model has no cubes I can use.");
  M.up = "y"; return M;
}
function boxToTris(M, e, res) {
  const [x0, y0, z0] = e.from, [x1, y1, z1] = e.to, rot = e.rotation || [0, 0, 0], org = e.origin || [0, 0, 0];
  const R = p => { let [x, y, z] = [p[0] - org[0], p[1] - org[1], p[2] - org[2]]; const [ax, ay, az] = rot.map(d => d * Math.PI / 180); let t; t = y * Math.cos(ax) - z * Math.sin(ax); z = y * Math.sin(ax) + z * Math.cos(ax); y = t; t = x * Math.cos(ay) + z * Math.sin(ay); z = -x * Math.sin(ay) + z * Math.cos(ay); x = t; t = x * Math.cos(az) - y * Math.sin(az); y = x * Math.sin(az) + y * Math.cos(az); x = t; return [x + org[0], y + org[1], z + org[2]]; };
  const F = { north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], up: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], down: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]] };
  for (const [face, q] of Object.entries(F)) {
    const fd = (e.faces || {})[face]; if (fd === undefined && e.faces) continue;
    const tex = fd && fd.texture !== null && fd.texture !== undefined ? +fd.texture : -1, uv = fd && fd.uv;
    const P = q.map(R); const W = res.width || 16, H = res.height || 16;
    const UV = uv ? [[uv[0] / W, 1 - uv[1] / H], [uv[2] / W, 1 - uv[1] / H], [uv[2] / W, 1 - uv[3] / H], [uv[0] / W, 1 - uv[3] / H]] : null;
    const m = tex >= 0 && tex < M.mats.length ? tex : 0;
    for (const t of [[0, 1, 2], [0, 2, 3]]) addTri(M, t.flatMap(k => P[k]), UV ? t.flatMap(k => UV[k]) : null, null, m);
  }
}
function parseBedrockGeo(j) {
  const geos = j["minecraft:geometry"] || Object.entries(j).filter(([k]) => k.startsWith("geometry.")).map(([, v]) => v);
  const g = Array.isArray(geos) ? geos[0] : geos; const M = makeModel(); M.mats.push({ name: "geo", color: [190, 190, 190] });
  for (const b of (g && g.bones) || []) for (const c of b.cubes || []) { const [x, y, z] = c.origin, [w, h, d] = c.size; boxToTris(M, { from: [x, y, z], to: [x + w, y + h, z + d], rotation: c.rotation, origin: c.pivot || b.pivot }, { width: 16, height: 16 }); }
  if (!M.mat.length) throw new Error("That geometry file has no cubes.");
  M.up = "y"; return M;
}

// ---------- old schematics from before 1.13, with numbered blocks ----------
const LEGACY = (() => {
  const C = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
  const W = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"];
  const T = {
    0: "air", 1: ["stone", "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite"], 2: "grass_block", 3: ["dirt", "coarse_dirt", "podzol"], 4: "cobblestone", 5: W.map(w => w + "_planks"), 6: W.map(w => w + "_sapling"), 7: "bedrock", 8: "water", 9: "water", 10: "lava", 11: "lava", 12: ["sand", "red_sand"], 13: "gravel", 14: "gold_ore", 15: "iron_ore", 16: "coal_ore", 17: ["oak_log", "spruce_log", "birch_log", "jungle_log"], 18: ["oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves"], 19: "sponge", 20: "glass", 21: "lapis_ore", 22: "lapis_block", 23: "dispenser", 24: ["sandstone", "chiseled_sandstone", "cut_sandstone"], 25: "note_block", 26: "red_bed", 27: "powered_rail", 28: "detector_rail", 29: "sticky_piston", 30: "cobweb", 31: ["dead_bush", "short_grass", "fern"], 32: "dead_bush", 33: "piston", 35: C.map(c => c + "_wool"), 37: "dandelion", 38: ["poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy"], 39: "brown_mushroom", 40: "red_mushroom", 41: "gold_block", 42: "iron_block", 43: ["smooth_stone", "sandstone", "oak_planks", "cobblestone", "bricks", "stone_bricks", "nether_bricks", "quartz_block"], 44: ["smooth_stone_slab", "sandstone_slab", "oak_slab", "cobblestone_slab", "brick_slab", "stone_brick_slab", "nether_brick_slab", "quartz_slab"], 45: "bricks", 46: "tnt", 47: "bookshelf", 48: "mossy_cobblestone", 49: "obsidian", 50: "torch", 51: "fire", 52: "spawner", 53: "oak_stairs", 54: "chest", 55: "redstone_wire", 56: "diamond_ore", 57: "diamond_block", 58: "crafting_table", 59: "wheat", 60: "farmland", 61: "furnace", 62: "furnace", 63: "oak_sign", 64: "oak_door", 65: "ladder", 66: "rail", 67: "cobblestone_stairs", 68: "oak_wall_sign", 69: "lever", 70: "stone_pressure_plate", 71: "iron_door", 72: "oak_pressure_plate", 73: "redstone_ore", 74: "redstone_ore", 75: "redstone_torch", 76: "redstone_torch", 77: "stone_button", 78: "snow", 79: "ice", 80: "snow_block", 81: "cactus", 82: "clay", 83: "sugar_cane", 84: "jukebox", 85: "oak_fence", 86: "carved_pumpkin", 87: "netherrack", 88: "soul_sand", 89: "glowstone", 90: "nether_portal", 91: "jack_o_lantern", 92: "cake", 95: C.map(c => c + "_stained_glass"), 96: "oak_trapdoor", 97: "stone", 98: ["stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks"], 99: "brown_mushroom_block", 100: "red_mushroom_block", 101: "iron_bars", 102: "glass_pane", 103: "melon", 106: "vine", 107: "oak_fence_gate", 108: "brick_stairs", 109: "stone_brick_stairs", 110: "mycelium", 111: "lily_pad", 112: "nether_bricks", 113: "nether_brick_fence", 114: "nether_brick_stairs", 116: "enchanting_table", 117: "brewing_stand", 118: "cauldron", 120: "end_portal_frame", 121: "end_stone", 122: "dragon_egg", 123: "redstone_lamp", 124: "redstone_lamp", 125: W.map(w => w + "_planks"), 126: W.map(w => w + "_slab"), 128: "sandstone_stairs", 129: "emerald_ore", 130: "ender_chest", 131: "tripwire_hook", 133: "emerald_block", 134: "spruce_stairs", 135: "birch_stairs", 136: "jungle_stairs", 137: "command_block", 138: "beacon", 139: "cobblestone_wall", 140: "flower_pot", 141: "carrots", 142: "potatoes", 143: "oak_button", 144: "skeleton_skull", 145: "anvil", 146: "trapped_chest", 147: "light_weighted_pressure_plate", 148: "heavy_weighted_pressure_plate", 151: "daylight_detector", 152: "redstone_block", 153: "nether_quartz_ore", 154: "hopper", 155: ["quartz_block", "chiseled_quartz_block", "quartz_pillar"], 156: "quartz_stairs", 157: "activator_rail", 158: "dropper", 159: C.map(c => c + "_terracotta"), 160: C.map(c => c + "_stained_glass_pane"), 161: ["acacia_leaves", "dark_oak_leaves"], 162: ["acacia_log", "dark_oak_log"], 163: "acacia_stairs", 164: "dark_oak_stairs", 165: "slime_block", 167: "iron_trapdoor", 168: ["prismarine", "prismarine_bricks", "dark_prismarine"], 169: "sea_lantern", 170: "hay_block", 171: C.map(c => c + "_carpet"), 172: "terracotta", 173: "coal_block", 174: "packed_ice", 175: ["sunflower", "lilac", "tall_grass", "large_fern", "rose_bush", "peony"], 179: ["red_sandstone", "chiseled_red_sandstone", "cut_red_sandstone"], 180: "red_sandstone_stairs", 182: "red_sandstone_slab", 183: "spruce_fence_gate", 184: "birch_fence_gate", 185: "jungle_fence_gate", 186: "dark_oak_fence_gate", 187: "acacia_fence_gate", 188: "spruce_fence", 189: "birch_fence", 190: "jungle_fence", 191: "dark_oak_fence", 192: "acacia_fence", 193: "spruce_door", 194: "birch_door", 195: "jungle_door", 196: "acacia_door", 197: "dark_oak_door", 198: "end_rod", 201: "purpur_block", 202: "purpur_pillar", 203: "purpur_stairs", 205: "purpur_slab", 206: "end_stone_bricks", 208: "dirt_path", 213: "magma_block", 214: "nether_wart_block", 215: "red_nether_bricks", 216: "bone_block", 251: C.map(c => c + "_concrete"), 252: C.map(c => c + "_concrete_powder"),
  };
  for (let i = 0; i < 16; i++) T[235 + i] = C[i] + "_glazed_terracotta";
  return T;
})();
function legacyState(id, data) {
  let n = LEGACY[id]; if (n === undefined) return { name: "minecraft:stone", props: {} };
  const props = {};
  if (Array.isArray(n)) { const base = [17, 162].includes(id) ? data & 3 : [18, 161].includes(id) ? data & 3 : [44, 126, 182, 205].includes(id) ? data & 7 : [155].includes(id) ? Math.min(2, data) : data & 15; n = n[base] || n[0]; }
  if (/_stairs$/.test(n)) { props.facing = ["east", "west", "south", "north"][data & 3]; props.half = data & 4 ? "top" : "bottom"; }
  else if (/_log$/.test(n)) props.axis = ["y", "x", "z", "y"][(data >> 2) & 3];
  else if (/_slab$/.test(n)) props.type = data & 8 ? "top" : "bottom";
  else if (n === "quartz_pillar" || n === "purpur_pillar" || n === "hay_block" || n === "bone_block") props.axis = "y";
  else if (n === "torch" && data && data < 5) { n = "wall_torch"; props.facing = ["", "east", "west", "south", "north"][data]; }
  return { name: "minecraft:" + n, props };
}
function readLegacySchematic(S) {
  const w = S.Width & 0xffff, h = S.Height & 0xffff, d = S.Length & 0xffff;
  const blocks = S.Blocks, data = S.Data || new Uint8Array(blocks.length), add = S.AddBlocks;
  const states = [], idx = new Map(), grid = new Uint32Array(w * h * d);
  for (let i = 0; i < w * h * d; i++) {
    let id = blocks[i] & 255; if (add) id |= ((add[i >> 1] >> ((i & 1) ? 0 : 4)) & 15) << 8;
    const dv = data[i] & 15, key = id * 16 + dv; let v = idx.get(key);
    if (v === undefined) { v = states.length; states.push(legacyState(id, dv)); idx.set(key, v); }
    grid[i] = v; // legacy order is y, then z, then x fastest, the same as ours
  }
  return { w, h, d, grid, states, java: true };
}


// ================= the main subject of a picture, and a statue made from it =================
// The background is learned from the edges of the picture. Whatever stands apart from it, joined in one
// piece, is the subject. Its outline is then "inflated": the farther a point is from the edge of the
// subject, the thicker the statue is there, the way a sculptor rounds a form. Light and shadow in the
// picture press the surface in and out for detail.
function subjectMask(px, w, h) {
  const N = w * h, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N), al = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const q = oklab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); L[i] = q[0]; A[i] = q[1]; B[i] = q[2]; al[i] = px[i * 4 + 3]; }
  // the background is learned from every edge of the picture, row by row and column by column, so a
  // background that fades from dark to light (a studio backdrop, a vignette, a sky) is still known
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  const edgeMean = (pts) => { let l = 0, a = 0, b = 0, n = 0; for (const i of pts) { if (al[i] < 128) continue; l += L[i]; a += A[i]; b += B[i]; n++; } return n ? [l / n, a / n, b / n] : null; };
  const rowL = [], rowR = [], colT = [], colB = [];
  for (let y = 0; y < h; y++) { const pl = [], pr = []; for (let k = 0; k < band; k++) { pl.push(y * w + k); pr.push(y * w + w - 1 - k); } rowL.push(edgeMean(pl)); rowR.push(edgeMean(pr)); }
  for (let x = 0; x < w; x++) { const pt = [], pb = []; for (let k = 0; k < band; k++) { pt.push(k * w + x); pb.push((h - 1 - k) * w + x); } colT.push(edgeMean(pt)); colB.push(edgeMean(pb)); }
  const dist = new Float32Array(N); let dmax = 1e-6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (al[i] < 128) { dist[i] = 0; continue; }
    const fx = x / Math.max(1, w - 1), fy = y / Math.max(1, h - 1), c = [];
    const l = rowL[y], r = rowR[y], t = colT[x], bt = colB[x];
    if (l && r) c.push(l.map((v, k) => v + (r[k] - v) * fx)); if (t && bt) c.push(t.map((v, k) => v + (bt[k] - v) * fy));
    let best = 1e9; for (const m of c) best = Math.min(best, Math.hypot((L[i] - m[0]) * 1.4, A[i] - m[1], B[i] - m[2]));
    dist[i] = c.length ? best : 0; if (dist[i] > dmax) dmax = dist[i];
  }
  // Otsu: the threshold that best splits background from subject
  const bins = 128, hist = new Float64Array(bins); for (let i = 0; i < N; i++) hist[Math.min(bins - 1, Math.floor(dist[i] / dmax * bins))]++;
  let sum = 0; for (let b = 0; b < bins; b++) sum += b * hist[b];
  let wB = 0, sB = 0, best = 0, thr = bins * 0.2;
  for (let b = 0; b < bins; b++) { wB += hist[b]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += b * hist[b]; const mBk = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mBk - mF) * (mBk - mF); if (v > best) { best = v; thr = b; } }
  // how much the background itself varies along the edges tells how far from it something must be to stand apart
  const edgeD = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < band || y < band || x >= w - band || y >= h - band) edgeD.push(dist[y * w + x]);
  edgeD.sort((p, q) => p - q); const noise = edgeD.length ? edgeD[Math.floor(edgeD.length * 0.95)] : 0.02;
  const T = Math.min((thr + 0.5) / bins * dmax * 0.9, Math.max(0.022, noise * 1.6 + 0.012));
  // the background is what can be reached from the edges without crossing the subject
  const bg = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
  const seed = i => { if (!bg[i] && (dist[i] < T || al[i] < 128)) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0; const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]; for (const j of nb) if (j >= 0 && !bg[j] && (dist[j] < T * 1.15 || al[j] < 128)) { bg[j] = 1; q[qt++] = j; } }
  // keep the largest piece of what remains, so stray specks do not become floating blocks
  const lab = new Int32Array(N).fill(-1); let bestId = -1, bestN = 0, id = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (bg[s0] || lab[s0] >= 0) continue;
    let n = 0; qh = qt = 0; q[qt++] = s0; lab[s0] = id;
    while (qh < qt) { const i = q[qh++]; n++; const x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !bg[j] && lab[j] < 0) { lab[j] = id; q[qt++] = j; } }
    if (n > bestN) { bestN = n; bestId = id; } id++;
  }
  const mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = lab[i] === bestId ? 1 : 0;
  // close small gaps along the outline (shadows and dark edges), then fill any holes left inside
  { const rad = Math.max(1, Math.round(Math.min(w, h) * 0.012)), tmp = new Uint8Array(N);
    const morph = (src, dst, grow) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = grow ? 0 : 1; for (let dy = -rad; dy <= rad && v === (grow ? 0 : 1); dy++) for (let dx = -rad; dx <= rad; dx++) { const X = x + dx, Y = y + dy; const m = X < 0 || Y < 0 || X >= w || Y >= h ? 0 : src[Y * w + X]; if (grow && m) { v = 1; break; } if (!grow && !m) { v = 0; break; } } dst[y * w + x] = v; } };
    morph(mask, tmp, true); morph(tmp, mask, false);
    // then trim thin slivers such as a floor shadow, as long as that takes little away
    { const t2 = new Uint8Array(N), t3 = new Uint8Array(N); morph(mask, t2, false); morph(t2, t3, true); let a0 = 0, a1 = 0; for (let i = 0; i < N; i++) { a0 += mask[i]; a1 += t3[i] & mask[i]; } if (a1 > a0 * 0.9) for (let i = 0; i < N; i++) mask[i] = t3[i] & mask[i]; }
    const out = new Uint8Array(N); qh = qt = 0; const s2 = i => { if (!mask[i] && !out[i]) { out[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { s2(x); s2((h - 1) * w + x); } for (let y = 0; y < h; y++) { s2(y * w); s2(y * w + w - 1); }
    while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0) s2(j); }
    for (let i = 0; i < N; i++) if (!out[i]) mask[i] = 1; }
  if (bestN < N * 0.01) { for (let i = 0; i < N; i++) mask[i] = 1; } // nothing stood apart: keep everything
  return mask;
}
function distanceInside(mask, w, h) {
  // two passes of a chamfer transform: how far each subject pixel is from the background
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; let v = d[i]; if (x > 0) v = Math.min(v, d[i - 1] + a); else v = Math.min(v, a); if (y > 0) { v = Math.min(v, d[i - w] + a); if (x > 0) v = Math.min(v, d[i - w - 1] + b); if (x < w - 1) v = Math.min(v, d[i - w + 1] + b); } else v = Math.min(v, a); d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; let v = d[i]; if (x < w - 1) v = Math.min(v, d[i + 1] + a); else v = Math.min(v, a); if (y < h - 1) { v = Math.min(v, d[i + w] + a); if (x < w - 1) v = Math.min(v, d[i + w + 1] + b); if (x > 0) v = Math.min(v, d[i + w - 1] + b); } else v = Math.min(v, a); d[i] = v; }
  return d;
}
async function sculptBlueprint(img, o) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  // find the subject at a finer scale first, then crop to it so the statue uses every block on the subject
  const aw = Math.min(400, iw), ah = Math.max(1, Math.round(aw * ih / iw));
  const big = scaleImage(img, aw, ah, false).data, m0 = subjectMask(big, aw, ah);
  let x0 = aw, x1 = -1, y0 = ah, y1 = -1; for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) if (m0[y * aw + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error("I could not find a subject in that picture.");
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const crop = canvasOf(Math.round(cw * iw / aw), Math.round(ch * ih / ah)); crop.getContext("2d").drawImage(img, x0 * iw / aw, y0 * ih / ah, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const cmask = canvasOf(cw, ch); { const cx = cmask.getContext("2d"), id = cx.createImageData(cw, ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const v = m0[(y + y0) * aw + x + x0] ? 255 : 0, i = (y * cw + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } cx.putImageData(id, 0, 0); }
  // the statue's height in blocks follows the size you chose for its width
  const W = o.width, H = Math.max(2, Math.round(W * ch / cw));
  const px = scaleImage(crop, W, H, false).data, mk = scaleImage(cmask, W, H, false).data;
  const mask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) mask[i] = mk[i * 4] > 110 ? 1 : 0;
  const dist = distanceInside(mask, W, H); let dmax = 1; for (let i = 0; i < W * H; i++) if (dist[i] > dmax) dmax = dist[i];
  // a little blur of brightness gives the broad shading; the difference from it is the fine detail
  const lum = new Float32Array(W * H); for (let i = 0; i < W * H; i++) lum[i] = oklab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])[0];
  const blur = new Float32Array(W * H), r = Math.max(1, Math.round(W / 40));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !mask[Y * W + X]) continue; s += lum[Y * W + X]; n++; } blur[y * W + x] = n ? s / n : lum[y * W + x]; }
  // half thickness at each point: a rounded profile that grows with distance from the outline
  const R0 = dmax, front = new Float32Array(W * H), back = new Float32Array(W * H); let zmax = 1;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue; const d = Math.min(dist[i], R0);
    const base = Math.sqrt(Math.max(0, d * (2 * R0 - d))) * o.ratio * 0.9;
    const det = (lum[i] - blur[i]) * W * 0.06 * o.detail + (lum[i] - 0.5) * R0 * 0.08 * o.detail;
    front[i] = Math.max(0.5, base + det); back[i] = Math.max(0.5, base * 0.92);
    zmax = Math.max(zmax, front[i], back[i]);
  }
  const D = Math.max(3, Math.ceil(zmax) * 2 + 3), zc = Math.floor(D / 2), cells = new Map(), cols = new Uint16Array(W * H * 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!mask[i]) continue;
    const zf = Math.max(0, zc - Math.round(front[i])), zb = Math.min(D - 1, zc + Math.round(back[i])), yy = H - 1 - y;
    cols[i * 2] = zf; cols[i * 2 + 1] = zb;
    const c = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], 1], cb = [Math.round(px[i * 4] * 0.9), Math.round(px[i * 4 + 1] * 0.9), Math.round(px[i * 4 + 2] * 0.9), 1];
    for (let z = zf; z <= zb; z++) cells.set((yy * D + z) * W + x, z <= zc ? c : cb);
  }
  if (!o.solid) {
    // hollow it: keep only blocks that touch the air on some side
    const has = k => cells.has(k);
    const inner = []; for (const k of cells.keys()) { const x = k % W, z = Math.floor(k / W) % D, y = Math.floor(k / (W * D)); if (x > 0 && x < W - 1 && z > 0 && z < D - 1 && y > 0 && y < H - 1 && has(k - 1) && has(k + 1) && has(k - W) && has(k + W) && has(k - W * D) && has(k + W * D)) inner.push(k); }
    for (const k of inner) cells.delete(k);
  }
  const r2 = gridBlueprint({ size: [W, H, D], cells }, "sculpture");
  return r2;
}

// ================= Genesis Studio: the page =================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function say(msg) { const s = $("#status"); s.textContent = ""; setTimeout(() => { s.textContent = msg; }, 30); }
const fmt = n => Math.round(n).toLocaleString("en-US");
const nice = s => s.replace(/^minecraft:/, "").replace(/^builder:/, "").replace(/_/g, " ");
const cleanName = n => String(n || "").toLowerCase().trim().replace(/\.[a-z0-9]+$/, "").replace(/[\s\-.]+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40) || "blueprint";
const tick = () => new Promise(r => setTimeout(r, 0));

// ---------- remembered between visits (best effort) ----------
const STORE_KEY = "genesisStudio.v1";
const state = { lib: "My Builds", packUuid: null, modUuid: null, version: 0, bps: [] };
function load() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem("builderStudio.v1") || "null"); if (s) Object.assign(state, s); } catch (e) { } }
function persistLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; } catch (e) { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, bps: [] })); } catch (e2) { } return false; } }

// The library is kept in the browser's large storage (IndexedDB), so even huge blueprints survive closing the page.
// The small storage keeps a copy too when it fits.
const studioDB = (() => { let p = null; return () => p || (p = new Promise((ok, no) => { try { const r = indexedDB.open("genesisStudio", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } })); })();
function dbPut(v) { return studioDB().then(db => new Promise((ok, no) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, "state"); t.oncomplete = () => ok(true); t.onerror = () => no(t.error); t.onabort = () => no(t.error); })); }
function dbGet() { return studioDB().then(db => new Promise((ok, no) => { const q = db.transaction("kv").objectStore("kv").get("state"); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); })); }
const hasBigStore = typeof indexedDB !== "undefined";
function persist() {
  const small = persistLocal();
  if (hasBigStore) dbPut({ lib: state.lib, packUuid: state.packUuid, modUuid: state.modUuid, version: state.version, bps: state.bps.slice() }).catch(() => { });
  return small || hasBigStore;
}
load();
const libraryReady = hasBigStore ? dbGet().then(s => {
  if (s && Array.isArray(s.bps) && s.bps.length >= state.bps.length) {
    Object.assign(state, s);
    const n = document.getElementById("libName"); if (n) n.value = state.lib || "My Builds";
    if (document.getElementById("libList")) renderLibrary();
  }
}).catch(() => { }) : Promise.resolve();

// ---------- block colors ----------
const GROUPS = [
  ["concrete", "Concrete", true], ["wool", "Wool", true], ["terracotta", "Terracotta", true], ["wood", "Wood", true], ["stone", "Stone and brick", true],
  ["nature", "Nature", true], ["builder", "Genesis blocks", true], ["metal", "Metal and gems (costly)", false], ["light", "Glowing blocks", false], ["glazed", "Glazed terracotta", false], ["glass", "Stained glass", false],
];
function palette(face) {
  const on = new Set(GROUPS.filter(g => $("#g_" + g[0]).checked).map(g => g[0]));
  const smooth = $("#smooth").checked;
  return PALETTE.filter(p => on.has(p[2])).map(p => { const c = face === "up" ? p[4] : p[3]; return { e: p[0], name: p[1], rgb: c, lab: oklab(c[0], c[1], c[2]), pen: smooth ? (p[5] / 255) * 0.12 : 0 }; });
}
function matcher(list) {
  const cache = new Map();
  return (r, g, b) => { const k = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2); let v = cache.get(k); if (v === undefined) { const q = oklab(r, g, b); v = nearest(list, q[0], q[1], q[2]); cache.set(k, v); } return v; };
}

// ---------- what was dropped in ----------
let cur = null; // { kind, name, file, files, img, model, vox, S, result }
let choices = [];
async function openFiles(files) {
  files = [...files]; if (!files.length) return;
  say(`Reading ${files.length > 1 ? files.length + " files" : files[0].name}...`);
  $("#choices").hidden = true; $("#choices").innerHTML = ""; $("#promptBox").hidden = true;
  const items = [], problems = [];
  // a model that came with its materials and textures is read together with them
  const lead = files.find(f => /\.(obj|gltf)$/i.test(f.name));
  const order = lead ? [lead, ...files.filter(f => f !== lead && !/\.(mtl|png|jpe?g|bmp|tga|webp|bin)$/i.test(f.name))] : files;
  for (const f of order) {
    try { const bytes = new Uint8Array(await f.arrayBuffer()); const got = await intake(bytes, f.name || "file", f.type || "", files, 0); items.push(...got); }
    catch (e) { problems.push(e && e.message ? e.message : String(e)); }
  }
  if (!items.length) { cur = null; showKind(); say(problems[0] || "I could not find anything to build in that."); return; }
  choices = items;
  if (items.length === 1) return useItem(items[0]);
  const box = $("#choices"); box.hidden = false;
  const h = document.createElement("p"); h.textContent = `I found ${items.length} things I can build. Choose one. You can come back and add the others too.`; box.appendChild(h);
  items.forEach((it, k) => box.appendChild(btn(`${k + 1}. ${it.label}`, () => useItem(it))));
  say(`I found ${items.length} things I can build. Choose one from the list.` + (problems.length ? " " + problems[0] : ""));
}
async function useItem(it) {
  cur = { kind: it.kind, name: it.name, file: it.file, files: [], img: it.img, model: it.model, vox: it.vox, S: it.S, found: it.found };
  if (it.kind === "model") $("#up").value = "auto";
  $("#name").value = cleanName(it.name).replace(/_/g, " ");
  showKind();
  $("#found").textContent = `Found ${it.found}. Choose your options, then add it to your library.`;
  const pb = $("#promptBox");
  if (it.prompt) { pb.hidden = false; $("#promptText").value = "/build " + it.prompt; } else pb.hidden = true;
  await preview();
}
function showKind() {
  const k = cur ? cur.kind : null;
  $("#options").hidden = !k;
  for (const el of $$("[data-for]")) el.hidden = !k || !el.dataset.for.split(" ").includes(k);
  if (k) { $("#sizeLegend").textContent = { picture: "Width in blocks", model: "Size of the longest side, in blocks", vox: "Blocks per voxel", schematic: "Size" }[k]; setPreset(k === "picture" ? 96 : k === "model" ? 48 : 1, true); }
}
function setPreset(v, silent) {
  $("#size").value = v;
  for (const b of $$(".preset")) b.setAttribute("aria-pressed", String(+b.dataset.v === +v && b.closest("[data-for]") && !b.closest("[data-for]").hidden));
  if (!silent) preview();
}

// ---------- pictures ----------

function scaleImage(img, w, h, crisp) {
  let cw = img.naturalWidth || img.width, ch = img.naturalHeight || img.height, src = img;
  while (!crisp && cw / 2 >= w && ch / 2 >= h) { cw = Math.floor(cw / 2); ch = Math.floor(ch / 2); const c = document.createElement("canvas"); c.width = cw; c.height = ch; const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, cw, ch); src = c; }
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.imageSmoothingEnabled = !crisp; x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}
async function pictureBlueprint(img, o) {
  const w = o.width, h = Math.max(1, Math.round(w * (img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
  const list = palette(o.mode === "floor" ? "up" : "side");
  if (!list.length) throw new Error("Turn on at least one kind of block under More options.");
  const px = scaleImage(img, w, h, o.crisp).data, N = w * h;
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N), alpha = new Uint8Array(N), lum = new Float32Array(N);
  for (let i = 0; i < N; i++) { const q = oklab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); L[i] = lum[i] = q[0]; A[i] = q[1]; B[i] = q[2]; alpha[i] = px[i * 4 + 3]; }
  const mask = o.cut ? subjectMask(px, w, h) : null;
  const pick = new Int32Array(N).fill(-1), cache = new Map();
  for (let y = 0; y < h; y++) {
    const rev = o.smooth && (y & 1);
    for (let k = 0; k < w; k++) {
      const x = rev ? w - 1 - k : k, i = y * w + x;
      if (o.clear && alpha[i] < 128) continue;
      if (mask && !mask[i]) continue;
      const key = o.smooth ? -1 : Math.round(L[i] * 300) * 1e6 + Math.round(A[i] * 300 + 500) * 1e3 + Math.round(B[i] * 300 + 500);
      let bi = key >= 0 ? cache.get(key) : undefined;
      if (bi === undefined) { bi = nearest(list, L[i], A[i], B[i]); if (key >= 0) cache.set(key, bi); }
      pick[i] = bi;
      if (o.smooth) {
        const q = list[bi].lab, eL = L[i] - q[0], eA = A[i] - q[1], eB = B[i] - q[2];
        const sp = (dx, dy, f) => { const nx = x + (rev ? -dx : dx), ny = y + dy; if (nx < 0 || nx >= w || ny >= h) return; const j = ny * w + nx; L[j] += eL * f; A[j] += eA * f; B[j] += eB * f; };
        sp(1, 0, 7 / 16); sp(-1, 1, 3 / 16); sp(0, 1, 5 / 16); sp(1, 1, 1 / 16);
      }
    }
    if ((y & 31) === 0) await tick();
  }
  const pal = [""], palIdx = new Map(), used = new Map();
  const idx = bi => { let v = palIdx.get(bi); if (v === undefined) { v = pal.length; pal.push(list[bi].e); palIdx.set(bi, v); } return v; };
  let size, data;
  if (o.mode === "wall") { size = [w, h, 1]; data = new Uint16Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const bi = pick[y * w + x]; if (bi < 0) continue; data[(h - 1 - y) * w + x] = idx(bi); used.set(bi, (used.get(bi) || 0) + 1); } }
  else if (o.mode === "floor") { size = [w, 1, h]; data = new Uint16Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const bi = pick[y * w + x]; if (bi < 0) continue; data[y * w + x] = idx(bi); used.set(bi, (used.get(bi) || 0) + 1); } }
  else {
    let lo = 1, hi = 0; for (let i = 0; i < N; i++) if (pick[i] >= 0) { lo = Math.min(lo, lum[i]); hi = Math.max(hi, lum[i]); }
    const span = Math.max(1e-4, hi - lo), Dp = o.depth;
    size = [w, h, Dp]; data = new Uint16Array(w * h * Dp);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, bi = pick[i]; if (bi < 0) continue;
      let t = (lum[i] - lo) / span; if (!o.brightForward) t = 1 - t;
      const depth = 1 + Math.round(t * (Dp - 1)), v = idx(bi), yy = h - 1 - y;
      for (let z = Dp - depth; z < Dp; z++) data[(yy * Dp + z) * w + x] = v;
      used.set(bi, (used.get(bi) || 0) + depth);
    }
  }
  const total = [...used.values()].reduce((a, b) => a + b, 0);
  const top = [...used].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([bi, n]) => `${list[bi].name} ${fmt(n)}`).join(", ");
  return { bp: { size, pal, data: encode(data), kind: { wall: "picture wall", floor: "picture floor", relief: "3D picture" }[o.mode] }, total, kinds: used.size, top, draw: c => drawFlat(c, pick, list, w, h) };
}
function drawFlat(c, pick, list, w, h) {
  const s = Math.max(1, Math.floor(520 / Math.max(w, h))); c.width = w * s; c.height = h * s;
  const x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height);
  for (let y = 0; y < h; y++) for (let k = 0; k < w; k++) { const bi = pick[y * w + k]; if (bi < 0) continue; const [r, g, b] = list[bi].rgb; x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(k * s, y * s, s, s); }
  c.hidden = false;
}

// ---------- voxels (models and .vox) to a blueprint ----------
function gridBlueprint(G, kind) {
  const list = palette("side");
  if (!list.length) throw new Error("Turn on at least one kind of block under More options.");
  const match = matcher(list);
  const [W, H, D] = G.size;
  const data = new Uint16Array(W * H * D);
  const pal = [""], palIdx = new Map(), used = new Map();
  const colorOf = new Map();
  for (const [k, a] of G.cells) {
    const n = Math.max(1, a[3]);
    const bi = match(a[0] / n, a[1] / n, a[2] / n);
    let v = palIdx.get(bi); if (v === undefined) { v = pal.length; pal.push(list[bi].e); palIdx.set(bi, v); }
    data[k] = v; used.set(bi, (used.get(bi) || 0) + 1); colorOf.set(k, list[bi].rgb);
  }
  const total = G.cells.size;
  const top = [...used].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([bi, n]) => `${list[bi].name} ${fmt(n)}`).join(", ");
  const keys = [...G.cells.keys()];
  return { bp: { size: G.size, pal, data: encode(data), kind }, total, kinds: used.size, top, draw: c => drawIso(c, G.size, k => colorOf.get(k), keys) };
}

// ---------- schematics ----------
async function schematicBlueprint(file, keepAir, S0) {
  const ext = S0 ? "commands" : (file.name.split(".").pop() || "").toLowerCase();
  let buf = S0 ? null : await file.arrayBuffer(), S = S0;
  if (S0) { }
  else if (ext === "mcstructure") S = readMcstructure(readNBT(buf, true));
  else {
    buf = await gunzipMaybe(buf);
    const root = readNBT(buf, false);
    if (ext === "litematic" || root.Regions) S = readLitematic(root);
    else if (ext === "schem" || ext === "schematic" || root.Schematic || root.BlockData || root.Palette) S = readSponge(root);
    else if (root.blocks && root.size) S = readStructureNbt(root);
    else if (root.Blocks && root.Width) S = readLegacySchematic(root);
    else if (root.size && root.structure) S = readMcstructure(root);
    else throw new Error("That is a Minecraft data file, but not one that holds a building. Schematics, structures and Litematica files do.");
  }
  const vol = S.w * S.h * S.d;
  if (vol > 40000000) throw new Error(`That schematic is ${S.w} by ${S.h} by ${S.d}, too big for one blueprint. Split it into smaller pieces first.`);
  const map = S.states.map(s => s ? (S.java ? javaToEntry(s.name, s.props) : bedrockToEntry(s.name, s.props)) : "");
  const pal = [""], palIdx = new Map([["", 0]]);
  const toIdx = map.map(e => { if (!e || (!keepAir && e === "minecraft:air|||")) return 0; let v = palIdx.get(e); if (v === undefined) { v = pal.length; pal.push(e); palIdx.set(e, v); } return v; });
  const data = new Uint16Array(vol); const keys = []; let blocks = 0;
  for (let i = 0; i < vol; i++) { const v = toIdx[S.grid[i]] || 0; data[i] = v; if (v && pal[v] !== "minecraft:air|||") { blocks++; keys.push(i); } }
  const colors = pal.map(e => e ? guessColor(e.split("|")[0]) : null);
  const bp = { size: [S.w, S.h, S.d], pal, data: encode(data), kind: ext === "commands" ? "Minecraft commands" : ext === "mcstructure" ? "Bedrock structure" : ext === "litematic" ? "Litematica schematic" : ext === "nbt" ? "Java structure" : "WorldEdit schematic" };
  const mats = materials(bp, data);
  return { bp, total: blocks, kinds: pal.length - 1, top: mats.slice(0, 5).map(([id, n]) => `${nice(id)} ${fmt(n)}`).join(", "), draw: c => drawIso(c, bp.size, k => colors[data[k]], keys) };
}

// ---------- preview ----------
let busy = false, again = false, timer = 0;
function schedulePreview() { clearTimeout(timer); timer = setTimeout(preview, 350); }
async function preview() {
  if (!cur) return;
  if (busy) { again = true; return; }
  busy = true; $("#addBtn").disabled = true;
  try {
    const sizeV = Math.max(1, parseInt($("#size").value, 10) || 1);
    let r;
    if (cur.kind === "picture") {
      const mode = document.querySelector("input[name=mode]:checked").value;
      if (mode === "sculpt") { say("Finding the subject and shaping it..."); await tick(); r = await sculptBlueprint(cur.img, { width: Math.min(256, Math.max(8, sizeV)), ratio: +$("#sculptDepth").value, detail: +$("#sculptDetail").value, solid: $("#sculptInside").value === "solid", smooth: $("#colors").value === "photo" }); }
      else r = await pictureBlueprint(cur.img, { cut: $("#cutBg").checked, mode, width: Math.min(512, Math.max(4, sizeV)), smooth: $("#colors").value === "photo", crisp: $("#colors").value === "pixel", clear: $("#clear").checked, depth: Math.min(32, Math.max(2, parseInt($("#depth").value, 10) || 8)), brightForward: $("#forward").value === "bright" });
    } else if (cur.kind === "model") {
      const single = $("#coloring").value === "one" ? hexRgb($("#oneColor").value) : null;
      say("Turning the model into blocks..."); await tick();
      const G = voxelize(cur.model, { size: Math.min(256, Math.max(4, sizeV)), up: $("#up").value === "auto" ? cur.model.up : $("#up").value, turn: +$("#turn").value, solid: $("#fill").value === "solid", single });
      r = gridBlueprint(G, "3D model");
    } else if (cur.kind === "vox") {
      r = gridBlueprint(voxFromVOX(cur.vox, { scale: Math.min(4, Math.max(1, sizeV)) }), "voxel model");
    } else r = await schematicBlueprint(cur.file, $("#keepAir").checked, cur.S);
    cur.result = r;
    r.draw($("#preview"));
    const [w, h, d] = r.bp.size;
    const secs = r.total / 14000;
    let desc = `${w} wide, ${h} tall, ${d} deep. ${fmt(r.total)} block${r.total === 1 ? "" : "s"} of ${r.kinds} kind${r.kinds === 1 ? "" : "s"}. Builds in about ${secs < 1.5 ? "a second" : secs < 60 ? Math.round(secs) + " seconds" : secs < 90 ? "a minute" : Math.round(secs / 60) + " minutes"} at normal speed. Most used: ${r.top}.`;
    const warn = [];
    if (h > 300) warn.push(`It is ${h} blocks tall, and the world only has 384 from bottom to top, so stand low or make it smaller.`);
    if (r.total > 600000) warn.push("This is huge. It will work, but it takes a while and big builds can make the game lag.");
    $("#result").textContent = desc; $("#warn").textContent = warn.join(" ");
    $("#preview").setAttribute("aria-label", "Preview. " + desc);
    say("Preview ready. " + desc + (warn.length ? " " + warn.join(" ") : ""));
    $("#addBtn").disabled = false;
  } catch (e) { say(e.message || String(e)); cur.result = null; }
  busy = false;
  if (again) { again = false; preview(); }
}
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------- library ----------
function addCurrent() {
  if (!cur || !cur.result) return;
  const bp = { ...cur.result.bp, name: cleanName($("#name").value || cur.name), blocks: cur.result.total };
  let name = bp.name, n = 2; while (state.bps.some(b => b.name === name)) name = bp.name + "_" + n++;
  bp.name = name;
  state.bps.push(bp);
  const ok = persist();
  if (window.GenesisCloud) GenesisCloud.added(bp);
  renderLibrary();
  say(`Added ${nice(name)} to your library. You have ${state.bps.length} now.${ok ? "" : " It's too big for this browser to remember after you close the page, so save the pack before you leave."} When you're ready, press Save to Minecraft.`);
  $("#libHead").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderLibrary() {
  const ul = $("#libList"); ul.innerHTML = "";
  $("#libEmpty").hidden = state.bps.length > 0;
  $("#libCount").textContent = state.bps.length ? `${state.bps.length}` : "";
  $("#packBtn").disabled = !state.bps.length;
  state.bps.forEach((bp, i) => {
    const li = document.createElement("li"); li.className = "bp";
    const h = document.createElement("h3"); h.textContent = nice(bp.name);
    const p = document.createElement("p"); p.className = "meta";
    p.textContent = `${bp.kind || "blueprint"} · ${bp.size.join(" × ")} · ${fmt(bp.blocks || 0)} blocks`;
    const row = document.createElement("div"); row.className = "row";
    const b1 = btn("Material list", () => { const pre = li.querySelector("pre"); if (pre) { pre.remove(); b1.setAttribute("aria-expanded", "false"); return; } const t = document.createElement("pre"); t.tabIndex = 0; t.textContent = materialText(bp); li.appendChild(t); b1.setAttribute("aria-expanded", "true"); t.focus(); });
    b1.setAttribute("aria-expanded", "false");
    const b2 = btn("Save list", () => saveFile(`${bp.name} materials.txt`, new Blob([materialText(bp)], { type: "text/plain" })));
    const b3 = btn("Remove", () => { if (b3.dataset.armed) { state.bps.splice(i, 1); persist(); if (window.GenesisCloud) GenesisCloud.removed(bp.name); renderLibrary(); say(`Removed ${nice(bp.name)}.`); } else { b3.dataset.armed = "1"; b3.textContent = "Press again to remove"; setTimeout(() => { if (b3.isConnected) { delete b3.dataset.armed; b3.textContent = "Remove"; } }, 4000); } });
    b1.className = b2.className = b3.className = "ghost";
    row.append(b1, b2, b3); li.append(h, p, row); ul.appendChild(li);
  });
}
function btn(t, f) { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", f); return b; }
function materialText(bp) {
  const l = materials(bp); const total = l.reduce((a, b) => a + b[1], 0);
  const lines = [`Materials for ${nice(bp.name)}`, `${bp.size[0]} wide, ${bp.size[1]} tall, ${bp.size[2]} deep. ${fmt(total)} items of ${l.length} kinds.`, ""];
  for (const [id, n] of l) lines.push(`${nice(id)}: ${fmt(n)}${n >= 64 ? `  (${Math.floor(n / 64)} stack${n >= 128 ? "s" : ""}${n % 64 ? " and " + (n % 64) : ""})` : ""}`);
  return lines.join("\n");
}

// ---------- saving files ----------
async function packIcon() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  x.fillStyle = "#1c1430"; x.fillRect(0, 0, 128, 128);
  const src = $("#preview");
  if (!src.hidden && src.width) { x.imageSmoothingEnabled = false; const s = Math.min(112 / src.width, 112 / src.height); x.drawImage(src, (128 - src.width * s) / 2, (128 - src.height * s) / 2, src.width * s, src.height * s); }
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
async function makePack() {
  if (!state.bps.length) { say("Your library is empty. Add something first."); return; }
  const lib = ($("#libName").value || "My Builds").trim().slice(0, 40);
  if (lib !== state.lib || !state.packUuid || !state.modUuid) { state.lib = lib; state.packUuid = uuid(); state.modUuid = uuid(); state.version = 0; }
  state.version = (state.version || 0) + 1; persist(); if (window.GenesisCloud) GenesisCloud.settings();
  const manifest = { format_version: 2, header: { name: "Genesis Library: " + lib, description: `${state.bps.length} blueprints for Genesis, made in Genesis Studio.`, uuid: state.packUuid, version: [1, 0, state.version], min_engine_version: [1, 21, 90] }, modules: [{ type: "script", language: "javascript", uuid: state.modUuid, version: [1, 0, state.version], entry: "scripts/main.js" }], dependencies: [{ module_name: "@minecraft/server", version: "2.0.0" }] };
  const blob = zip([["manifest.json", JSON.stringify(manifest, null, 2)], ["pack_icon.png", await packIcon()], ["scripts/main.js", packScript(cleanName(lib), state.bps)], ["materials.txt", state.bps.map(materialText).join("\n\n")]]);
  await saveFile("Genesis Library " + lib.replace(/[^A-Za-z0-9 _]/g, "") + ".mcpack", blob, true);
}
async function getMod() {
  if (typeof MOD_B64 === "undefined" || !MOD_B64) { say("Genesis is not inside this copy of the page."); return; }
  const s = atob(MOD_B64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  await saveFile("Genesis.mcaddon", new Blob([u], { type: "application/zip" }), true);
}
async function saveFile(filename, blob, isPack) {
  let dl = null;
  if (dl) {
    const name = isPack ? filename + ".zip" : filename;
    try { await dl.save({ filename: name, data: blob }); say(isPack ? `Saved ${name}. This page can only save zip files, so rename it and remove .zip from the end, leaving ${filename.split(".").pop()}. Then open it and Minecraft imports it. The Genesis Studio file on your computer saves it ready to open.` : `Saved ${name}.`); }
    catch (e) { say(e && e.code === "declined" ? "Save canceled." : "Couldn't save the file here: " + (e && e.message || e)); }
    return;
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  say(/mcaddon$/.test(filename) ? "Saved Genesis.mcaddon. Open it and Minecraft installs Genesis. Then make a world, and under Behavior Packs turn on Genesis." : isPack ? `Saved ${filename}. Open it, then in your world settings under Behavior Packs turn on "Genesis Library: ${state.lib}" next to Genesis. Load the world and type /build blueprints.` : `Saved ${filename}.`);
}

// ---------- samples ----------
function samplePicture() {
  const c = document.createElement("canvas"); c.width = 48; c.height = 32; const x = c.getContext("2d");
  ["#2b1b54", "#4a2370", "#7a2f7f", "#b0407a", "#e0646a", "#f39a4f", "#f8c45a"].forEach((col, i, a) => { x.fillStyle = col; x.fillRect(0, i * 4, 48, i === a.length - 1 ? 32 : 4); });
  x.fillStyle = "#ffe08a"; x.beginPath(); x.arc(24, 21, 7, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#3d2a5c"; for (let i = 0; i < 48; i++) { const h = 20 + Math.round(3 * Math.sin(i / 5) + 2 * Math.sin(i / 2.3)); x.fillRect(i, h, 1, 32 - h); }
  x.fillStyle = "#24163a"; for (let i = 0; i < 48; i++) { const h = 25 + Math.round(2 * Math.sin(i / 3 + 1)); x.fillRect(i, h, 1, 32 - h); }
  c.naturalWidth = 48; c.naturalHeight = 32;
  cur = { kind: "picture", name: "sample sunset", img: c, found: "the sample sunset, 48 by 32 pixels" };
  $("#name").value = "sample sunset"; showKind(); setPreset(48, true); $("#colors").value = "pixel";
  $("#found").textContent = "Loaded the sample sunset. Change the options or add it to your library."; preview();
}
function sampleModel() {
  // a little mushroom house, made from triangles so it runs through the same steps as a real model
  const M = { pos: [], uv: [], col: [], mat: [], mats: [{ name: "stem", color: [235, 225, 200] }, { name: "cap", color: [200, 40, 40] }, { name: "spots", color: [250, 250, 250] }, { name: "door", color: [110, 70, 40] }], up: "y" };
  const quad = (a, b, c, d, m) => { for (const t of [[a, b, c], [a, c, d]]) { M.pos.push(...t.flat()); M.uv.push(NaN, NaN, NaN, NaN, NaN, NaN); M.col.push(NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN); M.mat.push(m); } };
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const r = 3; quad([Math.cos(a0) * r, 0, Math.sin(a0) * r], [Math.cos(a1) * r, 0, Math.sin(a1) * r], [Math.cos(a1) * r, 5, Math.sin(a1) * r], [Math.cos(a0) * r, 5, Math.sin(a0) * r], i === 6 ? 3 : 0);
    for (let j = 0; j < 8; j++) {
      const b0 = j / 8 * Math.PI / 2, b1 = (j + 1) / 8 * Math.PI / 2, R = 7;
      const p = (a, b) => [Math.cos(a) * Math.cos(b) * R, 5 + Math.sin(b) * R * 0.75, Math.sin(a) * Math.cos(b) * R];
      quad(p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1), (i % 5 === 0 && j % 3 === 1) ? 2 : 1);
    }
  }
  cur = { kind: "model", name: "sample mushroom", model: M, found: "the sample mushroom house, a small 3D model" };
  $("#name").value = "sample mushroom"; showKind(); setPreset(24, true);
  $("#found").textContent = "Loaded the sample 3D model. Change the options or add it to your library."; preview();
}

// ---------- wiring ----------
function init() {
  const g = $("#groups");
  for (const [k, label, on] of GROUPS) { const l = document.createElement("label"); l.className = "check"; l.innerHTML = `<input type="checkbox" id="g_${k}" ${on ? "checked" : ""}><span>${label}</span>`; g.appendChild(l); }
  $("#libName").value = state.lib || "My Builds";
  const drop = $("#drop"), input = $("#file");
  input.addEventListener("change", e => { if (e.target.files.length) openFiles(e.target.files); });
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files); });
  for (const b of $$(".preset")) b.addEventListener("click", () => setPreset(+b.dataset.v));
  for (const el of $$("#options input, #options select")) el.addEventListener(el.type === "text" ? "change" : "input", () => { if (el.id === "size") for (const b of $$(".preset")) b.setAttribute("aria-pressed", "false"); if (el.id !== "name") schedulePreview(); });
  const cp = $("#copyPrompt"); if (cp) cp.addEventListener("click", async () => { const t = $("#promptText"); try { await navigator.clipboard.writeText(t.value); say("Copied. Paste it into Minecraft chat."); } catch (e) { t.select(); say("Selected. Copy it, then paste it into Minecraft chat."); } });
  const syncSculpt = () => { const m = document.querySelector("input[name=mode]:checked"); $("#sculptRow").hidden = !(m && m.value === "sculpt"); };
  for (const r of $$("input[name=mode]")) r.addEventListener("change", syncSculpt); syncSculpt();
  $("#coloring").addEventListener("input", () => { $("#oneColorRow").hidden = $("#coloring").value !== "one"; });
  $("#addBtn").addEventListener("click", addCurrent);
  $("#packBtn").addEventListener("click", () => makePack().catch(e => say("Couldn't make the pack: " + e.message)));
  $("#samplePic").addEventListener("click", samplePicture);
  $("#sampleModel").addEventListener("click", sampleModel);
  showKind(); renderLibrary();
}
if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", init);
