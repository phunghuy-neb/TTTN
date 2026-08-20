const test = require("node:test");
const assert = require("node:assert/strict");

const advisor = require("../src/services/travelAdvisorService");
const rag = require("../src/services/ragService");
const { resolveTourRegions } = require("../src/utils/tourRegionResolver");

const NOW = new Date("2026-08-21T00:00:00Z");

function tour(overrides = {}) {
  return {
    _id: "64b000000000000000009001",
    name: "Tour miền Trung",
    location: "Đà Nẵng",
    region: "Miền Nam",
    status: "published",
    isActive: true,
    days: 4,
    basePrice: 5_000_000,
    avgRating: 4.5,
    tags: [],
    highlights: [],
    summary: "",
    description: "",
    itinerary: [],
    inclusions: [],
    exclusions: [],
    departures: [],
    reviews: [],
    ...overrides,
  };
}

test("AI resolver follows backend region conventions and ignores departure/return transport", () => {
  assert.deepEqual(resolveTourRegions({ name: "Khởi hành Hà Nội → Quy Nhơn → Phú Yên" }), ["Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Khởi hành Hà Nội → Đà Nẵng" }), ["Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Khởi hành Hà Nội → Nha Trang → Ninh Thuận" }), ["Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Khởi hành HCM → Hà Giang → Cao Bằng" }), ["Miền Bắc"]);
  assert.deepEqual(resolveTourRegions({ name: "Tour Bình Hưng", itinerary: [
    { title: "HCM - Bình Hưng", description: "Điểm đón khách: Điện Biên Phủ, Biên Hòa, Đồng Nai, Bình Phước." },
    { title: "Bình Hưng - HCM", description: "Xe đưa đoàn về lại TP.HCM." },
  ] }), ["Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Quảng Bình" }), ["Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Đà Lạt", location: "Lâm Đồng" }), ["Miền Trung"]);
});

test("AI resolver supports runtime multi-region without persisting a field", () => {
  assert.deepEqual(resolveTourRegions({ name: "Ninh Bình → Huế → Đà Nẵng" }), ["Miền Bắc", "Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Huế → Đà Nẵng → TP.HCM → Cần Thơ" }), ["Miền Trung", "Miền Nam"]);
  assert.deepEqual(resolveTourRegions({ name: "Hà Nội → Hạ Long → Huế → Đà Nẵng → TP.HCM → Cần Thơ" }), ["Miền Bắc", "Miền Trung", "Miền Nam"]);
  assert.deepEqual(resolveTourRegions({ name: "Hành trình đến địa điểm bí ẩn" }), []);
});

test("AI resolver avoids substring and transport false positives", () => {
  assert.deepEqual(resolveTourRegions({ name: "Phú Yên - Bãi Xép" }), ["Miền Trung"]);
  assert.deepEqual(resolveTourRegions({ name: "Đường Hồ Chí Minh" }), []);
  assert.deepEqual(resolveTourRegions({ name: "Hạ Long (Ăn Trưa)" }), ["Miền Bắc"]);
  assert.deepEqual(resolveTourRegions({ name: "Phật Thích ca Mâu ni" }), []);
});

test("AI hard region filtering uses runtime regions instead of stored region", () => {
  const centralWithWrongStoredRegion = tour({
    _id: "64b000000000000000009002",
    name: "Khởi hành Hà Nội → Đà Nẵng",
    location: "Đà Nẵng",
    region: "Miền Bắc",
  });
  const northWithWrongStoredRegion = tour({
    _id: "64b000000000000000009003",
    name: "Hà Giang khám phá",
    location: "Hà Giang",
    region: "Miền Trung",
  });
  const ranked = rag.filterAndRankHydratedTours(
    [northWithWrongStoredRegion, centralWithWrongStoredRegion],
    { region: "Miền Trung" },
    { requestType: "recommendation", limit: 10 },
  );
  assert.deepEqual(ranked.map((item) => String(item._id)), [centralWithWrongStoredRegion._id]);
  assert.equal(rag.tourMatchesConstraints(centralWithWrongStoredRegion, { region: "Miền Trung" }), true);
  assert.equal(rag.tourMatchesConstraints(northWithWrongStoredRegion, { region: "Miền Trung" }), false);
});

test("AI region filtering preserves publication and hard budget/duration constraints", () => {
  const valid = tour({ _id: "64b000000000000000009004", region: "Miền Bắc" });
  const overBudget = tour({ _id: "64b000000000000000009005", basePrice: 7_000_000, region: "Miền Bắc" });
  const inactive = tour({ _id: "64b000000000000000009006", isActive: false, region: "Miền Bắc" });
  const draft = tour({ _id: "64b000000000000000009007", status: "draft", region: "Miền Bắc" });
  const constraints = { region: "Miền Trung", maxPrice: 6_000_000, days: 4 };
  assert.equal(rag.tourMatchesConstraints(valid, constraints), true);
  assert.equal(rag.tourMatchesConstraints(overBudget, constraints), false);
  assert.equal(rag.tourMatchesConstraints(inactive, constraints), false);
  assert.equal(rag.tourMatchesConstraints(draft, constraints), false);
});

test("Mongo fallback keeps region broad for runtime filtering", () => {
  const query = rag.buildMongoFallbackQuery({ region: "Miền Trung", maxPrice: 6_000_000 });
  assert.equal(query.region, undefined);
  assert.deepEqual(query.basePrice, { $lte: 6_000_000 });
});

test("recommendation explanations use runtime region", () => {
  const [item] = advisor.buildRecommendationItems([
    tour({ name: "Khởi hành Hà Nội → Đà Nẵng", location: "Đà Nẵng", region: "Miền Bắc" }),
  ], { region: "Miền Trung" }, NOW);
  assert.ok(item.currentConstraintReasons.some((reason) => /thuộc Miền Trung/i.test(reason)));
});

test("destination-to-region inference uses the same resolver convention", () => {
  for (const destination of ["Đà Lạt", "Lâm Đồng", "Quảng Bình", "Bình Hưng"]) {
    const delta = advisor.extractConstraintDelta(`Tìm tour ${destination}`, {}, NOW);
    assert.equal(delta.region, "Miền Trung", destination);
  }
});
