import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../config/index.js';

export interface GenerateJsonInput {
  systemInstruction: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
}

/** 生成 AI クライアントの最小インターフェース（テストで差し替え可能にする） */
export interface JsonGenerationClient {
  generateJson(input: GenerateJsonInput): Promise<string>;
}

/**
 * Gemini（Google AI Studio 無料枠）クライアント。
 * responseJsonSchema による構造化出力を使い、JSON 以外が返らないようにする。
 */
export class GeminiClient implements JsonGenerationClient {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly thinkingBudget: number;

  constructor(
    config: Pick<AppConfig, 'GEMINI_API_KEY' | 'GEMINI_MODEL' | 'GEMINI_THINKING_BUDGET'>,
  ) {
    this.ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    this.model = config.GEMINI_MODEL;
    this.thinkingBudget = config.GEMINI_THINKING_BUDGET;
  }

  async generateJson({
    systemInstruction,
    userPrompt,
    jsonSchema,
  }: GenerateJsonInput): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: 0,
        thinkingConfig: { thinkingBudget: this.thinkingBudget },
      },
    });

    const text = response.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('AI から空のレスポンスが返りました');
    }
    return text;
  }
}
