import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  LayoutDashboard, 
  FileSearch, 
  Target, 
  ClipboardList, 
  ChevronRight, 
  Plus, 
  Flame, 
  Zap,
  Trophy,
  ArrowRight,
  Upload,
  User,
  Calendar as CalendarIcon,
  X,
  Settings,
  BrainCircuit,
  Building2,
  Users,
  Gavel,
  Receipt,
  MessageSquare,
  Send,
  Loader2
} from 'lucide-react';
import { cn } from './lib/utils';
import { Toaster, toast } from 'sonner';
import { Risk, Task, AppState, ChatMessage, Regulation, ActivityLog } from './types';
import { INITIAL_QUESTIONS, CORPORATE_QUESTIONS, INITIAL_TASKS, DOCUMENT_CATEGORIES } from './constants';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { askLexi } from './services/lexiService';
import { analyzeDocument, compareTwoDocuments, compareAllDocuments } from './services/aiService';
import { 
  Folder, 
  FileText, 
  ArrowLeft, 
  Search,
  CheckCircle,
  AlertCircle,
  Sparkles,
  BookOpen,
  Scale
} from 'lucide-react';

import { auth, db, googleProvider, signInWithPopup, signOut } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp,
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './lib/firestoreUtils';

const SESSION_OCR_KEY = 'lexiflowpro_ocr_session';
const LOCAL_TASKS_KEY = 'lexiflowpro_local_tasks';
const LOCAL_REGS_KEY = 'lexiflowpro_local_regulations';

function defaultLexiRisk(): Risk {
  return {
    id: 'lexi-general',
    title: 'Общий чат с юристом',
    description: 'Вопросы по документам, рискам и комплаенсу. Можно обсудить выводы последнего аудита.',
    probability: 40,
    impact: 40,
    severity: 'Низкий',
    category: 'Консультация',
    status: 'open',
    recommendation: 'Опиши ситуацию или уточни, что непонятно в документе.',
  };
}

function buildAuditSummary(result: {
  summary?: string;
  metricsAnalysis?: string;
  criticalRemarks?: string[];
  revisionRecommendations?: string;
  forecast?: string;
  subtypeSpecificChecks?: string;
}): string {
  const parts: string[] = [];
  if (result.summary) parts.push(result.summary);
  if (result.metricsAnalysis) {
    parts.push(`\n\n**Метрики и оценка**\n${result.metricsAnalysis}`);
  }
  if (result.criticalRemarks?.length) {
    parts.push(
      `\n\n**Критические замечания**\n${result.criticalRemarks.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    );
  }
  if (result.revisionRecommendations) {
    parts.push(`\n\n**Рекомендации по правкам**\n${result.revisionRecommendations}`);
  }
  if (result.forecast) parts.push(`\n\n**Прогноз**\n${result.forecast}`);
  if (result.subtypeSpecificChecks) {
    parts.push(`\n\n**Проверки по типу документа**\n${result.subtypeSpecificChecks}`);
  }
  return parts.join('').trim();
}

function formatDocumentFragments(
  clauses: string[],
  maxItems = 10,
  maxChars = 480
): string {
  return clauses
    .filter((c) => c.trim())
    .slice(0, maxItems)
    .map((c, i) => {
      const t = c.trim().replace(/\s+/g, " ");
      const clip = t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
      return `${i + 1}. «${clip}»`;
    })
    .join("\n");
}

// --- Components ---

const ProgressBar = ({ value, color = 'bg-cyan-500' }: { value: number, color?: string }) => (
  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
    <motion.div 
      initial={{ width: 0 }}
      animate={{ width: `${value}%` }}
      className={cn("h-full", color)}
    />
  </div>
);

const Badge = ({ children, variant = 'default', className }: { children: React.ReactNode, variant?: 'default' | 'neon' | 'danger' | 'warning', className?: string }) => {
  const styles = {
    default: "bg-white/10 text-white/70",
    neon: "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30",
    danger: "bg-rose-500/20 text-rose-400 border border-rose-500/30",
    warning: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", styles[variant], className)}>
      {children}
    </span>
  );
};

// --- Main App ---

const INITIAL_STATE: AppState = {
  healthScore: 100,
  risks: [],
  tasks: [],
  regulations: [],
  ragDocuments: [],
  activityLogs: [],
  summary: '',
  categoryScores: {
    hr: 0,
    infosec: 0,
    court: 0,
    tax: 0,
    procurement: 0,
    advertising: 0,
    confidentiality: 0
  },
  segment: 'small',
  questStep: 0,
  selectedQuestCategory: null,
  isQuestCompleted: false,
  activeFolderId: null,
  lastUploadedDocName: null,
  user: {
    name: 'Бизнес-пользователь',
    company: 'Ваша организация',
    role: 'Должность',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150&h=150'
  }
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [state, setState] = useState<AppState>(INITIAL_STATE);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'quest' | 'audit' | 'matrix' | 'profile'>('dashboard');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [extractedClauses, setExtractedClauses] = useState<string[]>([]);
  const [showSegmentSelector, setShowSegmentSelector] = useState(true);
  
  // Risk Action Plan Modal
  const [selectedRisk, setSelectedRisk] = useState<Risk | null>(null);
  const [isActionPlanOpen, setIsActionPlanOpen] = useState(false);

  // Lexi Chat
  const [isLexiOpen, setIsLexiOpen] = useState(false);
  const [chatRisk, setChatRisk] = useState<Risk | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLexiLoading, setIsLexiLoading] = useState(false);
  const [newRegTitle, setNewRegTitle] = useState('');
  const [newRegContent, setNewRegContent] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('');
  const [isRegModalOpen, setIsRegModalOpen] = useState(false);
  const [selectedRegForCompare, setSelectedRegForCompare] = useState<Regulation | null>(null);
  const [compareWithRegIds, setCompareWithRegIds] = useState<string[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<{ conflicts: string[], summary: string, risk?: Partial<Risk> } | null>(null);
  const [isComparingAll, setIsComparingAll] = useState(false);
  const [isCompareResultOpen, setIsCompareResultOpen] = useState(false);
  const [allCompareResult, setAllCompareResult] = useState<{ summary: string, conflicts: string[], healthScore: number } | null>(null);
  const [isRagModalOpen, setIsRagModalOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState(state.user);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const questResultFileInputRef = useRef<HTMLInputElement>(null);
  const questInnerFileInputRef = useRef<HTMLInputElement>(null);
  const auditFolderFileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const questions = state.segment === 'small' 
    ? (state.selectedQuestCategory 
        ? INITIAL_QUESTIONS.filter(q => q.category === state.selectedQuestCategory)
        : INITIAL_QUESTIONS)
    : CORPORATE_QUESTIONS;
  const currentQuestion = questions[state.questStep];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_OCR_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        fileName?: string;
        clauses?: string[];
        summary?: string;
      };
      if (saved.clauses?.length) setExtractedClauses(saved.clauses);
      if (saved.summary || saved.fileName) {
        setState((prev) => ({
          ...prev,
          summary: saved.summary || prev.summary,
          lastUploadedDocName: saved.fileName ?? prev.lastUploadedDocName,
        }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (authLoading || currentUser) return;
    try {
      const tasksRaw = sessionStorage.getItem(LOCAL_TASKS_KEY);
      const regsRaw = sessionStorage.getItem(LOCAL_REGS_KEY);
      setState((prev) => {
        let next = { ...prev };
        if (tasksRaw) {
          const parsed = JSON.parse(tasksRaw) as Task[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            next = { ...next, tasks: parsed };
          }
        }
        if (regsRaw) {
          const parsed = JSON.parse(regsRaw) as Regulation[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            next = { ...next, regulations: parsed };
          }
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }, [authLoading, currentUser]);

  // Firebase Auth & Sync
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // Fetch user document
        const userDocRef = doc(db, 'users', user.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setState(prev => ({
              ...prev,
              user: {
                name: userData.name,
                company: userData.company,
                role: userData.role,
                avatar: userData.avatar || prev.user.avatar
              },
              healthScore: userData.healthScore ?? 100,
              segment: userData.segment ?? 'small',
              isQuestCompleted: userData.isQuestCompleted ?? false,
              categoryScores: userData.categoryScores ?? prev.categoryScores
            }));
          } else {
            // Initialize user doc
            await setDoc(userDocRef, {
              name: user.displayName || 'Бизнес-пользователь',
              company: 'Ваша организация',
              role: 'Должность',
              avatar: user.photoURL || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150&h=150',
              healthScore: 100,
              segment: 'small',
              isQuestCompleted: false,
              categoryScores: { hr: 0, infosec: 0, court: 0, tax: 0 },
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }

        // Subscriptions
        const userUnsub = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            setState(prev => ({
              ...prev,
              user: {
                name: userData.name,
                company: userData.company,
                role: userData.role,
                avatar: userData.avatar || prev.user.avatar
              },
              healthScore: userData.healthScore ?? 100,
              segment: userData.segment ?? 'small',
              isQuestCompleted: userData.isQuestCompleted ?? false,
              categoryScores: userData.categoryScores ?? prev.categoryScores
            }));
            if (userData.segment) {
              setShowSegmentSelector(false);
            }
          }
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

        const risksUnsub = onSnapshot(query(collection(db, 'risks'), where('userId', '==', user.uid)), (snap) => {
          const risks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Risk));
          setState(prev => ({ ...prev, risks }));
        }, (error) => handleFirestoreError(error, OperationType.GET, 'risks'));

        const tasksUnsub = onSnapshot(query(collection(db, 'tasks'), where('userId', '==', user.uid)), (snap) => {
          const tasks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
          setState(prev => ({ ...prev, tasks }));
        }, (error) => handleFirestoreError(error, OperationType.GET, 'tasks'));

        const regsUnsub = onSnapshot(query(collection(db, 'regulations'), where('userId', '==', user.uid)), (snap) => {
          const regulations = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Regulation));
          setState(prev => ({ ...prev, regulations }));
        }, (error) => handleFirestoreError(error, OperationType.GET, 'regulations'));

        const logsUnsub = onSnapshot(query(collection(db, 'activityLogs'), where('userId', '==', user.uid)), (snap) => {
          const activityLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog));
          setState(prev => ({ ...prev, activityLogs }));
        }, (error) => handleFirestoreError(error, OperationType.GET, 'activityLogs'));

        setAuthLoading(false);
        return () => {
          userUnsub();
          risksUnsub();
          tasksUnsub();
          regsUnsub();
          logsUnsub();
        };
      } else {
        setState(INITIAL_STATE);
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success('Успешный вход');
    } catch (error) {
      toast.error('Ошибка входа');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setState({
        healthScore: 100,
        risks: [],
        tasks: [],
        regulations: [],
        ragDocuments: [],
        activityLogs: [],
        summary: '',
        categoryScores: { hr: 0, infosec: 0, court: 0, tax: 0 },
        segment: 'small',
        questStep: 0,
        selectedQuestCategory: null,
        isQuestCompleted: false,
        activeFolderId: null,
        lastUploadedDocName: null,
        user: {
          name: 'Бизнес-пользователь',
          company: 'Ваша организация',
          role: 'Должность',
          avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150&h=150'
        }
      });
      toast.success('Вы вышли из системы');
    } catch (error) {
      toast.error('Ошибка при выходе');
    }
  };

  const handleQuestAnswer = async (impactValue: number, riskData?: Partial<Risk>) => {
    const q = questions[state.questStep];
    if (!q) return;
    
    const category = q.category;
    const nextStep = state.questStep + 1;
    const isCompleted = nextStep >= questions.length;
    
    // Calculate new values to avoid closure/stale state issues with Firestore
    const newHealthScore = Math.min(100, Math.max(0, state.healthScore + impactValue));
    const newCategoryScores = { ...state.categoryScores };
    if (impactValue < 0) {
      newCategoryScores[category] = (newCategoryScores[category] || 0) + Math.abs(impactValue);
    }

    // Update local state immediately
    setState(prev => {
      const updatedRisks = [...prev.risks];
      if (impactValue < 0 && riskData) {
        const catMap: Record<string, string> = {
          hr: 'HR',
          infosec: 'Инфобез',
          court: 'Судебный',
          tax: 'Налоги',
          procurement: 'Закупки',
          advertising: 'Реклама',
          confidentiality: 'Конфиденциальность'
        };
        updatedRisks.push({
          id: `temp-${Date.now()}`,
          userId: currentUser?.uid || 'temp',
          status: 'open',
          category: catMap[category] || 'Общий',
          recommendation: riskData.recommendation || 'Исправить немедленно',
          probability: riskData.probability || 50,
          impact: riskData.impact || 50,
          title: riskData.title || 'Новый риск',
          description: riskData.description || q.text,
          severity: riskData.severity || 'Высокий',
          createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
          updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
          ...riskData
        } as Risk);
      }

      return {
        ...prev,
        questStep: nextStep,
        healthScore: newHealthScore,
        categoryScores: newCategoryScores,
        isQuestCompleted: isCompleted,
        risks: updatedRisks
      };
    });

    if (impactValue < 0) {
      toast.error('Обнаружен потенциальный риск', {
        description: q.text
      });
    } else {
      toast.success('Рисков не обнаружено');
    }

    if (currentUser) {
      try {
        if (riskData) {
          const catMap: Record<string, string> = {
            hr: 'HR',
            infosec: 'Инфобез',
            court: 'Судебный',
            tax: 'Налоги',
            procurement: 'Закупки',
            advertising: 'Реклама',
            confidentiality: 'Конфиденциальность'
          };
          const riskRef = doc(collection(db, 'risks'));
          await setDoc(riskRef, {
            userId: currentUser.uid,
            status: 'open',
            category: catMap[category] || 'Общий',
            recommendation: riskData.recommendation || 'Исправить немедленно',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            probability: riskData.probability || 50,
            impact: riskData.impact || 50,
            ...riskData
          });
        }

        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
          healthScore: newHealthScore,
          categoryScores: newCategoryScores,
          isQuestCompleted: isCompleted,
          updatedAt: serverTimestamp()
        });

      } catch (error) {
        console.error('Error updating quest answer:', error);
        if (error instanceof Error && (error.message.includes('permission') || error.message.includes('insufficient'))) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
        }
      }
    }
  };

  const completeQuest = async () => {
    const categoryName = state.selectedQuestCategory;
    
    if (currentUser) {
      try {
        await updateDoc(doc(db, 'users', currentUser.uid), {
          isQuestCompleted: true,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
      }
    }
    
    setState(prev => ({
      ...prev,
      isQuestCompleted: true,
      selectedQuestCategory: null,
      questStep: 0
    }));
    
    setActiveTab('matrix');
    toast.success('Диагностика завершена', {
      description: 'Результаты добавлены в матрицу рисков'
    });
    
    if (categoryName) {
      logActivity(`Завершен квест по категории: ${categoryName}`, 'quest');
    }
  };

  const logActivity = async (action: string, type: ActivityLog['type']) => {
    if (!currentUser) return;
    try {
      await setDoc(doc(collection(db, 'activityLogs')), {
        userId: currentUser.uid,
        action,
        type,
        user: state.user.name,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'activityLogs');
    }
  };

  const toggleTask = async (taskId: string) => {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStatus = task.status === 'done' ? 'todo' : 'done';
    const impact = newStatus === 'done' ? 5 : -5;

    const isLocalTask = taskId.startsWith('local-');

    if (!currentUser || isLocalTask) {
      setState((prev) => {
        const tasks = prev.tasks.map((t) =>
          t.id === taskId ? { ...t, status: newStatus } : t
        );
        if (!currentUser) {
          try {
            sessionStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
          } catch {
            /* ignore */
          }
        }
        return { ...prev, tasks };
      });
      if (!currentUser) {
        toast.success(newStatus === 'done' ? 'Задача выполнена' : 'Задача снова в работе');
      }
      return;
    }

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'users', currentUser.uid), {
        healthScore: Math.min(100, Math.max(0, state.healthScore + impact)),
        updatedAt: serverTimestamp()
      });

      logActivity(`${newStatus === 'done' ? 'Выполнена' : 'Возобновлена'} задача: ${task.title}`, 'task');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) {
      toast.error('Введите название задачи');
      return;
    }

    if (currentUser) {
      try {
        await setDoc(doc(collection(db, 'tasks')), {
          userId: currentUser.uid,
          title,
          description: 'Добавлено вручную',
          status: 'todo',
          points: 50,
          deadline: newTaskDeadline || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        logActivity(`Создана задача: ${title}`, 'task');
        toast.success('Задача создана!');
        setNewTaskTitle('');
        setNewTaskDeadline('');
        setIsTaskModalOpen(false);
        setActiveTab('dashboard');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'tasks');
      }
      return;
    }

    const task: Task = {
      id: `local-${Date.now()}`,
      title,
      description: 'Добавлено вручную',
      status: 'todo',
      points: 50,
      deadline: newTaskDeadline || undefined,
    };

    setState((prev) => {
      const tasks = [task, ...prev.tasks];
      try {
        sessionStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
      } catch {
        /* ignore */
      }
      return { ...prev, tasks };
    });

    toast.success('Задача создана — видна на главной, сохранена в браузере до входа в аккаунт');
    setNewTaskTitle('');
    setNewTaskDeadline('');
    setIsTaskModalOpen(false);
    setActiveTab('dashboard');
  };

  const createTaskFromRisk = async (risk: Risk) => {
    const title = `Устранить риск: ${risk.title}`.slice(0, 220);
    const description =
      (risk.description || "").slice(0, 1200) ||
      "Задача создана из матрицы рисков. Открой риск в матрице для деталей.";

    if (currentUser) {
      try {
        await setDoc(doc(collection(db, "tasks")), {
          userId: currentUser.uid,
          title,
          description,
          status: "todo",
          points: 80,
          deadline: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        logActivity(`Задача из риска: ${risk.title}`, "task");
        toast.success("Задача добавлена — открой «Главную»");
        setActiveTab("dashboard");
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "tasks");
      }
      return;
    }

    const task: Task = {
      id: `local-${Date.now()}`,
      title,
      description,
      status: "todo",
      points: 80,
    };

    setState((prev) => {
      const tasks = [task, ...prev.tasks];
      try {
        sessionStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
      } catch {
        /* ignore */
      }
      return { ...prev, tasks };
    });
    toast.success("Задача на главной (сохранена в браузере)");
    setActiveTab("dashboard");
  };

  const handleAddActionToTasks = async (action: string) => {
    if (!currentUser) return;
    // Prompt for deadline
    const deadline = prompt(`Установите срок для задачи: "${action}" (например, 25.03.2026)`, '');
    
    try {
      await setDoc(doc(collection(db, 'tasks')), {
        userId: currentUser.uid,
        title: action,
        description: `Из плана действий по риску: ${selectedRisk?.title}`,
        status: 'todo',
        points: 100,
        deadline: deadline || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      logActivity(`Добавлена задача из плана: ${action}`, 'task');
      toast.success('Задача добавлена в список!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tasks');
    }
  };

  const addRegulation = async () => {
    if (!newRegTitle.trim() || !currentUser) return;
    
    try {
      await setDoc(doc(collection(db, 'regulations')), {
        userId: currentUser.uid,
        title: newRegTitle,
        content: newRegContent,
        category: 'Legal',
        lastUpdated: new Date().toISOString().split('T')[0],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      logActivity(`Добавлен регламент: ${newRegTitle}`, 'regulation');
      setNewRegTitle('');
      setNewRegContent('');
      setIsRegModalOpen(false);
      toast.success('Регламент добавлен!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'regulations');
    }
  };

  const simulateAnalysis = async (file?: File, categoryId?: string) => {
    if (isAnalyzing || isExtracting) return;
    
    if (!file) {
      toast.error('Пожалуйста, выберите файл для анализа.');
      return;
    }

    const fileName = file.name;
    const isRag = categoryId === 'checklists';
    
    try {
      setIsExtracting(true);
      setExtractedClauses([]);
      
      const folderDocs = state.regulations
        .filter(r => r.category === categoryId)
        .map(r => ({ title: r.title, content: r.content }));
      
      const checklistDocs = state.regulations
        .filter(r => r.category === 'checklists')
        .map(d => ({ title: d.title, content: d.content }));
      
      const existingDocs = [...folderDocs, ...checklistDocs];

      const result = await analyzeDocument(file, categoryId, isRag, existingDocs);
      
      setIsExtracting(false);
      setIsAnalyzing(true);

      const fullSummary = buildAuditSummary(result);
      const saveCategory =
        categoryId ||
        state.activeFolderId ||
        (state.segment === "small" ? "small_audit" : "hr");
      const docContent = result.clauses.join("\n\n") || result.summary || "";
      const citationBlock =
        formatDocumentFragments(result.clauses || []).trim() ||
        "(фрагменты текста не выделены — опирайся на описание риска)";

      setExtractedClauses(result.clauses);

      const riskCategoryLabel =
        categoryId === 'tax'
          ? 'Налоги'
          : categoryId === 'advertising'
            ? 'Реклама'
            : categoryId === 'infosec'
              ? 'Персональные данные'
              : categoryId === 'court'
                ? 'Судебные риски'
                : categoryId === 'lna_sync'
                  ? 'Соответствие ЛНА'
                  : categoryId === 'procurement'
                    ? 'Закупки'
                    : categoryId === 'confidentiality'
                      ? 'Конфиденциальность'
                      : categoryId === 'hr'
                        ? 'HR'
                        : 'Комплаенс';

      let newRegulationRef: ReturnType<typeof doc> | null = null;

      // Handle conflicts and risks
      const allRisks: Risk[] = [];
      if (result.conflicts && result.conflicts.length > 0) {
        for (const c of result.conflicts) {
          allRisks.push({
            id: `temp-conf-${Date.now()}-${Math.random()}`,
            userId: currentUser?.uid || 'temp',
            title: 'Юридическое противоречие',
            description: c,
            severity: 'Критично',
            impact: 85,
            probability: 90,
            category: 'Коллизии',
            status: 'open',
            recommendation: 'Согласовать единую редакцию положений во всех документах.',
            actionPlan: ['Выявить все зависимые договоры', 'Подготовить доп. соглашение об унификации условий'],
            sourceFolderId: saveCategory,
            createdAt: { seconds: Date.now() / 1000 } as any,
            updatedAt: { seconds: Date.now() / 1000 } as any
          } as Risk);
        }
      }

      const baseRiskDesc =
        result.risk?.description ||
        'В документе выявлено противоречие внутренним регламентам компании.';
      const riskDescForLexi = `${baseRiskDesc}\n\n---\nФРАГМЕНТЫ ДОКУМЕНТА (цитируй при ответе):\n${citationBlock}`;

      const newRiskData: Risk = {
        id: `temp-risk-${Date.now()}`,
        userId: currentUser?.uid || 'temp',
        title: result.risk?.title || `Несоответствие в ${fileName}`,
        description: riskDescForLexi,
        severity: (result.risk?.severity as any) || 'Критично',
        impact: result.risk?.impact || 95,
        probability: result.risk?.probability || 100,
        category: riskCategoryLabel,
        status: 'open',
        recommendation: result.risk?.recommendation || 'Пересмотреть условия договора.',
        actionPlan: result.risk?.actionPlan || [
          'Подготовить дополнительное соглашение',
          'Согласовать с юридическим отделом',
          'Обновить статус в системе'
        ],
        sourceFolderId: saveCategory,
        createdAt: { seconds: Date.now() / 1000 } as any,
        updatedAt: { seconds: Date.now() / 1000 } as any
      } as Risk;
      
      allRisks.push(newRiskData);

      const risksForRegulationDoc: Risk[] = allRisks.map((r) => ({
        id: r.id,
        title: r.title,
        description: (r.description || '').slice(0, 4000),
        severity: r.severity,
        probability: r.probability,
        impact: r.impact,
        category: r.category,
        status: r.status,
        recommendation: r.recommendation || '',
        actionPlan: r.actionPlan,
        sourceFolderId: saveCategory,
      }));

      if (currentUser) {
        newRegulationRef = doc(collection(db, 'regulations'));
        await setDoc(newRegulationRef, {
          userId: currentUser.uid,
          title: fileName,
          content: docContent,
          category: saveCategory,
          auditSummary: fullSummary,
          risks: risksForRegulationDoc,
          lastUpdated: new Date().toISOString().split('T')[0],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (currentUser) {
        for (const risk of allRisks) {
          const { id, ...fireRisk } = risk;
          await setDoc(doc(collection(db, 'risks')), {
            ...fireRisk,
            userId: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
      }

      const impactTotal = (result.conflicts?.length || 0) > 0 ? 25 : 10;
      
      if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.uid), {
          healthScore: Math.max(0, state.healthScore - impactTotal),
          updatedAt: serverTimestamp()
        });
      }

      try {
        sessionStorage.setItem(
          SESSION_OCR_KEY,
          JSON.stringify({
            fileName,
            clauses: result.clauses,
            summary: fullSummary,
            savedAt: Date.now(),
          })
        );
      } catch {
        /* ignore */
      }

      setState((prev) => {
        let regulations = prev.regulations;
        const lastUpdated = new Date().toISOString().split('T')[0];
        if (currentUser && newRegulationRef) {
          const newReg: Regulation = {
            id: newRegulationRef.id,
            title: fileName,
            content: docContent,
            category: saveCategory,
            lastUpdated,
            auditSummary: fullSummary,
            risks: risksForRegulationDoc,
          };
          regulations = [newReg, ...prev.regulations.filter((r) => r.id !== newReg.id)];
        } else if (!currentUser) {
          const reg: Regulation = {
            id: `local-reg-${Date.now()}`,
            title: fileName,
            content: docContent,
            category: saveCategory,
            lastUpdated,
            auditSummary: fullSummary,
            risks: risksForRegulationDoc,
          };
          regulations = [reg, ...prev.regulations];
          try {
            const localOnly = regulations.filter((r) => r.id.startsWith('local-reg-'));
            sessionStorage.setItem(LOCAL_REGS_KEY, JSON.stringify(localOnly));
          } catch {
            /* ignore */
          }
        }
        return {
          ...prev,
          regulations,
          healthScore: Math.max(0, prev.healthScore - impactTotal),
          lastUploadedDocName: fileName,
          summary: fullSummary,
          risks: [...prev.risks, ...allRisks],
          activeFolderId: saveCategory,
        };
      });

      setIsAnalyzing(false);
      if (currentUser) {
        logActivity(`Проведен аудит документа: ${fileName}`, 'audit');
      }
      toast.success('Аудит документа завершен! Документ и саммари сохранены в папке.');
      setActiveTab('audit');

      openLexi(
        newRiskData,
        `Окей, разобрала «${fileName}». ${result.risk?.title ? `Главное: ${result.risk.title}.` : ''} В ответах буду ссылаться на цитаты из документа в кавычках «…».`
      );
    } catch (error) {
      console.error("Analysis error:", error);
      setIsExtracting(false);
      setIsAnalyzing(false);
      toast.error('Произошла ошибка при анализе документа.');
    }
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>, categoryId: string) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        toast.error('Пожалуйста, загрузите документ в формате PDF или изображение. Форматы DOC и DOCX временно не поддерживаются.');
        return;
      }
      simulateAnalysis(file, categoryId);
      e.target.value = ''; // Reset input to allow same file upload
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        toast.error('Пожалуйста, загрузите документ в формате PDF или изображение. Форматы DOC и DOCX временно не поддерживаются.');
        return;
      }
      simulateAnalysis(file, state.selectedQuestCategory || undefined);
      e.target.value = ''; // Reset input
    }
  };

  const handleCompareAll = async () => {
    const docs = state.regulations
      .filter(r => r.category === state.activeFolderId)
      .map(r => ({ title: r.title, content: r.content }));
      
    // Include checklists in global comparison too
    if (state.activeFolderId === 'lna_sync') {
      const checklists = state.ragDocuments.map(d => ({ title: d.title, content: d.content }));
      docs.push(...checklists);
    }

    if (docs.length < 2) {
      toast.error('Необходимо как минимум 2 документа в этой папке для проведения перекрестного анализа.');
      return;
    }

    try {
      setIsComparingAll(true);
      const result = await compareAllDocuments(docs);
      setAllCompareResult(result);
      setIsComparingAll(false);
      setIsCompareResultOpen(true);
      logActivity(`Проведен перекрестный анализ папки: ${DOCUMENT_CATEGORIES.find(c => c.id === state.activeFolderId)?.title}`, 'regulation');
    } catch (error) {
      console.error("Compare All error:", error);
      setIsComparingAll(false);
      alert('Ошибка при выполнении перекрестного анализа.');
    }
  };

  const handleLexiChat = async () => {
    const text = input.trim();
    if (!text || !chatRisk) return;
    const userMsg: ChatMessage = { role: 'user', content: text };
    const conversation: ChatMessage[] = [...messages, userMsg];
    setMessages(conversation);
    setInput('');
    setIsLexiLoading(true);

    const response = await askLexi(chatRisk.title, chatRisk.description, conversation);
    setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
    setIsLexiLoading(false);
  };

  const updateProfile = async () => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        name: profileForm.name,
        company: profileForm.company,
        role: profileForm.role,
        avatar: profileForm.avatar,
        updatedAt: serverTimestamp()
      });
      
      setState(prev => ({ ...prev, user: profileForm }));
      setIsEditingProfile(false);
      toast.success('Профиль успешно обновлен');
      logActivity('Обновлен профиль пользователя', 'regulation');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.uid}`);
    }
  };

  const openLexi = (risk: Risk, intro?: string) => {
    setChatRisk(risk);
    setMessages([
      {
        role: 'assistant',
        content:
          intro ??
          `Привет! Я Лекси. Давай обсудим риск «${risk.title}». Спрашивай как у друга-юриста — разложу по полочкам.`,
      },
    ]);
    setIsLexiOpen(true);
  };

  if (showSegmentSelector) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <Toaster position="top-right" theme="dark" />
        <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8"
          >
          <div className="col-span-full text-center mb-8">
            <h1 className="text-4xl font-black mb-4">Выберите тип бизнеса</h1>
            <p className="text-white/40">Мы адаптируем интерфейс и проверки под ваши задачи</p>
          </div>

          <button 
            onClick={() => { setState(s => ({ ...s, segment: 'small' })); setShowSegmentSelector(false); }}
            className="group bg-white/[0.02] border border-white/5 p-12 rounded-[40px] hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all text-left"
          >
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
              <Building2 className="w-8 h-8 text-cyan-400" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Малый бизнес</h3>
            <p className="text-white/40 text-sm leading-relaxed">Фокус на базовой безопасности, исправлении ошибок и пошаговых инструкциях для ИП и ООО.</p>
          </button>

          <button 
            onClick={() => { setState(s => ({ ...s, segment: 'large' })); setShowSegmentSelector(false); setActiveTab('audit'); }}
            className="group bg-white/[0.02] border border-white/5 p-12 rounded-[40px] hover:border-violet-500/50 hover:bg-violet-500/5 transition-all text-left"
          >
            <div className="w-16 h-16 rounded-2xl bg-violet-500/20 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
              <Users className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Корпорация</h3>
            <p className="text-white/40 text-sm leading-relaxed">Глубокий аудит регламентов, фильтр коллизий и сложная матрица рисков для крупных структур.</p>
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-cyan-500/30">
      <Toaster position="top-right" theme="dark" />
      
      <AnimatePresence>
        {(isAnalyzing || isExtracting || isComparing || isComparingAll) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
          >
            <div className="text-center space-y-6 max-w-sm px-6">
              <div className="relative mx-auto w-24 h-24">
                <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20"></div>
                <div className="absolute inset-0 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <BrainCircuit className="w-10 h-10 text-cyan-400 animate-pulse" />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-black mb-2">
                  {isExtracting ? 'ИИ считывает данные...' : 'Лекси анализирует контент...'}
                </h3>
                <p className="text-sm text-white/40 leading-relaxed">
                  Распознавание текста (OCR) и анализ через LLMost (модель из .env). Пожалуйста, подождите.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
        {/* Sidebar */}
      <nav className="fixed left-0 top-0 h-full w-16 md:w-20 border-r border-white/5 bg-black/40 flex flex-col items-center py-8 gap-8 z-50">
        <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Shield className="w-5 h-5 md:w-6 md:h-6 text-white" />
        </div>
        
        <div className="flex flex-col gap-4">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Главная' },
            { id: 'quest', icon: Target, label: state.segment === 'small' ? 'Диагностика' : 'Регламенты' },
            { id: 'audit', icon: FileSearch, label: state.segment === 'small' ? 'Анализ документов' : 'Сравнение' },
            { id: 'matrix', icon: AlertTriangle, label: 'Матрица рисков' },
            { id: 'profile', icon: User, label: 'Профиль' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "p-3 rounded-xl transition-all group relative",
                activeTab === item.id ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40" : "text-white/40 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className="w-5 h-5 md:w-6 md:h-6" />
              <span className="hidden md:block absolute left-full ml-4 px-2 py-1 bg-white text-black text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                {item.label}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-4">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-3 rounded-xl text-white/20 hover:text-white transition-colors"
          >
            <Settings className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pl-16 md:pl-20 min-h-screen">
        <header className="h-20 md:h-24 border-b border-white/5 flex items-center justify-between px-6 md:px-12 sticky top-0 bg-[#0A0A0A]/80 backdrop-blur-md z-40">
          <div className="flex flex-col">
            <h1 className="text-sm md:text-xl font-black tracking-tight uppercase truncate max-w-[200px] md:max-w-none">ЮРИДИЧЕСКИЙ РИСК-МЕНЕДЖМЕНТ</h1>
            <p className="hidden md:block text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold">Проверка юридических рисков - Сделаем твой юридический путь безопасным вместе!</p>
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            <button onClick={() => setActiveTab('profile')} className="h-8 w-8 md:h-10 md:w-10 rounded-full border border-white/10 p-0.5 hover:border-cyan-500 transition-colors">
              <img src={state.user.avatar} alt="Avatar" className="rounded-full" />
            </button>
          </div>
        </header>

        <div className="p-6 md:p-12 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-6xl mx-auto"
              >
                <div className="grid grid-cols-12 gap-8">
                    {/* Left Column: Calendar & Activity */}
                    <div className="col-span-12 lg:col-span-4 space-y-8">
                      {/* Calendar Integrated into Dashboard */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-3">
                        <CalendarIcon className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Дедлайны</h3>
                      </div>
                      <button className="text-[10px] font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest">Апрель 2026</button>
                    </div>
                    
                    <div className="grid grid-cols-7 gap-px bg-white/5 border border-white/5 rounded-xl overflow-hidden">
                      {['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].map((day, idx) => (
                        <div key={`${day}-${idx}`} className="bg-black/40 p-2 text-center text-[8px] font-bold text-white/40 uppercase tracking-widest">{day}</div>
                      ))}
                      {Array.from({ length: 30 }).map((_, i) => (
                        <div key={i} className={cn(
                          "bg-[#0A0A0A] p-2 min-h-[40px] relative group hover:bg-white/[0.02] transition-colors"
                        )}>
                          <span className="text-[10px] font-bold text-white/20">{i + 1}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 space-y-3">
                      {state.tasks.filter(t => t.deadline && t.status !== 'done').slice(0, 2).map((task, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                          <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">{task.deadline}: {task.title.substring(0, 20)}...</p>
                        </div>
                      ))}
                      {state.tasks.filter(t => t.deadline && t.status !== 'done').length === 0 && (
                        <p className="text-[10px] font-bold text-white/10 uppercase tracking-wider text-center py-2">Событий нет</p>
                      )}
                    </div>
                  </div>

                  {/* Activity History */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                    <div className="flex items-center gap-3 mb-8">
                      <Zap className="w-5 h-5 text-yellow-500" />
                      <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Активность</h3>
                    </div>
                    <div className="space-y-6">
                      {state.activityLogs.length === 0 ? (
                        <p className="text-[10px] font-bold text-white/10 uppercase tracking-wider text-center py-4">История действий пуста</p>
                      ) : (
                        state.activityLogs.slice(0, 3).map((log) => (
                          <div key={log.id} className="flex gap-4 items-start">
                            <div className={cn(
                              "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                              log.type === 'quest' ? "bg-cyan-500" : log.type === 'task' ? "bg-yellow-500" : "bg-violet-500"
                            )} />
                            <div>
                              <p className="text-xs font-medium leading-tight">{log.action}</p>
                              <p className="text-[9px] text-white/20 mt-1 uppercase tracking-wider">{log.timestamp}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Main Stats & Tasks */}
                <div className="col-span-12 lg:col-span-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Health Score Card */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Shield className="w-24 h-24" />
                      </div>
                      
                      <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest mb-8">Прочность</h3>
                      
                      {state.risks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
                            <Sparkles className="w-10 h-10 text-white/20" />
                          </div>
                          <p className="text-sm text-white/40 mb-6">Начните диагностику или загрузите документ, чтобы увидеть показатели защиты.</p>
                          <button 
                            onClick={() => setActiveTab('quest')}
                            className="px-6 py-3 bg-cyan-500 text-black text-[10px] font-bold uppercase tracking-widest rounded-xl hover:scale-105 transition-all"
                          >
                            Запустить квест
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="relative flex items-center justify-center mb-8">
                            <svg className="w-40 h-40 transform -rotate-90">
                              <circle cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-white/5" />
                              <motion.circle
                                cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="10" fill="transparent"
                                strokeDasharray={452.39}
                                initial={{ strokeDashoffset: 452.39 }}
                                animate={{ strokeDashoffset: 452.39 - (452.39 * state.healthScore) / 100 }}
                                className="text-cyan-500" strokeLinecap="round"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-5xl font-black">{state.healthScore}%</span>
                            </div>
                          </div>

                          <p className="text-xs text-white/60 text-center leading-relaxed mb-6">
                            {state.healthScore >= 80 ? (
                              <>Ваш бизнес защищен лучше, чем у {Math.floor(state.healthScore * 0.9 + 5)}% конкурентов в сегменте. <span className="text-emerald-400 font-bold">Отлично!</span></>
                            ) : state.healthScore >= 50 ? (
                              <>Ваш бизнес защищен лучше, чем у {Math.floor(state.healthScore * 0.8 + 2)}% конкурентов в сегменте. <span className="text-yellow-400 font-bold">Хорошо, но есть риски.</span></>
                            ) : (
                              <>Ваш бизнес защищен лучше, чем у {Math.floor(state.healthScore * 0.7)}% конкурентов в сегменте. <span className="text-rose-400 font-bold">Критично!</span></>
                            )}
                          </p>

                          <button 
                            onClick={() => setActiveTab('quest')}
                            className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 group/btn"
                          >
                            Продолжайте квест!
                            <ChevronRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Category Risk Indicators */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Сектора</h3>
                        <Badge variant="neon">Максимально 24</Badge>
                      </div>
                      <div className="space-y-4">
                        {[
                          { label: 'Человеческие ресурсы', score: state.categoryScores.hr, color: 'bg-cyan-500' },
                          { label: 'Инфо-безопасность', score: state.categoryScores.infosec, color: 'bg-violet-500' },
                          { label: 'Судебная практика', score: state.categoryScores.court, color: 'bg-rose-500' },
                          { label: 'Налоговый контроль', score: state.categoryScores.tax, color: 'bg-yellow-500' },
                        ].map((cat, idx) => (
                          <div key={idx}>
                            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-1.5">
                              <span className="text-white/40">{cat.label}</span>
                              <span className="text-white">{cat.score}</span>
                            </div>
                            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${(cat.score / 24) * 100}%` }}
                                className={cn("h-full", cat.color)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Task Backlog */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-3">
                        <ClipboardList className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Задачи</h3>
                      </div>
                      <button onClick={() => setIsTaskModalOpen(true)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {state.tasks.length === 0 ? (
                        <div className="col-span-full py-8 text-center bg-white/[0.01] border border-white/5 rounded-2xl">
                          <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Список задач пуст</p>
                        </div>
                      ) : (
                        state.tasks.slice(0, 8).map((task) => (
                          <div key={task.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-4">
                            <button onClick={() => toggleTask(task.id)} className={cn("w-5 h-5 rounded border flex items-center justify-center", task.status === 'done' ? "bg-emerald-500 border-emerald-500" : "border-white/20")}>
                              {task.status === 'done' && <CheckCircle2 className="w-3 h-3 text-black" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <h4 className={cn("font-bold text-xs truncate", task.status === 'done' && "line-through opacity-50")}>{task.title}</h4>
                              {task.deadline && (
                                <div className="flex items-center gap-1 mt-1">
                                  <CalendarIcon className="w-2 h-2 text-white/40" />
                                  <span className="text-[8px] text-white/40 uppercase tracking-widest">{task.deadline}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

            {activeTab === 'quest' && (
              <motion.div 
                key="quest"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="max-w-4xl mx-auto py-12"
              >
                {!state.selectedQuestCategory ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="col-span-full text-center mb-12">
                      <h2 className="text-4xl font-black mb-4">Выберите направление аудита</h2>
                      <p className="text-white/40">Каждый блок содержит критические вопросы для вашего бизнеса</p>
                    </div>
                    {[
                      { id: 'hr', label: 'Человеческие ресурсы', icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/10', desc: 'Найм, ГПХ, самозанятые и ТК РФ' },
                      { id: 'infosec', label: 'Инфобез', icon: Shield, color: 'text-violet-400', bg: 'bg-violet-500/10', desc: 'Персональные данные и коммерческая тайна' },
                      { id: 'court', label: 'Суды', icon: Gavel, color: 'text-rose-400', bg: 'bg-rose-500/10', desc: 'Договорная работа и судебные риски' },
                      { id: 'tax', label: 'Налоги', icon: Receipt, color: 'text-yellow-400', bg: 'bg-yellow-500/10', desc: 'Дробление бизнеса и налоговый комплаенс' },
                    ].map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setState(s => ({ ...s, selectedQuestCategory: cat.id as any, questStep: 0, isQuestCompleted: false }))}
                        className="group p-10 rounded-[40px] bg-white/[0.02] border border-white/5 hover:border-white/20 transition-all text-left relative overflow-hidden"
                      >
                        <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform", cat.bg)}>
                          <cat.icon className={cn("w-8 h-8", cat.color)} />
                        </div>
                        <h3 className="text-2xl font-bold mb-4">{cat.label}</h3>
                        <p className="text-white/40 leading-relaxed">{cat.desc}</p>
                        <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity">
                          <cat.icon className="w-24 h-24" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  state.questStep >= questions.length ? (
                    <div className="bg-white/[0.02] border border-white/5 rounded-[48px] p-12 text-center max-w-2xl mx-auto">
                      <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-8">
                        <CheckCircle className="w-12 h-12 text-emerald-400" />
                      </div>
                      <h2 className="text-4xl font-black mb-4">Квест пройден!</h2>
                      <div className="flex justify-center gap-8 mb-12">
                        <div className="text-center">
                          <span className="text-[10px] text-white/40 uppercase font-bold block mb-1">Итоговый счет</span>
                          <span className="text-3xl font-black text-cyan-400">{state.healthScore}%</span>
                        </div>
                        <div className="text-center">
                          <span className="text-[10px] text-white/40 uppercase font-bold block mb-1">Выявлено угроз</span>
                          <span className="text-3xl font-black text-rose-400">
                            {state.risks.filter(r => {
                              const catMap: Record<string, string> = {
                                hr: 'HR',
                                infosec: 'Инфобез',
                                court: 'Судебный',
                                tax: 'Налоги',
                                procurement: 'Закупки',
                                advertising: 'Реклама',
                                confidentiality: 'Конфиденциальность'
                              };
                              return state.selectedQuestCategory ? r.category === catMap[state.selectedQuestCategory] : true;
                            }).length}
                          </span>
                        </div>
                      </div>
                      {state.segment === 'large' ? (
                        <>
                          <p className="text-white/40 mb-12 max-w-md mx-auto">
                            Вы ответили на все вопросы. Для более глубокого анализа и выявления скрытых коллизий, загрузите основной регламент по этой теме.
                          </p>
                          
                          <div className="max-w-md mx-auto p-8 rounded-3xl border-2 border-dashed border-white/10 bg-white/[0.01] mb-12">
                            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                              <Upload className="w-6 h-6 text-cyan-400" />
                            </div>
                            <h4 className="text-sm font-bold mb-2">Загрузите итоговый документ</h4>
                            <p className="text-[10px] text-rose-400 font-bold uppercase tracking-widest mb-6">Внимание: Поддерживаются PDF и изображения</p>
                            <button 
                              onClick={() => questResultFileInputRef.current?.click()}
                              className="px-8 py-4 bg-cyan-500 text-black font-bold rounded-2xl hover:scale-105 transition-all shadow-lg shadow-cyan-500/20"
                            >
                              {isAnalyzing ? 'Анализ...' : 'Выбрать Файл'}
                            </button>
                            <input 
                              type="file" 
                              ref={questResultFileInputRef} 
                              onChange={handleFileUpload}
                              className="hidden" 
                              accept=".pdf,image/*"
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-white/40 mb-12 max-w-md mx-auto">
                          Спасибо за прохождение квеста! Мы подготовили рекомендации для вашего бизнеса.
                        </p>
                      )}

                      <div className="flex gap-4 justify-center">
                        <button 
                          onClick={() => setState(s => ({ ...s, selectedQuestCategory: null, questStep: 0 }))}
                          className="px-8 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-bold transition-all"
                        >
                          К выбору категорий
                        </button>
                        <button 
                          onClick={completeQuest}
                          className="px-8 py-4 bg-violet-500 text-white font-bold rounded-2xl hover:scale-105 transition-all shadow-lg shadow-violet-500/20"
                        >
                          Перейти к результатам (Матрица)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={cn(
                      "bg-white/[0.02] border border-white/5 rounded-3xl p-12 relative overflow-hidden max-w-2xl mx-auto",
                      state.segment === 'large' && "border-violet-500/20 bg-violet-500/[0.02]"
                    )}>
                      <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                        <motion.div 
                          className={cn("h-full", state.segment === 'small' ? "bg-cyan-500" : "bg-violet-500")}
                          initial={{ width: 0 }}
                          animate={{ width: `${(state.questStep / questions.length) * 100}%` }}
                        />
                      </div>

                      <div className="mb-12">
                        <div className="flex items-center justify-between mb-4">
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-[0.2em] block",
                            state.segment === 'small' ? "text-cyan-400" : "text-violet-400"
                          )}>
                            {state.segment === 'small' ? 'Диагностический квест' : 'Анализ регламентов'} • {state.questStep + 1} / {questions.length}
                          </span>
                          {state.selectedQuestCategory && (
                            <button 
                              onClick={() => setState(s => ({ ...s, selectedQuestCategory: null }))}
                              className="text-[10px] font-bold text-white/20 hover:text-white uppercase tracking-widest transition-colors"
                            >
                              Сменить категорию
                            </button>
                          )}
                        </div>
                        <h2 className="text-3xl font-bold leading-tight">
                          {state.segment === 'large' && <span className="text-violet-400 block text-sm mb-2 uppercase tracking-widest">Давай разберемся с твоими регламентами:</span>}
                          {currentQuestion.text}
                        </h2>
                        
                        {/* Document Upload in Quest */}
                        {currentQuestion.requiresUpload && state.segment === 'large' && (
                          <div className="mt-8 p-8 rounded-3xl border-2 border-dashed border-white/10 bg-white/[0.01] text-center">
                            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
                              <Upload className="w-6 h-6 text-violet-400" />
                            </div>
                            <h4 className="text-sm font-bold mb-2">Загрузите документ для анализа</h4>
                            <p className="text-[10px] text-rose-400 font-bold uppercase tracking-widest mb-6">Внимание: Поддерживаются PDF и изображения</p>
                            <button 
                              onClick={() => questInnerFileInputRef.current?.click()}
                              className="px-6 py-3 bg-violet-500 hover:bg-violet-600 rounded-2xl text-xs font-bold transition-all shadow-lg shadow-violet-500/20"
                            >
                              Выбрать Файл
                            </button>
                            <input 
                              type="file" 
                              ref={questInnerFileInputRef} 
                              onChange={handleFileUpload}
                              className="hidden" 
                              accept=".pdf,image/*"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-4">
                        {currentQuestion.options.map((option, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleQuestAnswer(option.impact, option.risk)}
                            className={cn(
                              "p-6 rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] text-left transition-all group flex items-center justify-between",
                              state.segment === 'small' ? "hover:border-cyan-500/50" : "hover:border-violet-500/50"
                            )}
                          >
                            <span className={cn(
                              "font-medium transition-colors",
                              state.segment === 'small' ? "group-hover:text-cyan-400" : "group-hover:text-violet-400"
                            )}>{option.text}</span>
                            <ChevronRight className={cn(
                              "w-5 h-5 text-white/20 group-hover:translate-x-1 transition-all",
                              state.segment === 'small' ? "group-hover:text-cyan-400" : "group-hover:text-violet-400"
                            )} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </motion.div>
            )}

            {activeTab === 'audit' && (
              <motion.div 
                key="audit"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-12"
              >
                {state.segment === 'large' && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-4 text-amber-400">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <p className="text-xs font-bold uppercase tracking-widest leading-relaxed">
                      Уведомление: Максимальная нагрузка до 10 документов в каждой категории для обеспечения точности анализа.
                    </p>
                  </div>
                )}

                {state.segment === 'small' ? (
                  <div className="space-y-8">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-2xl md:text-4xl font-black">Анализ ваших документов</h3>
                        <p className="text-sm text-white/40">Загружайте документы один за другим для мгновенной проверки рисков и саммари.</p>
                      </div>
                      <div className="flex gap-4 w-full md:w-auto">
                        <button 
                          onClick={() => auditFolderFileInputRef.current?.click()}
                          className="flex-1 md:flex-none px-8 py-4 bg-cyan-500 text-black rounded-2xl text-sm font-black hover:scale-105 transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
                        >
                          <Plus className="w-5 h-5" /> Загрузить файл
                        </button>
                        <input 
                          type="file" 
                          ref={auditFolderFileInputRef} 
                          onChange={(e) => handleFolderUpload(e, 'small_audit')} 
                          className="hidden"
                          accept=".pdf,image/*"
                        />
                      </div>
                    </div>

                    {state.summary && (
                      <div className="p-6 md:p-8 rounded-[32px] bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-white/10">
                        <div className="flex items-center gap-3 mb-4">
                          <Sparkles className="w-5 h-5 text-cyan-400" />
                          <h4 className="text-sm font-bold text-white/70 uppercase tracking-widest">Саммари последнего аудита</h4>
                        </div>
                        <div className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap max-h-[min(70vh,420px)] overflow-y-auto pr-2">
                          {state.summary}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4">
                      {state.regulations.filter(r => r.category === 'small_audit').length > 0 ? (
                        state.regulations.filter(r => r.category === 'small_audit').map(doc => (
                          <div key={doc.id} className="p-8 rounded-[40px] bg-white/[0.02] border border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between hover:border-cyan-500/20 transition-all group gap-6 relative overflow-hidden">
                            <div className="flex items-center gap-6 relative z-10">
                              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                                <FileText className="w-8 h-8" />
                              </div>
                              <div>
                                <h4 className="text-xl font-bold mb-1">{doc.title}</h4>
                                <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Загружен: {doc.lastUpdated}</p>
                                {doc.auditSummary && (
                                  <p className="text-xs text-white/45 mt-2 line-clamp-3 leading-relaxed">
                                    {doc.auditSummary.replace(/\*\*/g, "").slice(0, 280)}
                                    {doc.auditSummary.length > 280 ? "…" : ""}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-4 relative z-10">
                              <button 
                                onClick={() => { setSelectedRegForCompare(doc); setIsCompareModalOpen(true); }}
                                className="px-6 py-2 bg-white/5 hover:bg-violet-500 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                              >
                                Сравнить
                              </button>
                              <button 
                                onClick={() => {
                                  const parts = doc.content.split(/\n\n/).filter((x) => x.trim());
                                  const fr = formatDocumentFragments(
                                    parts.length ? parts : [doc.content.slice(0, 4000)],
                                    10,
                                    450
                                  );
                                  const summaryPart = doc.auditSummary
                                    ? `Саммари аудита:\n${doc.auditSummary.slice(0, 3500)}\n\n`
                                    : "";
                                  openLexi(
                                    {
                                      id: `audit-doc-${doc.id}`,
                                      title: doc.title,
                                      description: `${summaryPart}---\nФРАГМЕНТЫ ДОКУМЕНТА (цитируй при ответе):\n${fr}`,
                                      probability: 50,
                                      impact: 55,
                                      severity: "Средний",
                                      category: "Анализ",
                                      status: "open",
                                      recommendation:
                                        "Задай уточняющие вопросы — буду ссылаться на пункты и цитаты из фрагментов.",
                                    } as Risk,
                                    `Смотрю на «${doc.title}». Спрашивай по рискам — отвечу с цитатами «…» из текста.`
                                  );
                                }}
                                className="px-6 py-2 bg-white/5 hover:bg-cyan-500 hover:text-black rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                              >
                                Обсудить с ИИ
                              </button>
                              <button className="p-2 hover:bg-rose-500/20 rounded-lg transition-colors text-rose-500"><X className="w-5 h-5" /></button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-32 text-center border-4 border-dashed border-white/5 rounded-[40px] bg-white/[0.01]">
                          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-6">
                            <Upload className="w-10 h-10 text-white/10" />
                          </div>
                          <p className="text-white/40 font-bold uppercase tracking-widest">Перетащите сюда файлы или нажмите кнопку выше</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  !state.activeFolderId ? (
                    <>
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div>
                          <h3 className="text-2xl font-bold">Управление регламентами</h3>
                          <p className="text-sm text-white/40">Добавляйте и сравнивайте внутренние политики компании</p>
                        </div>
                        <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                          <button 
                            onClick={handleCompareAll}
                            className="w-full md:w-auto px-6 py-3 bg-violet-500 hover:bg-violet-600 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
                          >
                            <Search className="w-4 h-4" />
                            Сравнить всё в папке
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {DOCUMENT_CATEGORIES.map(cat => {
                          const docCount = state.regulations.filter(r => r.category === cat.id).length;
                          const ragCount = state.ragDocuments.length;
                          const count = cat.id === 'checklists' ? ragCount : docCount;
                          return (
                            <button
                              key={cat.id}
                              onClick={() => setState(s => ({ ...s, activeFolderId: cat.id }))}
                              className="group p-8 rounded-[32px] bg-white/[0.02] border border-white/5 hover:border-violet-500/30 transition-all text-left relative overflow-hidden"
                            >
                              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 group-hover:bg-violet-500/20 group-hover:text-violet-400 transition-colors">
                                <cat.icon className="w-6 h-6" />
                              </div>
                              <h4 className="font-bold text-lg mb-1">{cat.title}</h4>
                              <p className="text-xs text-white/40">{count} документов {count > 0 && `(Лимит: ${count}/10)`}</p>
                              <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-10 transition-opacity">
                                <cat.icon className="w-20 h-20" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-8">
                      <button 
                        onClick={() => setState(s => ({ ...s, activeFolderId: null }))}
                        className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
                      >
                        <ArrowLeft className="w-4 h-4" /> Назад к папкам
                      </button>
                      
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <h3 className="text-2xl md:text-3xl font-black">{DOCUMENT_CATEGORIES.find(c => c.id === state.activeFolderId)?.title}</h3>
                        <div className="flex gap-4 w-full md:w-auto">
                          <button 
                            disabled={state.regulations.filter(r => r.category === state.activeFolderId).length >= 10}
                            onClick={() => auditFolderFileInputRef.current?.click()}
                            className="flex-1 md:flex-none px-6 py-3 bg-violet-500 text-white rounded-2xl text-sm font-bold hover:scale-105 transition-all shadow-lg shadow-violet-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:scale-100"
                          >
                            <Plus className="w-4 h-4" /> {state.activeFolderId === 'checklists' ? 'Загрузить чек-лист' : 'Загрузить документ'}
                          </button>
                          <input 
                            type="file" 
                            ref={auditFolderFileInputRef} 
                            onChange={(e) => handleFolderUpload(e, state.activeFolderId!)} 
                            className="hidden"
                            accept=".pdf,image/*"
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        {state.activeFolderId === 'checklists' ? (
                          state.ragDocuments.length > 0 ? (
                            state.ragDocuments.map(doc => (
                              <div key={doc.id} className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between hover:border-violet-500/20 transition-all group gap-4">
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400">
                                    <BookOpen className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="font-bold">{doc.title}</h4>
                                    <p className="text-[10px] text-white/40 uppercase tracking-widest">{doc.lastUpdated}</p>
                                  </div>
                                </div>
                                <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button className="flex-1 md:flex-none px-4 py-2 hover:bg-white/5 rounded-lg transition-colors border border-white/10 text-xs font-bold">Открыть</button>
                                  <button className="p-2 hover:bg-rose-500/20 rounded-lg transition-colors text-rose-500"><X className="w-4 h-4" /></button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.01]">
                              <p className="text-white/40">В базе знаний пока нет чек-листов. Загрузите свои чек-листы для автоматизации проверок.</p>
                            </div>
                          )
                        ) : (
                          state.regulations.filter(r => r.category === state.activeFolderId).length > 0 ? (
                            state.regulations.filter(r => r.category === state.activeFolderId).map(doc => (
                              <div key={doc.id} className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between hover:border-violet-500/20 transition-all group gap-4">
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="font-bold">{doc.title}</h4>
                                    <p className="text-[10px] text-white/40 uppercase tracking-widest">{doc.lastUpdated}</p>
                                    {doc.auditSummary && (
                                      <p className="text-[11px] text-white/45 mt-1 line-clamp-2">
                                        {doc.auditSummary.replace(/\*\*/g, "").slice(0, 160)}
                                        {doc.auditSummary.length > 160 ? "…" : ""}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2 w-full md:w-auto">
                                  {doc.risks && doc.risks.length > 0 && <Badge variant="danger">Риск</Badge>}
                                  <button 
                                    onClick={() => { setSelectedRegForCompare(doc); setIsCompareModalOpen(true); }}
                                    className="flex-1 md:flex-none px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                                  >
                                    Сравнить
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const parts = doc.content.split(/\n\n/).filter((x) => x.trim());
                                      const fr = formatDocumentFragments(
                                        parts.length ? parts : [doc.content.slice(0, 4000)],
                                        10,
                                        450
                                      );
                                      const summaryPart = doc.auditSummary
                                        ? `Саммари аудита:\n${doc.auditSummary.slice(0, 3500)}\n\n`
                                        : "";
                                      openLexi(
                                        {
                                          id: `reg-doc-${doc.id}`,
                                          title: `Анализ: ${doc.title}`,
                                          description: `${summaryPart}---\nФРАГМЕНТЫ ДОКУМЕНТА (цитируй при ответе):\n${fr}`,
                                          probability: 45,
                                          impact: 50,
                                          severity: "Средний",
                                          category: "Документ",
                                          status: "open",
                                          recommendation: "Задай вопрос — отвечу с цитатами из фрагментов.",
                                        } as Risk,
                                        `На связи по «${doc.title}». Можем разобрать формулировки с цитатами «…».`
                                      );
                                    }}
                                    className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                                  >
                                    <MessageSquare className="w-4 h-4 text-white/40" />
                                  </button>
                                  <button className="p-2 hover:bg-white/5 rounded-lg transition-colors"><X className="w-4 h-4 text-white/20" /></button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.01]">
                              <p className="text-white/40">В этой папке пока нет документов.</p>
                            </div>
                          )
                        )}
                      </div>

                      {state.activeFolderId !== 'checklists' && state.summary && (
                        <div className="mt-12 p-6 md:p-8 rounded-[40px] bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-white/10 relative overflow-hidden">
                          <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-6">
                              <Sparkles className="w-6 h-6 text-cyan-400 animate-pulse" />
                              <h3 className="text-xl font-bold">Саммаризация и итог по папке</h3>
                            </div>
                            <div className="p-4 md:p-6 rounded-2xl bg-black/40 border border-white/5 mb-6">
                              <p className="text-sm text-white/80 leading-relaxed italic mb-4">"{state.summary}"</p>
                              
                              {/* Display contradictions from state risks for THIS category only if applicable */}
                              <div className="mt-4 space-y-3 pt-4 border-t border-white/10">
                                <h4 className="text-[10px] font-bold text-rose-400 uppercase tracking-widest flex items-center gap-2">
                                  <AlertCircle className="w-3 h-3" /> ОБНАРУЖЕНЫ РИСКИ В ПАПКЕ:
                                </h4>
                                {(() => {
                                  const fid = state.activeFolderId;
                                  if (!fid) return null;
                                  const fromRegs = state.regulations
                                    .filter((r) => r.category === fid)
                                    .flatMap((r) => r.risks || []);
                                  const fromMatrix = state.risks.filter((r) => r.sourceFolderId === fid);
                                  const seen = new Set<string>();
                                  const merged = [...fromRegs, ...fromMatrix].filter((r) => {
                                    const key = r.id || `${r.title}-${(r.description || "").slice(0, 40)}`;
                                    if (seen.has(key)) return false;
                                    seen.add(key);
                                    return true;
                                  });
                                  if (merged.length === 0) {
                                    return (
                                      <p className="text-xs text-white/45">
                                        По документам этой папки отдельные риски не зафиксированы (или аудит ещё не выполнялся). Общий реестр рисков — в разделе «Матрица».
                                      </p>
                                    );
                                  }
                                  return merged.slice(0, 8).map((risk) => {
                                    const desc = risk.description || "";
                                    const short =
                                      desc.length > 140 ? `${desc.slice(0, 137)}…` : desc;
                                    return (
                                      <div
                                        key={risk.id}
                                        className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/10 text-xs text-rose-300"
                                      >
                                        <span className="font-semibold text-rose-200">{risk.title}</span>
                                        {short ? (
                                          <span className="text-rose-300/90">: {short}</span>
                                        ) : null}
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          </div>
                          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none hidden md:block">
                            <CheckCircle className="w-64 h-64 text-cyan-500" />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </motion.div>
            )}

            {activeTab === 'matrix' && (
              <motion.div 
                key="matrix"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-8"
              >
                {/* Category Impact Indicators */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    { label: 'HR & Подрядчики', score: state.categoryScores.hr, limit: 15, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
                    { label: 'Инфобез & КТ', score: state.categoryScores.infosec, limit: 15, color: 'text-violet-400', bg: 'bg-violet-500/10' },
                    { label: 'Судебный комплаенс', score: state.categoryScores.court, limit: 15, color: 'text-rose-400', bg: 'bg-rose-500/10' },
                    { label: 'Налоговый контроль', score: state.categoryScores.tax, limit: 15, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                  ].map((cat, idx) => (
                    <div key={idx} className={cn("p-6 rounded-3xl border border-white/5", cat.bg)}>
                      <div className="flex justify-between items-start mb-4">
                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest leading-tight">{cat.label}</span>
                        {cat.score >= cat.limit ? (
                          <Badge variant="danger" className="animate-pulse">Критично</Badge>
                        ) : cat.score > 0 ? (
                          <Badge variant="warning">Внимание</Badge>
                        ) : (
                          <Badge variant="neon">Безопасно</Badge>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className={cn("text-3xl font-black", cat.color)}>{cat.score}</span>
                        <span className="text-white/20 text-xs font-bold uppercase tracking-widest">/ {cat.limit}+</span>
                      </div>
                      <p className="text-[10px] text-white/40 mt-2 uppercase tracking-wide">Баллы риска</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">

                  <div className="flex items-center justify-between mb-12">
                    <div>
                      <h3 className="text-xl font-bold">Матрица рисков</h3>
                      <p className="text-xs text-white/40">Визуализация вероятности и ущерба выявленных угроз</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-rose-500" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Критично</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-orange-500" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Высокий</span>
                      </div>
                    </div>
                  </div>

                  <div className="h-[400px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <XAxis 
                          type="number" 
                          dataKey="probability" 
                          name="Probability" 
                          unit="%" 
                          domain={[0, 100]} 
                          stroke="#333"
                          label={{ value: 'Вероятность', position: 'bottom', fill: '#666', fontSize: 10 }}
                        />
                        <YAxis 
                          type="number" 
                          dataKey="impact" 
                          name="Impact" 
                          unit="%" 
                          domain={[0, 100]} 
                          stroke="#333"
                          label={{ value: 'Ущерб', angle: -90, position: 'left', fill: '#666', fontSize: 10 }}
                        />
                        <ZAxis type="number" dataKey="impact" range={[100, 1000]} />
                        <Tooltip 
                          cursor={{ strokeDasharray: '3 3' }} 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-black/90 border border-white/10 p-4 rounded-xl backdrop-blur-md shadow-2xl">
                                  <p className="font-bold text-sm mb-1">{data.title}</p>
                                  <p className="text-[10px] text-white/40 mb-2">{data.description}</p>
                                  <div className="flex items-center gap-4">
                                    <div className="text-[10px]">
                                      <span className="text-white/40 block">Вер-ть</span>
                                      <span className="font-bold">{data.probability}%</span>
                                    </div>
                                    <div className="text-[10px]">
                                      <span className="text-white/40 block">Ущерб</span>
                                      <span className="font-bold">{data.impact}%</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter name="Risks" data={state.risks}>
                          {state.risks.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.severity === 'Критично' ? '#f43f5e' : entry.severity === 'Высокий' ? '#fb923c' : '#eab308'} 
                              className="drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]"
                            />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Risk Detailed List with Lexi Chat */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {state.risks.map((risk) => (
                    <div key={risk.id} className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <Badge variant={risk.severity === 'Критично' ? 'danger' : 'warning'}>{risk.severity}</Badge>
                          <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">{risk.category}</span>
                        </div>
                        <h4 className="text-lg font-bold mb-2">{risk.title}</h4>
                        <p className="text-sm text-white/40 mb-6">{risk.description}</p>
                      </div>
                      
                      <div className="flex gap-3">
                        <button 
                          onClick={() => {
                            void createTaskFromRisk(risk);
                            setSelectedRisk(risk);
                            setIsActionPlanOpen(true);
                          }}
                          className="flex-1 py-3 bg-cyan-500 text-black text-xs font-bold rounded-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                        >
                          Исправить <ArrowRight className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => openLexi(risk)}
                          className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group"
                        >
                          <MessageSquare className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'profile' && (
              <motion.div 
                key="profile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="max-w-4xl mx-auto"
              >
                <div className="bg-white/[0.02] border border-white/5 rounded-[40px] p-8 md:p-12 flex flex-col md:flex-row gap-8 md:gap-12 items-center">
                  <div className="relative">
                    <div className="w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-cyan-500/20 p-2">
                      <img src={state.user.avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                    </div>
                  </div>

                  <div className="flex-1 text-center md:text-left">
                    <h2 className="text-3xl md:text-4xl font-black mb-2">{state.user.name}</h2>
                    <p className="text-cyan-400 font-bold mb-6">{state.user.role} @ {state.user.company}</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                      <div className="bg-white/5 p-4 rounded-2xl">
                        <span className="text-[10px] text-white/40 uppercase font-bold block mb-1">Компания</span>
                        <span className="text-lg font-black">{state.user.company}</span>
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl">
                        <span className="text-[10px] text-white/40 uppercase font-bold block mb-1">Статус соответствия</span>
                        <span className="text-lg font-black text-cyan-400">{state.healthScore}% защищено</span>
                      </div>
                    </div>

                    <div className="flex gap-4 justify-center md:justify-start">
                      <button 
                        onClick={() => { setProfileForm(state.user); setIsEditingProfile(true); }}
                        className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold transition-all flex items-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        Редактировать
                      </button>
                      <button 
                        onClick={handleLogout}
                        className="px-6 py-3 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-xl text-sm font-bold transition-all"
                      >
                        Выйти
                      </button>
                    </div>
                  </div>
                </div>

                {/* Risk List */}
                <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold font-mono uppercase tracking-widest text-white/40">Реестр угроз</h3>
                    <Badge variant="neon">{state.risks.length}</Badge>
                  </div>
                  <div className="space-y-4">
                    {state.risks.map((risk) => (
                      <div key={risk.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-4 group">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">{risk.category}</span>
                            <div className={cn("w-1.5 h-1.5 rounded-full", risk.severity === 'Критично' ? "bg-rose-500" : risk.severity === 'Высокий' ? "bg-orange-500" : "bg-yellow-500")} />
                          </div>
                          <h4 className="font-bold text-xs group-hover:text-cyan-400 transition-colors">{risk.title}</h4>
                        </div>
                        <button 
                          onClick={() => { setSelectedRisk(risk); setIsActionPlanOpen(true); }}
                          className="px-4 py-2 bg-white/5 hover:bg-cyan-500 hover:text-black rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                        >
                          План
                        </button>
                      </div>
                    ))}
                    {state.risks.length === 0 && (
                      <p className="text-center py-10 text-[10px] font-bold text-white/20 uppercase tracking-widest">Рисков не выявлено</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Profile Edit Modal */}
      <AnimatePresence>
        {isEditingProfile && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsEditingProfile(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">Редактировать профиль</h3>
                <button onClick={() => setIsEditingProfile(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Имя</label>
                  <input 
                    type="text" 
                    value={profileForm.name}
                    onChange={(e) => setProfileForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Компания</label>
                  <input 
                    type="text" 
                    value={profileForm.company}
                    onChange={(e) => setProfileForm(p => ({ ...p, company: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Должность</label>
                  <input 
                    type="text" 
                    value={profileForm.role}
                    onChange={(e) => setProfileForm(p => ({ ...p, role: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Ссылка на аватар</label>
                  <input 
                    type="text" 
                    value={profileForm.avatar}
                    onChange={(e) => setProfileForm(p => ({ ...p, avatar: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                <button 
                  onClick={updateProfile}
                  className="w-full py-4 bg-cyan-500 text-black font-bold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Сохранить изменения
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isTaskModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTaskModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">Новая задача</h3>
                <button onClick={() => setIsTaskModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Название задачи</label>
                  <input 
                    type="text" 
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Например: Проверить договор аренды"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Срок исполнения</label>
                  <input 
                    type="date" 
                    value={newTaskDeadline}
                    onChange={(e) => setNewTaskDeadline(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors text-white/70"
                  />
                </div>

                {!currentUser && (
                  <p className="text-xs text-white/35 leading-relaxed">
                    Без входа задача сохраняется в этом браузере и показывается в блоке «Задачи» на главной.
                  </p>
                )}

                <button 
                  onClick={addTask}
                  className="w-full py-4 bg-cyan-500 text-black font-bold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Создать задачу
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Regulation Modal */}
      <AnimatePresence>
        {isRegModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsRegModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold">Новый регламент</h3>
                <button onClick={() => setIsRegModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Название регламента</label>
                  <input 
                    type="text" 
                    value={newRegTitle}
                    onChange={(e) => setNewRegTitle(e.target.value)}
                    placeholder="Например: Положение о КТ"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Содержание регламента</label>
                  <textarea 
                    value={newRegContent}
                    onChange={(e) => setNewRegContent(e.target.value)}
                    placeholder="Введите текст регламента или его основные пункты..."
                    rows={6}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-colors resize-none"
                  />
                </div>

                <button 
                  onClick={addRegulation}
                  className="w-full py-4 bg-violet-500 text-white font-bold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Сохранить регламент
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Compare Modal */}
      <AnimatePresence>
        {isCompareModalOpen && selectedRegForCompare && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsCompareModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="flex items-center justify-between mb-8 shrink-0">
                <div>
                  <h3 className="text-2xl font-bold">Сравнение регламентов</h3>
                  <p className="text-sm text-white/40">Анализ коллизий и различий между версиями</p>
                </div>
                <button onClick={() => setIsCompareModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-y-auto pr-4">
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-violet-400 uppercase tracking-widest">{selectedRegForCompare.title}</span>
                    <Badge variant="neon">Документ А</Badge>
                  </div>
                  <div className="p-6 bg-white/[0.03] rounded-2xl border border-white/5 text-sm leading-relaxed text-white/60">
                    {selectedRegForCompare.content}
                  </div>
                </div>

                <div className="space-y-4 flex flex-col h-full overflow-hidden">
                  <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex flex-col gap-3 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Сравнить с:</span>
                      <div className="flex gap-2">
                        <Badge variant="neon">Документ Б</Badge>
                        <Badge variant="neon" className="bg-violet-500/20 text-violet-400 border-violet-500/20">Мульти-анализ</Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto space-y-4 p-4 border border-white/5 rounded-2xl bg-white/[0.01]">
                    <div className="space-y-3">
                      <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest px-2">Выберите источники (несколько):</h4>
                      
                      {/* AI Prototype Option */}
                      <label className="flex items-center gap-4 p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/10 hover:border-cyan-500/30 transition-all cursor-pointer group">
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 rounded-lg border-white/10 bg-black/40 checked:bg-cyan-500 transition-all"
                          checked={compareWithRegIds.length === 0}
                          onChange={() => setCompareWithRegIds([])}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-cyan-400" />
                            <span className="font-bold text-sm">ИИ Прототип (Юрист-Стандарт)</span>
                          </div>
                          <p className="text-[10px] text-white/30 lowercase mt-1 font-medium">Сравнение с эталонными нормами законодательства и лучшими практиками.</p>
                        </div>
                      </label>

                      {state.regulations.filter(r => r.id !== selectedRegForCompare.id).map(r => (
                        <label key={r.id} className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-violet-500/30 transition-all cursor-pointer group">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded-lg border-white/10 bg-black/40 checked:bg-violet-500 transition-all"
                            checked={compareWithRegIds.includes(r.id)}
                            onChange={() => {
                              if (compareWithRegIds.includes(r.id)) {
                                setCompareWithRegIds(compareWithRegIds.filter(id => id !== r.id));
                              } else {
                                setCompareWithRegIds([...compareWithRegIds, r.id]);
                              }
                            }}
                          />
                          <div className="flex-1">
                            <span className="font-bold text-sm group-hover:text-violet-400 transition-colors uppercase tracking-tight">{r.title}</span>
                            <p className="text-[10px] text-white/30 uppercase mt-1 tracking-widest font-bold font-mono">{r.lastUpdated}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              <div className="mt-8 pt-8 border-t border-white/5 flex justify-end gap-4 shrink-0">
                <button 
                  onClick={() => setIsCompareModalOpen(false)}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold transition-colors"
                >
                  Закрыть
                </button>
                <button 
                  disabled={isComparing}
                  onClick={async () => {
                    if (!selectedRegForCompare) return;
                    setIsComparing(true);
                    try {
                      let res;
                      if (compareWithRegIds.length === 0) {
                        res = await analyzeDocument(
                          new File([selectedRegForCompare.content], selectedRegForCompare.title, { type: 'text/plain' }),
                          selectedRegForCompare.category
                        );
                      } else {
                        const docs = [
                          { title: selectedRegForCompare.title, content: selectedRegForCompare.content },
                          ...compareWithRegIds.map(id => {
                            const r = state.regulations.find(reg => reg.id === id);
                            return r ? { title: r.title, content: r.content } : null;
                          }).filter((r): r is { title: string, content: string } => !!r)
                        ];
                        
                        if (docs.length > 2) {
                          const multiRes = await compareAllDocuments(docs);
                          res = {
                            conflicts: multiRes.conflicts,
                            summary: multiRes.summary,
                            risk: { title: 'Перекрестная коллизия', description: multiRes.summary, severity: 'Средний', recommendation: 'Проверить все документы' }
                          };
                        } else {
                          res = await compareTwoDocuments(docs[0], docs[1]);
                        }
                      }
                      setCompareResult(res as any);
                      setIsCompareResultOpen(true);
                      setIsCompareModalOpen(false);
                      logActivity(`Проведено сравнение: ${selectedRegForCompare.title}`, 'regulation');
                    } catch (e) {
                      toast.error('Ошибка сравнения');
                    } finally {
                      setIsComparing(false);
                    }
                  }}
                  className="px-6 py-3 bg-violet-500 text-white rounded-xl text-sm font-bold hover:scale-105 disabled:opacity-50 transition-all"
                >
                  {isComparing ? 'Анализ...' : 'Запустить сравнение'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Action Plan Modal */}
      <AnimatePresence>
        {isActionPlanOpen && selectedRisk && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsActionPlanOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <Badge variant="danger">{selectedRisk.severity}</Badge>
                  <h3 className="text-2xl font-bold mt-2">{selectedRisk.title}</h3>
                </div>
                <button onClick={() => setIsActionPlanOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <h4 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">План действий</h4>
                  <div className="space-y-3">
                    {selectedRisk.actionPlan ? (
                      Array.isArray(selectedRisk.actionPlan) ? (
                        selectedRisk.actionPlan.map((step, i) => (
                          <div key={i} className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/5 group/step">
                            <div className="w-6 h-6 rounded-full bg-cyan-500 text-black text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </div>
                            <p className="text-sm leading-relaxed flex-1">{step}</p>
                            <button 
                              onClick={() => handleAddActionToTasks(step)}
                              className="p-2 bg-white/5 hover:bg-cyan-500 hover:text-black rounded-lg transition-all opacity-0 group-hover/step:opacity-100"
                              title="Добавить в задачи"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedRisk.actionPlan}</p>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-white/40 italic">План действий формируется...</p>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => setIsActionPlanOpen(false)}
                  className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-bold transition-all"
                >
                  Понятно, приступаю
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lexi Chat Sidebar */}
      <AnimatePresence>
        {isLexiOpen && chatRisk && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsLexiOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110]"
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-[#121212] border-l border-white/10 z-[120] flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-pink-500/20 p-0.5 border border-pink-500/30">
                      <img 
                        src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150&h=150" 
                        alt="Lexi" 
                        className="w-full h-full rounded-lg object-cover"
                      />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">Чат с Лекси</h3>
                      <p className="text-[10px] text-pink-400 font-bold uppercase tracking-widest">Юридический ассистент</p>
                    </div>
                  </div>
                <button onClick={() => setIsLexiOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                {messages.map((msg, i) => (
                  <div key={i} className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}>
                    <div className={cn(
                      "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed relative",
                      msg.role === 'user' ? "bg-cyan-500 text-black font-medium rounded-tr-none" : "bg-white/5 border border-white/5 rounded-tl-none ml-2"
                    )}>
                      {msg.role === 'assistant' && (
                        <div className="absolute -left-10 top-0 w-8 h-8 rounded-lg overflow-hidden border border-pink-500/30">
                          <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150&h=150" alt="Lexi" className="w-full h-full object-cover" />
                        </div>
                      )}
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isLexiLoading && (
                  <div className="flex items-center gap-2 text-white/40 text-xs italic">
                    <Loader2 className="w-3 h-3 animate-spin" /> Лекси думает...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-6 border-t border-white/5 bg-black/20">
                <div className="relative">
                  <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLexiChat()}
                    placeholder="Задайте вопрос Лекси..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-6 pr-14 py-4 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
                  />
                  <button 
                    onClick={handleLexiChat}
                    disabled={!input.trim() || isLexiLoading}
                    className="absolute right-2 top-2 bottom-2 w-10 rounded-xl bg-cyan-500 text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">Настройки системы</h3>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">Сегмент бизнеса</h4>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setState(s => ({ ...s, segment: 'small' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-xs font-bold transition-all",
                        state.segment === 'small' ? "bg-cyan-500 text-black" : "bg-white/5 text-white/40 hover:bg-white/10"
                      )}
                    >
                      Малый бизнес
                    </button>
                    <button 
                      onClick={() => setState(s => ({ ...s, segment: 'large' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-xs font-bold transition-all",
                        state.segment === 'large' ? "bg-violet-500 text-white" : "bg-white/5 text-white/40 hover:bg-white/10"
                      )}
                    >
                      Корпорация
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">Уведомления</h4>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Критические риски</span>
                    <div className="w-10 h-5 bg-cyan-500 rounded-full relative">
                      <div className="absolute right-1 top-1 bottom-1 w-3 bg-black rounded-full" />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Compare All Loading Overlay */}
      <AnimatePresence>
        {isComparingAll && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative flex flex-col items-center gap-8 text-center"
            >
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Search className="w-8 h-8 text-violet-400" />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-2">Перекрестный анализ регламентов</h3>
                <p className="text-white/40 max-w-xs mx-auto">ИИ проверяет все документы на наличие логических противоречий и правовых коллизий...</p>
              </div>
              <div className="flex gap-2">
                <Badge variant="neon">OCR</Badge>
                <Badge variant="neon">NLP</Badge>
                <Badge variant="neon">Legal-LLM</Badge>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* LNA Sync Modal - Removed */}
      <AnimatePresence>
      </AnimatePresence>

      {/* Compare All Result Modal */}
      {/* Global Analysis Overlay */}
      <AnimatePresence>
        {(isExtracting || isAnalyzing) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative w-64 h-80 mb-12">
              {/* Document Mockup */}
              <motion.div 
                animate={{ 
                  rotateY: [0, 10, 0, -10, 0],
                  scale: [1, 1.02, 1]
                }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                className="w-full h-full bg-white/[0.03] border border-white/20 rounded-2xl p-8 shadow-2xl relative overflow-hidden"
              >
                {/* Skeleton Content */}
                <div className="space-y-4">
                  <div className="h-2 w-1/2 bg-white/10 rounded" />
                  <div className="h-2 w-full bg-white/10 rounded" />
                  <div className="h-2 w-full bg-white/10 rounded" />
                  <div className="h-2 w-3/4 bg-white/10 rounded" />
                  <div className="mt-8 h-2 w-1/3 bg-white/20 rounded" />
                  <div className="h-2 w-full bg-white/10 rounded" />
                  <div className="h-2 w-full bg-white/10 rounded" />
                </div>

                {/* Scanning Laser */}
                <motion.div 
                  animate={{ top: ['-10%', '110%'] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                  className="absolute left-0 right-0 h-[2px] bg-cyan-400 shadow-[0_0_15px_3px_rgba(34,211,238,0.8)] z-20"
                />
                
                {/* Light Sweep */}
                <motion.div 
                  animate={{ top: ['-10%', '110%'] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "linear", delay: 0.1 }}
                  className="absolute left-0 right-0 h-20 bg-gradient-to-b from-cyan-400/20 to-transparent pointer-events-none opacity-50"
                />
              </motion.div>

              {/* Orbiting particles */}
              <div className="absolute inset-0 -m-8 pointer-events-none">
                {[0, 72, 144, 216, 288].map((angle, i) => (
                  <motion.div
                    key={i}
                    animate={{ rotate: 360 }}
                    transition={{ duration: 10 + i, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0"
                  >
                    <div 
                      className="w-2 h-2 rounded-full bg-cyan-500/40 blur-sm"
                      style={{ transform: `translate(140px) rotate(${angle}deg)` }}
                    />
                  </motion.div>
                ))}
              </div>
            </div>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-4xl font-black tracking-tighter text-white">
                  {isExtracting ? "СКАНИРОВАНИЕ..." : "ИИ-АНАЛИЗ..."}
                </h2>
                <div className="flex items-center justify-center gap-4 text-cyan-400 font-mono text-[10px] tracking-[0.4em] uppercase">
                  <span className="w-12 h-[1px] bg-cyan-900" />
                  {isExtracting ? "Обработка слоев документа" : "Поиск коллизий и рисков"}
                  <span className="w-12 h-[1px] bg-cyan-900" />
                </div>
              </div>
              
              <p className="text-white/40 text-xs max-w-sm mx-auto leading-relaxed">
                {isExtracting 
                  ? "Модуль OCR (TeraSoft): загрузка файла, извлечение текста в рамках сессии браузера, затем саммари и анализ по метрикам."
                  : "ИИ сопоставляет условия с регламентами и базой знаний, выявляет коллизии и формирует выводы по шаблону аудита."
                }
              </p>

              <div className="flex items-center justify-center gap-2">
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                      scale: [1, 1.5, 1],
                      backgroundColor: ['rgba(34,211,238,0.2)', 'rgba(34,211,238,1)', 'rgba(34,211,238,0.2)']
                    }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    className="w-1.5 h-1.5 rounded-full"
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCompareResultOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsCompareResultOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full bg-[#121212] border border-white/10 rounded-[40px] p-10 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto",
                state.segment === 'large' ? "max-w-4xl" : "max-w-2xl"
              )}
            >
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <CheckCircle className="w-40 h-40 text-emerald-500" />
              </div>

              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">Результат сравнения</h3>
                    <p className="text-sm text-white/40">Анализ завершен успешно</p>
                  </div>
                </div>
                <button onClick={() => setIsCompareResultOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className={`p-6 rounded-3xl border ${(allCompareResult?.healthScore && allCompareResult.healthScore < 80) || (compareResult?.conflicts && compareResult.conflicts.length > 0) ? 'bg-rose-500/5 border-rose-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                  <p className={`${(allCompareResult?.healthScore && allCompareResult.healthScore < 80) || (compareResult?.conflicts && compareResult.conflicts.length > 0) ? 'text-rose-400' : 'text-emerald-400'} font-medium leading-relaxed`}>
                    {compareResult?.summary || allCompareResult?.summary || 'В ходе анализа критических противоречий и правовых коллизий не выявлено.'}
                  </p>
                </div>

                {(compareResult?.conflicts || allCompareResult?.conflicts) && (compareResult?.conflicts?.length || 0) + (allCompareResult?.conflicts?.length || 0) > 0 && (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">Выявленные коллизии:</h4>
                    {(compareResult?.conflicts || []).map((conflict, i) => (
                      <div key={`c-${i}`} className="p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-white/80 flex gap-4">
                        <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
                        {conflict}
                      </div>
                    ))}
                    {(allCompareResult?.conflicts || []).map((conflict, i) => (
                      <div key={`ac-${i}`} className="p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-white/80 flex gap-4">
                        <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
                        {conflict}
                      </div>
                    ))}
                  </div>
                )}

                {compareResult?.risk && (
                  <div className="p-4 rounded-2xl bg-violet-500/5 border border-violet-500/20">
                    <div className="flex items-center justify-between mb-2">
                       <h4 className="text-xs font-bold uppercase tracking-widest text-violet-400">Рекомендуемый риск:</h4>
                       <Badge variant="danger">{compareResult.risk.severity}</Badge>
                    </div>
                    <p className="text-sm font-bold text-white mb-1">{compareResult.risk.title}</p>
                    <p className="text-xs text-white/60 mb-4">{compareResult.risk.description}</p>
                    <button 
                      onClick={() => {
                        const r = compareResult.risk as Risk;
                        openLexi(
                          r,
                          `Привет! Сравнили документы — есть темы для разговора. Начнём с «${r.title || 'риска'}»?`
                        );
                        setIsCompareResultOpen(false);
                      }}
                      className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors uppercase tracking-widest flex items-center gap-2"
                    >
                      Обсудить с Лекси <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Проверено источников</div>
                    <div className="text-2xl font-bold">
                      {state.regulations.filter(r => r.category === state.activeFolderId).length + (state.activeFolderId === 'lna_sync' ? state.ragDocuments.length : 0)}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Оценка соответствия</div>
                    <div className={`text-2xl font-bold ${allCompareResult?.healthScore && allCompareResult.healthScore < 80 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {allCompareResult?.healthScore || 100}%
                    </div>
                  </div>
                </div>

                {state.segment === 'large' && (() => {
                  const merged = [...(compareResult?.conflicts ?? []), ...(allCompareResult?.conflicts ?? [])];
                  const seen = new Set<string>();
                  const uniqueConflicts = merged.filter((c) => {
                    const key = c.trim().slice(0, 400);
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  });
                  const scatterRows: { id: string; title: string; description: string; probability: number; impact: number; severity: Risk['severity'] }[] =
                    uniqueConflicts.map((description, i) => ({
                      id: `cmp-c-${i}`,
                      title: `Коллизия ${i + 1}`,
                      description: description.length > 280 ? `${description.slice(0, 277)}…` : description,
                      probability: Math.min(92, 45 + (i % 7) * 6),
                      impact: Math.min(95, 50 + ((i * 13) % 40)),
                      severity: 'Высокий',
                    }));
                  const cr = compareResult?.risk;
                  if (cr?.title) {
                    scatterRows.push({
                      id: 'cmp-ai-risk',
                      title: cr.title,
                      description: (cr.description as string) || '',
                      probability: typeof cr.probability === 'number' ? cr.probability : 68,
                      impact: typeof cr.impact === 'number' ? cr.impact : 72,
                      severity: (['Низкий', 'Средний', 'Высокий', 'Критично'].includes(String(cr.severity))
                        ? (cr.severity as Risk['severity'])
                        : 'Высокий'),
                    });
                  }
                  const hs = allCompareResult?.healthScore;
                  if (scatterRows.length === 0 && hs !== undefined && hs < 88) {
                    scatterRows.push({
                      id: 'cmp-health',
                      title: 'Снижение индекса соответствия',
                      description: `Оценка ${hs}% без явного списка коллизий — стоит перепроверить нормы и редакции.`,
                      probability: Math.min(85, Math.max(25, 100 - hs)),
                      impact: Math.min(88, Math.max(35, 105 - hs)),
                      severity: hs < 65 ? 'Критично' : hs < 78 ? 'Высокий' : 'Средний',
                    });
                  }
                  if (scatterRows.length === 0) return null;
                  return (
                    <div className="bg-white/[0.02] border border-violet-500/15 rounded-3xl p-6">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h4 className="text-lg font-bold text-white">Матрица рисков по результатам сравнения</h4>
                          <p className="text-xs text-white/40 mt-1">Точки построены по выявленным коллизиям и рекомендациям ИИ</p>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-white/40">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Критично</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Высокий</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Прочее</span>
                        </div>
                      </div>
                      <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 12, right: 12, bottom: 28, left: 12 }}>
                            <XAxis
                              type="number"
                              dataKey="probability"
                              name="Вероятность"
                              unit="%"
                              domain={[0, 100]}
                              stroke="#444"
                              tick={{ fill: '#888', fontSize: 10 }}
                              label={{ value: 'Вероятность', position: 'bottom', fill: '#666', fontSize: 10 }}
                            />
                            <YAxis
                              type="number"
                              dataKey="impact"
                              name="Ущерб"
                              unit="%"
                              domain={[0, 100]}
                              stroke="#444"
                              tick={{ fill: '#888', fontSize: 10 }}
                              label={{ value: 'Ущерб', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 10 }}
                            />
                            <ZAxis type="number" dataKey="impact" range={[120, 900]} />
                            <Tooltip
                              cursor={{ strokeDasharray: '3 3' }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const d = payload[0].payload as typeof scatterRows[0];
                                  return (
                                    <div className="bg-black/90 border border-white/10 p-3 rounded-xl backdrop-blur-md max-w-xs">
                                      <p className="font-bold text-sm mb-1">{d.title}</p>
                                      <p className="text-[10px] text-white/50 mb-2">{d.description}</p>
                                      <div className="flex gap-4 text-[10px]">
                                        <span><span className="text-white/40">Вер-ть</span> <b>{d.probability}%</b></span>
                                        <span><span className="text-white/40">Ущерб</span> <b>{d.impact}%</b></span>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Scatter name="Сравнение" data={scatterRows}>
                              {scatterRows.map((entry, index) => (
                                <Cell
                                  key={entry.id}
                                  fill={
                                    entry.severity === 'Критично'
                                      ? '#f43f5e'
                                      : entry.severity === 'Высокий'
                                        ? '#fb923c'
                                        : entry.severity === 'Средний'
                                          ? '#eab308'
                                          : '#94a3b8'
                                  }
                                />
                              ))}
                            </Scatter>
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}

                <div className="pt-4">
                  <button 
                    onClick={() => setIsCompareResultOpen(false)}
                    className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Понятно, спасибо
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <FloatingLexiButton onClick={() => openLexi(defaultLexiRisk())} />
    </div>
  );
}

const FloatingLexiButton = ({ onClick }: { onClick: () => void }) => (
  <button 
    onClick={onClick}
    className="fixed bottom-8 right-8 w-16 h-16 bg-cyan-500 text-black rounded-full shadow-2xl shadow-cyan-500/50 flex items-center justify-center hover:scale-110 transition-all z-50 group"
  >
    <div className="absolute inset-0 rounded-full bg-cyan-400 animate-ping opacity-20 group-hover:opacity-40"></div>
    <MessageSquare className="w-8 h-8" />
    <div className="absolute -top-12 right-0 bg-white text-black text-[10px] font-bold px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-xl">
      Нужна помощь? Я здесь! ✨
    </div>
  </button>
);
