/**
 * 通用 LLM Provider 适配器
 * 支持:
 * 1. Google Gemini (原生官方 REST API，支持视觉多模态与结构化 JSON)
 * 2. OpenAI-compatible (支持 DeepSeek, OpenAI, 通义千问, 本地 Ollama 等)
 * 3. MockLLMProvider (无网络依赖的确定性回退测试桩)
 */

import { resolveAnalysis } from "../config/selection.js";
import { LLMProvider } from "../types/index.js";

export class MockLLMProvider implements LLMProvider {
  name = "MockLLMProvider";
  private customHandlers: Map<string, any> = new Map();

  constructor(handlers?: Record<string, any>) {
    if (handlers) {
      for (const [k, v] of Object.entries(handlers)) {
        this.customHandlers.set(k, v);
      }
    }
  }

  async generateText(prompt: string): Promise<string> {
    for (const [pattern, resp] of this.customHandlers.entries()) {
      if (prompt.includes(pattern)) {
        return typeof resp === "string" ? resp : JSON.stringify(resp);
      }
    }
    return `Mock response for prompt: ${prompt.slice(0, 50)}...`;
  }

  async generateJson<T = any>(prompt: string): Promise<T> {
    for (const [pattern, resp] of this.customHandlers.entries()) {
      if (prompt.includes(pattern)) {
        return (typeof resp === "string" ? JSON.parse(resp) : resp) as T;
      }
    }

    return {
      success: true,
      data: "mock-data",
    } as unknown as T;
  }
}

export interface GeminiConfig {
  apiKey?: string;
  model?: string;
}

export class GeminiProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private model: string;

  constructor(config: GeminiConfig = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
    // 默认使用快速且具备多模态能力的 gemini-1.5-flash / gemini-2.0-flash / 配置项
    this.model = config.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";
    this.name = `GoogleGeminiProvider(${this.model})`;
  }

  async generateText(
    prompt: string,
    options?: { systemPrompt?: string; temperature?: number },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Please set GEMINI_API_KEY in .env");
    }

    const fullPrompt = options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.2,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API request failed (${res.status}): ${errorText}`);
    }

    const data: any = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async generateJson<T = any>(prompt: string, options?: { systemPrompt?: string }): Promise<T> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Please set GEMINI_API_KEY in .env");
    }

    const fullPrompt = options?.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API JSON request failed (${res.status}): ${errorText}`);
    }

    const data: any = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(rawText) as T;
  }

  /**
   * 多模态视觉分析能力 (传入截图 Base64 与提示词，由 Gemini 进行排版与报错识别)
   */
  async analyzeScreenshot(base64Image: string, prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Image.replace(/^data:image\/\w+;base64,/, ""),
                },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini multimodal request failed: ${err}`);
    }

    const data: any = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
}

export interface OpenAILikeConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAILikeProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(config: OpenAILikeConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    this.baseURL = (
      config.baseURL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
    this.model = config.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.name = `OpenAILikeProvider(${this.model})`;
  }

  async generateText(
    prompt: string,
    options?: { systemPrompt?: string; temperature?: number },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("API Key is missing for OpenAILikeProvider.");
    }

    const messages = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async generateJson<T = any>(prompt: string, options?: { systemPrompt?: string }): Promise<T> {
    const system =
      (options?.systemPrompt || "") +
      "\n\nIMPORTANT: You must respond ONLY with a single valid JSON object. Do not include markdown code block formatting or backticks.";

    const text = await this.generateText(prompt, {
      ...options,
      systemPrompt: system,
    });

    try {
      const cleaned = text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, "$1");
      return JSON.parse(cleaned) as T;
    } catch (e: any) {
      throw new Error(`Failed to parse LLM JSON response: ${e.message}. Raw text was: ${text}`);
    }
  }
}

/**
 * 智能环境探测器：自动按优先级装配最佳 LLM Provider
 * 1. 优先读取 GEMINI_API_KEY -> Google Gemini (原生态支持)
 * 2. 其次读取 OPENAI_API_KEY / DEEPSEEK_API_KEY -> OpenAI/DeepSeek
 * 3. 无配置时 -> 返回 undefined，系统平滑降级为高性能本地规则引擎
 */
export function createAutoLLMProvider(): LLMProvider | undefined {
  const choice = resolveAnalysis();
  if (choice === "gemini" && process.env.GEMINI_API_KEY) {
    return new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY });
  }
  if (choice === "openai" && process.env.OPENAI_API_KEY) {
    return new OpenAILikeProvider({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
    });
  }
  if (choice === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    return new OpenAILikeProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    });
  }
  return undefined;
}
