const REGION_ORDER = ["Miền Bắc", "Miền Trung", "Miền Nam"];

const FOREIGN_TOUR_MARKERS = [
  "singapore", "malaysia", "trung quoc", "han quoc", "nhat ban", "dai loan",
  "thai lan", "indonesia", "lien tuyen ba nuoc", "tour nga", "chau au",
  "nam au", "bac au", "anh quoc",
];

const DEPARTURE_MARKERS = [
  "khoi hanh", "don tu", "don tai", "don khach tu", "don khach tai",
  "xuat phat", "tap trung", "bay tu", "chuyen bay tu", "dap chuyen bay tu",
];

const RETURN_MARKERS = [
  "tro ve", "quay ve", "ve lai", "bay ve", "ket thuc", "tien khach",
  "chia tay", "tra khach", "ra san bay", "ve tp", "ve hcm", "ve tphcm",
  "ve ha noi", "ve sai gon", "ve den tphcm", "ve den hcm", "ve den ha noi",
];

const PLACE_REGIONS = [
  {
    region: "Miền Bắc",
    aliases: [
      "Miền Bắc", "Tây Bắc", "Đông Bắc", "Hà Nội", "Hạ Long", "Quảng Ninh",
      "Sa Pa", "Sapa", "Lào Cai", "Hà Giang", "Cao Bằng", "Bắc Kạn", "Ba Bể",
      "Ninh Bình", "Tràng An", "Tam Cốc", "Mộc Châu", "Sơn La", "Điện Biên",
      "Lai Châu", "Yên Bái", "Mù Cang Chải", "Tà Xùa", "Pù Luông", "Thanh Hóa",
      "Hải Phòng", "Cát Bà", "Hòa Bình", "Mai Châu", "Vĩnh Phúc", "Tam Đảo",
    ],
  },
  {
    region: "Miền Trung",
    aliases: [
      "Miền Trung", "Quảng Bình", "Phong Nha", "Động Thiên Đường", "Huế",
      "Thừa Thiên Huế", "Đà Nẵng", "Hội An", "Quảng Nam", "Quảng Ngãi",
      "Quy Nhơn", "Bình Định", "Phú Yên", "Tuy Hòa", "Nha Trang", "Khánh Hòa",
      "Ninh Thuận", "Phan Rang", "Vĩnh Hy", "Bình Hưng", "Bình Thuận",
      "Phan Thiết", "Mũi Né", "Nghệ An", "Cửa Lò", "Hà Tĩnh", "Quảng Trị",
      "Đà Lạt", "Lâm Đồng",
    ],
  },
  {
    region: "Miền Nam",
    aliases: [
      "Miền Nam", "TP.HCM", "TP HCM", "HCM", "Hồ Chí Minh", "Sài Gòn",
      "Củ Chi", "Tây Ninh", "Vũng Tàu", "Bà Rịa", "Long Hải",
      "Bảo Lộc", "Phú Quốc", "Kiên Giang", "Cần Thơ", "Cái Răng",
      "Sóc Trăng", "Bạc Liêu", "Cà Mau", "Bến Tre", "Mỹ Tho", "Tiền Giang",
      "Đồng Tháp", "An Giang", "Châu Đốc", "Long An", "Đồng Nai", "Biên Hòa",
      "Bình Dương", "Bình Phước", "Trà Vinh", "Vĩnh Long", "Hậu Giang",
    ],
  },
];

function normalizeBase(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function canonicalizeAbbreviations(value) {
  return String(value || "")
    .replace(/\btp\s*(?:\.\s*)?hcm\b/g, "tphcm")
    .replace(/\btp\s*(?:\.\s*)?ho\s+chi\s+minh\b/g, "tphcm");
}

function normalizeText(value) {
  return canonicalizeAbbreviations(normalizeBase(value))
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isForeignTourName(value) {
  const titleBeforeRoute = normalizeText(String(value || "").split(":")[0]);
  return FOREIGN_TOUR_MARKERS.some((marker) => titleBeforeRoute.includes(marker));
}

const NORMALIZED_PLACES = PLACE_REGIONS.flatMap(({ region, aliases }) =>
  aliases.map((alias) => ({ region, alias: normalizeText(alias) })))
  .sort((left, right) => right.alias.length - left.alias.length);

function splitTextSegments(value) {
  return canonicalizeAbbreviations(normalizeBase(value))
    .split(/[^a-z0-9\s]+/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function containsAlias(segment, alias) {
  const words = segment.split(" ");
  const aliasWords = alias.split(" ");
  if (aliasWords.length > words.length) return false;
  for (let index = 0; index <= words.length - aliasWords.length; index += 1) {
    if (words.slice(index, index + aliasWords.length).join(" ") === alias) return true;
  }
  return false;
}

function hasPhrase(value, phrases) {
  const text = ` ${normalizeText(value)} `;
  return phrases.some((phrase) => text.includes(` ${normalizeText(phrase)} `));
}

function hasDepartureOriginContext(value) {
  const text = normalizeText(value);
  if (DEPARTURE_MARKERS.some((marker) => marker !== "khoi hanh" && text.includes(` ${marker} `))) return true;
  if (/\b(khoi hanh|xuat phat)\s+(?:tu\s+)?(?!tham quan|di tham quan|ra san bay|ve lai|ve )/.test(text)) return true;
  return hasPhrase(text, [
    "diem don", "don khach", "don tai", "don tu", "tap trung",
    "ga sai gon", "ga noi bai", "chuyen tau", "chuyen bay",
  ]);
}

function hasReturnContext(value) {
  return hasPhrase(value, RETURN_MARKERS);
}

function isExcludedSegment(segment) {
  const text = normalizeText(segment);
  if (!text) return true;
  if (hasPhrase(text, [
    "diem don", "diem tra", "don khach", "don tai", "don tu", "tap trung",
    "san bay", "chuyen bay", "dap chuyen bay", "lam thu tuc", "ga sai gon",
    "ga noi bai", "chuyen tau", "ra san bay", "tro ve", "ve lai", "bay ve",
    "ket thuc", "tien khach", "chia tay", "tra khach", "ve tp", "ve hcm",
    "ve tphcm", "ve ha noi", "ve sai gon", "ve den tphcm", "ve den hcm",
    "ve den ha noi", "duong ho chi minh", "tuyen duong ho chi minh",
    "theo duong ho chi minh", "huong dong bac", "phia dong bac", "huong tay bac",
    "phia tay bac", "huong bac", "phia bac", "chu tich ho chi minh",
    "ho chi minh tuyen ngon", "bao tang ho chi minh", "lang chu tich ho chi minh",
    "nha san bac ho",
  ])) return true;
  return /\bphat thich ca mau ni\b/.test(text);
}

function regionsInText(value) {
  const regions = new Set();
  for (const segment of splitTextSegments(value)) {
    if (isExcludedSegment(segment)) continue;
    for (const { region, alias } of NORMALIZED_PLACES) {
      if (containsAlias(segment, alias)) regions.add(region);
    }
  }
  return regions;
}

function splitRouteSegments(value) {
  return String(value || "")
    .split(/\s*(?:→|->|–|—)\s*|\s+-\s+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function regionsFromRouteSegments(value, { scrapedTitle = false } = {}) {
  let segments = splitRouteSegments(value);
  if (segments.length <= 1) return regionsInText(value);
  if (hasDepartureOriginContext(value)) segments = segments.slice(1);
  if (hasReturnContext(value)) segments = segments.slice(0, -1);
  if (scrapedTitle && segments.length > 1) segments = segments.slice(1);
  const regions = new Set();
  for (const segment of segments) {
    for (const region of regionsInText(segment)) regions.add(region);
  }
  return regions;
}

function descriptionLines(value) {
  const lines = String(value || "").split(/\r?\n/);
  const clauses = [];
  let inPickupBlock = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      inPickupBlock = false;
      continue;
    }
    const normalized = normalizeText(line);
    if (hasPhrase(normalized, ["diem don", "diem tra", "dia diem don", "dia diem tra"])) {
      inPickupBlock = true;
      continue;
    }
    if (inPickupBlock && /^[-*•]/u.test(line)) continue;
    inPickupBlock = false;
    const normalizedLine = canonicalizeAbbreviations(normalizeBase(line));
    for (const clause of normalizedLine.split(/[.!?;]+/u)) {
      if (clause.trim()) clauses.push(clause.trim());
    }
  }
  return clauses;
}

function stripDepartureOriginMentions(value) {
  return canonicalizeAbbreviations(normalizeBase(value))
    .replace(/\b(?:khoi hanh|xuat phat)\s+(?:tu|roi)\s+[^,.;:]+[,;:]?/g, " ");
}

function regionsFromDescription(value) {
  const regions = new Set();
  for (const clause of descriptionLines(value)) {
    if (isExcludedSegment(clause)) continue;
    const normalizedClause = normalizeText(clause);
    if (/\b(?:duong|tuyen duong|theo duong)\b.*\bho chi minh\b/.test(normalizedClause)) continue;
    for (const region of regionsInText(stripDepartureOriginMentions(clause))) regions.add(region);
  }
  return regions;
}

function regionsFromItineraryDay(day = {}) {
  const title = String(day.title || "");
  const description = String(day.description || "");
  let titleSegments = splitRouteSegments(title);
  const context = `${title} ${description}`;
  if (titleSegments.length > 1 && hasDepartureOriginContext(context)) titleSegments = titleSegments.slice(1);
  if (titleSegments.length > 0 && hasReturnContext(context)) titleSegments = titleSegments.slice(0, -1);
  if (titleSegments.length === 1 && hasReturnContext(context) && isExcludedSegment(description)) titleSegments = [];
  const regions = regionsFromDescription(description);
  for (const segment of titleSegments) {
    for (const region of regionsInText(segment)) regions.add(region);
  }
  return regions;
}

function isCleanLocation(value) {
  const text = String(value || "");
  const normalized = normalizeText(text);
  return text.length <= 80
    && !/\btour\b/i.test(text)
    && !/[→:]/u.test(text)
    && !/\d+\s*n\d*\s*d?/i.test(text)
    && !hasPhrase(normalized, ["khoi hanh", "don tu", "xuat phat", "tap trung"]);
}

function regionsFromTourName(value) {
  const name = String(value || "").trim();
  if (!name) return new Set();
  const colonIndex = name.indexOf(":");
  if (colonIndex < 0) return regionsFromRouteSegments(name);
  const title = name.slice(0, colonIndex);
  const regions = regionsInText(title);
  const routeRegions = regionsFromRouteSegments(name.slice(colonIndex + 1), {
    scrapedTitle: normalizeText(title).startsWith("tour "),
  });
  for (const region of routeRegions) regions.add(region);
  return regions;
}

function resolveTourRegions(tour = {}) {
  if (isForeignTourName(tour.name)) return [];
  const regions = new Set(regionsFromTourName(tour.name));
  if (isCleanLocation(tour.location)) {
    for (const region of regionsInText(tour.location)) regions.add(region);
  }
  for (const day of tour.itinerary || []) {
    for (const region of regionsFromItineraryDay(day)) regions.add(region);
  }
  if (regions.size === 0) {
    for (const source of [tour.summary, tour.description]) {
      for (const region of regionsFromTourName(source)) regions.add(region);
    }
  }
  return REGION_ORDER.filter((region) => regions.has(region));
}

module.exports = { REGION_ORDER, resolveTourRegions, isForeignTourName };
