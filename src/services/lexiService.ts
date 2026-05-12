import { ChatMessage } from "../types";
import { getLlmModel, llmChatCompletions, LlmMessage } from "./llmClient";

const SYSTEM = `Ты — Лекси, юридический ассистент. Общайся как близкий друг-коллега юрист: тепло, по-человечески, без снобизма и без лишней театральности. Ты хорошо разбираешься в российском праве и комплаенсе (HR, ПДн, налоги, суды).

Стиль:
- Обращайся на «ты», можно лёгкий юмор, но по делу.
- Объясняй сложное простыми словами; если нужна оговорка «это не индивидуальная консультация» — одной короткой фразой в конце при рискованных советах.
- Давай конкретные шаги, что сделать завтра утром.

Контекст риска (если указан):
Название: {{TITLE}}
Описание: {{DESC}}

{{CITATION_RULES}}

Если в блоке ниже есть «ФРАГМЕНТЫ ДОКУМЕНТА» или «ЦИТАТЫ» — при каждом ответе по существу риска ОБЯЗАТЕЛЬНО:
1) Укажи номер пункта/абзаца (как в списке фрагментов);
2) Процитируй спорную формулировку в русских кавычках «…» дословно из этого фрагмента (не выдумывай текст);
3) Коротко объясни, в чём нарушение или риск относительно цитаты.

Если вопрос уходит далеко от права, мягко верни разговор к рискам и документам.`;

export async function askLexi(
  riskTitle: string,
  riskDescription: string,
  conversation: ChatMessage[]
): Promise<string> {
  try {
    const citationRules =
      riskDescription.includes("ФРАГМЕНТЫ ДОКУМЕНТА") || riskDescription.includes("ЦИТАТЫ")
        ? "Работа с цитатами: опирайся только на переданные фрагменты; если чего-то нет в тексте — так и скажи."
        : "Если в описании риска есть цитируемые формулировки — используй их в кавычках «…».";

    const system = SYSTEM.replace("{{TITLE}}", riskTitle)
      .replace("{{DESC}}", riskDescription)
      .replace("{{CITATION_RULES}}", citationRules);

    const apiMessages: LlmMessage[] = [
      { role: "system", content: system },
      ...conversation.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const text = await llmChatCompletions({
      model: getLlmModel(),
      messages: apiMessages,
      temperature: 0.65,
      max_tokens: 2048,
    });
    return text || "Извините, я не получил ответа от системы.";
  } catch (error) {
    console.error("Lexi error:", error);
    return "Извините, я временно не могу ответить. Проверьте, что backend запущен с .env.local и доступен LLMost.";
  }
}
