/**
 * JSON 测试报告持久化生成器
 */

import * as fs from "fs";
import * as path from "path";
import { AiUiTestReport } from "../types/index.js";

export class JsonReporter {
  static generate(report: AiUiTestReport, outputDir: string): string {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filePath = path.join(outputDir, `report-${report.goal.id}-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
    return filePath;
  }
}
