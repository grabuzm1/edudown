const BASE = ''

export interface Lesson {
  id: string; title: string; description: string; access_code: string;
  is_published: boolean; is_archived?: boolean; created_at: string | null;
  task_count: number; student_count: number; class_id?: string | null;
  tasks?: Task[]; students?: StudentRow[];
}
export interface Task {
  id: string; lesson_id?: string; order_index: number; title: string; description: string;
  starter_code: string; ai_criteria: string; ai_system_prompt?: string;
  total_tasks?: number; index?: number; completed?: boolean;
  accepted?: boolean; submitted?: boolean; code?: string;
  plus?: number; minus?: number;
}
export interface StudentRow {
  session_id: string; display_name: string; group: string; current_task_index: number;
  is_completed: boolean; plus: number; minus: number; total_tasks: number;
  journal_grade: number | null; teacher_grade: number | null; final_grade: number | null;
  teacher_comment: string;
}
export interface AIReview { is_correct: boolean; score: number; feedback: string; reasoning: string }
export interface SubmissionStatus {
  id: string; status: string; stdout: string; stderr: string; execution_time_ms: number;
  plus?: number; minus?: number; completed?: boolean; review: AIReview | null;
}
export interface StudentWorkTask {
  task_id: string; task_order: number; task_index: number; task_title: string;
  task_description: string; task_criteria: string; starter_code: string; code: string;
  stdout: string; stderr: string; submitted: boolean; submitted_at: string | null;
  accepted: boolean;
  ai: { is_correct: boolean; score: number; feedback: string; reasoning: string } | null;
}
export interface StudentWork {
  session_id: string; display_name: string; group: string; is_completed: boolean;
  current_task_index: number; plus: number; minus: number; total_tasks: number;
  journal_grade: number | null; teacher_grade: number | null; final_grade: number | null;
  teacher_comment: string; items: StudentWorkTask[];
}
export interface ClassItem {
  id: string; number: number; letter: string; custom_name: string; note: string;
  display_name: string; student_count: number; created_at: string | null;
  students?: { id: string; surname: string; name: string; student_code: string; has_account?: boolean }[];
}
export interface FavoriteItem { id: string; title: string; description: string; task_count: number; created_at: string | null }
export interface ActiveClassLesson {
  id: string; title: string; description?: string; access_code: string;
  class_display: string; teacher_name: string; task_count: number;
}
export interface LessonsByCode {
  student: { surname: string; name: string; student_code: string };
  class_display: string; lessons: ActiveClassLesson[];
}

export function errText(e: any): string {
  const d = e?.detail ?? e?.message ?? 'Неизвестная ошибка'
  if (Array.isArray(d)) return d.map((x: any) => x?.msg ?? JSON.stringify(x)).join('; ')
  if (typeof d === 'object') return JSON.stringify(d)
  return String(d)
}

export function journalFromRatio(plus: number, total: number): number | null {
  if (total <= 0) return null
  const r = plus / total
  if (r >= 0.9) return 5
  if (r >= 0.7) return 4
  if (r >= 0.5) return 3
  return 2
}

async function request<T = any>(path: string, opts: { method?: string; body?: any; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const teacherToken = localStorage.getItem('teacher_token')
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  else if (teacherToken && path.startsWith('/api/teacher')) headers['Authorization'] = `Bearer ${teacherToken}`
  const res = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
  if (res.status === 204) return null as T
  const data = await res.json().catch(() => ({ detail: res.statusText }))
  if (!res.ok) throw { status: res.status, detail: data?.detail ?? res.statusText }
  return data as T
}

export const teacherApi = {
  register: (d: { email: string; password: string; full_name: string }) => request('/api/teacher/register', { method: 'POST', body: d }),
  login: (d: { email: string; password: string }) => request<{ access_token: string; full_name: string }>('/api/teacher/login', { method: 'POST', body: d }),
  me: () => request('/api/teacher/me'),
  lessons: () => request<Lesson[]>('/api/teacher/lessons'),
  archivedLessons: () => request<Lesson[]>('/api/teacher/lessons/archived'),
  createLesson: (d: { title: string; description?: string; class_id?: string | null; level?: string; favorite_id?: string | null }) => request<Lesson>('/api/teacher/lessons', { method: 'POST', body: d }),
  lesson: (id: string) => request<Lesson>(`/api/teacher/lessons/${id}`),
  patchLesson: (id: string, d: any) => request<Lesson>(`/api/teacher/lessons/${id}`, { method: 'PATCH', body: d }),
  publish: (id: string, on: boolean) => request<Lesson>(`/api/teacher/lessons/${id}/publish`, { method: 'PATCH', body: { is_published: on } }),
  archiveLesson: (id: string) => request(`/api/teacher/lessons/${id}/archive`, { method: 'POST', body: {} }),
  republishLesson: (id: string, newTitle?: string) => request<Lesson>(`/api/teacher/lessons/${id}/republish`, { method: 'POST', body: { new_title: newTitle } }),
  deleteLesson: (id: string) => request(`/api/teacher/lessons/${id}`, { method: 'DELETE' }),
  createTask: (lessonId: string, d: any) => request<Task>(`/api/teacher/lessons/${lessonId}/tasks`, { method: 'POST', body: d }),
  patchTask: (taskId: string, d: any) => request<Task>(`/api/teacher/tasks/${taskId}`, { method: 'PATCH', body: d }),
  deleteTask: (taskId: string) => request(`/api/teacher/tasks/${taskId}`, { method: 'DELETE' }),
  grade: (sessionId: string, grade: number | null, comment: string) =>
    request<{ ok: boolean; plus: number; minus: number; journal_grade: number | null; final_grade: number | null }>(
      `/api/teacher/sessions/${sessionId}/grade`, { method: 'PATCH', body: { grade, comment } }),
  studentWork: (sessionId: string) => request<StudentWork>(`/api/teacher/sessions/${sessionId}/submissions`),
  exportZip: async (id: string) => {
    const res = await fetch(`/api/teacher/lessons/${id}/export`, { headers: { Authorization: `Bearer ${localStorage.getItem('teacher_token')}` } })
    if (!res.ok) throw { status: res.status, detail: 'Не удалось выгрузить ZIP' }
    return res.blob()
  },
  classes: () => request<ClassItem[]>('/api/teacher/classes'),
  createClass: (d: { number: number; letter: string; custom_name?: string | null; note?: string; students: { surname: string; name: string }[] }) => request<ClassItem>('/api/teacher/classes', { method: 'POST', body: d }),
  classDetail: (id: string) => request<ClassItem>(`/api/teacher/classes/${id}`),
  patchClass: (id: string, d: any) => request<ClassItem>(`/api/teacher/classes/${id}`, { method: 'PATCH', body: d }),
  deleteClass: (id: string) => request(`/api/teacher/classes/${id}`, { method: 'DELETE' }),
  favorites: () => request<FavoriteItem[]>('/api/teacher/favorites'),
  createFavorite: (d: { title: string; description?: string; tasks: any[] }) => request<FavoriteItem>('/api/teacher/favorites', { method: 'POST', body: d }),
  deleteFavorite: (id: string) => request(`/api/teacher/favorites/${id}`, { method: 'DELETE' }),
  aiStatus: () => request('/api/teacher/ai-status'),
  aiPreview: (d: { brief: string; count: number; level: string; class_number?: number | null; grade?: number | null }) => request<{ tasks: any[] }>('/api/teacher/ai-preview', { method: 'POST', body: d }),
  aiTasks: (lessonId: string, d: { brief: string; count: number; level: string; class_number?: number | null; grade?: number | null }) => request<{ tasks: any[] }>(`/api/teacher/lessons/${lessonId}/ai-tasks`, { method: 'POST', body: d }),
  aiSelfTest: (d: { task_id: string; code: string }) => request('/api/teacher/ai-selftest', { method: 'POST', body: d }),
}

export const studentAuthApi = {
  downToken: (token: string) =>
    request<{ id: string; login: string; surname: string; name: string; down_id: string }>(
      '/api/student-auth/down-token', { method: 'POST', body: { token } }),
  downRegister: (d: { login: string; password: string; surname: string; name: string }) =>
    request<{ id: string; login: string; surname: string; name: string; down_id: string }>(
      '/api/student-auth/down-register', { method: 'POST', body: d }),
  downLogin: (d: { login: string; password: string }) =>
    request<{ id: string; login: string; surname: string; name: string; down_id: string }>(
      '/api/student-auth/down-login', { method: 'POST', body: d }),
  register: (d: { surname: string; name: string; login: string; password: string }) =>
    request<{ id: string; login: string; surname: string; name: string }>('/api/student-auth/register', { method: 'POST', body: d }),
  login: (d: { login: string; password: string }) =>
    request<{ id: string; login: string; surname: string; name: string }>('/api/student-auth/login', { method: 'POST', body: d }),
}

export const studentApi = {
  join: (d: { access_code: string; surname: string; name: string; group?: string; account_id?: string | null }) =>
    request<{ session_token: string; lesson_title: string; student_display_name: string; is_class_lesson: boolean }>('/api/student/join', { method: 'POST', body: d }),
  joinClass: (d: { access_code: string; student_code: string }) =>
    request<{ session_token: string; lesson_title: string; student_display_name: string; is_class_lesson: boolean }>('/api/student/join-class', { method: 'POST', body: d }),
  lessonsByCode: (code: string) => request<LessonsByCode>(`/api/student/lessons-by-code/${code}`),
  currentTask: (token: string) => request<Task>('/api/student/current-task', { token }),
  tasks: (token: string) => request<Task[]>('/api/student/tasks', { token }),
  selectTask: (index: number, token: string) => request<Task>('/api/student/select-task', { method: 'POST', body: { index }, token }),
  execute: (code: string, token: string) => request<{ stdout: string; stderr: string; execution_time_ms: number }>('/api/student/execute', { method: 'POST', body: { code }, token }),
  submit: (code: string, token: string, io?: { stdout: string; stderr: string }) =>
    request<{ submission_id: string; status: string }>('/api/student/submit', { method: 'POST', body: { code, ...(io ?? {}) }, token }),
  submission: (id: string, token: string) => request<SubmissionStatus>(`/api/student/submission/${id}`, { token }),
}

export const practiceApi = {
  generate: (d: { grade?: number; level?: string; custom?: boolean; prompt?: string; count?: number }) =>
    request<{ tasks: { title: string; description: string; starter_code: string; ai_criteria: string }[] }>(
      '/api/student/practice/generate', {
        method: 'POST',
        body: { grade: d.grade ?? 7, level: d.level ?? 'начинающий', custom: !!d.custom, prompt: d.prompt ?? '', count: d.count ?? 3 },
      }),
  check: (d: { description: string; criteria: string; code: string; stdout: string; stderr: string }) =>
    request<{ is_correct: boolean; feedback: string }>('/api/student/practice/check', { method: 'POST', body: d }),
}