export interface Risk {
  id: string;
  title: string;
  description: string;
  probability: number; // 0-100
  impact: number; // 0-100
  severity: 'Низкий' | 'Средний' | 'Высокий' | 'Критично';
  category: string;
  status: 'open' | 'resolved';
  recommendation: string;
  actionPlan?: string | string[];
  /** Папка регламентов, из аудита которой создан риск (для фильтра в UI) */
  sourceFolderId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'done';
  points: number;
  riskId?: string;
  deadline?: string;
}

export interface QuestQuestion {
  id: string;
  text: string;
  category: 'hr' | 'infosec' | 'court' | 'tax' | 'procurement' | 'advertising' | 'confidentiality';
  actionPlan?: string;
  requiresUpload?: boolean;
  options: {
    text: string;
    impact: number; // impact on health score
    risk?: Partial<Risk>;
  }[];
}

export interface UserProfile {
  name: string;
  company: string;
  role: string;
  avatar: string;
}

export interface Regulation {
  id: string;
  title: string;
  content: string;
  category: string; // This will now be the folder name/id
  lastUpdated: string;
  risks?: Risk[];
  /** Полный текст саммари последнего аудита (Firestore / локально) */
  auditSummary?: string;
}

export interface DocumentCategory {
  id: string;
  title: string;
  icon: any;
}

export interface ActivityLog {
  id: string;
  action: string;
  timestamp: string;
  user: string;
  type: 'quest' | 'audit' | 'task' | 'regulation';
}

export interface RagDocument {
  id: string;
  title: string;
  content: string;
  lastUpdated: string;
}

export interface AppState {
  healthScore: number;
  risks: Risk[];
  tasks: Task[];
  regulations: Regulation[];
  ragDocuments: RagDocument[];
  activityLogs: ActivityLog[];
  categoryScores: {
    hr: number;
    infosec: number;
    court: number;
    tax: number;
    procurement: number;
    advertising: number;
    confidentiality: number;
  };
  segment: 'small' | 'large';
  questStep: number;
  selectedQuestCategory: 'hr' | 'infosec' | 'court' | 'tax' | 'procurement' | 'advertising' | 'confidentiality' | null;
  isQuestCompleted: boolean;
  user: UserProfile;
  activeFolderId: string | null;
  lastUploadedDocName: string | null;
  summary?: string;
}
