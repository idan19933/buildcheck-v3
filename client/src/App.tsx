import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AgentDashboard from './pages/AgentDashboard';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import ProjectPage from './pages/ProjectPage';
import AnalysisPage from './pages/AnalysisPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        {/* New default landing — pick which agents to run */}
        <Route path="/" element={<AgentDashboard />} />
        {/* Existing project list moved to /projects (deep links preserved) */}
        <Route path="/projects" element={<DashboardPage />} />
        <Route path="/new" element={<NewProjectPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/analyses/:id" element={<AnalysisPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
