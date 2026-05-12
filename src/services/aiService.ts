import { Risk } from "../types";
import { extractTextFromPdfFile } from "../lib/pdfText";
import {
  extractJsonObject,
  getLlmModel,
  llmChatCompletions,
  LlmContentPart,
} from "./llmClient";

const LEGAL_AUDIT_INSTRUCTION = `
Действуй как гибрид старшего юриста и профессионального редактора. Твоя задача — провести аудит документа на предмет рисков и переписать его так, чтобы он был понятен человеку без юридического образования, сохранив при этом полную юридическую силу.

Этап 1: Правовой анализ
- Риски: Выдели «красные флаги» (скрытые обязательства, штрафы, сроки).
- Легитимность: Проверь полномочия, реквизиты и соответствие закону.
- Логика: Устрани противоречия между пунктами.

Этап 2: Редактура «Пиши, сокращай»
- Упрости язык: избавься от канцеляризмов и сложных деепричастных оборотов.
- Действующее лицо: перепиши пассивный залог в активный (кто именно выполняет действие).
- Чистка мусора: удали вводные фразы без юридического смысла («в силу того, что», «является обязательным условием для»).
- Визуальная ясность: разбей длинные предложения и создай списки там, где это уместно.

По типу документа добавь отдельный блок subtypeSpecificChecks (текстом), если удаётся классифицировать:
- Претензия или иск: проверь соблюдение досудебного порядка и точность расчёта требований.
- Доверенность: проверь наличие права передоверия и конкретный перечень полномочий — нет ли лишнего.
- Устав / протокол: проверь кворум, порядок голосования и исключительные компетенции органов управления.
- Трудовой документ: проверь на соответствие ТК РФ — нет ли ухудшения положения работника.
- Согласие на обработку данных: проверь на соответствие ФЗ-152 (цели, сроки обработки, порядок отзыва).

Метрики: в metricsAnalysis кратко оцени по шкале 1–10 и одной фразой обоснования: правовая определённость, баланс интересов сторон, исполнимость, прозрачность ответственности, соответствие рыночной практике (если применимо).

Формат итогового JSON (строго валидный JSON, без комментариев):
{
  "docType": "тип документа",
  "clauses": ["абзац 1", "абзац 2"],
  "risk": {
    "title": "...",
    "description": "...",
    "severity": "Критично" | "Высокий" | "Средний" | "Низкий",
    "recommendation": "...",
    "actionPlan": ["...", "..."]
  },
  "conflicts": ["..."],
  "summary": "Краткое саммари для руководителя",
  "criticalRemarks": ["красные флаги по убыванию опасности"],
  "revisionRecommendations": "Как переформулировать спорные пункты",
  "forecast": "Что будет, если оставить документ в текущем виде",
  "metricsAnalysis": "текст с оценками метрик",
  "subtypeSpecificChecks": "или пустая строка, если тип неясен"
}
`;

function categoryPrefix(categoryId?: string, isRag?: boolean): string {
  if (isRag) {
    return "Проанализируй этот чек-лист как базу знаний для последующих проверок документов.";
  }
  switch (categoryId) {
    case "tax":
      return "Проанализируй этот документ на соответствие налоговому законодательству РФ. ОБЯЗАТЕЛЬНО проверь корректность указания НДС (VAT) и риски дробления, необоснованной выгоды.";
    case "advertising":
      return "Проанализируй этот документ на соответствие ФЗ «О рекламе». Ищи риски отсутствия маркировки и некорректных сравнений.";
    case "infosec":
      return "Проанализируй этот документ на соответствие ФЗ-152 «О персональных данных» и стандартам ИБ.";
    case "court":
      return "Проанализируй этот документ на соответствие судебной практике и договорным рискам. ОБЯЗАТЕЛЬНО проверь подсудность и отсутствие противоречий с ГК РФ.";
    case "lna_sync":
      return "Проанализируй этот договор на соответствие локальным нормативным актам (ЛНА) компании. Ищи противоречия в сроках, суммах и полномочиях.";
    default:
      return "Проанализируй этот юридический документ на соответствие законодательству РФ.";
  }
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
}

export type DocumentAnalysisResult = {
  clauses: string[];
  risk: Partial<Risk>;
  summary?: string;
  conflicts?: string[];
  docType?: string;
  criticalRemarks?: string[];
  revisionRecommendations?: string;
  forecast?: string;
  metricsAnalysis?: string;
  subtypeSpecificChecks?: string;
};

export async function analyzeDocument(
  file: File,
  categoryId?: string,
  isRag?: boolean,
  existingDocs?: { title: string; content: string }[]
): Promise<DocumentAnalysisResult> {
  const mimeType = file.type || "application/octet-stream";
  const isPdf =
    mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = mimeType.startsWith("image/");

  const base64Data = await fileToBase64(file);
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const existingDocsContext =
    existingDocs && existingDocs.length > 0
      ? `\n\nЭТАЛОННЫЕ ДОКУМЕНТЫ:\n${existingDocs.map((d) => `ДОКУМЕНТ [${d.title}]:\n${d.content.substring(0, 1500)}`).join("\n---\n")}\n`
      : "";

  const qualityChecks = `
  КРИТИЧЕСКИЙ ЧЕК-ЛИСТ:
  1. Соответствие законодательству РФ (ГК РФ, НК РФ, профильные законы).
  2. Подсудность и отсутствие коллизий с другими документами.
  3. НДС (VAT): формулировки и основания освобождения.
  4. Активный залог в правах и обязанностях.
  `;

  const userText = `${categoryPrefix(categoryId, isRag)} ${existingDocsContext} ${qualityChecks}
${LEGAL_AUDIT_INSTRUCTION}

Задачи по файлу:
1. Модуль OCR (распознавание): извлеки текст документа максимально полно. Верни в массиве clauses (логические абзацы).
2. Сформулируй основной риск в risk.
3. ${existingDocsContext ? "СРАВНИ с эталонными документами и заполни conflicts." : "conflicts можно оставить пустым массивом, если нет эталонов."}
4. Заполни summary, criticalRemarks, revisionRecommendations, forecast, metricsAnalysis, subtypeSpecificChecks согласно инструкции выше.
5. docType — тип документа (претензия, приказ, оферта и т.д.).

Ответь ТОЛЬКО одним JSON-объектом без пояснений до или после.`;

  let bodyContent: string | LlmContentPart[];

  if (isPdf) {
    let pdfPlain = "";
    try {
      pdfPlain = await extractTextFromPdfFile(file);
    } catch (e) {
      console.error("PDF extract:", e);
      throw new Error(
        "Не удалось прочитать PDF. Попробуйте другой файл или экспортируйте документ в изображение."
      );
    }
    if (!pdfPlain || pdfPlain.length < 20) {
      throw new Error(
        "В PDF почти нет текста (возможно, только скан). Загрузите текстовый PDF или изображение страниц."
      );
    }
    const clipped = pdfPlain.slice(0, 28000);
    bodyContent = `${userText}

НИЖЕ — извлечённый текст PDF (локально). На его основе заполни JSON (clauses разбей по смыслу, даже если в источнике сплошной поток):
---
${clipped}
---`;
  } else if (isImage) {
    bodyContent = [
      { type: "text", text: userText },
      { type: "image_url", image_url: { url: dataUrl } },
    ];
  } else {
    let decoded = "";
    try {
      const bin = atob(base64Data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      decoded = atob(base64Data);
    }
    const clipped = decoded.slice(0, 28000);
    bodyContent = `${userText}

ТЕКСТ ФАЙЛА:
---
${clipped}
---`;
  }

  let text: string;
  try {
    text = await llmChatCompletions({
      model: getLlmModel(),
      messages: [{ role: "user", content: bodyContent }],
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 8192,
    });
  } catch {
    text = await llmChatCompletions({
      model: getLlmModel(),
      messages: [{ role: "user", content: bodyContent }],
      temperature: 0.15,
      max_tokens: 8192,
    });
  }

  const jsonStr = extractJsonObject(text);
  try {
    const parsed = JSON.parse(jsonStr) as DocumentAnalysisResult;
    if (!parsed.clauses || !Array.isArray(parsed.clauses)) {
      throw new Error("Нет clauses");
    }
    if (!parsed.risk) parsed.risk = {};
    return parsed;
  } catch (e) {
    console.error("Parse error:", jsonStr);
    throw new Error("Не удалось разобрать ответ ИИ");
  }
}

export async function compareTwoDocuments(
  docA: { title: string; content: string },
  docB: { title: string; content: string }
): Promise<{ conflicts: string[]; summary: string; risk: Partial<Risk> }> {
  const prompt = `ПЕРЕКРЕСТНЫЙ АНАЛИЗ ДОКУМЕНТОВ:

ДОКУМЕНТ А: ${docA.title}
${docA.content.substring(0, 4000)}

ДОКУМЕНТ Б: ${docB.title}
${docB.content.substring(0, 4000)}

Найди противоречия, оцени стиль и НДС, подсудность. Ответь только JSON:
{"conflicts":[],"summary":"","risk":{"title":"","description":"","severity":"Средний","recommendation":"","actionPlan":[]}}`;

  let text: string;
  try {
    text = await llmChatCompletions({
      model: getLlmModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
  } catch {
    text = await llmChatCompletions({
      model: getLlmModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
  }

  try {
    return JSON.parse(extractJsonObject(text));
  } catch {
    throw new Error("Ошибка парсинга ответа сравнения");
  }
}

export async function compareAllDocuments(
  documents: { title: string; content: string }[]
): Promise<{ summary: string; conflicts: string[]; healthScore: number }> {
  if (documents.length < 2) {
    return {
      summary: "Недостаточно документов для сравнения. Загрузите как минимум два документа.",
      conflicts: [],
      healthScore: 100,
    };
  }

  const docsContext = documents
    .map((d, i) => `ДОКУМЕНТ №${i + 1} [${d.title}]:\n${d.content.substring(0, 2000)}`)
    .join("\n\n---\n\n");

  let text: string;
  try {
    text = await llmChatCompletions({
      model: getLlmModel(),
      messages: [
        {
          role: "user",
          content: `Перекрёстный анализ документов на противоречия и коллизии.

${docsContext}

Ответь только JSON: {"summary":"","conflicts":[],"healthScore":85}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
  } catch {
    text = await llmChatCompletions({
      model: getLlmModel(),
      messages: [
        {
          role: "user",
          content: `Перекрёстный анализ документов на противоречия и коллизии.

${docsContext}

Ответь только JSON: {"summary":"","conflicts":[],"healthScore":85}`,
        },
      ],
      temperature: 0.2,
    });
  }

  try {
    return JSON.parse(extractJsonObject(text));
  } catch (e) {
    console.error("Error parsing AI response:", e, text);
    return {
      summary: "Ошибка при анализе коллизий.",
      conflicts: ["Не удалось распарсить ответ ИИ"],
      healthScore: 50,
    };
  }
}
