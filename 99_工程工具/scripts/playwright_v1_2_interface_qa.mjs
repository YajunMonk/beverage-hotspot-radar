#!/usr/bin/env node

import { chromium } from "playwright";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const targetUrl = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "http://127.0.0.1:8877/";
const reportIndex = process.argv.indexOf("--report");
const reportPath = reportIndex >= 0 ? path.resolve(process.argv[reportIndex + 1]) : null;
const checks = [];

function check(id, condition, expected, actual) {
  checks.push({ id, status: condition ? "passed" : "failed", expected, actual });
}

const defaultMacChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let chromeExecutable = process.env.PLAYWRIGHT_CHROME_PATH || null;
if (!chromeExecutable && process.platform === "darwin") {
  try {
    await access(defaultMacChrome);
    chromeExecutable = defaultMacChrome;
  } catch {
    chromeExecutable = null;
  }
}
const browser = await chromium.launch({ headless: true, ...(chromeExecutable ? { executablePath: chromeExecutable } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.emulateMedia({ reducedMotion: "reduce" });
const consoleErrors = [];
const consoleWarnings = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
  if (message.type() === "warning") consoleWarnings.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  const response = await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
  check("http_status", Boolean(response?.ok()), "2xx", response?.status() ?? null);
  await page.waitForSelector("#event-result-count", { timeout: 15000 });

  check("title", await page.title() === "饮品热点雷达 V1.2 · 本周市场信号", "饮品热点雷达 V1.2 · 本周市场信号", await page.title());
  check("release", await page.locator("#release-version").innerText() === "V1.2", "V1.2", await page.locator("#release-version").innerText());
  check("all_source_count", await page.locator("#event-result-count").innerText() === "64 条市场线索", "64 条市场线索", await page.locator("#event-result-count").innerText());
  check("brand_content_count", (await page.locator("#content-result-count").textContent()) === "94 条官号内容", "94 条官号内容", await page.locator("#content-result-count").textContent());
  check("initial_event_card_count", await page.locator("#event-list > article").count() === 12, 12, await page.locator("#event-list > article").count());
  check("theme_count", await page.locator("#theme-analysis-grid").locator(":scope > *").count() === 3, 3, await page.locator("#theme-analysis-grid").locator(":scope > *").count());
  check("tag_metric_count", (await page.locator("#tag-metric-table").locator(":scope > *").count()) - 1 === 25, 25, (await page.locator("#tag-metric-table").locator(":scope > *").count()) - 1);
  check("popular_tag_count", await page.locator("#popular-tag-list .popular-tag-button").count() === 8, 8, await page.locator("#popular-tag-list .popular-tag-button").count());
  check("quick_action_count", await page.locator(".hero-actions > *").count() === 4, 4, await page.locator(".hero-actions > *").count());
  check("methodology_collapsed", !(await page.locator(".methodology-disclosure").getAttribute("open")), "closed", await page.locator(".methodology-disclosure").getAttribute("open") || "closed");
  check("evidence_collapsed", !(await page.locator(".evidence-disclosure").getAttribute("open")), "closed", await page.locator(".evidence-disclosure").getAttribute("open") || "closed");

  const kpis = await page.locator("#bi-overview-grid .bi-kpi-card strong").allInnerTexts();
  check("kpi_values", JSON.stringify(kpis) === JSON.stringify(["35个", "9个", "688"]), ["35个", "9个", "688"], kpis);
  check("desktop_overflow", await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth), 0, await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth));
  const visibleEngineeringTerms = await page.evaluate(() => (document.body.innerText.match(/P75|有效 N|阻断错误|快照龄/g) || []).length);
  check("engineering_terms_not_in_primary_reading", visibleEngineeringTerms === 0, 0, visibleEngineeringTerms);

  await page.locator(".evidence-disclosure > summary").click();
  const contentLink = page.locator("#content-list .source-link").first();
  check("visible_content_link", (await contentLink.innerText()).includes("查看单条原文"), "查看单条原文", await contentLink.innerText());
  const contentHref = await contentLink.getAttribute("href");
  check("canonical_content_link", /^https:\/\/www\.xiaohongshu\.com\/explore\/[a-z0-9]+$/i.test(contentHref || ""), "canonical explore URL", contentHref);

  const koc = page.locator('#desktop-filters input[type="checkbox"][value="koc"]');
  await koc.check();
  check("koc_filter", await page.locator("#event-result-count").innerText() === "19 条市场线索", "19 条市场线索", await page.locator("#event-result-count").innerText());
  check("koc_direct_link", (await page.locator("#event-list article:not([hidden]) a.event-open").first().innerText()).includes("打开单条原帖"), "打开单条原帖", await page.locator("#event-list article:not([hidden]) a.event-open").first().innerText());
  await koc.uncheck();

  const thirdParty = page.locator('#desktop-filters input[type="checkbox"][value="third_party"]');
  await thirdParty.check();
  check("third_party_filter", await page.locator("#event-result-count").innerText() === "10 条市场线索", "10 条市场线索", await page.locator("#event-result-count").innerText());
  await thirdParty.uncheck();

  await page.getByRole("button", { name: /查看产品动作中的茉莉/ }).first().click();
  check("jasmine_filter", await page.locator("#event-result-count").innerText() === "3 条市场线索", "3 条市场线索", await page.locator("#event-result-count").innerText());

  const eventEvidenceButton = page.locator("#event-list [data-open-event]").first();
  check("event_evidence_button", await eventEvidenceButton.isVisible(), true, await eventEvidenceButton.isVisible());
  await eventEvidenceButton.click();
  check("event_dialog", await page.locator("#event-dialog").isVisible(), true, await page.locator("#event-dialog").isVisible());
  const evidenceLink = page.locator("#event-dialog-content .dialog-evidence a").first();
  check("visible_evidence_link", (await evidenceLink.innerText()).includes("查看单条小红书原文"), "查看单条小红书原文", await evidenceLink.innerText());
  check("canonical_evidence_link", /^https:\/\/www\.xiaohongshu\.com\/explore\/[a-z0-9]+$/i.test((await evidenceLink.getAttribute("href")) || ""), "canonical explore URL", await evidenceLink.getAttribute("href"));
  await page.getByRole("button", { name: "关闭事件详情" }).click();

  const ephemeralUrlCount = await page.locator('a[href*="xsec_token"],a[href*="xsec_source"],a[href*="m_source"]').count();
  check("ephemeral_url_count", ephemeralUrlCount === 0, 0, ephemeralUrlCount);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  check("mobile_overflow", await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth), 0, await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth));
  check("mobile_page_height", await page.evaluate(() => document.body.scrollHeight < 20000), "< 20000px", await page.evaluate(() => document.body.scrollHeight));
  check("mobile_filter_button", await page.locator("#mobile-filter-open").isVisible(), true, await page.locator("#mobile-filter-open").isVisible());
  check("mobile_tag_header_hidden", !(await page.locator(".tag-metric-head").isVisible()), false, await page.locator(".tag-metric-head").isVisible());
  await page.locator("#mobile-filter-open").click();
  check("mobile_filter_group_count", await page.locator("#mobile-filters .filter-group").count() === 8, 8, await page.locator("#mobile-filters .filter-group").count());
  await page.locator("#mobile-filter-apply").click();
  check("mobile_filter_close", !(await page.locator("#mobile-filter-dialog").isVisible()), false, await page.locator("#mobile-filter-dialog").isVisible());

  check("console_errors", consoleErrors.length === 0, 0, consoleErrors);
  check("console_warnings", consoleWarnings.length === 0, 0, consoleWarnings);
} catch (error) {
  checks.push({ id: "runtime", status: "failed", expected: "page QA completes", actual: error instanceof Error ? error.message : String(error) });
} finally {
  await browser.close();
}

const failed = checks.filter((item) => item.status === "failed");
const result = {
  schema_version: "interface-validation-v1.2",
  target_url: targetUrl,
  checked_at: new Date().toISOString(),
  status: failed.length ? "failed" : "passed",
  summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  failed_check_ids: failed.map((item) => item.id),
  checks,
};

const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
if (reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, serializedResult, "utf8");
}
process.stdout.write(serializedResult);
if (failed.length) process.exitCode = 1;
