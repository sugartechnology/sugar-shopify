import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { koshoyInstructions } from "./instructions";
import { EMPTY_KOSHOY_BRIEF } from "./store.server";
import {
  checkReply,
  classifyScope,
  kindFromText,
  KOSHOY_RULES,
  KOSHOY_SAFE_EMPTY_REPLY,
  KOSHOY_SAFE_TOPIC_REPLY,
  numbersIn,
  pricesIn,
} from "./rules";

describe("koshoy rules single source", () => {
  it("puts every rule and the scope into the model instructions", () => {
    const text = koshoyInstructions({
      brief: EMPTY_KOSHOY_BRIEF,
      designs: [],
      activeDesignId: null,
    });
    for (const rule of KOSHOY_RULES) assert.ok(text.includes(rule.text), rule.id);
    assert.match(text, /Gardırop/);
    assert.match(text, /koltuk/);
    assert.match(text, /\[FİYAT\]/);
  });
});

describe("checkReply output guard", () => {
  // A tool payload: the price text is the only amount that may carry "TL".
  const allowed = [
    {
      price: "15.958,14 TL",
      design: { totalWidthCm: 192, units: [{ unit: 0, widthCm: 96, heightCm: 230.4 }] },
      notes: ["200 cm -> 192 cm"],
    },
  ];

  it("keeps numbers that came from tools", () => {
    const text = "Dolabın 192 cm oldu, 200 cm yerine. Fiyatı 15.958,14 TL.";
    const result = checkReply(text, allowed);
    assert.equal(result.text, text);
    assert.equal(result.changed, false);
    assert.deepEqual(result.issues, []);
  });

  it("replaces an invented price with [FİYAT]", () => {
    assert.equal(checkReply("Toplam 12.500 TL tutar.", allowed).text, "Toplam [FİYAT] tutar.");
    assert.equal(checkReply("Sadece ₺9.999!", allowed).text, "Sadece [FİYAT]!");
    assert.deepEqual(checkReply("Fiyatı 15958 lira.", allowed).issues, ["price"]);
  });

  it("accepts a currency amount only when it is exactly a quoted price", () => {
    // Sizes, indexes and counts of a real 2x960 gardırop turn are allowed numbers…
    const turnFacts = [
      { price: "15.958,14 TL", parts: [{ name: "gövde", qty: 2 }] },
      { totalWidthCm: 192, depthCm: 64, units: [{ unit: 0, widthCm: 96, heightCm: 230.4 }, { unit: 1 }] },
    ];
    // …but none of them, nor near-misses of the price, may pass as a price.
    for (const text of [
      "Toplam 15.961 TL.",
      "Toplam 15.955 TL.",
      "Fiyatı 15,96 TL.",
      "Fiyatı 192 TL.",
      "Fiyatı 96 TL.",
      "Fiyatı 1.000 TL.",
      "Fiyatı 2.000 TL.",
      "Fiyatı 2.000,00 TL.",
      "Toplam 1.995,00 TL.",
      "Fiyatı 96.000 TL.",
      "Fiyatı 2.304 TL.",
      "Fiyatı 230,4 TL.",
      "Fiyatı 5 bin TL.",
      "Fiyatı on beş bin lira.",
      "Fiyatı １５.９５８ TL.",
    ]) {
      const result = checkReply(text, turnFacts);
      assert.match(result.text, /\[FİYAT\]/u, text);
      assert.deepEqual(result.issues, ["price"], text);
    }
    assert.equal(checkReply("Fiyatı 192 TL.", turnFacts).text, "Fiyatı [FİYAT].");
    assert.equal(checkReply("Fiyatı 5 bin TL civarı.", turnFacts).text, "Fiyatı [FİYAT] civarı.");
    assert.equal(checkReply("Fiyatı 15.958,14 TL.", turnFacts).text, "Fiyatı 15.958,14 TL.");
    // Full-width digits are normalised, then checked like any other amount.
    assert.equal(checkReply("Fiyatı １５.９５８,１４ TL.", turnFacts).text, "Fiyatı 15.958,14 TL.");
    assert.equal(checkReply("Fiyatı 15.958,14 liraya geliyor.", turnFacts).text, "Fiyatı 15.958,14 liraya geliyor.");
    // An explicit price set wins over the facts.
    assert.equal(checkReply("Fiyatı 15.958,14 TL.", turnFacts, new Set()).text, "Fiyatı [FİYAT].");
    assert.deepEqual([...pricesIn(turnFacts)], ["15958.14"]);
  });

  it("does not read tr-TR thousands as small decimals", () => {
    const facts = [{ unit: 1, qty: 2, widthCm: 96 }];
    assert.equal(checkReply("Genişliği 1.000 cm.", facts).text, KOSHOY_SAFE_EMPTY_REPLY);
    assert.equal(checkReply("Fiyatı 2 bin.", facts).text, "Fiyatı [FİYAT].");
    assert.equal(checkReply("Genişliği 2 bin.", facts).text, KOSHOY_SAFE_EMPTY_REPLY);
    assert.equal(checkReply("Yüzde 5 indirim var.", facts).text, KOSHOY_SAFE_EMPTY_REPLY);
    assert.equal(checkReply("%5 indirim var.", facts).text, KOSHOY_SAFE_EMPTY_REPLY);
    assert.equal(checkReply("2 çekmece ve 1 raf.", facts).text, "2 çekmece ve 1 raf.");
  });

  it("treats spelled-out, foreign, bare and non-ASCII amounts as numbers", () => {
    const facts = [
      { price: "15.958,14 TL" },
      { totalWidthCm: 192, depthCm: 64, units: [{ unit: 0, widthCm: 96, heightCm: 230.4 }], parts: [{ name: "raf", qty: 12 }] },
    ];
    const cases: Array<[string, string]> = [
      // spelled-out amounts, with or without a currency, joined numerals included
      ["Fiyatı yaklaşık on beş bin civarında.", "Fiyatı yaklaşık [FİYAT] civarında."],
      ["Fiyatı yüz elli bin.", "Fiyatı [FİYAT]."],
      ["Fiyatı bin beş yüz civarı.", "Fiyatı [FİYAT] civarı."],
      ["Fiyatı on altı bin civarında olur.", "Fiyatı [FİYAT] civarında olur."],
      ["Bu tasarım onbeş bin TL.", "Bu tasarım [FİYAT]."],
      ["Bu tasarım yüzelli lira.", "Bu tasarım [FİYAT]."],
      // a known size is not a price
      ["Fiyatı yaklaşık 960 olur.", "Fiyatı yaklaşık [FİYAT] olur."],
      ["FİYATI 192 CİVARI.", "FİYATI [FİYAT] CİVARI."],
      // other currencies are never a quoted price
      ["Fiyatı 640 dolar.", "Fiyatı [FİYAT]."],
      ["Fiyatı 640 euro.", "Fiyatı [FİYAT]."],
      ["Fiyatı $640.", "Fiyatı [FİYAT]."],
      ["Fiyatı 15.958,14 USD.", "Fiyatı [FİYAT]."],
      // digits from other scripts and split digits
      ["Fiyatı ١٦٠٠٠ TL.", "Fiyatı [FİYAT]."],
      ["Fiyatı ۱۵۹۵۸ TL.", "Fiyatı [FİYAT]."],
      ["Fiyatı 1 5 9 5 8 TL.", "Fiyatı [FİYAT]."],
    ];
    for (const [text, expected] of cases) {
      const result = checkReply(text, facts);
      assert.equal(result.text, expected, text);
      assert.deepEqual(result.issues, ["price"], text);
    }
    // Spelled-out amounts outside price talk are invented numbers: dropped.
    for (const text of ["Yaklaşık yirmi bin.", "Derinliği elli santim.", "Yüzde on indirim var.", "Yaklaşık iki buçuk metre."]) {
      const result = checkReply(text, facts);
      assert.equal(result.text, KOSHOY_SAFE_EMPTY_REPLY, text);
      assert.deepEqual(result.issues, ["number"], text);
    }
    // Real prices, sizes, counts and ordinary words stay untouched.
    for (const text of [
      "Fiyatı 15.958,14 TL, 2 gövde dahil.",
      "Fiyatı 15.958,14.",
      "Fiyatı 15 958,14 TL.",
      "Bu fiyata 3 raf dahil.",
      "192 cm genişlikteki dolabın fiyatı 15.958,14 TL.",
      "Fiyatı 2. gövdeyle birlikte 15.958,14 TL.",
      "Bütçene uygun 2 seçenek hazırladım.",
      "On iki raf var.",
      "Doksan altı santim genişliğinde.",
      "Bir raf ekledim.",
      "İki çekmece ve bir askı var.",
      "Ön yüz rengi ahşap.",
      "Çekmecelerin altı boş.",
      "Birkaç raf ekledim, beşinci rafı kaldırdım.",
    ]) {
      assert.equal(checkReply(text, facts).text, text);
    }
    // Arabic-Indic digits are read like ASCII ones, so a real price still passes.
    assert.equal(checkReply("Fiyatı ١٥.٩٥٨,١٤ TL.", facts).text, "Fiyatı 15.958,14 TL.");
  });

  it("drops sentences with invented measurements but keeps small counts", () => {
    const result = checkReply("2 çekmece ekledim. Derinliği 55 cm yaptım. Rengi ahşap.", allowed);
    assert.equal(result.text, "2 çekmece ekledim. Rengi ahşap.");
    assert.deepEqual(result.issues, ["number"]);
  });

  it("replaces forbidden topics with one safe sentence", () => {
    const result = checkReply(
      "Kargo hızlı gelir. Kurulum da ücretsiz. Rengi çok güzel.",
      allowed,
    );
    assert.equal(result.text, `${KOSHOY_SAFE_TOPIC_REPLY} Rengi çok güzel.`);
    assert.deepEqual(result.issues, ["topic"]);
    assert.equal(
      checkReply("ÖDEME adımında taksit var.", allowed).text,
      KOSHOY_SAFE_TOPIC_REPLY,
    );
    assert.equal(
      checkReply("Odanın ölçüsünü söyler misin?", allowed).text,
      KOSHOY_SAFE_TOPIC_REPLY,
    );
  });

  it("catches common ways to talk about delivery, installation and payment", () => {
    for (const text of [
      "Teslim süresi kısa.",
      "Siparişin 3 iş gününde teslim edilir.",
      "Ustamız gelip kurar.",
      "Monte edilmiş gelir.",
      "Ekibimiz evine gelip monte eder.",
      "Kapıda öde.",
      "Kapıda nakit ödenir.",
      "Sevkiyat ücretsiz.",
      "İade hakkın var, 2 hafta içinde iade edebilirsin.",
      "Mon\u200btaj ücretsiz.",
      "Ürünü 3 gün içinde gönderiyoruz.",
      "Kapına kadar getiriyoruz.",
      "Ürünü adresine yollarız.",
      "Parçaları kolayca birleştirebilirsin, takarız da.",
      "Kapıda peşin alınır.",
      "Ürünün 2 yıl teminatı var.",
      "Siparişler kargoyla ulaştırılır.",
      "Ücretsiz değişim hakkın var.",
    ]) {
      const result = checkReply(text, allowed);
      assert.equal(result.text, KOSHOY_SAFE_TOPIC_REPLY, text);
      assert.deepEqual(result.issues, ["topic"], text);
    }
    // Product words that share a stem stay untouched.
    for (const text of [
      "Kurallara uygun bir raf ekledim.",
      "Bu modelin rengi çok güzel.",
      "Kurdele gibi ince bir raf.",
      "Odanın fotoğrafını gönderebilirsin.",
      "Rengi daha sıcak hale getirdim.",
      "Renk değişimini uyguladım.",
      "İki gövdeyi yan yana birleştirdim.",
      "Kapak takımı ahşap.",
    ]) {
      assert.equal(checkReply(text, allowed).text, text);
    }
  });

  it("scrubs internals: tool names, SKUs, platform names", () => {
    for (const text of [
      "plan_cabinet ile hazırladım.",
      "Bunu planCabinet ile yaptım.",
      "SKU kodu GOVDE oldu.",
      "Bunu Sugar altyapısı yaptı.",
      "Ben bir GPT modeliyim.",
      "Ben Opus modeliyim.",
      "Ben bir yapay zekayım.",
      "Ben Shopify üzerinde çalışan bir asistanım.",
      "MCP üzerinden baktım.",
      "Görsel: https://bucket.s3.eu-central-1.amazonaws.com/a.png",
      "Detaylar www.example.com adresinde.",
    ]) {
      const result = checkReply(text, allowed);
      assert.equal(result.text, KOSHOY_SAFE_TOPIC_REPLY, text);
      assert.deepEqual(result.issues, ["leak"], text);
    }
  });

  it("falls back to a safe sentence when nothing survives", () => {
    assert.equal(checkReply("Odan 4 metre.", allowed).text, KOSHOY_SAFE_EMPTY_REPLY);
    assert.equal(checkReply("", allowed).text, "");
  });

  it("ignores digits inside ids and allows roundings of real sizes", () => {
    const facts = numbersIn({ designId: "x43Q9", design: { heightCm: 230.4 } });
    assert.ok(facts.has("230.4") && facts.has("230"));
    assert.ok(!facts.has("43"));
    assert.equal(checkReply("Yüksekliği 230 cm.", facts).text, "Yüksekliği 230 cm.");
    assert.equal(checkReply("Genişliği 43 cm.", facts).text, KOSHOY_SAFE_EMPTY_REPLY);
  });

  it("does not treat thousand/decimal separators as sentence ends", () => {
    const result = checkReply("Toplam 15.958,14 TL. Kapaklar dahil.", allowed);
    assert.equal(result.text, "Toplam 15.958,14 TL. Kapaklar dahil.");
  });
});

describe("koshoy scope", () => {
  it("classifies requests without being fooled by 'yatak odası'", () => {
    assert.equal(classifyScope("Yatak odama beyaz bir dolap"), "in");
    assert.equal(classifyScope("Bir de koltuk istiyorum"), "out");
    assert.equal(classifyScope("Yatağımın yanına ne olur?"), "out");
    assert.equal(classifyScope("Mutfak dolabı lazım"), "out");
    assert.equal(classifyScope("Koltuğun yanına komodin"), "in");
    assert.equal(classifyScope("Merhaba"), "unknown");
    assert.equal(classifyScope("Bunu senin tarafından görmek isterim"), "unknown");
  });

  it("detects the product kind", () => {
    assert.equal(kindFromText("2 metre gardırop"), "gardirop");
    assert.equal(kindFromText("Salon için TV ünitesi"), "tv_unitesi");
    assert.equal(kindFromText("Şifonyer olsun"), "sifonyer");
    assert.equal(kindFromText("Merhaba"), null);
  });
});
