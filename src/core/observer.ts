/**
 * Step 02-A: Observer (页面感知与修剪)
 *
 * 职责：
 * 1. 扫描当前浏览器页面中的可交互元素
 * 2. 按照 data-testid、role、aria-label、文本等属性提炼精简语义
 * 3. 编排递增序号 [1, 2, 3...] 形成轻量元素快照，避免数万字符 HTML 消耗 Token
 */

import { ElementSnapshot } from "../types/index.js";

export interface PageLike {
  evaluate<T = any>(pageFunction: string | ((...args: any[]) => any), arg?: any): Promise<T>;
  url(): string;
}

export class PageObserver {
  /**
   * 从当前页面提取可交互元素并修剪为 ElementSnapshot 列表
   */
  async captureInteractiveElements(page: PageLike): Promise<ElementSnapshot[]> {
    try {
      const rawElements = await page.evaluate(() => {
        const interactiveSelectors = [
          "button",
          "a[href]",
          "input",
          "select",
          "textarea",
          '[role="button"]',
          '[role="link"]',
          '[role="tab"]',
          '[role="menuitem"]',
          "[data-testid]",
          '[tabindex]:not([tabindex="-1"])',
        ].join(",");

        // 核心亮点：弹窗感知隔离 (Modal Isolation)
        // 若当前页面弹出了 Modal 弹窗/抽屉（包含 fixed/z-50 遮罩），优先仅提取弹窗内的交互节点，杜绝点击背景导致的遮罩拦截
        const activeModal = document.querySelector(
          '[role="dialog"], div[class*="fixed"][class*="z-50"], div[class*="fixed"][class*="inset-0"]',
        );
        const searchRoot = activeModal || document;
        const nodes = Array.from(searchRoot.querySelectorAll(interactiveSelectors));
        const results: any[] = [];

        nodes.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          // 过滤不可见元素
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            parseFloat(style.opacity || "1") > 0.05;

          if (!isVisible) return;

          const tagName = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || "";
          const testId = el.getAttribute("data-testid") || "";
          const ariaLabel = el.getAttribute("aria-label") || "";
          const placeholder = (el as HTMLInputElement).placeholder || "";
          const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100);
          const type = (el as HTMLInputElement).type || "";
          const value = (el as HTMLInputElement).value || "";
          const isEnabled = !(el as HTMLButtonElement).disabled;

          // 生成优先选择器
          let selector = "";
          if (testId) {
            selector = `[data-testid="${testId}"]`;
          } else if (tagName === "button" && text) {
            selector = `button:has-text("${text}")`;
          } else if (tagName === "input" && placeholder) {
            selector = `input[placeholder="${placeholder}"]`;
          } else if (tagName === "input" && type) {
            selector = `input[type="${type}"]`;
          } else if (ariaLabel) {
            selector = `[aria-label="${ariaLabel}"]`;
          } else {
            selector = tagName;
          }

          results.push({
            tagName,
            role,
            testId,
            ariaLabel,
            placeholder,
            text,
            type,
            value,
            isEnabled,
            isVisible: true,
            selector,
            boundingBox: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          });
        });

        return results;
      });

      // 编号分配 1, 2, 3... 并去重
      return (rawElements || []).map((el: any, index: number) => ({
        ...el,
        targetId: index + 1,
      }));
    } catch (err: any) {
      console.warn(`[PageObserver] Failed to capture elements: ${err.message}`);
      return [];
    }
  }

  /**
   * 将提取的元素转为易读的文本提示清单（用于 Prompt 或日志输出）
   */
  formatElementListForPrompt(elements: ElementSnapshot[]): string {
    return elements
      .map((el) => {
        const parts = [`[${el.targetId}] <${el.tagName}>`];
        if (el.testId) parts.push(`testid="${el.testId}"`);
        if (el.text) parts.push(`text="${el.text}"`);
        if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
        if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
        if (el.role) parts.push(`role="${el.role}"`);
        return parts.join(" ");
      })
      .join("\n");
  }
}
