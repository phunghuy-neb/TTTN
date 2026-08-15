const { generateChatReply } = require("../config/gemini");
const { getRagContext, findMentionedTours } = require("./ragService");
const {
  ACTIONS,
  prepareActionTurn,
  decideAction,
  pendingClarificationFromDecision,
  clarificationReply,
} = require("./actionPolicyService");
const {
  constraintsFromPageContext,
  mergeConstraintState,
  buildRecommendationItems,
  buildRecommendationReply,
  buildZeroResultReply,
  buildComparison,
  buildComparisonReply,
  buildAvailabilityReply,
  buildTourDetail,
  collectEntityMemory,
  resolveEntityIds,
  uniqueIds,
  normalizeText,
  getAccommodation,
  getEffectiveConstraintState,
} = require("./travelAdvisorService");
const {
  buildTourFactualContext,
  buildGroundingContract,
  groundingForTour,
  localIsoDate,
} = require("./factualGroundingService");
const {
  semanticPhraseMatch,
  tourEvidenceText,
} = require("./retrievalEvidenceService");
const {
  ERROR_CODES,
  AiServiceError,
  providerError,
} = require("./aiContractService");
const {
  recordProviderSuccess,
  recordProviderFailure,
} = require("./providerHealthService");
const { buildAiObservability, normalizeAiTraceContext } = require("./aiTraceService");

const SYSTEM_INSTRUCTION = `Bạn là Trợ lý tư vấn tour của VietVoyage.
- Chỉ dùng dữ liệu tour trong phần DỮ LIỆU MONGO HIỆN TẠI. Không tự bịa giá, số ngày, lịch khởi hành, chỗ trống, khách sạn, phương tiện, chính sách hay dịch vụ bao gồm.
- Không thêm số lượng định tính, thời tiết, khí hậu hoặc tính từ mô tả có thể kiểm chứng nếu dữ liệu không nêu rõ; hãy diễn đạt ở mức trung tính từ evidence hiện có.
- Chroma chỉ tìm ứng viên; dữ liệu trong prompt này đã được tải lại từ MongoDB và là nguồn sự thật cuối cùng.
- Ưu tiên câu hỏi mới nhất. Ràng buộc hội thoại có thể được user đổi hoặc nới; sở thích đã lưu chỉ là soft preference và không được lấn át message mới.
- Không tự tạo clarification. Action và clarification đã được policy upstream quyết định; chỉ thực thi action đó. Nếu không có kết quả, nêu rõ điều kiện đang chặn theo dạng thông báo.
- Nếu thiếu dữ liệu để kết luận, nói rõ chưa có dữ liệu thay vì suy đoán.
- Chỉ tư vấn/hướng dẫn; không tuyên bố đã đặt, hủy, đổi tour, hoàn tiền hay thực hiện thanh toán.
- Trả lời bằng tiếng Việt tự nhiên, ngắn gọn, không nhắc tới RAG, Chroma, MongoDB hoặc quy trình nội bộ.`;

function normalizeInput(promptOrOptions, tourContext = null, history = [], userName = "") {
  if (promptOrOptions && typeof promptOrOptions === "object") {
    return {
      prompt: String(promptOrOptions.prompt || ""),
      tourContext: promptOrOptions.tourContext || null,
      pageContext: promptOrOptions.pageContext || {},
      constraintState: promptOrOptions.constraintState || {},
      entityState: promptOrOptions.entityState || {},
      bookingContext: promptOrOptions.bookingContext || null,
      preferenceContext: promptOrOptions.preferenceContext || null,
      history: Array.isArray(promptOrOptions.history) ? promptOrOptions.history : [],
      userName: promptOrOptions.userName || "",
      now: promptOrOptions.now ? new Date(promptOrOptions.now) : new Date(),
      traceContext: normalizeAiTraceContext(promptOrOptions.traceContext || {}),
    };
  }
  return {
    prompt: String(promptOrOptions || ""),
    tourContext,
    pageContext: tourContext?._id ? { pageType: "TOUR_DETAIL", tourId: String(tourContext._id) } : {},
    constraintState: {},
    entityState: {},
    bookingContext: null,
    preferenceContext: null,
    history: Array.isArray(history) ? history : [],
    userName,
    now: new Date(),
    traceContext: normalizeAiTraceContext(),
  };
}

function tourCards(tours = [], grounding = null) {
  return tours.slice(0, 3).map((tour) => {
    const facts = groundingForTour(grounding, tour);
    return {
      _id: String(tour._id),
      name: tour.name,
      title: tour.name,
      basePrice: Number(tour.basePrice),
      price: facts?.priceBasis?.amount ?? Number(tour.basePrice),
      priceBasis: facts?.priceBasis || { type: "base", amount: Number(tour.basePrice), departureId: null, date: null },
      departure: facts?.selectedDeparture || null,
      availability: facts?.availability || null,
      images: tour.images || [],
      image: tour.images?.[0] || "",
    };
  });
}

function nextEntityState(previous, patch = {}) {
  return {
    ...previous,
    ...patch,
    recentTourIds: uniqueIds([
      ...(patch.lastReferencedTourIds || []),
      ...(patch.lastSuggestedTourIds || []),
      ...(previous.recentTourIds || []),
    ]).slice(0, 12),
  };
}

function activeCandidateTourIds(entityState = {}) {
  const lists = Array.isArray(entityState.candidateLists) ? entityState.candidateLists : [];
  const active = lists.find((list) => list?.candidateListId === entityState.activeCandidateListId) || lists.at(-1);
  return uniqueIds(active?.tourIds || entityState.lastSuggestedTourIds || []);
}

function withDecision(result, value) {
  return {
    ...result,
    decision: value,
    intent: { ...(result.intent || {}), decision: value },
  };
}

const BOOKING_STATUS = {
  pending_payment: "chờ thanh toán",
  paid: "đã thanh toán",
  cancelled: "đã hủy",
  completed: "đã hoàn thành",
};

const PAYMENT_STATUS = {
  creating: "đang khởi tạo",
  initiated: "đang chờ hoàn tất",
  paid: "đã thanh toán",
  failed: "thất bại",
  expired: "đã hết hạn",
  review_required: "cần đối soát",
};

const PAYMENT_METHOD = {
  vnpay: "VNPay",
  momo: "MoMo",
  later: "thanh toán sau",
};

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function formatDateTime(value) {
  if (!value) return "chưa có dữ liệu";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function bookingEntityState(previous, context) {
  const resolved = uniqueIds(context.resolvedBookingIds || []);
  const listed = uniqueIds(context.listedBookingIds || []);
  return {
    ...previous,
    pendingBookingAction: null,
    ...(resolved.length ? { lastReferencedBookingIds: resolved } : {}),
    ...(listed.length ? { lastListedBookingIds: listed } : {}),
    recentBookingIds: uniqueIds([
      ...resolved,
      ...listed,
      ...(previous.recentBookingIds || []),
    ]).slice(0, 12),
  };
}

function bookingSummary(booking) {
  return {
    bookingId: booking.bookingId,
    bookingCode: booking.bookingCode,
    tourId: booking.tourId,
    tourName: booking.tourName,
    departureDate: booking.departureDate,
    guests: booking.guests,
    totalPrice: booking.totalPrice,
    status: booking.status,
    payment: booking.payment,
    detailPath: booking.detailPath,
    paymentPath: booking.paymentPath,
  };
}

function buildBookingDetailReply(booking) {
  return [
    `Đơn **${booking.bookingCode}** là tour **${booking.tourName}**.`,
    `- Khởi hành: ${formatDateTime(booking.departureDate)}`,
    `- Số khách: ${booking.guests}`,
    `- Tổng tiền: ${formatMoney(booking.totalPrice)}${booking.discountAmount ? ` (đã giảm ${formatMoney(booking.discountAmount)})` : ""}`,
    `- Trạng thái: ${BOOKING_STATUS[booking.status] || booking.status}`,
  ].join("\n");
}

function buildBookingListReply(bookings, label) {
  if (!bookings.length) return `Mình không tìm thấy booking nào${label ? ` trong ${label}` : ""} thuộc tài khoản của bạn.`;
  const lines = [`Các booking${label ? ` ${label}` : ""} của bạn:`];
  bookings.forEach((booking, index) => {
    lines.push(`${index + 1}. **${booking.tourName}** — mã ${booking.bookingCode}, khởi hành ${formatDateTime(booking.departureDate)}, ${BOOKING_STATUS[booking.status] || booking.status}.`);
  });
  return lines.join("\n");
}

function buildPaymentReply(booking) {
  const payment = booking.payment || {};
  const lines = [`Thanh toán của đơn **${booking.bookingCode}** (${booking.tourName}):`];
  if (payment.paid) {
    lines.push(`- Trạng thái: đã thanh toán ${formatMoney(payment.amountPaid)}${payment.paidAt ? ` lúc ${formatDateTime(payment.paidAt)}` : ""}.`);
  } else if (payment.payable) {
    lines.push(`- Trạng thái: chưa thanh toán; số tiền còn phải trả là ${formatMoney(payment.amountDue)}.`);
  } else {
    lines.push(`- Trạng thái booking hiện là ${BOOKING_STATUS[payment.bookingStatus] || payment.bookingStatus}; dữ liệu không ghi nhận khoản đang cần thanh toán.`);
  }
  lines.push(`- Phương thức: ${PAYMENT_METHOD[payment.paymentMethod] || payment.paymentMethod || "chưa có dữ liệu"}.`);
  if (payment.latestAttempt) {
    const attempt = payment.latestAttempt;
    lines.push(`- Giao dịch gần nhất: ${PAYMENT_STATUS[attempt.status] || attempt.status}, ${formatMoney(attempt.amount)} qua ${PAYMENT_METHOD[attempt.provider] || attempt.provider}.`);
    if (attempt.responseCode) lines.push(`- Mã phản hồi cổng thanh toán: ${attempt.responseCode}.`);
  } else {
    lines.push("- Chưa có payment attempt nào được lưu cho booking này.");
  }
  return lines.join("\n");
}

function guidanceActionReply(booking, actionType) {
  const actions = {
    cancel: {
      intro: "Mình không thể hủy booking thay bạn.",
      guide: booking.status === "pending_payment"
        ? `Bạn mở chi tiết đơn và dùng nút hủy tại ${booking.detailPath}. Chính sách hiện có: ${booking.cancellationPolicy || "chưa có nội dung chi tiết trong dữ liệu tour"}.`
        : `Đơn đang ở trạng thái ${BOOKING_STATUS[booking.status] || booking.status}, nên giao diện không cho tự hủy như đơn chờ thanh toán. Bạn mở ${booking.detailPath} để kiểm tra và liên hệ hỗ trợ nếu cần.`,
    },
    pay: {
      intro: "Mình không thể thực hiện thanh toán thay bạn.",
      guide: booking.paymentPath ? `Bạn có thể tiếp tục tại ${booking.paymentPath}.` : `Booking này hiện không có đường dẫn thanh toán khả dụng; hãy kiểm tra tại ${booking.detailPath}.`,
    },
    change_departure: { intro: "Mình không thể đổi ngày khởi hành thay bạn.", guide: `Bạn xem thông tin tại ${booking.detailPath} và liên hệ VietVoyage để được kiểm tra điều kiện đổi lịch.` },
    change_passengers: { intro: "Mình không thể sửa hành khách thay bạn.", guide: `Bạn mở ${booking.detailPath} và liên hệ VietVoyage để được kiểm tra trước khi thay đổi.` },
    refund: { intro: "Mình không thể tạo yêu cầu hoàn tiền hoặc refund thay bạn.", guide: `Bạn mở ${booking.detailPath}; nếu đơn đã thanh toán, hãy liên hệ VietVoyage để được kiểm tra giao dịch và chính sách.` },
    apply_voucher: { intro: "Mình không thể áp voucher vào booking thay bạn.", guide: `Voucher được áp trong luồng đặt tour; bạn có thể kiểm tra đơn tại ${booking.detailPath}.` },
  };
  const action = actions[actionType] || { intro: "Mình không thể thực hiện thay đổi booking thay bạn.", guide: `Bạn mở ${booking.detailPath} để tự thao tác hoặc liên hệ hỗ trợ.` };
  return `${action.intro} ${action.guide}`;
}

function bookingContextResult(input, intent, constraintState, rememberedEntities) {
  const context = input.bookingContext;
  if (!context?.active) return null;
  const entityState = bookingEntityState({ ...rememberedEntities, ...(context.entityState || {}) }, context);

  if (context.notFound) {
    return {
      reply: "Mình không tìm thấy booking phù hợp trong tài khoản của bạn.",
      intent: { ...intent, requestType: context.requestType },
      constraintState,
      entityState,
      referencedTourIds: [],
      referencedBookingIds: [],
      structuredContent: { type: "booking_not_found", reason: context.reason },
      tours: [],
    };
  }
  if (context.needsClarification) {
    throw new Error("Booking clarification reached execution before action policy dispatch");
  }

  const bookings = context.bookings || [];
  if (context.requestType === "booking_list") {
    const structured = { type: "upcoming_bookings", bookings: bookings.map(bookingSummary) };
    return {
      reply: buildBookingListReply(bookings, context.timeLabel),
      intent: { ...intent, requestType: context.requestType },
      constraintState,
      entityState,
      referencedTourIds: [],
      referencedBookingIds: bookings.map((booking) => booking.bookingId),
      structuredContent: structured,
      tours: [],
    };
  }

  const booking = bookings[0];
  if (!booking) return null;
  if (context.requestType === "payment_status") {
    return {
      reply: buildPaymentReply(booking),
      intent: { ...intent, requestType: context.requestType },
      constraintState,
      entityState,
      referencedTourIds: [],
      referencedBookingIds: [booking.bookingId],
      structuredContent: { type: "payment_status", booking: bookingSummary(booking) },
      tours: [],
    };
  }
  if (context.requestType === "guidance_action") {
    return {
      reply: guidanceActionReply(booking, context.actionType),
      intent: { ...intent, requestType: context.requestType },
      constraintState,
      entityState,
      referencedTourIds: [],
      referencedBookingIds: [booking.bookingId],
      structuredContent: {
        type: "booking_guidance",
        action: context.actionType,
        booking: bookingSummary(booking),
        navigationTarget: context.actionType === "pay" && booking.paymentPath ? booking.paymentPath : booking.detailPath,
      },
      tours: [],
    };
  }
  return {
    reply: buildBookingDetailReply(booking),
    intent: { ...intent, requestType: context.requestType },
    constraintState,
    entityState,
    referencedTourIds: [],
    referencedBookingIds: [booking.bookingId],
    structuredContent: { type: context.timeLabel ? "booking_summary" : "booking_detail", booking: bookingSummary(booking) },
    tours: [],
  };
}

function preferenceUpdateResult(input, intent, constraintState, rememberedEntities) {
  const update = input.preferenceContext?.update;
  if (!update?.active || !update.commandOnly) return null;
  const changed = Boolean(update.hasChanges);
  const reply = changed
    ? update.forget
      ? "Mình đã quên sở thích đó trong hồ sơ tư vấn dài hạn của bạn."
      : "Mình đã cập nhật sở thích dài hạn của bạn và sẽ dùng nó như tín hiệu ưu tiên khi tư vấn các chuyến sau."
    : "Mình chỉ lưu sở thích khi bạn nói đủ rõ điều cần ghi nhớ hoặc quên; câu này chưa làm thay đổi hồ sơ của bạn.";
  return {
    reply,
    intent: { ...intent, requestType: "preference_update" },
    constraintState,
    entityState: rememberedEntities,
    referencedTourIds: [],
    referencedBookingIds: [],
    structuredContent: { type: "preference_update", updated: changed, forgotten: Boolean(update.forget) },
    tours: [],
  };
}

function buildGenerationPrompt({ prompt, contextText, history, userName, constraintState, decision }) {
  const recentUserTurns = history
    .filter((item) => item?.role === "user" && item.content)
    .slice(-4)
    .map((item) => String(item.content).slice(0, 500));
  const historyText = recentUserTurns.length
    ? recentUserTurns.map((content) => `Khách: ${content}`).join("\n")
    : "(Chưa có lịch sử hội thoại)";
  return `THỨ TỰ ƯU TIÊN:\n1. Action policy đã quyết định: ${decision?.action || "ANSWER"}. Không được đổi action hoặc tự tạo clarification.\n2. Câu hỏi mới nhất.\n3. Entity/page hiện tại đã được backend xác minh trong dữ liệu.\n4. Ràng buộc hội thoại hiện tại.\n5. Các user turn gần đây chỉ để hiểu cách nói; không dùng chúng làm nguồn fact.\n\nDỮ LIỆU MONGO HIỆN TẠI:\n${contextText}\n\nRÀNG BUỘC ĐÃ GHI NHẬN:\n${JSON.stringify(constraintState)}\n\nTên khách: ${userName || "khách"}\nCác user turn gần đây:\n${historyText}\n\nCâu hỏi mới: "${prompt}"\n\nTrả lời trực tiếp câu hỏi mới nhất. Mọi fact cụ thể chỉ được lấy từ DỮ LIỆU MONGO HIỆN TẠI. Không thêm số lượng ước lệ, thời tiết/khí hậu hoặc tính từ mô tả nếu evidence của đúng tour không hỗ trợ.`;
}

function useRecentSuggestionsForGeneral(prompt, entityState) {
  const normalized = String(prompt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  return entityState.lastSuggestedTourIds?.length && /(?:2|3|hai|ba|cac|may|loat)\s*tour|tour vua (?:goi y|noi|xem|ke)|nhung tour|danh sach vua/.test(normalized);
}

function isSiteLevelQuestion(prompt) {
  const normalized = normalizeText(prompt);
  return /\bvietvoyage\b/.test(normalized) && /(?:co gi noi bat|gioi thieu|la gi|lam duoc gi|ho tro gi)/.test(normalized);
}

function siteLevelReply() {
  return "VietVoyage hỗ trợ bạn tìm và so sánh tour, kiểm tra thông tin tour đang có trong hệ thống, đồng thời tra cứu booking và thanh toán thuộc tài khoản của bạn. Bạn muốn mình hỗ trợ tìm tour hay kiểm tra một chuyến đã đặt?";
}

function conversationalReply(prompt) {
  const normalized = normalizeText(prompt).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const greetingPattern = /^(?:(?:xin )?chao|hello|hi|hey|alo)(?: ban| vietvoyage| tro ly)?(?: nhe| nha| a| ah| oi)?(?: |$)/;
  const hasGreeting = greetingPattern.test(normalized);
  const afterGreeting = hasGreeting ? normalized.replace(greetingPattern, "").trim() : normalized;
  if (hasGreeting && !afterGreeting) {
    return { kind: "greeting", reply: "Xin chào! Mình là Trợ lý VietVoyage. Mình có thể hỗ trợ khi bạn cần tìm tour hoặc tra cứu chuyến đi của mình." };
  }
  if (/^(?:(?:hom nay|dao nay) )?(?:ban|tro ly) (?:co )?khoe khong(?: vay)?$|^khoe khong(?: ban)?$/.test(afterGreeting)) {
    return { kind: "chitchat", reply: "Mình khỏe và sẵn sàng hỗ trợ bạn. Khi cần tư vấn tour hoặc kiểm tra chuyến đã đặt, bạn cứ nói nhé!" };
  }
  if (/^(?:cam on|thank you|thanks)(?: ban| vietvoyage| tro ly)?(?: rat nhieu| nhieu| nhe| nha| a)?$/.test(normalized)) {
    return { kind: "acknowledgement", reply: "Không có gì nhé! Khi cần hỗ trợ thêm về tour hoặc chuyến đã đặt, bạn cứ nhắn mình." };
  }
  if (/^(?:ban|tro ly|tro ly vietvoyage) la ai(?: vay)?$/.test(normalized)) {
    return { kind: "identity", reply: "Mình là Trợ lý VietVoyage, hỗ trợ bạn tư vấn tour và tra cứu thông tin chuyến đi trên VietVoyage." };
  }
  if (/^(?:ban|tro ly|tro ly vietvoyage) (?:(?:co the )?(?:giup|ho tro|lam) (?:duoc )?gi|giup duoc gi)(?: cho toi)?$/.test(normalized)) {
    return { kind: "capabilities", reply: "Mình có thể giúp bạn tìm và so sánh tour, kiểm tra thông tin tour, hoặc tra cứu booking và thanh toán thuộc tài khoản của bạn." };
  }
  return null;
}

function referencesTourQuestion(prompt) {
  const normalized = normalizeText(prompt);
  return /\b(?:tour|hanh trinh)\b/.test(normalized);
}

async function generateWithProvider(input, contextText) {
  const reply = await generateChatReply(
    buildGenerationPrompt({ ...input, contextText }),
    SYSTEM_INSTRUCTION
  );
  if (!String(reply || "").trim()) {
    throw new AiServiceError(ERROR_CODES.AI_RESPONSE_INVALID, "Gemini returned an empty reply", {
      status: 502,
      source: "gemini",
      retryable: true,
    });
  }
  return String(reply).trim();
}

function providerFallbackReply({ prompt, tours, hasVerifiedTourContext, grounding = null }) {
  if (isSiteLevelQuestion(prompt)) return siteLevelReply();
  if (!hasVerifiedTourContext && !referencesTourQuestion(prompt)) {
    return "Mình chưa thể trả lời chắc chắn câu hỏi chung này lúc này. Bạn có thể hỏi cụ thể về tour, lịch khởi hành, booking hoặc thanh toán để mình kiểm tra từ dữ liệu hiện có.";
  }
  const selected = tours.slice(0, 6);
  if (!selected.length) return null;
  const lines = selected.map((tour) => {
    const facts = groundingForTour(grounding, tour);
    if (!facts || !tour?.name) return null;
    const evidence = [];
    if (Number.isFinite(Number(facts.durationDays))) evidence.push(`${facts.durationDays} ngày`);
    if (facts.priceBasis?.amount !== null && facts.priceBasis?.amount !== undefined) {
      evidence.push(`${Number(facts.priceBasis.amount).toLocaleString("vi-VN")}đ theo dữ liệu giá đã xác minh`);
    }
    if (facts.availability) {
      evidence.push(facts.availability.availableForParty
        ? `còn ${facts.availability.remainingSlots} chỗ, đủ cho ${facts.partySize} người`
        : `còn ${facts.availability.remainingSlots} chỗ, không đủ cho ${facts.partySize} người`);
    }
    return evidence.length ? `- **${tour.name}**: ${evidence.join("; ")}.` : null;
  });
  if (lines.some((line) => !line)) return null;
  return `Nhà cung cấp AI đang tạm gián đoạn, nhưng mình vẫn giữ nguyên tập tour và dữ liệu đã xác minh:\n${lines.join("\n")}`;
}

function groundedTourFacts(tours = [], grounding = null) {
  return tours.slice(0, 3).map((tour) => {
    const facts = groundingForTour(grounding, tour);
    return {
      tourId: String(tour._id),
      name: tour.name,
      price: facts?.priceBasis?.amount ?? Number(tour.basePrice),
      ...(facts ? { priceBasis: facts.priceBasis, availability: facts.availability } : {}),
      duration: Number(tour.days),
      highlights: (tour.highlights || []).slice(0, 4),
    };
  });
}

function textList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
}

function replySegments(reply) {
  return String(reply || "")
    .split(/[\n!?]+|[.;](?=\s|$)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function namedContexts(segment, contexts) {
  const normalized = normalizeText(segment);
  const matches = contexts
    .map((context, index) => ({
      context,
      index,
      position: normalized.indexOf(normalizeText(context.name)),
    }))
    .filter((item) => item.position >= 0);
  for (const match of normalized.matchAll(/\btour\s+([1-9])\b/g)) {
    const index = Number(match[1]) - 1;
    if (contexts[index] && !matches.some((item) => item.context.tourId === contexts[index].tourId)) {
      matches.push({ context: contexts[index], index, position: match.index });
    }
  }
  return matches.sort((left, right) => left.position - right.position);
}

function departureDateAliases(departure) {
  if (!departure?.dateIso) return [];
  const [year, month, day] = departure.dateIso.split("-").map(Number);
  return [
    departure.dateIso,
    `${day}/${month}/${year}`,
    `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
    `${day}/${month}`,
    `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
  ];
}

function departureMentionedIn(segment, context) {
  const normalized = normalizeText(segment);
  return context.departures.find((departure) =>
    departureDateAliases(departure).some((alias) => normalized.includes(normalizeText(alias)))
  ) || null;
}

function moneyMatches(normalized) {
  const matches = [];
  const pattern = /(\d+(?:[.,]\d+)?)\s*(trieu|tr|m|k)\b|([\d.]+)\s*(d|dong)\b/g;
  for (const match of normalized.matchAll(pattern)) {
    let value;
    if (match[1]) {
      const raw = match[1];
      const decimal = raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : /^\d+\.\d{1,2}$/.test(raw)
          ? raw
          : raw.replace(/\./g, "");
      const number = Number(decimal);
      if (["trieu", "tr", "m"].includes(match[2])) value = Math.round(number * 1_000_000);
      else value = Math.round(number * 1_000);
    } else {
      value = Number(match[3].replace(/\./g, ""));
    }
    if (Number.isFinite(value)) matches.push({ value, index: match.index, raw: match[0] });
  }
  return matches;
}

function contextForFact(segment, contexts, previousContext = null) {
  const named = namedContexts(segment, contexts);
  if (named.length === 1) return named[0].context;
  if (named.length > 1) return null;
  if (contexts.length === 1) return contexts[0];
  return previousContext;
}

function tourForContext(tours, context) {
  return tours.find((tour) => String(tour._id) === context?.tourId) || null;
}

function supportedPrice(context, segment, amount) {
  if (context.priceBasis.type === "departure") return context.priceBasis.amount === amount;
  if (context.priceBasis.type === "base" && context.priceBasis.amount === amount) return true;
  const departure = departureMentionedIn(segment, context);
  return Boolean(departure && departure.price === amount);
}

function departureForClaim(context, segment, tour) {
  if (!context) return null;
  const grounded = departureMentionedIn(segment, context) || context.selectedDeparture || (context.departures.length === 1 ? context.departures[0] : null);
  if (grounded) return grounded;
  if ((tour?.departures || []).length !== 1) return null;
  const departure = tour.departures[0];
  return {
    departureId: String(departure._id || ""),
    date: departure.date || null,
    dateIso: departure.date ? localIsoDate(departure.date) : null,
    price: Number(departure.price),
    remainingSlots: Number(departure.availableSlots || 0),
  };
}

function comparisonPair(segment, contexts) {
  const named = namedContexts(segment, contexts);
  if (named.length !== 2) return null;
  return [named[0].context, named[1].context];
}

function validateDerivedClaims(segment, contexts) {
  const normalized = normalizeText(segment);
  const pair = comparisonPair(segment, contexts);
  if (/\bre hon\b/.test(normalized)) {
    if (!pair || pair.some((context) => context.priceBasis.amount === null)) return { valid: false, reason: "unsupported_price_comparison" };
    if (!(pair[0].priceBasis.amount < pair[1].priceBasis.amount)) return { valid: false, reason: "incorrect_price_comparison" };
  }
  if (/\btiet kiem\b/.test(normalized)) {
    const delta = moneyMatches(normalized).find((match) => match.index >= normalized.indexOf("tiet kiem"));
    if (!pair || !delta || pair.some((context) => context.priceBasis.amount === null)) return { valid: false, reason: "unsupported_savings_claim" };
    if (pair[1].priceBasis.amount - pair[0].priceBasis.amount !== delta.value) return { valid: false, reason: "incorrect_savings_claim" };
  }
  if (/\bphu hop hon\b/.test(normalized)) {
    if (!pair || !pair[0].scoringEvidence.length || pair[0].fitEvidenceScore <= pair[1].fitEvidenceScore) {
      return { valid: false, reason: "unsupported_fit_superiority" };
    }
  }
  return { valid: true, reason: null };
}

const DESCRIPTIVE_CLAIM_RULES = [
  {
    type: "quantity",
    pattern: /(?:hàng\s+(?:chục|trăm|nghìn|triệu)|vô\s+số|rất\s+nhiều|không\s+đếm\s+xuể|hàng\s+loạt)(?:\s+(?:chiếc|cái|ngọn|tòa|dãy|bãi|khu|điểm))?/giu,
    supportTerm: (value) => value.replace(/\s+(?:chiếc|cái|ngọn|tòa|dãy|bãi|khu|điểm)$/iu, ""),
  },
  {
    type: "weather",
    pattern: /(?:lộng\s+gió|đầy\s+nắng|nắng\s+đẹp|mát\s+mẻ|se\s+lạnh|khí\s+hậu\s+(?:ôn\s+hòa|mát\s+mẻ|dễ\s+chịu)|trời\s+(?:trong\s+xanh|nắng\s+đẹp)|gió\s+(?:mát|mạnh))/giu,
  },
  {
    type: "modifier",
    pattern: /(?:tuyệt\s+đẹp|đẹp\s+mê\s+hồn|ngoạn\s+mục|hùng\s+vĩ|lãng\s+mạn|sôi\s+động|yên\s+bình|đẳng\s+cấp|sang\s+trọng|nổi\s+tiếng)/giu,
  },
];

const TRANSPORT_TERMS = [
  "máy bay",
  "xe du lịch",
  "xe limousine",
  "tàu hỏa",
  "tàu cao tốc",
  "du thuyền",
  "ca nô",
  "cano",
];

function groundedTourEvidence(tour) {
  return [
    tourEvidenceText(tour),
    ...textList(tour?.inclusions),
    ...textList(tour?.exclusions),
  ].filter(Boolean).join(" ");
}

function cleanRewrittenSegment(value) {
  return String(value || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

function rewriteUnsupportedDescriptiveClaims(reply, tours, contexts) {
  const pieces = String(reply || "").split(/([\n!?]+|[.;](?=\s|$))/);
  const rewrittenClaims = [];
  let previousContext = contexts.length === 1 ? contexts[0] : null;

  for (let index = 0; index < pieces.length; index += 2) {
    const segment = pieces[index];
    if (!segment?.trim()) continue;
    const named = namedContexts(segment, contexts);
    if (named.length === 1) previousContext = named[0].context;
    const context = contextForFact(segment, contexts, previousContext);
    const tour = context && tourForContext(tours, context);
    const evidence = tour ? groundedTourEvidence(tour) : "";
    let rewritten = segment;

    for (const rule of DESCRIPTIVE_CLAIM_RULES) {
      rewritten = rewritten.replace(rule.pattern, (claim) => {
        const supportTerm = rule.supportTerm ? rule.supportTerm(claim) : claim;
        if (evidence && semanticPhraseMatch(evidence, supportTerm)) return claim;
        rewrittenClaims.push({
          type: rule.type,
          original: claim,
          tourId: context?.tourId || null,
        });
        return "";
      });
    }
    pieces[index] = cleanRewrittenSegment(rewritten);
  }

  return {
    reply: cleanRewrittenSegment(pieces.join("")),
    rewrittenClaims,
  };
}

function validateGeneratedReply(reply, toursOrGrounding = [], options = {}) {
  const tours = Array.isArray(toursOrGrounding) ? toursOrGrounding : (options.tours || []);
  const grounding = !Array.isArray(toursOrGrounding) && toursOrGrounding?.byTourId
    ? toursOrGrounding
    : options.grounding || buildGroundingContract(tours, options.constraints || {}, { now: options.now });
  const contexts = grounding.tours || [];
  const descriptiveValidation = rewriteUnsupportedDescriptiveClaims(reply, tours, contexts);
  const validatedReply = descriptiveValidation.reply;
  const missingLanguage = /(?:chua co|chua neu|chua xac nhan|khong co thong tin|chua ro|khong du du lieu)/;
  let previousContext = contexts.length === 1 ? contexts[0] : null;

  for (const segment of replySegments(validatedReply)) {
    const normalized = normalizeText(segment);
    const named = namedContexts(segment, contexts);
    if (named.length === 1) previousContext = named[0].context;
    const derivedValidation = validateDerivedClaims(segment, contexts);
    if (!derivedValidation.valid) return derivedValidation;
    const context = contextForFact(segment, contexts, previousContext);

    for (const match of normalized.matchAll(/\b(\d{1,2})\s*ngay\b/g)) {
      if (!context || context.durationDays !== Number(match[1])) return { valid: false, reason: "unsupported_duration" };
    }

    const savingsIndex = normalized.indexOf("tiet kiem");
    for (const match of moneyMatches(normalized)) {
      if (savingsIndex >= 0 && match.index >= savingsIndex) continue;
      if (!context || !supportedPrice(context, segment, match.value)) return { valid: false, reason: "unsupported_price" };
    }

    for (const match of normalized.matchAll(/\b(\d+)\s*cho\b/g)) {
      const departure = departureForClaim(context, segment, tourForContext(tours, context));
      if (!departure || departure.remainingSlots !== Number(match[1])) return { valid: false, reason: "unsupported_availability" };
    }

    const enoughFor = normalized.match(/\b(khong\s+)?du\s+cho(?:\s+cho)?\s+(\d+)\s*nguoi\b/);
    if (enoughFor) {
      const departure = departureForClaim(context, segment, tourForContext(tours, context));
      if (!departure) return { valid: false, reason: "unsupported_availability" };
      const actuallyEnough = departure.remainingSlots >= Number(enoughFor[2]);
      if (Boolean(enoughFor[1]) === actuallyEnough) return { valid: false, reason: "incorrect_party_availability" };
    }

    const tour = context && tourForContext(tours, context);
    if (/khach san|luu tru/.test(normalized) && !missingLanguage.test(normalized)) {
      const accommodations = tour ? getAccommodation(tour).map(normalizeText).filter(Boolean) : [];
      if (!tour || !accommodations.some((value) => normalized.includes(value))) return { valid: false, reason: "unsupported_accommodation" };
    }
    if (/may bay|flight/.test(normalized) && !missingLanguage.test(normalized)) {
      const flightEvidence = tour && /(?:ve may bay|may bay|flight)/.test(normalizeText([
        ...textList(tour.inclusions),
        ...textList(tour.exclusions),
      ].join(" ")));
      if (!flightEvidence) return { valid: false, reason: "unsupported_flight" };
    }
    if (!missingLanguage.test(normalized)) {
      const evidenceText = tour ? groundedTourEvidence(tour) : "";
      for (const term of TRANSPORT_TERMS) {
        if (semanticPhraseMatch(segment, term) && (!tour || !semanticPhraseMatch(evidenceText, term))) {
          return { valid: false, reason: "unsupported_transport" };
        }
      }
    }
    if (/chinh sach huy|phi huy|hoan tien/.test(normalized) && !missingLanguage.test(normalized)) {
      return { valid: false, reason: "policy_requires_deterministic_response" };
    }
  }
  if (descriptiveValidation.rewrittenClaims.length) {
    return {
      valid: true,
      reason: "unsupported_descriptive_claims_rewritten",
      rewrittenReply: validatedReply,
      rewrittenClaims: descriptiveValidation.rewrittenClaims,
    };
  }
  return { valid: true, reason: null };
}

async function hydrateResolvedTours(prompt, ids, commonOptions) {
  if (!ids.length) return [];
  const { tours } = await getRagContext(prompt, {
    ...commonOptions,
    directTourIds: ids,
    skipChroma: true,
  });
  return tours;
}

function hasTourNameSignal(prompt) {
  const stopWords = new Set([
    "tour", "cai", "nay", "do", "kia", "thu", "so", "dau", "tien", "mot", "hai", "ba", "vua", "noi", "xem", "ke", "luc", "truoc", "roi", "danh", "sach", "the", "nao", "khong", "co", "voi", "hon", "sao", "thi",
    "khach", "san", "luu", "tru", "bao", "gom", "lich", "trinh", "ngay", "gia", "con", "cho", "may", "bay", "sanh", "phu", "hop", "hay", "chinh", "sach", "quy", "dinh", "huy", "phi", "dieu", "kien",
  ]);
  return normalizeText(prompt)
    .split(/[^a-z0-9]+/)
    .some((word) => word.length >= 3 && /[a-z]/.test(word) && !stopWords.has(word));
}

function hasExplicitGeneralTourLookupSignal(prompt) {
  const normalized = normalizeText(prompt);
  if (!/\btour\b/.test(normalized) || !hasTourNameSignal(prompt)) return false;
  return !/(?:tour|hanh trinh) (?:nay|do|kia|vua noi|vua goi y|vua xem|vua ke|luc nay)|(?:cac|nhung|may|loat) tour/.test(normalized);
}

function buildMixedTourFacts(tour, requestedFacts = [], message = "", now = new Date(), constraints = {}) {
  const facts = [];
  const sections = [];
  const factual = buildTourFactualContext(tour, constraints, { now });

  if (requestedFacts.includes("availability")) {
    const departures = factual.departures.slice(0, 4);
    sections.push(departures.length
      ? `Tình trạng chỗ gần nhất của tour **${tour.name}**: ${departures.map((departure) => `${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(departure.date))} — ${departure.availableForParty ? `còn ${departure.remainingSlots} chỗ, đủ cho ${factual.partySize} người` : `còn ${departure.remainingSlots} chỗ nhưng không đủ cho ${factual.partySize} người`}`).join("; ")}.`
      : `Tour **${tour.name}** chưa có đợt khởi hành sắp tới trong dữ liệu hiện tại.`);
    facts.push({
      kind: "availability",
      departures: departures.map((departure) => ({
        departureId: String(departure._id || ""),
        date: departure.date,
        availableSlots: departure.remainingSlots,
        remainingSlots: departure.remainingSlots,
        totalSlots: departure.totalSlots,
        partySize: factual.partySize,
        availableForParty: departure.availableForParty,
        shortfall: departure.shortfall,
      })),
    });
  }

  if (requestedFacts.includes("cancellation_policy")) {
    sections.push(tour.cancellationPolicy
      ? `Chính sách hủy hiện có: ${tour.cancellationPolicy}`
      : `Dữ liệu hiện tại của tour **${tour.name}** chưa có chính sách hủy cụ thể.`);
    facts.push({ kind: "cancellation_policy", value: tour.cancellationPolicy || null });
  }

  if (requestedFacts.includes("price")) {
    if (factual.priceBasis.amount === null) {
      sections.push(`Dữ liệu hiện tại chưa có departure phù hợp để xác nhận giá tour **${tour.name}** vào ngày bạn hỏi.`);
    } else {
      const basisLabel = factual.priceBasis.type === "departure" ? `cho đợt ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(factual.priceBasis.date))}` : "ở mức giá cơ bản hiện tại";
      sections.push(`Giá tour **${tour.name}** ${basisLabel} là ${Number(factual.priceBasis.amount).toLocaleString("vi-VN")}đ.`);
    }
    facts.push({ kind: "price", value: factual.priceBasis.amount, priceBasis: factual.priceBasis });
  }

  if (requestedFacts.includes("duration")) {
    sections.push(`Tour **${tour.name}** có thời lượng ${Number(tour.days || 0)} ngày.`);
    facts.push({ kind: "duration", value: Number(tour.days || 0) });
  }

  if (requestedFacts.includes("tour_detail")) {
    const detail = buildTourDetail(tour, message, now, constraints);
    sections.push(detail.reply);
    facts.push({ kind: "tour_detail", value: detail.structuredContent });
  }

  return {
    reply: sections.join("\n\n"),
    structuredContent: {
      type: "mixed_tour_facts",
      tourId: String(tour._id),
      name: tour.name,
      requestedFacts,
      facts,
      factualFingerprint: factual.fingerprint,
    },
  };
}

async function generateChatAnswer(promptOrOptions, tourContext = null, history = [], userName = "") {
  const input = normalizeInput(promptOrOptions, tourContext, history, userName);
  const pageDelta = constraintsFromPageContext(input.pageContext, input.constraintState, input.now);
  const stateWithPage = Object.keys(pageDelta).length
    ? mergeConstraintState(input.constraintState, pageDelta)
    : input.constraintState;
  const rememberedEntities = collectEntityMemory(input.history, input.entityState);
  const preferenceCommandOnly = Boolean(input.preferenceContext?.update?.active && input.preferenceContext.update.commandOnly);
  const prepared = prepareActionTurn({
    message: input.prompt,
    constraintState: stateWithPage,
    entityState: rememberedEntities,
    pageContext: input.pageContext,
    now: input.now,
  });
  let ragTrace = null;
  let validationResult = { status: "not_required", reason: null };
  const finalize = (result, value) => {
    const decided = withDecision(result, value);
    return {
      ...decided,
      observability: buildAiObservability({
        traceContext: input.traceContext,
        previousSemanticState: input.constraintState,
        pageDelta,
        extractedDelta: prepared.extractedDelta,
        mergedSemanticState: decided.constraintState,
        decision: value,
        pendingClarification: decided.entityState?.pendingClarification || null,
        ragTrace,
        providerStatus: decided.providerStatus,
        validationResult,
        result: decided,
      }),
    };
  };

  if (preferenceCommandOnly) {
    prepared.constraintState = stateWithPage;
    prepared.intent = { ...prepared.intent, constraintState: stateWithPage };
  }

  const intent = prepared.intent;
  const requestType = intent.requestType;
  const conversation = requestType === "general" ? conversationalReply(input.prompt) : null;
  const constraintState = preferenceCommandOnly || conversation ? stateWithPage : prepared.constraintState;
  const siteLevel = requestType === "general" && isSiteLevelQuestion(input.prompt);
  const explicitGeneralTourLookup = ["general", "tour_detail"].includes(requestType)
    && !prepared.tourReferenceSignal
    && hasExplicitGeneralTourLookupSignal(input.prompt);
  const generalEntityQuestion = requestType === "general" && Boolean(intent.entityEvaluation);
  const needsTourEvidence = !input.bookingContext?.active && !preferenceCommandOnly && !conversation && !siteLevel;
  const mentionedTours = needsTourEvidence && ((["tour_detail", "availability", "comparison"].includes(requestType) && hasTourNameSignal(input.prompt)) || explicitGeneralTourLookup || generalEntityQuestion)
    ? await findMentionedTours(input.prompt)
    : [];
  const mentionedTourIds = mentionedTours.map((tour) => String(tour._id));
  const commonOptions = {
    tourContext: input.tourContext,
    pageContext: input.pageContext,
    constraintState,
    entityState: prepared.entityState,
    intent,
    requestType,
    now: input.now,
    preferenceContext: input.preferenceContext,
    ...(intent.alternativeResults ? {
      alternativeResults: true,
      excludeTourIds: activeCandidateTourIds(prepared.entityState),
    } : {}),
  };

  let resolution = null;
  let ambiguousTours = [];
  let resolvedTours = [];
  if (needsTourEvidence && ["tour_detail", "availability", "comparison"].includes(requestType)) {
    resolution = resolveEntityIds({
      message: input.prompt,
      requestType,
      pageContext: input.pageContext,
      entityState: prepared.entityState,
      mentionedTourIds,
    });
    if (resolution.needsClarification && resolution.ambiguousIds?.length) {
      ambiguousTours = await hydrateResolvedTours(input.prompt, resolution.ambiguousIds, {
        ...commonOptions,
        requestType: "comparison",
      });
    }
    if (resolution.ids?.length) {
      resolvedTours = await hydrateResolvedTours(input.prompt, resolution.ids, commonOptions);
    }
    if (resolution.ids?.length === 1 && resolvedTours.length === 1) {
      const selectedTourId = String(resolvedTours[0]._id);
      const selectedCandidateListId = resolution?.candidateListId ||
        (String(prepared.entityState?.selectedTourId || prepared.entityState?.currentTourId || "") === selectedTourId
          ? prepared.entityState?.selectedCandidateListId || null
          : null);
      const pendingEntitySelection = prepared.entityState?.pendingClarification?.slot === "entity.tour_selection";
      prepared.entityState = nextEntityState(prepared.entityState, {
        ...(pendingEntitySelection ? { pendingAction: null, pendingClarification: null } : {}),
        selectedTourId,
        currentTourId: selectedTourId,
        selectedCandidateListId,
        lastReferencedTourIds: [selectedTourId],
      });
      if (pendingEntitySelection) {
        prepared.pendingResolution = {
          ...(prepared.pendingResolution || {}),
          attempted: true,
          resolved: true,
          entityState: prepared.entityState,
          selectedTourIds: [selectedTourId],
          resolution: { slot: "entity.tour_selection", value: selectedTourId },
        };
      }
    }
  }

  const value = decideAction({
    prepared: { ...prepared, constraintState, intent: { ...intent, constraintState } },
    bookingContext: input.bookingContext,
    preferenceCommandOnly,
    conversation,
    siteLevel,
    explicitGeneralTourLookup,
    mentionedTourIds,
    entityResolution: resolution,
    resolvedTourIds: resolvedTours.map((tour) => String(tour._id)),
  });

  if (value.action === ACTIONS.CLARIFY) {
    const pendingClarification = pendingClarificationFromDecision(value);
    const bookingEntities = input.bookingContext?.active
      ? bookingEntityState({ ...prepared.entityState, ...(input.bookingContext.entityState || {}) }, input.bookingContext)
      : prepared.entityState;
    const entityPatch = {
      pendingAction: value.operation,
      pendingClarification,
      lastRequestType: requestType,
    };
    if (value.clarification?.slot === "entity.tour_selection") {
      entityPatch.ambiguousTourIds = uniqueIds(value.clarification.candidateTourIds || []);
    }
    return finalize({
      reply: clarificationReply(value, {
        candidateTours: ambiguousTours,
        candidateBookings: input.bookingContext?.bookings || [],
        tour: resolvedTours[0] || null,
      }),
      intent,
      constraintState,
      entityState: nextEntityState(bookingEntities, entityPatch),
      referencedTourIds: resolvedTours.map((tour) => String(tour._id)),
      referencedBookingIds: [],
      structuredContent: {
        type: "clarification",
        missingFor: value.clarification.slot.startsWith("entity.")
          ? "entity"
          : value.clarification.slot === "trip.date"
            ? "date"
            : "recommendation",
        slot: value.clarification.slot,
        clarificationType: value.clarification.type,
        allowedAnswerKinds: value.clarification.allowedAnswerKinds,
        reason: value.reason,
        candidateTourIds: value.clarification.candidateTourIds || [],
        candidateBookingIds: value.clarification.candidateBookingIds || [],
      },
      tours: [],
    }, value);
  }

  if (value.action === ACTIONS.ERROR) {
    return finalize({
      reply: "Mình không thể xác minh tour đang được nhắc tới trong dữ liệu published/active hiện tại.",
      intent,
      constraintState,
      entityState: nextEntityState(prepared.entityState, {
        pendingAction: null,
        pendingClarification: null,
        lastRequestType: requestType,
      }),
      referencedTourIds: resolvedTours.map((tour) => String(tour._id)),
      referencedBookingIds: [],
      structuredContent: { type: "action_error", reason: value.reason },
      tours: [],
    }, value);
  }

  if (input.bookingContext?.active) {
    const result = bookingContextResult(input, intent, constraintState, prepared.entityState);
    if (result) return finalize(result, value);
  }

  if (preferenceCommandOnly) {
    return finalize(preferenceUpdateResult(input, intent, constraintState, prepared.entityState), value);
  }

  if (siteLevel) {
    return finalize({
      reply: siteLevelReply(),
      intent,
      constraintState,
      entityState: nextEntityState(prepared.entityState, {
        pendingAction: null,
        pendingClarification: null,
        lastRequestType: requestType,
      }),
      referencedTourIds: [],
      referencedBookingIds: [],
      structuredContent: { type: "grounded_answer", scope: "site", tours: [] },
      tours: [],
    }, value);
  }

  if (conversation) {
    return finalize({
      reply: conversation.reply,
      intent,
      constraintState,
      entityState: nextEntityState(prepared.entityState, {
        pendingAction: null,
        pendingClarification: null,
        lastRequestType: requestType,
      }),
      referencedTourIds: [],
      referencedBookingIds: [],
      structuredContent: { type: "grounded_answer", scope: "assistant", kind: conversation.kind, tours: [] },
      tours: [],
    }, value);
  }

  if (["tour_detail", "availability", "comparison"].includes(requestType)) {
    const resolvedIds = resolvedTours.map((tour) => String(tour._id));
    const selectedCandidateListId = resolvedIds.length === 1
      ? resolution?.candidateListId ||
        (String(prepared.entityState?.selectedTourId || prepared.entityState?.currentTourId || "") === resolvedIds[0]
          ? prepared.entityState?.selectedCandidateListId || null
          : null)
      : null;
    const factualConstraints = getEffectiveConstraintState(constraintState);
    const resolvedGrounding = buildGroundingContract(resolvedTours, factualConstraints, { now: input.now });
    const entityStateBase = nextEntityState(prepared.entityState, {
      pendingAction: null,
      pendingClarification: null,
      lastRequestType: requestType,
      lastReferencedTourIds: resolvedIds,
      ...(resolvedIds.length === 1 ? {
        selectedTourId: resolvedIds[0],
        currentTourId: resolvedIds[0],
        selectedCandidateListId,
      } : {}),
    });

    if (requestType === "comparison") {
      const comparison = buildComparison(resolvedTours, factualConstraints, { grounding: resolvedGrounding, now: input.now });
      return finalize({
        reply: buildComparisonReply(comparison),
        intent,
        constraintState,
        entityState: entityStateBase,
        referencedTourIds: resolvedIds,
        referencedBookingIds: [],
        structuredContent: comparison,
        tours: tourCards(resolvedTours, resolvedGrounding),
      }, value);
    }

    const tour = resolvedTours[0];
    if (value.operation === "mixed_tour_facts") {
      const mixed = buildMixedTourFacts(tour, intent.requestedFacts, input.prompt, input.now, factualConstraints);
      return finalize({
        reply: mixed.reply,
        intent,
        constraintState,
        entityState: entityStateBase,
        referencedTourIds: resolvedIds,
        referencedBookingIds: [],
        structuredContent: mixed.structuredContent,
        tours: [],
      }, value);
    }

    if (requestType === "availability") {
      const factual = groundingForTour(resolvedGrounding, tour) || buildTourFactualContext(tour, constraintState, { now: input.now });
      const departures = factual.departures;
      return finalize({
        reply: buildAvailabilityReply(tour, factualConstraints.dateRange, departures, factual.partySize),
        intent,
        constraintState,
        entityState: entityStateBase,
        referencedTourIds: resolvedIds,
        referencedBookingIds: [],
        structuredContent: {
          type: "availability",
          tourId: resolvedIds[0],
          name: tour.name,
          dateRange: factualConstraints.dateRange,
          departures: departures.map((departure) => ({
            departureId: departure.departureId,
            date: departure.date,
            price: Number(departure.price),
            availableSlots: departure.remainingSlots,
            remainingSlots: departure.remainingSlots,
            totalSlots: departure.totalSlots,
            partySize: factual.partySize,
            availableForParty: departure.availableForParty,
            unavailableForParty: departure.unavailableForParty,
            shortfall: departure.shortfall,
          })),
          factualFingerprint: factual.fingerprint,
        },
        tours: [],
      }, value);
    }

    const detail = buildTourDetail(tour, input.prompt, input.now, factualConstraints);
    return finalize({
      reply: detail.reply,
      intent,
      constraintState,
      entityState: entityStateBase,
      referencedTourIds: resolvedIds,
      referencedBookingIds: [],
      structuredContent: detail.structuredContent,
      tours: [],
    }, value);
  }

  const generalDirectIds = requestType === "general"
    ? mentionedTourIds.length
      ? mentionedTourIds
      : useRecentSuggestionsForGeneral(input.prompt, prepared.entityState)
        ? prepared.entityState.lastSuggestedTourIds
        : []
    : [];
  const generalHasVerifiedEntity = requestType === "general" && Boolean(
    generalDirectIds.length || input.tourContext?._id || input.pageContext?.tourId
  );
  const isolateGeneralEntityLookup = generalEntityQuestion && mentionedTourIds.length > 0;
  const rag = await getRagContext(input.prompt, {
    ...commonOptions,
    ...(intent.entityEvaluation ? { constraintState: {} } : {}),
    ...(isolateGeneralEntityLookup ? { tourContext: null, pageContext: {} } : {}),
    ...(generalDirectIds.length ? { directTourIds: generalDirectIds } : {}),
    ...(generalHasVerifiedEntity ? { skipChroma: true } : {}),
    ...(explicitGeneralTourLookup ? { requestType: "tour_detail" } : {}),
  });
  ragTrace = rag.trace || null;

  if (value.action === ACTIONS.SEARCH) {
    if (!rag.tours.length && rag.zeroResult?.cause === "internal_retrieval_degraded") {
      throw new AiServiceError(ERROR_CODES.RAG_DEGRADED, "Retrieval is degraded without a safe candidate set", {
        status: 503,
        source: "retrieval",
        retryable: true,
      });
    }
    const effectiveConstraints = getEffectiveConstraintState(constraintState);
    const items = buildRecommendationItems(
      rag.tours,
      effectiveConstraints,
      input.now,
      input.preferenceContext?.profile || {},
      rag.factualGrounding
    );
    const ids = items.map((item) => item.tourId);
    return finalize({
      reply: items.length
        ? buildRecommendationReply(items, effectiveConstraints, { operation: value.operation })
        : buildZeroResultReply(effectiveConstraints, rag.zeroResult || {}, { operation: value.operation }),
      intent,
      constraintState,
      entityState: nextEntityState(prepared.entityState, {
        pendingAction: null,
        pendingClarification: null,
        lastRequestType: requestType,
        lastSuggestedTourIds: ids,
        lastReferencedTourIds: ids,
      }),
      referencedTourIds: ids,
      referencedBookingIds: [],
      structuredContent: {
        type: "recommendation",
        tours: items,
        ...(value.operation === "recommendation_alternative" ? { alternative: true, exhausted: !items.length } : {}),
      },
      tours: tourCards(rag.tours, rag.factualGrounding),
      retrievalStatus: rag.retrievalStatus || null,
      providerStatus: { status: "skipped", code: null, fallbackUsed: false },
      outcome: { code: items.length ? "OK" : ERROR_CODES.NO_RESULTS },
      warnings: rag.retrievalStatus?.degraded ? [ERROR_CODES.RAG_DEGRADED] : [],
    }, value);
  }

  if (!rag.tours.length) {
    if (rag.retrievalStatus?.degraded || rag.zeroResult?.cause === "internal_retrieval_degraded") {
      throw new AiServiceError(ERROR_CODES.RAG_DEGRADED, "Retrieval is degraded without safe grounded data", {
        status: 503,
        source: "retrieval",
        retryable: true,
      });
    }
    return finalize({
      reply: "Mình chưa tìm thấy dữ liệu tour đang hoạt động đủ liên quan để trả lời chắc chắn.",
      intent,
      constraintState,
      entityState: nextEntityState(prepared.entityState, {
        pendingAction: null,
        pendingClarification: null,
        lastRequestType: requestType,
      }),
      referencedTourIds: [],
      referencedBookingIds: [],
      structuredContent: {
        type: "grounded_answer",
        scope: "tour_inventory",
        dataStatus: "missing",
        tours: [],
      },
      tours: [],
      retrievalStatus: rag.retrievalStatus || null,
      providerStatus: { status: "skipped", code: null, fallbackUsed: false },
      outcome: { code: ERROR_CODES.NO_RESULTS },
      warnings: [],
    }, value);
  }

  let reply;
  let fallbackUsed = false;
  let fallbackReason = null;
  let providerStatus = { status: "healthy", code: null, fallbackUsed: false };
  const hasVerifiedTourContext = Boolean(generalHasVerifiedEntity || mentionedTourIds.length);
  const effectiveGrounding = rag.factualGrounding || buildGroundingContract(
    rag.tours,
    getEffectiveConstraintState(constraintState),
    { now: input.now }
  );
  try {
    reply = await generateWithProvider({ ...input, constraintState, decision: value }, rag.contextText);
    const validation = validateGeneratedReply(reply, rag.tours, {
      constraints: getEffectiveConstraintState(constraintState),
      grounding: effectiveGrounding,
      now: input.now,
    });
    validationResult = {
      status: validation.valid ? (validation.rewrittenReply ? "rewritten" : "accepted") : "rejected",
      reason: validation.reason || null,
      ...(validation.rewrittenClaims?.length ? { rewrittenClaims: validation.rewrittenClaims } : {}),
    };
    if (!validation.valid) {
      fallbackUsed = true;
      fallbackReason = validation.reason;
      providerStatus = { status: "degraded", code: ERROR_CODES.AI_RESPONSE_INVALID, fallbackUsed: true };
      recordProviderFailure(ERROR_CODES.AI_RESPONSE_INVALID);
      console.warn("[ai.validation.fallback]", {
        category: "unsupported_business_claim",
        reason: validation.reason,
        hydratedTourCount: rag.tours.length,
      });
      reply = providerFallbackReply({ prompt: input.prompt, tours: rag.tours, hasVerifiedTourContext, grounding: effectiveGrounding });
      if (!reply) {
        throw new AiServiceError(ERROR_CODES.AI_RESPONSE_INVALID, "Provider reply failed validation and no safe fallback exists", {
          status: 502,
          source: "gemini",
          retryable: true,
        });
      }
    } else {
      if (validation.rewrittenReply) reply = validation.rewrittenReply;
      recordProviderSuccess();
    }
  } catch (error) {
    const typedError = error instanceof AiServiceError ? error : providerError(error);
    if (validationResult.status === "not_required") {
      validationResult = { status: "provider_unavailable", reason: typedError.code };
    }
    fallbackUsed = true;
    fallbackReason = typedError.code === ERROR_CODES.AI_PROVIDER_RATE_LIMITED
      ? "provider_rate_limited"
      : typedError.code === ERROR_CODES.AI_RESPONSE_INVALID
        ? "provider_response_invalid"
        : "provider_unavailable";
    providerStatus = { status: "degraded", code: typedError.code, fallbackUsed: true };
    recordProviderFailure(typedError.code);
    const providerHttpStatus = Number(error?.status) || null;
    console.warn("[ai.generation.fallback]", {
      category: error?.code === "GEMINI_TIMEOUT" ? "timeout" : providerHttpStatus === 429 ? "quota" : "generation_error",
      errorCode: typedError.code,
      errorName: error?.name || "Error",
      providerStatus: providerHttpStatus,
      hydratedTourCount: rag.tours.length,
    });
    reply = providerFallbackReply({ prompt: input.prompt, tours: rag.tours, hasVerifiedTourContext, grounding: effectiveGrounding });
    if (!reply) throw typedError;
  }
  const exposeGroundedTours = Boolean(hasVerifiedTourContext || referencesTourQuestion(input.prompt));
  const ids = exposeGroundedTours ? rag.tours.map((tour) => String(tour._id)) : [];
  return finalize({
    reply,
    intent,
    constraintState,
    entityState: nextEntityState(prepared.entityState, {
      pendingAction: null,
      pendingClarification: null,
      lastRequestType: requestType,
      ...(ids.length ? { lastReferencedTourIds: ids } : {}),
    }),
    referencedTourIds: ids,
    referencedBookingIds: [],
    retrievalStatus: rag.retrievalStatus || null,
    providerStatus,
    outcome: { code: "OK" },
    warnings: [
      ...(rag.retrievalStatus?.degraded ? [ERROR_CODES.RAG_DEGRADED] : []),
      ...(providerStatus.status === "degraded" && providerStatus.code ? [providerStatus.code] : []),
    ],
    structuredContent: {
      type: fallbackUsed ? "grounded_fallback" : "grounded_answer",
      ...(fallbackUsed ? { reason: fallbackReason } : {}),
      tours: exposeGroundedTours ? groundedTourFacts(rag.tours, rag.factualGrounding) : [],
    },
    tours: [],
  }, value);
}

async function streamChatAnswer(promptOrOptions, onChunk, tourContext = null, history = [], userName = "") {
  const result = await generateChatAnswer(promptOrOptions, tourContext, history, userName);
  if (result.reply) onChunk(result.reply);
  return { ...result, fullReply: result.reply };
}

module.exports = {
  generateChatAnswer,
  streamChatAnswer,
  normalizeInput,
  validateGeneratedReply,
  buildGenerationPrompt,
  providerFallbackReply,
};
