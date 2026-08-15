import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ClientRoute, PrivateRoute, GuestRoute } from './routes/PrivateRoute.jsx'
import { AdminRoute } from './routes/AdminRoute.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import Layout from './components/Layout.jsx'
import { FavoritesProvider } from './context/FavoritesContext.jsx'
import { NotificationsProvider } from './context/NotificationsContext.jsx'
import { ChatProvider } from './context/ChatContext.jsx'

// Tách bundle theo route, đặc biệt tách Recharts/admin khỏi bundle khách hàng.
const AdminLayout = lazy(() => import('./layouts/AdminLayout.jsx'))
const Home = lazy(() => import('./pages/Home.jsx'))
const TourList = lazy(() => import('./pages/TourList.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))
const Register = lazy(() => import('./pages/Register.jsx'))
const TourDetail = lazy(() => import('./pages/TourDetail.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Checkout = lazy(() => import('./pages/Checkout.jsx'))
const Payment = lazy(() => import('./pages/Payment.jsx'))
const Bookings = lazy(() => import('./pages/Bookings.jsx'))
const BookingDetail = lazy(() => import('./pages/BookingDetail.jsx'))
const Favorites = lazy(() => import('./pages/Favorites.jsx'))
const Notifications = lazy(() => import('./pages/Notifications.jsx'))
const Ticket = lazy(() => import('./pages/Ticket.jsx'))
const VerifyTicket = lazy(() => import('./pages/VerifyTicket.jsx'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'))
const AdminTours = lazy(() => import('./pages/admin/Tours.jsx'))
const AdminTourForm = lazy(() => import('./pages/admin/TourForm.jsx'))
const AdminBookings = lazy(() => import('./pages/admin/Bookings.jsx'))
const AdminReviews = lazy(() => import('./pages/admin/Reviews.jsx'))
const AdminTickets = lazy(() => import('./pages/admin/Tickets.jsx'))
const AdminVouchers = lazy(() => import('./pages/admin/Vouchers.jsx'))
const AdminPayments = lazy(() => import('./pages/admin/Payments.jsx'))
const AdminCalendar = lazy(() => import('./pages/admin/Calendar.jsx'))
const AdminReports = lazy(() => import('./pages/admin/Reports.jsx'))
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'))
const AdminAiSettings = lazy(() => import('./pages/admin/AiSettings.jsx'))
const Forbidden = lazy(() => import('./pages/Forbidden.jsx'))
const NotFound = lazy(() => import('./pages/NotFound.jsx'))
const AiAssistant = lazy(() => import('./pages/AiAssistant.jsx'))

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <FavoritesProvider>
            <NotificationsProvider>
              <ChatProvider>
              <ToastProvider>
            <Suspense fallback={<div className="wrap py-16 text-center text-muted">Đang tải trang…</div>}>
              <Routes>
              {/* Khu client — admin bị chuyển về /admin trước khi Header/Footer render */}
              <Route element={<ClientRoute />}>
                <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="tours" element={<TourList />} />
                <Route path="tour/:slug" element={<TourDetail />} />
                <Route path="tickets/verify/:token" element={<VerifyTicket />} />

                {/* Chỉ dành cho khách chưa đăng nhập */}
                <Route element={<GuestRoute />}>
                  <Route path="login" element={<Login />} />
                  <Route path="register" element={<Register />} />
                </Route>

                {/* Yêu cầu đăng nhập */}
                <Route element={<PrivateRoute />}>
                  <Route path="profile" element={<Profile />} />
                  <Route path="checkout" element={<Checkout />} />
                  <Route path="payment" element={<Payment />} />
                  <Route path="bookings" element={<Bookings />} />
                  <Route path="bookings/:id" element={<BookingDetail />} />
                  <Route path="favorites" element={<Favorites />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="tickets/:bookingId" element={<Ticket />} />
                  <Route path="ai-assistant" element={<AiAssistant />} />
                </Route>

                <Route path="403" element={<Forbidden />} />
                <Route path="*" element={<NotFound />} />
                </Route>
              </Route>

              {/* Khu admin — layout riêng, yêu cầu đăng nhập + role admin */}
              <Route element={<AdminRoute />}>
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="tours" element={<AdminTours />} />
                  <Route path="tours/new" element={<AdminTourForm />} />
                  <Route path="tours/:id/edit" element={<AdminTourForm />} />
                  <Route path="bookings" element={<AdminBookings />} />
                  <Route path="reviews" element={<AdminReviews />} />
                  <Route path="tickets" element={<AdminTickets />} />
                  <Route path="vouchers" element={<AdminVouchers />} />
                  <Route path="payments" element={<AdminPayments />} />
                  <Route path="calendar" element={<AdminCalendar />} />
                  <Route path="reports" element={<AdminReports />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="ai-settings" element={<AdminAiSettings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
              </Routes>
            </Suspense>
              </ToastProvider>
              </ChatProvider>
            </NotificationsProvider>
          </FavoritesProvider>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}
