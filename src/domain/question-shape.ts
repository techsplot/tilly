const QUESTION_START =
  /^(when|what|which|where|who|why|how|did|do|does|have|has|had|is|are|was|were|can|could|will|would|show|give|tell|list|report|summari[sz]e|any)\b/i;

/**
 * Whether a message is worded like a question or a request for a report.
 * Used to double-check the fast model's "question"/"report" intent: "I
 * sprayed" is not worded as one, so that answer is checked again.
 */
export function looksLikeQuestion(message: string): boolean {
  const text = message.trim();
  return text.includes("?") || QUESTION_START.test(text);
}
