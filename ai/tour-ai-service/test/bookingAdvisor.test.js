const test = require("node:test");
const assert = require("node:assert/strict");
const { generateChatAnswer } = require("../src/services/chatService");

const BOOKING_1 = "64b000000000000000000011";
const BOOKING_2 = "64b000000000000000000012";

function booking(overrides = {}) {
  return {
    bookingId: BOOKING_1,
    bookingCode: "VV-TEST-001",
    tourId: "64b000000000000000000001",
    tourName: "Tour Đà Nẵng 4N3Đ",
    departureDate: "2026-09-22T01:30:00.000Z",
    guests: 2,
    totalPrice: 6_000_000,
    discountAmount: 0,
    status: "pending_payment",
    payment: {
      bookingStatus: "pending_payment",
      paid: false,
      payable: true,
      amountPaid: 0,
      amountDue: 6_000_000,
      paymentMethod: "vnpay",
      latestAttempt: {
        provider: "vnpay",
        status: "failed",
        amount: 6_000_000,
        responseCode: "24",
      },
    },
    detailPath: `/bookings/${BOOKING_1}`,
    paymentPath: `/payment?bookingId=${BOOKING_1}`,
    cancellationPolicy: "Chỉ được tự hủy khi chưa thanh toán.",
    ...overrides,
  };
}

test("booking detail trả deterministic structuredContent, không cần Gemini", async () => {
  const result = await generateChatAnswer({
    prompt: "Tour tôi đặt gần nhất là tour nào?",
    bookingContext: {
      active: true,
      requestType: "booking_detail",
      resolvedBookingIds: [BOOKING_1],
      allowedBookingIds: [BOOKING_1],
      bookings: [booking()],
    },
  });
  assert.equal(result.structuredContent.type, "booking_detail");
  assert.equal(result.structuredContent.booking.bookingId, BOOKING_1);
  assert.deepEqual(result.referencedBookingIds, [BOOKING_1]);
  assert.match(result.reply, /VV-TEST-001/);
});

test("payment status dùng dữ liệu sanitized thật và giữ failed attempt", async () => {
  const result = await generateChatAnswer({
    prompt: "Booking này thanh toán chưa?",
    bookingContext: {
      active: true,
      requestType: "payment_status",
      resolvedBookingIds: [BOOKING_1],
      allowedBookingIds: [BOOKING_1],
      bookings: [booking()],
    },
  });
  assert.equal(result.structuredContent.type, "payment_status");
  assert.equal(result.structuredContent.booking.payment.amountDue, 6_000_000);
  assert.equal(result.structuredContent.booking.payment.latestAttempt.status, "failed");
  assert.match(result.reply, /6\.000\.000đ/);
  assert.match(result.reply, /thất bại/);
});

test("upcoming bookings giữ thứ tự IDs để turn sau resolve ordinal", async () => {
  const result = await generateChatAnswer({
    prompt: "Tháng sau tôi có tour nào?",
    bookingContext: {
      active: true,
      requestType: "booking_list",
      timeLabel: "tháng sau",
      listedBookingIds: [BOOKING_1, BOOKING_2],
      allowedBookingIds: [BOOKING_1, BOOKING_2],
      bookings: [booking(), booking({ bookingId: BOOKING_2, bookingCode: "VV-TEST-002", tourName: "Tour Huế" })],
    },
  });
  assert.equal(result.structuredContent.type, "upcoming_bookings");
  assert.deepEqual(result.entityState.lastListedBookingIds, [BOOKING_1, BOOKING_2]);
  assert.deepEqual(result.referencedBookingIds, [BOOKING_1, BOOKING_2]);
});

test("mutation request chỉ trả guidance và navigation target", async () => {
  const result = await generateChatAnswer({
    prompt: "Hủy booking này giúp tôi",
    bookingContext: {
      active: true,
      requestType: "guidance_action",
      actionType: "cancel",
      resolvedBookingIds: [BOOKING_1],
      allowedBookingIds: [BOOKING_1],
      bookings: [booking()],
    },
  });
  assert.equal(result.structuredContent.type, "booking_guidance");
  assert.equal(result.structuredContent.action, "cancel");
  assert.equal(result.structuredContent.navigationTarget, `/bookings/${BOOKING_1}`);
  assert.match(result.reply, /không thể hủy booking thay bạn/i);
});

test("not found không tiết lộ dữ liệu booking", async () => {
  const result = await generateChatAnswer({
    prompt: `Xem booking ${BOOKING_1}`,
    bookingContext: {
      active: true,
      requestType: "booking_detail",
      notFound: true,
      reason: "BOOKING_NOT_FOUND",
      allowedBookingIds: [],
      bookings: [],
    },
  });
  assert.deepEqual(result.referencedBookingIds, []);
  assert.match(result.reply, /trong tài khoản của bạn/i);
});

test("Gemini quota không ảnh hưởng booking/payment deterministic và không lộ private context", async () => {
  const secret = "PRIVATE-PAYMENT-SECRET";
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = await generateChatAnswer({
      prompt: "Tour tôi đặt gần nhất thanh toán chưa?",
      bookingContext: {
        active: true,
        requestType: "payment_status",
        resolvedBookingIds: [BOOKING_1],
        allowedBookingIds: [BOOKING_1],
        bookings: [booking({ internalSecret: secret })],
      },
    });
    assert.equal(result.structuredContent.type, "payment_status");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
