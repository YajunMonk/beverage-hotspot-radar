#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_DIR = path.join(PROJECT_ROOT, "03_网页呈现", "V1.1");
const DATA_PREFIX = "window.RADAR_V1_DATA = ";
const PUBLIC_FILES = ["index.html", "radar-v1.css", "radar-v1.js"];
const PRIVATE_MARKERS = ["xsec_token", "xsec_source", "m_source"];

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function canonicalizeXiaohongshuUrl(value) {
  if (typeof value !== "string" || !value.includes("xiaohongshu.com")) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com")) {
      return `${url.origin}${url.pathname}`;
    }
  } catch {
    return value;
  }

  return value;
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (!value || typeof value !== "object") {
    return canonicalizeXiaohongshuUrl(value);
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith("_file") && typeof child === "string") {
      continue;
    }

    if (key === "direct_post_url") {
      result[key] = canonicalizeXiaohongshuUrl(value.source_post_url || child);
      continue;
    }

    if (key === "direct_url_policy") {
      result[key] = "public_canonical";
      continue;
    }

    result[key] = sanitizeValue(child);
  }
  return result;
}

async function main() {
  const outputArgument = readArgument("--out");
  if (!outputArgument) {
    throw new Error("缺少 --out <发布目录>");
  }

  const outputDir = path.resolve(outputArgument);
  if (outputDir === PROJECT_ROOT || outputDir === SOURCE_DIR) {
    throw new Error("发布目录不能覆盖项目根目录或 V1.1 源目录");
  }

  await mkdir(outputDir, { recursive: true });
  for (const filename of PUBLIC_FILES) {
    await cp(path.join(SOURCE_DIR, filename), path.join(outputDir, filename));
  }

  const publicIndexPath = path.join(outputDir, "index.html");
  const publicIndex = (await readFile(publicIndexPath, "utf8")).replace(
    "饮品热点雷达 · 内部研究原型",
    "饮品热点雷达 · 公开研究原型"
  );
  await writeFile(publicIndexPath, publicIndex, "utf8");

  const rawData = await readFile(path.join(SOURCE_DIR, "radar-v1-data.js"), "utf8");
  if (!rawData.startsWith(DATA_PREFIX)) {
    throw new Error("无法识别 radar-v1-data.js 的数据前缀");
  }

  const jsonText = rawData.slice(DATA_PREFIX.length).trim().replace(/;$/, "");
  const publicData = sanitizeValue(JSON.parse(jsonText));
  publicData.meta.public_release = {
    visibility: "public",
    link_policy: "xiaohongshu_canonical_without_ephemeral_parameters",
    source_scope: "rendered_report_only"
  };

  const publicDataScript = `${DATA_PREFIX}${JSON.stringify(publicData)};\n`;
  const leakedMarker = PRIVATE_MARKERS.find((marker) => publicDataScript.includes(marker));
  if (leakedMarker) {
    throw new Error(`公开数据仍包含私有参数：${leakedMarker}`);
  }

  await writeFile(path.join(outputDir, "radar-v1-data.js"), publicDataScript, "utf8");
  await writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");
  await writeFile(
    path.join(outputDir, "README.md"),
    [
      "# 饮品热点雷达 V1.1",
      "",
      "小红书饮品行业周度信号报告。页面包含品牌、三方与 KOC 三类来源筛选，以及可回读的事件和内容证据。",
      "",
      "## 公开版说明",
      "",
      "- 仅发布网页渲染所需的静态文件。",
      "- 不包含原始抓取文件、项目内部文档或本地运行记录。",
      "- 小红书链接使用不含临时访问参数的标准地址，打开时可能需要登录。",
      ""
    ].join("\n"),
    "utf8"
  );

  process.stdout.write(`${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
