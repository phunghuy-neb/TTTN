// Dữ liệu tour GIẢ cho Tuần 2–3 — bản rút gọn của schema MongoDB đã thiết kế (§12.1).
// Tuần sau thay bằng dữ liệu từ API mà không phải đổi component.

// Chính sách hủy dùng chung cho mọi tour mock — dữ liệu thật sẽ do Backend trả về riêng từng tour.
const CHINH_SACH_HUY =
  'Hủy từ 15 ngày trở lên trước ngày khởi hành được hoàn 100% tiền tour. Hủy trong khoảng 7 đến 14 ngày trước ngày khởi hành được hoàn 50% giá trị booking. Hủy khi còn dưới 7 ngày trước ngày khởi hành hoặc vắng mặt lúc tập trung sẽ không được hoàn tiền.'

export const TOURS = [
  {
    _id: '1',
    name: 'Vịnh Hạ Long — Kỳ quan trên biển',
    slug: 'vinh-ha-long',
    region: 'Miền Bắc',
    location: 'Quảng Ninh',
    coordinates: { lat: 20.9101, lng: 107.1839 },
    summary: 'Du thuyền qua hàng nghìn đảo đá vôi, chèo kayak và ngủ đêm giữa vịnh biển được UNESCO công nhận.',
    description:
      'Vịnh Hạ Long là di sản thiên nhiên thế giới với gần 2.000 hòn đảo đá vôi nhô lên giữa mặt nước xanh ngọc. Hành trình đưa bạn lên du thuyền khám phá hang Sửng Sốt, hang Luồn và làng chài Cửa Vạn còn giữ nếp sống trên mặt nước. Buổi chiều bạn chèo kayak len lỏi giữa các vách đá, tối ngủ đêm trên vịnh và thử câu mực cùng thủy thủ đoàn. Sáng hôm sau tập dưỡng sinh trên boong tàu, đón bình minh giữa quần thể đảo đá.',
    days: 2,
    basePrice: 3200000,
    oldPrice: null,
    images: ['/images/vinh-ha-long.jpg', '/images/vinh-ha-long.jpg', '/images/vinh-ha-long.jpg'],
    avgRating: 4.8,
    tags: ['Biển đảo', 'Du thuyền', 'Di sản'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Hà Nội — Cảng Tuần Châu — Ngủ đêm trên vịnh',
        description:
          'Xe đón khách tại Hà Nội đi Quảng Ninh, làm thủ tục lên du thuyền và dùng bữa trưa trên tàu. Chiều tham quan hang Sửng Sốt, chèo kayak tại khu vực hang Luồn, tắm biển ở đảo Ti Tốp. Tối dùng tiệc hải sản trên boong và trải nghiệm câu mực đêm.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Du thuyền 4 sao trên vịnh Hạ Long',
      },
      {
        dayNumber: 2,
        title: 'Làng chài Cửa Vạn — Hang Tiên Ông — Về Hà Nội',
        description:
          'Tập dưỡng sinh đón bình minh trên boong, ăn sáng nhẹ rồi lên thuyền nan thăm làng chài Cửa Vạn. Tiếp tục khám phá hang Tiên Ông trước khi dùng bữa trưa và tàu cập cảng. Xe đưa đoàn về Hà Nội, kết thúc hành trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-14', availableSlots: 12, price: 3200000 },
      { date: '2026-09-11', availableSlots: 8, price: 3350000 },
      { date: '2026-10-09', availableSlots: 15, price: 3100000 },
    ],
    reviews: [
      {
        user: 'Nguyễn Thu Hà',
        rating: 5,
        comment: 'Du thuyền sạch sẽ, hải sản tươi, chèo kayak vui hết cỡ. Hướng dẫn viên nhiệt tình và rất đúng giờ.',
        createdAt: '2026-06-18',
      },
      {
        user: 'Trần Minh Quân',
        rating: 5,
        comment: 'Ngủ đêm trên vịnh là trải nghiệm đáng giá nhất. Sáng dậy sương phủ mặt nước đẹp như tranh.',
        createdAt: '2026-06-30',
      },
      {
        user: 'Lê Bảo Ngọc',
        rating: 4,
        comment: 'Cảnh đẹp, lịch trình hợp lý. Chỉ tiếc hang Sửng Sốt hơi đông khách nên phải xếp hàng khá lâu.',
        createdAt: '2026-07-05',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '2',
    name: 'Sa Pa — Săn mây trên đỉnh Fansipan',
    slug: 'sa-pa',
    region: 'Miền Bắc',
    location: 'Lào Cai',
    coordinates: { lat: 22.3364, lng: 103.8438 },
    summary: 'Chinh phục nóc nhà Đông Dương, trekking ruộng bậc thang và khám phá bản làng dân tộc vùng cao.',
    description:
      'Sa Pa nằm ở độ cao hơn 1.500m, quanh năm mây phủ và khí hậu mát lạnh như mùa thu châu Âu. Chuyến đi đưa bạn lên đỉnh Fansipan cao 3.143m bằng cáp treo, ngắm toàn cảnh dãy Hoàng Liên Sơn từ nóc nhà Đông Dương. Bạn sẽ trekking qua bản Cát Cát, Tả Van giữa những thửa ruộng bậc thang xếp tầng và ghé thăm nếp nhà của người H Mông, người Dao đỏ. Buổi tối thưởng thức đồ nướng và rượu táo mèo giữa phố núi sương giăng.',
    days: 3,
    basePrice: 4100000,
    oldPrice: 5200000,
    images: ['/images/sa-pa.jpg', '/images/sa-pa.jpg', '/images/sa-pa.jpg'],
    avgRating: 4.7,
    tags: ['Núi rừng', 'Trekking', 'Săn mây'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Hà Nội — Sa Pa — Bản Cát Cát',
        description:
          'Khởi hành từ Hà Nội theo cao tốc Nội Bài – Lào Cai, nhận phòng khách sạn trung tâm thị trấn. Chiều đi bộ khám phá bản Cát Cát của người H Mông, ngắm thác Tiên Sa và xem biểu diễn văn nghệ dân tộc. Tối tự do dạo nhà thờ đá và chợ đêm Sa Pa.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Khách sạn 3 sao trung tâm Sa Pa',
      },
      {
        dayNumber: 2,
        title: 'Chinh phục đỉnh Fansipan',
        description:
          'Ăn sáng rồi di chuyển tới ga cáp treo Fansipan Legend, lên đỉnh 3.143m săn mây và tham quan quần thể tâm linh trên đỉnh. Chiều ghé Hàm Rồng ngắm vườn hoa và toàn cảnh thung lũng Mường Hoa. Tối thưởng thức đồ nướng vùng cao.',
        meals: ['Sáng', 'Trưa', 'Tối'],
        accommodation: 'Khách sạn 3 sao trung tâm Sa Pa',
      },
      {
        dayNumber: 3,
        title: 'Thung lũng Mường Hoa — Tả Van — Về Hà Nội',
        description:
          'Trekking nhẹ qua thung lũng Mường Hoa, thăm bãi đá cổ và bản Tả Van của người Giáy. Dùng bữa trưa đặc sản cá suối trước khi lên xe về Hà Nội. Đoàn về tới nơi vào buổi tối, kết thúc hành trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-21', availableSlots: 10, price: 4100000 },
      { date: '2026-09-18', availableSlots: 0, price: 4250000 },
      { date: '2026-10-16', availableSlots: 6, price: 4400000 },
    ],
    reviews: [
      {
        user: 'Phạm Hoàng Long',
        rating: 5,
        comment: 'May mắn gặp biển mây trên Fansipan, cảnh đẹp không tả nổi. Xe đưa đón đúng giờ, phòng khách sạn ấm.',
        createdAt: '2026-06-22',
      },
      {
        user: 'Đỗ Thanh Mai',
        rating: 4,
        comment: 'Trekking Mường Hoa hơi trơn sau mưa nhưng rất đáng đi. Đồ nướng buổi tối ngon và rẻ.',
        createdAt: '2026-07-02',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '3',
    name: 'Ninh Bình — Tràng An non nước hữu tình',
    slug: 'ninh-binh',
    region: 'Miền Bắc',
    location: 'Ninh Bình',
    coordinates: { lat: 20.2506, lng: 105.9745 },
    summary: 'Ngồi thuyền len lỏi qua hang động Tràng An, thăm cố đô Hoa Lư và leo hang Múa ngắm toàn cảnh.',
    description:
      'Ninh Bình được ví như "Hạ Long trên cạn" với những dãy núi đá vôi soi bóng xuống đồng nước phẳng lặng. Bạn sẽ ngồi thuyền nan xuôi dòng Tràng An, chui qua chín hang xuyên thủy và ghé các phim trường của Kong: Skull Island. Hành trình còn đưa bạn về cố đô Hoa Lư thăm đền vua Đinh, vua Lê — kinh đô đầu tiên của nhà nước Đại Cồ Việt. Điểm nhấn cuối là 500 bậc đá lên hang Múa để ngắm trọn thung lũng Tam Cốc từ trên cao.',
    days: 2,
    basePrice: 2600000,
    oldPrice: null,
    images: ['/images/ninh-binh.jpg', '/images/ninh-binh.jpg', '/images/ninh-binh.jpg'],
    avgRating: 4.6,
    tags: ['Di sản', 'Thiên nhiên', 'Văn hóa'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Hà Nội — Hoa Lư — Tràng An',
        description:
          'Xe đón khách tại Hà Nội, khoảng hai tiếng sau tới cố đô Hoa Lư thăm đền vua Đinh Tiên Hoàng và vua Lê Đại Hành. Chiều xuống thuyền khám phá quần thể danh thắng Tràng An với các hang xuyên thủy và phim trường Kong. Tối nhận phòng, dùng cơm tối với đặc sản cơm cháy, dê núi.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Homestay ven núi Tam Cốc',
      },
      {
        dayNumber: 2,
        title: 'Hang Múa — Chùa Bái Đính — Về Hà Nội',
        description:
          'Sáng leo 500 bậc đá lên hang Múa ngắm toàn cảnh Tam Cốc và sông Ngô Đồng. Tiếp tục tham quan chùa Bái Đính, quần thể chùa lớn nhất Đông Nam Á. Dùng bữa trưa rồi lên xe về Hà Nội, kết thúc chương trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-08', availableSlots: 20, price: 2600000 },
      { date: '2026-09-05', availableSlots: 14, price: 2700000 },
      { date: '2026-10-03', availableSlots: 18, price: 2550000 },
    ],
    reviews: [
      {
        user: 'Vũ Khánh Linh',
        rating: 5,
        comment: 'Đi thuyền Tràng An yên bình lắm, cô lái đò kể chuyện rất có duyên. Cơm cháy dê núi ăn nhớ mãi.',
        createdAt: '2026-06-12',
      },
      {
        user: 'Hoàng Đức Anh',
        rating: 4,
        comment: 'Hang Múa leo hơi mệt nhưng lên tới nơi thì xứng đáng. Nên đi sớm để tránh nắng.',
        createdAt: '2026-06-27',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '4',
    name: 'Phong Nha — Vương quốc hang động',
    slug: 'phong-nha',
    region: 'Miền Trung',
    location: 'Quảng Bình',
    coordinates: { lat: 17.5905, lng: 106.2833 },
    summary: 'Khám phá động Phong Nha và Thiên Đường, chèo thuyền trên sông ngầm và trải nghiệm zipline mạo hiểm.',
    description:
      'Vườn quốc gia Phong Nha – Kẻ Bàng sở hữu hệ thống hang động đá vôi được xem là kỳ vĩ bậc nhất thế giới. Bạn sẽ ngồi thuyền ngược dòng sông Son vào động Phong Nha, nơi dòng sông ngầm chảy xuyên qua lòng núi hàng trăm triệu năm tuổi. Động Thiên Đường dài 31km với vòm thạch nhũ cao vút được ví như cung điện dưới lòng đất. Với người ưa mạo hiểm, sông Chày – hang Tối có zipline vượt sông, tắm bùn và bơi trong hang tối.',
    days: 3,
    basePrice: 4800000,
    oldPrice: null,
    images: ['/images/phong-nha.jpg', '/images/phong-nha.jpg', '/images/phong-nha.jpg'],
    avgRating: 4.9,
    tags: ['Hang động', 'Mạo hiểm', 'Di sản'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Đồng Hới — Động Phong Nha',
        description:
          'Đón khách tại sân bay hoặc ga Đồng Hới, di chuyển về thị trấn Phong Nha nhận phòng. Chiều đi thuyền ngược dòng sông Son vào động Phong Nha, chiêm ngưỡng sông ngầm và hệ thạch nhũ trong lòng núi. Tối dạo phố Phong Nha, thưởng thức đặc sản Quảng Bình.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Khách sạn thị trấn Phong Nha',
      },
      {
        dayNumber: 2,
        title: 'Động Thiên Đường — Sông Chày, hang Tối',
        description:
          'Sáng tham quan động Thiên Đường, đi bộ trên cầu gỗ ngắm vòm thạch nhũ khổng lồ. Chiều trải nghiệm zipline vượt sông Chày, bơi vào hang Tối và tắm bùn khoáng tự nhiên. Tối nghỉ ngơi tại thị trấn.',
        meals: ['Sáng', 'Trưa', 'Tối'],
        accommodation: 'Khách sạn thị trấn Phong Nha',
      },
      {
        dayNumber: 3,
        title: 'Suối Nước Moọc — Đồng Hới — Tiễn khách',
        description:
          'Sáng thư giãn tại khu sinh thái suối Nước Moọc với làn nước xanh trong giữa rừng nguyên sinh. Dùng bữa trưa rồi về thành phố Đồng Hới, ghé biển Nhật Lệ chụp ảnh. Xe tiễn khách ra sân bay hoặc ga tàu, kết thúc hành trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-15', availableSlots: 9, price: 4800000 },
      { date: '2026-09-12', availableSlots: 12, price: 4950000 },
      { date: '2026-10-10', availableSlots: 7, price: 4700000 },
    ],
    reviews: [
      {
        user: 'Nguyễn Tiến Dũng',
        rating: 5,
        comment: 'Động Thiên Đường quá choáng ngợp, ảnh chụp không thể hiện hết được. Zipline sông Chày cực đã.',
        createdAt: '2026-06-20',
      },
      {
        user: 'Trịnh Phương Anh',
        rating: 5,
        comment: 'Hướng dẫn viên am hiểu địa chất, giải thích rất dễ hiểu. Suối Nước Moọc mát và sạch.',
        createdAt: '2026-07-08',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '5',
    name: 'Huế — Dấu ấn cố đô vàng son',
    slug: 'hue',
    region: 'Miền Trung',
    location: 'Thừa Thiên Huế',
    coordinates: { lat: 16.4637, lng: 107.5909 },
    summary: 'Thăm Đại Nội, lăng tẩm triều Nguyễn, nghe ca Huế trên sông Hương và thưởng thức ẩm thực cung đình.',
    description:
      'Huế là kinh đô cuối cùng của chế độ phong kiến Việt Nam, nơi quần thể di tích được UNESCO công nhận là di sản văn hóa thế giới. Bạn sẽ bước qua Ngọ Môn vào Đại Nội, thăm điện Thái Hòa, Tử Cấm Thành và cung Diên Thọ. Hành trình tiếp tục tới lăng Khải Định dát sành sứ tinh xảo và lăng Tự Đức thơ mộng giữa rừng thông. Buổi tối, thuyền rồng đưa bạn xuôi sông Hương nghe ca Huế và thả hoa đăng cầu an.',
    days: 2,
    basePrice: 2900000,
    oldPrice: null,
    images: ['/images/hue.jpg', '/images/hue.jpg', '/images/hue.jpg'],
    avgRating: 4.5,
    tags: ['Lịch sử', 'Văn hóa', 'Ẩm thực'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Đại Nội — Chùa Thiên Mụ — Ca Huế trên sông Hương',
        description:
          'Đón khách tại sân bay Phú Bài, nhận phòng khách sạn ven sông Hương. Chiều tham quan Đại Nội với điện Thái Hòa, Tử Cấm Thành, sau đó ghé chùa Thiên Mụ ngắm hoàng hôn bên sông. Tối lên thuyền rồng nghe ca Huế và thả hoa đăng.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Khách sạn 4 sao ven sông Hương',
      },
      {
        dayNumber: 2,
        title: 'Lăng Khải Định — Lăng Tự Đức — Tiễn khách',
        description:
          'Sáng thăm lăng Khải Định với nghệ thuật khảm sành sứ độc đáo, tiếp đó là lăng Tự Đức nằm giữa rừng thông tĩnh lặng. Dùng bữa trưa cơm cung đình rồi mua đặc sản mè xửng, nón lá làm quà. Xe tiễn khách ra sân bay, kết thúc chương trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-22', availableSlots: 16, price: 2900000 },
      { date: '2026-09-19', availableSlots: 11, price: 3000000 },
      { date: '2026-10-17', availableSlots: 13, price: 2850000 },
    ],
    reviews: [
      {
        user: 'Lý Ngọc Trâm',
        rating: 5,
        comment: 'Ca Huế trên sông Hương buổi tối rất tình. Cơm cung đình trình bày đẹp, vị nhẹ nhàng dễ ăn.',
        createdAt: '2026-06-10',
      },
      {
        user: 'Bùi Quốc Việt',
        rating: 4,
        comment: 'Di tích nhiều nên đi bộ khá mệt, nên mang giày êm. Hướng dẫn viên kể chuyện triều Nguyễn cuốn hút.',
        createdAt: '2026-06-25',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '6',
    name: 'Hội An — Phố cổ đèn lồng lung linh',
    slug: 'hoi-an',
    region: 'Miền Trung',
    location: 'Quảng Nam',
    coordinates: { lat: 15.8801, lng: 108.338 },
    summary: 'Dạo bước phố cổ về đêm, thả đèn hoa đăng trên sông Hoài và tham quan làng rau Trà Quế mộc mạc.',
    description:
      'Hội An từng là thương cảng sầm uất bậc nhất Đông Nam Á thế kỷ 16–17, nay là đô thị cổ được UNESCO công nhận. Những dãy nhà tường vàng, mái ngói rêu phong cùng Chùa Cầu tạo nên khung cảnh không lẫn vào đâu được. Khi màn đêm buông, hàng nghìn chiếc đèn lồng thắp sáng phố cổ và hoa đăng trôi lấp lánh trên sông Hoài. Chuyến đi còn đưa bạn đạp xe ra làng rau Trà Quế và làng gốm Thanh Hà để hiểu nếp sống làng nghề miền Trung.',
    days: 3,
    basePrice: 3600000,
    oldPrice: 4500000,
    images: ['/images/hoi-an.jpg', '/images/hoi-an.jpg', '/images/hoi-an.jpg'],
    avgRating: 4.8,
    tags: ['Phố cổ', 'Di sản', 'Đèn lồng'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Đà Nẵng — Hội An — Phố cổ về đêm',
        description:
          'Đón khách tại sân bay Đà Nẵng, di chuyển về Hội An nhận phòng và nghỉ ngơi. Chiều đi bộ tham quan Chùa Cầu, hội quán Phúc Kiến và nhà cổ Tấn Ký. Tối dạo phố đèn lồng, thả hoa đăng trên sông Hoài và thưởng thức cao lầu, bánh mì Hội An.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Khách sạn 4 sao gần phố cổ',
      },
      {
        dayNumber: 2,
        title: 'Làng rau Trà Quế — Rừng dừa Bảy Mẫu — Làng gốm Thanh Hà',
        description:
          'Đạp xe ra làng rau Trà Quế, cùng nông dân xới đất, trồng rau và học nấu vài món địa phương. Chiều ngồi thuyền thúng khám phá rừng dừa Bảy Mẫu, xem múa thúng trên sông. Ghé làng gốm Thanh Hà tự tay nặn một sản phẩm mang về.',
        meals: ['Sáng', 'Trưa', 'Tối'],
        accommodation: 'Khách sạn 4 sao gần phố cổ',
      },
      {
        dayNumber: 3,
        title: 'Biển An Bàng — Tiễn khách',
        description:
          'Sáng tự do tắm biển An Bàng hoặc thư giãn tại hồ bơi khách sạn. Trả phòng, ghé chợ Hội An mua quà lưu niệm và đặc sản. Xe đưa khách ra sân bay Đà Nẵng, kết thúc hành trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-29', availableSlots: 15, price: 3600000 },
      { date: '2026-09-26', availableSlots: 9, price: 3750000 },
      { date: '2026-10-24', availableSlots: 12, price: 3500000 },
    ],
    reviews: [
      {
        user: 'Đặng Thu Hương',
        rating: 5,
        comment: 'Phố cổ về đêm đúng như trong ảnh, đèn lồng đẹp mê. Lớp học nấu ăn ở Trà Quế rất thú vị.',
        createdAt: '2026-06-15',
      },
      {
        user: 'Ngô Hải Đăng',
        rating: 5,
        comment: 'Khách sạn gần phố cổ nên đi bộ tiện. Thuyền thúng rừng dừa vui, các bác chèo nhiệt tình.',
        createdAt: '2026-07-01',
      },
      {
        user: 'Phan Mỹ Duyên',
        rating: 4,
        comment: 'Buổi tối phố khá đông, nên đi sớm một chút. Cao lầu và bánh mì ngon đúng chuẩn.',
        createdAt: '2026-07-11',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '7',
    name: 'Đà Lạt — Thành phố ngàn hoa mộng mơ',
    slug: 'da-lat',
    region: 'Miền Nam',
    location: 'Lâm Đồng',
    coordinates: { lat: 11.9404, lng: 108.4583 },
    summary: 'Vi vu đồi chè Cầu Đất, check-in vườn hoa và săn bình minh sương giăng trên cao nguyên se lạnh.',
    description:
      'Đà Lạt nằm trên cao nguyên Lâm Viên ở độ cao 1.500m, khí hậu mát mẻ quanh năm và ngập tràn sắc hoa. Bạn sẽ săn bình minh trên đồi chè Cầu Đất khi sương còn phủ kín thung lũng, rồi thưởng thức cà phê Arabica ngay tại nông trại. Hành trình đi qua thác Datanla, hồ Tuyền Lâm, Thiền viện Trúc Lâm và những vườn hoa cẩm tú cầu rực rỡ. Tối đến, chợ đêm Đà Lạt với sữa đậu nành nóng và bánh tráng nướng là điểm hẹn quen thuộc của du khách.',
    days: 3,
    basePrice: 3400000,
    oldPrice: null,
    images: ['/images/da-lat.jpg', '/images/da-lat.jpg', '/images/da-lat.jpg'],
    avgRating: 4.6,
    tags: ['Cao nguyên', 'Check-in', 'Nghỉ dưỡng'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Sân bay Liên Khương — Thác Datanla — Chợ đêm',
        description:
          'Đón khách tại sân bay Liên Khương, trên đường về thành phố ghé thác Datanla trải nghiệm máng trượt. Nhận phòng khách sạn trung tâm, chiều tham quan Thiền viện Trúc Lâm và hồ Tuyền Lâm bằng cáp treo. Tối dạo chợ đêm Đà Lạt, thưởng thức bánh tráng nướng và sữa đậu nành nóng.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Khách sạn 3 sao trung tâm Đà Lạt',
      },
      {
        dayNumber: 2,
        title: 'Săn mây đồi chè Cầu Đất — Vườn hoa thành phố',
        description:
          'Khởi hành từ sáng sớm lên đồi chè Cầu Đất săn bình minh và biển mây, tham quan nông trại cà phê Arabica. Chiều check-in vườn hoa thành phố, đồi cỏ hồng và Quảng trường Lâm Viên. Tối tự do khám phá quán cà phê view thung lũng.',
        meals: ['Sáng', 'Trưa', 'Tối'],
        accommodation: 'Khách sạn 3 sao trung tâm Đà Lạt',
      },
      {
        dayNumber: 3,
        title: 'Ga Đà Lạt — Trang trại rau — Tiễn khách',
        description:
          'Sáng thăm ga Đà Lạt cổ kính và nhà thờ Con Gà, chụp ảnh kiến trúc Pháp còn nguyên vẹn. Ghé trang trại rau công nghệ cao và vườn dâu, mua đặc sản mứt, atisô làm quà. Xe đưa khách ra sân bay Liên Khương, kết thúc chương trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-07', availableSlots: 18, price: 3400000 },
      { date: '2026-09-04', availableSlots: 10, price: 3550000 },
      { date: '2026-10-02', availableSlots: 14, price: 3300000 },
    ],
    reviews: [
      {
        user: 'Cao Thùy Dương',
        rating: 5,
        comment: 'Dậy sớm đi Cầu Đất rất đáng, biển mây đẹp ngoài mong đợi. Cà phê tại nông trại thơm lắm.',
        createdAt: '2026-06-14',
      },
      {
        user: 'Tống Gia Bảo',
        rating: 4,
        comment: 'Lịch trình dày nhưng hợp lý, xe đưa đón sạch. Trời hơi lạnh buổi sáng nên nhớ mang áo khoác.',
        createdAt: '2026-07-03',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'published',
  },
  {
    _id: '8',
    name: 'Phú Quốc — Đảo ngọc thiên đường biển',
    slug: 'phu-quoc',
    region: 'Miền Nam',
    location: 'Kiên Giang',
    coordinates: { lat: 10.227, lng: 103.967 },
    summary: 'Tắm biển Bãi Sao, lặn ngắm san hô Nam đảo và trải nghiệm cáp treo vượt biển dài nhất thế giới.',
    description:
      'Phú Quốc là hòn đảo lớn nhất Việt Nam, nổi tiếng với bờ cát trắng mịn và làn nước trong vắt quanh năm. Bãi Sao ở phía nam đảo được xem là một trong những bãi biển đẹp nhất cả nước, thích hợp tắm biển và ngắm hoàng hôn. Bạn sẽ đi cáp treo Hòn Thơm dài gần 8km vượt biển, lặn ngắm san hô tại quần đảo An Thới và câu cá cùng ngư dân. Đảo còn có nhà thùng nước mắm truyền thống, vườn tiêu và chợ đêm Dương Đông đầy hải sản tươi sống.',
    days: 4,
    basePrice: 7900000,
    oldPrice: 9800000,
    images: ['/images/phu-quoc.jpg', '/images/phu-quoc.jpg', '/images/phu-quoc.jpg'],
    avgRating: 4.7,
    tags: ['Biển đảo', 'Nghỉ dưỡng', 'Lặn biển'],
    itinerary: [
      {
        dayNumber: 1,
        title: 'Sân bay Phú Quốc — Dương Đông — Chợ đêm',
        description:
          'Đón khách tại sân bay Phú Quốc, đưa về resort ven biển Dương Đông nhận phòng và nghỉ ngơi. Chiều tự do tắm biển, ngắm hoàng hôn tại Sunset Sanato. Tối dạo chợ đêm Dương Đông thưởng thức hải sản tươi sống.',
        meals: ['Trưa', 'Tối'],
        accommodation: 'Resort 4 sao ven biển Dương Đông',
      },
      {
        dayNumber: 2,
        title: 'Nam đảo — Bãi Sao — Nhà tù Phú Quốc',
        description:
          'Khám phá nam đảo với nhà thùng nước mắm truyền thống và vườn tiêu Khu Tượng. Chiều tắm biển Bãi Sao, chơi các trò thể thao nước trên bãi cát trắng mịn. Ghé di tích nhà tù Phú Quốc tìm hiểu lịch sử trước khi về resort.',
        meals: ['Sáng', 'Trưa', 'Tối'],
        accommodation: 'Resort 4 sao ven biển Dương Đông',
      },
      {
        dayNumber: 3,
        title: 'Cáp treo Hòn Thơm — Lặn ngắm san hô',
        description:
          'Đi cáp treo vượt biển dài gần 8km ra đảo Hòn Thơm, vui chơi tại công viên nước. Chiều lên tàu ra quần đảo An Thới lặn ngắm san hô và câu cá cùng ngư dân. Tối thưởng thức tiệc nướng hải sản tại bãi biển.',
        meals: ['Sáng', 'Trưa', 'Tối'],
        accommodation: 'Resort 4 sao ven biển Dương Đông',
      },
      {
        dayNumber: 4,
        title: 'Vinpearl Safari — Tiễn khách',
        description:
          'Sáng tham quan Vinpearl Safari, vườn thú bán hoang dã lớn nhất Việt Nam. Trả phòng, mua nước mắm và ngọc trai làm quà tại cửa hàng đặc sản. Xe tiễn khách ra sân bay Phú Quốc, kết thúc hành trình.',
        meals: ['Sáng', 'Trưa'],
        accommodation: '',
      },
    ],
    departures: [
      { date: '2026-08-12', availableSlots: 8, price: 7900000 },
      { date: '2026-09-09', availableSlots: 5, price: 8200000 },
      { date: '2026-10-07', availableSlots: 10, price: 7700000 },
    ],
    reviews: [
      {
        user: 'Huỳnh Nhật Nam',
        rating: 5,
        comment: 'Bãi Sao nước trong veo, cát mịn như bột. Cáp treo Hòn Thơm nhìn xuống biển rất đã mắt.',
        createdAt: '2026-06-19',
      },
      {
        user: 'Võ Kim Chi',
        rating: 4,
        comment: 'Resort đẹp, bữa sáng phong phú. Buổi lặn san hô nên đi sớm vì chiều sóng hơi to.',
        createdAt: '2026-07-06',
      },
    ],
    cancellationPolicy: CHINH_SACH_HUY,
    status: 'archived',
  },
]

// Tương thích ngược tạm thời: formatPrice đã chuyển sang src/utils/format.js.
// Các file còn import từ đây sẽ được chuyển dần ở phiên sau.
export { formatPrice } from '../utils/format.js'
