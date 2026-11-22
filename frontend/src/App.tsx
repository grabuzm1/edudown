import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import TeacherAuth from './pages/TeacherAuth'
import TeacherPanel from './pages/TeacherPanel'
import LessonsTab from './pages/teacher/LessonsTab'
import ClassesTab from './pages/teacher/ClassesTab'
import ArchiveTab from './pages/teacher/ArchiveTab'
import StudentJoin from './pages/StudentJoin'
import AuthCallback from './pages/AuthCallback'
import Workspace from './pages/Workspace'
import Practice from './pages/Practice'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="auth" element={<TeacherAuth />} />
        <Route path="auth/callback" element={<AuthCallback />} />
        <Route path="teacher" element={<TeacherPanel />}>
          <Route index element={<Navigate to="lessons" replace />} />
          <Route path="lessons" element={<LessonsTab />} />
          <Route path="classes" element={<ClassesTab />} />
          <Route path="archive" element={<ArchiveTab />} />
        </Route>
        <Route path="join" element={<StudentJoin />} />
        <Route path="practice" element={<Practice />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}