const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("playwright/test");

test.use({ browserName: "chromium", channel: "chrome" });

test("V1.1 interface acceptance", async ({ page }) => {
  const qaSource = fs.readFileSync(
    path.join(__dirname, "playwright_v1_1_interface_qa.js"),
    "utf8",
  );
  const runQa = Function(`"use strict"; return (${qaSource});`)();
  const report = await runQa(page);
  const root = path.resolve(__dirname, "../..");
  const validationDir = path.join(root, "03_网页呈现/验收记录/2026-W30");
  const previewDir = path.join(
    root,
    "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews",
  );
  fs.mkdirSync(previewDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:8765/", { waitUntil: "load" });
  await page.evaluate(() => document.activeElement?.blur());
  await page.addStyleTag({ content: ".skip-link { display: none !important; }" });
  await page.locator("#core-themes").screenshot({
    path: path.join(previewDir, "核心看点_1440.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8765/", { waitUntil: "load" });
  await page.evaluate(() => document.activeElement?.blur());
  await page.addStyleTag({ content: ".skip-link { display: none !important; }" });
  await page.locator("#core-themes").screenshot({
    path: path.join(previewDir, "核心看点_390.png"),
  });
  for (const [width, height, fileName] of [
    [1440, 1000, "近期热点选题_1440.png"],
    [390, 844, "近期热点选题_390.png"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:8765/", { waitUntil: "load" });
    await page.evaluate(() => document.activeElement?.blur());
    await page.addStyleTag({ content: ".skip-link { display: none !important; }" });
    await page.locator("#editorial-watch").screenshot({
      path: path.join(previewDir, fileName),
    });
  }
  for (const [width, height, fileName] of [
    [1440, 1000, "品牌首屏_1440.png"],
    [390, 844, "品牌首屏_390.png"],
    [320, 844, "品牌首屏_320.png"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:8765/", { waitUntil: "load" });
    await page.evaluate(() => document.activeElement?.blur());
    await page.addStyleTag({ content: ".skip-link { display: none !important; }" });
    await page.screenshot({
      path: path.join(previewDir, fileName),
    });
  }
  const validationReport = {
    release: "V1.1",
    rule_version: "tag-filter-v1.1-r3",
    validated_at: new Date().toISOString(),
    ...report,
    viewport_widths: [320, 390, 768, 1024, 1440],
    preview_files: [
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/核心看点_1440.png",
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/核心看点_390.png",
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/近期热点选题_1440.png",
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/近期热点选题_390.png",
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/品牌首屏_1440.png",
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/品牌首屏_390.png",
      "99_工程工具/outputs/019fb292-93c8-7171-843d-4190563e73be/V1.1/interface_previews/品牌首屏_320.png",
    ],
  };
  fs.writeFileSync(
    path.join(validationDir, "interface_validation.json"),
    `${JSON.stringify(validationReport, null, 2)}\n`,
  );
  console.log(`INTERFACE_QA_RESULT=${JSON.stringify(report)}`);
  expect(report.failed, JSON.stringify(report.failed, null, 2)).toEqual([]);
  expect(report.passed).toBe(true);
});
