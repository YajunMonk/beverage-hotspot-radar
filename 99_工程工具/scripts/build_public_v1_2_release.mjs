#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_DIR = path.join(PROJECT_ROOT, "03_网页呈现", "V1.2");
const DATA_PREFIX = "window.RADAR_V12_DATA = ";
const PUBLIC_FILES = ["index.html", "radar-v1-2.css", "radar-v1-2.js"];
const PRIVATE_MARKERS = [
  "xsec_token",
  "xsec_source",
  "m_source",
  "file://",
  "/Users/",
  "\\Users\\",
];

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function canonicalizeXiaohongshuUrl(value) {
  if (typeof value !== "string" || !value.includes("xiaohongshu.com")) return value;
  try {
    const url = new URL(value);
    if (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com")) {
      return `${url.origin}${url.pathname}`.replace(/\/$/, "");
    }
  } catch {
    return value;
  }
  return value;
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return canonicalizeXiaohongshuUrl(value);

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith("_file") || key.endsWith("_path") || key === "collection_evidence") continue;
    result[key] = sanitizeValue(child);
  }
  return result;
}

function projectPublicData(data) {
  return sanitizeValue({
    meta: {
      project: data.meta.project,
      release: data.meta.release,
      source_release: data.meta.source_release,
      generated_at: data.meta.generated_at,
      rule_version: data.meta.rule_version,
      period: data.meta.period,
      scope: data.meta.scope,
      isolation_note: data.meta.isolation_note,
      analysis_gate: data.meta.analysis_gate,
      public_release: {
        visibility: "public",
        link_policy: "xiaohongshu_canonical_without_ephemeral_parameters",
        source_scope: "rendered_report_only",
      },
    },
    summary: {
      theme_analyses: data.summary.theme_analyses,
    },
    brands: data.brands.map(({ brand_id, brand_name }) => ({ brand_id, brand_name })),
    events: data.events,
    contents: data.contents.map(({
      body,
      page_evidence,
      legacy_fields,
      platform_content_id,
      account_id,
      migration_status,
      ...content
    }) => content),
    entities: data.entities.map(({
      normalization_note,
      source_rule_version,
      ...entity
    }) => entity),
    relations: data.relations,
    editorial_reference: data.editorial_reference,
    discovery_signals: data.discovery_signals,
    bi: data.bi,
  });
}

async function main() {
  const outputArgument = readArgument("--out");
  if (!outputArgument) throw new Error("缺少 --out <发布目录>");

  const outputDir = path.resolve(outputArgument);
  if (outputDir === PROJECT_ROOT || outputDir === SOURCE_DIR || outputDir.startsWith(`${SOURCE_DIR}${path.sep}`)) {
    throw new Error("发布目录不能覆盖项目根目录或 V1.2 源目录");
  }

  await mkdir(outputDir, { recursive: true });
  for (const filename of PUBLIC_FILES) {
    await cp(path.join(SOURCE_DIR, filename), path.join(outputDir, filename));
  }

  const rawData = await readFile(path.join(SOURCE_DIR, "radar-v1-2-data.js"), "utf8");
  if (!rawData.startsWith(DATA_PREFIX)) throw new Error("无法识别 V1.2 页面数据前缀");

  const sourceData = JSON.parse(rawData.slice(DATA_PREFIX.length).trim().replace(/;$/, ""));
  const publicData = projectPublicData(sourceData);
  const publicDataScript = `${DATA_PREFIX}${JSON.stringify(publicData)};\n`;

  const leakedMarker = PRIVATE_MARKERS.find((marker) => publicDataScript.includes(marker));
  if (leakedMarker) throw new Error(`公开数据仍包含私有标记：${leakedMarker}`);

  await writeFile(path.join(outputDir, "radar-v1-2-data.js"), publicDataScript, "utf8");
  await writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");
  await writeFile(
    path.join(outputDir, "README.md"),
    [
      "# 饮品热点雷达 V1.2",
      "",
      "一套面向茶饮与咖啡市场的、可追溯的数据分析与热点判断系统。它不是简单罗列帖子，而是把原始内容归并成事件，再通过统一标签和统计口径，帮助品牌、策略和内容团队判断本周发生了什么、哪些信号值得继续跟踪、证据在哪里。",
      "",
      "在线页面：[饮品热点雷达](https://yajunmonk.github.io/beverage-hotspot-radar/)｜方法、字典与脱敏源码：[project-source 分支](https://github.com/YajunMonk/beverage-hotspot-radar/tree/project-source)",
      "",
      "## 核心作用",
      "",
      "- 把重复发帖归并为去重事件，避免用帖子数量误判市场动作。",
      "- 同时展示品牌、三方、KOC 和编辑热点，但严格分层，避免混算 KPI。",
      "- 用字段、指标和标签字典统一产品、联名、品类、原料、IP、促销与热点口径。",
      "- 让页面上的数字和结论能回到事件、指标和单条原帖。",
      "",
      "## 核心工作流",
      "",
      "```text",
      "数据抓取与证据留存",
      "  → 标准化、事件去重与标签复核",
      "  → 确定性脚本计算指标与分析结论",
      "  → Excel BI数据中心与HTML网页呈现",
      "```",
      "",
      "V1.2 当前覆盖 9 个品牌、94 条品牌内容、35 个去重事件，并独立展示 10 条三方线索、19 条 KOC 线索和 3 条编辑热点。正式互动指标以有效 N、中位数和 P75 为主，均值只作辅助。",
      "",
      "## 公开版边界",
      "",
      "- 只发布网页运行所需的静态文件和最小化页面数据。",
      "- 不包含原始抓取文件、完整本地事实表、来源登记库、运行记录或历史归档。",
      "- 已移除内容正文、迁移痕迹、本地路径和临时访问参数。",
      "- 品牌、三方、KOC 和编辑热点分层展示；只有品牌事实层进入正式 KPI。",
      "- 小红书链接使用稳定单帖地址，打开正文时可能需要登录。",
      "",
    ].join("\n"),
    "utf8",
  );

  for (const filename of [...PUBLIC_FILES, "radar-v1-2-data.js", "README.md"]) {
    const text = await readFile(path.join(outputDir, filename), "utf8");
    const leaked = PRIVATE_MARKERS.find((marker) => text.includes(marker));
    if (leaked) throw new Error(`${filename} 仍包含私有标记：${leaked}`);
  }

  process.stdout.write(`${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
