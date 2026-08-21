const TIME_ZONE = "Asia/Ho_Chi_Minh";
const {
  SEMANTIC_STATE_KEY,
  SEMANTIC_STATE_VERSION,
  createSpanRegistry,
  migrateLegacyConstraintState,
  mergeSemanticState,
  projectSemanticState,
  validateSemanticStateV2,
} = require("./semanticStateV2");
const {
  semanticInterestMatch,
  collectTourConstraintEvidence,
  tourEvidenceText,
} = require("./retrievalEvidenceService");
const {
  effectivePartySize,
  budgetMatchEvidence,
  buildTourFactualContext,
  buildGroundingContract,
  groundingForTour,
} = require("./factualGroundingService");
const { resolveTourRegions } = require("../utils/tourRegionResolver");

const DESTINATION_REGIONS = new Map([
  ["phu quoc", "Miền Nam"],
  ["nha trang", "Miền Trung"],
  ["da nang", "Miền Trung"],
  ["da lat", "Miền Trung"],
  ["ha long", "Miền Bắc"],
  ["sa pa", "Miền Bắc"],
  ["sapa", "Miền Bắc"],
  ["hoi an", "Miền Trung"],
  ["hue", "Miền Trung"],
  ["quang binh", "Miền Trung"],
  ["ninh binh", "Miền Bắc"],
  ["binh hung", "Miền Trung"],
  ["mien tay", "Miền Nam"],
]);

const DESTINATIONS = [
  "Phú Quốc",
  "Nha Trang",
  "Đà Nẵng",
  "Đà Lạt",
  "Hạ Long",
  "Sa Pa",
  "Hội An",
  "Huế",
  "Quảng Bình",
  "Ninh Bình",
  "Bình Hưng",
  "Miền Tây",
];

function inferDestinationRegion(value) {
  const runtimeRegions = resolveTourRegions({ name: value });
  return runtimeRegions.length === 1
    ? runtimeRegions[0]
    : DESTINATION_REGIONS.get(normalizeText(value));
}

const INTEREST_KEYWORDS = [
  { value: "biển", words: ["bien", "dao", "tam bien"] },
  { value: "bơi", words: ["boi"] },
  { value: "thuyền", words: ["du thuyen", "cheo thuyen", "thuyen"] },
  { value: "kayak", words: ["cheo kayak", "kayak"] },
  { value: "leo nhiều", words: ["leo nhieu bac", "leo nhieu"] },
  { value: "núi", words: ["nui", "trekking", "leo nui"] },
  { value: "nghỉ dưỡng", words: ["nghi duong", "resort", "thu gian"] },
  { value: "văn hóa", words: ["van hoa", "di san", "lich su"] },
  { value: "ẩm thực", words: ["am thuc", "mon ngon", "hai san"] },
  { value: "gia đình", words: ["gia dinh", "tre em", "be "] },
  { value: "mạo hiểm", words: ["mao hiem", "phieu luu"] },
  { value: "khám phá", words: ["kham pha", "trai nghiem nhieu", "di nhieu", "nang dong"] },
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\bko\b/g, "khong")
    .replace(/\s+/g, " ")
    .trim();
}

function isCancellationPolicyQuestion(message) {
  const normalized = normalizeText(message);
  return /\b(?:chinh sach huy|phi huy|dieu kien huy|huy tour|huy (?:the nao|ra sao)|hoan (?:tien|tour))\b/.test(normalized);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values.filter(Boolean).map(String).map((value) => value.trim()).filter((value) => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueIds(values = []) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(String).filter((value) => /^[0-9a-fA-F]{24}$/.test(value)))];
}

function parseNumberToken(value) {
  const normalized = normalizeText(value);
  if (NUMBER_WORDS.has(normalized)) return NUMBER_WORDS.get(normalized);
  const number = Number(normalized.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function globalMatches(text, regex) {
  return [...text.matchAll(regex)];
}

function correctionAfter(text, start) {
  const before = text.slice(Math.max(0, start - 28), start);
  return /(?:\ba\b|thoi|y la|sua lai|doi thanh|doi sang)\s*$/.test(before);
}

function semanticPrefixStart(text, start, pattern, lookBehind = 40) {
  const prefixStart = Math.max(0, start - lookBehind);
  const prefix = text.slice(prefixStart, start);
  const match = prefix.match(pattern);
  return match ? prefixStart + match.index : start;
}

function semanticBudgetCandidate(message, registry = null) {
  const normalized = normalizeText(message);
  const rawMessage = String(message || "").toLowerCase().normalize("NFC");
  const candidates = [];
  const rangeRegex = new RegExp(`\\b(${NUMBER_TOKEN}(?:[.,]\\d+)?)\\s*(?:-|–|den|toi)\\s*(${NUMBER_TOKEN}(?:[.,]\\d+)?)\\s*(?:trieu|tr|cu)\\b`, "g");
  for (const match of globalMatches(normalized, rangeRegex)) {
    const left = parseNumberToken(match[1]);
    const right = parseNumberToken(match[2]);
    if (left === null || right === null) continue;
    const claimStart = semanticPrefixStart(normalized, match.index, /(?:khoang|tam(?: tam)?|xap xi|gan)\s*$/);
    registry?.claim("budget", claimStart, match.index + match[0].length);
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      operator: "range",
      min: Math.round(Math.min(left, right) * 1_000_000),
      max: Math.round(Math.max(left, right) * 1_000_000),
      target: null,
    });
  }

  const millionRegex = new RegExp(`\\b(${NUMBER_TOKEN}(?:[.,]\\d+)?)\\s*(?:trieu|tr|cu)\\b`, "g");
  for (const match of globalMatches(normalized, millionRegex)) {
    const start = match.index;
    const end = start + match[0].length;
    if (registry?.overlaps(start, end)) continue;
    const number = parseNumberToken(match[1]);
    if (number === null) continue;
    const prefix = normalized.slice(Math.max(0, start - 30), start);
    const suffix = normalized.slice(end, Math.min(normalized.length, end + 24));
    let operator = "max";
    if (/(?:it nhat|toi thieu|tu)\s*$/.test(prefix)) operator = "min";
    else if (/(?:khong qua|toi da|duoi|duoi muc)\s*$/.test(prefix)) operator = "max";
    else if (/(?:khoang|tam(?: tam)?|xap xi|gan)\s*$/.test(prefix)) operator = "approximate";
    else if (/(?:dung|chinh xac)\s*$/.test(prefix)) operator = "exact";
    else if (/^\s*(?:khoang|tam(?: tam)?|xap xi)\b/.test(suffix)) operator = "approximate";
    const claimStart = semanticPrefixStart(
      normalized,
      start,
      /(?:it nhat|toi thieu|tu|khong qua|toi da|duoi(?: muc)?|khoang|tam(?: tam)?|xap xi|gan|dung|chinh xac)\s*$/
    );
    registry?.claim("budget", claimStart, end);
    const amount = Math.round(number * 1_000_000);
    candidates.push({
      start,
      end,
      operator,
      min: operator === "min" ? amount : null,
      max: operator === "max" ? amount : null,
      target: ["exact", "approximate"].includes(operator) ? amount : null,
    });
  }

  const dongRegex = /\b(\d{1,3}(?:[.,]\d{3}){1,3}|\d{1,9})\s*(?:d|dong|vnd)\b/g;
  for (const match of globalMatches(normalized, dongRegex)) {
    const start = match.index;
    const end = start + match[0].length;
    if (registry?.overlaps(start, end)) continue;
    if (/\bdòng\b/u.test(rawMessage.slice(start, end))) continue;
    const amount = Number(match[1].replace(/[.,]/g, ""));
    const prefix = normalized.slice(Math.max(0, start - 30), start);
    const operator = /(?:it nhat|toi thieu|tu)\s*$/.test(prefix)
      ? "min"
      : /(?:khong qua|toi da|duoi)\s*$/.test(prefix)
        ? "max"
        : "exact";
    const claimStart = semanticPrefixStart(normalized, start, /(?:it nhat|toi thieu|tu|khong qua|toi da|duoi)\s*$/);
    registry?.claim("budget", claimStart, end);
    candidates.push({
      start,
      end,
      operator,
      min: operator === "min" ? amount : null,
      max: operator === "max" ? amount : null,
      target: operator === "exact" ? amount : null,
    });
  }

  if (!candidates.length) return null;
  const selected = candidates.sort((left, right) => left.start - right.start).at(-1);
  const perPerson = /(?:\/\s*|moi\s+)(?:nguoi|ng|khach)\b|\b(?:nguoi|ng|khach)\s*\/\s*(?:tour|chuyen)\b/.test(normalized);
  const total = /\b(?:tong|ca nhom|ca doan|ca gia dinh|cho ca hai|ca hai|cho ca \d{1,2})\b|\bcho\s+(?:gia dinh\s+)?(?:\d{1,2}|mot|hai|ba|bon|nam)\s*(?:nguoi|ng|khach|dua)\b/.test(normalized);
  return {
    status: "known",
    operator: selected.operator,
    scope: perPerson ? "per_person" : total ? "total" : "unspecified",
    min: selected.min,
    max: selected.max,
    target: selected.target,
  };
}

function budgetSlotToLegacy(slot) {
  if (!slot || slot.status !== "known") return {};
  const result = { budgetScope: slot.scope, totalBudget: null, minPrice: null, maxPrice: null };
  if (slot.scope === "total") {
    if (slot.operator === "min") result.minTotalBudget = slot.min;
    else if (slot.operator === "max") result.totalBudget = slot.max;
    else if (slot.operator === "range") {
      result.minTotalBudget = slot.min;
      result.maxTotalBudget = slot.max;
    } else result.totalBudget = slot.target;
    return result;
  }
  if (slot.operator === "exact") {
    result.minPrice = slot.target;
    result.maxPrice = slot.target;
    result.exactPrice = slot.target;
  } else if (slot.operator === "min") result.minPrice = slot.min;
  else if (slot.operator === "max") result.maxPrice = slot.max;
  else if (slot.operator === "range") {
    result.minPrice = slot.min;
    result.maxPrice = slot.max;
  } else if (slot.operator === "approximate") {
    result.approximatePrice = slot.target;
    result.minPrice = Math.max(1, Math.floor(slot.target * 0.8));
    result.maxPrice = Math.ceil(slot.target * 1.2);
  }
  return result;
}

function semanticDurationCandidate(message, registry = null) {
  const normalized = normalizeText(message);
  const optionalPhrase = "(?:khong nhat thiet|khong bat buoc|khong can dung|chi la goi y)";
  const durationAmount = "(?:\\d{1,2}|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\\s*(?:ngay|hom|n)";
  const optional = new RegExp(`${optionalPhrase}\\b.{0,24}\\b${durationAmount}\\b|\\b${durationAmount}\\b.{0,24}${optionalPhrase}\\b`).test(normalized);
  const candidates = [];
  const rangeRegex = new RegExp(`\\b(${NUMBER_TOKEN})\\s*(?:-|–|den|toi)\\s*(${NUMBER_TOKEN})\\s*(?:ngay|hom|n)\\b`, "g");
  for (const match of globalMatches(normalized, rangeRegex)) {
    const left = parseNumberToken(match[1]);
    const right = parseNumberToken(match[2]);
    if (left === null || right === null || registry?.overlaps(match.index, match.index + match[0].length)) continue;
    registry?.claim("duration", match.index, match.index + match[0].length);
    candidates.push({
      start: match.index,
      operator: "range",
      minDays: Math.min(left, right),
      maxDays: Math.max(left, right),
      targetDays: null,
    });
  }
  const singleRegex = new RegExp(`\\b(${NUMBER_TOKEN})\\s*(?:ngay|hom)(?![a-z]|\\s*nua)(?:\\s*${NUMBER_TOKEN}\\s*(?:dem|d))?\\b`, "g");
  const abbreviationRegex = /\b(\d{1,2})\s*n(?:\s*\d{1,2}\s*d)?\b/g;
  for (const match of [...globalMatches(normalized, singleRegex), ...globalMatches(normalized, abbreviationRegex)]) {
    const start = match.index;
    const end = start + match[0].length;
    if (registry?.overlaps(start, end)) continue;
    const amount = parseNumberToken(match[1]);
    if (amount === null) continue;
    const prefix = normalized.slice(Math.max(0, start - 32), start);
    let operator = "exact";
    if (optional) operator = "optional";
    else if (/(?:it nhat|toi thieu)\s*$/.test(prefix)) operator = "min";
    else if (/(?:khong qua|toi da|nhieu nhat)\s*$/.test(prefix)) operator = "max";
    else if (/(?:khoang|tam(?: tam)?|xap xi|gan)\s*$/.test(prefix)) operator = "approximate";
    const claimStart = semanticPrefixStart(
      normalized,
      start,
      /(?:khong nhat thiet|khong bat buoc|khong can dung|chi la goi y|it nhat|toi thieu|khong qua|toi da|nhieu nhat|khoang|tam(?: tam)?|xap xi|gan)\s*$/
    );
    registry?.claim("duration", claimStart, end);
    candidates.push({
      start,
      operator,
      minDays: operator === "min" ? amount : null,
      maxDays: operator === "max" ? amount : null,
      targetDays: ["exact", "approximate", "optional"].includes(operator) ? amount : null,
    });
  }
  if (!candidates.length) return null;
  const selected = candidates.sort((left, right) => left.start - right.start).at(-1);
  return {
    status: selected.operator === "optional" ? "relaxed" : "known",
    operator: selected.operator,
    minDays: selected.minDays,
    maxDays: selected.maxDays,
    targetDays: selected.targetDays,
    required: selected.operator !== "optional",
  };
}

function hasExplicitDurationRemoval(normalized) {
  return [
    /\b(?:thoi luong|duration|so ngay|may ngay)\b.{0,24}\b(?:khong quan trong|khong can(?: gioi han)?|khong gioi han|cung duoc)\b/,
    /\b(?:khong quan trong|khong can(?: gioi han)?|khong gioi han|bo(?: yeu cau| gioi han)?)\b.{0,24}\b(?:thoi luong|duration|so ngay|may ngay|\d{1,2}\s*ngay)\b/,
    /\b(?:bo|khong can|khong)\s+gioi han\s+ngay(?:\s+di)?\b/,
    /\bdi\s+bao lau\s+cung duoc\b/,
  ].some((pattern) => pattern.test(normalized));
}

function hasAmbiguousTimeRemoval(normalized) {
  return [
    /\b(?:thoi gian\b.{0,24}\bkhong quan trong|khong quan trong\b.{0,24}\bthoi gian)\b/,
    /\b(?:thoi\s+)?(?:bo|khong can)\s+gioi han\s+thoi gian\b/,
  ].some((pattern) => pattern.test(normalized));
}

function semanticTravelerCandidate(message, previousSlot, registry = null) {
  const normalized = normalizeText(message);
  const childRemoval = normalized.match(/(?:khong co|bo|khong di cung|khong (?:dan|dua|cho))\s+(?:be|tre(?: em)?)(?:\s+(?:di|theo))?(?:\s+nua)?\b|(?:be|tre(?: em)?)\s+(?:khong di|khong theo|khong co)\s+nua\b/);
  if (childRemoval) {
    registry?.claim("travelers.removedComponents", childRemoval.index, childRemoval.index + childRemoval[0].length);
    const adults = previousSlot?.adults;
    return {
      status: adults !== null && adults !== undefined ? "known" : "removed",
      adults: adults ?? null,
      children: 0,
      childAges: [],
      total: adults ?? null,
      removedComponents: ["children", "childAges"],
    };
  }

  const ageMatches = globalMatches(normalized, /\b(?:be|tre(?: em)?)\s*(\d{1,2})\s*tuoi\b/g);
  const childAges = [];
  for (const match of ageMatches) {
    if (registry?.overlaps(match.index, match.index + match[0].length)) continue;
    registry?.claim("travelers.childAges", match.index, match.index + match[0].length);
    childAges.push(Number(match[1]));
  }

  const adultMatches = globalMatches(normalized, new RegExp(`\\b(${NUMBER_TOKEN})\\b\\s*nguoi\\s*lon\\b`, "g"));
  const childCountMatches = globalMatches(normalized, new RegExp(`\\b(${NUMBER_TOKEN})\\b\\s*(?:tre(?: em)?|be)\\b(?!\\s*tuoi)`, "g"));
  const generalMatches = globalMatches(normalized, new RegExp(`\\b(${NUMBER_TOKEN})\\b\\s*(?:nguoi|ng|khach|dua)\\b(?!\\s*lon)`, "g"));
  const latestAdult = adultMatches.at(-1);
  const latestChildCount = childCountMatches.at(-1);
  const latestGeneral = generalMatches.at(-1);

  if (!latestAdult && !latestChildCount && !latestGeneral && !childAges.length) {
    if (/\b(?:mot minh|di mot minh)\b/.test(normalized)) {
      return { status: "known", adults: 1, children: 0, childAges: [], total: 1, removedComponents: [] };
    }
    if (/\bcap doi\b/.test(normalized)) {
      return { status: "known", adults: 2, children: 0, childAges: [], total: 2, removedComponents: [] };
    }
    return null;
  }
  if (!latestAdult && !latestChildCount && !latestGeneral && childAges.length) {
    const adults = previousSlot?.adults ?? null;
    const children = Math.max(previousSlot?.children || 0, childAges.length);
    return {
      status: adults === null ? "ambiguous" : "known",
      adults,
      children,
      childAges,
      total: adults === null ? children : adults + children,
      removedComponents: [],
    };
  }

  const correctionWinner = [latestAdult, latestChildCount, latestGeneral]
    .filter(Boolean)
    .sort((left, right) => left.index - right.index)
    .at(-1);
  const correctionOverridesComposition = correctionWinner && correctionAfter(normalized, correctionWinner.index);
  let adults = latestAdult ? parseNumberToken(latestAdult[1]) : null;
  let children = latestChildCount ? parseNumberToken(latestChildCount[1]) : childAges.length || 0;
  if (latestGeneral) {
    const general = parseNumberToken(latestGeneral[1]);
    if (correctionOverridesComposition || (!latestAdult && !latestChildCount && !childAges.length)) {
      adults = general;
      children = 0;
    } else if (adults === null) adults = general;
  }
  for (const match of [latestAdult, latestChildCount, latestGeneral].filter(Boolean)) {
    registry?.claim("travelers", match.index, match.index + match[0].length);
  }
  if (adults === null && children > 0) adults = 0;
  return {
    status: "known",
    adults,
    children,
    childAges,
    total: (adults || 0) + (children || 0),
    removedComponents: [],
  };
}

const OPEN_DESTINATION_STOP_WORDS = new Set([
  "cho", "voi", "cung", "duoi", "tren", "trong", "khoang", "tam", "gia", "ngan", "sach",
  "ngay", "dem", "nguoi", "khach", "be", "tre", "vao", "luc", "tu", "den", "thang", "tuan",
  "cuoi", "dau", "mai", "mot", "minh", "cap", "doi", "co", "khong", "nao", "choi",
  "vua", "noi", "nay", "do", "kia", "luc", "truoc", "sau", "nhung", "dung",
  "muon", "phai", "it", "qua", "nhieu", "theo", "tieu", "chi",
]);
const GENERIC_DESTINATION_VALUES = new Set([
  "bien", "nui", "nghi duong", "kham pha", "mao hiem", "van hoa", "am thuc", "choi",
  "nuoc ngoai", "trong nuoc", "mien bac", "mien trung", "mien nam", "noi nao", "cho nao", "dau", "khac",
]);
const NON_DESTINATION_ACTIVITY_PREFIXES = [
  "boi", "thuyen", "du thuyen", "cheo thuyen", "kayak", "cheo kayak", "trekking", "leo nui",
];
const OPEN_DESTINATION_RAW_STOP_WORDS = new Set(["thứ", "đầu", "cuối", "vừa"]);

function openVocabularyDestinations(message) {
  const results = [];
  const normalizedMessage = normalizeText(message);
  const marker = /(?:^|[\s,;])(?:tour(?:\s+(?:đi|đến))?|du lịch(?:\s+(?:ở|tại|đến))?|đi|đến)\s+([^,;.!?]+)/giu;
  for (const match of String(message || "").matchAll(marker)) {
    const words = match[1].trim().split(/\s+/).filter(Boolean);
    const kept = [];
    for (const word of words) {
      const cleaned = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const normalizedWord = normalizeText(cleaned);
      if (
        !normalizedWord ||
        /\d/.test(normalizedWord) ||
        OPEN_DESTINATION_STOP_WORDS.has(normalizedWord) ||
        OPEN_DESTINATION_RAW_STOP_WORDS.has(cleaned.toLowerCase().normalize("NFC"))
      ) break;
      kept.push(cleaned);
      if (kept.length === 4) break;
    }
    const value = kept.join(" ").trim();
    const key = normalizeText(value);
    const activityPhrase = NON_DESTINATION_ACTIVITY_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix} `));
    if (!value || GENERIC_DESTINATION_VALUES.has(key) || activityPhrase) continue;
    results.push({ value, start: normalizedMessage.indexOf(key) });
  }
  return results.filter((item) => item.start >= 0);
}

function semanticDestinationCandidate(message, previousSlot, registry = null) {
  const normalized = normalizeText(message);
  const open = normalized.match(/\b(?:(?:khong|chua) biet (?:nen )?di dau|(?:di dau|cho nao|dia diem nao)\b(?=[^.!?]{0,56}\bcung (?:duoc|ok|oke|thoai mai)\b)|(?:di\s+)?(?:cho|noi|dia diem)\s+khac(?:\s+cung)?\s+(?:duoc|ok|oke|thoai mai)\b)/);
  if (open) {
    registry?.claim("destination.status", open.index, open.index + open[0].length);
    return { status: "intentionally_open", origin: previousSlot?.origin || null, values: [], excludedValues: previousSlot?.excludedValues || [] };
  }
  const removed = normalized.match(/\b(?:bo|khong can)\s+(?:diem den|noi den)\b/);
  if (removed) {
    registry?.claim("destination.status", removed.index, removed.index + removed[0].length);
    return { status: "removed", origin: previousSlot?.origin || null, values: [], excludedValues: previousSlot?.excludedValues || [] };
  }

  const positives = [];
  const excludedValues = [...(previousSlot?.excludedValues || [])];
  for (const destination of DESTINATIONS) {
    const key = normalizeText(destination);
    let offset = 0;
    while (offset < normalized.length) {
      const index = normalized.indexOf(key, offset);
      if (index < 0) break;
      const before = normalized.slice(Math.max(0, index - 48), index);
      const negative = /\b(?:khong(?:\s+(?:thich|muon|di|khoai))?|tranh|ne|loai tru|tru|dung(?:\s+goi y)?)\b[^,;.!?]{0,36}$/.test(before);
      registry?.claim(negative ? "destination.excludedValues" : "destination.values", index, index + key.length);
      if (negative) excludedValues.push(destination);
      else positives.push({ value: destination, start: index });
      offset = index + key.length;
    }
  }
  for (const candidate of openVocabularyDestinations(message)) {
    if (positives.some((item) => normalizeText(item.value) === normalizeText(candidate.value))) continue;
    if (registry?.overlaps(candidate.start, candidate.start + normalizeText(candidate.value).length)) continue;
    const before = normalized.slice(Math.max(0, candidate.start - 48), candidate.start);
    const negative = /\b(?:khong(?:\s+(?:thich|muon|di|khoai))?|tranh|ne|loai tru|tru|dung(?:\s+goi y)?)\b[^,;.!?]{0,36}$/.test(before);
    registry?.claim(negative ? "destination.excludedValues" : "destination.values", candidate.start, candidate.start + normalizeText(candidate.value).length);
    if (negative) excludedValues.push(candidate.value);
    else positives.push(candidate);
  }
  positives.sort((left, right) => left.start - right.start);
  let values = positives.map((item) => item.value);
  if (positives.length > 1 && correctionAfter(normalized, positives.at(-1).start)) values = [positives.at(-1).value];
  values = uniqueStrings(values);
  const cleanedExclusions = uniqueStrings(excludedValues).filter((value) => !values.some((positive) => normalizeText(positive) === normalizeText(value)));
  if (values.length) return { status: "known", origin: previousSlot?.origin || null, values, excludedValues: cleanedExclusions };
  const retainedValues = (previousSlot?.values || []).filter((value) =>
    !cleanedExclusions.some((excluded) => normalizeText(excluded) === normalizeText(value))
  );
  if (retainedValues.length) {
    return { status: "known", origin: previousSlot?.origin || null, values: retainedValues, excludedValues: cleanedExclusions };
  }
  if (cleanedExclusions.length !== (previousSlot?.excludedValues || []).length) {
    return { status: "removed", origin: previousSlot?.origin || null, values: [], excludedValues: cleanedExclusions };
  }
  return null;
}

const CONSTRAINT_META_KEY = "_constraintMeta";
const AREA_INTERESTS = new Set(["bien", "nui"]);
const BUDGET_FIELDS = [
  "budgetScope", "totalBudget", "minTotalBudget", "maxTotalBudget", "targetBudget",
  "minPrice", "maxPrice", "exactPrice", "approximatePrice",
];
const NUMBER_WORDS = new Map([
  ["mot", 1], ["hai", 2], ["ba", 3], ["bon", 4], ["tu", 4], ["nam", 5],
  ["sau", 6], ["bay", 7], ["tam", 8], ["chin", 9], ["muoi", 10],
]);
const NUMBER_TOKEN = "(?:\\d{1,2}|mot|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi)";

function constraintMeta(state = {}) {
  const meta = state?.[CONSTRAINT_META_KEY];
  return meta && typeof meta === "object" ? meta : {};
}

function constraintMode(state = {}, field, fallback = "hard") {
  return constraintMeta(state).modes?.[field] || fallback;
}

function markConstraint(meta, field, mode = "hard") {
  meta.currentFields.push(field);
  meta.modes[field] = mode;
}

function removeConstraint(meta, ...fields) {
  meta.removedFields.push(...fields);
  meta.currentFields.push(...fields);
}

function publicConstraintState(state = {}) {
  return Object.fromEntries(Object.entries(state).filter(([key]) => key !== CONSTRAINT_META_KEY));
}

function getEffectiveConstraintState(state = {}) {
  const meta = constraintMeta(state);
  const base = publicConstraintState(state);
  if (meta.queryScope === "isolated_price") {
    const current = {};
    for (const field of meta.currentFields || []) {
      if (field === "budget") continue;
      if (field in base) current[field] = base[field];
    }
    return {
      exclusions: base.exclusions || [],
      ...current,
      ...(meta.transientConstraints || {}),
      [CONSTRAINT_META_KEY]: {
        ...meta,
        modes: { ...(meta.modes || {}), budget: "hard" },
      },
    };
  }
  return {
    ...base,
    ...(meta.transientConstraints || {}),
    [CONSTRAINT_META_KEY]: meta,
  };
}

function localDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso, amount) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function compareIso(left, right) {
  return String(left).localeCompare(String(right));
}

function parseDateConstraint(message, previousDateRange = null, now = new Date()) {
  const normalized = normalizeText(message);
  const todayParts = localDateParts(now);
  const today = isoDate(Number(todayParts.year), Number(todayParts.month), Number(todayParts.day));

  // Do not turn conversational uses of "hôm nay" into a trip constraint.
  if (/(?:ban|tro ly).{0,12}khoe khong|khoe khong.{0,12}(?:ban|tro ly)/.test(normalized)) return null;

  if (normalized.includes("hom nay")) return { start: today, end: today, label: "hôm nay" };
  const daysFromNow = normalized.match(/\b(\d{1,3})\s*ngay\s*nua\b/);
  if (daysFromNow) {
    const amount = Number(daysFromNow[1]);
    const date = addDays(today, amount);
    return { start: date, end: date, label: `${amount} ngày nữa` };
  }
  if (/\bngay kia\b/.test(normalized)) {
    const date = addDays(today, 2);
    return { start: date, end: date, label: "ngày kia" };
  }
  if (/\b(?:ngay )?mai\b/.test(normalized)) {
    const date = addDays(today, 1);
    return { start: date, end: date, label: "ngày mai" };
  }
  if (normalized.includes("hom qua")) {
    const date = addDays(today, -1);
    return { start: date, end: date, label: "hôm qua" };
  }

  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const untilMonday = (8 - (weekday || 7)) % 7 || 7;
  if (/\bcuoi tuan sau\b/.test(normalized)) {
    const start = addDays(today, untilMonday + 5);
    return { start, end: addDays(start, 1), label: "cuối tuần sau" };
  }
  if (/\b(?:thu 7 nay|thu bay nay)\b/.test(normalized)) {
    const untilSaturday = (6 - weekday + 7) % 7;
    const start = addDays(today, untilSaturday);
    return { start, end: start, label: "thứ 7 này" };
  }
  if (/\bcuoi tuan(?: nay)?\b/.test(normalized)) {
    if (weekday === 0) return { start: today, end: today, label: "cuối tuần này" };
    const untilSaturday = (6 - weekday + 7) % 7;
    const start = addDays(today, untilSaturday);
    return { start, end: addDays(start, 1), label: "cuối tuần này" };
  }
  if (/\btuan sau\b/.test(normalized)) {
    const start = addDays(today, untilMonday);
    return { start, end: addDays(start, 6), label: "tuần sau" };
  }
  if (/\bdau thang sau\b/.test(normalized)) {
    const next = new Date(Date.UTC(Number(todayParts.year), Number(todayParts.month), 1));
    const start = isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
    return { start, end: addDays(start, 6), label: "đầu tháng sau" };
  }
  if (/\bcuoi thang sau\b/.test(normalized)) {
    const next = new Date(Date.UTC(Number(todayParts.year), Number(todayParts.month), 1));
    const following = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1));
    const endDate = new Date(following.getTime() - 86400000);
    const end = isoDate(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate());
    return { start: addDays(end, -6), end, label: "cuối tháng sau" };
  }
  if (/\bcuoi thang(?: nay)?\b/.test(normalized)) {
    const nextMonth = new Date(Date.UTC(Number(todayParts.year), Number(todayParts.month), 1));
    const endDate = new Date(nextMonth.getTime() - 86400000);
    const end = isoDate(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate());
    return { start: addDays(end, -6), end, label: "cuối tháng này" };
  }
  if (/\bthang sau\b/.test(normalized)) {
    const next = new Date(Date.UTC(Number(todayParts.year), Number(todayParts.month), 1));
    const following = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1));
    const endDate = new Date(following.getTime() - 86400000);
    return {
      start: isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, 1),
      end: isoDate(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate()),
      label: "tháng sau",
    };
  }

  const fullDate = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (fullDate) {
    const day = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    let year = fullDate[3] ? Number(fullDate[3]) : Number(todayParts.year);
    if (year < 100) year += 2000;
    let value = isoDate(year, month, day);
    if (!fullDate[3] && value && compareIso(value, today) < 0) value = isoDate(year + 1, month, day);
    if (value) return { start: value, end: value, label: `${day}/${month}/${year}` };
  }

  const dayOnly = normalized.match(/^\s*(\d{1,2})\s*(?:thi sao|con khong)\s*\??\s*$/);
  if (dayOnly && previousDateRange?.start) {
    const previousMatch = previousDateRange.start.match(/^(\d{4})-(\d{2})-/);
    const year = Number(previousMatch?.[1]);
    const month = Number(previousMatch?.[2]);
    const value = isoDate(year, month, Number(dayOnly[1]));
    if (value) return { start: value, end: value, label: `${Number(dayOnly[1])}/${month}/${year}` };
  }

  return null;
}

function parseMoney(message) {
  const normalized = normalizeText(message);
  const million = normalized.match(/\b(\d+(?:[.,]\d+)?)\s*(?:trieu|tr)\b/);
  if (million) return Math.round(Number(million[1].replace(",", ".")) * 1_000_000);
  const explicit = normalized.match(/\b(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:d|dong)?\b/);
  if (explicit) return Number(explicit[1].replace(/[.,]/g, ""));
  const plainDong = normalized.match(/\b(\d{1,9})\s*(?:d|dong|vnd)\b/);
  return plainDong ? Number(plainDong[1]) : null;
}

function parseBudgetConstraint(message) {
  return budgetSlotToLegacy(semanticBudgetCandidate(message));
}

function extractConstraintDelta(message, previousState = {}, now = new Date()) {
  const normalized = normalizeText(message);
  const delta = {};
  const previousSemantic = migrateLegacyConstraintState(previousState);
  const semanticSlots = {};
  const spanRegistry = createSpanRegistry(normalized);
  const meta = { modes: {}, currentFields: [], removedFields: [], transientConstraints: null, queryScope: null };
  if (/\b(?:cai nay|dieu nay)\s+khong quan trong\b/.test(normalized)) {
    const previousField = [...(constraintMeta(previousState).currentFields || [])].reverse()[0];
    if (previousField) removeConstraint(meta, previousField);
  }
  const travelerSlot = semanticTravelerCandidate(message, previousSemantic.slots.travelers, spanRegistry);
  if (travelerSlot) {
    semanticSlots.travelers = travelerSlot;
    if (travelerSlot.total !== null && travelerSlot.adults !== null) delta.travelers = travelerSlot.total;
    if (travelerSlot.adults !== null) delta.adults = travelerSlot.adults;
    if (travelerSlot.children !== null) delta.children = travelerSlot.children;
    delta.childAges = travelerSlot.childAges;
    if (/\bnguoi\s*lon\b/.test(normalized) && travelerSlot.adults !== null) {
      // Keep the legacy delta contract; merged V2 state still projects total party size.
      delta.travelers = travelerSlot.adults;
    }
    markConstraint(meta, "travelers");
  }

  const removeBudget = /(?:\b(?:bo|khong can|khong gioi han|khong quan trong)\b.{0,24}\b(?:ngan sach|gia|trieu|chi phi)\b)|(?:\b(?:ngan sach|gia)\b.{0,24}\b(?:khong gioi han|khong quan trong|cao hon cung duoc)\b)|(?:\bdat hon\b.{0,24}\b(?:cung duoc|dep hon)\b)/.test(normalized);
  const isolatedPriceQuery = /\b(?:co|tim)\s+tour(?:\s+nao)?\b.{0,20}\b\d{1,9}\s*(?:d|dong|vnd)\b/.test(normalized) ||
    /\btim\s+tour\s+\d{1,9}(?:d|dong|vnd)\b/.test(normalized);
  const budgetSlot = semanticBudgetCandidate(message, spanRegistry);
  if (removeBudget) {
    removeConstraint(meta, "budget");
    const relaxed = /(?:khong gioi han|khong quan trong|cao hon cung duoc|dat hon.*cung duoc)/.test(normalized);
    semanticSlots.budget = relaxed
      ? { ...previousSemantic.slots.budget, status: "relaxed" }
      : { status: "removed", operator: null, scope: "unspecified", min: null, max: null, target: null };
  } else if (budgetSlot) {
    const inheritedBudgetSlot = { ...budgetSlot };
    if (inheritedBudgetSlot.scope === "unspecified" && ["total", "per_person"].includes(previousSemantic.slots.budget.scope)) {
      inheritedBudgetSlot.scope = previousSemantic.slots.budget.scope;
    }
    const budget = budgetSlotToLegacy(inheritedBudgetSlot);
    if (Object.keys(budget).length) {
      if (isolatedPriceQuery) {
        meta.transientConstraints = budget;
        meta.queryScope = "isolated_price";
        markConstraint(meta, "budget");
      } else {
        Object.assign(delta, budget);
        semanticSlots.budget = inheritedBudgetSlot;
        markConstraint(meta, "budget");
      }
    }
  }

  const durationSlot = semanticDurationCandidate(message, spanRegistry);
  const previousDateActive = previousSemantic.slots.date.status === "known";
  const previousDurationActive = ["known", "relaxed"].includes(previousSemantic.slots.duration.status);
  const ambiguousTimeRemoval = hasAmbiguousTimeRemoval(normalized);
  const numericDayRemoval = normalized.match(/\bkhong can(?:\s+dung)?\s+\d{1,3}\s+ngay\s+nua\b/);
  const numericRemovalTargetsDuration = Boolean(numericDayRemoval && previousDurationActive && !previousDateActive);
  const explicitDateRemoval = /\b(?:khong can dung(?:\s+ngay|\s+\d{1,3}\s+ngay nua)|(?:bo|khong can)\s+(?:(?:dieu kien|yeu cau)\s+)?ngay(?:\s+di)?|doi ngay khac|ngay khac cung duoc|khong quan trong ngay)\b/.test(normalized) &&
    /(?:ngay|thoi gian)/.test(normalized) &&
    !numericRemovalTargetsDuration;
  const removeDate = explicitDateRemoval || (ambiguousTimeRemoval && previousDateActive);
  const removeDuration = (!explicitDateRemoval && hasExplicitDurationRemoval(normalized)) ||
    (ambiguousTimeRemoval && (previousDurationActive || !previousDateActive));
  if (removeDuration && numericDayRemoval) {
    spanRegistry.claim("duration.removed", numericDayRemoval.index, numericDayRemoval.index + numericDayRemoval[0].length);
  }
  if (removeDate) {
    removeConstraint(meta, "dateRange");
    semanticSlots.date = { ...previousSemantic.slots.date, status: "removed", start: null, end: null, label: null };
  }
  if (durationSlot?.status === "relaxed") {
    semanticSlots.duration = durationSlot;
    removeConstraint(meta, "days");
    markConstraint(meta, "days", "soft");
  } else if (removeDuration) {
    removeConstraint(meta, "days");
    semanticSlots.duration = {
      status: "removed",
      operator: null,
      minDays: null,
      maxDays: null,
      targetDays: null,
      required: false,
    };
  } else if (durationSlot) {
    semanticSlots.duration = durationSlot;
    if (durationSlot.operator === "exact") delta.days = durationSlot.targetDays;
    else if (durationSlot.operator === "max") {
      delta.days = durationSlot.maxDays;
      delta.maxDays = durationSlot.maxDays;
    } else if (durationSlot.operator === "min") delta.minDays = durationSlot.minDays;
    else if (durationSlot.operator === "range") {
      delta.minDays = durationSlot.minDays;
      delta.maxDays = durationSlot.maxDays;
    } else if (durationSlot.operator === "approximate") {
      delta.days = durationSlot.targetDays;
      delta.approximateDays = durationSlot.targetDays;
    }
    markConstraint(meta, "days");
  }

  const explicitRegion = ["Miền Bắc", "Miền Trung", "Miền Nam"].find((region) =>
    normalized.includes(normalizeText(region))
  );
  let regionReplacesDestination = false;
  if (explicitRegion) {
    delta.region = explicitRegion;
    markConstraint(meta, "region");
    const oldDestinationRegion = inferDestinationRegion(previousSemantic.slots.destination.values[0]);
    if (oldDestinationRegion && oldDestinationRegion !== explicitRegion) {
      removeConstraint(meta, "destination");
      regionReplacesDestination = true;
    }
  }

  const destinationSlot = semanticDestinationCandidate(message, previousSemantic.slots.destination, spanRegistry);
  const destinationMentionedThisTurn = spanRegistry.list().some((span) => span.owner.startsWith("destination."));
  if (regionReplacesDestination && !destinationMentionedThisTurn) {
    semanticSlots.destination = {
      ...previousSemantic.slots.destination,
      status: "removed",
      values: [],
    };
    delete delta.destination;
  } else if (destinationSlot) {
    semanticSlots.destination = destinationSlot;
    if (destinationSlot.status === "intentionally_open") {
      removeConstraint(meta, "destination", "region");
      markConstraint(meta, "destination", "soft");
    } else if (destinationSlot.status === "known" && destinationSlot.values.length) {
      if (destinationSlot.values.length === 1) delta.destination = destinationSlot.values[0];
      else delta.destinations = destinationSlot.values;
      const inferredRegions = uniqueStrings(destinationSlot.values.map(inferDestinationRegion));
      if (!explicitRegion && inferredRegions.length === 1) {
        delta.region = inferredRegions[0];
        markConstraint(meta, "region");
      } else if (inferredRegions.length > 1) removeConstraint(meta, "region");
      markConstraint(meta, "destination");
    } else if (destinationSlot.status === "removed") {
      removeConstraint(meta, "destination");
    }
    if (destinationSlot.excludedValues.length) markConstraint(meta, "exclusions");
  }

  const previousInterestSlot = previousSemantic.slots.interests;
  const currentInterests = [];
  const excludedInterests = [];
  const relaxedExcludedInterests = [];
  if (destinationSlot?.status === "known" && destinationSlot.values.some((value) => normalizeText(value) === "mien tay")) {
    currentInterests.push("Miền Tây");
  }
  for (const interest of INTEREST_KEYWORDS) {
    const occurrences = interest.words
      .map((word) => ({ word, index: normalized.indexOf(word) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index);
    const matched = occurrences[0];
    if (!matched) continue;
    if (spanRegistry.overlaps(matched.index, matched.index + matched.word.length)) continue;
    const before = normalized.slice(Math.max(0, matched.index - 32), matched.index);
    const after = normalized.slice(matched.index + matched.word.length, matched.index + matched.word.length + 24);
    const deniesInterestNegation = /\bkhong phai\s+khong(?:\s+(?:thich|muon|khoai)(?:\s+di)?|\s+di)?\s*$/.test(before);
    if (deniesInterestNegation) {
      if (spanRegistry.claim("interests.relaxedExcludedValues", matched.index, matched.index + matched.word.length)) {
        relaxedExcludedInterests.push(interest.value);
      }
      continue;
    }
    const previouslyExcluded = (previousInterestSlot.excludedValues || [])
      .some((value) => normalizeText(value) === normalizeText(interest.value));
    const explicitlyRemovesExclusion = previouslyExcluded
      && /(?:bo|khong can)(?:\s+(?:dieu kien|yeu cau))?\s+khong(?:\s+(?:muon|thich))?\s*$/.test(before);
    const acceptsPreviouslyExcludedInterest = previouslyExcluded
      && !/(?:khong(?:\s+(?:thich|muon|khoai)(?:\s+di)?|\s+di)?|dung(?:\s+goi\s+y)?(?:\s+(?:tour|chuyen\s+di)(?:\s+phai)?)?|tranh|ne|tru|loai\s+tru|ngai(?:\s+phai)?)\s*$/.test(before)
      && /\b(?:cung duoc|khong sao)\b/.test(after);
    const relaxesExclusion = explicitlyRemovesExclusion || acceptsPreviouslyExcludedInterest;
    if (relaxesExclusion) {
      if (spanRegistry.claim("interests.relaxedExcludedValues", matched.index, matched.index + matched.word.length)) {
        relaxedExcludedInterests.push(interest.value);
      }
      continue;
    }
    const negative = /(?:khong(?:\s+(?:thich|muon|khoai)(?:\s+di)?|\s+di)?|dung(?:\s+goi\s+y)?(?:\s+(?:tour|chuyen\s+di)(?:\s+phai)?)?|tranh|ne|tru|loai\s+tru|ngai(?:\s+phai)?)\s*$/.test(before);
    if (!spanRegistry.claim(negative ? "interests.excludedValues" : "interests.values", matched.index, matched.index + matched.word.length)) continue;
    if (negative) {
      excludedInterests.push(interest.value);
      markConstraint(meta, "exclusions");
    } else {
      currentInterests.push(interest.value);
    }
  }
  if (currentInterests.length) {
    const currentArea = currentInterests.filter((value) => AREA_INTERESTS.has(normalizeText(value)));
    const retained = (previousInterestSlot.values || []).filter((value) => {
      if (excludedInterests.some((excluded) => normalizeText(excluded) === normalizeText(value))) return false;
      return !currentArea.length || !AREA_INTERESTS.has(normalizeText(value));
    });
    const values = uniqueStrings([...retained, ...currentInterests]);
    const excludedValues = uniqueStrings([...(previousInterestSlot.excludedValues || []), ...excludedInterests])
      .filter((excluded) => !relaxedExcludedInterests.some((value) => normalizeText(value) === normalizeText(excluded)))
      .filter((excluded) => !values.some((value) => normalizeText(value) === normalizeText(excluded)));
    semanticSlots.interests = { status: "known", values, excludedValues };
    delta.interests = values;
    const hardInterest = /\b(?:chi|bat buoc|nhat dinh)\b.{0,16}\b(?:tour|di|choi)?\s*(?:bien|nui|nghi duong|kham pha)\b/.test(normalized);
    markConstraint(meta, "interests", hardInterest ? "hard" : "soft");
    if (currentArea.length && /\b(?:thoi|doi sang|doi y)\b/.test(normalized)) {
      removeConstraint(meta, "destination", "region");
    }
  } else if (excludedInterests.length) {
    const values = (previousInterestSlot.values || [])
      .filter((value) => !excludedInterests.some((excluded) => normalizeText(excluded) === normalizeText(value)));
    const excludedValues = uniqueStrings([...(previousInterestSlot.excludedValues || []), ...excludedInterests])
      .filter((excluded) => !relaxedExcludedInterests.some((value) => normalizeText(value) === normalizeText(excluded)));
    semanticSlots.interests = { status: values.length ? "known" : "removed", values, excludedValues };
    delta.interests = values;
    markConstraint(meta, "interests", constraintMode(previousState, "interests", "soft"));
  } else if (relaxedExcludedInterests.length) {
    const values = previousInterestSlot.values || [];
    const excludedValues = (previousInterestSlot.excludedValues || [])
      .filter((excluded) => !relaxedExcludedInterests.some((value) => normalizeText(value) === normalizeText(excluded)));
    semanticSlots.interests = {
      status: values.length || excludedValues.length ? "known" : "removed",
      values,
      excludedValues,
    };
    delta.interests = values;
    markConstraint(meta, "interests", constraintMode(previousState, "interests", "soft"));
  }
  if (/\bkhong can\s+(?:khach san|luu tru)\b/.test(normalized)) {
    delta.accommodationRequired = false;
    markConstraint(meta, "accommodationRequired", "soft");
  } else if (/\b(?:can|uu tien|muon)\s+(?:khach san|luu tru)\b/.test(normalized)) {
    delta.accommodationRequired = true;
    markConstraint(meta, "accommodationRequired", "soft");
  }
  if (/(?:lich trinh nhe|di nhe nhang|khong chay lich trinh|khong di qua nhieu|co thoi gian tu do)/.test(normalized)) {
    delta.pace = "relaxed";
    markConstraint(meta, "pace", "soft");
  } else if (/(?:kham pha nhieu|lich trinh day|di nhieu|nang dong)/.test(normalized)) {
    delta.pace = "active";
    markConstraint(meta, "pace", "soft");
  } else if (/(?:can bang|lich trinh vua phai)/.test(normalized)) {
    delta.pace = "balanced";
    markConstraint(meta, "pace", "soft");
  }
  const touchedInterestValues = new Set(
    [...currentInterests, ...excludedInterests, ...relaxedExcludedInterests].map(normalizeText)
  );
  const destinationState = semanticSlots.destination || destinationSlot || previousSemantic.slots.destination;
  if (touchedInterestValues.size && destinationState?.excludedValues?.some((value) => touchedInterestValues.has(normalizeText(value)))) {
    semanticSlots.destination = {
      ...destinationState,
      excludedValues: destinationState.excludedValues.filter((value) => !touchedInterestValues.has(normalizeText(value))),
    };
  }
  const destinationExclusions = semanticSlots.destination?.excludedValues
    || destinationSlot?.excludedValues
    || previousSemantic.slots.destination.excludedValues
    || [];
  const interestExclusions = semanticSlots.interests?.excludedValues || previousInterestSlot.excludedValues || [];
  const exclusions = uniqueStrings([...destinationExclusions, ...interestExclusions]);
  if (exclusions.length || previousState.exclusions?.length) delta.exclusions = exclusions;

  const excludedDatePatterns = [...(previousSemantic.slots.date.excludedPatterns || [])];
  const weekendExclusion = normalized.match(/\b(?:khong|dung)\s+di\s+(?:vao\s+)?cuoi\s+tuan\b/);
  if (weekendExclusion) {
    excludedDatePatterns.push("weekend");
    spanRegistry.claim("date.excludedPatterns", weekendExclusion.index, weekendExclusion.index + weekendExclusion[0].length);
    markConstraint(meta, "dateRange");
  }
  const previousDateRange = previousSemantic.slots.date.start
    ? {
      start: previousSemantic.slots.date.start,
      end: previousSemantic.slots.date.end,
      label: previousSemantic.slots.date.label,
    }
    : null;
  const dateRange = parseDateConstraint(spanRegistry.mask(), previousDateRange, now);
  if (dateRange && !removeDate) {
    delta.dateRange = dateRange;
    semanticSlots.date = {
      status: "known",
      start: dateRange.start,
      end: dateRange.end,
      label: dateRange.label,
      excludedPatterns: uniqueStrings(excludedDatePatterns),
    };
    markConstraint(meta, "dateRange");
  } else if (!removeDate && excludedDatePatterns.length !== previousSemantic.slots.date.excludedPatterns.length) {
    semanticSlots.date = {
      ...previousSemantic.slots.date,
      status: "known",
      excludedPatterns: uniqueStrings(excludedDatePatterns),
    };
  }
  meta.currentFields = uniqueStrings(meta.currentFields);
  meta.removedFields = uniqueStrings(meta.removedFields);
  if (meta.currentFields.length || meta.removedFields.length || meta.transientConstraints) delta[CONSTRAINT_META_KEY] = meta;
  if (Object.keys(semanticSlots).length) {
    delta[SEMANTIC_STATE_KEY] = {
      version: SEMANTIC_STATE_VERSION,
      slots: semanticSlots,
      lastSpans: spanRegistry.list(),
      migration: { source: "native_v2_delta", status: "native", unsupportedFields: [] },
    };
  }
  return delta;
}

function constraintsFromPageContext(pageContext = {}, previousState = {}, now = new Date()) {
  const search = pageContext?.searchContext;
  if (!search || typeof search !== "object") return {};
  const delta = extractConstraintDelta(String(search.q || ""), previousState, now);
  if (search.region) delta.region = String(search.region);
  const minPrice = Number(search.minPrice);
  const maxPrice = Number(search.maxPrice);
  const days = Number(search.days);
  const semanticDelta = delta[SEMANTIC_STATE_KEY] || {
    version: SEMANTIC_STATE_VERSION,
    slots: {},
    lastSpans: [],
    migration: { source: "page_context_v2", status: "native", unsupportedFields: [] },
  };
  if (Number.isFinite(minPrice) && minPrice > 0) delta.minPrice = minPrice;
  if (Number.isFinite(maxPrice) && maxPrice > 0) delta.maxPrice = maxPrice;
  if ((Number.isFinite(minPrice) && minPrice > 0) || (Number.isFinite(maxPrice) && maxPrice > 0)) {
    semanticDelta.slots.budget = {
      status: "known",
      operator: minPrice > 0 && maxPrice > 0 ? "range" : minPrice > 0 ? "min" : "max",
      scope: "per_person",
      min: minPrice > 0 ? minPrice : null,
      max: maxPrice > 0 ? maxPrice : null,
      target: null,
    };
  }
  if (Number.isFinite(days) && days > 0) {
    delta.days = days;
    semanticDelta.slots.duration = {
      status: "known",
      operator: "exact",
      minDays: null,
      maxDays: null,
      targetDays: days,
      required: true,
    };
  }
  if (Object.keys(semanticDelta.slots).length) delta[SEMANTIC_STATE_KEY] = semanticDelta;
  return delta;
}

function mergeConstraintState(previous = {}, delta = {}) {
  const previousMeta = constraintMeta(previous);
  const deltaMeta = constraintMeta(delta);
  const previousSemantic = migrateLegacyConstraintState(previous);
  const semanticDelta = delta[SEMANTIC_STATE_KEY]
    ? structuredClone(delta[SEMANTIC_STATE_KEY])
    : { version: SEMANTIC_STATE_VERSION, slots: {}, lastSpans: [] };
  const legacyDelta = delta[SEMANTIC_STATE_KEY] ? null : migrateLegacyConstraintState(delta);
  const hasAny = (fields) => fields.some((field) => Object.prototype.hasOwnProperty.call(delta, field));
  if (legacyDelta) {
    if (hasAny(["destination", "destinations", "origin", "exclusions"])) semanticDelta.slots.destination = legacyDelta.slots.destination;
    if (hasAny(BUDGET_FIELDS)) semanticDelta.slots.budget = legacyDelta.slots.budget;
    if (hasAny(["days", "minDays", "maxDays", "approximateDays", "optionalDurationDays", "durationRequired"])) semanticDelta.slots.duration = legacyDelta.slots.duration;
    if (hasAny(["travelers", "adults", "children", "childAges"])) semanticDelta.slots.travelers = legacyDelta.slots.travelers;
    if (hasAny(["dateRange", "excludedDatePatterns"])) semanticDelta.slots.date = legacyDelta.slots.date;
    if (hasAny(["interests", "exclusions"])) semanticDelta.slots.interests = legacyDelta.slots.interests;
  }

  const removalSlots = {
    budget: ["budget", { status: "removed", operator: null, scope: "unspecified", min: null, max: null, target: null }],
    days: ["duration", { status: "removed", operator: null, minDays: null, maxDays: null, targetDays: null, required: false }],
    dateRange: ["date", { status: "removed", start: null, end: null, label: null, excludedPatterns: [] }],
    travelers: ["travelers", { status: "removed", adults: null, children: null, childAges: [], total: null, removedComponents: ["party"] }],
    destination: ["destination", { status: "removed", origin: previousSemantic.slots.destination.origin, values: [], excludedValues: previousSemantic.slots.destination.excludedValues }],
    interests: ["interests", { status: "removed", values: [], excludedValues: previousSemantic.slots.interests.excludedValues }],
  };
  for (const field of deltaMeta.removedFields || []) {
    const removal = removalSlots[field];
    if (removal && !semanticDelta.slots[removal[0]]) semanticDelta.slots[removal[0]] = removal[1];
  }
  const mergedSemantic = mergeSemanticState(previous, semanticDelta);

  const base = { ...publicConstraintState(previous), ...publicConstraintState(delta) };
  for (const field of deltaMeta.removedFields || []) {
    if (["region", "pace", "accommodationRequired"].includes(field)) delete base[field];
  }
  const modes = { ...(previousMeta.modes || {}) };
  for (const field of deltaMeta.removedFields || []) delete modes[field];
  Object.assign(modes, deltaMeta.modes || {});
  base[CONSTRAINT_META_KEY] = {
    modes,
    currentFields: uniqueStrings(deltaMeta.currentFields || []),
    removedFields: uniqueStrings(deltaMeta.removedFields || []),
    transientConstraints: deltaMeta.transientConstraints || null,
    queryScope: deltaMeta.queryScope || null,
  };
  const next = projectSemanticState(base, mergedSemantic);
  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function detectRequestType(message, entityState = {}, delta = {}) {
  const normalized = normalizeText(message).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:ban|tro ly|tro ly vietvoyage) (?:(?:co the )?(?:giup|ho tro|lam) (?:duoc )?gi|giup duoc gi)(?: cho toi)?$/.test(normalized)) return "general";
  if (/so sanh|\bso voi\b|cai nao|tour nao .* hon|khac nhau|(?:tour|cai)\s*(?:thu\s*)?(?:\d{1,2}|dau tien|mot|hai|ba)\s*(?:thi sao|the nao)/.test(normalized)) return "comparison";
  if (
    /con cho|con ve|available|khoi hanh.*(?:ngay|\d)|ngay .* con|thanh toan/.test(normalized) ||
    /\b\d{1,2}[/-]\d{1,2}\b/.test(normalized) ||
    ((entityState.pendingAction === "availability" || entityState.lastRequestType === "availability") && /^\d{1,2}\s*(?:thi sao|con khong)?$/.test(normalized))
  ) return "availability";
  if (/tim|goi y|de xuat|tu van.*tour|tour .*duoi|tour .*\b\d{1,2}\s*ngay\b|(?:co|tim) tour nao.*(?:d\b|dong|vnd|trieu)|dat hon.*dep hon|\bchi\s+(?:tim\s+)?tour|neu co.*(?:di|tour)/.test(normalized)) return "recommendation";
  if (
    Object.keys(delta).length &&
    /(?:lan nay|chuyen nay|chuyen di nay|dip nay|nhung|con toi|toi muon|muon|uu tien|neu co|thoi|doi sang|doi y|khong can|bo gioi han|khong gioi han|khong quan trong)/.test(normalized)
  ) return "recommendation";
  if (
    Object.keys(delta).length &&
    (entityState.pendingAction === "recommendation" || entityState.lastRequestType === "recommendation")
  ) return "recommendation";
  if (isCancellationPolicyQuestion(normalized)) return "tour_detail";
  if (
    /khach san|luu tru|ve may bay|may bay|flight|phuong tien|di chuyen|xe khach|tau hoa|bao gom|khong bao gom|lich trinh|chinh sach|gia (?:tour|bao nhieu|tong)|tong (?:gia|tien|bao nhieu)|tour .* gia|bao nhieu ngay|may ngay|thoi luong|khoi hanh|lich di|khuyen mai|bua an|cac bua|an gi|tour nay|tour do|tour thu|cai dau|cai thu|the nao/.test(normalized) ||
    entityState.pendingAction === "tour_detail"
  ) return "tour_detail";
  return "general";
}

function shouldClarifyRecommendation(state) {
  if (constraintMeta(state).queryScope === "isolated_price") return false;
  if (state.budgetScope === "unspecified" && !state.days && !state.dateRange && !state.travelers) return true;
  const destinationOpen = state?.[SEMANTIC_STATE_KEY]?.slots?.destination?.status === "intentionally_open";
  if (destinationOpen && !state.region && !state.interests?.length) return true;
  const hasArea = Boolean(state.destination || state.region || state.interests?.length || destinationOpen);
  if (!hasArea) return !state.days;
  return !state.days && !state.maxPrice && !state.dateRange && !state.travelers;
}

function hasPreferenceSignal(preferences = {}) {
  return Boolean(
    preferences.travelStyles?.length ||
    preferences.preferredRegions?.length ||
    preferences.preferredDestinations?.length ||
    preferences.interests?.length ||
    preferences.accommodationPreferences?.length ||
    preferences.budgetPreference ||
    preferences.durationPreference ||
    preferences.pace
  );
}

function shouldClarifyRecommendationWithPreferences(state, preferences = {}) {
  if (!hasPreferenceSignal(preferences)) return shouldClarifyRecommendation(state);
  return false;
}

function buildClarificationReply(state) {
  const questions = [];
  if (state.budgetScope === "unspecified") questions.push("ngân sách bạn nêu là tổng cho cả đoàn hay tính trên mỗi người");
  const destinationOpen = state?.[SEMANTIC_STATE_KEY]?.slots?.destination?.status === "intentionally_open";
  const hasArea = Boolean(state.destination || state.region || state.interests?.length || destinationOpen);
  if (!hasArea || destinationOpen) questions.push("bạn thích biển, núi, nghỉ dưỡng hay khám phá");
  if (hasArea && !state.days) questions.push("bạn muốn đi khoảng mấy ngày");
  if (!state.maxPrice && !state.totalBudget) questions.push("ngân sách tối đa mỗi người khoảng bao nhiêu");
  if (!questions.length && !state.dateRange) questions.push("bạn dự định đi thời gian nào");
  if (questions.length < 2 && !state.travelers) questions.push("đoàn mình có bao nhiêu người");
  const area = state.destination || state.region || state.interests?.join(", ") || "hành trình phù hợp";
  return `Mình đã ghi nhận bạn muốn tìm tour ${area}. ${questions.slice(0, 2).map((question) => question.charAt(0).toUpperCase() + question.slice(1)).join(" và ")} để mình lọc lựa chọn phù hợp nhất?`;
}

function departureIso(date) {
  const parts = localDateParts(new Date(date));
  return isoDate(Number(parts.year), Number(parts.month), Number(parts.day));
}

function findDeparturesInRange(tour, dateRange, { requireAvailability = false, travelers = 1 } = {}) {
  if (!dateRange?.start) return [];
  return (tour.departures || [])
    .filter((departure) => {
      const value = departureIso(departure.date);
      const inRange = compareIso(value, dateRange.start) >= 0 && compareIso(value, dateRange.end || dateRange.start) <= 0;
      return inRange && (!requireAvailability || Number(departure.availableSlots) >= travelers);
    })
    .sort((left, right) => new Date(left.date) - new Date(right.date));
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: TIME_ZONE }).format(new Date(value));
}

function textList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
}

function getAccommodation(tour) {
  return uniqueStrings((tour.itinerary || []).map((day) => day.accommodation).filter(Boolean));
}

function semanticBudgetLabel(constraints = {}) {
  const slot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  if (slot?.status !== "known") return null;
  const scope = slot.scope === "per_person"
    ? " mỗi người"
    : slot.scope === "total"
      ? ` cho ${constraints.travelers ? `${constraints.travelers} người` : "cả đoàn"}`
      : " (chưa xác định tổng hay mỗi người)";
  if (slot.operator === "range") return `ngân sách ${formatMoney(slot.min)}–${formatMoney(slot.max)}${scope}`;
  if (slot.operator === "min") return `ngân sách từ ${formatMoney(slot.min)}${scope}`;
  if (slot.operator === "max") return `ngân sách không quá ${formatMoney(slot.max)}${scope}`;
  if (slot.operator === "approximate") return `ngân sách khoảng ${formatMoney(slot.target)}${scope}`;
  if (slot.operator === "exact") return `ngân sách đúng ${formatMoney(slot.target)}${scope}`;
  return "ngân sách hiện tại";
}

function approximateBudgetTradeOff(price, constraints = {}, partySize = 1) {
  const slot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  if (slot?.status !== "known" || slot.operator !== "approximate" || price == null) return null;
  if (budgetMatchEvidence(price, constraints).matched) return null;
  if (slot.scope === "total") {
    const normalizedPartySize = Math.max(1, Number(partySize) || 1);
    const estimatedTotal = Number(price) * normalizedPartySize;
    const relation = estimatedTotal > Number(slot.target) ? "cao hơn" : "thấp hơn";
    return `tổng giá ước tính ${formatMoney(estimatedTotal)} cho ${normalizedPartySize} người ${relation} mốc khoảng ${formatMoney(slot.target)}`;
  }
  if (slot.scope === "per_person") {
    return `giá ${formatMoney(price)} mỗi người lệch khỏi mốc khoảng ${formatMoney(slot.target)}`;
  }
  return `mức giá hiện tại chưa nằm gần mốc khoảng ${formatMoney(slot.target)} theo cả hai cách hiểu tổng và mỗi người`;
}

function semanticDurationLabel(constraints = {}) {
  const slot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.duration;
  if (slot?.status !== "known") return null;
  if (slot.operator === "range") return `thời lượng ${slot.minDays}–${slot.maxDays} ngày`;
  if (slot.operator === "min") return `thời lượng ít nhất ${slot.minDays} ngày`;
  if (slot.operator === "max") return `thời lượng tối đa ${slot.maxDays} ngày`;
  if (slot.operator === "approximate") return `thời lượng khoảng ${slot.targetDays} ngày`;
  if (slot.operator === "exact") return `thời lượng đúng ${slot.targetDays} ngày`;
  return null;
}

function recommendationReasonGroups(tour, constraints, preferences = {}, grounding = null) {
  const factual = grounding || buildTourFactualContext(tour, constraints);
  const factualPrice = factual.priceBasis.amount;
  const reasons = [];
  const haystack = tourEvidenceText(tour);
  const normalizedHaystack = normalizeText(haystack);
  const evidence = collectTourConstraintEvidence(tour, constraints);
  const runtimeRegions = resolveTourRegions(tour);
  const runtimeRegionKeys = new Set(runtimeRegions.map(normalizeText));
  const matchedDestination = evidence.destination.find((item) => item.matched);
  if (matchedDestination) reasons.push(`đúng điểm đến ${matchedDestination.value}`);
  else if (constraints.region && runtimeRegionKeys.has(normalizeText(constraints.region))) reasons.push(`thuộc ${constraints.region}`);
  const budgetLabel = semanticBudgetLabel(constraints);
  const budgetEvidence = budgetMatchEvidence(factualPrice, constraints);
  if (budgetLabel && budgetEvidence.matched) reasons.push(`mức giá tương thích với ${budgetLabel}`);
  else if (constraints.maxPrice && factualPrice !== null && factualPrice <= constraints.maxPrice) reasons.push(`giá ${formatMoney(factualPrice)} trong ngân sách`);
  const durationSlot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.duration;
  if (durationSlot?.status === "known" && durationSlot.operator === "approximate" && Math.abs(Number(tour.days) - Number(durationSlot.targetDays)) <= 1) {
    reasons.push(tour.days === durationSlot.targetDays
      ? `đúng mốc khoảng ${durationSlot.targetDays} ngày`
      : `gần mốc khoảng ${durationSlot.targetDays} ngày`);
  } else if (durationSlot?.status === "known" && durationSlot.operator === "max" && tour.days <= durationSlot.maxDays) {
    reasons.push(`không vượt ${durationSlot.maxDays} ngày`);
  } else if (durationSlot?.status === "known" && durationSlot.operator === "min" && tour.days >= durationSlot.minDays) {
    reasons.push(`đáp ứng tối thiểu ${durationSlot.minDays} ngày`);
  } else if (constraints.days && tour.days === constraints.days) reasons.push(`đúng thời lượng ${tour.days} ngày`);
  if (constraints.dateRange && factual.availability?.availableForParty) {
    reasons.push("có lịch còn chỗ trong thời gian đã chọn");
  }
  const matchedInterests = evidence.interests.filter((item) => item.matched).map((item) => item.value);
  if (matchedInterests.length) reasons.push(`khớp chủ đề ${matchedInterests.join(", ")} bạn đang yêu cầu`);
  const paceTerms = {
    relaxed: ["nghi duong", "thu gian", "tu do", "resort", "lich trinh nhe"],
    balanced: ["can bang", "vua phai"],
    active: ["trekking", "leo nui", "mao hiem", "phieu luu", "kham pha", "trai nghiem"],
  };
  if (constraints.pace && (paceTerms[constraints.pace] || []).some((term) => normalizedHaystack.includes(term))) {
    const labels = { relaxed: "nhịp đi nhẹ nhàng", balanced: "nhịp đi cân bằng", active: "nhịp đi năng động" };
    reasons.push(`${labels[constraints.pace]} theo yêu cầu hiện tại`);
  }

  const preferenceReasons = [];
  const currentAreas = uniqueStrings([constraints.destination, constraints.region, ...(constraints.interests || [])]).map(normalizeText);
  const currentExclusions = new Set((constraints.exclusions || []).map(normalizeText));
  const primaryHaystack = tourEvidenceText(tour, { destinationOnly: true });
  const hasCurrentStyle = Boolean(constraints.pace || (constraints.interests || []).some((value) => ["nghỉ dưỡng", "khám phá", "mạo hiểm"].includes(value)));
  const addPreferenceMatch = (values, label, source = haystack) => {
    const matches = (values || []).filter((value) => {
      const key = normalizeText(value);
      return !currentAreas.includes(key)
        && !currentExclusions.has(key)
        && semanticInterestMatch(source, value);
    });
    if (matches.length) preferenceReasons.push(`${label} ${matches.join(", ")}`);
  };
  addPreferenceMatch(preferences.preferredDestinations, "điểm đến bạn thường thích", primaryHaystack);
  const preferredRegion = (preferences.preferredRegions || []).find((region) => runtimeRegionKeys.has(normalizeText(region)));
  if (!constraints.region && preferredRegion) {
    preferenceReasons.push(`thuộc ${preferredRegion}, khu vực bạn thường ưu tiên`);
  }
  if (!hasCurrentStyle) addPreferenceMatch(preferences.travelStyles, "phong cách bạn thường ưu tiên");
  addPreferenceMatch(preferences.interests, "sở thích đã lưu");
  if (constraints.accommodationRequired !== false) addPreferenceMatch(preferences.accommodationPreferences, "kiểu lưu trú bạn thường chọn");

  const budget = preferences.budgetPreference || {};
  if (!constraints.maxPrice && !constraints.minPrice) {
    if (factualPrice !== null && budget.min && budget.max && factualPrice >= budget.min && factualPrice <= budget.max) preferenceReasons.push("nằm trong khoảng ngân sách bạn thường chọn");
    else if (factualPrice !== null && budget.max && factualPrice <= budget.max) preferenceReasons.push("không vượt ngân sách bạn thường ưu tiên");
    else if (factualPrice !== null && budget.target && Math.abs(factualPrice - budget.target) <= Math.max(500000, budget.target * 0.2)) preferenceReasons.push("gần mức giá bạn thường chọn");
  }
  const duration = preferences.durationPreference || {};
  if (!constraints.days) {
    if (duration.minDays && duration.maxDays && tour.days >= duration.minDays && tour.days <= duration.maxDays) preferenceReasons.push("đúng khoảng thời lượng bạn thường chọn");
    else if (duration.targetDays && tour.days === duration.targetDays) preferenceReasons.push(`đúng ${tour.days} ngày bạn thường ưu tiên`);
  }
  if (!constraints.pace && (paceTerms[preferences.pace] || []).some((term) => normalizedHaystack.includes(term))) {
    const labels = { relaxed: "nhịp đi nhẹ nhàng", balanced: "nhịp đi cân bằng", active: "nhịp đi năng động" };
    preferenceReasons.push(`${labels[preferences.pace]} bạn thường ưu tiên`);
  }
  return { currentReasons: reasons, preferenceReasons };
}

function buildRecommendationItems(tours, constraints, now = new Date(), preferences = {}, groundingContract = null) {
  const contract = groundingContract || buildGroundingContract(tours, constraints, { now });
  return tours.slice(0, 3).map((tour) => {
    const factual = groundingForTour(contract, tour) || buildTourFactualContext(tour, constraints, { now });
    const departures = factual.departures.filter((departure) => departure.availableForParty);
    const factualPrice = factual.priceBasis.amount;
    const tradeOffs = [];
    if (constraints.maxPrice && factualPrice !== null && factualPrice > constraints.maxPrice * 0.9) tradeOffs.push("giá khá sát mức ngân sách tối đa");
    const budgetTradeOff = approximateBudgetTradeOff(factualPrice, constraints, factual.partySize);
    if (budgetTradeOff) tradeOffs.push(budgetTradeOff);
    if (factual.availability && factual.availability.remainingSlots <= 5) tradeOffs.push(`đợt đang xét còn ${factual.availability.remainingSlots} chỗ`);
    if (constraints.dateRange && !departures.length) tradeOffs.push("chưa có lịch còn đủ chỗ đúng thời gian đã nêu");
    const durationSlot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.duration;
    if (durationSlot?.operator === "approximate" && Number(tour.days) !== Number(durationSlot.targetDays)) {
      tradeOffs.push(`lệch ${Math.abs(Number(tour.days) - Number(durationSlot.targetDays))} ngày so với mốc khoảng ${durationSlot.targetDays} ngày`);
    }
    const reasonGroups = recommendationReasonGroups(tour, constraints, preferences, factual);
    return {
      tourId: String(tour._id),
      name: tour.name,
      price: factualPrice,
      priceBasis: factual.priceBasis,
      departure: factual.selectedDeparture,
      availability: factual.availability,
      partySize: factual.partySize,
      factualFingerprint: factual.fingerprint,
      duration: tour.days,
      reasons: [...reasonGroups.currentReasons, ...reasonGroups.preferenceReasons],
      currentConstraintReasons: reasonGroups.currentReasons,
      savedPreferenceReasons: reasonGroups.preferenceReasons,
      highlights: (tour.highlights || []).slice(0, 3),
      tradeOffs,
    };
  });
}

function buildRecommendationReply(items, constraints = {}, options = {}) {
  if (!items.length) return "Mình chưa tìm thấy tour đang hoạt động đáp ứng đầy đủ các điều kiện đã ghi nhận. Bạn có muốn nới ngân sách, thời lượng hoặc thời gian đi không?";
  const destination = constraints?.[SEMANTIC_STATE_KEY]?.slots?.destination;
  const durationLabel = semanticDurationLabel(constraints);
  const lead = options.operation === "recommendation_alternative"
    ? "Mình tìm được một nhóm lựa chọn khác vẫn bám các tiêu chí hiện tại:"
    : destination?.status === "intentionally_open"
      ? "Vì bạn đang để mở điểm đến, mình chọn các tour có độ phù hợp tốt nhất với những tiêu chí còn lại:"
      : constraints.destination
        ? `Với điểm đến ${constraints.destination}, đây là các lựa chọn phù hợp nhất hiện có:`
        : durationLabel
          ? `Theo ${durationLabel}, mình chọn được các tour sau:`
          : "Theo yêu cầu hiện tại, đây là các tour phù hợp nhất:";
  const lines = [lead];
  items.forEach((item, index) => {
    const priceLabel = item.priceBasis?.type === "departure"
      ? `${formatMoney(item.price)} cho ngày ${formatDate(item.priceBasis.date)}`
      : `từ ${formatMoney(item.price)}`;
    lines.push(`\n${index + 1}. **${item.name}** — ${item.duration} ngày, ${priceLabel}.`);
    if (item.currentConstraintReasons?.length) lines.push(`Hợp ở chỗ: ${item.currentConstraintReasons.join("; ")}.`);
    if (item.savedPreferenceReasons?.length) lines.push(`Theo sở thích đã lưu, điểm cộng là: ${item.savedPreferenceReasons.join("; ")}.`);
    if (!item.currentConstraintReasons?.length && !item.savedPreferenceReasons?.length) {
      lines.push("Đây là một trong các tour đang hoạt động gần yêu cầu nhất theo dữ liệu hiện tại.");
    }
    if (item.highlights.length) lines.push(`Điểm mạnh: ${item.highlights.join("; ")}.`);
    if (item.tradeOffs.length) lines.push(`Lưu ý: ${item.tradeOffs.join("; ")}.`);
  });
  return lines.join("\n");
}

function constraintLabel(field, constraints = {}) {
  if (field === "budget") {
    const semantic = semanticBudgetLabel(constraints);
    if (semantic) return semantic;
    if (constraints.exactPrice != null) return `mức giá đúng ${formatMoney(constraints.exactPrice)}`;
    if (constraints.totalBudget) return `ngân sách ${formatMoney(constraints.totalBudget)} cho ${constraints.travelers ? `${constraints.travelers} người` : "cả đoàn"}`;
    if (constraints.maxPrice) return `ngân sách tối đa ${formatMoney(constraints.maxPrice)} mỗi người`;
    return "ngân sách hiện tại";
  }
  if (field === "dateRange") return `thời gian ${constraints.dateRange?.label || constraints.dateRange?.start || "đã chọn"}`;
  if (field === "days") return semanticDurationLabel(constraints) || `thời lượng ${constraints.days} ngày`;
  if (field === "travelers") return `số lượng ${constraints.travelers} người`;
  if (field === "destination") return `điểm đến ${constraints.destination}`;
  if (field === "region") return `khu vực ${constraints.region}`;
  if (field === "interests") return `chủ đề ${(constraints.interests || []).join(", ")}`;
  if (field === "exclusions") return `các loại trừ ${(constraints.exclusions || []).join(", ")}`;
  return field;
}

function currentFocusLabel(constraints = {}) {
  const currentFields = new Set(constraintMeta(constraints).currentFields || []);
  if (currentFields.has("destination") && constraints.destination) return `tour ${constraints.destination}`;
  if (currentFields.has("region") && constraints.region) return `tour ${constraints.region}`;
  if (currentFields.has("interests") && constraints.interests?.length) return `tour ${constraints.interests.join(", ")}`;
  if (currentFields.has("budget")) return `tour theo ${constraintLabel("budget", constraints)}`;
  return "tour phù hợp";
}

function buildZeroResultReply(constraints = {}, analysis = {}, options = {}) {
  if (analysis.cause === "alternative_exhausted" || options.operation === "recommendation_alternative" && analysis.cause !== "user_constraints") {
    return "Mình chưa còn nhóm tour khác đáp ứng các tiêu chí hiện tại. Nếu bạn muốn, hãy thay đổi một tiêu chí như thời lượng, ngân sách hoặc khu vực để mở thêm lựa chọn.";
  }
  if (analysis.cause === "internal_retrieval_degraded") {
    return "Hệ thống tìm kiếm tour đang tạm suy giảm nên mình chưa thể xác nhận đây là zero-result thật. Bạn có thể thử lại sau ít phút; các điều kiện đã nhập vẫn được giữ nguyên.";
  }
  const focus = currentFocusLabel(constraints);
  const blockers = uniqueStrings(analysis.blockingFields || []);
  if (constraints.exactPrice != null && constraintMeta(constraints).currentFields?.includes("budget")) {
    return `Mình đã kiểm tra ${focus}, nhưng hiện chưa thấy tour published/active có mức giá này trong dữ liệu hệ thống.`;
  }
  if (blockers.length) {
    const labels = blockers.map((field) => constraintLabel(field, constraints));
    const replyFocus = labels.some((label) => normalizeText(focus).includes(normalizeText(label)))
      ? "tour phù hợp"
      : focus;
    const suggestions = blockers.map((field) => field === "budget"
      ? "tăng ngân sách một chút"
      : field === "dateRange"
        ? "thử một ngày khởi hành khác"
        : field === "days"
          ? "linh hoạt hơn về số ngày"
          : field === "travelers"
            ? "đổi quy mô đoàn"
            : field === "exclusions"
              ? "giữ loại trừ này và thử một khu vực khác, hoặc bỏ loại trừ nếu bạn thấy phù hợp"
              : `linh hoạt hơn về ${constraintLabel(field, constraints)}`);
    return `Hiện mình chưa tìm thấy ${replyFocus} đồng thời đáp ứng ${labels.join(" và ")}. Nếu bạn có thể ${uniqueStrings(suggestions).join(" hoặc ")}, mình sẽ tìm thêm lựa chọn.`;
  }
  const known = ["budget", "dateRange", "days", "travelers"].filter((field) => constraints[field] || (field === "budget" && (constraints.maxPrice || constraints.totalBudget)));
  if (known.length) {
    return `Mình đã ưu tiên ${focus}, nhưng chưa thấy tour đang hoạt động khớp tổ hợp ${known.map((field) => constraintLabel(field, constraints)).join(", ")}. Có thể cần nới một trong các điều kiện này.`;
  }
  return `Mình đã ưu tiên ${focus}, nhưng hiện chưa thấy tour published/active phù hợp trong dữ liệu hệ thống. Có thể thử khu vực hoặc thời gian khác.`;
}

function buildComparison(tours, constraints, options = {}) {
  const contract = options.grounding || buildGroundingContract(tours, constraints, { now: options.now });
  const items = tours.slice(0, 3).map((tour) => {
    const factual = groundingForTour(contract, tour) || buildTourFactualContext(tour, constraints, { now: options.now });
    const accommodations = getAccommodation(tour);
    const groups = recommendationReasonGroups(tour, constraints, options.preferences || {}, factual);
    const pros = [...groups.currentReasons, ...groups.preferenceReasons];
    const cons = [];
    if (constraints.maxPrice && factual.priceBasis.amount !== null && factual.priceBasis.amount > constraints.maxPrice) cons.push("vượt ngân sách hiện tại");
    if (constraints.days && tour.days !== constraints.days) cons.push(`khác thời lượng mong muốn ${constraints.days} ngày`);
    if (constraints.dateRange && !factual.availability?.availableForParty) cons.push(`không đủ chỗ cho đoàn ${factual.partySize} người vào ngày đã chọn`);
    
    let highlights = (tour.highlights || []).filter(Boolean);
    if (!highlights.length && tour.itinerary && tour.itinerary.length) {
      highlights = tour.itinerary.map(day => day.title).filter(Boolean);
    }

    return {
      tourId: String(tour._id),
      name: tour.name,
      price: factual.priceBasis.amount,
      priceBasis: factual.priceBasis,
      availability: factual.availability,
      factualFingerprint: factual.fingerprint,
      duration: tour.days,
      relevantHighlights: highlights.slice(0, 4),
      accommodation: accommodations.slice(0, 3),
      pros,
      cons,
      fitEvidence: pros,
      fitEvidenceScore: pros.length - cons.length,
    };
  });
  const ranked = [...items].sort((left, right) =>
    right.fitEvidenceScore - left.fitEvidenceScore ||
    (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER) ||
    left.tourId.localeCompare(right.tourId)
  );
  const recommended = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  let recommendation = null;
  if (recommended && runnerUp && recommended.fitEvidence.length && recommended.fitEvidenceScore > runnerUp.fitEvidenceScore) {
    recommendation = {
      tourId: recommended.tourId,
      basis: "semantic_evidence",
      evidence: recommended.fitEvidence,
      reason: `${recommended.name} có nhiều căn cứ phù hợp hơn theo các điều kiện hiện tại: ${recommended.fitEvidence.join("; ")}.`,
    };
  } else if (recommended && runnerUp && recommended.price !== null && runnerUp.price !== null && recommended.price < runnerUp.price) {
    const savings = runnerUp.price - recommended.price;
    recommendation = {
      tourId: recommended.tourId,
      comparedWithTourId: runnerUp.tourId,
      basis: "lower_price",
      savings,
      reason: `${recommended.name} có giá ${formatMoney(recommended.price)}, thấp hơn ${runnerUp.name} ${formatMoney(savings)} trên cùng cơ sở dữ liệu.`,
    };
  } else if (recommended && !runnerUp) {
    recommendation = {
      tourId: recommended.tourId,
      basis: "single_candidate",
      evidence: recommended.fitEvidence,
      reason: `Hiện chỉ có ${recommended.name} trong tập tour đang được so sánh.`,
    };
  }
  return {
    type: "comparison",
    tours: items,
    recommendation,
  };
}

function buildComparisonReply(comparison) {
  if (!comparison?.tours?.length) return "Mình chưa xác định đủ tour để so sánh. Bạn muốn so sánh những tour nào?";
  const lines = ["Mình đã đối chiếu dữ liệu hiện tại của các tour:"];
  for (const tour of comparison.tours) {
    lines.push(`\n**${tour.name}** — ${tour.duration} ngày, từ ${formatMoney(tour.price)}.`);
    if (tour.relevantHighlights.length) lines.push(`Điểm nổi bật: ${tour.relevantHighlights.join("; ")}.`);
    if (tour.pros.length) lines.push(`Ưu điểm theo yêu cầu: ${tour.pros.join("; ")}.`);
    if (tour.cons.length) lines.push(`Điểm cần cân nhắc: ${tour.cons.join("; ")}.`);
  }
  if (comparison.recommendation) lines.push(`\nKhuyến nghị: ${comparison.recommendation.reason}`);
  return lines.join("\n");
}

function buildAvailabilityReply(tour, dateRange, departures, partySize = 1) {
  const label = dateRange?.label || dateRange?.start || "thời gian bạn hỏi";
  if (!departures.length) return `Tour **${tour.name}** hiện không có đợt khởi hành vào ${label} trong dữ liệu hiện tại.`;
  const lines = [`Tình trạng tour **${tour.name}** vào ${label}:`];
  for (const departure of departures) {
    const slots = Number(departure.remainingSlots ?? departure.availableSlots ?? 0);
    const availableForParty = departure.availableForParty ?? slots >= partySize;
    const status = slots <= 0
      ? "đã hết chỗ (0 chỗ)"
      : availableForParty
        ? `còn ${slots} chỗ, đủ cho ${partySize} người`
        : `còn ${slots} chỗ nhưng không đủ cho ${partySize} người`;
    lines.push(`- ${formatDate(departure.date)}: ${status}, giá đợt này ${formatMoney(departure.price)}.`);
  }
  return lines.join("\n");
}

function matchingFacts(tour, pattern) {
  const values = [
    ...textList(tour.inclusions),
    ...textList(tour.exclusions),
    ...(tour.highlights || []),
    tour.summary,
    ...(tour.itinerary || []).flatMap((day) => [day.title, day.description]),
  ].filter(Boolean);
  return uniqueStrings(values.filter((value) => pattern.test(normalizeText(value)))).slice(0, 5);
}

function upcomingDepartures(tour, now = new Date()) {
  return (tour.departures || [])
    .filter((departure) => new Date(departure.date) >= now)
    .sort((left, right) => new Date(left.date) - new Date(right.date))
    .slice(0, 4);
}

function requestedItineraryDays(message) {
  const normalized = normalizeText(message);
  const compact = normalized.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const matches = [...normalized.matchAll(/\bngay\s+(?<day>\d{1,2}|mot|hai|ba|bon|nam|sau|bay)\b/g)]
    .filter((match) => {
      const before = normalized.slice(Math.max(0, match.index - 16), match.index);
      const after = normalized.slice(match.index + match[0].length, match.index + match[0].length + 16);
      return !(/\bmoi\s*$/.test(before) && /^\s*(?:dong|y|cau|doan|bullet)\b/.test(after));
    });
  if (!matches.length) return [];
  const hasItineraryCue = /\b(?:lam gi|co gi|thi sao|the nao|hoat dong gi|di dau|tham quan gi|lich trinh|noi gon|tom tat)\b/.test(normalized)
    || /^ngay\s+(?:\d{1,2}|mot|hai|ba|bon|nam|sau|bay)(?:\s+(?:nhe|nha|a|ha))?$/.test(compact);
  if (!hasItineraryCue) return [];
  const wordDays = new Map([
    ["mot", 1], ["hai", 2], ["ba", 3], ["bon", 4],
    ["nam", 5], ["sau", 6], ["bay", 7],
  ]);
  return [...new Set(matches.map((match) => (
    /^\d+$/.test(match.groups.day) ? Number(match.groups.day) : wordDays.get(match.groups.day)
  )).filter(Boolean))];
}

function buildBaseTourDetail(tour, message, now = new Date()) {
  const normalized = normalizeText(message);
  const accommodations = getAccommodation(tour);
  const inclusions = textList(tour.inclusions);
  const exclusions = textList(tour.exclusions);
  const combinedInclusions = normalizeText(inclusions.join(" "));
  const combinedExclusions = normalizeText(exclusions.join(" "));
  const departures = upcomingDepartures(tour, now);
  const transportFacts = matchingFacts(tour, /(?:phuong tien|di chuyen|xe|tau|thuyen|cano|may bay|flight)/);
  const mealFacts = uniqueStrings([
    ...(tour.itinerary || []).flatMap((day) => day.meals || []),
    ...matchingFacts(tour, /(?:bua|an sang|an trua|an toi|am thuc|mon an)/),
  ]).slice(0, 8);
  let requestedFact = "overview";
  let dataStatus = "available";
  let reply;
  const asksPrice = /gia (?:tour|bao nhieu|tong)|tong (?:gia|tien|bao nhieu)|tour .* gia|bao nhieu tien|chi phi/.test(normalized);
  const asksDuration = /bao nhieu ngay|may ngay|thoi luong|\d{1,2}\s*ngay\s*(?:a|ha|phai khong|dung khong)/.test(normalized);
  const itineraryDays = requestedItineraryDays(message);
  const conciseItinerary = /\b(?:noi gon|tom tat|tra loi ngan|ngan gon)\b/.test(normalized);

  if (itineraryDays.length) {
    requestedFact = itineraryDays.length === 1 ? "itinerary_day" : "itinerary_days";
    let missingDay = false;
    reply = itineraryDays.map((itineraryDay) => {
      const day = (tour.itinerary || []).find((item, index) => Number(item?.dayNumber || index + 1) === itineraryDay);
      const detail = conciseItinerary
        ? String(day?.title || day?.description || "").trim()
        : [day?.title, day?.description].filter(Boolean).join(" — ");
      if (detail) return `Ngày ${itineraryDay}: ${detail}`;
      missingDay = true;
      return `Ngày ${itineraryDay}: Dữ liệu hiện tại của tour **${tour.name}** chưa có nội dung.`;
    }).join("\n");
    if (missingDay) dataStatus = "missing";
  } else if (asksPrice && asksDuration) {
    requestedFact = "price_duration";
    reply = `Tour **${tour.name}** hiện có giá cơ bản ${formatMoney(tour.basePrice)} và thời lượng ${tour.days} ngày.`;
  } else if (/khach san|luu tru/.test(normalized)) {
    requestedFact = "accommodation";
    reply = accommodations.length
      ? `Tour **${tour.name}** có thông tin lưu trú: ${accommodations.join("; ")}.`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa nêu rõ khách sạn hoặc nơi lưu trú.`;
    if (!accommodations.length) dataStatus = "missing";
  } else if (/ve may bay|may bay|flight/.test(normalized)) {
    requestedFact = "flight";
    if (/ve may bay|may bay|flight/.test(combinedInclusions)) reply = `Tour **${tour.name}** có vé máy bay trong danh mục bao gồm: ${inclusions.join("; ")}.`;
    else if (/ve may bay|may bay|flight/.test(combinedExclusions)) reply = `Tour **${tour.name}** không bao gồm vé máy bay: ${exclusions.join("; ")}.`;
    else reply = `Dữ liệu hiện tại của tour **${tour.name}** chưa xác nhận vé máy bay có được bao gồm hay không.`;
    if (!/(?:ve may bay|may bay|flight)/.test(`${combinedInclusions} ${combinedExclusions}`)) dataStatus = "missing";
  } else if (/phuong tien|di chuyen|xe khach|tau hoa|di bang gi/.test(normalized)) {
    requestedFact = "transport";
    reply = transportFacts.length
      ? `Dữ liệu hiện tại của tour **${tour.name}** ghi nhận phương tiện/di chuyển: ${transportFacts.join("; ")}.`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa nêu rõ phương tiện di chuyển.`;
    if (!transportFacts.length) dataStatus = "missing";
  } else if (isCancellationPolicyQuestion(normalized)) {
    requestedFact = "cancellation_policy";
    reply = tour.cancellationPolicy
      ? `Chính sách hủy hiện có của tour **${tour.name}**: ${tour.cancellationPolicy}`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa có chính sách hủy cụ thể trong hệ thống.`;
    if (!tour.cancellationPolicy) dataStatus = "missing";
  } else if (asksPrice) {
    requestedFact = "price";
    reply = `Giá cơ bản hiện tại của tour **${tour.name}** là ${formatMoney(tour.basePrice)}.${departures.length ? ` Giá theo ${departures.length} đợt gần nhất lần lượt: ${departures.map((departure) => `${formatDate(departure.date)} — ${formatMoney(departure.price)}`).join("; ")}.` : " Hệ thống chưa có giá theo đợt khởi hành sắp tới."}`;
  } else if (asksDuration) {
    requestedFact = "duration";
    reply = `Tour **${tour.name}** có thời lượng ${tour.days} ngày.`;
  } else if (/khoi hanh|lich di/.test(normalized)) {
    requestedFact = "departures";
    reply = departures.length
      ? `Các đợt khởi hành sắp tới của tour **${tour.name}**: ${departures.map((departure) => `${formatDate(departure.date)} — ${Number(departure.availableSlots || 0) > 0 ? `còn ${Number(departure.availableSlots)} chỗ` : "hết chỗ (0 chỗ)"}, ${formatMoney(departure.price)}`).join("; ")}.`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa có đợt khởi hành sắp tới.`;
    if (!departures.length) dataStatus = "missing";
  } else if (/khuyen mai|giam gia|uu dai/.test(normalized)) {
    requestedFact = "promotion";
    reply = tour.promotionLabel
      ? `Ưu đãi hiện tại của tour **${tour.name}**: ${tour.promotionLabel}${tour.oldPrice ? `; giá niêm yết ${formatMoney(tour.oldPrice)}, giá hiện tại ${formatMoney(tour.basePrice)}` : `; giá hiện tại ${formatMoney(tour.basePrice)}`}.`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa có thông tin khuyến mãi công khai.`;
    if (!tour.promotionLabel) dataStatus = "missing";
  } else if (/bua an|cac bua|an gi|an uong/.test(normalized)) {
    requestedFact = "meals";
    reply = mealFacts.length
      ? `Thông tin bữa ăn/ẩm thực hiện có của tour **${tour.name}**: ${mealFacts.join("; ")}.`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa nêu rõ các bữa ăn.`;
    if (!mealFacts.length) dataStatus = "missing";
  } else if (/khong bao gom/.test(normalized)) {
    requestedFact = "exclusions";
    reply = exclusions.length ? `Tour **${tour.name}** không bao gồm: ${exclusions.join("; ")}.` : `Tour **${tour.name}** chưa có dữ liệu mục không bao gồm.`;
    if (!exclusions.length) dataStatus = "missing";
  } else if (/bao gom/.test(normalized)) {
    requestedFact = "inclusions";
    reply = inclusions.length ? `Tour **${tour.name}** bao gồm: ${inclusions.join("; ")}.` : `Tour **${tour.name}** chưa có dữ liệu chi tiết mục bao gồm.`;
    if (!inclusions.length) dataStatus = "missing";
  } else if (/lich trinh/.test(normalized)) {
    requestedFact = "itinerary";
    const days = (tour.itinerary || []).slice(0, 8).map((day) => `Ngày ${day.dayNumber}: ${day.title}${day.description ? ` — ${day.description}` : ""}`);
    reply = days.length ? `Lịch trình tour **${tour.name}**:\n${days.map((day) => `- ${day}`).join("\n")}` : `Tour **${tour.name}** chưa có lịch trình chi tiết trong dữ liệu hiện tại.`;
    if (!days.length) dataStatus = "missing";
  } else {
    const nextDeparture = departures[0];
    reply = `**${tour.name}** là tour ${tour.days} ngày tại ${tour.location}, giá cơ bản từ ${formatMoney(tour.basePrice)}.${tour.summary ? ` ${tour.summary}` : ""}${nextDeparture ? ` Đợt gần nhất ${formatDate(nextDeparture.date)} hiện còn ${Number(nextDeparture.availableSlots || 0)} chỗ.` : " Hiện chưa có đợt khởi hành sắp tới trong dữ liệu."}`;
  }

  return {
    reply,
    structuredContent: {
      type: "tour_detail",
      tourId: String(tour._id),
      name: tour.name,
      requestedFact,
      requestedDay: itineraryDays.length === 1 ? itineraryDays[0] : null,
      requestedDays: itineraryDays,
      dataStatus,
      price: tour.basePrice,
      duration: tour.days,
      highlights: (tour.highlights || []).slice(0, 4),
      accommodation: accommodations,
      transport: transportFacts,
      meals: mealFacts,
      cancellationPolicy: tour.cancellationPolicy || null,
      promotion: tour.promotionLabel ? { label: tour.promotionLabel, oldPrice: tour.oldPrice || null } : null,
      departures: departures.map((departure) => ({
        departureId: String(departure._id || ""),
        date: departure.date,
        price: Number(departure.price),
        availableSlots: Number(departure.availableSlots),
        totalSlots: Number(departure.totalSlots),
      })),
      inclusions,
      exclusions,
    },
  };
}

function buildTourDetail(tour, message, now = new Date(), constraints = {}) {
  const baseDetail = buildBaseTourDetail(tour, message, now);
  const factual = buildTourFactualContext(tour, constraints, { now });
  const normalized = normalizeText(message);
  const compact = normalized.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const asksTotalPrice = /gia tong|tong (?:gia|tien|bao nhieu)/.test(normalized)
    || /^(?:tong|tong gia|tong tien)$/.test(compact);
  const structuredContent = {
    ...baseDetail.structuredContent,
    price: factual.priceBasis.amount,
    priceBasis: factual.priceBasis,
    availability: factual.availability,
    partySize: factual.partySize,
    factualFingerprint: factual.fingerprint,
  };
  if (asksTotalPrice) {
    const unitPrice = factual.priceBasis.amount;
    const totalPrice = unitPrice === null || unitPrice === undefined
      ? null
      : Number(unitPrice) * factual.partySize;
    const basisLabel = factual.priceBasis.type === "departure"
      ? ` khởi hành ngày ${formatDate(factual.priceBasis.date)}`
      : " ở mức giá cơ bản hiện tại";
    return {
      reply: totalPrice === null
        ? `Dữ liệu hiện tại chưa có mức giá phù hợp để tính tổng cho ${factual.partySize} người của tour **${tour.name}**.`
        : `Tổng giá tour **${tour.name}**${basisLabel} cho ${factual.partySize} người là ${formatMoney(totalPrice)} (${formatMoney(unitPrice)} mỗi người).`,
      structuredContent: {
        ...structuredContent,
        requestedFact: "price_total",
        totalPrice,
        dataStatus: totalPrice === null ? "missing" : "available",
      },
    };
  }
  if (!constraints.dateRange?.start) return { ...baseDetail, structuredContent };

  const asksPrice = /gia (?:tour|bao nhieu|tong)|tong (?:gia|tien|bao nhieu)|tour .* gia|bao nhieu tien|chi phi/.test(normalized);
  const asksDuration = /bao nhieu ngay|may ngay|thoi luong|\d{1,2}\s*ngay\s*(?:a|ha|phai khong|dung khong)/.test(normalized);
  if (factual.priceBasis.type !== "departure") {
    if (!asksPrice && baseDetail.structuredContent.requestedFact !== "overview") return { ...baseDetail, structuredContent };
    return {
      reply: `Dữ liệu hiện tại của tour **${tour.name}** chưa có departure phù hợp vào ngày bạn hỏi, nên chưa thể xác nhận giá hoặc chỗ trống cho ngày đó.`,
      structuredContent: { ...structuredContent, dataStatus: "missing" },
    };
  }

  const dateLabel = formatDate(factual.priceBasis.date);
  if (asksPrice && asksDuration) {
    return {
      reply: `Tour **${tour.name}** có giá ${formatMoney(factual.priceBasis.amount)} cho đợt ${dateLabel} và thời lượng ${tour.days} ngày.`,
      structuredContent,
    };
  }
  if (asksPrice) {
    return {
      reply: `Giá tour **${tour.name}** cho đợt ${dateLabel} là ${formatMoney(factual.priceBasis.amount)}.`,
      structuredContent,
    };
  }
  if (baseDetail.structuredContent.requestedFact === "promotion") {
    const promotionText = tour.promotionLabel
      ? `Ưu đãi công khai hiện tại: ${tour.promotionLabel}. `
      : "Dữ liệu hiện tại chưa có ưu đãi công khai. ";
    return {
      reply: `${promotionText}Giá factual của tour **${tour.name}** cho đợt ${dateLabel} là ${formatMoney(factual.priceBasis.amount)}.`,
      structuredContent,
    };
  }
  if (baseDetail.structuredContent.requestedFact === "overview") {
    const availability = factual.availability?.availableForParty
      ? `còn ${factual.availability.remainingSlots} chỗ, đủ cho ${factual.partySize} người`
      : `còn ${factual.availability?.remainingSlots || 0} chỗ nhưng không đủ cho ${factual.partySize} người`;
    return {
      reply: `**${tour.name}** là tour ${tour.days} ngày tại ${tour.location}; đợt ${dateLabel} có giá ${formatMoney(factual.priceBasis.amount)} và ${availability}.`,
      structuredContent,
    };
  }
  return { ...baseDetail, structuredContent };
}

const MAX_CANDIDATE_LISTS = 24;

function normalizeCandidateList(value) {
  const candidateListId = String(value?.candidateListId || "").trim();
  const tourIds = uniqueIds(value?.tourIds || []);
  if (!candidateListId || !tourIds.length) return null;
  return {
    candidateListId,
    createdTurnId: String(value?.createdTurnId || ""),
    createdTurnSequence: Number(value?.createdTurnSequence || 0),
    historyEpoch: Number(value?.historyEpoch || 0),
    source: String(value?.source || "unknown"),
    tourIds,
  };
}

function normalizeCandidateLists(values = []) {
  const byId = new Map();
  for (const value of values || []) {
    const list = normalizeCandidateList(value);
    if (!list) continue;
    if (byId.has(list.candidateListId)) byId.delete(list.candidateListId);
    byId.set(list.candidateListId, list);
  }
  return [...byId.values()].slice(-MAX_CANDIDATE_LISTS);
}

function collectEntityMemory(history = [], existingState = {}) {
  const next = { ...existingState };
  const selectedTourIds = uniqueIds([next.selectedTourId, next.currentTourId]);
  if (!next.lastReferencedTourIds?.length && selectedTourIds.length) next.lastReferencedTourIds = selectedTourIds;
  let candidateLists = normalizeCandidateLists(next.candidateLists || []);
  for (const item of history) {
    if (item?.candidateList) candidateLists = normalizeCandidateLists([...candidateLists, item.candidateList]);
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index] || {};
    if (!next.lastSuggestedTourIds?.length && item.suggestedTourIds?.length) next.lastSuggestedTourIds = uniqueIds(item.suggestedTourIds);
    if (!next.lastReferencedTourIds?.length && item.referencedTourIds?.length) next.lastReferencedTourIds = uniqueIds(item.referencedTourIds);
    if (next.lastSuggestedTourIds?.length && next.lastReferencedTourIds?.length) break;
  }

  if (!candidateLists.length && next.lastSuggestedTourIds?.length) {
    candidateLists = [{
      candidateListId: "legacy:active",
      createdTurnId: "",
      createdTurnSequence: 0,
      historyEpoch: 0,
      source: "legacy",
      tourIds: uniqueIds(next.lastSuggestedTourIds),
    }];
  }

  const validListIds = new Set(candidateLists.map((list) => list.candidateListId));
  const activeCandidateListId = validListIds.has(String(next.activeCandidateListId || ""))
    ? String(next.activeCandidateListId)
    : candidateLists.at(-1)?.candidateListId;
  const activeIndex = candidateLists.findIndex((list) => list.candidateListId === activeCandidateListId);
  const fallbackPreviousId = activeIndex > 0 ? candidateLists[activeIndex - 1].candidateListId : null;
  const previousCandidateListId = validListIds.has(String(next.previousCandidateListId || ""))
    && String(next.previousCandidateListId) !== activeCandidateListId
    ? String(next.previousCandidateListId)
    : fallbackPreviousId;
  const selectedCandidateListId = validListIds.has(String(next.selectedCandidateListId || ""))
    ? String(next.selectedCandidateListId)
    : null;
  const activeList = candidateLists.find((list) => list.candidateListId === activeCandidateListId);

  if (candidateLists.length) next.candidateLists = candidateLists;
  else delete next.candidateLists;
  if (activeCandidateListId) next.activeCandidateListId = activeCandidateListId;
  else delete next.activeCandidateListId;
  if (previousCandidateListId) next.previousCandidateListId = previousCandidateListId;
  else delete next.previousCandidateListId;
  if (selectedCandidateListId) next.selectedCandidateListId = selectedCandidateListId;
  else delete next.selectedCandidateListId;
  if (activeList?.tourIds.length) next.lastSuggestedTourIds = activeList.tourIds;
  next.recentTourIds = uniqueIds([
    ...(next.lastReferencedTourIds || []),
    ...(next.lastSuggestedTourIds || []),
    ...(next.recentTourIds || []),
  ]).slice(0, 12);
  return next;
}

function candidateListForReference(state, message) {
  const lists = normalizeCandidateLists(state?.candidateLists || []);
  const normalized = normalizeText(message);
  const historical = /\b(?:luc nay|hoi nay|ban nay|luc truoc|hoi truoc|truoc do|vua roi|danh sach truoc|danh sach luc nay)\b/.test(normalized);
  const active = lists.find((list) => list.candidateListId === state?.activeCandidateListId) || lists.at(-1) || null;
  const ordinal = ordinalFromMessage(message);
  const selectedList = lists.find((list) => list.candidateListId === state?.selectedCandidateListId);
  const selectedTourId = String(state?.selectedTourId || state?.currentTourId || "");
  if (!historical) {
    const activeCannotResolve = ordinal && !active?.tourIds[ordinal - 1];
    if (activeCannotResolve
      && active?.source === "grounded_answer"
      && selectedList?.tourIds[ordinal - 1] === selectedTourId) return selectedList;
    return active;
  }
  if (ordinal && selectedList?.tourIds[ordinal - 1] === selectedTourId) {
    return selectedList;
  }
  const activeIndex = active ? lists.findIndex((list) => list.candidateListId === active.candidateListId) : lists.length;
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const candidate = lists[index];
    if (!active || candidate.tourIds.join("|") !== active.tourIds.join("|")) return candidate;
  }
  return lists.find((list) => list.candidateListId === state?.previousCandidateListId) || active;
}

function ordinalFromMessage(message) {
  const normalized = normalizeText(message);
  const entityNoun = "(?:tour|cai|phuong an|lua chon)";
  const words = { "dau tien": 1, "dau": 1, "mot": 1, "hai": 2, "ba": 3, "bon": 4, "nam": 5 };
  const numeric = normalized.match(new RegExp(`${entityNoun}\\s*(?:(?:thu|so)\\s*)?(\\d{1,2})\\b`));
  if (numeric) return Number(numeric[1]);
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`${entityNoun}\\s*(?:(?:thu|so)\\s*)?${word}\\b`).test(normalized)) return value;
  }
  return null;
}

function hasTourReferenceSignal(message, entityState = {}) {
  const normalized = normalizeText(message);
  if (ordinalFromMessage(message)) return true;
  const hasEntityMemory = uniqueIds([
    entityState.selectedTourId,
    entityState.currentTourId,
    entityState.previousSelectedTourId,
    ...(entityState.lastReferencedTourIds || []),
    ...(entityState.lastSuggestedTourIds || []),
  ]).length > 0;
  if (!hasEntityMemory) return false;
  if (/\b(?:may|cac|nhung|loat)\s+tour\s+(?:vua|luc)\b/.test(normalized)) return false;
  if (/\b(?:tour|cai|phuong an|lua chon)\s+(?:truoc|cu)\b|\bquay lai\s+(?:tour|cai|phuong an|lua chon)(?:\s+(?:truoc|cu))?\b/.test(normalized)) return true;
  if (/\b(?:tour|cai|phuong an|lua chon)\s+(?:nay|do|kia|cuoi(?: cung)?)\b|\btour\s+(?:vua|luc)\b/.test(normalized)) return true;
  return Boolean(
    uniqueIds([
      entityState.selectedTourId,
      entityState.currentTourId,
      ...(entityState.lastReferencedTourIds || []),
    ]).length === 1 && /\b(?:tour do|tour nay|cai do|phuong an do)\b/.test(normalized)
  );
}

function resolveEntityIds({ message, requestType, pageContext = {}, entityState = {}, mentionedTourIds = [] }) {
  const normalized = normalizeText(message);
  const state = collectEntityMemory([], entityState);
  const candidateList = candidateListForReference(state, message);
  const suggested = uniqueIds(candidateList?.tourIds || state.lastSuggestedTourIds || []);
  const candidateListId = candidateList?.candidateListId || null;
  const selected = uniqueIds([state.selectedTourId, state.currentTourId]);
  const focusedTourId = /^[0-9a-fA-F]{24}$/.test(String(state.focusedTourId || ""))
    ? String(state.focusedTourId)
    : null;
  const lastReferenced = uniqueIds(state.lastReferencedTourIds || []);
  const referenced = uniqueIds([
    state.selectedTourId,
    state.currentTourId,
    ...lastReferenced,
  ]);
  const mentioned = uniqueIds(mentionedTourIds);
  const pageTourId = /^[0-9a-fA-F]{24}$/.test(String(pageContext.tourId || "")) ? String(pageContext.tourId) : null;
  const previousSelectedTourId = /^[0-9a-fA-F]{24}$/.test(String(state.previousSelectedTourId || ""))
    ? String(state.previousSelectedTourId)
    : null;
  const ordinal = ordinalFromMessage(message);
  const mentionsLast = /(?:tour|cai|phuong an|lua chon) cuoi(?: cung)?\b/.test(normalized);
  const mentionsPreviousSelection = /\b(?:tour|cai|phuong an|lua chon)\s+(?:truoc|cu)\b|\bquay lai\s+(?:tour|cai|phuong an|lua chon)(?:\s+(?:truoc|cu))?\b/.test(normalized);
  const mentionsHistoricalSelection = /\b(?:(?:tour|cai|phuong an|lua chon)\s+)?(?:luc nay|hoi nay|ban nay|luc truoc|hoi truoc|truoc do|vua roi)\b/.test(normalized);

  const mentionsCurrent = /(?:tour|cai|phuong an|lua chon) nay\b/.test(normalized);
  const mentionsRecent = /(?:tour|cai|phuong an|lua chon) (?:do|kia)|tour vua (?:noi|goi y|xem|ke)|tour luc nay/.test(normalized);
  if (mentioned.length) {
    const ids = uniqueIds([...mentioned, ...(mentionsCurrent && pageTourId ? [pageTourId] : [])]);
    if (requestType === "comparison") return ids.length >= 2 ? { ids: ids.slice(0, 3), source: "explicit", ambiguousIds: [] } : { ids, source: "explicit", ambiguousIds: ids, needsClarification: true };
    return ids.length === 1 ? { ids, source: "explicit", ambiguousIds: [] } : { ids: [], source: "explicit", ambiguousIds: ids, needsClarification: true };
  }

  if (requestType === "comparison"
    && mentionsHistoricalSelection
    && selected.length === 1
    && previousSelectedTourId
    && previousSelectedTourId !== selected[0]) {
    return {
      ids: [selected[0], previousSelectedTourId],
      source: "current_previous_comparison",
      ambiguousIds: [],
    };
  }

  if (mentionsPreviousSelection && previousSelectedTourId) {
    return { ids: [previousSelectedTourId], source: "previous_selection", ambiguousIds: [] };
  }

  if (ordinal) {
    const id = suggested[ordinal - 1];
    if (requestType === "comparison") {
      const ids = uniqueIds([referenced[0], id]);
      return ids.length >= 2
        ? { ids: ids.slice(0, 3), source: "ordinal_comparison", ambiguousIds: [], candidateListId }
        : { ids: id ? [id] : [], source: "ordinal_comparison", ambiguousIds: suggested, needsClarification: true, candidateListId };
    }
    return id
      ? { ids: [id], source: "ordinal", ambiguousIds: [], candidateListId }
      : { ids: [], source: "ordinal", ambiguousIds: suggested, needsClarification: true, candidateListId };
  }

  if (mentionsLast) {
    const id = suggested[suggested.length - 1];
    return id
      ? { ids: [id], source: "last_ordinal", ambiguousIds: [], candidateListId }
      : { ids: [], source: "last_ordinal", ambiguousIds: [], needsClarification: true, candidateListId };
  }

  if (requestType === "comparison") {
    const requestedCount = Number(normalized.match(/so sanh\s*(\d)\s*tour/)?.[1]) || Math.min(3, suggested.length);
    const ids = uniqueIds([...(mentionsCurrent && pageTourId ? [pageTourId] : []), ...suggested]).slice(0, Math.max(2, requestedCount));
    return ids.length >= 2
      ? { ids, source: "recent_suggestions", ambiguousIds: [], candidateListId }
      : { ids, source: "recent_suggestions", ambiguousIds: ids, needsClarification: true, candidateListId };
  }

  if (pageTourId) return { ids: [pageTourId], source: "page", ambiguousIds: [] };
  if (selected.length === 1 && focusedTourId === selected[0]) {
    return {
      ids: selected,
      source: "focused_selection",
      ambiguousIds: [],
      candidateListId: state.selectedCandidateListId || null,
    };
  }
  if (selected.length === 1 && lastReferenced.length === 1 && lastReferenced[0] === selected[0]) {
    return { ids: selected, source: "focused_selection", ambiguousIds: [], candidateListId };
  }
  if (mentionsRecent && referenced.length === 1) return { ids: referenced, source: "recent_reference", ambiguousIds: [] };
  if (mentionsRecent && suggested.length === 1) return { ids: suggested, source: "recent_suggestion", ambiguousIds: [], candidateListId };
  if (selected.length === 1 && (!suggested.length || suggested.includes(selected[0]))) {
    return { ids: selected, source: "selected_active", ambiguousIds: [], candidateListId };
  }
  if (referenced.length === 1 && (!suggested.length || suggested.includes(referenced[0]))) {
    return { ids: referenced, source: "recent_reference", ambiguousIds: [] };
  }
  if (suggested.length === 1) return { ids: suggested, source: "recent_suggestion", ambiguousIds: [], candidateListId };
  const ambiguousIds = suggested.length > 1 ? suggested : referenced;
  return { ids: [], source: "recent", ambiguousIds, needsClarification: true, candidateListId };
}

function buildEntityClarification(ambiguousTours = [], requestType = "tour_detail") {
  const names = ambiguousTours.slice(0, 3).map((tour, index) => `${index + 1}. ${tour.name}`);
  const action = requestType === "comparison" ? "so sánh" : requestType === "availability" ? "kiểm tra lịch" : "xem thông tin";
  return names.length
    ? `Mình chưa xác định chắc tour bạn muốn ${action}. Bạn chọn giúp mình:\n${names.join("\n")}`
    : `Mình chưa xác định được tour bạn đang nhắc tới. Bạn cho mình tên tour hoặc chọn lại tour cụ thể nhé.`;
}

module.exports = {
  TIME_ZONE,
  SEMANTIC_STATE_KEY,
  SEMANTIC_STATE_VERSION,
  normalizeText,
  isCancellationPolicyQuestion,
  uniqueIds,
  CONSTRAINT_META_KEY,
  constraintMeta,
  constraintMode,
  publicConstraintState,
  getEffectiveConstraintState,
  parseDateConstraint,
  parseBudgetConstraint,
  extractConstraintDelta,
  constraintsFromPageContext,
  mergeConstraintState,
  migrateLegacyConstraintState,
  validateSemanticStateV2,
  detectRequestType,
  shouldClarifyRecommendation,
  shouldClarifyRecommendationWithPreferences,
  hasPreferenceSignal,
  buildClarificationReply,
  departureIso,
  findDeparturesInRange,
  formatMoney,
  formatDate,
  getAccommodation,
  buildRecommendationItems,
  buildRecommendationReply,
  buildZeroResultReply,
  buildComparison,
  buildComparisonReply,
  buildAvailabilityReply,
  buildTourDetail,
  normalizeCandidateLists,
  collectEntityMemory,
  ordinalFromMessage,
  hasTourReferenceSignal,
  resolveEntityIds,
  buildEntityClarification,
};
