/**
 * Jev 单步决策。
 * 只负责在当前可见元素里选择操作目标，不生成测试计划，也不做失败分析。
 */

import { ActionDecision, ElementSnapshot, PlannedStep } from "../types/index.js";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const MIN_CONFIDENCE = Number(process.env.JEV_MIN_CONFIDENCE || "0.4");

export function jevDecisionEnabled(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export function jevDecisionName(): string {
  return jevDecisionEnabled() ? "Jev (" + JEV_MODEL + ")" : "本地规则";
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
}

export async function chooseElementWithJev(
  step: PlannedStep,
  elements: ElementSnapshot[],
): Promise<ActionDecision | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey || elements.length === 0) return null;

  const candidates = elements.slice(0, 40);
  const criteria: Record<string, string> = {
    none: "没有合适的可见元素，或当前动作不需要点击、填写或悬停任何元素。",
  };
  for (const element of candidates) {
    criteria["e" + element.targetId] = describeElement(element);
  }

  const response = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: {
        action: step.intent,
        target: step.semanticTarget,
        value: step.value || "",
        elements: candidates.map((element) => ({
          id: "e" + element.targetId,
          tag: element.tagName,
          role: element.role || "",
          text: element.text || "",
          placeholder: element.placeholder || "",
          testId: element.testId || "",
          enabled: element.isEnabled,
        })),
      },
      questions: {
        target: {
          type: "choice",
          instructions: "为 state.action 选择一个可见元素来实现 state.target。填写必须选输入框，点击必须选按钮、链接或页签。没有匹配项时选 none。",
          criteria,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Jev HTTP " + response.status + ": " + detail.slice(0, 180));
  }

  const payload = (await response.json()) as {
    answers?: { target?: JevChoiceAnswer };
  };
  const answer = payload.answers?.target;
  if (!answer || answer.choice === "none" || answer.confidence < MIN_CONFIDENCE) return null;

  const targetId = Number(answer.choice.replace(/^e/, ""));
  const element = candidates.find((item) => item.targetId === targetId);
  if (!element) return null;

  return {
    action: step.intent,
    targetId: element.targetId,
    selector: element.selector,
    value: step.value,
    reasoning: "Jev 选择 e" + element.targetId + " " + (element.testId || element.text || element.tagName),
    confidence: answer.confidence,
  };
}

function describeElement(element: ElementSnapshot): string {
  return [
    element.tagName,
    element.role ? "role=" + element.role : "",
    element.testId ? "testid=" + element.testId : "",
    element.text ? "text=" + element.text : "",
    element.placeholder ? "placeholder=" + element.placeholder : "",
    element.isEnabled ? "enabled" : "disabled",
  ]
    .filter(Boolean)
    .join(" ");
}
