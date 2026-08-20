const INTEREST_HINTS = {
  bien: [
    "biển", "đảo", "vịnh", "san hô", "hải sản", "Nha Trang", "Phú Quốc", "Bình Hưng",
    "Ninh Chữ", "Vĩnh Hy", "Quy Nhơn", "Phú Yên", "Kỳ Co", "Eo Gió", "Hạ Long", "Sơn Trà", "Cù Lao Chàm",
  ],
  nui: [
    "núi", "Tây Bắc", "Đông Bắc", "Sapa", "Sa Pa", "Fansipan", "Hà Giang", "Cao Bằng", "Mù Cang Chải",
    "Pù Luông", "Tà Xùa", "Yên Bái", "Y Tý", "Hoàng Su Phì", "Đà Lạt", "Bạch Mã", "Hang Múa",
  ],
  "nghi duong": ["nghỉ dưỡng", "resort", "thư giãn", "du thuyền", "biển", "đảo", "vịnh"],
  "kham pha": ["khám phá", "trải nghiệm", "động", "hang", "vườn quốc gia", "săn mây", "trekking"],
  "mao hiem": ["trekking", "leo núi", "mạo hiểm", "phiêu lưu", "săn mây", "Hang Múa"],
  "leo nhieu": ["leo nhiều", "leo nhiều bậc", "leo núi", "trekking", "bậc đá", "bậc thang"],
  "van hoa": ["văn hóa", "di sản", "lịch sử", "phố cổ", "cố đô", "chùa", "cung điện"],
  "am thuc": ["ẩm thực", "cooking class", "hải sản", "bbq"],
};

const DIRECT_EXCLUSION_HINTS = {
  bien: ["biển", "bãi biển", "ven biển", "tắm biển", "đảo", "vịnh", "san hô", "hải sản"],
  "leo nhieu": ["leo nhiều", "leo nhiều bậc", "leo núi", "trekking", "bậc đá", "bậc thang"],
};

const { resolveTourRegions } = require("../utils/tourRegionResolver");

const AMBIGUOUS_ASCII_SINGLE_WORDS = new Set([
  "bien", "dao", "vinh", "dong", "hang", "co", "bo", "pho", "chua", "son",
]);

function normalizeEvidenceText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAscii(value) {
  return normalizeEvidenceText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function hasVietnameseDiacritics(value) {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(value);
}

function containsPhrase(haystack, needle) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function semanticPhraseEvidence(haystack, value) {
  const source = normalizeEvidenceText(haystack);
  const phrase = normalizeEvidenceText(value);
  if (!source || !phrase) return { matched: false, value, matchedTerm: null };
  if (containsPhrase(source, phrase)) return { matched: true, value, matchedTerm: value };

  const asciiPhrase = normalizeAscii(phrase);
  const isAmbiguousSingleWord = !asciiPhrase.includes(" ") && AMBIGUOUS_ASCII_SINGLE_WORDS.has(asciiPhrase);
  const canUseAsciiFallback = !isAmbiguousSingleWord && (
    !hasVietnameseDiacritics(phrase) || !hasVietnameseDiacritics(source)
  );
  if (canUseAsciiFallback && containsPhrase(normalizeAscii(source), asciiPhrase)) {
    return { matched: true, value, matchedTerm: value };
  }
  return { matched: false, value, matchedTerm: null };
}

function semanticPhraseMatch(haystack, value) {
  return semanticPhraseEvidence(haystack, value).matched;
}

function interestHints(value) {
  const key = normalizeAscii(value);
  return INTEREST_HINTS[key] || [value];
}

function conceptEvidenceText(haystack, value) {
  const key = normalizeAscii(value);
  if (key !== "bien") return haystack;
  // "Biển" is a travel concept, but common compounds such as "biển mây"
  // describe scenery rather than a coastal destination. Keep the original
  // diacritics so "biển" remains distinct from names such as "Biên Hòa".
  return normalizeEvidenceText(haystack)
    .replace(/\b(?:biển|bien)\s+(?:mây|may|người|nguoi|quảng\s+cáo|quang\s+cao)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticInterestEvidence(haystack, value, options = {}) {
  const evidenceText = conceptEvidenceText(haystack, value);
  const normalizedConcept = normalizeAscii(value);
  // A source that is itself unaccented can safely match the exact token
  // without collapsing accented place names such as "Biên Hòa" to "bien".
  if (normalizedConcept === "bien" && containsPhrase(normalizeEvidenceText(evidenceText), "bien")) {
    return { matched: true, value, matchedTerm: value };
  }
  const hints = options.directOnly
    ? DIRECT_EXCLUSION_HINTS[normalizedConcept] || interestHints(value)
    : interestHints(value);
  for (const hint of hints) {
    if (semanticPhraseMatch(evidenceText, hint)) return { matched: true, value, matchedTerm: hint };
  }
  return { matched: false, value, matchedTerm: null };
}

function semanticInterestMatch(haystack, value) {
  return semanticInterestEvidence(haystack, value).matched;
}

function tourEvidenceText(tour, { destinationOnly = false } = {}) {
  // Runtime regions keep semantic evidence aligned with filtering when the stored
  // Mongo region is stale; the stored field remains metadata-only.
  const values = [tour.name, tour.location, ...resolveTourRegions(tour), ...(tour.tags || [])];
  if (!destinationOnly) {
    values.push(
      tour.summary,
      tour.description,
      ...(tour.highlights || []),
      ...(tour.itinerary || []).flatMap((day) => [day.title, day.description, day.accommodation, ...(day.meals || [])])
    );
  }
  return values.filter(Boolean).join(" ");
}

function collectTourConstraintEvidence(tour, constraints = {}) {
  const fullText = tourEvidenceText(tour);
  const destinationText = tourEvidenceText(tour, { destinationOnly: true });
  const destinationValues = [...(constraints.destinations || []), constraints.destination].filter(Boolean);
  const interestExclusions = new Set(
    (constraints?._semanticState?.slots?.interests?.excludedValues || []).map(normalizeAscii)
  );
  return {
    destination: destinationValues.map((value) => semanticPhraseEvidence(destinationText, value)),
    interests: (constraints.interests || []).map((value) => semanticInterestEvidence(fullText, value)),
    exclusions: (constraints.exclusions || []).map((value) => {
      const evidence = interestExclusions.has(normalizeAscii(value))
        ? semanticInterestEvidence(fullText, value, { directOnly: true })
        : semanticPhraseEvidence(destinationText, value);
      return { value, ...evidence };
    }),
  };
}

module.exports = {
  INTEREST_HINTS,
  normalizeEvidenceText,
  normalizeAscii,
  semanticPhraseEvidence,
  semanticPhraseMatch,
  semanticInterestEvidence,
  semanticInterestMatch,
  interestHints,
  tourEvidenceText,
  collectTourConstraintEvidence,
};
