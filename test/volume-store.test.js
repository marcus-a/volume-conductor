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
