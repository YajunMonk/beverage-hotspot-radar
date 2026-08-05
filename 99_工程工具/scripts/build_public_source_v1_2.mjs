#!/usr/bin/env node

import crypto from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PAGE_BUILDER = path.join(import.meta.dirname, "build_public_v1_2_release.mjs");
const METRIC_DIR = "02_数据清洗/处理后数据/V1.2/周期快照/2026-W30/03_汇总指标";
const ANALYSIS_DIR = "02_数据清洗/处理后数据/V1.2/周期快照/2026-W30/04_分析结论";

const PUBLIC_FILES = [
  ".gitignore",
  "README.md",
  "PUBLICATION_BOUNDARY.md",
  "01_数据抓取/README.md",
  "01_数据抓取/抓取规则.md",
  "01_数据抓取/来源说明.md",
  "01_数据抓取/API抓取/README.md",
  "02_数据清洗/README.md",
  "02_数据清洗/当前执行规则.md",
  "02_数据清洗/规则/数据分析与BI执行规范_V1.2.md",
  "02_数据清洗/规则/01_字段字典/字段字典_V1.2.csv",
  "02_数据清洗/规则/02_指标字典/指标字典_V1.2.csv",
  "02_数据清洗/规则/03_标签字典/标签字典_V1.2.csv",
  "02_数据清洗/规则/04_分析策略与提示词/分析输入输出契约_V1.2.md",
  "02_数据清洗/处理后数据/主数据/dim_brands.csv",
  "02_数据清洗/处理后数据/主数据/dim_entities.csv",
  "02_数据清洗/处理后数据/主数据/dim_tags.csv",
  "02_数据清洗/处理后数据/主数据/dim_metrics.csv",
  "02_数据清洗/处理后数据/V1.2/README.md",
  "02_数据清洗/处理后数据/V1.2/饮品热点雷达_V1.2_BI数据中心.xlsx",
  "02_数据清洗/校验记录/2026-W30/V1.2/README.md",
  "02_数据清洗/校验记录/2026-W30/V1.2/data_quality_checks.csv",
  "02_数据清洗/校验记录/2026-W30/V1.2/data_quality_report.json",
  "02_数据清洗/校验记录/2026-W30/V1.2/metric_reconciliation.csv",
  "02_数据清洗/校验记录/2026-W30/V1.2/release_validation_report.json",
  "02_数据清洗/校验记录/2026-W30/V1.2/v1.1_immutable_fingerprints.json",
  "03_网页呈现/README.md",
  "03_网页呈现/V1.2/README.md",
  "03_网页呈现/验收记录/2026-W30/V1.2/页面验收记录.md",
  "03_网页呈现/验收记录/2026-W30/V1.2/interface_validation_local.json",
  "03_网页呈现/验收记录/2026-W30/V1.2/interface_validation_live.json",
  "99_工程工具/README.md",
  "99_工程工具/project_state.json",
  "99_工程工具/scripts/README.md",
  "99_工程工具/scripts/build_v1_2_release.mjs",
  "99_工程工具/scripts/build_v1_2_workbook.mjs",
  "99_工程工具/scripts/validate_v1_2_release.mjs",
  "99_工程工具/scripts/playwright_v1_2_interface_qa.mjs",
  "99_工程工具/scripts/build_public_v1_2_release.mjs",
  "99_工程工具/scripts/build_public_source_v1_2.mjs",
];

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function copyRelative(relative, outputDir) {
  const source = path.join(ROOT, relative);
  const destination = path.join(outputDir, relative);
  if (!(await stat(source)).isFile()) throw new Error(`白名单对象不是文件：${relative}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function selectedFiles(directory, predicate) {
  return (await readdir(path.join(ROOT, directory)))
    .filter(predicate)
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => `${directory}/${name}`);
}

async function walkFiles(base, current = base) {
  const output = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(base, full));
    else if (entry.isFile()) output.push(path.relative(base, full));
  }
  return output;
}

async function sha256(file) {
  return crypto.createHash("sha256").update(await readFile(file)).digest("hex");
}

async function main() {
  const outputArgument = readArgument("--out");
  if (!outputArgument) throw new Error("缺少 --out <公开源码目录>");
  const outputDir = path.resolve(outputArgument);
  if (outputDir === ROOT || outputDir.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("公开源码目录必须位于项目目录之外");
  }

  const aggregateFiles = await selectedFiles(METRIC_DIR, (name) => name.startsWith("mart_") && name.endsWith(".csv"));
  const analysisFiles = await selectedFiles(ANALYSIS_DIR, (name) => name.startsWith("analysis_insights.") && [".csv", ".json"].includes(path.extname(name)));
  const whitelist = [...new Set([...PUBLIC_FILES, ...aggregateFiles, ...analysisFiles])];

  for (const relative of whitelist) await copyRelative(relative, outputDir);

  const pageDir = path.join(outputDir, "03_网页呈现", "V1.2");
  const pageResult = spawnSync(process.execPath, [PAGE_BUILDER, "--out", pageDir], { encoding: "utf8" });
  if (pageResult.status !== 0) throw new Error(pageResult.stderr || "V1.2 公开页面构建失败");

  const allFiles = (await walkFiles(outputDir)).sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (allFiles.some((file) => file.startsWith(`90_历史归档${path.sep}`))) throw new Error("公开源码包包含历史归档");
  if (allFiles.some((file) => /原始数据|运行记录|来源名单/.test(file))) throw new Error("公开源码包包含原始层文件");

  const textExtensions = new Set([".md", ".csv", ".json", ".html", ".css", ".js"]);
  const privatePatterns = [
    { label: "本机绝对路径", value: "/Users/wbx" },
    { label: "临时访问参数值", value: "xsec_token=" },
    { label: "临时来源参数值", value: "xsec_source=" },
    { label: "本地文件协议", value: "file://" },
  ];
  for (const relative of allFiles) {
    if (!textExtensions.has(path.extname(relative)) || relative.startsWith("99_工程工具/scripts/")) continue;
    const text = await readFile(path.join(outputDir, relative), "utf8");
    const leak = privatePatterns.find((pattern) => text.includes(pattern.value));
    if (leak) throw new Error(`${relative} 包含${leak.label}`);
  }

  const manifestFiles = [];
  for (const relative of allFiles) {
    const full = path.join(outputDir, relative);
    manifestFiles.push({ path: relative, bytes: (await stat(full)).size, sha256: await sha256(full) });
  }
  const manifest = {
    release: "V1.2",
    scope: "public_safe_source",
    generated_at: new Date().toISOString(),
    excluded: ["原始抓取", "运行记录", "完整事实明细", "账号登记库", "历史归档", "本地预览"],
    files: manifestFiles,
  };
  await writeFile(path.join(outputDir, "PUBLIC_SOURCE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
