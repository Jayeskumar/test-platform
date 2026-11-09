import { lazy, type ReactNode, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { CommandPalette } from './components/CommandPalette';
import { TopNav } from './components/Layout';
import { PageLoader } from './components/ui';
import { isStaff, useAuth } from './lib/auth';
import { Landing } from './pages/Landing';

// Every page but the landing page is its own chunk, loaded on first visit.
const AssessmentDetail = lazy(() => import('./pages/AssessmentDetail').then((m) => ({ default: m.AssessmentDetail })));
const AssessmentEditor = lazy(() => import('./pages/AssessmentEditor').then((m) => ({ default: m.AssessmentEditor })));
const CandidateReport = lazy(() => import('./pages/CandidateReport').then((m) => ({ default: m.CandidateReport })));
const Compare = lazy(() => import('./pages/Compare').then((m) => ({ default: m.Compare })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Hiring = lazy(() => import('./pages/Hiring').then((m) => ({ default: m.Hiring })));
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const Library = lazy(() => import('./pages/Library').then((m) => ({ default: m.Library })));
const Problems = lazy(() => import('./pages/Problems').then((m) => ({ default: m.Problems })));
const QuestionEditor = lazy(() => import('./pages/QuestionEditor').then((m) => ({ default: m.QuestionEditor })));
const Solve = lazy(() => import('./pages/Solve').then((m) => ({ default: m.Solve })));
const TakeTest = lazy(() => import('./pages/TakeTest').then((m) => ({ default: m.TakeTest })));
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register })));

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <div className="text-6xl font-semibold tracking-tight text-ink-700">404</div>
      <p className="mt-3 text-ink-300">We couldn’t find that page.</p>
      <a href="/" className="mt-6 inline-block rounded-lg bg-ember-500 px-4 py-2 text-sm font-semibold text-on-accent hover:bg-ember-400">Back home</a>
    </div>
  );
}

function Shell() {
  return <div className="min-h-full"><TopNav /><Outlet /></div>;
}

function Guard({ staff, children }: { staff?: boolean; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (staff && !isStaff(user)) return <Navigate to="/problems" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
    <CommandPalette />
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/t/:token" element={<TakeTest />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/problems/:slug" element={<Solve />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
        <Route path="/hiring" element={<Guard staff><Hiring /></Guard>} />
        <Route path="/hiring/new" element={<Guard staff><AssessmentEditor /></Guard>} />
        <Route path="/hiring/:id" element={<Guard staff><AssessmentDetail /></Guard>} />
        <Route path="/hiring/:id/edit" element={<Guard staff><AssessmentEditor /></Guard>} />
        <Route path="/hiring/:id/compare" element={<Guard staff><Compare /></Guard>} />
        <Route path="/hiring/attempts/:id" element={<Guard staff><CandidateReport /></Guard>} />
        <Route path="/library" element={<Guard staff><Library /></Guard>} />
        <Route path="/library/new" element={<Guard staff><QuestionEditor /></Guard>} />
        <Route path="/library/:id" element={<Guard staff><QuestionEditor /></Guard>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
    </>
  );
}
