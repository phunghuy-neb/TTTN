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
  extractConstraintDelta,
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
  isCancellationPolicyQuestion,
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
const { PROVIDER_FAILURE_CLASSES } = require("./providerReliabilityService");

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
  const previousSelectedTourId = String(previous?.selectedTourId || previous?.currentTourId || "");
  const nextSelectedTourId = String(patch.selectedTourId || patch.currentTourId || "");
  const selectionChanged = previousSelectedTourId
    && nextSelectedTourId
    && previousSelectedTourId !== nextSelectedTourId;
  return {
    ...previous,
    ...patch,
    ...(nextSelectedTourId ? { focusedTourId: nextSelectedTourId } : {}),
    ...(selectionChanged ? { previousSelectedTourId } : {}),
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

function historicalCandidateTourIds(entityState = {}) {
  const lists = Array.isArray(entityState.candidateLists) ? entityState.candidateLists : [];
  return uniqueIds([
    ...lists.flatMap((list) => list?.tourIds || []),
    ...(entityState.lastSuggestedTourIds || []),
  ]);
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

function isBookingLookupQuestion(prompt) {
  const normalized = normalizeText(prompt);
  return /\b(?:kiem tra|tra cuu|tim|xem)\b.{0,24}\b(?:ma dat cho|ma booking|booking)\b|\b(?:ma dat cho|ma booking)\b/.test(normalized);
}

async function generateWithProvider(input, contextText) {
  const generated = await generateChatReply(
    buildGenerationPrompt({ ...input, contextText }),
    SYSTEM_INSTRUCTION,
    { includeMetadata: true }
  );
  const reply = typeof generated === "string" ? generated : generated?.text;
  const providerMeta = typeof generated === "object" && generated?.providerMeta
    ? generated.providerMeta
    : {
      providerAttempted: true,
      providerSucceeded: true,
      attemptCount: 1,
      maxAttempts: 1,
      retryCount: 0,
      retryDelaysMs: [],
      failureClass: null,
    };
  if (!String(reply || "").trim()) {
    throw new AiServiceError(ERROR_CODES.AI_RESPONSE_INVALID, "Gemini returned an empty reply", {
      status: 502,
      source: "gemini",
      retryable: true,
      providerMeta: {
        ...providerMeta,
        failureClass: PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION,
      },
    });
  }
  return { reply: String(reply).trim(), providerMeta };
}

function deterministicProviderStatus() {
  return {
    status: "skipped",
    code: null,
    providerAttempted: false,
    providerSucceeded: false,
    attemptCount: 0,
    maxAttempts: 0,
    retryCount: 0,
    retryDelaysMs: [],
    failureClass: null,
    fallbackUsed: false,
    finalComposer: "deterministic_renderer",
    provenanceClass: "DETERMINISTIC_CONFIRMED",
  };
}

function safeProviderMeta(meta = {}, { attempted = true, succeeded = false } = {}) {
  const attemptCount = Number.isInteger(Number(meta.attemptCount))
    ? Math.max(0, Number(meta.attemptCount))
    : attempted ? 1 : 0;
  const maxAttempts = Number.isInteger(Number(meta.maxAttempts))
    ? Math.max(attemptCount, Number(meta.maxAttempts))
    : attemptCount;
  const retryDelaysMs = Array.isArray(meta.retryDelaysMs)
    ? meta.retryDelaysMs.filter((value) => Number.isFinite(Number(value)) && Number(value) >= 0).map(Number)
    : [];
  const result = {
    providerAttempted: meta.providerAttempted == null ? attempted : Boolean(meta.providerAttempted),
    providerSucceeded: meta.providerSucceeded == null ? succeeded : Boolean(meta.providerSucceeded),
    attemptCount,
    maxAttempts,
    retryCount: Number.isInteger(Number(meta.retryCount))
      ? Math.max(0, Number(meta.retryCount))
      : retryDelaysMs.length,
    retryDelaysMs,
    failureClass: meta.failureClass || null,
  };
  for (const key of [
    "retryable",
    "httpStatus",
    "providerErrorStatus",
    "retryAfterMs",
    "quotaMetric",
    "quotaId",
    "quotaLocation",
    "quotaModel",
    "quotaValue",
    "retryStoppedReason",
  ]) {
    if (meta[key] !== undefined && meta[key] !== null) result[key] = meta[key];
  }
  return result;
}

function providerStatusFrom(meta, {
  status,
  code,
  fallbackUsed,
  finalComposer,
  provenanceClass,
  failureClass,
  providerSucceeded,
}) {
  const normalized = safeProviderMeta(meta, {
    attempted: true,
    succeeded: providerSucceeded == null ? status === "healthy" : providerSucceeded,
  });
  return {
    status,
    code,
    ...normalized,
    ...(failureClass !== undefined ? { failureClass } : {}),
    ...(providerSucceeded !== undefined ? { providerSucceeded: Boolean(providerSucceeded) } : {}),
    fallbackUsed: Boolean(fallbackUsed),
    finalComposer,
    provenanceClass,
  };
}

function fallbackQuestionKind(prompt) {
  const normalized = normalizeText(prompt);
  if (/\b(?:bo qua|khong tham gia|o lai)\b.{0,64}\b(?:duoc\s+)?(?:khong|ko|k)\b/.test(normalized)
    || /\bco(?: the)?\s+(?:bo qua|khong tham gia|o lai)\b/.test(normalized)) {
    return "operational_flexibility";
  }
  if (/\b(?:phu hop|hop)\b/.test(normalized)) return "suitability";
  if (/\b(?:co gi hay|co gi noi bat|diem (?:gi |nao )?(?:noi bat|dang chu y)|dang chu y|trai nghiem gi)\b/.test(normalized)) {
    return "highlights";
  }
  return "facts";
}

function operationalFlexibilityFallbackReply(prompt, tours, questionKind) {
  if (questionKind !== "operational_flexibility" || tours.length !== 1) return null;
  const tour = tours[0];
  const stopWords = new Set([
    "co", "the", "bo", "qua", "khong", "tham", "gia", "o", "lai", "doan", "phan", "duoc", "nhe", "nha", "nay", "do", "kia",
  ]);
  const activityTokens = normalizeText(prompt)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
  const relevantDays = (tour.itinerary || []).map((day, index) => {
    const title = String(day?.title || "").replace(/\s+/g, " ").trim();
    const description = String(day?.description || "").replace(/\s+/g, " ").trim();
    const evidence = [title, description].filter(Boolean).join(" — ").replace(/[.!?]+$/, "");
    const normalizedEvidence = normalizeText(evidence);
    const score = activityTokens.filter((token) => normalizedEvidence.split(/[^a-z0-9]+/).includes(token)).length;
    return { dayNumber: Number(day?.dayNumber) || index + 1, evidence, score };
  }).filter((day) => day.evidence && day.score > 0)
    .sort((left, right) => right.score - left.score || left.dayNumber - right.dayNumber)
    .slice(0, 2);
  const evidenceText = relevantDays.length
    ? `Lịch trình đã xác minh của tour **${tour.name}** có ghi ${relevantDays.map((day) => `Ngày ${day.dayNumber}: ${day.evidence}`).join("; ")}. `
    : `Dữ liệu lịch trình hiện tại của tour **${tour.name}** không có thông tin linh hoạt cho phần hoạt động bạn hỏi. `;
  return `${evidenceText}Tuy nhiên, dữ liệu hiện tại không nêu rằng hoạt động này được phép bỏ qua hoặc thay thế. Vì vậy mình chưa thể xác nhận khả năng bỏ qua phần đó; bạn nên xác nhận trực tiếp với VietVoyage trước khi đặt.`;
}

function itineraryFallbackReply(prompt, tours, questionKind) {
  const normalized = normalizeText(prompt);
  const asksForItinerary = /\b(?:lich trinh|hanh trinh|theo tung ngay|tung ngay|theo tung phan)\b/.test(normalized);
  if (questionKind !== "suitability" && !asksForItinerary) return null;
  if (tours.length !== 1 || !Array.isArray(tours[0]?.itinerary) || !tours[0].itinerary.length) return null;
  const tour = tours[0];
  const days = tour.itinerary.slice(0, 6).map((day, index) => {
    const title = String(day?.title || "").replace(/\s+/g, " ").trim();
    const description = String(day?.description || "").replace(/\s+/g, " ").trim();
    const accommodation = String(day?.accommodation || "").replace(/\s+/g, " ").trim();
    if (!title && !description && !accommodation) return null;
    const activity = title && description ? `${title} — ${description}` : title || description;
    const details = [
      activity || "Chưa có mô tả hoạt động chi tiết trong dữ liệu hiện tại.",
      accommodation ? `Lưu trú: ${accommodation}.` : null,
    ].filter(Boolean).join(" ");
    return `- **Ngày ${Number(day?.dayNumber) || index + 1}:** ${details}`;
  }).filter(Boolean);
  if (!days.length) return null;
  const intro = questionKind === "suitability"
    ? `Mình chưa thể kết luận chắc chắn mức độ phù hợp, nhưng đây là lịch trình đã xác minh của tour **${tour.name}** để bạn đối chiếu:`
    : `Đây là lịch trình đã xác minh của tour **${tour.name}**:`;
  return `${intro}\n${days.join("\n")}`;
}

function providerFallbackReply({ prompt, tours, hasVerifiedTourContext, grounding = null }) {
  if (isSiteLevelQuestion(prompt)) return siteLevelReply();
  if (isBookingLookupQuestion(prompt) && !hasVerifiedTourContext) {
    return "Mình chưa có dữ liệu booking đã xác minh cho mã bạn hỏi, nên không thể kết luận mã đó có tồn tại hay không. Bạn hãy kiểm tra trong mục booking của tài khoản hoặc liên hệ VietVoyage để được xác minh.";
  }
  if (!hasVerifiedTourContext && !referencesTourQuestion(prompt)) {
    return "Mình chưa thể trả lời chắc chắn câu hỏi chung này lúc này. Bạn có thể hỏi cụ thể về tour, lịch khởi hành, booking hoặc thanh toán để mình kiểm tra từ dữ liệu hiện có.";
  }
  const questionKind = fallbackQuestionKind(prompt);
  const selected = tours.slice(0, 6);
  if (!selected.length) return null;
  const operationalReply = operationalFlexibilityFallbackReply(prompt, selected, questionKind);
  if (operationalReply) return operationalReply;
  const itineraryReply = itineraryFallbackReply(prompt, selected, questionKind);
  if (itineraryReply) return itineraryReply;
  const lines = selected.map((tour) => {
    const facts = groundingForTour(grounding, tour);
    if (!facts || !tour?.name) return null;
    const evidence = [];
    if (questionKind !== "facts" && Array.isArray(tour.highlights) && tour.highlights.length) {
      evidence.push(`điểm nổi bật đã ghi nhận: ${tour.highlights.filter(Boolean).slice(0, 3).join("; ")}`);
    }
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
  const intro = questionKind === "suitability"
    ? "Nhà cung cấp AI đang tạm gián đoạn nên mình chưa thể đánh giá chắc chắn mức độ phù hợp theo tiêu chí bạn vừa hỏi. Đây là dữ liệu tour đã xác minh để bạn cân nhắc:"
    : questionKind === "highlights"
      ? "Nhà cung cấp AI đang tạm gián đoạn nên mình chưa thể diễn giải đầy đủ điểm nổi bật theo câu hỏi của bạn. Đây là dữ liệu tour đã xác minh:"
      : "Nhà cung cấp AI đang tạm gián đoạn, nhưng mình vẫn giữ nguyên tập tour và dữ liệu đã xác minh:";
  return `${intro}\n${lines.join("\n")}`;
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
    type: "atmosphere",
    pattern: /(?:(?:bầu\s+)?không\s+khí|khung\s+cảnh|nhịp\s+sống)\s+(?!(?:tại|ở|quanh|trong|trên|bên|của)(?=\s|[,.;!?]|$))[\p{L}\p{N}]+(?:\s+(?!(?:tại|ở|quanh|trong|trên|bên|của|và|nhưng|là|tạo|mang|khi|với)(?=\s|[,.;!?]|$))[\p{L}\p{N}]+){0,3}(?=\s+(?:tại|ở|quanh|trong|trên|bên|của|và|nhưng|là|tạo|mang|khi|với)(?=\s|[,.;!?]|$)|[,.;!?]|$)/giu,
    dropSegmentWhenStandalone: true,
  },
  {
    type: "activity_purpose",
    pattern: /(?:(?:để|nhằm)\s+)?(?:(?:tìm\s+hiểu|khám\s+phá|trải\s+nghiệm)\s+(?:(?:quy\s+trình|cách|đời\s+sống|công\s+việc|nghề(?:\s+nghiệp)?|kỹ\s+thuật|phương\s+pháp|bí\s+quyết|hoạt\s+động)(?=\s|[,.;!?]|$))(?:\s+(?!(?:và|nhưng|tại|ở|để|nhằm)(?=\s|[,.;!?]|$))[\p{L}\p{N}]+){0,4}|học(?:\s+hỏi)?\s+(?:cách\s+)?(?!(?:tại|ở|và|nhưng)(?=\s|[,.;!?]|$))[\p{L}\p{N}]+(?:\s+(?!(?:và|nhưng|tại|ở|để|nhằm)(?=\s|[,.;!?]|$))[\p{L}\p{N}]+){0,3})(?=\s+(?:và|nhưng|tại|ở|để|nhằm)(?=\s|[,.;!?]|$)|[,.;!?]|$)/giu,
    dropSegmentWhenStandalone: true,
  },
  {
    type: "modifier",
    pattern: /(?:tuyệt\s+đẹp|đẹp\s+mê\s+hồn|ngoạn\s+mục|hùng\s+vĩ|lãng\s+mạn|sôi\s+động|yên\s+bình|đẳng\s+cấp|sang\s+trọng|nổi\s+tiếng)/giu,
  },
  {
    type: "terrain",
    pattern: /bằng\s+phẳng/giu,
  },
  {
    type: "audience_suitability",
    pattern: /(?:phù\s+hợp|thích\s+hợp|hợp|an\s+toàn|dễ\s+đi)\s+(?:với|cho)\s+(?:trẻ\s+(?:nhỏ|em|con)|gia\s+đình\s+có\s+trẻ\s+(?:nhỏ|em|con)|người\s+(?:lớn|cao)\s+tuổi|phụ\s+nữ\s+mang\s+thai|người\s+(?:khó|hạn\s+chế)\s+vận\s+động)/giu,
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
  const cleaned = String(value || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
  const emphasisMarkers = cleaned.match(/\*\*/g)?.length || 0;
  if (emphasisMarkers % 2 === 1 && /^\s*(?:[*+-]\s+)?\*\*/u.test(cleaned)) {
    return `${cleaned.trimEnd()}**`;
  }
  return cleaned;
}

function normalizeEmptyOrderedListArtifacts(reply) {
  const lines = String(reply || "").split("\n");
  const markerOnly = /^\s*\d+[.)]\s*(?:[*_~`]+\s*)*$/u;
  if (!lines.some((line) => markerOnly.test(line))) return String(reply || "");

  const kept = lines.filter((line) => !markerOnly.test(line));
  let nextNumber = 0;
  return kept.map((line) => {
    const ordered = /^(?<indent>\s*)\d+(?<marker>[.)])(?<body>\s+.+)$/u.exec(line);
    if (ordered) {
      nextNumber += 1;
      return `${ordered.groups.indent}${nextNumber}${ordered.groups.marker}${ordered.groups.body}`;
    }
    if (line.trim()) nextNumber = 0;
    return line;
  }).join("\n");
}

function descriptiveClaimIsStandalone(segment, offset) {
  const prefix = String(segment || "").slice(0, offset);
  const localPrefix = prefix.includes(":") ? prefix.slice(prefix.lastIndexOf(":") + 1) : prefix;
  const normalized = normalizeText(localPrefix)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  return /^(?:(?:ban|du khach|khach|hanh khach|nguoi tham gia)\s+)?(?:(?:se|co the|duoc)(?:\s+duoc)?)?$/.test(normalized);
}

const ACTIVITY_HEAD_SOURCE = [
  "tìm\\s+hiểu",
  "học(?:\\s+hỏi)?",
  "khám\\s+phá",
  "trải\\s+nghiệm",
  "vui\\s+chơi",
  "chụp\\s+(?:ảnh|hình)",
  "quan\\s+sát",
  "trò\\s+chuyện",
  "nghe",
  "thả",
  "tự\\s+tay\\s+làm",
  "thực\\s+hành",
  "tham\\s+gia",
  "thưởng\\s+thức",
  "mua(?:\\s+sắm)?",
  "săn",
  "ngắm",
  "check[ -]?in",
].join("|");

const DIRECT_EXPERIENTIAL_HEAD_SOURCE = [
  "tìm\\s+hiểu",
  "học(?:\\s+hỏi)?",
  "khám\\s+phá",
  "trải\\s+nghiệm",
  "vui\\s+chơi",
  "chụp\\s+(?:ảnh|hình)",
  "quan\\s+sát",
  "trò\\s+chuyện",
  "nghe",
  "thả",
  "ngắm",
  "check[ -]?in",
  "tự\\s+tay\\s+làm",
  "thực\\s+hành",
].join("|");

const ACTIVITY_EVIDENCE_STOP_WORDS = new Set([
  "ban", "du", "khach", "hanh", "nguoi", "tham", "gia", "se", "duoc", "co", "the",
  "de", "nham", "va", "roi", "sau", "truoc", "khi", "tai", "o", "trong", "tren", "ben",
  "voi", "mot", "nhung", "cac", "vao", "buoi", "ngay", "tham", "quan", "ghe", "trai",
  "nghiem", "tim", "hieu", "thuc", "te", "chup", "anh", "hinh", "mua", "lam", "qua",
  "hoat", "dong", "tu", "kham", "pha", "nghe", "noi", "chuyen", "xem", "check", "in",
]);

const ACTIVITY_SUPPORT_STOP_WORDS = new Set([
  "ban", "du", "khach", "hanh", "nguoi", "tham", "gia", "se", "duoc", "co", "the",
  "de", "nham", "va", "roi", "sau", "truoc", "khi", "tai", "o", "trong", "tren", "ben",
  "voi", "mot", "nhung", "cac", "vao", "buoi", "ngay", "tu", "diem",
]);

function evidenceUnits(tour) {
  const values = [
    tour?.name,
    tour?.location,
    tour?.region,
    ...textList(tour?.tags),
    tour?.summary,
    tour?.description,
    ...textList(tour?.highlights),
    ...(tour?.itinerary || []).flatMap((day) => [
      day?.title,
      day?.description,
      day?.accommodation,
      ...textList(day?.meals),
    ]),
    ...textList(tour?.inclusions),
    ...textList(tour?.exclusions),
  ];
  return values.flatMap((value) => replySegments(value));
}

function activityEvidenceTokens(value) {
  return new Set(
    normalizeText(value)
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !ACTIVITY_EVIDENCE_STOP_WORDS.has(token))
  );
}

function localActivityEvidence(segment, tour) {
  if (!tour) return "";
  const segmentTokens = activityEvidenceTokens(segment);
  const scored = evidenceUnits(tour).map((unit) => {
    const unitTokens = activityEvidenceTokens(unit);
    const score = [...segmentTokens].filter((token) => unitTokens.has(token)).length;
    return { unit, score };
  });
  const bestScore = Math.max(0, ...scored.map(({ score }) => score));
  if (!bestScore) return groundedTourEvidence(tour);
  return scored.filter(({ score }) => score === bestScore).map(({ unit }) => unit).join(" ");
}

function localActivityEvidenceForClaim(segment, claim, tour) {
  if (!tour) return "";
  const claimTokens = activityEvidenceTokens(claim);
  if (!claimTokens.size) return localActivityEvidence(segment, tour);
  const scored = evidenceUnits(tour).map((unit) => {
    const unitTokens = activityEvidenceTokens(unit);
    const score = [...claimTokens].filter((token) => unitTokens.has(token)).length;
    return { unit, score };
  });
  const bestScore = Math.max(0, ...scored.map(({ score }) => score));
  if (!bestScore) return localActivityEvidence(segment, tour);
  return scored.filter(({ score }) => score === bestScore).map(({ unit }) => unit).join(" ");
}

function activityStarts(body, headSource = ACTIVITY_HEAD_SOURCE) {
  const pattern = new RegExp(
    `(?:^|,\\s*(?:(?:và|hoặc|rồi|sau\\s+đó)\\s+)?|\\s+(?:và|hoặc|rồi|sau\\s+đó)\\s+)(?<head>${headSource})(?=\\s|[,.;!?]|$)`,
    "giu"
  );
  return [...String(body || "").matchAll(pattern)].map((match) => {
    const headOffset = match[0].lastIndexOf(match.groups.head);
    return {
      separatorStart: match.index,
      claimStart: match.index + headOffset,
    };
  });
}

function insideParenthetical(value, offset) {
  const prefix = String(value || "").slice(0, offset);
  return prefix.lastIndexOf("(") > prefix.lastIndexOf(")");
}

function directActivityPrefixStart(body, claimStart) {
  const prefix = String(body || "").slice(0, claimStart);
  const leadIn = /(?:^|[,;]\s*(?:(?:và|hoặc|rồi|sau\s+đó)\s+)?|\s+(?:và|hoặc|rồi|sau\s+đó)\s+)\s*(?:[*_~`]+\s*)?(?:(?:buổi\s+(?:sáng|trưa|chiều|tối)|sáng|trưa|chiều|tối)(?:,?\s+))?(?:(?:bạn|du khách|khách|hành khách|người tham gia)\s+)?(?:(?:sẽ|được|có thể|có cơ hội)(?:\s+được)?\s+)?(?:(?:hoàn toàn|tự do)\s+)?$/iu.exec(prefix);
  return leadIn ? leadIn.index : claimStart;
}

function directActivityStarts(body) {
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?<head>${DIRECT_EXPERIENTIAL_HEAD_SOURCE})(?=\\s|[,.;!?]|$)`,
    "giu"
  );
  return [...String(body || "").matchAll(pattern)]
    .map((match) => {
      const headOffset = match[0].lastIndexOf(match.groups.head);
      const claimStart = match.index + headOffset;
      return {
        separatorStart: directActivityPrefixStart(body, claimStart),
        claimStart,
      };
    })
    .filter(({ claimStart }) => !insideParenthetical(body, claimStart));
}

function activityClaimText(body, start, end) {
  const raw = body.slice(start, end).trim();
  const temporal = raw.search(/\s+(?:trước|sau)\s+khi\s+/iu);
  return (temporal >= 0 ? raw.slice(0, temporal) : raw).trim();
}

function activityEvidenceCandidates(claim) {
  const aliases = String(claim || "").replace(/chụp\s+hình/giu, "chụp ảnh").trim();
  const locative = aliases.search(/\s+(?:tại|ở|trong|trên|bên)\s+/iu);
  return [...new Set([
    aliases,
    locative >= 0 ? aliases.slice(0, locative).trim() : "",
  ].filter(Boolean))];
}

function activitySupportTokens(value) {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !ACTIVITY_SUPPORT_STOP_WORDS.has(token));
}

const ACTIVITY_HEAD_EVIDENCE_ALIASES = new Map([
  ["kham pha", ["tham quan", "ghé", "thăm"]],
  ["mua sam", ["mua"]],
]);

function activityHeadSupported(head, evidence) {
  if (semanticPhraseMatch(evidence, head)) return true;
  const aliases = ACTIVITY_HEAD_EVIDENCE_ALIASES.get(normalizeText(head)) || [];
  return aliases.some((alias) => semanticPhraseMatch(evidence, alias));
}

function activityClaimSupported(claim, evidence) {
  if (!evidence) return false;
  const evidenceTokens = new Set(activitySupportTokens(evidence));
  const headPattern = new RegExp(`^(?<head>${ACTIVITY_HEAD_SOURCE})(?=\\s|[,.;!?]|$)`, "iu");
  return activityEvidenceCandidates(claim).some((candidate) => {
    if (semanticPhraseMatch(evidence, candidate)) return true;
    const head = headPattern.exec(candidate);
    if (!head || !activityHeadSupported(head.groups.head, evidence)) return false;
    const objectTokens = activitySupportTokens(candidate.slice(head[0].length));
    return objectTokens.every((token) => evidenceTokens.has(token));
  });
}

function activityClaimSupportedByTour(segment, claim, tour) {
  const localEvidence = localActivityEvidenceForClaim(segment, claim, tour);
  if (activityClaimSupported(claim, localEvidence)) return true;
  const trailingDetail = /^(?<core>.+?)\s*\((?<detail>[^()]+)\)\s*$/u.exec(String(claim || ""));
  if (!trailingDetail) return false;
  const coreEvidence = localActivityEvidenceForClaim(segment, trailingDetail.groups.core, tour);
  return activityClaimSupported(trailingDetail.groups.core, coreEvidence)
    && semanticPhraseMatch(groundedTourEvidence(tour), trailingDetail.groups.detail);
}

function removeTextRanges(value, ranges) {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((result, range) => result.slice(0, range.start) + result.slice(range.end), value);
}

function factualPurposeLabel(value) {
  const source = String(value || "");
  const match = /^(?<indent>\s*)(?<listMarker>[*+-]\s+)?(?<opening>[*_~`]+)?\s*(?<label>[^:\n]{1,100}?)(?<closingBefore>[*_~`]+)?\s*:\s*/u.exec(source);
  if (!match) return null;
  const label = match.groups.label.replace(/[*_~`]/g, "").trim();
  const activityHead = new RegExp(`^(?:${ACTIVITY_HEAD_SOURCE})(?=\\s|$)`, "iu");
  if (!activityHead.test(label)) return null;

  let bodyStart = match[0].length;
  const opening = match.groups.opening || "";
  if (opening && !match.groups.closingBefore && source.startsWith(opening, bodyStart)) {
    bodyStart += opening.length;
    while (/\s/u.test(source[bodyStart] || "")) bodyStart += 1;
  }

  return {
    label,
    bodyStart,
    prefix: `${match.groups.indent || ""}${match.groups.listMarker || ""}`,
  };
}

function factualPurposeLabelSupported(label, evidence) {
  return String(label || "")
    .split(/\s*(?:&|\/|\bvà\b)\s*/iu)
    .filter(Boolean)
    .every((claim) => activityClaimSupported(claim, evidence));
}

function capitalizeLeadingLetter(value) {
  return String(value || "").replace(/^(\s*(?:(?:[*+-]\s+)|[*_~`]+\s*)*)(\p{Ll})/u, (match, prefix, letter) => (
    `${prefix}${letter.toLocaleUpperCase("vi-VN")}`
  ));
}

function cleanLeadingActivityRewrite(value) {
  const withoutPunctuation = String(value || "").replace(
    /^(\s*(?:(?:[*+-]\s+)|[*_~`]+\s*)*)[,;:]\s*/u,
    "$1"
  );
  return capitalizeLeadingLetter(withoutPunctuation);
}

function orphanedActivityScaffold(value) {
  const normalized = normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:ngoai ra|ben canh do|them vao do|dong thoi)\s+)?(?:(?:lich trinh|hanh trinh|tour)(?:\s+(?:nay|do))?|(?:ban|du khach|khach|hanh khach|nguoi tham gia))\s+(?:(?:se|con|cung|co the)\s+)*(?:co\s+)?(?:hoat dong|trai nghiem|noi dung)?(?:\s+(?:khac|nay|do))?$/.test(normalized);
}

function markdownLineText(value) {
  return String(value || "")
    .replace(/^\s*(?:[*+-]\s+)?/u, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

function normalizedMarkdownLine(value) {
  return normalizeText(markdownLineText(value))
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDayHeadingFormatting(reply) {
  const lines = String(reply || "").split("\n");
  const bareDayHeading = (line) => /^ngày\s+(?:\d+|thứ\s+[\p{L}\p{N}]+)\s*:\s*$/iu.test(markdownLineText(line));
  const isDayHeading = (line) => /^ngày\s+(?:\d+|thứ\s+[\p{L}\p{N}]+)\s*:/iu.test(markdownLineText(line));
  let rewritten = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (!bareDayHeading(lines[index])) continue;
    let contentIndex = index + 1;
    while (contentIndex < lines.length && !lines[contentIndex].trim()) contentIndex += 1;
    if (contentIndex >= lines.length || isDayHeading(lines[contentIndex])) continue;

    const content = lines[contentIndex].replace(/^\s*(?:[*+-]\s+)?/u, "").trim();
    if (!content) continue;
    lines[index] = `${lines[index].trimEnd()} ${content}`;
    lines.splice(index + 1, contentIndex - index);
    rewritten = true;
  }

  return { reply: lines.join("\n"), rewritten };
}

function normalizeItineraryActivityBoundaries(reply, tours = []) {
  const labels = [...new Set((tours || []).flatMap((tour) => (
    (tour?.itinerary || []).flatMap((day) => String(day?.title || "")
      .split(/\s*(?:—|–|\||,)\s*/u)
      .map((value) => value.trim())
      .filter((value) => value.length >= 3))
  )))].sort((left, right) => right.length - left.length);
  if (!labels.length) return { reply: String(reply || ""), rewritten: false };

  const continuation = [
    "đi\\s+bộ",
    "ngồi\\s+thuyền",
    "chèo\\s+thuyền",
    "tham\\s+quan",
    "trải\\s+nghiệm",
    "thư\\s+giãn",
    "chụp\\s+(?:ảnh|hình)",
    "ngắm",
    "bơi",
    "đu",
    "tắm",
    "ghé",
    "dạo",
    "thưởng\\s+thức",
  ].join("|");
  let normalizedReply = String(reply || "");
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundary = new RegExp(
      `(${escaped})(\\s+)(?=(?:${continuation})(?=\\s|[,.;!?]|$))`,
      "giu"
    );
    normalizedReply = normalizedReply.replace(boundary, "$1,$2");
  }
  return {
    reply: normalizedReply,
    rewritten: normalizedReply !== String(reply || ""),
  };
}

function normalizeRedundantExampleTails(reply) {
  const source = String(reply || "");
  let rewritten = false;
  const normalizedReply = source.replace(
    /\s+như\s*:\s*([^.!?\n]{1,120})(?=[.!?])/giu,
    (match, examples, offset, fullReply) => {
      const preceding = normalizeText(fullReply.slice(Math.max(0, offset - 180), offset));
      const exampleTerms = normalizeText(examples)
        .split(/\s*(?:,|;|\bva\b|\bhoac\b)\s*/)
        .map((value) => value.trim())
        .filter((value) => value.length >= 3);
      if (!exampleTerms.length || !exampleTerms.every((term) => preceding.includes(term))) return match;
      rewritten = true;
      return "";
    }
  );
  return { reply: normalizedReply, rewritten };
}

function malformedGeneratedReply(reply) {
  const lines = String(reply || "").split("\n");
  const dayHeading = (line) => /^ngày\s+(?:\d+|thứ\s+[\p{L}\p{N}]+)\s*:\s*(?<body>.*)$/iu.exec(markdownLineText(line));

  for (let index = 0; index < lines.length; index += 1) {
    const heading = dayHeading(lines[index]);
    if (!heading) continue;
    let hasSectionContent = /[\p{L}\p{N}]/u.test(heading.groups.body);
    for (let next = index + 1; next < lines.length && !dayHeading(lines[next]); next += 1) {
      if (/[\p{L}\p{N}]/u.test(lines[next])) {
        hasSectionContent = true;
        break;
      }
    }
    if (!hasSectionContent) return true;
  }

  for (const line of lines) {
    const label = factualPurposeLabel(line);
    if (!label) continue;
    const body = normalizedMarkdownLine(line.slice(label.bodyStart));
    if (/^(?:(?:ban|du khach|khach|hanh khach|nguoi tham gia)\s+)?(?:(?:se|co the|duoc)\s+)?(?:tham quan|check in|kham pha|trai nghiem|chup anh|chup hinh|ngam canh|tim hieu|mua sam|mua|san binh minh)$/.test(body)) {
      return true;
    }
  }

  return replySegments(reply).some((segment) => {
    const normalized = normalizedMarkdownLine(segment);
    if (/\b(?:noi\s+)?(?:(?:ban|du khach|khach|hanh khach|nguoi tham gia)\s+)?(?:co the|se|duoc)$/.test(normalized)) {
      return true;
    }
    if (/\b(?:khi|neu|de|nham|va|hoac|vi|boi vi|ma|nhung)$/.test(normalized)) return true;
    if (/\b(?:cho|voi)\s+(?:(?:nhung\s+)?(?:ai|nguoi)|du khach|khach|ban)\s+(?:yeu thich|ua thich|dam me)$/.test(normalized)) {
      return true;
    }
    if (/\b(?:co|duoc)\s+(?:ket hop|bao gom)$/.test(normalized)) return true;
    if (/\b(?:ben canh|cung voi|ket hop voi)\s+(?:(?:cac|nhung|mot so)\s+)?(?:hoat dong|trai nghiem)$/.test(normalized)) {
      return true;
    }
    if (/(?:^|\s)(?:(?:buoi\s+(?:sang|trua|chieu|toi)|sang|trua|chieu|toi|trong ngay)\s+)?(?:(?:ban|du khach|khach|hanh khach|nguoi tham gia)\s+)?(?:(?:se|co the|duoc|tiep tuc|co hoat dong)\s+)*(?:tham quan|check in|kham pha|trai nghiem|chup anh|chup hinh|ngam canh|tim hieu|mua sam|mua|san binh minh|dao choi)$/.test(normalized)) {
      return true;
    }
    return /^(?:(?:buoi\s+(?:sang|trua|chieu|toi)|sang|trua|chieu|toi|trong ngay)\s+)?tiep tuc$/.test(normalized);
  });
}

function rewriteUnsupportedActivityClaims(segment, tour, context) {
  const originalValue = String(segment || "");
  const label = factualPurposeLabel(originalValue);
  const rewrittenClaims = [];
  let value = originalValue;

  if (label) {
    const evidence = localActivityEvidenceForClaim(originalValue, label.label, tour);
    if (!factualPurposeLabelSupported(label.label, evidence)) {
      value = capitalizeLeadingLetter(`${label.prefix}${originalValue.slice(label.bodyStart)}`);
      rewrittenClaims.push({
        type: "activity_label",
        original: label.label,
        tourId: context?.tourId || null,
      });
    }
  }

  const marker = /(?:^|[^\p{L}\p{N}])(?:để|nhằm)\s+/iu.exec(value);
  let bodyStart = null;
  let rangePrefixStart = null;
  let directMode = false;

  if (marker) {
    const leadingLength = /^[^\p{L}\p{N}]/u.test(marker[0]) ? 1 : 0;
    rangePrefixStart = marker.index + leadingLength;
    bodyStart = marker.index + marker[0].length;
  } else {
    const colon = value.lastIndexOf(":");
    const clauseStart = colon >= 0 ? colon + 1 : 0;
    bodyStart = clauseStart;
    rangePrefixStart = clauseStart;
    directMode = true;
  }

  if (bodyStart === null) return { reply: value, rewrittenClaims, dropSegment: false };
  const body = value.slice(bodyStart);
  if (marker) {
    const purposeClaim = activityClaimText(body, 0, body.length);
    const purposeEvidence = localActivityEvidenceForClaim(value, purposeClaim, tour);
    const activitySupported = activityClaimSupported(purposeClaim, purposeEvidence);
    const relationSupported = /\b(?:de|nham)\b/.test(normalizeText(purposeEvidence));
    if (activitySupported && !relationSupported) {
      const prefix = value.slice(0, rangePrefixStart).replace(/[,;\s]+$/u, "");
      const separator = /:\s*$/u.test(prefix) ? " " : ", ";
      const rewritten = cleanRewrittenSegment(`${prefix}${separator}${value.slice(bodyStart).trimStart()}`);
      rewrittenClaims.push({
        type: "activity_relation",
        original: marker[0].trim(),
        tourId: context?.tourId || null,
      });
      return { reply: rewritten, rewrittenClaims, dropSegment: false };
    }
  }
  const starts = directMode ? directActivityStarts(body) : activityStarts(body);
  if (!starts.length || (!directMode && starts[0].claimStart !== 0)) {
    const dropSegment = rewrittenClaims.length > 0
      && (!/[\p{L}\p{N}]/u.test(value) || orphanedActivityScaffold(value));
    return { reply: dropSegment ? "" : value, rewrittenClaims, dropSegment };
  }

  const unsupported = [];
  starts.forEach((start, index) => {
    const rawEnd = starts[index + 1]?.separatorStart ?? body.length;
    const claim = activityClaimText(body, start.claimStart, rawEnd);
    if (activityClaimSupportedByTour(value, claim, tour)) return;
    const firstClaim = index === 0;
    unsupported.push({
      start: directMode
        ? bodyStart + start.separatorStart
        : firstClaim ? rangePrefixStart : bodyStart + start.separatorStart,
      end: bodyStart + rawEnd,
    });
    rewrittenClaims.push({
      type: "activity_purpose",
      original: claim,
      tourId: context?.tourId || null,
    });
  });

  if (!unsupported.length) return { reply: value, rewrittenClaims, dropSegment: false };
  const allUnsupported = unsupported.length === starts.length;
  const standaloneDirectClaims = directMode && starts[0].separatorStart === 0;
  const rewritten = allUnsupported && standaloneDirectClaims
    ? ""
    : cleanLeadingActivityRewrite(removeTextRanges(value, unsupported));
  const dropSegment = !/[\p{L}\p{N}]/u.test(rewritten) || orphanedActivityScaffold(rewritten);
  return {
    reply: dropSegment ? "" : rewritten,
    rewrittenClaims,
    dropSegment,
  };
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
    const activityRewrite = rewriteUnsupportedActivityClaims(
      segment,
      tour,
      context
    );
    let rewritten = activityRewrite.reply;
    let dropSegment = activityRewrite.dropSegment;
    rewrittenClaims.push(...activityRewrite.rewrittenClaims);

    for (const rule of DESCRIPTIVE_CLAIM_RULES) {
      rewritten = rewritten.replace(rule.pattern, (claim, offset) => {
        const supportTerm = rule.supportTerm ? rule.supportTerm(claim) : claim;
        if (evidence && semanticPhraseMatch(evidence, supportTerm)) return claim;
        rewrittenClaims.push({
          type: rule.type,
          original: claim,
          tourId: context?.tourId || null,
        });
        if (rule.dropSegmentWhenStandalone && descriptiveClaimIsStandalone(rewritten, offset)) {
          dropSegment = true;
        }
        return "";
      });
    }
    pieces[index] = dropSegment ? "" : cleanRewrittenSegment(rewritten);
    if (dropSegment && /^[.!?;]+$/u.test(pieces[index + 1] || "")) pieces[index + 1] = "";
  }

  const rewrittenReply = cleanRewrittenSegment(pieces.join(""));
  return {
    reply: rewrittenClaims.length
      ? normalizeEmptyOrderedListArtifacts(rewrittenReply)
      : rewrittenReply,
    rewrittenClaims,
  };
}

function bookingClaimWithoutEvidence(reply, options = {}) {
  if (options.bookingEvidence) return false;
  const normalized = normalizeText(reply);
  const bookingSignal = /\b(?:booking|ma dat cho|don dat cho)\b/.test(normalized);
  if (!bookingSignal) return false;
  const safeUncertainty = /\b(?:minh|toi) chua co du lieu booking\b.{0,80}\b(?:(?:de|nen khong the) ket luan)\b|\bkhong the (?:xac nhan|ket luan)\b.{0,80}\b(?:co )?ton tai hay khong\b/.test(normalized);
  if (safeUncertainty) return false;
  return /\b(?:he thong )?(?:chua|khong) co du lieu\b.{0,40}\b(?:booking|ma dat cho)\b|\bkhong tim thay\b.{0,40}\b(?:booking|ma dat cho)\b|\b(?:booking|ma dat cho)\b.{0,40}\b(?:khong ton tai|ton tai|da duoc tao|hop le)\b/.test(normalized);
}

function operationalChoiceClaim(segment) {
  return /\b(?:co the|duoc)\s+(?:(?:hoan toan|tu do)\s+)?(?:lua chon|chon|bo qua|khong tham gia|o lai)\b/.test(normalizeText(segment));
}

function operationalChoiceSupported(segment, tour) {
  if (!tour) return false;
  const evidence = groundedTourEvidence(tour);
  const normalizedEvidence = normalizeText(evidence);
  if (!/\b(?:tu do|tuy chon|lua chon|khong bat buoc|co the bo qua)\b/.test(normalizedEvidence)) return false;
  const normalizedSegment = normalizeText(segment);
  const targetTerms = ["nghi ngoi", "o lai", "bo qua", "khong tham gia", "tham gia", "thay doi", "thay the"];
  return targetTerms.some((term) => normalizedSegment.includes(term) && semanticPhraseMatch(evidence, term));
}

function validateGeneratedReply(reply, toursOrGrounding = [], options = {}) {
  const tours = Array.isArray(toursOrGrounding) ? toursOrGrounding : (options.tours || []);
  const grounding = !Array.isArray(toursOrGrounding) && toursOrGrounding?.byTourId
    ? toursOrGrounding
    : options.grounding || buildGroundingContract(tours, options.constraints || {}, { now: options.now });
  if (bookingClaimWithoutEvidence(reply, options)) return { valid: false, reason: "booking_claim_without_evidence" };
  const contexts = grounding.tours || [];
  const descriptiveValidation = rewriteUnsupportedDescriptiveClaims(reply, tours, contexts);
  const dayFormatting = normalizeDayHeadingFormatting(descriptiveValidation.reply);
  const activityFormatting = normalizeItineraryActivityBoundaries(dayFormatting.reply, tours);
  const redundantExampleFormatting = normalizeRedundantExampleTails(activityFormatting.reply);
  const formattingValidation = {
    reply: redundantExampleFormatting.reply,
    rewritten: dayFormatting.rewritten || activityFormatting.rewritten || redundantExampleFormatting.rewritten,
  };
  const validatedReply = formattingValidation.reply;
  if (malformedGeneratedReply(validatedReply)) {
    return {
      valid: false,
      reason: descriptiveValidation.rewrittenClaims.length
        ? "malformed_rewrite_after_unsupported_descriptive_claims"
        : "malformed_generated_reply",
    };
  }
  const missingLanguage = /(?:chua co|chua neu|chua xac nhan|khong co thong tin|chua ro|khong du du lieu)/;
  let previousContext = contexts.length === 1 ? contexts[0] : null;

  for (const segment of replySegments(validatedReply)) {
    const normalized = normalizeText(segment);
    const named = namedContexts(segment, contexts);
    if (named.length === 1) previousContext = named[0].context;
    const derivedValidation = validateDerivedClaims(segment, contexts);
    if (!derivedValidation.valid) return derivedValidation;
    const context = contextForFact(segment, contexts, previousContext);
    const tour = context && tourForContext(tours, context);

    if (operationalChoiceClaim(segment) && !operationalChoiceSupported(segment, tour)) {
      return { valid: false, reason: "unsupported_operational_choice" };
    }

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
    if (!/[\p{L}\p{N}]/u.test(validatedReply)) {
      return { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" };
    }
    return {
      valid: true,
      reason: "unsupported_descriptive_claims_rewritten",
      rewrittenReply: validatedReply,
      rewrittenClaims: descriptiveValidation.rewrittenClaims,
    };
  }
  if (formattingValidation.rewritten) {
    return {
      valid: true,
      reason: "generated_reply_formatting_normalized",
      rewrittenReply: validatedReply,
      rewrittenClaims: [],
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
  if (isCancellationPolicyQuestion(normalized)) return false;
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
  const effectivePrompt = prepared.pendingResolution?.resolved
    && prepared.pendingResolution.pending?.resumeMessage
    ? prepared.pendingResolution.pending.resumeMessage
    : input.prompt;
  let ragTrace = null;
  let validationResult = { status: "not_required", reason: null };
  const finalize = (result, value) => {
    const decided = withDecision(result, value);
    const completed = {
      ...decided,
      providerStatus: decided.providerStatus || deterministicProviderStatus(),
    };
    return {
      ...completed,
      observability: buildAiObservability({
        traceContext: input.traceContext,
        previousSemanticState: input.constraintState,
        pageDelta,
        extractedDelta: prepared.extractedDelta,
        mergedSemanticState: completed.constraintState,
        decision: value,
        pendingClarification: completed.entityState?.pendingClarification || null,
        ragTrace,
        providerStatus: completed.providerStatus,
        validationResult,
        result: completed,
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
  const boundGeneralTourIds = uniqueIds([
    prepared.entityState?.selectedTourId,
    prepared.entityState?.currentTourId,
    ...(prepared.entityState?.lastReferencedTourIds || []),
  ]);
  const explicitGeneralReferenceQuestion = generalEntityQuestion && prepared.tourReferenceSignal;
  const namedDestinationDelta = generalEntityQuestion && !explicitGeneralReferenceQuestion
    ? extractConstraintDelta(input.prompt, {}, input.now)
    : {};
  const hasNamedDestinationSignal = Boolean(
    namedDestinationDelta.destination
    || namedDestinationDelta.destinations?.length
  );
  const shouldResolveGeneralMention = generalEntityQuestion
    && !explicitGeneralReferenceQuestion
    && (boundGeneralTourIds.length === 0 || explicitGeneralTourLookup || hasNamedDestinationSignal);
  const needsTourEvidence = !input.bookingContext?.active && !preferenceCommandOnly && !conversation && !siteLevel;
  const mentionedTours = needsTourEvidence && ((["tour_detail", "availability", "comparison"].includes(requestType) && !prepared.tourReferenceSignal && hasTourNameSignal(input.prompt)) || explicitGeneralTourLookup || shouldResolveGeneralMention)
    ? await findMentionedTours(input.prompt)
    : [];
  const mentionedTourIds = mentionedTours.map((tour) => String(tour._id));
  const generalReferenceQuestion = generalEntityQuestion
    && (explicitGeneralReferenceQuestion || (boundGeneralTourIds.length === 1 && mentionedTourIds.length === 0));
  if (generalEntityQuestion && mentionedTourIds.length === 1) {
    const selectedTourId = mentionedTourIds[0];
    const sameSelectedTour = String(prepared.entityState?.selectedTourId || prepared.entityState?.currentTourId || "") === selectedTourId;
    prepared.entityState = nextEntityState(prepared.entityState, {
      selectedTourId,
      currentTourId: selectedTourId,
      selectedCandidateListId: sameSelectedTour ? prepared.entityState?.selectedCandidateListId || null : null,
      lastReferencedTourIds: [selectedTourId],
    });
  }
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
      excludeTourIds: intent.excludeHistoricalResults
        ? historicalCandidateTourIds(prepared.entityState)
        : activeCandidateTourIds(prepared.entityState),
    } : {}),
  };

  let resolution = null;
  let ambiguousTours = [];
  let resolvedTours = [];
  if (needsTourEvidence && (["tour_detail", "availability", "comparison"].includes(requestType) || generalReferenceQuestion)) {
    const resolutionRequestType = generalReferenceQuestion ? "tour_detail" : requestType;
    resolution = resolveEntityIds({
      message: input.prompt,
      requestType: resolutionRequestType,
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
      resolvedTours = await hydrateResolvedTours(input.prompt, resolution.ids, {
        ...commonOptions,
        ...(generalReferenceQuestion ? { requestType: "tour_detail", constraintState: {} } : {}),
      });
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
      pendingAction: pendingClarification ? value.operation : null,
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
      const mixed = buildMixedTourFacts(tour, intent.requestedFacts, effectivePrompt, input.now, factualConstraints);
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
      const nearestDepartureResolved = prepared.pendingResolution?.resolution?.value === "nearest_departure"
        || intent.nearestDepartureRequested;
      const availabilityGrounding = nearestDepartureResolved
        ? buildGroundingContract(resolvedTours, Object.fromEntries(
          Object.entries(factualConstraints).filter(([key]) => key !== "dateRange")
        ), { now: input.now })
        : resolvedGrounding;
      const factual = groundingForTour(availabilityGrounding, tour) || buildTourFactualContext(tour, constraintState, { now: input.now });
      const departures = nearestDepartureResolved ? factual.departures.slice(0, 1) : factual.departures;
      const availabilityDateRange = nearestDepartureResolved
        ? { label: "đợt gần nhất" }
        : factualConstraints.dateRange;
      return finalize({
        reply: buildAvailabilityReply(tour, availabilityDateRange, departures, factual.partySize),
        intent,
        constraintState,
        entityState: entityStateBase,
        referencedTourIds: resolvedIds,
        referencedBookingIds: [],
        structuredContent: {
          type: "availability",
          tourId: resolvedIds[0],
          name: tour.name,
          dateRange: availabilityDateRange,
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

    const detail = buildTourDetail(tour, effectivePrompt, input.now, factualConstraints);
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
    ? resolvedTours.length
      ? resolvedTours.map((tour) => String(tour._id))
      : mentionedTourIds.length
      ? mentionedTourIds
      : useRecentSuggestionsForGeneral(input.prompt, prepared.entityState)
        ? prepared.entityState.lastSuggestedTourIds
        : []
    : [];
  const generalHasVerifiedEntity = requestType === "general" && Boolean(
    generalDirectIds.length || input.tourContext?._id || input.pageContext?.tourId
  );
  const isolateGeneralEntityLookup = generalEntityQuestion && generalDirectIds.length > 0;
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
    const selectedFocusIds = uniqueIds([
      prepared.entityState?.selectedTourId,
      prepared.entityState?.currentTourId,
    ]);
    const preserveSelectedFocus = prepared.stateMutated
      && selectedFocusIds.length === 1
      && prepared.changedFields.length > 0
      && prepared.changedFields.every((field) => field === "travelers");
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
        focusedTourId: preserveSelectedFocus ? selectedFocusIds[0] : null,
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
      providerStatus: deterministicProviderStatus(),
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
      providerStatus: deterministicProviderStatus(),
      outcome: { code: ERROR_CODES.NO_RESULTS },
      warnings: [],
    }, value);
  }

  let reply;
  let fallbackUsed = false;
  let fallbackReason = null;
  let providerStatus = null;
  let providerMeta = null;
  const hasVerifiedTourContext = Boolean(generalHasVerifiedEntity || mentionedTourIds.length);
  const effectiveGrounding = rag.factualGrounding || buildGroundingContract(
    rag.tours,
    getEffectiveConstraintState(constraintState),
    { now: input.now }
  );
  try {
    const generated = await generateWithProvider({ ...input, constraintState, decision: value }, rag.contextText);
    reply = generated.reply;
    providerMeta = generated.providerMeta;
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
      providerStatus = providerStatusFrom(providerMeta, {
        status: "degraded",
        code: ERROR_CODES.AI_RESPONSE_INVALID,
        fallbackUsed: true,
        failureClass: PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION,
        providerSucceeded: true,
        finalComposer: "deterministic_grounded_fallback",
        provenanceClass: "GEMINI_FAILED_FALLBACK",
      });
      recordProviderFailure(ERROR_CODES.AI_RESPONSE_INVALID);
      console.warn("[ai.validation.fallback]", {
        category: "unsupported_business_claim",
        reason: validation.reason,
        attemptCount: providerStatus.attemptCount,
        failureClass: providerStatus.failureClass,
        hydratedTourCount: rag.tours.length,
      });
      reply = providerFallbackReply({ prompt: input.prompt, tours: rag.tours, hasVerifiedTourContext, grounding: effectiveGrounding });
      if (!reply) {
        throw new AiServiceError(ERROR_CODES.AI_RESPONSE_INVALID, "Provider reply failed validation and no safe fallback exists", {
          status: 502,
          source: "gemini",
          retryable: true,
          providerMeta: providerStatus,
        });
      }
    } else {
      if (validation.rewrittenReply) reply = validation.rewrittenReply;
      providerStatus = providerStatusFrom(providerMeta, {
        status: "healthy",
        code: null,
        fallbackUsed: false,
        failureClass: null,
        providerSucceeded: true,
        finalComposer: validation.rewrittenReply ? "validator_rewrite" : "gemini",
        provenanceClass: validation.rewrittenReply ? "GEMINI_POSTPROCESSED" : "GEMINI_CONFIRMED",
      });
      recordProviderSuccess();
    }
  } catch (error) {
    const typedError = error instanceof AiServiceError ? error : providerError(error);
    if (validationResult.status === "not_required") {
      validationResult = { status: "provider_unavailable", reason: typedError.code };
    }
    fallbackUsed = true;
    fallbackReason = typedError.code === ERROR_CODES.AI_PROVIDER_QUOTA_EXHAUSTED
      ? "provider_quota_exhausted"
      : typedError.code === ERROR_CODES.AI_PROVIDER_RATE_LIMITED
        ? "provider_rate_limited"
      : typedError.code === ERROR_CODES.AI_RESPONSE_INVALID
        ? "provider_response_invalid"
        : "provider_unavailable";
    providerMeta = typedError.providerMeta || error?.providerMeta || providerMeta || {};
    providerStatus = providerStatusFrom(providerMeta, {
      status: "degraded",
      code: typedError.code,
      fallbackUsed: true,
      failureClass: providerMeta.failureClass || PROVIDER_FAILURE_CLASSES.OTHER_PROVIDER_FAILURE,
      providerSucceeded: Boolean(providerMeta.providerSucceeded),
      finalComposer: "deterministic_grounded_fallback",
      provenanceClass: "GEMINI_FAILED_FALLBACK",
    });
    recordProviderFailure(typedError.code);
    console.warn("[ai.generation.fallback]", {
      category: providerStatus.failureClass,
      errorCode: typedError.code,
      errorName: error?.name || "Error",
      providerStatus: providerStatus.httpStatus || null,
      providerErrorStatus: providerStatus.providerErrorStatus || null,
      attemptCount: providerStatus.attemptCount,
      retryCount: providerStatus.retryCount,
      retryAfterMs: providerStatus.retryAfterMs || null,
      quotaMetric: providerStatus.quotaMetric || null,
      quotaId: providerStatus.quotaId || null,
      quotaLocation: providerStatus.quotaLocation || null,
      quotaValue: providerStatus.quotaValue || null,
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
