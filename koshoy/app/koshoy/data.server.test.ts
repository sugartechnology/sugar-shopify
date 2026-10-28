import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKoshoyDataStore,
  KOSHOY_DATA_DEFAULTS,
  KOSHOY_DATA_KEYS,
  validateImages,
  validateKinds,
  validateKoshoyData,
  validateLevels,
  validateRooms,
  validateScope,
  validateTexts,
} from "./data.server";
import { DESIGN_KINDS } from "./engine";
import { createMemoryDataDb } from "./memory-data-db";
import { KOSHOY_SCOPE } from "./rules";

function setup(start = 1_000_000) {
  let now = start;
  const memory = createMemoryDataDb(() => now);
  const store = createKoshoyDataStore(memory.db, { now: () => now, cacheMs: 60_000 });
  return { ...memory, store, advance: (ms: number) => (now += ms) };
}

const errorsOf = (result: { ok: boolean; errors?: string[] }) => (result.ok ? [] : result.errors ?? []);

describe("koshoy data defaults", () => {
  it("every default passes its own validator", () => {
    for (const key of KOSHOY_DATA_KEYS) {
      const result = validateKoshoyData(key, KOSHOY_DATA_DEFAULTS[key]);
      assert.ok(result.ok, `${key}: ${errorsOf(result).join(" | ")}`);
      assert.deepEqual(result.value, KOSHOY_DATA_DEFAULTS[key]);
    }
  });

  it("rooms start from the 23 Oct room sets (Akın corrects them through the data API)", () => {
    assert.equal(KOSHOY_DATA_DEFAULTS.rooms.length, 7);
    assert.deepEqual(KOSHOY_DATA_DEFAULTS.rooms.find((room) => room.id === "calisma_odasi")?.items, [{ kind: "kitaplik", count: 2 }]);
  });

  it("kinds cover every design kind; only kitaplik joins the same kind", () => {
    assert.deepEqual(KOSHOY_DATA_DEFAULTS.kinds.map((row) => row.kind), [...DESIGN_KINDS]);
    assert.deepEqual(
      KOSHOY_DATA_DEFAULTS.kinds.filter((row) => row.joinSameKind).map((row) => row.kind),
      ["kitaplik"],
    );
    const wardrobe = KOSHOY_DATA_DEFAULTS.kinds.find((row) => row.kind === "gardirop");
    assert.deepEqual(wardrobe?.questions.map((q) => q.level), ["room", "product"]);
    assert.equal(wardrobe?.questions[0].options[1].hint, "toplam genişlik 192 cm");
  });

  it("scope comes from the rules", () => {
    assert.deepEqual(KOSHOY_DATA_DEFAULTS.scope.outOfScope, [...KOSHOY_SCOPE.outOfScope]);
    assert.deepEqual(KOSHOY_DATA_DEFAULTS.scope.unsaid, ["nem dayanımı"]);
  });
});

describe("koshoy data validators", () => {
  it("rooms: unknown kind, bad count, duplicate id and empty items are named by row", () => {
    const result = validateRooms([
      { id: "salon", label: "Salon", synonyms: [], items: [{ kind: "dolap", count: 1 }] },
      { id: "salon", label: "Salon 2", synonyms: [], items: [{ kind: "kitaplik", count: 5 }] },
      { id: "Yatak Odası", label: "", synonyms: [], items: [] },
    ]);
    const errors = errorsOf(result);
    assert.ok(errors.some((e) => e.startsWith("Oda 1 (salon), ürün 1") && e.includes('"kind"')));
    assert.ok(errors.some((e) => e.startsWith("Oda 2 (salon), ürün 1") && e.includes('"count"')));
    assert.ok(errors.some((e) => e.startsWith("Oda 2 (salon)") && e.includes("iki kez")));
    assert.ok(errors.some((e) => e.startsWith("Oda 3") && e.includes('"id"')));
    assert.ok(errors.some((e) => e.startsWith("Oda 3") && e.includes('"label"')));
    assert.ok(errors.some((e) => e.startsWith("Oda 3") && e.includes('"items"')));
  });

  it("rooms: unknown fields are dropped, text is trimmed", () => {
    const result = validateRooms([
      { id: "antre", label: " Antre ", synonyms: ["giriş"], items: [{ kind: "vestiyer", count: 1, color: "x" }], note: "?" },
    ]);
    assert.ok(result.ok);
    assert.deepEqual(result.value, [
      { id: "antre", label: "Antre", synonyms: ["giriş"], items: [{ kind: "vestiyer", count: 1 }] },
    ]);
  });

  it("kinds: a kind twice, a bad question level and too few options fail", () => {
    const question = { id: "q", level: "oda", question: "Soru?", options: [{ id: "a", label: "A", hint: "h" }] };
    const result = validateKinds([
      { kind: "gardirop", label: "Gardırop", synonyms: [], joinSameKind: false, questions: [question] },
      { kind: "gardirop", label: "Gardırop", synonyms: [], joinSameKind: "evet", questions: [] },
    ]);
    const errors = errorsOf(result);
    assert.ok(errors.some((e) => e.includes("soru 1 (q)") && e.includes('"level"')));
    assert.ok(errors.some((e) => e.includes("soru 1 (q)") && e.includes('"options" 2–4')));
    assert.ok(errors.some((e) => e.startsWith("Tür 2 (gardirop)") && e.includes("iki kez")));
    assert.ok(errors.some((e) => e.startsWith("Tür 2 (gardirop)") && e.includes('"joinSameKind"')));
  });

  it("levels: forbidden price words and bad choices fail", () => {
    for (const label of ["En ucuz olsun", "Hesaplı olsun", "HESAPLI"]) {
      const result = validateLevels([{ id: "a", label, crown: "auto", front: "auto" }]);
      assert.ok(errorsOf(result).some((e) => e.includes("ucuz")), label);
    }
    const result = validateLevels([{ id: "a", label: "İyi", crown: "always", front: "ask" }]);
    assert.ok(errorsOf(result).some((e) => e.includes('"crown"')));
    assert.ok(!validateLevels([]).ok, "at least one level");
  });

  it("scope and texts need their fields; texts at most 300 characters", () => {
    assert.ok(!validateScope([]).ok);
    assert.ok(!validateScope({ outOfScope: ["koltuk"] }).ok, "unsaid missing");
    assert.ok(validateScope({ outOfScope: [], unsaid: [] }).ok);
    assert.ok(!validateTexts({ customMadeWarning: "x".repeat(301), promiseLine: "y" }).ok);
    assert.ok(!validateTexts({ customMadeWarning: "  ", promiseLine: "y" }).ok);
  });

  it("images: only https on the S3 CDN host and known option names", () => {
    const good = { kind: "*", option: "crown_on", url: "https://image-s3.sm.mncdn.com/koshoy/crown.jpg" };
    assert.ok(validateImages([good, { ...good, kind: "gardirop", option: "front_kapak-18" }]).ok);
    const errors = errorsOf(
      validateImages([
        { ...good, url: "http://image-s3.sm.mncdn.com/a.jpg" },
        { ...good, option: "crown_maybe", url: "https://img-sugartech.sm.mncdn.com/a.jpg" },
        good,
      ]),
    );
    assert.ok(errors.some((e) => e.startsWith("Resim 1") && e.includes('"url"')));
    assert.ok(errors.some((e) => e.startsWith("Resim 2") && e.includes('"option"')));
    assert.ok(errors.some((e) => e.startsWith("Resim 2") && e.includes('"url"')));
    assert.ok(errors.some((e) => e.startsWith("Resim 3") && e.includes("iki kez")));
  });

  it("caps a document at 64 KB", () => {
    const result = validateKoshoyData("scope", { outOfScope: ["x".repeat(70_000)], unsaid: [] });
    assert.ok(errorsOf(result)[0].includes("64 KB"));
  });
});

describe("koshoy data store", () => {
  it("serves defaults until something is saved", async () => {
    const { store } = setup();
    assert.deepEqual(await store.snapshot(), KOSHOY_DATA_DEFAULTS);
    assert.deepEqual(await store.get("texts"), { version: 0, source: "default", value: KOSHOY_DATA_DEFAULTS.texts });
  });

  it("put validates, bumps the version and keeps history", async () => {
    const { store, docs } = setup();
    const bad = await store.put("texts", { customMadeWarning: "", promiseLine: "x" });
    assert.equal(bad.ok, false);
    assert.equal(docs.size, 0, "nothing saved on errors");

    const texts = { customMadeWarning: "Özel üretim.", promiseLine: "Sepette göreceksin." };
    assert.deepEqual(await store.put("texts", texts), { ok: true, version: 1 });
    assert.deepEqual(await store.put("texts", { ...texts, promiseLine: "Yeni." }), { ok: true, version: 2 });
    assert.deepEqual(await store.get("texts"), {
      version: 2,
      source: "db",
      value: { ...texts, promiseLine: "Yeni." },
    });
    const history = await store.history("texts");
    assert.deepEqual(history.map((row) => row.version), [2, 1]);
    assert.deepEqual(history[1].value, texts);
  });

  it("snapshot is cached; a put clears the cache", async () => {
    const { store, docs, advance } = setup();
    await store.snapshot();
    docs.set("scope", {
      key: "scope",
      version: 1,
      json: JSON.stringify({ outOfScope: ["koltuk"], unsaid: [] }),
      updatedAt: new Date(),
    });
    assert.deepEqual((await store.snapshot()).scope, KOSHOY_DATA_DEFAULTS.scope, "still cached");
    advance(60_001);
    assert.deepEqual((await store.snapshot()).scope.outOfScope, ["koltuk"]);

    await store.put("scope", { outOfScope: ["yatak"], unsaid: [] });
    assert.deepEqual((await store.snapshot()).scope.outOfScope, ["yatak"]);
  });

  it("a stored document that no longer validates falls back to its default and shows in audit", async () => {
    const { store, docs } = setup();
    docs.set("rooms", {
      key: "rooms",
      version: 3,
      json: JSON.stringify([{ id: "salon", label: "Salon", synonyms: [], items: [{ kind: "kanepe", count: 1 }] }]),
      updatedAt: new Date(),
    });
    docs.set("texts", { key: "texts", version: 1, json: "{not json", updatedAt: new Date() });
    const snapshot = await store.snapshot();
    assert.deepEqual(snapshot.rooms, KOSHOY_DATA_DEFAULTS.rooms);
    assert.deepEqual(snapshot.texts, KOSHOY_DATA_DEFAULTS.texts);
    assert.equal((await store.get("rooms")).source, "default");

    const audit = await store.audit();
    assert.deepEqual(audit.map((row) => row.key).sort(), ["rooms", "texts"]);
    assert.ok(audit.every((row) => row.errors.length > 0));
  });

  it("snapshot never throws: a failing database gives the last good data, else defaults", async () => {
    let failing = true;
    const memory = createMemoryDataDb();
    let now = 0;
    const db = {
      ...memory.db,
      koshoyDataDoc: {
        ...memory.db.koshoyDataDoc,
        findMany: async () => {
          if (failing) throw new Error("no table");
          return memory.db.koshoyDataDoc.findMany();
        },
      },
    };
    const store = createKoshoyDataStore(db, { now: () => now, cacheMs: 10 });
    assert.deepEqual(await store.snapshot(), KOSHOY_DATA_DEFAULTS);

    failing = false;
    await store.put("scope", { outOfScope: ["yatak"], unsaid: [] });
    now += 20;
    assert.deepEqual((await store.snapshot()).scope.outOfScope, ["yatak"]);

    failing = true;
    now += 20;
    assert.deepEqual((await store.snapshot()).scope.outOfScope, ["yatak"], "last good data");
  });

  it("a snapshot changed by a caller never changes the defaults", async () => {
    const { store } = setup();
    const snapshot = await store.snapshot();
    snapshot.rooms.length = 0;
    assert.ok(KOSHOY_DATA_DEFAULTS.rooms.length > 0);
  });
});
