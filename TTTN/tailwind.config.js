/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Bảng màu khớp app.html (nguồn tham chiếu giao diện DUY NHẤT)
        teal: '#0D4A45', // màu chính
        teal2: '#12645C', // teal đậm (hover)
        jade: '#1E8A6E',
        coral: '#EF6A47', // màu nhấn
        coralD: '#D9542F', // coral đậm (lỗi / hover)
        gold: '#F2A63B',
        ink: '#152623', // màu chữ body
        muted: '#5E6F6A', // chữ phụ
        bg: '#FBFAF6', // màu nền
        sand: '#F1ECE0',
        line: '#E6E0D4', // đường kẻ / viền
      },
      fontFamily: {
        // Font body & heading khớp design token
        body: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
        heading: ['"Lora"', 'serif'],
      },
      borderRadius: {
        pill: '999px', // bo tròn nút
        card: '16px', // bo góc thành phần
      },
      boxShadow: {
        soft: '0 12px 30px -12px rgba(13, 74, 69, 0.28)',
        coral: '0 8px 18px -8px rgba(239, 106, 71, 0.7)',
        float: '0 14px 30px -8px rgba(239, 106, 71, 0.7)',
      },
    },
  },
  plugins: [],
}
