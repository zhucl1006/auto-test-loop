/**
 * Step 04: Assertion Verifier (断言验证引擎)
 *
 * 职责：
 * 1. 将 Planner 输出的高层预期断言 (ExpectedAssertion[]) 转换为页面真实验证
 * 2. 校验当前 URL、文本可见性、关键元素可见性
 * 3. 判定结果分支：
 *    - 全部满足 -> PASS
 *    - 有一项不满足 -> FAIL，收集未满足详情并转交 Step 05 进行根因诊断
 */

import { AssertionResult, ElementSnapshot, ExpectedAssertion } from "../types/index.js";
import { PlaywrightPage } from "./executor.js";

export class AssertionVerifier {
  async verifyAll(
    page: PlaywrightPage,
    expectedAssertions: ExpectedAssertion[],
    visibleElements?: ElementSnapshot[],
  ): Promise<{ allPassed: boolean; results: AssertionResult[] }> {
    const results: AssertionResult[] = [];
    const currentUrl = page.url();

    for (const item of expectedAssertions) {
      const res = await this.verifySingle(page, item, currentUrl, visibleElements);
      results.push(res);
    }

    const allPassed = results.length > 0 && results.every((r) => r.passed);
    return { allPassed, results };
  }

  private async verifySingle(
    page: PlaywrightPage,
    assertion: ExpectedAssertion,
    currentUrl: string,
    visibleElements?: ElementSnapshot[],
  ): Promise<AssertionResult> {
    const { assertionId, description, type, expected } = assertion;

    try {
      switch (type) {
        case "url_contains": {
          let passed = currentUrl.includes(expected);
          let evaluatedUrl = currentUrl;
          if (!passed) {
            // 给 SPA 前端路由跳转提供至多 3.5 秒平滑等待重试
            for (let i = 0; i < 7; i++) {
              await page.waitForTimeout(500);
              evaluatedUrl = page.url();
              if (evaluatedUrl.includes(expected)) {
                passed = true;
                break;
              }
            }
          }
          return {
            assertionId,
            description,
            type,
            expected: `URL 应包含 "${expected}"`,
            actual: evaluatedUrl,
            passed,
            message: passed
              ? "URL 匹配成功"
              : `当前 URL 为 "${evaluatedUrl}"，未包含预期子串 "${expected}"`,
          };
        }

        case "url_matches": {
          const regex = new RegExp(expected);
          const passed = regex.test(currentUrl);
          return {
            assertionId,
            description,
            type,
            expected: `URL 应符合正则 /${expected}/`,
            actual: currentUrl,
            passed,
            message: passed ? "URL 正则校验通过" : `当前 URL "${currentUrl}" 不符合预期规则`,
          };
        }

        case "text_visible": {
          // 优先检查已感知的可见文本快照 (同时包含 textContent, input.value 与 placeholder)
          let isVisible = false;
          if (visibleElements) {
            isVisible = visibleElements.some(
              (e) =>
                (e.text || "").includes(expected) ||
                (e.value || "").includes(expected) ||
                (e.placeholder || "").includes(expected),
            );
          }

          // 若快照中未找到，通过页面定位器再查一次 (支持普通文本与 input.value)
          if (!isVisible && page.locator) {
            try {
              const locator = page
                .locator(`:has-text("${expected}"), input[value*="${expected}"]`)
                .first();
              isVisible = await locator.isVisible({ timeout: 2000 }).catch(() => false);
            } catch {
              isVisible = false;
            }
          }

          return {
            assertionId,
            description,
            type,
            expected: `页面可见文本 "${expected}"`,
            actual: isVisible ? "文本可见" : "页面未找到对应可见文本",
            passed: isVisible,
            message: isVisible ? "文本验证通过" : `未能找到预期可见文本 "${expected}"`,
          };
        }

        case "element_visible": {
          let found = false;
          const target = (assertion.semanticTarget || expected).toLowerCase();

          if (visibleElements) {
            found = visibleElements.some((e) => {
              const testId = (e.testId || "").toLowerCase();
              const aria = (e.ariaLabel || "").toLowerCase();
              const text = (e.text || "").toLowerCase();
              const placeholder = (e.placeholder || "").toLowerCase();

              // 直接匹配
              if (
                testId.includes(target) ||
                aria.includes(target) ||
                text.includes(target) ||
                placeholder.includes(target)
              ) {
                return true;
              }

              // 智能中英双语语义词根对应
              if (target.includes("名称") || target.includes("name") || target.includes("标题")) {
                if (
                  testId.includes("name") ||
                  testId.includes("title") ||
                  placeholder.includes("名称") ||
                  placeholder.includes("活动") ||
                  placeholder.includes("标签")
                )
                  return true;
              }
              if (target.includes("按钮") || target.includes("btn")) {
                if (e.tagName === "button" || testId.includes("btn") || e.role === "button")
                  return true;
              }
              if (target.includes("导航") || target.includes("sidebar")) {
                if (testId.includes("sidebar") || testId.includes("nav")) return true;
              }
              return false;
            });
          }

          if (!found && page.locator) {
            try {
              const locator = page
                .locator(`[data-testid*="${target}"], [aria-label*="${target}"]`)
                .first();
              found = await locator.isVisible({ timeout: 2000 }).catch(() => false);
            } catch {
              found = false;
            }
          }

          return {
            assertionId,
            description,
            type,
            expected: `元素可见: ${target}`,
            actual: found ? "元素可见" : "元素未见或未渲染",
            passed: found,
            message: found ? "关键元素验证通过" : `页面中未能识别到元素 "${target}"`,
          };
        }

        default:
          return {
            assertionId,
            description,
            type,
            expected,
            passed: true,
            message: "默认断言通过",
          };
      }
    } catch (err: any) {
      return {
        assertionId,
        description,
        type,
        expected,
        passed: false,
        actual: "执行断言抛出异常",
        message: err.message,
      };
    }
  }
}
