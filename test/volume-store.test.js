const assert = require("node:assert");
const test = require("node:test");

function makeFakeChromeStorage() {
  const store = {};
  return {
    storage: {
      local: {
        get(key, callback) {
          callback({ [key]: store[key] });
        },
        set(obj, callback) {
          Object.assign(store, obj);
          if (callback) callback();
        },
      },
    },
  };
}

function freshVolumeStore() {
  delete require.cache[require.resolve("../volume-store.js")];
  return require("../volume-store.js");
}

test("getVolume returns default 100 for unknown hostname", async () => {
  global.chrome = makeFakeChromeStorage();
  const { getVolume } = freshVolumeStore();
  const volume = await getVolume("example.com");
  assert.strictEqual(volume, 100);
});

test("setVolume then getVolume returns the stored value", async () => {
  global.chrome = makeFakeChromeStorage();
  const { setVolume, getVolume } = freshVolumeStore();
  await setVolume("youtube.com", 300);
  const volume = await getVolume("youtube.com");
  assert.strictEqual(volume, 300);
});

test("volumes are independent per hostname", async () => {
  global.chrome = makeFakeChromeStorage();
  const { setVolume, getVolume } = freshVolumeStore();
  await setVolume("youtube.com", 300);
  await setVolume("example.com", 50);
  assert.strictEqual(await getVolume("youtube.com"), 300);
  assert.strictEqual(await getVolume("example.com"), 50);
});

test("exposes DEFAULT_VOLUME of 100", () => {
  global.chrome = makeFakeChromeStorage();
  const { DEFAULT_VOLUME } = freshVolumeStore();
  assert.strictEqual(DEFAULT_VOLUME, 100);
});

test("getTheme returns default 'auto' when unset", async () => {
  global.chrome = makeFakeChromeStorage();
  const { getTheme } = freshVolumeStore();
  const theme = await getTheme();
  assert.strictEqual(theme, "auto");
});

test("setTheme then getTheme returns the stored value", async () => {
  global.chrome = makeFakeChromeStorage();
  const { setTheme, getTheme } = freshVolumeStore();
  await setTheme("dark");
  assert.strictEqual(await getTheme(), "dark");
});

test("theme storage key cannot collide with a hostname volume key", async () => {
  global.chrome = makeFakeChromeStorage();
  const { setTheme, setVolume, getTheme, getVolume } = freshVolumeStore();
  await setTheme("dark");
  await setVolume("example.com", 300);
  assert.strictEqual(await getTheme(), "dark");
  assert.strictEqual(await getVolume("example.com"), 300);
});

test("getLimiter returns disabled default for site and global", async () => {
  global.chrome = makeFakeChromeStorage();
  const { getLimiter } = freshVolumeStore();
  const def = { enabled: false, mode: "manual", ceiling: -6, headroom: 10 };
  assert.deepStrictEqual(await getLimiter("example.com"), def);
  assert.deepStrictEqual(await getLimiter(null), def);
});

test("site and global limiters are stored separately", async () => {
  global.chrome = makeFakeChromeStorage();
  const { setLimiter, getLimiter, setVolume, getVolume } = freshVolumeStore();
  await setVolume("example.com", 200);
  await setLimiter("example.com", { enabled: true, mode: "manual", ceiling: -12, headroom: 6 });
  await setLimiter(null, { enabled: true, mode: "auto", ceiling: -3, headroom: 4 });
  assert.deepStrictEqual(await getLimiter("example.com"), { enabled: true, mode: "manual", ceiling: -12, headroom: 6 });
  assert.deepStrictEqual(await getLimiter(null), { enabled: true, mode: "auto", ceiling: -3, headroom: 4 });
  assert.strictEqual(await getVolume("example.com"), 200);
});

test("resolveLimiter: site wins, then global, else null", () => {
  global.chrome = makeFakeChromeStorage();
  const { resolveLimiter } = freshVolumeStore();
  const site = { enabled: true, ceiling: -12 };
  const global_ = { enabled: true, ceiling: -3 };
  assert.strictEqual(resolveLimiter(site, global_), site);
  assert.strictEqual(resolveLimiter({ ...site, enabled: false }, global_), global_);
  assert.strictEqual(resolveLimiter({ ...site, enabled: false }, { ...global_, enabled: false }), null);
});

test("getLimiter upgrades saves from before auto mode existed", async () => {
  global.chrome = makeFakeChromeStorage();
  const { setLimiter, getLimiter } = freshVolumeStore();
  await setLimiter("example.com", { enabled: true, ceiling: -20 });
  assert.deepStrictEqual(await getLimiter("example.com"), { enabled: true, mode: "manual", ceiling: -20, headroom: 10 });
});
